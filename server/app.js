const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const archiver = require('archiver');
const { openDb } = require('./db');
const { runCleanupSweep, startCleanupLoop } = require('./cleanup');
const { sendTransferEmail, smtpConfigured } = require('./mailer');

const SLUG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function genSlug(len = 10) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const filesDir = path.join(dataDir, 'files');
  const adminPassword = opts.adminPassword || process.env.ADMIN_PASSWORD || 'admin';
  const autologinToken = opts.autologinToken || process.env.AUTOLOGIN_TOKEN || null;
  const quotaGB = Number(opts.storageQuotaGB ?? process.env.STORAGE_QUOTA_GB ?? 10);
  const quotaBytes = quotaGB * 1024 * 1024 * 1024;
  const cleanupIntervalMs = Number(opts.cleanupIntervalMs ?? process.env.CLEANUP_INTERVAL_MS ?? 5 * 60 * 1000);
  const tokenSecret = opts.tokenSecret || crypto.randomBytes(32).toString('hex');
  const baseUrl = opts.baseUrl || process.env.BASE_URL || '';

  const db = openDb(dataDir, opts.dbPath || process.env.DB_PATH);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  // ---- sessions (in-memory, simple by design) ----
  const sessions = new Set();
  function newSession(res) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.add(sid);
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
    return sid;
  }
  function requireAuth(req, res, next) {
    if (req.cookies.sid && sessions.has(req.cookies.sid)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  }

  // ---- short-lived public download tokens (stateless HMAC) ----
  function signToken(slug) {
    const exp = Date.now() + TOKEN_TTL_MS;
    const payload = `${slug}.${exp}`;
    const mac = crypto.createHmac('sha256', tokenSecret).update(payload).digest('hex');
    return Buffer.from(`${payload}.${mac}`).toString('base64url');
  }
  function verifyToken(token, slug) {
    if (!token) return false;
    try {
      const raw = Buffer.from(String(token), 'base64url').toString('utf8');
      const parts = raw.split('.');
      if (parts.length !== 3) return false;
      const [tSlug, expStr, mac] = parts;
      if (tSlug !== slug) return false;
      const payload = `${tSlug}.${expStr}`;
      const expected = crypto.createHmac('sha256', tokenSecret).update(payload).digest('hex');
      if (expected.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return false;
      return Number(expStr) > Date.now();
    } catch {
      return false;
    }
  }

  function usedBytes() {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(f.size_bytes), 0) AS n
         FROM files f JOIN transfers t ON t.id = f.transfer_id
         WHERE t.status IN ('uploading', 'ready')`
      )
      .get();
    return row.n;
  }

  function isLive(t) {
    if (!t || t.status !== 'ready') return false;
    if (new Date(t.expires_at).getTime() <= Date.now()) return false;
    if (t.max_downloads != null && t.download_count >= t.max_downloads) return false;
    return true;
  }

  // atomic check-and-increment so concurrent downloads can't exceed max_downloads
  const consumeDownload = db.transaction((transferId) => {
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(transferId);
    if (!t || t.status !== 'ready') return { ok: false, reason: 'not_ready' };
    if (new Date(t.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' };
    if (t.max_downloads != null && t.download_count >= t.max_downloads) return { ok: false, reason: 'limit' };
    db.prepare('UPDATE transfers SET download_count = download_count + 1 WHERE id = ?').run(transferId);
    return { ok: true };
  });

  // ================= AUTH =================

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.post('/api/login', (req, res) => {
    const pw = String(req.body?.password || '');
    const a = Buffer.from(pw);
    const b = Buffer.from(adminPassword);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    newSession(res);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    sessions.delete(req.cookies.sid);
    res.clearCookie('sid');
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => {
    res.json({ authed: !!(req.cookies.sid && sessions.has(req.cookies.sid)) });
  });

  if (autologinToken) {
    app.get('/auth/auto', (req, res) => {
      if (req.query.token !== autologinToken) return res.status(403).send('Forbidden');
      newSession(res);
      res.redirect('/admin');
    });
  }

  // ================= STORAGE =================

  app.get('/api/storage', requireAuth, (req, res) => {
    res.json({ usedBytes: usedBytes(), quotaBytes, quotaGB, smtpConfigured: smtpConfigured() });
  });

  // ================= TRANSFERS (admin) =================

  function transferView(t) {
    const files = db.prepare('SELECT id, name, size_bytes, mime, upload_complete FROM files WHERE transfer_id = ?').all(t.id);
    return {
      id: t.id,
      slug: t.slug,
      message: t.message,
      hasPassword: !!t.password_hash,
      expires_at: t.expires_at,
      max_downloads: t.max_downloads,
      download_count: t.download_count,
      total_bytes: t.total_bytes,
      status: t.status,
      created_at: t.created_at,
      files,
      url: `${baseUrl || ''}/t/${t.slug}`
    };
  }

  app.get('/api/transfers', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM transfers ORDER BY created_at DESC').all();
    res.json(rows.map(transferView));
  });

  app.post('/api/transfers', requireAuth, (req, res) => {
    const body = req.body || {};
    let expiresAt;
    if (body.expiresAt) {
      expiresAt = new Date(body.expiresAt).toISOString();
    } else {
      const days = Number(body.expiryDays) || 7;
      expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
    }
    const passwordHash = body.password ? bcrypt.hashSync(String(body.password), 10) : null;
    const maxDownloads = body.maxDownloads != null && body.maxDownloads !== '' ? Number(body.maxDownloads) : null;
    const slug = genSlug();

    const info = db
      .prepare(
        `INSERT INTO transfers (slug, message, password_hash, expires_at, max_downloads, status)
         VALUES (?, ?, ?, ?, ?, 'uploading')`
      )
      .run(slug, String(body.message || ''), passwordHash, expiresAt, maxDownloads);

    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(transferView(t));
  });

  app.get('/api/transfers/:id', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const downloads = db.prepare('SELECT * FROM downloads WHERE transfer_id = ? ORDER BY downloaded_at DESC').all(t.id);
    const emails = db.prepare('SELECT * FROM email_log WHERE transfer_id = ? ORDER BY sent_at DESC').all(t.id);
    res.json({ ...transferView(t), downloads, emails });
  });

  app.put('/api/transfers/:id', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const message = body.message != null ? String(body.message) : t.message;
    const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : t.expires_at;
    const maxDownloads =
      body.maxDownloads !== undefined ? (body.maxDownloads === null || body.maxDownloads === '' ? null : Number(body.maxDownloads)) : t.max_downloads;
    const passwordHash = body.password !== undefined ? (body.password ? bcrypt.hashSync(String(body.password), 10) : null) : t.password_hash;
    db.prepare('UPDATE transfers SET message=?, expires_at=?, max_downloads=?, password_hash=? WHERE id=?').run(
      message,
      expiresAt,
      maxDownloads,
      passwordHash,
      t.id
    );
    res.json(transferView(db.prepare('SELECT * FROM transfers WHERE id = ?').get(t.id)));
  });

  app.delete('/api/transfers/:id', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const files = db.prepare('SELECT * FROM files WHERE transfer_id = ?').all(t.id);
    for (const f of files) {
      try {
        if (fs.existsSync(f.disk_path)) fs.rmSync(f.disk_path, { force: true });
        if (fs.existsSync(f.disk_path + '.part')) fs.rmSync(f.disk_path + '.part', { force: true });
      } catch (e) {
        console.warn('[delete] could not remove file', f.disk_path, e.message);
      }
    }
    try {
      fs.rmSync(path.join(filesDir, String(t.id)), { recursive: true, force: true });
    } catch {}
    db.prepare(
      'DELETE FROM upload_chunks WHERE session_id IN (SELECT id FROM upload_sessions WHERE file_id IN (SELECT id FROM files WHERE transfer_id = ?))'
    ).run(t.id);
    db.prepare('DELETE FROM upload_sessions WHERE file_id IN (SELECT id FROM files WHERE transfer_id = ?)').run(t.id);
    db.prepare('DELETE FROM files WHERE transfer_id = ?').run(t.id);
    db.prepare('DELETE FROM downloads WHERE transfer_id = ?').run(t.id);
    db.prepare('DELETE FROM email_log WHERE transfer_id = ?').run(t.id);
    db.prepare('DELETE FROM transfers WHERE id = ?').run(t.id);
    res.json({ ok: true });
  });

  app.post('/api/transfers/:id/finalize', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const files = db.prepare('SELECT * FROM files WHERE transfer_id = ?').all(t.id);
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const incomplete = files.filter((f) => !f.upload_complete);
    if (incomplete.length) return res.status(400).json({ error: `${incomplete.length} file(s) still uploading` });
    const totalBytes = files.reduce((s, f) => s + f.size_bytes, 0);
    db.prepare(`UPDATE transfers SET status = 'ready', total_bytes = ? WHERE id = ?`).run(totalBytes, t.id);
    res.json(transferView(db.prepare('SELECT * FROM transfers WHERE id = ?').get(t.id)));
  });

  app.post('/api/transfers/:id/email', requireAuth, async (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const to = Array.isArray(req.body?.to) ? req.body.to : String(req.body?.to || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!to.length) return res.status(400).json({ error: 'No recipients' });
    const link = `${baseUrl || `${req.protocol}://${req.get('host')}`}/t/${t.slug}`;
    const extraMessage = req.body?.message ? `\n\n${req.body.message}` : '';
    const results = [];
    for (const addr of to) {
      const r = await sendTransferEmail({
        to: addr,
        subject: 'A file transfer has been shared with you',
        text: `You've received a file transfer.\n\nDownload: ${link}${extraMessage}`,
        html: `<p>You've received a file transfer.</p><p><a href="${link}">${link}</a></p>${extraMessage ? `<p>${extraMessage}</p>` : ''}`
      });
      db.prepare('INSERT INTO email_log (transfer_id, to_addr, ok, error) VALUES (?, ?, ?, ?)').run(t.id, addr, r.ok ? 1 : 0, r.error || null);
      results.push({ to: addr, ok: r.ok, error: r.error });
    }
    const warning = results.some((r) => !r.ok) ? 'Some emails were not sent — check SMTP configuration.' : null;
    res.json({ results, warning });
  });

  // ================= UPLOADS (chunked, resumable) =================

  app.post('/api/transfers/:id/files', requireAuth, (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const { name, size, mime, chunkSize } = req.body || {};
    const declaredSize = Number(size);
    if (!name || !Number.isFinite(declaredSize) || declaredSize < 0) {
      return res.status(400).json({ error: 'name and size are required' });
    }
    if (usedBytes() + declaredSize > quotaBytes) {
      return res.status(413).json({ error: `Storage quota exceeded (${quotaGB} GB limit).` });
    }

    const cs = Number(chunkSize) || DEFAULT_CHUNK_SIZE;
    const totalChunks = declaredSize === 0 ? 1 : Math.ceil(declaredSize / cs);

    const transferFilesDir = path.join(filesDir, String(t.id));
    fs.mkdirSync(transferFilesDir, { recursive: true });

    const fileInfo = db
      .prepare('INSERT INTO files (transfer_id, name, size_bytes, mime, disk_path, upload_complete) VALUES (?, ?, ?, ?, ?, 0)')
      .run(t.id, String(name), declaredSize, String(mime || ''), '');
    const fileId = fileInfo.lastInsertRowid;
    const diskPath = path.join(transferFilesDir, String(fileId));
    db.prepare('UPDATE files SET disk_path = ? WHERE id = ?').run(diskPath, fileId);

    // preallocate the part file so chunks can be written at arbitrary offsets, in any order
    const partPath = diskPath + '.part';
    const fd = fs.openSync(partPath, 'w');
    if (declaredSize > 0) fs.ftruncateSync(fd, declaredSize);
    fs.closeSync(fd);

    const sessionInfo = db
      .prepare('INSERT INTO upload_sessions (file_id, chunk_size, total_chunks) VALUES (?, ?, ?)')
      .run(fileId, cs, totalChunks);

    res.status(201).json({ fileId, sessionId: sessionInfo.lastInsertRowid, chunkSize: cs, totalChunks });
  });

  app.get('/api/uploads/:sessionId/status', requireAuth, (req, res) => {
    const session = db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Not found' });
    const received = db
      .prepare('SELECT idx FROM upload_chunks WHERE session_id = ? ORDER BY idx ASC')
      .all(session.id)
      .map((r) => r.idx);
    const receivedSet = new Set(received);
    const missing = [];
    for (let i = 0; i < session.total_chunks; i++) if (!receivedSet.has(i)) missing.push(i);
    res.json({ sessionId: session.id, chunkSize: session.chunk_size, totalChunks: session.total_chunks, received, missing });
  });

  app.put(
    '/api/uploads/:sessionId/chunk/:idx',
    requireAuth,
    express.raw({ type: '*/*', limit: '6mb' }),
    (req, res) => {
      const session = db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(req.params.sessionId);
      if (!session) return res.status(404).json({ error: 'Not found' });
      const idx = Number(req.params.idx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= session.total_chunks) {
        return res.status(400).json({ error: 'Invalid chunk index' });
      }
      const file = db.prepare('SELECT * FROM files WHERE id = ?').get(session.file_id);
      if (!file) return res.status(404).json({ error: 'File not found' });
      if (file.upload_complete) return res.json({ ok: true, alreadyComplete: true });

      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const partPath = file.disk_path + '.part';
      const offset = idx * session.chunk_size;
      const fd = fs.openSync(partPath, 'r+');
      try {
        fs.writeSync(fd, buf, 0, buf.length, offset);
      } finally {
        fs.closeSync(fd);
      }
      db.prepare('INSERT OR IGNORE INTO upload_chunks (session_id, idx) VALUES (?, ?)').run(session.id, idx);

      const receivedCount = db.prepare('SELECT COUNT(*) AS n FROM upload_chunks WHERE session_id = ?').get(session.id).n;
      let complete = false;
      if (receivedCount >= session.total_chunks) {
        const stat = fs.statSync(partPath);
        if (stat.size === file.size_bytes) {
          fs.renameSync(partPath, file.disk_path);
          db.prepare('UPDATE files SET upload_complete = 1 WHERE id = ?').run(file.id);
          complete = true;
        }
      }
      res.json({ ok: true, received: receivedCount, totalChunks: session.total_chunks, complete });
    }
  );

  // ================= PUBLIC DOWNLOAD PAGE =================

  app.get('/api/public/t/:slug', (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE slug = ?').get(req.params.slug);
    if (!t || t.status === 'uploading' || t.status === 'deleted') return res.status(404).json({ error: 'Not found' });
    const expired = new Date(t.expires_at).getTime() <= Date.now();
    const limitHit = t.max_downloads != null && t.download_count >= t.max_downloads;
    if (t.status === 'expired' || expired || limitHit) {
      return res.status(410).json({ error: 'expired', expired: true });
    }
    if (t.password_hash) {
      return res.json({ password_required: true, slug: t.slug });
    }
    const files = db.prepare('SELECT id, name, size_bytes, mime FROM files WHERE transfer_id = ?').all(t.id);
    res.json({
      password_required: false,
      slug: t.slug,
      message: t.message,
      expires_at: t.expires_at,
      max_downloads: t.max_downloads,
      download_count: t.download_count,
      files,
      token: signToken(t.slug)
    });
  });

  app.post('/api/public/t/:slug/unlock', (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE slug = ?').get(req.params.slug);
    if (!t || t.status !== 'ready') return res.status(404).json({ error: 'Not found' });
    if (!isLive(t)) return res.status(410).json({ error: 'expired' });
    if (!t.password_hash) return res.status(400).json({ error: 'This transfer has no password' });
    const ok = bcrypt.compareSync(String(req.body?.password || ''), t.password_hash);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });
    const files = db.prepare('SELECT id, name, size_bytes, mime FROM files WHERE transfer_id = ?').all(t.id);
    res.json({
      slug: t.slug,
      message: t.message,
      expires_at: t.expires_at,
      max_downloads: t.max_downloads,
      download_count: t.download_count,
      files,
      token: signToken(t.slug)
    });
  });

  app.get('/dl/:slug/zip', (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE slug = ?').get(req.params.slug);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!verifyToken(req.query.token, t.slug)) return res.status(403).json({ error: 'Invalid or missing token' });
    const result = consumeDownload(t.id);
    if (!result.ok) return res.status(410).json({ error: result.reason });
    db.prepare('INSERT INTO downloads (transfer_id, file_id, ip, ua) VALUES (?, NULL, ?, ?)').run(t.id, req.ip, req.headers['user-agent'] || '');

    const files = db.prepare('SELECT * FROM files WHERE transfer_id = ?').all(t.id);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="transfer-${t.slug}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.warn('[zip] archive error:', err.message);
      if (!res.headersSent) res.status(500);
      res.end();
    });
    archive.pipe(res);
    for (const f of files) {
      if (fs.existsSync(f.disk_path)) archive.file(f.disk_path, { name: f.name });
    }
    archive.finalize();
  });

  app.get('/dl/:slug/:fileId', (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE slug = ?').get(req.params.slug);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!verifyToken(req.query.token, t.slug)) return res.status(403).json({ error: 'Invalid or missing token' });
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND transfer_id = ?').get(req.params.fileId, t.id);
    if (!file || !file.upload_complete) return res.status(404).json({ error: 'File not found' });

    const result = consumeDownload(t.id);
    if (!result.ok) return res.status(410).json({ error: result.reason });
    db.prepare('INSERT INTO downloads (transfer_id, file_id, ip, ua) VALUES (?, ?, ?, ?)').run(t.id, file.id, req.ip, req.headers['user-agent'] || '');

    res.set('Content-Type', file.mime || 'application/octet-stream');
    res.set('Content-Length', String(file.size_bytes));
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    fs.createReadStream(file.disk_path).pipe(res);
  });

  app.get('/preview/:slug/:fileId', (req, res) => {
    const t = db.prepare('SELECT * FROM transfers WHERE slug = ?').get(req.params.slug);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!verifyToken(req.query.token, t.slug)) return res.status(403).json({ error: 'Invalid or missing token' });
    if (!isLive(t)) return res.status(410).json({ error: 'expired' });
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND transfer_id = ?').get(req.params.fileId, t.id);
    if (!file || !file.upload_complete) return res.status(404).json({ error: 'File not found' });
    res.set('Content-Type', file.mime || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
    fs.createReadStream(file.disk_path).pipe(res);
  });

  // ================= SPA =================
  const distDir = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(['/', '/admin', '/admin/*', '/t/:slug'], (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  } else {
    app.get(['/', '/admin', '/admin/*', '/t/:slug'], (req, res) =>
      res.status(503).type('html').send('<h1>UI not built</h1><p>Run <code>npm run build</code> first.</p>')
    );
  }

  app.locals.db = db;
  app.locals.dataDir = dataDir;
  app.locals._runCleanupSweep = () => runCleanupSweep(db, dataDir);
  if (cleanupIntervalMs > 0 && !opts.noCleanupLoop) {
    app.locals._cleanupTimer = startCleanupLoop(db, dataDir, cleanupIntervalMs);
  }

  return app;
}

module.exports = { createApp };
