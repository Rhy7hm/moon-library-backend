# Moon Library

A file library for the marketing and design team: upload, organise, preview and download images, videos, documents and design files (PSD, AI …), and share them with clients.

Everything is on one address, **library.moon-interactive.com**, with one sign-in page for everyone:

```
                       ┌─ client (signs in with email) ──► stays on /      (client website)
everyone ──► / sign in ┤
                       └─ staff  (signs in with ID)    ──► /admin          (designers, marketers…)

both websites ──► Flask ──► MySQL          (folders, files, accounts, clients)
                      └──► Cloudflare R2   (the files themselves, private bucket)
```

## Start it

You need **Python 3.11+**, **Node.js 20+**, your own **MySQL** and a **Cloudflare R2** bucket.

1. Create the database once (in MySQL):
   ```sql
   CREATE DATABASE moon_library CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
2. Settings — copy the example and fill in the MySQL and R2 values:
   ```bash
   cp .env.example .env
   ```
3. Start:
   ```bash
   sh start.sh
   ```
4. The first time, open **http://127.0.0.1:5100/admin** and create your Owner account there, then add the team under **Team**.
5. After that, everyone signs in at **http://127.0.0.1:5100**: staff with their ID (they go on to the admin), clients with their email (they stay on the client website).

The first start installs the Python packages and builds both websites (again by itself whenever their code changes). Every start then checks your MySQL and R2 settings — if something's wrong (e.g. the MySQL password) it asks you and saves the answer to `.env`, and it can create the database for you. **Ctrl+C** stops it. To work on the client website with live reload: `cd client && npm run dev` → http://localhost:5200 (needs `sh start.sh` running too).

Google Drive backup is optional and off until `GDRIVE_FOLDER_ID` and `GDRIVE_SA_FILE` are set — see [docs/google-drive-backup.md](docs/google-drive-backup.md).

## What's where

| Path | |
| --- | --- |
| `start.sh` | starts everything (see above) |
| `.env` | your settings (never committed); `.env.example` explains each one |
| `app/` | the Flask backend: accounts and roles (`auth.py`), file and folder operations (`services/admin_ops.py`), clients and what's shared with them (`services/client_ops.py`), activity log and undo (`services/activity.py`), R2 storage (`storage.py`), file safety headers (`media.py`) |
| `admin/src/app/` | the admin website (React): sidebar and search (`shell.tsx`), folders and files (`library.tsx`), file details (`sheet.tsx`), clients (`clients.tsx`), Home / Trash / Insights / Activity / Team / Settings (`pages.tsx`), uploads (`store.tsx`), design (`app.css`) |
| `admin/src/app/derive/` | thumbnails made in the browser before upload, including PSD / AI / InDesign previews |
| `client/src/` | the client website and the shared sign-in page (React + GSAP): sign-in (`pages/SignIn.tsx`), library (`pages/Library.tsx`), collections, viewer, send files, account; served by Flask at `/` |
| `migrations/` | the database tables |
| `deploy/` | examples for running it on a server (Gunicorn, nginx, systemd, cron) |
| `tests/` | automated checks for developers (see the end) |

## Clients

The **Clients** tab keeps a list of clients and, for each, what they may see: whole folders (live — later uploads in them are included), single files, and links (Canva, Google Drive, YouTube …). Removing a share never deletes the file.

Clients see this on the **client website** — the `client/` folder, served at `/` and talking to this server at `/api/client` (same database, so a share shows up for the client immediately).

- **Logins:** on a client's page, **Add login** makes a sign-in for someone at that company. The password is shown once — send it to them privately. **New password** makes another one (and signs them out); **Turn off** stops them signing in.
- **Files from clients:** what a client sends lands in a folder called **From <client>** in the Library, shown on their page under **From the client**.
- Client sign-ins are separate from staff sign-ins: a client can never open `/admin`, `/f/…` or anything that isn't shared with them. A client who opens `/admin` is simply sent back to their library.
- Everyone uses the same sign-in page at `/`. An email signs in a client; an ID (letters, numbers, `.`, `-`, `_` — never `@`) signs in staff.

## Safety

- Apart from the sign-in page, every page, API call and file needs a sign-in: staff for the admin, a client login for what's shared with that client.
- Roles: **Owner** (everything, including Team and emptying Trash), **Editor** (upload, organise, delete), **Viewer** (look and download).
- Uploaded files can't run as web pages (SVG, HTML and similar always download; every file response is sandboxed).
- Replacing a file keeps the old one under Versions; deleted things stay in Trash for 90 days; most changes can be undone in Activity.
- Keep the R2 bucket private (no public URL or custom domain).

## On a server (production)

1. Create the MySQL database and user, and an R2 bucket and token for this project.
2. Upload the code, `cp .env.example .env`, and fill it in with `APP_ENV=production`, a `SECRET_KEY` and a `SETUP_KEY` (and remove `ALLOW_SETUP_WITHOUT_KEY`). `chmod 600 .env`.
3. Install and build:
   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   .venv/bin/flask --app wsgi db upgrade
   (cd admin && npm ci && npm run build)
   (cd client && npm ci && npm run build)
   ```
4. Run Gunicorn (`.venv/bin/gunicorn -c deploy/gunicorn.conf.py wsgi:app`, port 8100), kept running with [deploy/moon-library-api.service](deploy/moon-library-api.service), behind nginx ([deploy/nginx.conf.example](deploy/nginx.conf.example)).
5. Cron: [deploy/crontab.example](deploy/crontab.example) — nightly MySQL backup and clean-up.
6. Point the domain at the server (GoDaddy: an A record `library` → the server's IP), add the SSL certificate, then open `https://library.moon-interactive.com/admin` and create the first Owner with the `SETUP_KEY`. After that, everyone signs in at `https://library.moon-interactive.com`.

Updates: `git pull` → `pip install -r requirements.txt` → `flask --app wsgi db upgrade` → `(cd admin && npm ci && npm run build)` → `(cd client && npm ci && npm run build)` → restart Gunicorn.

## Commands

```bash
.venv/bin/flask --app wsgi create-owner     # create an Owner from the terminal
.venv/bin/flask --app wsgi create-superadmin   # create the Super admin (or --promote <ID> to make an existing account her)
.venv/bin/flask --app wsgi cleanup          # empty Trash / old versions older than 90 days now
.venv/bin/flask --app wsgi db upgrade       # update the tables after an update
```

## Tests (developers only)

The tests never touch your real data: they use a separate MySQL database whose name must end in `_test` (it is dropped and re-created) and an in-memory stand-in for R2.

```bash
.venv/bin/pip install -r requirements-dev.txt
TEST_DATABASE_URL='mysql+pymysql://USER:PASSWORD@127.0.0.1:3306/moon_library_test?charset=utf8mb4' .venv/bin/pytest
```
