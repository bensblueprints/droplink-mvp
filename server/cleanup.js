const fs = require('fs');
const path = require('path');

// Best-effort file/dir delete — Windows can hold a lock briefly while a read
// stream is closing; never let that crash the sweep, just retry next tick.
function safeRm(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {
    console.warn('[cleanup] could not remove', p, '-', e.message);
  }
}

// One sweep: expires transfers past expires_at or over max_downloads,
// deletes their files from disk, and clears orphaned upload sessions >24h old.
function runCleanupSweep(db, dataDir) {
  const now = new Date().toISOString();

  const toExpire = db
    .prepare(
      `SELECT * FROM transfers
       WHERE status = 'ready'
         AND (expires_at <= ? OR (max_downloads IS NOT NULL AND download_count >= max_downloads))`
    )
    .all(now);

  for (const t of toExpire) {
    const files = db.prepare('SELECT * FROM files WHERE transfer_id = ?').all(t.id);
    for (const f of files) {
      safeRm(f.disk_path);
      safeRm(f.disk_path + '.part');
    }
    safeRm(path.join(dataDir, 'files', String(t.id)));
    // drop the file/session/chunk rows (bytes are gone) but keep the transfer
    // row itself — status flips to 'expired' so the admin dashboard/download
    // log still shows history.
    db.prepare(
      'DELETE FROM upload_chunks WHERE session_id IN (SELECT id FROM upload_sessions WHERE file_id IN (SELECT id FROM files WHERE transfer_id = ?))'
    ).run(t.id);
    db.prepare('DELETE FROM upload_sessions WHERE file_id IN (SELECT id FROM files WHERE transfer_id = ?)').run(t.id);
    db.prepare('DELETE FROM files WHERE transfer_id = ?').run(t.id);
    db.prepare(`UPDATE transfers SET status = 'expired' WHERE id = ?`).run(t.id);
  }

  // orphaned upload sessions (files never finalized) older than 24h
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const staleFiles = db
    .prepare(
      `SELECT f.* FROM files f
       JOIN transfers t ON t.id = f.transfer_id
       WHERE f.upload_complete = 0 AND t.status = 'uploading' AND f.created_at <= ?`
    )
    .all(cutoff);

  for (const f of staleFiles) {
    safeRm(f.disk_path);
    safeRm(f.disk_path + '.part');
    db.prepare('DELETE FROM upload_chunks WHERE session_id IN (SELECT id FROM upload_sessions WHERE file_id = ?)').run(f.id);
    db.prepare('DELETE FROM upload_sessions WHERE file_id = ?').run(f.id);
    db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  }

  // transfers left with zero files and still "uploading" after the sweep (orphaned session, nothing to show)
  db.prepare(
    `DELETE FROM transfers
     WHERE status = 'uploading' AND created_at <= ?
       AND id NOT IN (SELECT DISTINCT transfer_id FROM files)`
  ).run(cutoff);

  return { expired: toExpire.length, staleFiles: staleFiles.length };
}

function startCleanupLoop(db, dataDir, intervalMs) {
  const timer = setInterval(() => {
    try {
      runCleanupSweep(db, dataDir);
    } catch (e) {
      console.warn('[cleanup] sweep failed:', e.message);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { runCleanupSweep, startCleanupLoop, safeRm };
