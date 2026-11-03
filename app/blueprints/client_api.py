"""
The client website's API (a separate project: moon-library-client). Clients sign in with their own
logins (made by the team in Clients → Logins) and see only what's shared with their company.

  POST /api/client/auth/login        { email, password }
  POST /api/client/auth/logout
  GET  /api/client/auth/me           { user, client } or { user: null }
  POST /api/client/auth/password     { current, next }

  GET  /api/client/library           collections (shared folders and everything inside), files, links
  GET  /api/client/files/<id>/<thumb|preview|download>    one file, only if it's shared with them

  GET  /api/client/uploads           what they've sent the team
  POST /api/client/uploads/start     { name, mime, size, kind, width?, height?, duration?, hasThumb?, hasPoster? } → { id, keys }
  PUT  /api/client/upload?key=…[&uploadId=…&part=N]        the bytes (same as the admin's upload)
  POST /api/client/uploads/mpu       { action: create|complete|abort, key, uploadId?, parts? }
  POST /api/client/uploads/ready     { id }

Client uploads land in the client's inbox folder ("From <client>") in the library, where the team sees them.
Sessions use their own cookie (CLIENT_SESSION_COOKIE), separate from staff sign-ins.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from flask import Blueprint, current_app, request

from ..auth import IDLE_MS, LOCK_AFTER, LOCK_MS, MAX_MS, _secure_attr, check_origin, check_password_rules, client_info, hash_password, new_token, sha256hex, verify_password, write_log
from ..db import in_list, q
from ..services import admin_ops, client_ops
from ..services.admin_ops import Ctx, http_meta
from ..storage import storage
from ..util import HttpError, json_response, now
from .admin_api import _read_body
from .files_api import stream_key

bp = Blueprint("client_api", __name__)


@dataclass
class ClientUser:
    id: str
    email: str
    name: str
    client_id: str
    client_name: str
    client_color: str | None
    session_id: str


def _cookie() -> str:
    return current_app.config.get("CLIENT_SESSION_COOKIE") or "moonlib_client"


def _set_cookie(token: str) -> str:
    return f"{_cookie()}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={MAX_MS // 1000}{_secure_attr()}"


def _clear_cookie() -> str:
    return f"{_cookie()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{_secure_attr()}"


def get_client_user() -> ClientUser | None:
    token = request.cookies.get(_cookie())
    if not token:
        return None
    sid = sha256hex(token)
    row = q.first(
        """SELECT s.id, s.last_seen, s.expires_at, s.revoked_at, u.id AS uid, u.email, u.name, u.disabled, c.id AS cid, c.name AS cname, c.color
             FROM client_sessions s JOIN client_users u ON u.id = s.client_user_id JOIN clients c ON c.id = u.client_id WHERE s.id = ?""",
        sid,
    )
    t = now()
    if not row or row["revoked_at"] or row["disabled"] or t > row["expires_at"] or t - row["last_seen"] > IDLE_MS:
        return None
    if t - row["last_seen"] > 5 * 60_000:
        q.run("UPDATE client_sessions SET last_seen = ? WHERE id = ?", t, sid)
    return ClientUser(row["uid"], row["email"], row["name"], row["cid"], row["cname"], row["color"], sid)


def require_client() -> ClientUser:
    u = get_client_user()
    if not u:
        raise HttpError(401, "Please sign in.")
    return u


def _log(u: ClientUser, action: str, summary: str, kind: str = "content", **extra):
    write_log({"id": None, "username": f"{u.name} ({u.client_name})"}, {"kind": kind, "action": action, "summary": summary, **extra})


NO_STORE = {"Cache-Control": "no-store"}


# ---------------------------------------------------------------- sign-in

def _me(u: ClientUser) -> dict:
    return {"user": {"name": u.name, "email": u.email}, "client": {"name": u.client_name, "color": u.client_color}}


@bp.get("/api/client/auth/me")
def me():
    u = get_client_user()
    return json_response(_me(u) if u else {"user": None}, headers=NO_STORE)


@bp.post("/api/client/auth/login")
def login():
    check_origin()
    b = request.get_json(silent=True, force=True) or {}
    email = (b.get("email") or "").strip().lower() if isinstance(b.get("email"), str) else ""
    password = b.get("password") if isinstance(b.get("password"), str) else ""
    ip = client_info()["ip"]
    if ip:
        recent = q.first("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'client.login.fail' AND ip = ? AND at > ?", ip, now() - 15 * 60_000)
        if (recent or {}).get("n", 0) >= 20:
            raise HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.")
    row = q.first(
        "SELECT u.*, c.name AS cname, c.color AS ccolor FROM client_users u JOIN clients c ON c.id = u.client_id WHERE u.email = ?",
        email,
    )
    if row and row["locked_until"] and row["locked_until"] > now():
        raise HttpError(429, "Too many wrong passwords. Try again in a few minutes.")
    if not row or row["disabled"] or not verify_password(password, row):
        if row:
            n = row["failed_count"] + 1
            lock = n >= LOCK_AFTER
            q.run("UPDATE client_users SET failed_count = ?, locked_until = ? WHERE id = ?", 0 if lock else n, now() + LOCK_MS if lock else None, row["id"])
        write_log({"id": None, "username": email or "?"}, {"kind": "security", "action": "client.login.fail", "summary": f"Client sign-in failed for “{email}”"})
        raise HttpError(401, "Wrong email or password.")
    token = new_token()
    t = now()
    ci = client_info()
    q.run("INSERT INTO client_sessions (id, client_user_id, created_at, last_seen, expires_at, ip, ua) VALUES (?,?,?,?,?,?,?)", sha256hex(token), row["id"], t, t, t + MAX_MS, ci["ip"], ci["ua"])
    q.run("UPDATE client_users SET failed_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", t, row["id"])
    write_log({"id": None, "username": f"{row['name']} ({row['cname']})"}, {"kind": "security", "action": "client.login", "summary": f"{row['name']} from “{row['cname']}” signed in to the client website"})
    res = json_response(_me(ClientUser(row["id"], row["email"], row["name"], row["client_id"], row["cname"], row["ccolor"], "")), headers=NO_STORE)
    res.headers.add("Set-Cookie", _set_cookie(token))
    return res


@bp.post("/api/client/auth/logout")
def logout():
    check_origin()
    u = get_client_user()
    if u:
        q.run("UPDATE client_sessions SET revoked_at = ? WHERE id = ?", now(), u.session_id)
    res = json_response({"ok": True})
    res.headers.add("Set-Cookie", _clear_cookie())
    return res


@bp.post("/api/client/auth/password")
def password():
    check_origin()
    u = require_client()
    b = request.get_json(silent=True, force=True) or {}
    row = q.first("SELECT * FROM client_users WHERE id = ?", u.id)
    if not verify_password(b.get("current") if isinstance(b.get("current"), str) else "", row):
        raise HttpError(400, "Your current password isn't right.")
    h = hash_password(check_password_rules(b.get("next")))
    q.run("UPDATE client_users SET pass_hash = ?, pass_salt = ?, pass_iter = ? WHERE id = ?", h["hash"], h["salt"], h["iter"], u.id)
    q.run("UPDATE client_sessions SET revoked_at = ? WHERE client_user_id = ? AND id != ? AND revoked_at IS NULL", now(), u.id, u.session_id)
    _log(u, "client.password", f"{u.name} ({u.client_name}) changed their password", kind="security")
    return json_response({"ok": True})


# ---------------------------------------------------------------- what they can see

def _scope(client_id: str) -> dict:
    """
    Everything shared with a client: shared folders with all their (not deleted) sub-folders, files in
    them, single shared files, links. Nothing in the Trash, no unfinished uploads, and nothing whose
    share has passed its end date.
    """
    shares = q.all(
        "SELECT id, kind, target_id, url, title, created_at FROM client_shares WHERE client_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at",
        client_id,
        now(),
    )
    folders = q.all("SELECT id, parent_id, name, sort, created_at, updated_at, deleted_at FROM folders")
    by_id = {f["id"]: f for f in folders}
    kids: dict[str | None, list] = {}
    for f in folders:
        kids.setdefault(f["parent_id"], []).append(f)

    def trashed(fid):
        cur, guard = fid, 0
        while cur and guard < 60:
            f = by_id.get(cur)
            if not f or f["deleted_at"]:
                return True
            cur, guard = f["parent_id"], guard + 1
        return False

    in_scope: dict[str, dict] = {}
    roots: list[str] = []
    for s in shares:
        if s["kind"] != "folder" or not s["target_id"] or trashed(s["target_id"]):
            continue
        roots.append(s["target_id"])
        todo = [s["target_id"]]
        while todo:
            fid = todo.pop()
            if fid in in_scope:
                continue
            in_scope[fid] = by_id[fid]
            todo += [k["id"] for k in kids.get(fid, []) if not k["deleted_at"]]
    direct_items = [s["target_id"] for s in shares if s["kind"] == "item" and s["target_id"]]
    items: list[dict] = []
    if in_scope:
        ids = list(in_scope)
        items += q.all(f"SELECT id, folder_id, title, created_at, status FROM items WHERE deleted_at IS NULL AND status != 'draft' AND folder_id IN ({in_list(len(ids))})", *ids)
    if direct_items:
        got = q.all(f"SELECT id, folder_id, title, created_at, status FROM items WHERE deleted_at IS NULL AND status != 'draft' AND id IN ({in_list(len(direct_items))})", *direct_items)
        seen = {i["id"] for i in items}
        items += [dict(i, direct=True) for i in got if i["id"] not in seen and not trashed(i["folder_id"])]
    links = [{"id": s["id"], "title": s["title"], "url": s["url"], "createdAt": s["created_at"]} for s in shares if s["kind"] == "link"]
    return {"folders": in_scope, "roots": roots, "items": items, "links": links}


def _files_for(item_ids: list[str]) -> dict[str, list]:
    out: dict[str, list] = {}
    for i in range(0, len(item_ids), 200):
        part = item_ids[i : i + 200]
        rows = q.all(
            f"SELECT id, item_id, kind, name, mime, size, width, height, duration, key_opt, key_thumb, key_poster, created_at FROM files WHERE status = 'ready' AND item_id IN ({in_list(len(part))}) ORDER BY created_at",
            *part,
        )
        for r in rows:
            out.setdefault(r["item_id"], []).append(
                {
                    "id": r["id"], "kind": r["kind"], "name": r["name"], "mime": r["mime"], "size": r["size"], "width": r["width"], "height": r["height"],
                    "duration": r["duration"], "hasThumb": bool(r["key_thumb"] or r["key_poster"]), "hasPreview": bool(r["key_opt"]),
                }
            )
    return out


def _text(raw) -> str:
    try:
        v = json.loads(raw) if raw else {}
        return (v.get("en") or next(iter(v.values()), "")) if isinstance(v, dict) else str(v)
    except (ValueError, TypeError):
        return raw or ""


@bp.get("/api/client/library")
def library():
    u = require_client()
    sc = _scope(u.client_id)
    files = _files_for([i["id"] for i in sc["items"]])
    count: dict[str, int] = {}
    latest: dict[str, int] = {}
    items = []
    for i in sc["items"]:
        fl = files.get(i["id"])
        if not fl:
            continue
        fid = i["folder_id"] if i["folder_id"] in sc["folders"] else None
        if fid:
            count[fid] = count.get(fid, 0) + 1
            latest[fid] = max(latest.get(fid, 0), i["created_at"])
        items.append({"id": i["id"], "title": _text(i["title"]), "collectionId": fid, "date": i["created_at"], "files": fl})
    items.sort(key=lambda x: x["date"], reverse=True)
    roots = set(sc["roots"])
    collections = [
        {
            "id": f["id"],
            # top of what they can see when its parent isn't shared with them
            "parentId": f["parent_id"] if f["parent_id"] in sc["folders"] and f["id"] not in roots else None,
            "name": _text(f["name"]),
            "sort": f["sort"],
            "count": count.get(f["id"], 0),
            "updatedAt": max(latest.get(f["id"], 0), f["updated_at"] or 0),
        }
        for f in sc["folders"].values()
    ]
    collections.sort(key=lambda c: (c["sort"], c["name"]))
    return json_response(
        {"client": {"name": u.client_name, "color": u.client_color}, "user": {"name": u.name, "email": u.email}, "collections": collections, "items": items, "links": sc["links"]},
        headers=NO_STORE,
    )


def _inbox(u: ClientUser, create: bool) -> str | None:
    row = q.first("SELECT inbox_folder_id FROM clients WHERE id = ?", u.client_id)
    if row and row["inbox_folder_id"] and client_ops._live(row["inbox_folder_id"]):
        return row["inbox_folder_id"]
    if not create:
        return None
    by = f"client:{u.email}"
    fid = admin_ops.folder_create(Ctx(by), {"parentId": client_ops.ensure_home(u.client_id, by), "name": {"en": f"From {u.client_name}"}})["id"]
    q.run("UPDATE clients SET inbox_folder_id = ? WHERE id = ?", fid, u.client_id)
    write_log({"id": None, "username": "system"}, {"kind": "content", "action": "clients.inbox", "summary": f"Created “From {u.client_name}” for files sent by the client", "folderId": fid})
    return fid


@bp.get("/api/client/files/<file_id>/<variant>")
def file(file_id: str, variant: str):
    u = require_client()
    if variant not in ("thumb", "preview", "download"):
        raise HttpError(404, "Not found")
    f = q.first("SELECT f.*, i.folder_id FROM files f JOIN items i ON i.id = f.item_id WHERE f.id = ? AND f.status = 'ready' AND i.deleted_at IS NULL", file_id)
    if not f:
        raise HttpError(404, "Not found")
    inbox = _inbox(u, False)
    allowed = f["folder_id"] == inbox and inbox is not None
    if not allowed:
        sc = _scope(u.client_id)
        allowed = any(i["id"] == f["item_id"] for i in sc["items"])
    if not allowed:
        raise HttpError(404, "Not found")
    if variant == "thumb":
        key = f["key_thumb"] or f["key_poster"]
        if not key:
            raise HttpError(404, "No thumbnail")
        return stream_key(key, "private, max-age=86400")
    if variant == "preview":
        return stream_key(f["key_opt"] or f["key_orig"], "private, max-age=86400")
    return stream_key(f["key_orig"], "private, max-age=86400", f["name"])


# ---------------------------------------------------------------- their uploads to the team

KINDS = ("image", "video", "audio", "document", "other")


@bp.get("/api/client/uploads")
def uploads():
    u = require_client()
    inbox = _inbox(u, False)
    if not inbox:
        return json_response({"uploads": []}, headers=NO_STORE)
    items = q.all("SELECT id, title, created_at, created_by FROM items WHERE folder_id = ? AND deleted_at IS NULL ORDER BY created_at DESC", inbox)
    files = _files_for([i["id"] for i in items])
    return json_response(
        {"uploads": [{"id": i["id"], "title": _text(i["title"]), "date": i["created_at"], "fromTeam": not (i["created_by"] or "").startswith("client:"), "files": files[i["id"]]} for i in items if files.get(i["id"])]},
        headers=NO_STORE,
    )


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 else None


@bp.post("/api/client/uploads/start")
def upload_start():
    check_origin()
    u = require_client()
    b = request.get_json(silent=True, force=True) or {}
    name = (b.get("name") or "").strip()[:200] if isinstance(b.get("name"), str) else ""
    if not name:
        raise HttpError(400, "File name is required")
    ctx = Ctx(f"client:{u.email}")
    title = re.sub(r"\.[^.]+$", "", name).replace("_", " ").replace("-", " ").strip() or name
    item_id = admin_ops.item_create(ctx, {"folderId": _inbox(u, True), "title": {"en": title}})["id"]
    r = admin_ops.file_create(
        ctx,
        {
            "itemId": item_id, "lang": "all", "kind": b.get("kind") if b.get("kind") in KINDS else "other", "name": name,
            "mime": (b.get("mime") or "application/octet-stream")[:100] if isinstance(b.get("mime"), str) else "application/octet-stream",
            "size": _num(b.get("size")) or 0, "width": _num(b.get("width")), "height": _num(b.get("height")), "duration": _num(b.get("duration")),
            "hasThumb": b.get("hasThumb") is True, "hasPoster": b.get("hasPoster") is True,
        },
    )
    return json_response({"id": r["id"], "keys": r["keys"]})


def _own_key(u: ClientUser) -> str:
    """The key must belong to an unfinished upload in this client's inbox."""
    key = request.args.get("key") if request.method == "PUT" else (request.get_json(silent=True, force=True) or {}).get("key")
    inbox = _inbox(u, False)
    if not isinstance(key, str) or not inbox:
        raise HttpError(403, "Unknown upload key")
    row = q.first(
        "SELECT f.id FROM files f JOIN items i ON i.id = f.item_id WHERE f.status = 'uploading' AND i.folder_id = ? AND (f.key_orig = ? OR f.key_thumb = ? OR f.key_poster = ?)",
        inbox, key, key, key,
    )
    if not row:
        raise HttpError(403, "Unknown upload key")
    return key


