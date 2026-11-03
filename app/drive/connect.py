"""
"Connect Google Drive": the backup signs in as a person instead of a robot account, so it can use a
personal Google Drive (Gmail + Google One), which robot accounts can't store files in.

  1. An Owner clicks Connect → /api/admin/drive/connect sends them to Google's sign-in page.
  2. They allow access → Google sends them back to /api/admin/drive/callback with a one-time code.
  3. The code is swapped for a long-lived "refresh token", kept in the settings table, encrypted with
     the server's SECRET_KEY. A "Moon Library backup" folder is made in their My Drive.
  4. From then on the backup asks Google for a short-lived access token whenever it needs one.

It asks only for drive.file: the app sees nothing in Drive except the files it creates itself.
Disconnect tells Google to cancel the permission and forgets the token. What's already in Drive stays.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode

import requests
from cryptography.fernet import Fernet, InvalidToken
from flask import current_app, request

from ..db import UPSERT_SETTING, q
from ..util import now

SCOPE = "https://www.googleapis.com/auth/drive.file"
KEY = "gdrive.oauth"  # the connection (encrypted)
STATE_KEY = "gdrive.oauth.state"  # the sign-in in progress (one at a time, 10 minutes)
FOLDER_NAME = "Moon Library backup"
FOLDER_MIME = "application/vnd.google-apps.folder"
_TIMEOUT = (10, 30)


class ConnectError(Exception):
    pass


def client() -> tuple[str, str] | None:
    """The OAuth client from Google Cloud Console, or None when it isn't set up."""
    cfg = current_app.config
    cid, secret = (cfg.get("GDRIVE_CLIENT_ID") or "").strip(), (cfg.get("GDRIVE_CLIENT_SECRET") or "").strip()
    return (cid, secret) if cid and secret else None


def _urls() -> dict:
    cfg = current_app.config
    return {
        "auth": cfg.get("GDRIVE_AUTH_URL") or "https://accounts.google.com/o/oauth2/v2/auth",
        "token": cfg.get("GDRIVE_TOKEN_URL") or "https://oauth2.googleapis.com/token",
        "revoke": cfg.get("GDRIVE_REVOKE_URL") or "https://oauth2.googleapis.com/revoke",
        "api": (cfg.get("GDRIVE_API") or "https://www.googleapis.com").rstrip("/"),
    }


def redirect_url() -> str:
    return current_app.config.get("GDRIVE_REDIRECT_URL") or request.host_url.rstrip("/") + "/api/admin/drive/callback"


# ---------------------------------------------------------------- the stored connection (encrypted)

