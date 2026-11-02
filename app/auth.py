"""
Admin sign-in (ported from src/lib/server/auth.ts — same rules, same messages):

  * Passwords: PBKDF2-SHA256, 100 000 rounds, random 16-byte salt, stored base64.
  * Signing in sets an HttpOnly cookie (SESSION_COOKIE, default `moonlib_session`) with a random token; only its SHA-256 is
    stored, so a leaked database can't be used to sign in.
  * A session ends after 12 hours without activity, and after 14 days at most; it can be revoked.
  * Optional lock-out (off by default): 5 wrong passwords lock an account for 15 minutes.
  * Scripts can use `Authorization: Bearer <ADMIN_API_TOKEN>` (24+ characters).
  * Every role check happens here on the server.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
from dataclasses import dataclass
from urllib.parse import urlsplit

from flask import current_app, request

from .db import q
from .util import HttpError, new_id, now

log = logging.getLogger(__name__)

ROLES = ["owner", "editor", "viewer"]
_RANK = {"viewer": 1, "editor": 2, "owner": 3}

IDLE_MS = 12 * 3600_000
MAX_MS = 14 * 24 * 3600_000
LOCK_AFTER = 5
LOCK_MS = 15 * 60_000
ITER = 100_000


def _cookie() -> str:
    return current_app.config.get("SESSION_COOKIE") or "moonlib_session"


def at_least(have: str, need: str) -> bool:
    return _RANK.get(have, 0) >= _RANK[need]


@dataclass
class SessionUser:
    id: str
    username: str
    name: str
    role: str
    session_id: str | None


# ---------------------------------------------------------------- crypto helpers

def sha256hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def hash_password(pw: str, salt_b64: str | None = None, iterations: int = ITER) -> dict:
    salt = base64.b64decode(salt_b64) if salt_b64 else secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, int(iterations), dklen=32)
    return {"hash": base64.b64encode(dk).decode(), "salt": base64.b64encode(salt).decode(), "iter": int(iterations)}


def verify_password(pw: str, row: dict) -> bool:
    h = hash_password(pw, row["pass_salt"], row["pass_iter"])["hash"]
    return hmac.compare_digest(h, row["pass_hash"])


def new_token() -> str:
    return secrets.token_urlsafe(32)


def random_password() -> str:
    a = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    s = "".join(a[b % len(a)] for b in secrets.token_bytes(12))
    return f"{s[:4]}-{s[4:8]}-{s[8:12]}"


def check_password_rules(pw) -> str:
    if not isinstance(pw, str) or len(pw) < 8:
        raise HttpError(400, "Password must be at least 8 characters")
    if len(pw) > 200:
        raise HttpError(400, "Password is too long")
    return pw


# ---------------------------------------------------------------- request helpers

def client_info() -> dict:
    """IP (through the trusted proxy chain, see TRUST_PROXY_HOPS) and browser of the current request."""
    ip = request.remote_addr or None
    ua = (request.headers.get("User-Agent") or "")[:300] or None
    return {"ip": ip, "ua": ua}


def _is_https() -> bool:
    return request.scheme == "https" or request.headers.get("X-Forwarded-Proto") == "https"


def _secure_attr() -> str:
    return "; Secure" if (current_app.config["COOKIE_SECURE_ALWAYS"] or _is_https()) else ""


def session_cookie(token: str) -> str:
    return f"{_cookie()}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={MAX_MS // 1000}{_secure_attr()}"


def clear_cookie() -> str:
    return f"{_cookie()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{_secure_attr()}"


def check_origin() -> None:
    """
    Changes must come from this site's own pages: a request carrying another site's Origin is
    refused (on top of the SameSite cookie). Requests without an Origin (scripts) pass, as before.
    """
    origin = request.headers.get("Origin")
    if not origin:
        return
    try:
        parts = urlsplit(origin)
        o_host = parts.netloc
    except ValueError:
        o_host = ""
    allowed = {request.host}
    for extra in current_app.config.get("ALLOWED_ORIGINS", []):
        allowed.add(urlsplit(extra).netloc)
    if not o_host or o_host not in allowed:
        raise HttpError(403, "Request refused (wrong origin)")


# ---------------------------------------------------------------- who is signed in

def get_user() -> SessionUser | None:
    auth = request.headers.get("Authorization") or ""
    token_cfg = current_app.config.get("ADMIN_API_TOKEN") or ""
    if auth.startswith("Bearer ") and len(token_cfg) >= 24 and hmac.compare_digest(auth[7:], token_cfg):
        return SessionUser(id="api", username="api", name="Import script", role="owner", session_id=None)
    token = request.cookies.get(_cookie())
    if not token:
        return None
    sid = sha256hex(token)
    row = q.first(
        """SELECT s.id, s.last_seen, s.expires_at, s.revoked_at, u.id AS uid, u.username, u.display_name, u.role, u.disabled
             FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?""",
        sid,
    )
    t = now()
    if not row or row["revoked_at"] or row["disabled"] or t > row["expires_at"] or t - row["last_seen"] > IDLE_MS:
        return None
    if t - row["last_seen"] > 5 * 60_000:
        q.run("UPDATE sessions SET last_seen = ? WHERE id = ?", t, sid)
    return SessionUser(id=row["uid"], username=row["username"], name=row["display_name"], role=row["role"], session_id=sid)


def require_user(need: str = "viewer") -> SessionUser:
    u = get_user()
    if not u:
        raise HttpError(401, "Please sign in.")
    if not at_least(u.role, need):
        raise HttpError(403, "Only an Owner can do this." if need == "owner" else "Your role can't make changes.")
    return u


def create_session(user_id: str) -> str:
    token = new_token()
    sid = sha256hex(token)
    t = now()
    ci = client_info()
    q.run(
        "INSERT INTO sessions (id,user_id,created_at,last_seen,expires_at,ip,ua) VALUES (?,?,?,?,?,?,?)",
        sid, user_id, t, t, t + MAX_MS, ci["ip"], ci["ua"],
    )
    return token


def new_user_id() -> str:
    return new_id(12)


# ---------------------------------------------------------------- the log

def write_log(user: dict | SessionUser | None, e: dict, with_request: bool = True) -> None:
    """Adds a line to the activity / security log. Never raises (logging must not break the action)."""
    try:
        ci = client_info() if with_request and request else {"ip": None, "ua": None}
    except RuntimeError:  # outside a request (cron, CLI)
        ci = {"ip": None, "ua": None}
    try:
        uid = user.id if isinstance(user, SessionUser) else (user or {}).get("id")
        uname = user.username if isinstance(user, SessionUser) else (user or {}).get("username")
        target_ids = e.get("targetIds")
        q.run(
            """INSERT INTO audit_log (at,user_id,username,kind,action,summary,target_type,target_ids,folder_id,`before`,detail,ip,ua)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            now(),
            uid if uid is not None else None,
            uname if uname is not None else None,
            e["kind"],
            e["action"],
            str(e["summary"])[:500],
            e.get("targetType"),
            json.dumps(target_ids[:500], ensure_ascii=False, separators=(",", ":")) if target_ids is not None else None,
            e.get("folderId"),
            None if "before" not in e or e["before"] is _UNDEF else json.dumps(e["before"], ensure_ascii=False, separators=(",", ":")),
            None if "detail" not in e or e["detail"] is _UNDEF else json.dumps(e["detail"], ensure_ascii=False, separators=(",", ":")),
            ci["ip"],
            ci["ua"],
        )
    except Exception:  # noqa: BLE001
        log.exception("log failed")


class _Undefined:
    pass


_UNDEF = _Undefined()


def lockout_on() -> bool:
    try:
        r = q.first("SELECT value FROM settings WHERE `key` = 'security'")
        return bool(r and json.loads(r["value"]).get("lockout"))
    except Exception:  # noqa: BLE001
        return False
