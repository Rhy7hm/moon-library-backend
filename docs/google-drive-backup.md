# Google Drive backup — setup and how it works

A one-way copy of every uploaded file into Google Drive: your own Drive (Connect Google Drive) or a company **Shared Drive**.

* The **admin panel is the only source**. The library never reads from Drive.
* **Nothing done in Drive changes the admin panel or the library.**
* It is off until the two settings below are filled in. Without them the site works exactly as before.

## What it does

| In the admin panel | In Drive (within ~5 minutes) |
|---|---|
| Upload a file / a new language version | Original copied into the same folder path (English folder names), same file name — e.g. `Rebate/Charts/Banner_BM.png` |
| Rename / move a folder or file | Renamed / moved to match |
| Replace a version with a new upload | New file copied in; the old copy moves to `_Old versions` as `Banner_BM (replaced 2026-10-07).png` |
| Restore an older version | It moves back from `_Old versions` (and the one it replaces goes there) |
| Move to the library's Trash | **Nothing** — Drive keeps its copy (it can still be restored) |
| Delete for good (Delete now, Empty Trash, the 90-day clean-up) | **Nothing** by default — Drive keeps its copy. With **Remove from Drive when deleted for good** switched on (Settings → Connections → Google Drive, Owners): the copy goes to Google Drive's Trash on the next run, where Google keeps it 30 days |

Rules:

* Only **originals** are copied: every language version, including Draft and scheduled cards. Optimised copies, thumbnails and posters are skipped (they can be re-made).
* The first run copies everything already in the library.
* About **once a day** it checks that everything it copied is still in Drive. Anything someone deleted or binned there is copied again, if it is still in the library.
* Every file and folder it creates is tagged (`appProperties.moonlib = 1`) so it only ever touches its own items.

Owners see the status in **Admin → Settings → Google Drive backup**:

* connected folder and an "Open in Drive" link
* last backup time and last full check
* files waiting, and files failing (with the reason and the next retry)
* a **Back up now** button, which runs for ~20 seconds; the timer carries on with the rest

## One-time setup

There are two ways to sign the backup in to Google Drive. Pick the one that matches the Drive you have:

| Your Drive | Use | Sidebar of drive.google.com shows |
|---|---|---|
| **Personal** (a @gmail.com account, with or without a Google One plan) | **A. Connect Google Drive** — signs in as you | My Drive, Computers, Shared with me… (no "Shared drives") |
| **Google Workspace** (company account) | **B. Robot account + Shared drive** | "Shared drives" |

Google Cloud costs nothing for this: the Drive API is free, and no billing account or card is needed.
If the console offers a free trial or asks for a payments profile, skip it.

### A. Connect Google Drive (personal Drive)

The backup copies into a "Moon Library backup" folder in the connected account's My Drive and uses
that account's storage. It asks only for `drive.file`: it can see nothing in Drive except the files it
creates itself.

1. <https://console.cloud.google.com> → create a project (e.g. `library-backup`). No billing account.
2. **APIs & Services → Library → Google Drive API → Enable**.
3. **Google Auth Platform**:
   * **Branding** — App name `Moon Library`, support email, home page `https://library.moon-interactive.com`,
     privacy policy link, authorised domain `moon-interactive.com`, developer email. **No logo** (a logo
     makes Google review the branding first).
   * **Audience** — User type **External** → **Publish app** → status **In production**. ("Testing"
     would make Google cancel the connection every 7 days.) The "requires verification" notice can be
     ignored: `drive.file` is a non-sensitive scope.
   * **Data Access** → Add or remove scopes → only `.../auth/drive.file` → Save.
   * **Clients → Create client** → Web application. Authorised redirect URIs:
     * `https://library.moon-interactive.com/api/admin/drive/callback`
     * `http://127.0.0.1:5100/api/admin/drive/callback` and `http://localhost:5100/api/admin/drive/callback` (for your own computer)
4. Put the client's ID and secret in `.env`, then restart:
   ```
   GDRIVE_CLIENT_ID=…apps.googleusercontent.com
   GDRIVE_CLIENT_SECRET=…
   ```
5. As an Owner: **Settings → Connections → Connect Google Drive** → sign in with the account to back up
   into → (if Google says it hasn't verified the app: **Advanced → Go to Moon Library**) → **Allow**.
6. Press **Back up now**, or let the timer (cron, below) carry on.

The permission is kept encrypted with the server's `SECRET_KEY` (change that key and you'll be asked to
connect again). **Disconnect** cancels it at Google; what's already in Drive stays. Connecting the same
account again keeps its folder; a different account starts a fresh folder and copies everything again.

### B. Robot account + Shared drive (Google Workspace)

#### 1. Google Cloud: project, API, robot account

1. Go to <https://console.cloud.google.com/> and create a project, e.g. `moon-library-backup`.
2. Go to **APIs & Services → Library**, search **Google Drive API**, then click **Enable**.
3. Go to **IAM & Admin → Service Accounts → Create service account**:
   * name: `moon-library-backup`
   * no roles needed
   * Done
4. Open it, go to **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
   * Keep it secret.
   * It is the robot's password.
5. Note the robot's email, e.g. `moon-library-backup@moon-library-backup.iam.gserviceaccount.com`.

> If the organisation blocks key creation (policy `iam.disableServiceAccountKeyCreation`), a Google Workspace admin has to allow it for this project.

