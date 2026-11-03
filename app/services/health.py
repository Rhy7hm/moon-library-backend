"""
Settings → Connections: checks the three things the library depends on, live, each on its own so
one failure doesn't hide the others.

  • MySQL         a query round trip, server version, which database, the schema revision
  • Cloudflare R2  the bucket answers, and a tiny probe file can be written, read back and deleted
  • Google Drive   signs in (as the connected Google account, or the robot account) and opens the backup
                   folder (or "off" when it isn't set up); warns when files keep failing or the last run
                   failed. Also says whether "Connect Google Drive" is available and who is connected.
                   How far the backup has got is GET /api/admin/backup (shown under the card)

Each check → {key, name, state: ok | fail | off, ms, summary, error?, facts: [{label, value}]}.
Nothing secret (keys, passwords, the service account's key) is ever included.
"""
from __future__ import annotations

import logging
import secrets
import time
from urllib.parse import urlsplit

from flask import current_app

from ..db import q
from ..util import now

log = logging.getLogger(__name__)

PROBE_PREFIX = "_health/"


def _timed(fn):
    t = time.perf_counter()
    try:
        out = fn()
        out.setdefault("state", "ok")
    except Exception as e:  # noqa: BLE001 — every failure is reported, not raised
        log.warning("connection check failed: %s", e)
        out = {"state": "fail", "error": _plain(e)}
    out["ms"] = round((time.perf_counter() - t) * 1000)
    return out


def _plain(e: Exception) -> str:
    """A short, readable reason (no stack traces, no secrets)."""
    msg = getattr(e, "message", None) or str(e) or e.__class__.__name__
    msg = " ".join(msg.split())
    return msg[:300]


def _mysql() -> dict:
    row = q.first("SELECT VERSION() AS v, DATABASE() AS db")
    rev = None
    try:
        r = q.first("SELECT version_num FROM alembic_version")
        rev = r["version_num"] if r else None
    except Exception:  # noqa: BLE001 — a missing table just means "unknown"
        pass
    files = q.first("SELECT COUNT(*) AS n FROM files WHERE status = 'ready'")["n"]
    return {
        "summary": f"Connected to {row['db']}",
        "facts": [
            {"label": "Server", "value": f"MySQL {row['v']}"},
            {"label": "Database", "value": row["db"]},
            {"label": "Schema", "value": rev or "unknown"},
            {"label": "Files recorded", "value": f"{int(files):,}"},
        ],
    }


def _r2() -> dict:
    from ..storage import storage

    st = storage()
    st.client.head_bucket(Bucket=st.bucket)
    # write, read back and delete a tiny file: proves the keys can do what uploads need
    key = f"{PROBE_PREFIX}{now()}-{secrets.token_hex(4)}.txt"
    body = b"moon library connection check"
    st.put(key, body, len(body), "text/plain", cache_control="no-store")
    try:
        got = st.read_range(key, 0, len(body))
        if got != body:
            raise RuntimeError("The test file came back different from what was written")
    finally:
        st.delete([key])
    host = urlsplit(current_app.config.get("R2_ENDPOINT_URL") or "").hostname or "—"
    return {
        "summary": f"Bucket {st.bucket} can be read and written",
        "facts": [
            {"label": "Bucket", "value": st.bucket},
            {"label": "Endpoint", "value": host},
            {"label": "Read / write / delete", "value": "All working"},
        ],
    }


def _drive() -> dict:
    from ..drive.backup import backup_status
    from ..drive.connect import client
    from ..drive.google import Drive, drive_config

    cfg = drive_config()  # raises when the settings are there but broken
    if not cfg:
        return {
            "state": "off",
            "summary": "Backup isn't set up",
            "note": (
                "Connect a Google account and the backup copies every file into a “Moon Library backup” folder in its Drive."
                if client()
                else "To turn it on for a personal Google Drive, add GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET to .env and restart; "
                "for a Workspace Shared drive, set GDRIVE_FOLDER_ID and GDRIVE_SA_FILE. docs/google-drive-backup.md has the steps."
            ),
        }
    folder = Drive(cfg).get(cfg.root, "id,name,driveId,trashed,capabilities(canAddChildren)")
    if folder.get("trashed"):
        raise RuntimeError(f"The backup folder “{folder.get('name')}” is in Google Drive's bin")
    if (folder.get("capabilities") or {}).get("canAddChildren") is False:
        raise RuntimeError(f"The account can see “{folder.get('name')}” but can't add files to it — share it as Editor")
    st = backup_status()
    facts = [
        {"label": "Folder", "value": folder.get("name") or cfg.root},
        {"label": "Signed in as", "value": cfg.who or "—"},
        {"label": "Where", "value": "Shared drive" if folder.get("driveId") else "My Drive"},
    ]
    out = {"summary": f"Backing up to “{folder.get('name')}”", "facts": facts, "link": st.get("folderUrl")}
    if cfg.mode == "robot" and not folder.get("driveId"):
        # a robot account has no storage of its own, so Google refuses its uploads into anyone's My Drive
        out["warning"] = (
            "This folder is in a personal My Drive. The connection works, but Google won't let the robot "
            "account store files there, so copying will fail (“no storage quota”). Use a folder in a Shared drive, "
            "or Connect Google Drive with the account instead."
        )
    elif st.get("failed"):
        out["warning"] = f"{st['failed']} file{'s' if st['failed'] != 1 else ''} failing to copy — see Activity for details"
    elif st.get("lastError") and (st.get("lastOk") or 0) < st["lastError"].get("at", 0):
        out["warning"] = f"Last run failed: {st['lastError'].get('message')}"
    return out


def _drive_account() -> dict:
    """What the Drive card offers: Connect (the OAuth client is set up) and whether an account is connected."""
    try:
        from ..drive.connect import client, load

        conn = load() if client() else None
        return {"canConnect": bool(client()), "connected": bool(conn and not conn.get("broken")), "account": (conn or {}).get("email")}
    except Exception:  # noqa: BLE001 — the card still shows the check itself
        return {"canConnect": False, "connected": False, "account": None}


CHECKS = [
    ("mysql", "MySQL database", _mysql),
    ("r2", "Cloudflare R2 storage", _r2),
    ("drive", "Google Drive backup", _drive),
]


def check_all() -> dict:
    checks = []
    for key, name, fn in CHECKS:
        c = {"key": key, "name": name, **_timed(fn)}
        if key == "drive":
            c.update(_drive_account())
        checks.append(c)
    return {"checkedAt": now(), "checks": checks}
