const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function nativeBindingPath() {
  // Under Electron the Node-ABI binding won't load; use the vendored Electron prebuild.
  if (!process.versions.electron) return null;
  const p = path.join(__dirname, '..', 'vendor', 'better_sqlite3-electron.node');
  return fs.existsSync(p) ? p : null;
}

function openDb(dataDir, dbPath) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
  const nativeBinding = nativeBindingPath();
  const file = dbPath || path.join(dataDir, 'app.db');
  const db = new Database(file, nativeBinding ? { nativeBinding } : {});
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      message TEXT DEFAULT '',
      password_hash TEXT,
      expires_at TEXT NOT NULL,
      max_downloads INTEGER,
      download_count INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'uploading', -- uploading | ready | expired | deleted
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      mime TEXT DEFAULT '',
      disk_path TEXT NOT NULL,
      upload_complete INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS upload_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      chunk_size INTEGER NOT NULL,
      total_chunks INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS upload_chunks (
      session_id INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, idx)
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id INTEGER NOT NULL,
      file_id INTEGER, -- NULL = zip-all
      ip TEXT,
      ua TEXT,
      downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id INTEGER NOT NULL,
      to_addr TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_files_transfer ON files(transfer_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_file ON upload_sessions(file_id);
    CREATE INDEX IF NOT EXISTS idx_downloads_transfer ON downloads(transfer_id);
  `);

  return db;
}

module.exports = { openDb };
