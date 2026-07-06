// Smoke test — boots the real server as a spawned child process (never kills anything
// else) against a throwaway DATA_DIR, and exercises the full chunked-upload + share-link
// lifecycle over real HTTP:
//   1. health/auth guard, login
//   2. create a transfer (password + max_downloads=2), upload a 12 MB fixture in 5 MB
//      chunks, deliberately skipping chunk 1 to prove resume works, finalize, verify the
//      assembled file on disk is byte-identical (sha256) to the source buffer
//   3. public metadata → password gate → unlock → download == sha256 match
//   4. download-limit enforcement (2 allowed, 3rd → 410)
//   5. expiry: a 1s-expiry transfer gets swept by the cleanup job (status→expired, file gone)
//   6. storage quota rejects an oversized declared upload
//   7. zip-all endpoint streams a real zip
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
// NOTE: the build plan's suggested test port 5432 collides with a locally running
// PostgreSQL instance on this machine (its default port) — using a high, unlikely-to
// -collide port instead so the smoke test doesn't fight a real Postgres service.
const PORT = 58432;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'droplink-test-'));

const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

let passed = 0;
function ok(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(150);
  }
  throw new Error('server did not become healthy in time');
}

let cookie = '';
async function api(pathname, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }
  const r = await fetch(BASE + pathname, { ...opts, headers, redirect: 'manual' });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return r;
}

let child;