#### 2. Google Drive: the Shared Drive and folder

1. In Google Drive, create a **Shared drive**, e.g. `Moon Library Backup`. You can also use an existing one.
2. **Manage members** → add the robot's email as **Content manager**.
3. Optional: create a folder inside it, e.g. `Library`. Everything will be copied there.
4. Open that folder (or the Shared drive itself) and copy the id from the address bar:
   `https://drive.google.com/drive/folders/`**`0AbCdEf…`** ← this part.

A Shared Drive is required. Robot accounts have no Drive storage of their own, so they can't own files in a normal "My Drive". In a Shared Drive the files belong to the company and stay even if staff leave.

#### 3. Server: settings and cron

1. Copy the key file from step 1 to the server, outside the web folder, readable only by the app's user:
   ```bash
   chmod 600 /home/moonlibrary/secrets/moon-library-backup.json
   ```
2. In `backend/.env`:
   ```
   GDRIVE_FOLDER_ID=0AbCdEf…                                         # from step 2
   GDRIVE_SA_FILE=/home/moonlibrary/secrets/moon-library-backup.json     # or GDRIVE_SA_JSON={…whole JSON on one line…}
   ```
3. Restart Gunicorn, so "Back up now" and the status in Settings see the new settings.
4. Add the cron line from `deploy/crontab.example` (every 5 minutes):
   ```
   */5 * * * * cd /path/to/backend && flock -n /tmp/moon-library-drive-backup.lock .venv/bin/flask --app wsgi backup run --budget 240 >> /path/to/logs/drive-backup.log 2>&1
   ```
5. Optional check: run `flask --app wsgi backup run` once by hand. It prints what it did as JSON.

The tables it uses (`drive_folders`, `drive_files`, `drive_state`) are part of the normal schema (`flask db upgrade`).

After setting it up:

1. Open **Admin → Settings**. It should say "Not run yet — starts within 5 minutes", or press **Back up now**.
2. The first full copy takes a while if there are many large videos. It continues every 5 minutes until done.

## Notes for the developers

| | |
|---|---|
| `app/drive/backup.py` | the whole logic: compare library ↔ what's in Drive, then create / copy / rename / move; status for the admin panel |
| `app/drive/google.py` | small Drive REST client (`requests` + `PyJWT`): signs in as the connected account or the service account; folders, resumable uploads, PATCH, list |
| `app/drive/connect.py` | Connect Google Drive: Google sign-in (code → refresh token, kept encrypted), the backup folder in My Drive, disconnect |
| `app/storage.py` → `read_range` | the only place the backup reads file bytes (R2, in 8 MB ranges) |
| `app/cli.py` → `backup run` | what cron calls. The same `run_backup()` is used by "Back up now" |
| `app/blueprints/admin_api.py` | `GET /api/admin/backup` status, `POST /api/admin/backup` Back up now — Owners only |

How a run works:

* **Repeatable.** Each run compares the MySQL tables with what was copied (`drive_*`). It sends only what's new
  or changed, so a run that is interrupted or overlaps simply carries on.
* **One at a time.**
  * A lock row in `drive_state` (taken with `SELECT … FOR UPDATE`) stops two runs at once, whether from cron
    or "Back up now".
  * `flock` in the cron line also stops cron runs piling up.
  * A lock left behind by a crashed run expires by itself.
* **Big files go up in 8 MB parts** (Google resumable upload).
  * Progress is saved after each part.
  * A cron run stops after ~4 minutes and the next one resumes mid-file.
  * "Back up now" runs for ~20 seconds.
  * Upload addresses last a week.
* **Failures** (Google down, permissions…) are retried automatically. The wait grows from 2 minutes up to
  6 hours. The reason shows in the admin panel.
* **Load.** A run with nothing to do makes **no calls to Google**, only a few database reads. The daily check is one
  paginated `files.list`.

Limits:

* **Drive API quota** (defaults) is far above what this uses.
* **Old versions** are never removed from `_Old versions` automatically. Empty that folder by hand if Drive space matters.

## Testing without a real Google account

The code can be pointed at a pretend Drive with two extra settings, for **local tests only**. Never set them in production.

```
GDRIVE_API=http://localhost:4010
GDRIVE_TOKEN_URL=http://localhost:4010/token
```

`tests/test_backup.py` runs the backup against such a pretend Drive (`tests/fake_drive.py`). It checks:

* first full copy: folder tree mirrored, drafts included, byte-for-byte identical copies
* nothing-changed runs make no Drive calls
* folder rename, card move, replace → `_Old versions`, restore from `_Old versions`
* deletes / Trash / delete forever leave Drive untouched
* a Google error mid-file (12 MB, two 8 MB parts): retried after the wait, resumed from 8 MB
* the time budget running out mid-file: the next run continues from where it stopped
* the daily check re-copying a file binned in Drive
* a run while another holds the lock (exits at once), an expired lock (taken over), four runs started at once
* a wrong key / broken settings shown in the status
* "Back up now", `flask backup run` / `backup status`, and the old `/api/backup/cron` address

It was also run against the original's pretend Drive with the real library data: 22 folders and 45 files,
all byte-identical. **Not tested against the real Google Drive** — no Google credentials were available.

Before going live, do one real check with the actual Shared Drive:

1. Upload a test file.
2. Press **Back up now**.
3. Open in Drive.
