# Marketing Asset Library — Backend Build Blueprint

**Status:** Phases 1–2 are built (staff admin + storage). **Update 30 Oct 2026:** the client website, and the public API for it, are postponed to their own project; the backend is now staff-only (no anonymous file or API access). Sections about the public API below describe that later work.
**Prepared:** 30 October 2026 (Malaysia time).
**Scope:** the **backend project only**: the staff admin panel where designers and marketers upload and manage client-facing images, videos and documents, plus the API that serves them. The client website (where clients browse and view) is a **separate project, built later**, and only talks to this backend through the public API in section 8.
**Reference:** the existing M2 Material Library backend (`Moon-Library-Backend`, repo `m2-my-api`).
**Replaces:** `MARKETING_ASSET_BACKEND_BLUEPRINT.md` (Codex) and `design-library-blueprint.md` (Claude). This file combines both.

---

## 1. Confirmed brief

| Decision | Requirement |
| --- | --- |
| Project boundary | A fully separate marketing library with its own code, deployment, database and file storage. The M2 library stays untouched. |
| Uploaders | Company designers and marketers sign in to a staff admin panel and upload files. Clients never upload. |
| File scope | Images, videos and documents. Audio and arbitrary files are out of scope for the first release. |
| Publication | A new asset becomes visible to clients as soon as its upload passes the server's checks. No approval step in the first release. |
| Client website | A separate frontend project, built later. This backend must provide a documented, stable public API for it and must not depend on it. |

**Working assumptions (confirm before building):**
- The future client gallery can be read without a client login.
- "Visible immediately" means *after* the server has verified the finished upload. A partly uploaded file must never appear.
- Product name, domains, allowed formats, size limits, languages and retention periods are still open, so they must all live in configuration.

---

## 2. What the sample already gives us

The M2 library is a solid base. These features already work and are worth keeping:

| Area | Already built |
| --- | --- |
| Uploads | Images, videos, documents (PDF, Word, Excel, PowerPoint, Keynote, TXT, CSV, RTF), PSD/AI as "other". Single upload up to 20 MB, 10 MB multipart chunks above that. |
| Organisation | Nested folders with custom icons and colours; hide a folder (and everything inside) from the library. |
| Cards | A card groups files by language (EN, BM, 简体, 繁体, TA, BN, VI, TH); scheduled publish / hide dates. |
| History | Replacing a file keeps the old one in version history; Trash with 90-day retention; Undo from the activity log. |
| Productivity | Copy / paste / duplicate for folders and files (Ctrl/⌘+C/V/D), mobile selection, filters by type / language / status / date. |
| Accounts | Owner / Editor / Viewer roles enforced on the server; sessions; account lockout; full activity and security log. |
| Public API | Library JSON, file serving with Range, ZIP download, localised download filenames (used by the M2 site; to be reworked for the new client frontend, see sections 8 and 10). |
| Operations | Optional Google Drive backup, admin changelog page, pytest suite with MySQL + moto S3 + fake Drive. |

The backend and its admin panel are self-contained in `Moon-Library-Backend`, so they can be lifted out with little untangling.

---

## 3. Recommended system shape

```text
┌─────────────── THIS PROJECT (backend) ───────────────┐
Designer / marketer → staff admin (React) → Flask API → marketing MySQL database
                                                  └───→ private marketing R2 bucket
                              public catalog API + media hostname
└──────────────────────────────────────────────────────┘
                                   ▲
Client → client website (SEPARATE frontend project, later)

Required: scheduled MySQL backup + a tested restore procedure
Optional: scheduled file backup → separate Google Drive folder
```

- **Separate everything:** new repository, hostnames, Gunicorn service and port, MySQL database and user, R2 bucket and bucket-scoped token, secret key, setup key and session cookie name. The M2 folder is a reference, never a production dependency.
- **Private bucket:** return stable asset IDs and media URLs to clients, never raw storage keys. Serve media only after checking the asset is ready, published, in a visible folder and not deleted.
- **Separate media hostname** from the staff admin. Safe image/video previews inline; documents and anything active as downloads. Short public cache so withdrawals take effect; if a CDN is added, its purge must be part of the withdrawal flow.
- **Staff API stays same-origin** with the admin panel. The future frontend reads the public catalog server-side or from an explicitly allowed origin. Never allow credentialed cross-origin access to staff endpoints.
- **Analytics and Drive backup off** in the first release unless specifically needed. MySQL backup is required regardless.