@bp.put("/api/client/upload")
def upload_put():
    check_origin()
    u = require_client()
    key = _own_key(u)
    max_body = current_app.config["MAX_UPLOAD_BODY"]
    if request.content_length is not None and request.content_length > max_body:
        raise HttpError(413, "Upload part too large")
    spool, size = _read_body(max_body)
    try:
        if not size:
            raise HttpError(400, "Empty upload")
        upload_id = request.args.get("uploadId")
        if upload_id:
            try:
                part = int(request.args.get("part", ""))
            except ValueError:
                part = 0
            if part < 1 or part > 10000:
                raise HttpError(400, "Bad part number")
            return json_response({"partNumber": part, "etag": storage().upload_part(key, upload_id, part, spool, size)})
        meta = http_meta(key, {"contentType": request.args.get("contentType"), "downloadName": request.args.get("downloadName")})
        storage().put(key, spool, size, meta["content_type"], meta["content_disposition"], meta["cache_control"])
        return json_response({"ok": True, "size": size})
    finally:
        spool.close()


@bp.post("/api/client/uploads/mpu")
def upload_mpu():
    check_origin()
    u = require_client()
    _own_key(u)
    b = request.get_json(silent=True, force=True) or {}
    ctx = Ctx(f"client:{u.email}")
    fn = {"create": admin_ops.mpu_create, "complete": admin_ops.mpu_complete, "abort": admin_ops.mpu_abort}.get(b.get("action"))
    if not fn:
        raise HttpError(400, "Unknown action")
    return json_response(fn(ctx, b))


@bp.post("/api/client/uploads/ready")
def upload_ready():
    check_origin()
    u = require_client()
    b = request.get_json(silent=True, force=True) or {}
    inbox = _inbox(u, False)
    row = q.first("SELECT f.id, f.name FROM files f JOIN items i ON i.id = f.item_id WHERE f.id = ? AND i.folder_id = ?", str(b.get("id") or ""), inbox or "")
    if not row:
        raise HttpError(404, "Upload not found")
    admin_ops.file_ready(Ctx(f"client:{u.email}"), {"id": row["id"]})
    _log(u, "client.upload", f"{u.name} ({u.client_name}) sent “{row['name']}”", folderId=inbox)
    return json_response({"ok": True})
