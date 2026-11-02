"""
Sign-in for the admin panel (ported from src/app/api/auth/[op]/route.ts):

  GET  /api/auth/me          who is signed in (or { user: null, needsSetup, setupNeedsKey })
  POST /api/auth/login       { username, password }
  POST /api/auth/logout
  POST /api/auth/setup       { username, name, password, key } — first Owner, only while there are no accounts
  POST /api/auth/password    { current, next } — change your own password
  GET  /api/auth/sessions    your signed-in devices
  POST /api/auth/revoke      { id } or { others: true } — sign devices out
  POST /api/auth/lang        { lang: 'en' | 'zh' } — your admin panel language
"""
from __future__ import annotations

import hmac
import re

from flask import Blueprint, current_app, request

from ..auth import (
    LOCK_AFTER,
    LOCK_MS,
    check_origin,
    check_password_rules,
    clear_cookie,
    client_info,
    create_session,
    get_user,
    hash_password,
    lockout_on,
    new_user_id,
    require_user,
    session_cookie,
    verify_password,
    write_log,
)
from ..db import q
from ..util import HttpError, json_response, now

bp = Blueprint("auth_api", __name__)
NO_STORE = {"Cache-Control": "no-store"}


def _body() -> dict:
    b = request.get_json(silent=True, force=True)
    return b if isinstance(b, dict) else {}


def _clean_id(v) -> str:
    return v.strip().lower()[:40] if isinstance(v, str) else ""


def _ui_lang(user_id: str):
    try:
        r = q.first("SELECT ui_lang FROM users WHERE id = ?", user_id)
        return r["ui_lang"] if r and r["ui_lang"] in ("en", "zh") else None
    except Exception:  # noqa: BLE001 - column missing on an old database
        return None


def _with_cookie(data: dict, cookie: str):
    res = json_response(data, headers=NO_STORE)
    res.headers.add("Set-Cookie", cookie)
    return res


@bp.get("/api/auth/<op>")
def auth_get(op: str):
    if op == "me":
        user = get_user()
        if user:
            return json_response({"user": {"id": user.id, "username": user.username, "name": user.name, "role": user.role, "lang": _ui_lang(user.id)}}, headers=NO_STORE)
        n = q.first("SELECT COUNT(*) AS n FROM users")
        return json_response(
            {"user": None, "needsSetup": not (n or {}).get("n"), "setupNeedsKey": not current_app.config["ALLOW_SETUP_WITHOUT_KEY"]},
            headers=NO_STORE,
        )
    if op == "sessions":
        user = require_user()
        rows = q.all(
            "SELECT id, created_at, last_seen, ip, ua FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen DESC",
            user.id,
            now(),
        )
        return json_response({"sessions": [{**r, "id": r["id"][:16], "current": r["id"] == user.session_id} for r in rows]}, headers=NO_STORE)
    raise HttpError(404, "Unknown request")


