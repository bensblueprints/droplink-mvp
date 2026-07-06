# Launch Strategy — Droplink

## Target communities

- **r/selfhosted** — huge fit; angle as "another self-hosted alternative to add to your homelab," lead with the Docker Compose one-liner and the fact it's a single SQLite file + a files folder (easy backup story). Read the rules: no rehosted spam, be the OP, disclose you're the maker, engage in comments genuinely.
- **r/DataHoarder** — angle on ownership and no third-party retention of large files; emphasize resumable uploads for huge archives and no bandwidth/size caps like free-tier transfer services impose.
- **r/videography** — rules-aware, "show don't sell": post as "I built a thing to stop paying for WeTransfer Pro to send client cuts" with a screenshot of the download page, not a sales pitch; most video-focused subs ban outright self-promo so frame as a build-log / ask for feedback.
- **r/webdev / r/SideProject** — build-in-public angle: the resumable chunked upload engineering, the sha256-verified test suite, dual-mode (desktop + VPS) architecture.

## Hacker News "Show HN" draft

**Title:** Show HN: Droplink — a self-hosted, resumable file-transfer tool (one-time price)

**Body:**
I got tired of paying $12/mo for WeTransfer Pro just to send client video exports, so I built a self-hosted alternative.

Droplink does chunked, resumable uploads — client slices files into 5MB chunks, the server tracks which chunks it has, and a dropped connection or page refresh resumes exactly where it left off (verified with a sha256 check in the test suite, not just visually). Share links get an expiry, optional password, and optional download limit; recipients land on a clean download page with inline image/PDF previews and a "download all as ZIP" button.

It's Node + Express + SQLite + React, ships as both a desktop app (Electron, auto-logged-in) and a Docker Compose VPS deploy — one process, one SQLite file, a `files/` folder you can back up however you like. Source is MIT on GitHub.

Would love feedback on the resumable-upload implementation and what's missing for people who send large files regularly.

## SEO keywords (10)

1. wetransfer alternative self hosted
2. send large files own server
3. resumable file upload nodejs
4. self hosted file transfer tool
5. file transfer with expiry link
6. password protected file sharing self hosted
7. self hosted dropbox transfer alternative
8. big file sharing without subscription
9. chunked resumable upload open source
10. self hosted file drop

## AppSumo / PitchGround pitch paragraph

Droplink is a self-hosted, one-time-purchase alternative to WeTransfer Pro, Smash, and Dropbox Transfer — chunked resumable uploads (no size anxiety, survives dropped connections), expiring share links with password gates and download limits, inline previews, and a ZIP-all download, running entirely on the buyer's own server or desktop. Ships as Electron desktop app + Docker Compose VPS deploy from a single codebase, MIT-licensed, zero telemetry. Ideal for freelancers, agencies, and small studios who move large client files weekly and are tired of renting a progress bar.

## Pricing math

**Droplink: $29 one-time**

| Competitor | Monthly price | Annual cost | Droplink breakeven |
|---|---|---|---|
| WeTransfer Pro | $12/mo | $144/yr | **2.4 months** |
| Smash | $5/mo (starter paid tier) | $60/yr | **5.8 months** |
| Dropbox Transfer (bundled Plus) | $11.99/mo | $143.88/yr | **2.4 months** |
| Send Anywhere Plus | $6.99/mo | $83.88/yr | **4.1 months** |

At $29 once, Droplink pays for itself in under 3 months against the two largest competitors (WeTransfer Pro, Dropbox Transfer) and stays free forever after that — no recurring fee, no reason to ever cancel because you're not being billed.
