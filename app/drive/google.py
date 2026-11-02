"""
A very small Google Drive client (REST, no SDK) — ported from src/lib/server/drive/google.ts.
Signs in as a Google service account ("robot" account); see docs/google-drive-backup.md.
"""
from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass

import jwt
import requests
from flask import current_app

FOLDER = "application/vnd.google-apps.folder"
_TIMEOUT = (10, 120)


@dataclass
class DriveConfig:
    sa: dict
    root: str
    api: str
    token_url: str


class DriveError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def drive_config() -> DriveConfig | None:
    """None = backup not set up (the feature just stays off). Raises when the settings are broken."""
    cfg = current_app.config
    err = getattr(cfg, "GDRIVE_SA_FILE_ERROR", None) or cfg.get("GDRIVE_SA_FILE_ERROR")
    raw = (cfg.get("GDRIVE_SA_JSON") or "").strip()
    root = (cfg.get("GDRIVE_FOLDER_ID") or "").strip()
    if err and root:
        raise RuntimeError(err)
    if not raw or not root:
        return None
    try:
        sa = json.loads(raw)
    except ValueError:
        raise RuntimeError("GDRIVE_SA_JSON is not valid JSON — paste the whole key file you downloaded from Google Cloud") from None
    if not isinstance(sa, dict) or not sa.get("client_email") or not sa.get("private_key"):
        raise RuntimeError("GDRIVE_SA_JSON is missing client_email / private_key")
    return DriveConfig(
        sa=sa,
        root=root,
        api=(cfg.get("GDRIVE_API") or "https://www.googleapis.com").rstrip("/"),
        token_url=cfg.get("GDRIVE_TOKEN_URL") or sa.get("token_uri") or "https://oauth2.googleapis.com/token",
    )


_tokens: dict[str, tuple[str, float]] = {}
_tok_lock = threading.Lock()


def _as_error(res: requests.Response) -> DriveError:
    msg = None
    try:
        j = res.json()
        e = j.get("error") if isinstance(j, dict) else None
        msg = e if isinstance(e, str) else (e or {}).get("message") if isinstance(e, dict) else None
    except ValueError:
        pass
    return DriveError(res.status_code, f"Google Drive {res.status_code}: {msg or res.reason or 'request failed'}")


def _next_from(res: requests.Response) -> int:
    got = res.headers.get("Range")  # "bytes=0-1048575"
    m = re.search(r"-(\d+)$", got or "")
    return int(m.group(1)) + 1 if m else 0


