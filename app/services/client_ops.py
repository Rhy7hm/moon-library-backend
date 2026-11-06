"""
Clients, and what is shared with each of them.

A share is one of:
  folder   a folder, live: everything in it (sub-folders too), now and later
  item     one file card
  link     an outside address (Canva, Google Drive, YouTube …) with a title

Clients sign in to the client website (moon-library-client, through /api/client) with logins made here.
Files a client sends land in their inbox folder ("From <client>").

Every client has a home folder in the library, Clients › <client name>, made when the client is added.
Folders made from the client's page go inside it (and are shared with them), and so does their inbox,
so the library — and the Google Drive backup, which copies the library's folders — is sorted by client.
Folders made anywhere else in the library stay where they were made.
Removing a share never deletes the file. Permanently deleting a file or folder removes its shares
(see admin_ops.purge).

  clients.list       every client with its shares                 (Viewer)
  clients.create     { name, email?, notes?, color? }  → { id }   (Editor)
  clients.update     { id, name?, email?, notes?, color? }        (Editor)
  clients.setAvatar  { id, data }  JPEG/PNG/WEBP as base64 → { avatarKey }  (Editor)
  clients.clearAvatar { id }                                       (Editor)
  clients.delete     { id, withFolder? = true }  moves the client to the Trash: logins stop working, shares are
                     kept for a restore; with their folder (Clients › <client>) too, unless withFolder is false.
                     Restore / delete for good from the Trash handle the client and that folder together   (Owner)
  clients.newFolder  { clientId, name, share? = true } → { id }   a folder in the client's home folder (Editor)
  clients.home       { clientId } → { id }   the client's home folder, made if it's missing (Editor)
  shares.add         { clientId, folderIds?, itemIds?, links?: [{ url, title }], expiresAt? } → { added, skipped }
                     expiresAt (ms, or null for no end date) also applies to any of these already shared
  shares.expire      { clientId, ids, expiresAt }  — set or clear the end date of shares
  shares.remove      { clientId, ids }
  logins.create      { clientId, email, name } → { id, password }   the password is shown once  (Editor)
  logins.reset       { id } → { password }   new password, signs them out everywhere        (Editor)
  logins.update      { id, disabled?, name? }   turning off signs them out                   (Editor)
  logins.delete      { id }                                                                  (Editor)
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

from ..auth import SessionUser, at_least, hash_password, random_password, write_log
from ..avatar import decode_image_b64
from ..db import UPSERT_SETTING, in_list, q
from ..storage import IMMUTABLE, storage
from ..util import HttpError, is_num, new_id, now
from . import admin_ops

KINDS = ("folder", "item", "link")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _text(v, field: str, max_len: int, required: bool = False) -> str | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            raise HttpError(400, f"{field} is required")
        return None
    if not isinstance(v, str):
        raise HttpError(400, f"{field} must be text")
    return v.strip()[:max_len]


def _email(v) -> str | None:
    e = _text(v, "Email", 255)
    if e and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", e):
        raise HttpError(400, "That email address doesn't look right")
    return e


def _color(v) -> str | None:
    return v if isinstance(v, str) and _COLOR.match(v) else None


def _ids(v) -> list[str]:
    return list(dict.fromkeys(x for x in v if isinstance(x, str) and x)) if isinstance(v, list) else []


def _client(cid) -> dict:
    row = q.first("SELECT id, name, avatar_key, deleted_at FROM clients WHERE id = ?", str(cid or ""))
    if not row:
        raise HttpError(404, "Client not found")
    if row["deleted_at"]:
        raise HttpError(409, f"{row['name']} is in the Trash. Restore them first.")
    return row


def _name_taken(name: str, other: str | None = None) -> None:
    r = q.first("SELECT id, deleted_at FROM clients WHERE name = ? AND id != ?", name, other or "")
    if r:
        raise HttpError(409, f"“{name}” is in the Trash — restore it from there, or delete it for good first." if r["deleted_at"] else f"There's already a client called “{name}”")


def _share_out(r: dict) -> dict:
    return {
        "id": r["id"], "kind": r["kind"], "targetId": r["target_id"], "url": r["url"], "title": r["title"],
        "createdAt": r["created_at"], "createdBy": r["created_by"], "expiresAt": r.get("expires_at"),
    }


def _expiry(v):
    """An end date for a share: null (none) or a time in the future (ms)."""
    if v is None:
        return None
    if not is_num(v) or int(v) <= now():
        raise HttpError(400, "The end date has to be in the future")
    return int(v)


# ---------------------------------------------------------------- home folders: Clients › <client>

ROOT_KEY = "clients.rootFolder"  # settings: the id of the top-level "Clients" folder


def _live(fid: str | None) -> bool:
    """The folder exists and neither it nor a folder above it is in the Trash."""
    seen = 0
    while fid and seen < 50:
        r = q.first("SELECT parent_id, deleted_at FROM folders WHERE id = ?", fid)
        if not r or r["deleted_at"]:
            return False
        fid, seen = r["parent_id"], seen + 1
    return True


def _clients_root(by: str) -> str:
    r = q.first("SELECT value FROM settings WHERE `key` = ?", ROOT_KEY)
    if r and _live(r["value"]):
        return r["value"]
    fid = admin_ops.folder_create(admin_ops.Ctx(by), {"parentId": None, "name": {"en": "Clients"}})["id"]
    q.run(UPSERT_SETTING, ROOT_KEY, fid, now(), by)
    return fid


def ensure_home(client_id: str, by: str) -> str:
    """The client's home folder, made (under Clients) if it's missing or was deleted. Their inbox moves into it."""
    c = q.first("SELECT id, name, home_folder_id, inbox_folder_id FROM clients WHERE id = ?", client_id)
    if not c:
        raise HttpError(404, "Client not found")
    home = c["home_folder_id"]
    if not (home and _live(home)):
        home = admin_ops.folder_create(admin_ops.Ctx(by), {"parentId": _clients_root(by), "name": {"en": c["name"]}})["id"]
        q.run("UPDATE clients SET home_folder_id = ? WHERE id = ?", home, c["id"])
    inbox = c["inbox_folder_id"]
    if inbox and _live(inbox) and (q.first("SELECT parent_id FROM folders WHERE id = ?", inbox) or {}).get("parent_id") is None:
        admin_ops.move(admin_ops.Ctx(by), {"folderIds": [inbox], "targetId": home})
    return home


def _rename_home(c: dict, name: str) -> None:
    home = q.first("SELECT f.id, f.name FROM clients c JOIN folders f ON f.id = c.home_folder_id WHERE c.id = ?", c["id"])
    if home:
        admin_ops.folder_update(admin_ops.Ctx("system"), {"id": home["id"], "name": {**admin_ops._parse_name(home["name"]), "en": name}})


def clients_home(user: SessionUser, b: dict):
    return {"id": ensure_home(_client(b.get("clientId"))["id"], user.username)}


def clients_new_folder(user: SessionUser, b: dict):
    c = _client(b.get("clientId"))
    name = _text(b.get("name"), "Name", 200, required=True)
    home = ensure_home(c["id"], user.username)
    fid = admin_ops.folder_create(admin_ops.Ctx(user.username), {"parentId": home, "name": {"en": name}})["id"]
    shared = b.get("share", True) is not False
    if shared:
        q.run(
            "INSERT INTO client_shares (id, client_id, kind, target_id, url, title, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)",
            new_id(), c["id"], "folder", fid, None, None, now(), user.username,
        )
    write_log(user, {
        "kind": "content", "action": "clients.newFolder", "folderId": fid,
        "summary": f"Created “{name}” in {c['name']}’s folder" + (f" and shared it with {c['name']}" if shared else ""),
    })
    return {"id": fid}


def clients_list(user: SessionUser, b: dict):
    if at_least(user.role, "editor"):  # clients added before home folders existed get one
        for r in q.all("SELECT id FROM clients WHERE home_folder_id IS NULL AND deleted_at IS NULL"):
            ensure_home(r["id"], user.username)
    rows = q.all("SELECT id, name, email, notes, color, avatar_key, created_at, created_by, updated_at, inbox_folder_id, home_folder_id, deleted_at FROM clients ORDER BY name")
    logins: dict[str, list] = {}
    for u in q.all("SELECT id, client_id, email, name, disabled, last_login_at, created_at FROM client_users ORDER BY created_at"):
        logins.setdefault(u["client_id"], []).append(
            {"id": u["id"], "email": u["email"], "name": u["name"], "disabled": bool(u["disabled"]), "lastLoginAt": u["last_login_at"], "createdAt": u["created_at"]}
        )
    shares = q.all("SELECT id, client_id, kind, target_id, url, title, created_at, created_by, expires_at FROM client_shares ORDER BY created_at DESC")
    by: dict[str, list] = {}
    for s in shares:
        by.setdefault(s["client_id"], []).append(_share_out(s))
    return {
        "clients": [
            {
                "id": r["id"],
                "name": r["name"],
                "email": r["email"],
                "notes": r["notes"],
                "color": r["color"],
                "avatarKey": r["avatar_key"],
                "createdAt": r["created_at"],
                "createdBy": r["created_by"],
                "updatedAt": r["updated_at"],
                "shares": by.get(r["id"], []),
                "logins": logins.get(r["id"], []),
                "inboxFolderId": r["inbox_folder_id"],
                "homeFolderId": r["home_folder_id"],
                "deletedAt": r["deleted_at"],
            }
            for r in rows
        ]
    }


def clients_create(user: SessionUser, b: dict):
    name = _text(b.get("name"), "Name", 200, required=True)
    _name_taken(name)
    cid, t = new_id(), now()
    q.run(
        "INSERT INTO clients (id, name, email, notes, color, created_at, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        cid, name, _email(b.get("email")), _text(b.get("notes"), "Notes", 5000), _color(b.get("color")), t, user.username, t,
    )
    home = ensure_home(cid, user.username)
    write_log(user, {"kind": "content", "action": "clients.create", "summary": f"Added client “{name}”", "targetType": "client", "targetIds": [cid], "folderId": home})
    return {"id": cid, "homeFolderId": home}


def clients_update(user: SessionUser, b: dict):
    c = _client(b.get("id"))
    sets, vals = [], []
    if "name" in b:
        name = _text(b.get("name"), "Name", 200, required=True)
        _name_taken(name, c["id"])
        sets.append("name = ?")
        vals.append(name)
    if "email" in b:
        sets.append("email = ?")
        vals.append(_email(b.get("email")))
    if "notes" in b:
        sets.append("notes = ?")
        vals.append(_text(b.get("notes"), "Notes", 5000))
    if "color" in b:
        sets.append("color = ?")
        vals.append(_color(b.get("color")))
    if not sets:
        return {"ok": True}
    q.run(f"UPDATE clients SET {', '.join(sets)}, updated_at = ? WHERE id = ?", *vals, now(), c["id"])
    if "name" in b and vals[0] != c["name"]:
        _rename_home(c, vals[0])
    write_log(user, {"kind": "content", "action": "clients.update", "summary": f"Updated client “{vals[0] if 'name' in b else c['name']}”", "targetType": "client", "targetIds": [c["id"]]})
    return {"ok": True}


def clients_set_avatar(user: SessionUser, b: dict):
    c = _client(b.get("id"))
    raw, content_type, ext = decode_image_b64(b.get("data"))
    key = f"c/{new_id(16)}.{ext}"
    storage().put(key, raw, len(raw), content_type, None, IMMUTABLE)
    old = c.get("avatar_key")
    q.run("UPDATE clients SET avatar_key = ?, updated_at = ? WHERE id = ?", key, now(), c["id"])
    if old and old != key:
        storage().delete([old])
    write_log(user, {"kind": "content", "action": "clients.setAvatar", "summary": f"Updated the photo for “{c['name']}”", "targetType": "client", "targetIds": [c["id"]]})
    return {"avatarKey": key}


def clients_clear_avatar(user: SessionUser, b: dict):
    c = _client(b.get("id"))
    old = c.get("avatar_key")
    if not old:
        return {"ok": True}
    q.run("UPDATE clients SET avatar_key = NULL, updated_at = ? WHERE id = ?", now(), c["id"])
    storage().delete([old])
    write_log(user, {"kind": "content", "action": "clients.clearAvatar", "summary": f"Removed the photo for “{c['name']}”", "targetType": "client", "targetIds": [c["id"]]})
    return {"ok": True}


def clients_delete(user: SessionUser, b: dict):
    c = _client(b.get("id"))
    t = now()
    stmts = admin_ops._trash_clients([c["id"]], t)
    home = q.first("SELECT home_folder_id FROM clients WHERE id = ?", c["id"])["home_folder_id"]
    # their folder goes with them (the same moment links the two, so they come back or go for good together)
    with_folder = b.get("withFolder", True) is not False and home and _live(home)
    if with_folder:
        stmts.append(("UPDATE folders SET deleted_at = ? WHERE id = ?", [t, home]))
    q.batch(stmts)
    write_log(user, {
        "kind": "content", "action": "trash", "targetType": "client", "targetIds": [c["id"]],
        "summary": f"Deleted (moved to Trash) 👤 {c['name']}" + (" and their folder" if with_folder else ""),
        "before": {"folderIds": [home] if with_folder else [], "itemIds": [], "clientIds": [c["id"]]},
    })
    return {"ok": True, "withFolder": bool(with_folder)}


def _clean_url(v) -> str:
    u = _text(v, "Link", 2000, required=True)
    if not re.match(r"^[a-z][a-z0-9+.-]*://", u, re.I):
        u = "https://" + u
    parts = urlsplit(u)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc or "." not in parts.netloc:
        raise HttpError(400, "Links must be web addresses (http or https)")
    return u


def shares_add(user: SessionUser, b: dict):
    c = _client(b.get("clientId"))
    folder_ids, item_ids = _ids(b.get("folderIds")), _ids(b.get("itemIds"))
    links = b.get("links") if isinstance(b.get("links"), list) else []
    if not folder_ids and not item_ids and not links:
        raise HttpError(400, "Choose something to share")
    set_expiry = "expiresAt" in b
    expires = _expiry(b.get("expiresAt")) if set_expiry else None

    def existing(table: str, ids: list[str]) -> set[str]:
        if not ids:
            return set()
        return {r["id"] for r in q.all(f"SELECT id FROM {table} WHERE deleted_at IS NULL AND id IN ({in_list(len(ids))})", *ids)}

    ok_folders, ok_items = existing("folders", folder_ids), existing("items", item_ids)
    missing = (set(folder_ids) - ok_folders) | (set(item_ids) - ok_items)
    if missing:
        raise HttpError(404, "Some of those are no longer in the library")
    current = q.all("SELECT id, kind, target_id, url FROM client_shares WHERE client_id = ?", c["id"])
    already = {(r["kind"], r["target_id"] or r["url"]) for r in current}
    # sharing again with a new end date moves the end date of what's already shared
    if set_expiry:
        wanted = {("folder", x) for x in folder_ids} | {("item", x) for x in item_ids}
        again = [r["id"] for r in current if (r["kind"], r["target_id"]) in wanted]
        if again:
            q.run(f"UPDATE client_shares SET expires_at = ? WHERE id IN ({in_list(len(again))})", expires, *again)
    t = now()
    rows, names = [], []
    for kind, ids in (("folder", folder_ids), ("item", item_ids)):
        for tid in ids:
            if (kind, tid) not in already:
                rows.append((new_id(), c["id"], kind, tid, None, None))
                already.add((kind, tid))
    for ln in links:
        if not isinstance(ln, dict):
            continue
        url = _clean_url(ln.get("url"))
        title = _text(ln.get("title"), "Title", 300) or urlsplit(url).netloc
        if ("link", url) not in already:
            rows.append((new_id(), c["id"], "link", None, url, title))
            already.add(("link", url))
            names.append(title)
    if rows:
        q.batch([("INSERT INTO client_shares (id, client_id, kind, target_id, url, title, created_at, created_by, expires_at) VALUES (?,?,?,?,?,?,?,?,?)", [*r, t, user.username, expires]) for r in rows])
        n_f = sum(1 for r in rows if r[2] == "folder")
        n_i = sum(1 for r in rows if r[2] == "item")
        n_l = sum(1 for r in rows if r[2] == "link")
        parts = [p for p in (f"{n_f} folder{'s' if n_f != 1 else ''}" if n_f else "", f"{n_i} file{'s' if n_i != 1 else ''}" if n_i else "", f"{n_l} link{'s' if n_l != 1 else ''}" if n_l else "") if p]
        until = f" until {datetime.fromtimestamp((expires + 8 * 3600_000) / 1000, tz=timezone.utc):%-d %b %Y}" if expires else ""
        write_log(user, {"kind": "content", "action": "shares.add", "summary": f"Shared {', '.join(parts)} with “{c['name']}”{until}", "targetType": "client", "targetIds": [c["id"]]})
    return {"added": len(rows), "skipped": len(folder_ids) + len(item_ids) + len(links) - len(rows)}


def shares_expire(user: SessionUser, b: dict):
    c = _client(b.get("clientId"))
    ids = _ids(b.get("ids"))
    if not ids:
        raise HttpError(400, "Choose what to change")
    expires = _expiry(b.get("expiresAt"))
    n = q.run(f"UPDATE client_shares SET expires_at = ? WHERE client_id = ? AND id IN ({in_list(len(ids))})", expires, c["id"], *ids)
    when = f"until {datetime.fromtimestamp((expires + 8 * 3600_000) / 1000, tz=timezone.utc):%-d %b %Y}" if expires else "with no end date"
    write_log(user, {"kind": "content", "action": "shares.expire", "summary": f"“{c['name']}” can now see {n} shared item{'s' if n != 1 else ''} {when}", "targetType": "client", "targetIds": [c["id"]]})
    return {"ok": True, "changed": n}


def shares_remove(user: SessionUser, b: dict):
    c = _client(b.get("clientId"))
    ids = _ids(b.get("ids"))
    if not ids:
        return {"ok": True, "removed": 0}
    removed = q.run(f"DELETE FROM client_shares WHERE client_id = ? AND id IN ({in_list(len(ids))})", c["id"], *ids)
    write_log(user, {"kind": "content", "action": "shares.remove", "summary": f"Stopped sharing {removed} item{'s' if removed != 1 else ''} with “{c['name']}”", "targetType": "client", "targetIds": [c["id"]]})
    return {"ok": True, "removed": removed}


def _login(lid) -> dict:
    row = q.first("SELECT u.id, u.email, u.name, u.client_id, c.name AS cname FROM client_users u JOIN clients c ON c.id = u.client_id WHERE u.id = ?", str(lid or ""))
    if not row:
        raise HttpError(404, "Login not found")
    return row


def _set_password(lid: str) -> str:
    pw = random_password()
    h = hash_password(pw)
    q.batch([
        ("UPDATE client_users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, failed_count = 0, locked_until = NULL WHERE id = ?", [h["hash"], h["salt"], h["iter"], lid]),
        ("UPDATE client_sessions SET revoked_at = ? WHERE client_user_id = ? AND revoked_at IS NULL", [now(), lid]),
    ])
    return pw


def logins_create(user: SessionUser, b: dict):
    c = _client(b.get("clientId"))
    email = _email(b.get("email"))
    if not email:
        raise HttpError(400, "Email is required")
    email = email.lower()
    name = _text(b.get("name"), "Name", 100) or email.split("@")[0]
    if q.first("SELECT id FROM client_users WHERE email = ?", email):
        raise HttpError(409, f"{email} already has a login")
    lid = new_id()
    h = hash_password(random_password())
    q.run(
        "INSERT INTO client_users (id, client_id, email, name, pass_hash, pass_salt, pass_iter, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)",
        lid, c["id"], email, name, h["hash"], h["salt"], h["iter"], now(), user.username,
    )
    pw = _set_password(lid)
    write_log(user, {"kind": "security", "action": "logins.create", "summary": f"Made a client website login for {name} ({email}) at “{c['name']}”", "targetType": "client", "targetIds": [c["id"]]})
    return {"id": lid, "password": pw}


def logins_reset(user: SessionUser, b: dict):
    u = _login(b.get("id"))
    pw = _set_password(u["id"])
    write_log(user, {"kind": "security", "action": "logins.reset", "summary": f"Reset the client website password for {u['name']} ({u['cname']})", "targetType": "client", "targetIds": [u["client_id"]]})
    return {"password": pw}


def logins_update(user: SessionUser, b: dict):
    u = _login(b.get("id"))
    if "name" in b:
        q.run("UPDATE client_users SET name = ? WHERE id = ?", _text(b.get("name"), "Name", 100, required=True), u["id"])
    if "disabled" in b:
        off = b.get("disabled") is True
        q.run("UPDATE client_users SET disabled = ? WHERE id = ?", 1 if off else 0, u["id"])
        if off:
            q.run("UPDATE client_sessions SET revoked_at = ? WHERE client_user_id = ? AND revoked_at IS NULL", now(), u["id"])
        write_log(user, {"kind": "security", "action": "logins.update", "summary": f"{'Turned off' if off else 'Turned on'} the client website login for {u['name']} ({u['cname']})", "targetType": "client", "targetIds": [u["client_id"]]})
    return {"ok": True}


def logins_delete(user: SessionUser, b: dict):
    u = _login(b.get("id"))
    q.run("DELETE FROM client_users WHERE id = ?", u["id"])
    write_log(user, {"kind": "security", "action": "logins.delete", "summary": f"Removed the client website login for {u['name']} ({u['cname']})", "targetType": "client", "targetIds": [u["client_id"]]})
    return {"ok": True}


CLIENT_OPS = {
    "clients.list": clients_list,
    "clients.create": clients_create,
    "clients.update": clients_update,
    "clients.setAvatar": clients_set_avatar,
    "clients.clearAvatar": clients_clear_avatar,
    "clients.delete": clients_delete,
    "clients.newFolder": clients_new_folder,
    "clients.home": clients_home,
    "shares.add": shares_add,
    "shares.expire": shares_expire,
    "shares.remove": shares_remove,
    "logins.create": logins_create,
    "logins.reset": logins_reset,
    "logins.update": logins_update,
    "logins.delete": logins_delete,
}
