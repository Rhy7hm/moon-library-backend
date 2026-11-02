"""
A pretend Google sign-in + Drive API for the backup tests: folders, resumable uploads, PATCH
renames / moves, list, and switches to make it fail or to bin a file. Never used in production.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

import jwt


class FakeDrive:
    def __init__(self, client_email: str):
        self.client_email = client_email
        self.files: dict[str, dict] = {}
        self.sessions: dict[str, dict] = {}
        self.calls: list[str] = []
        self.fail = 0  # how many upload parts to refuse with 503
        self.skip = 0  # parts to accept before failing
        self.lock = threading.Lock()
        self.files["ROOT"] = {"id": "ROOT", "name": "Moon Library backup", "mimeType": "application/vnd.google-apps.folder", "parents": ["SHARED"], "appProperties": {}, "trashed": False, "driveId": "SHARED"}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()

    def trashed(self, f: dict, n: int = 0) -> bool:
        if f.get("trashed"):
            return True
        par = self.files.get((f.get("parents") or [None])[0])
        return bool(par) and n < 50 and self.trashed(par, n + 1)

    def ours(self):
        return [f for f in self.files.values() if f.get("appProperties", {}).get("moonlib") == "1"]

    def _handler(self):
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):  # quiet
                pass

            def _send(self, code, obj=None, headers=None):
                body = b"" if obj is None else json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _all(self):
                u = urlsplit(self.path)
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b""
                with fake.lock:
                    fake.calls.append(f"{self.command} {u.path}{' (move)' if 'addParents' in q else ''}")
                    return self._route(u.path, q, raw)

            do_GET = do_POST = do_PUT = do_PATCH = _all

            def _route(self, p, q, raw):
                if p == "/token":
                    form = {k: v[0] for k, v in parse_qs(raw.decode()).items()}
                    try:
                        claims = jwt.decode(form.get("assertion", ""), options={"verify_signature": False})
                    except jwt.PyJWTError:
                        claims = {}
                    if form.get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" or claims.get("iss") != fake.client_email:
                        return self._send(400, {"error": "invalid_grant"})
                    return self._send(200, {"access_token": "tok-1", "expires_in": 3600})
                if p.startswith("/upload/session/"):
                    sid = p.rsplit("/", 1)[-1]
                    s = fake.sessions.get(sid)
                    if not s:
                        return self._send(404, {"error": {"message": "session not found"}})
                    if fake.fail > 0 and raw and fake.skip > 0:
                        fake.skip -= 1
                    elif fake.fail > 0 and raw:
                        fake.fail -= 1
                        return self._send(503, {"error": {"message": "Backend Error (pretend)"}})
                    cr = self.headers.get("Content-Range", "")
                    m = re.match(r"^bytes (\d+)-(\d+)/(\d+)$", cr)
                    if m:
                        a, b = int(m.group(1)), int(m.group(2))
                        if a != s["got"]:
                            return self._send(400, {"error": {"message": f"bad offset {a}, have {s['got']}"}})
                        if len(raw) != b - a + 1:
                            return self._send(400, {"error": {"message": "length mismatch"}})
                        s["buf"].append(raw)
                        s["got"] += len(raw)
                    elif not re.match(r"^bytes \*/(\d+)$", cr):
                        return self._send(400, {"error": {"message": "bad content-range " + cr}})
                    if s["got"] >= s["total"]:
                        fid = secrets.token_hex(8)
                        data = b"".join(s["buf"])
                        fake.files[fid] = {"id": fid, **s["meta"], "trashed": False, "size": len(data), "md5": hashlib.md5(data).hexdigest(), "driveId": "SHARED"}
                        del fake.sessions[sid]
                        return self._send(200, {"id": fid})
                    return self._send(308, None, {"Range": f"bytes=0-{s['got'] - 1}"} if s["got"] else {})
                if self.headers.get("Authorization") != "Bearer tok-1":
                    return self._send(401, {"error": {"message": "Invalid Credentials"}})
                if q.get("supportsAllDrives") != "true":
                    return self._send(400, {"error": {"message": "supportsAllDrives missing"}})
                if p == "/upload/drive/v3/files" and self.command == "POST":
                    meta = json.loads(raw)
                    if (meta.get("parents") or [None])[0] not in fake.files:
                        return self._send(404, {"error": {"message": "parent not found"}})
                    sid = secrets.token_hex(8)
                    fake.sessions[sid] = {
                        "meta": {"name": meta["name"], "mimeType": meta.get("mimeType"), "parents": meta["parents"], "appProperties": meta.get("appProperties") or {}},
                        "total": int(self.headers.get("X-Upload-Content-Length")),
                        "buf": [],
                        "got": 0,
                    }
                    return self._send(200, {}, {"Location": f"{fake.url}/upload/session/{sid}"})
                if p == "/drive/v3/files" and self.command == "POST":
                    meta = json.loads(raw)
                    if (meta.get("parents") or [None])[0] not in fake.files:
                        return self._send(404, {"error": {"message": "parent not found"}})
                    fid = secrets.token_hex(8)
                    fake.files[fid] = {"id": fid, "name": meta["name"], "mimeType": meta.get("mimeType"), "parents": meta["parents"], "appProperties": meta.get("appProperties") or {}, "trashed": False, "driveId": "SHARED"}
                    return self._send(200, {"id": fid})
                if p == "/drive/v3/files" and self.command == "GET":
                    ours = [f for f in fake.ours() if not ("trashed = false" in q.get("q", "") and fake.trashed(f))]
                    return self._send(200, {"files": [{"id": f["id"]} for f in ours]})
                m = re.match(r"^/drive/v3/files/([^/]+)$", p)
                if m:
                    f = fake.files.get(unquote(m.group(1)))
                    if not f:
                        return self._send(404, {"error": {"message": "File not found"}})
                    if self.command == "GET":
                        return self._send(200, {"id": f["id"], "name": f["name"], "driveId": f["driveId"], "trashed": fake.trashed(f)})
                    if self.command == "PATCH":
                        meta = json.loads(raw) if raw else {}
                        add, rem = q.get("addParents"), q.get("removeParents")
                        if add:
                            if add not in fake.files:
                                return self._send(404, {"error": {"message": "new parent not found"}})
                            if rem and rem not in f["parents"]:
                                return self._send(400, {"error": {"message": "not a parent"}})
                            f["parents"] = [add]
                        if "name" in meta:
                            f["name"] = meta["name"]
                        return self._send(200, {"id": f["id"]})
                return self._send(404, {"error": {"message": f"no route {self.command} {p}"}})

        return H