@bp.post("/api/auth/<op>")
def auth_post(op: str):
    check_origin()
    b = _body()

    if op == "login":
        username = _clean_id(b.get("username"))
        password = b.get("password") if isinstance(b.get("password"), str) else ""
        ip = client_info()["ip"]
        lockout = lockout_on()
        # many failures from one place in a short time: slow everyone there down
        if lockout and ip:
            recent = q.first("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login.fail' AND ip = ? AND at > ?", ip, now() - 15 * 60_000)
            if (recent or {}).get("n", 0) >= 20:
                raise HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.")
        u = q.first("SELECT * FROM users WHERE username = ?", username)

        def fail(why: str, who=u):
            write_log(
                {"id": who["id"], "username": who["username"]} if who else {"id": "", "username": username or "(blank)"},
                {"kind": "security", "action": "login.fail", "summary": f'Failed sign-in for "{username or "(blank)"}" — {why}'},
            )

        if not u:
            hash_password(password or "x")  # same time as a real check
            fail("unknown ID", None)
            raise HttpError(401, "Wrong ID or password.")
        if u["disabled"]:
            fail("account disabled")
            raise HttpError(403, "This account is disabled. Ask an Owner.")
        if lockout and u["locked_until"] and u["locked_until"] > now():
            fail("account locked")
            mins = -(-(u["locked_until"] - now()) // 60_000)
            raise HttpError(429, f"Too many wrong passwords. Try again in {mins} minute{'' if mins == 1 else 's'}.")
        if not verify_password(password, u):
            n = u["failed_count"] + 1
            lock = lockout and n >= LOCK_AFTER
            q.run("UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?", 0 if (lock or not lockout) else n, now() + LOCK_MS if lock else None, u["id"])
            fail(f"wrong password — locked for {LOCK_MS // 60_000} minutes" if lock else "wrong password")
            if lock:
                write_log(
                    {"id": u["id"], "username": u["username"]},
                    {"kind": "security", "action": "user.locked", "summary": f'"{u["username"]}" was locked for {LOCK_MS // 60_000} minutes after {LOCK_AFTER} wrong passwords'},
                )
            raise HttpError(401, f"Too many wrong passwords. Locked for {LOCK_MS // 60_000} minutes." if lock else "Wrong ID or password.")
        q.run("UPDATE users SET failed_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", now(), u["id"])
        token = create_session(u["id"])
        write_log(u, {"kind": "security", "action": "login.ok", "summary": f"{u['display_name']} signed in"})
        return _with_cookie({"user": {"id": u["id"], "username": u["username"], "name": u["display_name"], "role": u["role"], "lang": _ui_lang(u["id"])}}, session_cookie(token))

    if op == "logout":
        user = get_user()
        if user and user.session_id:
            q.run("UPDATE sessions SET revoked_at = ? WHERE id = ?", now(), user.session_id)
            write_log(user, {"kind": "security", "action": "logout", "summary": f"{user.name} signed out"})
        return _with_cookie({"ok": True}, clear_cookie())

    if op == "setup":
        n = q.first("SELECT COUNT(*) AS n FROM users")
        if (n or {}).get("n"):
            raise HttpError(409, "An Owner account already exists. Please sign in.")
        cfg = current_app.config
        if not cfg["ALLOW_SETUP_WITHOUT_KEY"]:
            if not cfg.get("SETUP_KEY"):
                raise HttpError(503, "Set the SETUP_KEY secret on the server first.")
            if not isinstance(b.get("key"), str) or not hmac.compare_digest(b["key"], cfg["SETUP_KEY"]):
                raise HttpError(403, "Wrong setup key.")
        username = _clean_id(b.get("username"))
        if not re.fullmatch(r"[a-z0-9._-]{3,40}", username):
            raise HttpError(400, "ID: 3–40 letters, numbers, dot, dash or underscore")
        name = b["name"].strip()[:60] if isinstance(b.get("name"), str) and b["name"].strip() else username
        pw = check_password_rules(b.get("password"))
        h = hash_password(pw)
        uid = new_user_id()
        t = now()
        # the "no accounts yet" check and the insert can't race into two Owners: INSERT … WHERE NOT EXISTS
        with q.transaction() as conn:
            res = q.exec(
                conn,
                """INSERT INTO users (id,username,display_name,role,pass_hash,pass_salt,pass_iter,created_at,updated_at,last_login_at)
                   SELECT ?,?,?,?,?,?,?,?,?,? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users)""",
                uid, username, name, "owner", h["hash"], h["salt"], h["iter"], t, t, t,
            )
            if res.rowcount != 1:
                raise HttpError(409, "An Owner account already exists. Please sign in.")
        token = create_session(uid)
        write_log({"id": uid, "username": username}, {"kind": "security", "action": "user.setup", "summary": f"{name} created the first Owner account"})
        return _with_cookie({"user": {"id": uid, "username": username, "name": name, "role": "owner"}}, session_cookie(token))

    if op == "password":
        user = require_user()
        if user.id == "api":
            raise HttpError(400, "Not for scripts")
        row = q.first("SELECT pass_hash, pass_salt, pass_iter FROM users WHERE id = ?", user.id)
        if not row or not verify_password(b.get("current") if isinstance(b.get("current"), str) else "", row):
            raise HttpError(400, "Current password is wrong.")
        h = hash_password(check_password_rules(b.get("next")))
        q.batch(
            [
                ("UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, updated_at = ? WHERE id = ?", [h["hash"], h["salt"], h["iter"], now(), user.id]),
                ("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL", [now(), user.id, user.session_id or ""]),
            ]
        )
        write_log(user, {"kind": "security", "action": "password.change", "summary": f"{user.name} changed their password (other devices signed out)"})
        return json_response({"ok": True})

    if op == "lang":
        user = require_user()
        if b.get("lang") not in ("en", "zh"):
            raise HttpError(400, "Unknown language")
        if user.id == "api":
            return json_response({"ok": True, "saved": False})
        try:
            q.run("UPDATE users SET ui_lang = ? WHERE id = ?", b["lang"], user.id)
            return json_response({"ok": True, "saved": True})
        except Exception:  # noqa: BLE001
            return json_response({"ok": True, "saved": False})

    if op == "revoke":
        user = require_user()
        t = now()
        if b.get("others") is True:
            q.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL", t, user.id, user.session_id or "")
            write_log(user, {"kind": "security", "action": "sessions.revoke", "summary": f"{user.name} signed out all their other devices"})
        elif isinstance(b.get("id"), str) and len(b["id"]) >= 8 and re.fullmatch(r"[0-9a-f]+", b["id"]):
            q.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id LIKE CONCAT(?, '%') AND revoked_at IS NULL", t, user.id, b["id"])
            write_log(user, {"kind": "security", "action": "sessions.revoke", "summary": f"{user.name} signed out one of their devices"})
        return json_response({"ok": True})

    raise HttpError(404, "Unknown request")
