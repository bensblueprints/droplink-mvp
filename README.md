# 💧 Droplink

## Demo



https://github.com/user-attachments/assets/d1259f48-7079-4abf-8909-ddbb0ba04f2f



[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Send big files from your own server. Pay once. Own it forever. No subscription.**

A self-hosted big-file transfer tool — everything WeTransfer Pro charges $12/month for, running on your own $5 VPS (or your desktop): chunked resumable uploads with no practical size limit, expiring share links with password gates and download limits, and a clean download page for your recipients. Your files never touch a third party's storage.

![Screenshot](docs/screenshot.png)

## ☕ Skip the setup — get the 1-click installer

Don't want to touch a terminal? Grab the packaged installer (Windows desktop app + guided VPS deploy) here:

**→ [https://whop.com/onetime-suite](https://whop.com/onetime-suite)** — one-time purchase, lifetime updates.

## Features

- **Chunked, resumable uploads** — files are sliced into 5MB chunks client-side, uploaded sequentially with per-chunk retry (3 attempts, exponential backoff). Refresh mid-upload or lose your connection: the server tracks exactly which chunks it already has, so the client resumes instead of restarting. Chunks stream straight to disk — nothing is ever buffered fully in RAM, so a 50GB file is as safe as a 5MB one.
- **Transfers with real terms** — expiry (custom datetime, default 7 days), optional bcrypt-hashed password, optional max-download count, optional message to the recipient.
- **Clean share links** — `/t/:slug` (10-char random slug): file list with sizes, sender message, live expiry countdown, password gate if set, inline preview for images and PDFs, "Download all as ZIP" (streamed, never buffered) plus per-file download.
- **Email the link** — compose recipients + a note straight from the transfer page using your own SMTP creds (BYO SMTP via nodemailer). No SMTP configured? The feature no-ops with a clear warning banner instead of crashing.
- **Auto-cleanup** — an in-process sweep runs every 5 minutes, deleting expired or download-limit-hit transfers (DB rows *and* files on disk) and sweeping orphaned upload sessions older than 24h.
- **Storage quota** — set `STORAGE_QUOTA_GB` (default 10); the dashboard shows a used/free bar, and uploads that would exceed quota are rejected up front with a clear error — not halfway through the upload.
- **Admin dashboard** — every transfer with files, size, downloads/limit, expiry, one-click link copy, and a full download event log (timestamp + IP).
- **100% local & private** — one SQLite file + a `files/` folder, no telemetry, no external services except the SMTP server you configure yourself.

## Quick start

```bash
npm i
npm run build   # builds the admin + public UI
npm start       # → http://localhost:5332
```

- **Admin dashboard:** `http://localhost:5332/admin` (default password `admin` — change via `ADMIN_PASSWORD`)
- **Public download links:** `http://localhost:5332/t/:slug`

### Desktop mode

Run it as a desktop app, or deploy to a $5 VPS when you need it public:

```bash
npm run desktop   # Electron window, auto-logged-in, data stored per-user
```

`npm run dist` packages a Windows installer (NSIS) via electron-builder.

### Docker (VPS deploy)

```bash
cp .env.example .env   # set ADMIN_PASSWORD, STORAGE_QUOTA_GB, SMTP_* as needed
docker compose up -d   # persists SQLite + uploaded files in a named volume
```

Point your domain at the box, put Caddy/nginx/Traefik in front for TLS, done.

## Droplink vs WeTransfer / Smash / Dropbox Transfer

| | Droplink | WeTransfer Pro | Smash | Dropbox Transfer |
|---|---|---|---|---|
| Price | **$29 once** | $12/mo ($144/yr) | $5/mo ($60/yr) | $11.99/mo (bundled) |
| File size limit | None (your disk) | 200GB (Pro) | Unlimited (paid) | 250GB (bundled) |
| Resumable uploads | ✅ | ❌ | ❌ | ❌ |
| Your own server | ✅ | ❌ | ❌ | ❌ |
| Password-protected links | ✅ | ✅ (Pro) | ✅ | ✅ |
| Download limits | ✅ | ❌ | ❌ | ❌ |
| Own SMTP for emailing links | ✅ | ❌ | ❌ | ❌ |
| Telemetry / third-party storage | None | Yes | Yes | Yes |
| Ongoing cost after year 1 | **$0** | $144+/yr | $60+/yr | $143.88+/yr |

At $29 once, Droplink pays for itself in under 3 months versus WeTransfer Pro or Dropbox Transfer — and stays free forever after that.

## Tech stack

Node 20+ · Express · better-sqlite3 · React (Vite) · Tailwind CSS v4 · Lucide icons · Framer Motion · nodemailer · archiver · Electron (desktop mode)

## Architecture

Single Express process serves the API and the built React SPA. SQLite (WAL mode) holds transfers, files, upload sessions/chunks, downloads, and email logs. Uploaded chunks are written directly to a preallocated file at `idx * chunkSize` byte offsets, so out-of-order or resumed chunks are trivial — no in-memory buffering, no reassembly step beyond a final size check and rename. Desktop mode (`npm run desktop`) boots the identical server on a free local port with data in Electron's `userData` directory, auto-logged-in via a one-time token. See `plans/file-transfer.md` in the parent repo for the full build plan this implements.

## Configuration

See [`.env.example`](.env.example) for every environment variable (port, admin password, data/db paths, storage quota, base URL, SMTP).

## Verification

- `npm i && npm run build && npm start` boots cleanly.
- `npm test` runs `test/smoke.js` — a full end-to-end test against a spawned server process: creates a transfer, uploads a 12MB fixture in 5MB chunks while **deliberately skipping a chunk to prove the resume/status endpoint reports it correctly**, re-uploads it, finalizes, and verifies the assembled file on disk is byte-identical (sha256) to the source. It also exercises the password gate, download-limit enforcement (410 on the 3rd attempt), the cleanup sweep expiring a short-lived transfer (DB status flips, file removed from disk), the storage-quota rejection, and the ZIP-all endpoint.

## License

MIT © 2026 Ben (bensblueprints)