### Repository layout

This backend is its own repository with **fresh git history** (a selective copy, not a fork of `m2-my-api`):

```
marketing-library-api/
├── app/          ← Flask API (auth, staff API, public API, media routes, services)
├── admin/        ← staff admin panel (React + TypeScript + Vite), built and served by Flask
├── migrations/   ← fresh initial migration
├── deploy/       ← Gunicorn, nginx, systemd, cron templates (renamed)
├── tests/
└── docs/         ← this blueprint + the public API reference for the frontend team
```

The client website lives in its **own repository** (e.g. `marketing-library-web`) and is out of scope here.

---

## 4. Features for the first release

| Area | Behaviour |
| --- | --- |
| Accounts | First Owner setup, login / logout, password change, active session management. Owner creates and manages staff accounts. |
| Roles | **Owner:** everything, including users, settings, permanent purge. **Editor:** create, upload, edit, replace, organise, hide, restore. **Viewer:** see the admin library and reports without changing anything. Enforced on the server. |
| Organisation | Nested collections / folders with title, optional description, cover, order and hidden state. Upload single files or whole folders. |
| Asset cards | One card holds an image, video or document and its replacement history: title, description / alt text, category, uploader, dates, file type, dimensions / duration, publication state. |
| Tags | Free tags plus a few fixed fields: **campaign, platform, size (e.g. 1080×1350), brand**. Searchable and filterable. Marketers search "CNY 2027 IG 4:5", not a folder path. |
| Upload experience | Multiple files, progress, retry, clear errors, duplicate-name handling, image / video preview. Keep the original plus a safe preview / thumbnail. |
| Publishing | New card is live by default but enters the public catalog only after validation. Editors can hide or delete it afterwards. |
| Versions and Trash | Replacement creates a fresh storage key and an auditable prior version. Soft delete with restore; permanent deletion follows a configured retention period. |
| Client catalog | Visible collections and published assets; search, pagination, filters by collection / type / tag / date. Asset detail gives safe preview and download links. |
| Downloads | Originals with a safe filename and attachment header; HTTP Range for video. ZIP only if the frontend needs it. |
| Reporting | Staff activity and storage usage. Public view / download tracking is added with the frontend, since the frontend has to send those events. |

**Trim from the sample:** audio, banners, rich analytics, and the eight-language variants **unless** the team uploads the same artwork in several languages. If not, one file per card is simpler.

---

## 5. Designer and marketer features (after the first release)

These make it feel built for the department rather than a generic file store.

| Priority | Feature | Why |
| --- | --- | --- |
| High | **PSD / AI previews** (rendered thumbnails) and **Figma links** on a card | These are designers' main files; today PSD/AI are "other" with no thumbnail (`admin/src/lib/upload-client.ts:221`). |
| High | **Comments on a card** | Feedback stays next to the file instead of in WhatsApp. |
| Medium | **Optional review status** (Draft → In review → Approved) as a per-folder setting | Not in the confirmed brief, but useful later for campaigns that need sign-off. Default off, so the "live immediately" rule still holds. |
| Medium | **Request board:** marketer asks, designer delivers straight into a card | Connects the two teams' work. |
| Medium | **Bulk edit** of tags / campaign / folder for many cards | Campaign launches involve dozens of files at once. |
| Low | **Collections to share** (a curated set across folders with one link) | Handy for agencies and partners. |

---

## 6. Source modules: reuse, adapt or drop

Paths refer to `Moon-Library-Backend`. Treat this as a **selective fork** with a fresh empty database and a new migration history.

