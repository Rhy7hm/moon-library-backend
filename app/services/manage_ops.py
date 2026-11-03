"""
Admin operations that aren't about the files themselves: accounts, the activity / security log,
version lists, reports and settings (ported from src/lib/server/manage-ops.ts).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from ..auth import ROLES, LOCK_AFTER, SessionUser, at_least, check_password_rules, hash_password, new_user_id, write_log
from ..db import in_list, q, UPSERT_SETTING
from ..util import HttpError, is_num, now
from .activity import UNDOABLE, undo_entry

DAY = 24 * 3600_000


def day_key(t: int) -> str:
    """Days are counted in Malaysia time (UTC+8)."""
    return datetime.fromtimestamp((t + 8 * 3600_000) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _clean_id(v) -> str:
    return v.strip().lower() if isinstance(v, str) else ""


def _role_of(v) -> str:
    if isinstance(v, str) and v in ROLES:
        return v
    raise HttpError(400, "Unknown role")


def _active_owners(except_id: str | None = None) -> int:
    r = q.first("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND disabled = 0 AND id != ?", except_id or "")
    return int((r or {}).get("n") or 0)


def _dumps(v) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------- accounts (Owner only)

def users_list(user: SessionUser, b: dict):
    rows = q.all(
        """SELECT u.id, u.username, u.display_name AS name, u.role, u.disabled, u.locked_until, u.last_login_at, u.created_at, u.created_by, u.avatar_key AS avatarKey,
                  (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS sessions
             FROM users u ORDER BY u.role = 'owner' DESC, u.role = 'editor' DESC, u.display_name""",
        now(),
    )
    return {"users": rows}


def users_create(user: SessionUser, b: dict):
    username = _clean_id(b.get("username"))
    if not re.fullmatch(r"[a-z0-9._-]{3,40}", username):
        raise HttpError(400, "ID: 3–40 letters, numbers, dot, dash or underscore")
    if q.first("SELECT id FROM users WHERE username = ?", username):
        raise HttpError(409, "That ID is already taken")
    name = b["name"].strip()[:60] if isinstance(b.get("name"), str) and b["name"].strip() else username
    role = _role_of(b.get("role"))
    h = hash_password(check_password_rules(b.get("password")))
    uid = new_user_id()
    t = now()
    q.run(
        "INSERT INTO users (id,username,display_name,role,pass_hash,pass_salt,pass_iter,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        uid, username, name, role, h["hash"], h["salt"], h["iter"], t, user.username, t,
    )
    write_log(user, {"kind": "security", "action": "user.create", "summary": f"{user.name} added {name} ({username}) as {role}", "targetType": "user", "targetIds": [uid]})
    return {"id": uid}


def users_update(user: SessionUser, b: dict):
    uid = str(b.get("id") if b.get("id") is not None else "")
    u = q.first("SELECT id, username, display_name, role, disabled FROM users WHERE id = ?", uid)
    if not u:
        raise HttpError(404, "Account not found")
    sets, vals, said = [], [], []
    if isinstance(b.get("name"), str) and b["name"].strip() and b["name"].strip() != u["display_name"]:
        sets.append("display_name = ?")
        vals.append(b["name"].strip()[:60])
        said.append(f"renamed to “{b['name'].strip()}”")
    if "role" in b:
        role = _role_of(b.get("role"))
        if role != u["role"]:
            if u["role"] == "owner" and _active_owners(u["id"]) == 0:
                raise HttpError(400, "There must always be at least one Owner")
            sets.append("role = ?")
            vals.append(role)
            said.append(f"role {u['role']} → {role}")
    if isinstance(b.get("disabled"), bool) and b["disabled"] != bool(u["disabled"]):
        if u["id"] == user.id:
            raise HttpError(400, "You can't disable your own account")
        if b["disabled"] and u["role"] == "owner" and _active_owners(u["id"]) == 0:
            raise HttpError(400, "There must always be at least one Owner")
        sets.append("disabled = ?")
        vals.append(1 if b["disabled"] else 0)
        said.append("disabled" if b["disabled"] else "enabled")
    if b.get("unlock") is True:
        sets.append("locked_until = NULL, failed_count = 0")
        said.append("unlocked")
    if not sets:
        return {"ok": True}
    sets.append("updated_at = ?")
    vals.append(now())
    q.run(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", *vals, uid)
    if b.get("disabled") is True:
        q.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now(), uid)
    write_log(user, {"kind": "security", "action": "user.update", "summary": f"{user.name} changed {u['display_name']} ({u['username']}): {', '.join(said)}", "targetType": "user", "targetIds": [uid]})
    return {"ok": True}


def users_password(user: SessionUser, b: dict):
    uid = str(b.get("id") if b.get("id") is not None else "")
    u = q.first("SELECT display_name, username FROM users WHERE id = ?", uid)
    if not u:
        raise HttpError(404, "Account not found")
    h = hash_password(check_password_rules(b.get("password")))
    t = now()
    q.batch(
        [
            ("UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, failed_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?", [h["hash"], h["salt"], h["iter"], t, uid]),
            ("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?", [t, uid, user.session_id or ""]),
        ]
    )
    write_log(user, {"kind": "security", "action": "user.password", "summary": f"{user.name} set a new password for {u['display_name']} ({u['username']})", "targetType": "user", "targetIds": [uid]})
    return {"ok": True}


def users_signout(user: SessionUser, b: dict):
    uid = str(b.get("id") if b.get("id") is not None else "")
    u = q.first("SELECT display_name FROM users WHERE id = ?", uid)
    if not u:
        raise HttpError(404, "Account not found")
    q.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?", now(), uid, user.session_id or "")
    write_log(user, {"kind": "security", "action": "user.signout", "summary": f"{user.name} signed {u['display_name']} out of every device", "targetType": "user", "targetIds": [uid]})
    return {"ok": True}


def users_delete(user: SessionUser, b: dict):
    uid = str(b.get("id") if b.get("id") is not None else "")
    if uid == user.id:
        raise HttpError(400, "You can't delete your own account")
    u = q.first("SELECT display_name, username, role, avatar_key FROM users WHERE id = ?", uid)
    if not u:
        raise HttpError(404, "Account not found")
    if u["role"] == "owner" and _active_owners(uid) == 0:
        raise HttpError(400, "There must always be at least one Owner")
    q.batch([("DELETE FROM sessions WHERE user_id = ?", [uid]), ("DELETE FROM settings WHERE `key` = ?", [_pins_key(uid)]), ("DELETE FROM users WHERE id = ?", [uid])])
    if u.get("avatar_key"):
        from ..storage import storage

        storage().delete([u["avatar_key"]])
    write_log(user, {"kind": "security", "action": "user.delete", "summary": f"{user.name} deleted the account of {u['display_name']} ({u['username']})", "targetType": "user", "targetIds": [uid]})
    return {"ok": True}


# ---------------------------------------------------------------- the log

def audit_list(user: SessionUser, b: dict):
    where, vals = [], []
    kind = "security" if b.get("kind") == "security" else "all" if b.get("kind") == "all" else "content"
    if kind in ("security", "all") and not at_least(user.role, "owner"):
        raise HttpError(403, "Only an Owner can see the security log.")
    if kind != "all":
        where.append("kind = ?")
        vals.append(kind)
    if isinstance(b.get("user"), str) and b["user"]:
        where.append("username = ?")
        vals.append(b["user"])
    if isinstance(b.get("action"), str) and b["action"]:
        where.append("action LIKE ?")
        vals.append(f"{b['action']}%")
    if is_num(b.get("from")):
        where.append("at >= ?")
        vals.append(b["from"])
    if is_num(b.get("to")):
        where.append("at < ?")
        vals.append(b["to"])
    if isinstance(b.get("q"), str) and b["q"].strip():
        where.append("(summary LIKE ? OR username LIKE ? OR ip LIKE ?)")
        s = f"%{b['q'].strip()[:80]}%"
        vals += [s, s, s]
    if is_num(b.get("before")):
        where.append("id < ?")
        vals.append(b["before"])
    try:
        limit = int(float(b.get("limit") or 100))
    except (TypeError, ValueError):
        limit = 100
    limit = min(500, max(1, limit or 100))
    rows = q.all(
        f"""SELECT id, at, user_id, username, kind, action, summary, target_type, target_ids, folder_id, ip, ua, undone_at, undone_by, (`before` IS NOT NULL) AS has_before
              FROM audit_log {'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY id DESC LIMIT ?""",
        *vals,
        limit,
    )
    can_undo = at_least(user.role, "editor")
    entries = []
    for r in rows:
        try:
            r["target_ids"] = json.loads(r["target_ids"]) if r["target_ids"] else []
        except ValueError:
            r["target_ids"] = []
        r["undoable"] = bool(not r["undone_at"] and r["action"] in UNDOABLE and (r["has_before"] or r["action"] == "folder.create") and can_undo)
        entries.append(r)
    people = [p["username"] for p in q.all("SELECT DISTINCT username FROM audit_log WHERE username IS NOT NULL ORDER BY username")]
    return {"entries": entries, "people": people, "more": len(entries) == limit}


def audit_undo(user: SessionUser, b: dict):
    try:
        eid = int(float(b.get("id")))
    except (TypeError, ValueError):
        raise HttpError(404, "Log entry not found") from None
    e = q.first("SELECT id, action, `before`, target_ids, summary, undone_at, kind, folder_id FROM audit_log WHERE id = ?", eid)
    if not e:
        raise HttpError(404, "Log entry not found")
    if e["kind"] != "content" or e["action"] not in UNDOABLE:
        raise HttpError(400, "This can't be undone")
    if e["undone_at"]:
        raise HttpError(409, "Already undone")
    summary = undo_entry(user, e)
    q.run("UPDATE audit_log SET undone_at = ?, undone_by = ? WHERE id = ?", now(), user.username, eid)
    write_log(user, {"kind": "content", "action": "undo", "summary": summary, "targetIds": json.loads(e["target_ids"]) if e["target_ids"] else None, "folderId": e["folder_id"], "detail": {"entry": eid}})
    return {"ok": True}


# ---------------------------------------------------------------- version history

def versions_list(user: SessionUser, b: dict):
    item_id = str(b.get("itemId") if b.get("itemId") is not None else "")
    rows = q.all(
        "SELECT id, file_id, reason, lang, kind, name, size, width, height, key_orig, key_opt, key_thumb, key_poster, created_at, replaced_at, replaced_by FROM file_versions WHERE item_id = ? ORDER BY replaced_at DESC",
        item_id,
    )
    return {"versions": rows, "keepDays": 90}


# ---------------------------------------------------------------- reports

def _days(b: dict) -> int:
    try:
        d = int(float(b.get("days") or 30))
    except (TypeError, ValueError):
        d = 30
    return min(365, max(1, d or 30))


_MY_DAY = "DATE_FORMAT(FROM_UNIXTIME(FLOOR(at / 1000) + 28800), '%Y-%m-%d')"
_MY_MONTH = "DATE_FORMAT(FROM_UNIXTIME(FLOOR(f.created_at / 1000) + 28800), '%Y-%m')"


def reports_team(user: SessionUser, b: dict):
    days = _days(b)
    since = now() - days * DAY
    acts = q.all(
        "SELECT username, action, COUNT(*) AS n, MAX(at) AS last FROM audit_log WHERE kind = 'content' AND at >= ? AND username IS NOT NULL GROUP BY username, action",
        since,
    )
    per_day = q.all(f"SELECT {_MY_DAY} AS day, COUNT(*) AS n FROM audit_log WHERE kind = 'content' AND at >= ? GROUP BY day ORDER BY day", since)
    users = q.all("SELECT username, display_name AS name, role, last_login_at FROM users ORDER BY created_at, id")
    return {"days": days, "actions": acts, "perDay": per_day, "users": users}


def reports_storage(user: SessionUser, b: dict):
    live = q.first(
        "SELECT COUNT(*) AS files, COALESCE(SUM(f.size),0) AS orig, COALESCE(SUM(f.opt_size),0) AS opt FROM files f JOIN items i ON i.id = f.item_id WHERE i.deleted_at IS NULL AND f.status = 'ready'"
    )
    trash = q.first(
        "SELECT COUNT(*) AS files, COALESCE(SUM(f.size),0) + COALESCE(SUM(f.opt_size),0) AS bytes FROM files f JOIN items i ON i.id = f.item_id WHERE i.deleted_at IS NOT NULL"
    )
    versions = q.first("SELECT COUNT(*) AS files, COALESCE(SUM(size),0) + COALESCE(SUM(opt_size),0) AS bytes FROM file_versions")
    months = q.all(
        f"SELECT {_MY_MONTH} AS month, COUNT(*) AS files, COALESCE(SUM(f.size),0) + COALESCE(SUM(f.opt_size),0) AS bytes FROM files f GROUP BY month ORDER BY month"
    )
    return {"live": live, "trash": trash, "versions": versions, "months": months}


# ---------------------------------------------------------------- settings

def settings_get(user: SessionUser, b: dict):
    rows = q.all("SELECT `key`, value, updated_at, updated_by FROM settings WHERE `key` = 'security'")
    out = {}
    for r in rows:
        out[r["key"]] = {"value": json.loads(r["value"]), "updatedAt": r["updated_at"], "updatedBy": r["updated_by"]}
    return out


def settings_set(user: SessionUser, b: dict):
    if b.get("key") == "security":
        if not at_least(user.role, "owner"):
            raise HttpError(403, "Only an Owner can change security settings.")
        v = b.get("value") if isinstance(b.get("value"), dict) else {}
        value = {"lockout": v.get("lockout") is True}
        q.run(UPSERT_SETTING, "security", _dumps(value), now(), user.username)
        if not value["lockout"]:
            q.run("UPDATE users SET failed_count = 0, locked_until = NULL WHERE locked_until IS NOT NULL OR failed_count > 0")
        write_log(user, {"kind": "security", "action": "settings.security", "summary": f"{user.name} turned {'on' if value['lockout'] else 'off'} locking accounts after {LOCK_AFTER} wrong passwords"})
        return {"ok": True, "value": value}
    raise HttpError(400, "Unknown setting")


# ---------------------------------------------------------------- pinned folders (per person)

PINS_MAX = 30


def _pins_key(user_id: str) -> str:
    return f"pins:{user_id}"


def pins_of(user_id: str) -> list[str]:
    """The folders this person pinned to their sidebar, in their order (for the tree response)."""
    r = q.first("SELECT value FROM settings WHERE `key` = ?", _pins_key(user_id))
    try:
        v = json.loads(r["value"]) if r else []
    except ValueError:
        return []
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def pins_set(user: SessionUser, b: dict):
    """{ folderIds: [...] } — the whole list, in order. Unknown folders are dropped; it's only a shortcut list."""
    raw = b.get("folderIds")
    if not isinstance(raw, list):
        raise HttpError(400, "folderIds must be a list")
    ids: list[str] = []
    for x in raw:
        if isinstance(x, str) and x and x not in ids:
            ids.append(x[:64])
    if len(ids) > PINS_MAX:
        raise HttpError(400, f"You can pin up to {PINS_MAX} folders.")
    if ids:
        known = {r["id"] for r in q.all(f"SELECT id FROM folders WHERE id IN ({in_list(len(ids))})", *ids)}
        ids = [x for x in ids if x in known]
    q.run(UPSERT_SETTING, _pins_key(user.id), json.dumps(ids), now(), user.username)
    return {"pins": ids}


MANAGE_OPS = {
    "users.list": users_list,
    "users.create": users_create,
    "users.update": users_update,
    "users.password": users_password,
    "users.signout": users_signout,
    "users.delete": users_delete,
    "audit.list": audit_list,
    "audit.undo": audit_undo,
    "versions.list": versions_list,
    "reports.team": reports_team,
    "reports.storage": reports_storage,
    "settings.get": settings_get,
    "settings.set": settings_set,
    "pins.set": pins_set,
}