class Drive:
    def __init__(self, cfg: DriveConfig):
        self.cfg = cfg
        self.http = requests.Session()

    def _token(self) -> str:
        sa = self.cfg.sa
        with _tok_lock:
            hit = _tokens.get(sa["client_email"])
            if hit and hit[1] > time.time() + 60:
                return hit[0]
        now_s = int(time.time())
        assertion = jwt.encode(
            {"iss": sa["client_email"], "scope": "https://www.googleapis.com/auth/drive", "aud": self.cfg.token_url, "iat": now_s, "exp": now_s + 3600},
            sa["private_key"],
            algorithm="RS256",
            headers={"typ": "JWT"},
        )
        res = self.http.post(
            self.cfg.token_url,
            data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
            timeout=_TIMEOUT,
        )
        try:
            j = res.json()
        except ValueError:
            j = {}
        if not res.ok or not j.get("access_token"):
            raise DriveError(res.status_code, f"Google sign-in failed: {j.get('error_description') or j.get('error') or res.status_code}")
        with _tok_lock:
            _tokens[sa["client_email"]] = (j["access_token"], time.time() + float(j.get("expires_in") or 3600))
        return j["access_token"]

    def _call(self, method: str, path: str, query: dict | None = None, body=None, headers: dict | None = None) -> requests.Response:
        params = {"supportsAllDrives": "true", **(query or {})}
        h = {"Authorization": f"Bearer {self._token()}", **(headers or {})}
        kw = {}
        if body is not None:
            h["Content-Type"] = "application/json; charset=utf-8"
            kw["data"] = json.dumps(body, ensure_ascii=False).encode("utf-8")
        res = self.http.request(method, self.cfg.api + path, params=params, headers=h, timeout=_TIMEOUT, **kw)
        if not res.ok:
            raise _as_error(res)
        return res

    def get(self, file_id: str, fields: str = "id,name,driveId,trashed") -> dict:
        return self._call("GET", f"/drive/v3/files/{requests.utils.quote(file_id, safe='')}", {"fields": fields}).json()

    def create_folder(self, name: str, parent: str, props: dict) -> str:
        r = self._call("POST", "/drive/v3/files", {"fields": "id"}, {"name": name, "mimeType": FOLDER, "parents": [parent], "appProperties": props})
        return r.json()["id"]

    def update(self, file_id: str, name: str | None = None, frm: str | None = None, to: str | None = None, description: str | None = None) -> None:
        """Renames and / or moves a file or folder."""
        query = {"fields": "id"}
        if to and to != frm:
            query["addParents"] = to
            if frm:
                query["removeParents"] = frm
        body = {}
        if name is not None:
            body["name"] = name
        if description is not None:
            body["description"] = description
        self._call("PATCH", f"/drive/v3/files/{requests.utils.quote(file_id, safe='')}", query, body)

    def start_upload(self, name: str, parent: str, mime: str, size: int, props: dict, description: str | None = None) -> str:
        """Starts a resumable upload; returns the address the bytes are sent to."""
        meta = {"name": name, "parents": [parent], "appProperties": props}
        if mime:
            meta["mimeType"] = mime
        if description is not None:
            meta["description"] = description
        r = self._call(
            "POST",
            "/upload/drive/v3/files",
            {"uploadType": "resumable", "fields": "id"},
            meta,
            {"X-Upload-Content-Type": mime or "application/octet-stream", "X-Upload-Content-Length": str(size)},
        )
        loc = r.headers.get("Location")
        if not loc:
            raise DriveError(502, "Google did not return an upload address")
        return loc

    def send_part(self, session: str, data: bytes, start: int, total: int) -> dict:
        """One part of a resumable upload → {'id'} when complete, else {'next': bytes Google has}."""
        ln = len(data)
        rng = "bytes */0" if total == 0 else f"bytes {start}-{start + ln - 1}/{total}"
        res = self.http.put(session, data=data if ln else None, headers={"Authorization": f"Bearer {self._token()}", "Content-Range": rng}, timeout=_TIMEOUT)
        if res.status_code == 308:
            return {"next": _next_from(res)}
        if not res.ok:
            raise _as_error(res)
        return {"id": res.json()["id"]}

    def upload_status(self, session: str, total: int) -> dict:
        res = self.http.put(session, headers={"Authorization": f"Bearer {self._token()}", "Content-Range": f"bytes */{total}"}, timeout=_TIMEOUT)
        if res.status_code == 308:
            return {"next": _next_from(res)}
        if not res.ok:
            raise _as_error(res)
        return {"id": res.json()["id"]}

    def list_ours(self, drive_id: str | None) -> set[str]:
        """Every file / folder this backup made that is still in Drive (not in Drive's bin)."""
        ids: set[str] = set()
        page = ""
        while True:
            query = {
                "q": "appProperties has { key='moonlib' and value='1' } and trashed = false",
                "fields": "nextPageToken,files(id)",
                "pageSize": "1000",
                "includeItemsFromAllDrives": "true",
                **({"corpora": "drive", "driveId": drive_id} if drive_id else {"corpora": "user"}),
            }
            if page:
                query["pageToken"] = page
            j = self._call("GET", "/drive/v3/files", query).json()
            for f in j.get("files", []):
                ids.add(f["id"])
            page = j.get("nextPageToken") or ""
            if not page:
                return ids