| Source | Decision | Notes |
| --- | --- | --- |
| `app/__init__.py`, `wsgi.py` | Reuse | Remove M2-specific redirects / routes and analytics mounting unless needed. |
| `app/config.py`, `.env.example` | Adapt | Replace every M2 default (`m2library`, `m2-library`, see `app/config.py:48–84`). Add startup checks that refuse the known M2 database and bucket. Note that `DATABASE_URL` overrides `DB_*` (`app/config.py:39–41`). |
| `app/db.py`, `app/models.py`, `migrations/` | Adapt | Keep the folder → item → file model, users, sessions, versions, audit log. **New initial migration**; add tags, upload intents and new fields. Do not import M2 data. |
| `app/auth.py`, `app/blueprints/auth_api.py` | Adapt | Change the `m2_session` cookie name (`app/auth.py:33`) and branding; add an always-on login rate limit. |
| `app/blueprints/admin_api.py`, `app/services/admin_ops.py` | Adapt | Keep staff operations and multipart upload; add type / size verification, upload intents and safe finalisation. |
| `app/storage.py` | Reuse | R2/S3 streaming, multipart, HEAD, delete — with a separate bucket and credentials. |
| `app/services/library.py` | Adapt | Keep visibility rules; make the catalog paginated and remove raw R2 keys. |
| `app/blueprints/public_api.py` | Rewrite | Keep Range and ZIP logic; replace raw-key `/f/<key>` with asset-ID-based, publication-checked media routes. |
| `app/services/activity.py`, `app/services/manage_ops.py` | Reuse | Audit, undo, staff management, reports. Make retention configurable and run cleanup on a schedule. |
| `admin/` | Adapt | React + TypeScript + Vite admin: file picker, previews, navigation. Rebrand (≈25 files mention M2, e.g. `admin/src/lib/strings.ts`) and drop irrelevant features. This is the **staff admin**, not the client site. |
| `app/drive/` | Optional | Needs its own Drive folder and service account if enabled. |
| `analytics/`, `analytics-admin/`, analytics migrations / tests | Drop for now | Add back later with its own database, secret, cookie and retention decision. |
| `app/d1_import.py`, `flask d1` commands, `tests/test_d1_import.py`, `docs/MIGRATION-NOTES.md` | Drop | Only for the old Cloudflare D1 migration. |
| `deploy/`, `tests/` | Adapt | Rename services, domains, paths, ports and cron locks. Never run the tests against a business database. |

---

## 7. Data model

Keep the internal `folders`, `items`, `files`, `file_versions`, `users`, `sessions`, `audit_log` and `settings` tables. The public API can call items **assets** even if the table names stay.

| Entity | Fields |
| --- | --- |
| Folder / collection | ID, parent, slug, name (plain or translated), description, cover, sort order, hidden / deleted state. |
| Item / asset | ID, folder, title, description, alt text, campaign, platform, brand, author, timestamps, live / draft state, optional scheduled dates, deleted state. |
| Tag *(new)* | ID, name, slug; `item_tags` join table. |
| File | ID, item, original filename, **declared and verified** MIME type, kind, actual byte size, dimensions / duration, immutable R2 keys, upload state, timestamps. |
| File version | Prior file metadata and R2 keys, replacement reason / date / actor, retention deadline. |
| Upload intent *(new)* | File ID, creator, allowed key(s), expected type, maximum size, expiry, state. Authorises writes only while the file is uploading; can never overwrite a ready object. |
| Comment *(phase 2)* | ID, item, author, body, timestamps, resolved flag. |
| Users / sessions / audit | Separate marketing accounts, server-side roles, revocable sessions, change log. |
| Optional | Usage counts and Drive backup state, only when those features are on. |

Rules:
- Use a **fresh key for every original and derivative**, including replacements.
- Keep human filenames in MySQL and in `Content-Disposition`, never as authorisation.
- A file moves from `uploading` to `ready` only after validation. Failed or expired uploads stay out of the catalog and are cleaned up.

---

## 8. Public API for the client frontend project

This is the **contract between the two projects**. The frontend team builds against it; nothing else in this backend is exposed to clients. Publish it as `docs/PUBLIC_API.md` (or an OpenAPI file) and version it (`/api/public/v1/…`) so the backend can change without breaking the client site.

