# Product Hunt Launch Kit — Droplink

## Name
Droplink

## Tagline (60 chars max)
Send big files from your own server. Pay once. (58)

## Description (260 chars max)
Self-hosted WeTransfer alternative: chunked resumable uploads, expiring share links, password gates, and download limits — all on your own $5 VPS or desktop. No subscription, no size games, no third-party storing your files. (231)

## Full description

Droplink is a self-hosted big-file transfer tool. Drag a file (or ten) into the dashboard, set an expiry, an optional password, an optional download limit, and get a clean share link back — `/t/abc123xyz` — that your recipient opens to a branded download page with inline previews for images and PDFs, a "download all as ZIP" button, and a live expiry countdown.

Uploads are chunked (5MB pieces) and genuinely resumable: refresh mid-upload, come back later, and it picks up exactly where it left off — the server tells the client which chunks it's still missing. Nothing is ever buffered fully in RAM; chunks stream straight to disk, so a 50GB file is as safe to upload as a 5MB one.

Everything lives in one SQLite file plus a `files/` folder you control. Run it as a desktop app for solo use, or `docker compose up` on a VPS when you need a public link. Email the link straight from the dashboard using your own SMTP creds — no vendor lock-in, no "upgrade to send this."

**Why I built this:** I send client video files and design exports every week. WeTransfer wanted $12/mo, Dropbox Transfer bundled it into an $11.99/mo plan I didn't otherwise need, and free-tier transfer sites cap file size and expire links faster than I'd like — all while sitting on top of *my* files. Droplink is the same workflow, minus the rent.

## Maker's first comment

Hey Hunters 👋

I send client video files and design exports every week, and I got tired of paying $12/mo for what's basically a progress bar and a temporary S3 bucket. So I built Droplink — a self-hosted file transfer tool with the same UX (drag file → link → password/expiry → send) but the files live on my own box.

The engineering bit I'm proudest of: uploads are genuinely resumable. Kill your wifi mid-upload of a 40GB file, come back an hour later, and it resumes from the exact chunk it left off on — verified with a sha256 check in the test suite, not just "seems to work."

It's a one-time purchase (or free if you're comfortable with `npm i && npm start` / Docker) — no subscription, ever. Would love feedback, especially on the resumable-upload UX and what other "own it forever" file-transfer features you'd want.

## Gallery shot list (5 shots)

1. **Dashboard drag-drop hero** — dark mode dashboard, file mid-drag over the drop zone with the hover-glow border active, storage quota bar visible.
2. **Upload in progress** — 3 files queued with individual chunked-upload progress bars at different %, one paused/retrying to show resilience.
3. **Settings panel close-up** — expiry days / password / max downloads / message fields, showing the "own your terms" flexibility vs a fixed-expiry competitor.
4. **Public download page** — recipient's view: file cards with an image preview thumbnail, expiry countdown badge, big "Download all as ZIP" button.
5. **Password gate + admin download log** — split shot: the lock-screen a recipient sees, next to the admin's download event log (timestamp + IP) proving full visibility into who grabbed the file.