async function main() {
  console.log('Smoke test: Droplink\n');

  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'test-pass-123',
      STORAGE_QUOTA_GB: '1',
      CLEANUP_INTERVAL_MS: '1000',
      BASE_URL: BASE
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  child.stdout.on('data', (d) => (serverLog += d.toString()));
  child.stderr.on('data', (d) => (serverLog += d.toString()));

  await waitForHealth();
  ok('server booted (spawned child, isolated DATA_DIR)');

  // ---- auth ----
  let r = await api('/api/transfers');
  assert.strictEqual(r.status, 401, 'transfers API requires auth');
  ok('unauthenticated API access rejected (401)');

  r = await api('/api/login', { method: 'POST', json: { password: 'wrong' } });
  assert.strictEqual(r.status, 401);
  ok('wrong password rejected');

  r = await api('/api/login', { method: 'POST', json: { password: 'test-pass-123' } });
  assert.strictEqual(r.status, 200);
  ok('login succeeds, session cookie set');

  // ---- create main transfer: password + max_downloads=2, expiry 1 day ----
  r = await api('/api/transfers', {
    method: 'POST',
    json: { expiryDays: 1, password: 'secret', maxDownloads: 2, message: 'Here are the files!' }
  });
  assert.strictEqual(r.status, 201);
  const transfer = await r.json();
  assert.ok(transfer.slug && transfer.slug.length === 10);
  ok('transfer created with slug + password + download limit');

  // ---- chunked resumable upload: 12 MB fixture, 5 MB chunks ----
  const chunkSize = 5 * 1024 * 1024;
  const fixture = crypto.randomBytes(12 * 1024 * 1024);
  const fixtureHash = sha256(fixture);

  r = await api(`/api/transfers/${transfer.id}/files`, {
    method: 'POST',
    json: { name: 'big-file.bin', size: fixture.length, mime: 'application/octet-stream', chunkSize }
  });
  assert.strictEqual(r.status, 201);
  const session = await r.json();
  assert.strictEqual(session.totalChunks, 3);
  ok('upload session created (3 chunks expected for 12MB @ 5MB)');

  function chunkBytes(idx) {
    const start = idx * chunkSize;
    return fixture.subarray(start, Math.min(start + chunkSize, fixture.length));
  }

  // upload chunk 0 and 2, DELIBERATELY skip chunk 1
  for (const idx of [0, 2]) {
    r = await api(`/api/uploads/${session.sessionId}/chunk/${idx}`, {
      method: 'PUT',
      body: chunkBytes(idx),
      headers: { 'Content-Type': 'application/octet-stream' }
    });
    assert.strictEqual(r.status, 200, `chunk ${idx} upload`);
  }
  ok('uploaded chunks 0 and 2, skipped chunk 1');

  r = await api(`/api/uploads/${session.sessionId}/status`);
  const status1 = await r.json();
  assert.deepStrictEqual(status1.missing, [1], 'server must report chunk 1 as missing');
  ok('resume status correctly reports missing chunk [1]');

  // now upload the missing chunk to resume/complete
  r = await api(`/api/uploads/${session.sessionId}/chunk/1`, {
    method: 'PUT',
    body: chunkBytes(1),
    headers: { 'Content-Type': 'application/octet-stream' }
  });
  assert.strictEqual(r.status, 200);
  const chunk1Result = await r.json();
  assert.strictEqual(chunk1Result.complete, true);
  ok('uploaded missing chunk 1 — resume completed the file');

  r = await api(`/api/uploads/${session.sessionId}/status`);
  const status2 = await r.json();
  assert.deepStrictEqual(status2.missing, []);
  ok('status now reports zero missing chunks');

  // finalize the transfer
  r = await api(`/api/transfers/${transfer.id}/finalize`, { method: 'POST' });
  assert.strictEqual(r.status, 200);
  const finalized = await r.json();
  assert.strictEqual(finalized.status, 'ready');
  ok('transfer finalized → status ready');

  // verify assembled file on disk: byte length + sha256 match the source buffer
  const diskPath = path.join(dataDir, 'files', String(transfer.id), String(finalized.files[0].id));
  const onDisk = fs.readFileSync(diskPath);
  assert.strictEqual(onDisk.length, fixture.length);
  assert.strictEqual(sha256(onDisk), fixtureHash);
  ok('assembled file on disk is byte-identical to source (sha256 match)');

  // ---- public download page ----
  cookie = ''; // simulate an anonymous recipient
  r = await api(`/api/public/t/${transfer.slug}`);
  assert.strictEqual(r.status, 200);
  let meta = await r.json();
  assert.strictEqual(meta.password_required, true);
  ok('public metadata reports password_required for password-protected transfer');

  r = await api(`/api/public/t/${transfer.slug}/unlock`, { method: 'POST', json: { password: 'wrong-guess' } });
  assert.strictEqual(r.status, 401);
  ok('wrong password on public unlock rejected');

  r = await api(`/api/public/t/${transfer.slug}/unlock`, { method: 'POST', json: { password: 'secret' } });
  assert.strictEqual(r.status, 200);
  meta = await r.json();
  assert.ok(meta.token);
  ok('correct password unlocks and issues a download token');

  const fileId = meta.files[0].id;

  // download #1
  r = await api(`/dl/${transfer.slug}/${fileId}?token=${meta.token}`);
  assert.strictEqual(r.status, 200);
  const dl1 = Buffer.from(await r.arrayBuffer());
  assert.strictEqual(sha256(dl1), fixtureHash);
  ok('download #1 streams bytes matching sha256 of the source fixture');

  // download #2 (hits max_downloads=2)
  r = await api(`/dl/${transfer.slug}/${fileId}?token=${meta.token}`);
  assert.strictEqual(r.status, 200);
  ok('download #2 allowed (at limit)');

  // download #3 → 410
  r = await api(`/dl/${transfer.slug}/${fileId}?token=${meta.token}`);
  assert.strictEqual(r.status, 410);
  ok('download #3 rejected — 410 (download limit reached)');

  // ---- expiry sweep ----
  cookie = '';
  r = await api('/api/login', { method: 'POST', json: { password: 'test-pass-123' } });
  assert.strictEqual(r.status, 200);

  r = await api('/api/transfers', {
    method: 'POST',
    json: { expiresAt: new Date(Date.now() + 1000).toISOString(), message: 'Expires soon' }
  });
  const expTransfer = await r.json();

  r = await api(`/api/transfers/${expTransfer.id}/files`, {
    method: 'POST',
    json: { name: 'tiny.png', size: ONE_PX_PNG.length, mime: 'image/png', chunkSize }
  });
  const expSession = await r.json();
  r = await api(`/api/uploads/${expSession.sessionId}/chunk/0`, {
    method: 'PUT',
    body: ONE_PX_PNG,
    headers: { 'Content-Type': 'image/png' }
  });
  assert.strictEqual(r.status, 200);
  r = await api(`/api/transfers/${expTransfer.id}/finalize`, { method: 'POST' });
  const expFinalized = await r.json();
  const expDiskPath = path.join(dataDir, 'files', String(expTransfer.id), String(expFinalized.files[0].id));
  assert.ok(fs.existsSync(expDiskPath), 'file exists on disk before expiry');
  ok('short-lived transfer created and finalized (expires in 1s)');

  await sleep(3200); // cleanup loop runs every 1000ms in this test env

  r = await api(`/api/transfers/${expTransfer.id}`);
  const expChecked = await r.json();
  assert.strictEqual(expChecked.status, 'expired', 'cleanup sweep must flip status to expired');
  assert.ok(!fs.existsSync(expDiskPath), 'cleanup sweep must delete the file from disk');
  ok('cleanup sweep expired the transfer: DB status → expired, file removed from disk');

  // ---- storage quota ----
  r = await api(`/api/transfers/${transfer.id}/files`, {
    method: 'POST',
    json: { name: 'huge.bin', size: 2 * 1024 * 1024 * 1024, mime: 'application/octet-stream', chunkSize }
  });
  assert.strictEqual(r.status, 413, 'declaring a 2GB file against a 1GB quota must be rejected');
  ok('storage quota rejects an oversized declared upload (413)');

  // ---- zip-all ----
  r = await api('/api/transfers', { method: 'POST', json: { expiryDays: 1, message: 'Zip test' } });
  const zipTransfer = await r.json();
  r = await api(`/api/transfers/${zipTransfer.id}/files`, {
    method: 'POST',
    json: { name: 'photo.png', size: ONE_PX_PNG.length, mime: 'image/png', chunkSize }
  });
  const zipSession = await r.json();
  await api(`/api/uploads/${zipSession.sessionId}/chunk/0`, {
    method: 'PUT',
    body: ONE_PX_PNG,
    headers: { 'Content-Type': 'image/png' }
  });
  r = await api(`/api/transfers/${zipTransfer.id}/finalize`, { method: 'POST' });
  const zipFinalized = await r.json();
  assert.strictEqual(zipFinalized.status, 'ready');

  cookie = '';
  r = await api(`/api/public/t/${zipTransfer.slug}`);
  const zipMeta = await r.json();
  assert.strictEqual(zipMeta.password_required, false);
  assert.ok(zipMeta.token);

  r = await api(`/dl/${zipTransfer.slug}/zip?token=${zipMeta.token}`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /zip/);
  const zipBytes = Buffer.from(await r.arrayBuffer());
  assert.ok(zipBytes.length > 50, 'zip archive should have non-trivial length');
  ok('zip-all endpoint streams a real zip archive');

  console.log(`\n${passed} checks passed. Droplink smoke test PASSED.\n`);
}

main()
  .catch((err) => {
    console.error('\nSMOKE TEST FAILED:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      if (child && !child.killed) child.kill(); // only ever kill the PID this test spawned
    } catch {}
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  });