Keep the existing staff API operation names so the reused admin keeps working, and document their request / response shapes. Proposed public API:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/public/v1/collections` | Visible collection tree: names, cover URLs, counts. |
| `GET /api/public/v1/assets?collection=&type=&tag=&q=&page=&page_size=` | Paginated published assets, stable order, explicit pagination metadata. |
| `GET /api/public/v1/assets/{asset_id}` | One published asset: metadata, available formats, safe media links. |
| `GET /media/{file_id}/preview` | Inline safe preview on the media hostname, after checking publication. |
| `GET /media/{file_id}/download` | Original as an attachment, with Range support. |
| `POST /api/public/v1/track` | Later: validate asset IDs, rate-limit, count agreed events. |

- **Include:** stable IDs, title, description / alt text, collection, tags, kind, dimensions / duration, publish date, generated preview / download URLs.
- **Exclude:** staff data, upload intents, unpublished assets, raw R2 keys.
- Return `404` for hidden, deleted, expired or unfinished media. Consistent JSON errors; document time units and pagination limits.
- Today `GET /api/library` returns the whole library in one response, and `GET /f/<key>` only checks a key prefix and that the object exists (`app/blueprints/public_api.py:95–98`). Neither should be copied unchanged.

---

## 9. Upload and publication flow

1. An Editor or Owner creates or selects an item, then requests an **upload intent** with filename, kind, declared MIME and size.
2. The server checks allowed types and configured per-file and per-account limits, allocates **new** R2 key(s), and records an `uploading` file and an expiring intent. Ready keys are never writable through an intent.
3. The browser prepares a thumbnail or video poster where possible and uploads the original and derivatives (keep the current 20 MB single upload / 10 MB chunks at first).
4. **Finalisation:** HEAD-check every required object, check the real total size and file signature (and decode media where relevant), match the intent, and scan documents if required. Browser-supplied MIME, dimensions and thumbnails are hints, not proof.
5. Mark the file ready and the item published in one transaction, write an audit entry, and return the public asset ID. The catalog shows it immediately.
6. A failed or interrupted upload stays invisible. A scheduled job expires stale intents and rows, removes unused objects and aborts stale multipart uploads.

**Provisional format policy (refine with the team):**

| Kind | Allowed | Notes |
| --- | --- | --- |
| Images | JPEG, PNG, WebP, GIF | HEIC needs conversion before browser previews are promised. |
| Video | MP4, WebM | MOV needs conversion before browser previews are promised. |
| Documents | PDF, DOCX, PPTX, XLSX | Always served as downloads. |
| Design sources | PSD, AI *(phase 2)* | Download only, with a generated raster preview. |
| Rejected | HTML, executables, raw SVG | SVG only as an attachment with a generated raster preview, if needed at all. |

Per-type size and pixel / dimension caps must be configurable before launch.

---

## 10. Must-fix issues found in the M2 reference

All verified against the current code.

| When | Issue | Evidence | Fix |
| --- | --- | --- | --- |
| Before launch | **Uploaded files can run code on the admin site.** The browser-reported file type is stored as-is and `/f/<key>` serves it inline on the admin domain, with only `nosniff` set. A hidden-script SVG or a spoofed HTML file opened by an Owner could act as that Owner. | `app/services/admin_ops.py:1002`, `app/blueprints/public_api.py:95–124`, `app/__init__.py:59` | Server-side type checks, separate media hostname, `Content-Security-Policy: sandbox` on media responses, documents as attachments. |
| Before launch | **Hiding doesn't stop direct links.** Draft / hidden items are filtered from the JSON, but `/f/<key>` still serves the file, with a one-year immutable cache. | `app/services/library.py`, `app/blueprints/public_api.py:100` | Private R2, status-checked media routes by ID, withdrawal-aware cache policy. |
| Before launch | **A ready file can be overwritten.** `check_key` accepts any key referenced by an existing file, not just one still uploading; `file.ready` only checks that the original exists; the ~96 MB cap is per HTTP request. | `app/services/admin_ops.py:980–987`, `app/config.py:122` | Writes bound to expiring upload intents; verify final objects and total size. |
| Before launch | **M2 defaults could leak into the new project.** M2 database / bucket defaults and the fixed `m2_session` cookie. | `app/config.py:48–84`, `app/auth.py:33`, `.env.example`, `deploy/` | New defaults; refuse to start on known M2 values. |
| Before launch | **Login rate limit is optional.** The per-IP slowdown only runs when the optional lockout setting is on. | `app/blueprints/auth_api.py:98–103` | Always-on IP rate limit, separate from account lockout. |
| Before launch | **No database backup.** Google Drive backup copies file originals only; it can't rebuild folders, accounts or publication state. | `app/drive/backup.py` | Scheduled MySQL backup and a practised restore. |
| Soon after | **Cleanup runs only when someone opens the admin**, and interrupted uploads leave rows / parts behind. | `app/services/activity.py` | Scheduled cleanup job and an R2 multipart lifecycle rule. |
| When traffic grows | **Flask relays every upload and media byte.** | `app/blueprints/admin_api.py`, `public_api.py` | Direct-to-R2 uploads with short-lived signed URLs; CDN for previews. Keep server-side finalisation; never expose R2 credentials. |

Also decide: scan documents before publishing? Strip EXIF / location data from photos? Rate-limit anonymous tracking?

References: [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [Cloudflare R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

---

## 11. Branding and languages

- **Branding from configuration:** product name, logo, colours and favicon set once in `.env` (served to the admin at runtime), instead of hard-coded in ~25 files. The same codebase could then run more departments' libraries later.
- **Languages:** the sample supports EN, BM, 简体, 繁体, TA, BN, VI and TH (`app/langs.py:9`, mirrored in `admin/src/lib/langs.ts`). Keep only what the team uses, and keep both lists in step.

---

## 12. Dependencies and services

| Category | Required | Optional |
| --- | --- | --- |
| Backend | Python 3.11+, Flask, Gunicorn, SQLAlchemy, PyMySQL, Alembic / Flask-Migrate | `requests`, `PyJWT` for Drive backup |
| Storage | MySQL 8 (dedicated database and user), private Cloudflare R2 bucket with scoped credentials, `boto3` | Media CDN once cache / withdrawal rules are proven |
| Staff admin | Node.js 20+, React, TypeScript, Vite, served by Flask | Extra UI libraries only when needed |
| Previews | Pillow (images) | `psd-tools` (PSD), Ghostscript / ImageMagick (AI, PDF), ffmpeg (video posters) — phase 2 |
| Operations | HTTPS reverse proxy (nginx / CloudPanel), separate Gunicorn service, backup storage, scheduler | Analytics app, Drive backup |
| Tests | pytest, isolated MySQL `_test` database, moto S3, admin typecheck / build | Playwright browser tests, Ruff |

Pin exact versions in the new project's `requirements.txt`, `package.json` and lockfiles.

---

## 13. Configuration and deployment checklist

- [ ] Choose the project name and separate admin / API / media hostnames; own Gunicorn port, systemd / CloudPanel name, nginx locations, logs and cookie name.
- [ ] Create a **new empty** MySQL database and dedicated user with access to that database only. Create a separate R2 bucket and a token scoped to it. Never reuse M2's database, bucket, keys, token or secret.
- [ ] Replace all M2 defaults in `.env.example` and the deploy templates; check both `DATABASE_URL` and `DB_*`; refuse to start on known M2 resources. Keep `.env` and service-account keys out of git.
- [ ] Set production secret, setup key, secure cookies, trusted proxy hops, allowed frontend origins, media origin, size limits and retention values. `ANALYTICS_ENABLED=false` by default.
- [ ] Create and review a fresh initial migration; apply **schema only**. Never run `d1 import`.
- [ ] Build the admin; create the first Owner (CLI or setup page) and Editor accounts; confirm Viewer / Editor / Owner behaviour on the server.
- [ ] Schedule MySQL backup with a restore procedure; schedule stale-upload and retention cleanup. If Drive backup is on, use a separate folder, service account and cron lock.
- [ ] Add health / readiness checks, useful upload and backup error logs, and alerts for storage growth and failed jobs.
- [ ] Smoke-test on the real hostname and bucket (section 14).

The M2 deploy examples contain M2 domains, paths, ports and cron locks. Copying them without a full naming review could send requests or backups to the wrong project.

---

## 14. Tests and acceptance

`tests/conftest.py` **drops and recreates** its configured `_test` database. Only ever point it at a dedicated marketing test database.

### Automated checks
- **Roles:** anonymous users can't reach staff APIs; Viewer can't upload; Editor can't manage Owners; Owner can manage users.
- **Uploads:** valid image / video / document completes and goes public; partial, failed, oversize or wrong-format uploads never appear; spoofed `text/html` and active SVG can't run on the admin origin.
- **Integrity:** a ready key can't be overwritten; replacement creates a new key and keeps the prior version; missing objects can't be finalised.
- **Visibility:** hidden, deleted, draft, expired and unfinished assets return `404` from **both** the catalog and media routes, including old links.
- **Delivery:** previews have safe types; documents download as attachments; video Range and HEAD work; public responses contain no staff data or raw keys.
- **Tags and search:** filters by tag / campaign / type / date return the right published assets only.
- **Reliability:** interrupted multipart uploads expire and are reclaimed; cleanup never deletes a live object; database and file backups restore together.
- **Build:** Python tests, admin typecheck / build and any chosen lint / browser tests run in CI on every change.

### Release smoke test
1. Start the service with marketing-only configuration; confirm M2 and its data are unchanged.
2. Sign in as Owner and Editor; upload one JPEG / PNG, one video and one document.
3. Fetch each through the public API and media hostname; confirm they appear only after finalisation.
4. Hide one asset; confirm its old media URL stops working after the documented cache interval.
5. Replace, restore and permanently purge a test asset; inspect MySQL, R2 and the audit log.
6. Restore a fresh test database and its file originals from backup before going live.

---

## 15. Build sequence

| Phase | Work | Result |
| --- | --- | --- |
| 1. Isolate | New repo with fresh history; drop D1 / analytics / M2 site; new config with guardrails; fresh migration; marketing-only database, bucket and domain. | A slim, safe codebase. |
| 2. Staff workflows | Rebranded admin, accounts, collections, uploads, versions, Trash; server-side type / size checks and upload intents. | Designers can upload. |
| 3. Publish safely | Paginated public catalog; publication-checked media routes on the media hostname; safe headers; video Range; withdrawal behaviour; tags and search. | ✅ Usable by the department and ready for a client site. |
| 4. Operate | MySQL backup and restore, scheduled cleanup, monitoring, login rate limit, CI, production runbook. | Safe to run long-term. |
| 5. Designer features | PSD / AI previews, Figma links, comments, bulk edit, optional review status, request board. | Feels built for designers and marketers. |
| 6. Hand-off | Publish `docs/PUBLIC_API.md`, a staging backend with sample assets, and an allowed origin for the frontend team. Add tracking, ZIP export or richer search only when the frontend project asks for them. | The separate client website can be built. |

**Definition of done (backend):** marketers can sign in and upload each approved type; a validated upload appears in the public API immediately; withdrawn assets can't be fetched after the agreed cache interval; the project can't read or write M2 resources; automated tests and a restore exercise pass.

---

## 16. Decisions to confirm before building

1. Project / repository name, and admin, API and media domains (plus the client site's domain, so it can be allowed).
2. Will the client website fetch from its server (no CORS needed) or from the browser (CORS allow-list needed)?
3. Anonymous client gallery, or client accounts? (Client accounts would need a separate client auth in this backend.)
4. Exact formats, per-type size limits, and whether HEIC / MOV conversion is needed.
5. First release: language variants? translated titles? which tag fields? ZIP download?
6. Trash and version retention periods; must hiding invalidate cached copies immediately?
7. Are originals downloadable? EXIF removal? Document malware scanning?
8. Google Drive backup and analytics: wanted? (MySQL backup is needed regardless.)
9. Which phase-5 features (PSD previews, comments, review status, request board) matter most?

These refine the build without changing the confirmed core: a separate marketing library, uploads by designers and marketers, images / videos / documents, and publication straight after a successful upload.