def _fernet() -> Fernet:
    key = hashlib.sha256(("moonlib-gdrive:" + current_app.config["SECRET_KEY"]).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def load() -> dict | None:
    """{refresh_token, email, folder_id, connected_at, connected_by} — or None. {"broken": …} when it can't be read."""
    r = q.first("SELECT value FROM settings WHERE `key` = ?", KEY)
    if not r:
        return None
    try:
        return json.loads(_fernet().decrypt(r["value"].encode()).decode())
    except (InvalidToken, ValueError):
        # SECRET_KEY changed since it was saved: it has to be connected again
        return {"broken": True}


def _save(conn: dict, by: str) -> None:
    q.run(UPSERT_SETTING, KEY, _fernet().encrypt(json.dumps(conn).encode()).decode(), now(), by)


def forget() -> None:
    q.run("DELETE FROM settings WHERE `key` IN (?, ?)", KEY, STATE_KEY)


# ---------------------------------------------------------------- sign-in

def start(user_id: str) -> str:
    """Google's sign-in address for this Owner, with a fresh one-time state."""
    cid, _ = client() or ("", "")
    if not cid:
        raise ConnectError("Google sign-in isn't set up: add GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET to .env and restart.")
    state = secrets.token_urlsafe(24)
    q.run(UPSERT_SETTING, STATE_KEY, json.dumps({"state": state, "user": user_id, "until": now() + 10 * 60_000}), now(), user_id)
    params = {
        "client_id": cid,
        "redirect_uri": redirect_url(),
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",  # → a refresh token, so the backup keeps working on its own
        # always ask which account (so it can't quietly pick whichever Gmail the browser is in),
        # and always hand out a fresh refresh token
        "prompt": "select_account consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return _urls()["auth"] + "?" + urlencode(params)


def finish(user_id: str, by: str, code: str, state: str) -> dict:
    """Checks the state, swaps the code for tokens, finds the account, makes (or reuses) the backup folder, saves."""
    r = q.first("SELECT value FROM settings WHERE `key` = ?", STATE_KEY)
    want = json.loads(r["value"]) if r else {}
    q.run("DELETE FROM settings WHERE `key` = ?", STATE_KEY)
    if not state or not secrets.compare_digest(str(want.get("state", "")), state) or want.get("user") != user_id or want.get("until", 0) < now():
        raise ConnectError("That sign-in link has expired or wasn't started here. Press Connect Google Drive again.")
    cid, secret = client() or ("", "")
    u = _urls()
    res = requests.post(
        u["token"],
        data={"code": code, "client_id": cid, "client_secret": secret, "redirect_uri": redirect_url(), "grant_type": "authorization_code"},
        timeout=_TIMEOUT,
    )
    j = _json(res)
    if not res.ok or not j.get("refresh_token"):
        raise ConnectError(f"Google didn't give access: {j.get('error_description') or j.get('error') or res.status_code}")
    if SCOPE not in (j.get("scope") or SCOPE).split():
        raise ConnectError("Access to Google Drive wasn't allowed — tick the Drive box on Google's screen and try again.")
    token = j["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    about = _json(requests.get(u["api"] + "/drive/v3/about", params={"fields": "user(emailAddress,displayName)"}, headers=h, timeout=_TIMEOUT))
    email = ((about.get("user") or {}).get("emailAddress")) or "your Google account"

    # the same account as before keeps its folder (and everything already copied into it)
    prev = load() or {}
    folder = prev.get("folder_id") if prev.get("email") == email and not prev.get("broken") else None
    if folder:
        f = _json(requests.get(u["api"] + f"/drive/v3/files/{folder}", params={"fields": "id,trashed", "supportsAllDrives": "true"}, headers=h, timeout=_TIMEOUT))
        if not f.get("id") or f.get("trashed"):
            folder = None
    if not folder:
        made = requests.post(
            u["api"] + "/drive/v3/files",
            params={"fields": "id", "supportsAllDrives": "true"},
            headers={**h, "Content-Type": "application/json"},
            data=json.dumps({"name": FOLDER_NAME, "mimeType": FOLDER_MIME, "description": "Backup copies of the Moon Library — made by the library itself."}),
            timeout=_TIMEOUT,
        )
        folder = _json(made).get("id")
        if not made.ok or not folder:
            raise ConnectError(f"Couldn't make the backup folder in Drive ({made.status_code}).")
        # a new folder: everything gets copied into it from scratch
        q.batch([("DELETE FROM drive_files", []), ("DELETE FROM drive_folders", []), ("DELETE FROM drive_state WHERE `key` NOT IN ('lock', 'mirrorDeletes')", [])])
    conn = {"refresh_token": j["refresh_token"], "email": email, "folder_id": folder, "connected_at": now(), "connected_by": by}
    _save(conn, by)
    # the permission this one replaces is cancelled at Google, so only one is ever active
    if prev.get("refresh_token") and prev["refresh_token"] != conn["refresh_token"]:
        try:
            requests.post(u["revoke"], params={"token": prev["refresh_token"]}, timeout=_TIMEOUT)
        except requests.RequestException:
            pass
    from .google import _tokens  # the new account's token starts fresh

    _tokens.pop("oauth", None)
    return conn


def disconnect() -> dict | None:
    """Cancels the permission at Google (best effort) and forgets it here. Drive keeps what's there."""
    conn = load()
    if conn and conn.get("refresh_token"):
        try:
            requests.post(_urls()["revoke"], params={"token": conn["refresh_token"]}, timeout=_TIMEOUT)
        except requests.RequestException:
            pass
    forget()
    from .google import _tokens

    _tokens.pop("oauth", None)
    return conn


def access_token(refresh_token: str) -> tuple[str, float]:
    """A fresh short-lived access token → (token, expires at)."""
    cid, secret = client() or ("", "")
    res = requests.post(
        _urls()["token"],
        data={"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": cid, "client_secret": secret},
        timeout=_TIMEOUT,
    )
    j = _json(res)
    if not res.ok or not j.get("access_token"):
        why = j.get("error_description") or j.get("error") or res.status_code
        if j.get("error") == "invalid_grant":
            why = "the Google permission was removed or has expired — press Connect Google Drive again"
        from .google import DriveError

        raise DriveError(res.status_code or 401, f"Google sign-in failed: {why}")
    return j["access_token"], time.time() + float(j.get("expires_in") or 3600)


def _json(res: requests.Response) -> dict:
    try:
        j = res.json()
        return j if isinstance(j, dict) else {}
    except ValueError:
        return {}
