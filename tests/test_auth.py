"""Sign-in, sessions, expiry, revocation, lock-out, roles, origin checks."""
import hashlib

from tests.conftest import PASSWORD, login, make_user, op, run_sql, sql


def test_first_owner_setup_needs_key(app, client):
    me = client.get("/api/auth/me").get_json()
    assert me == {"user": None, "needsSetup": True, "setupNeedsKey": True}
    body = {"username": "Moon", "name": "Moon", "password": PASSWORD}
    assert client.post("/api/auth/setup", json={**body, "key": "wrong"}).status_code == 403
    r = client.post("/api/auth/setup", json={**body, "key": "setup-key-123"})
    assert r.status_code == 200
    assert r.get_json()["user"]["username"] == "moon" and r.get_json()["user"]["role"] == "owner"
    assert client.get("/api/auth/me").get_json()["user"]["username"] == "moon"
    again = client.post("/api/auth/setup", json={**body, "key": "setup-key-123"})
    assert again.status_code == 409 and again.get_json()["error"] == "An Owner account already exists. Please sign in."


def test_setup_without_key_only_when_allowed(app, client):
    app.config["SETUP_KEY"] = None
    r = client.post("/api/auth/setup", json={"username": "moon", "password": PASSWORD})
    assert r.status_code == 503 and r.get_json()["error"] == "Set the SETUP_KEY secret on the server first."
    app.config["ALLOW_SETUP_WITHOUT_KEY"] = True
    assert client.post("/api/auth/setup", json={"username": "moon", "password": PASSWORD}).status_code == 200
    app.config["SETUP_KEY"] = "setup-key-123"


def test_login_cookie_and_hashed_session(app, client):
    make_user(app)
    r = login(client)
    cookie = r.headers["Set-Cookie"]
    assert cookie.startswith("moonlib_session=") and "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Path=/" in cookie
    assert "Max-Age=1209600" in cookie and "Secure" not in cookie  # http in development
    token = cookie.split(";")[0].split("=", 1)[1]
    rows = sql(app, "SELECT id FROM sessions")
    assert len(rows) == 1 and rows[0]["id"] == hashlib.sha256(token.encode()).hexdigest() and token not in str(rows)
    me = client.get("/api/auth/me").get_json()["user"]
    assert me == {"id": me["id"], "username": "owner1", "name": "Owner1", "role": "owner", "lang": None}


def test_secure_cookie_in_production(app, client):
    make_user(app)
    app.config["COOKIE_SECURE_ALWAYS"] = True
    assert "; Secure" in login(client).headers["Set-Cookie"]
    assert "; Secure" in client.post("/api/auth/logout").headers["Set-Cookie"]


def test_wrong_password_and_unknown_id_same_message(app, client):
    make_user(app)
    a = client.post("/api/auth/login", json={"username": "owner1", "password": "nope"})
    b = client.post("/api/auth/login", json={"username": "ghost", "password": "nope"})
    assert a.status_code == b.status_code == 401
    assert a.get_json() == b.get_json() == {"error": "Wrong ID or password."}
    log = sql(app, "SELECT action, summary FROM audit_log ORDER BY id")
    assert [x["action"] for x in log] == ["login.fail", "login.fail"]
    assert log[0]["summary"] == 'Failed sign-in for "owner1" — wrong password'


def test_idle_and_absolute_expiry(app, client):
    make_user(app)
    login(client)
    assert client.get("/api/admin/tree").status_code == 200
    run_sql(app, "UPDATE sessions SET last_seen = last_seen - ?", 12 * 3600_000 + 1000)
    r = client.get("/api/admin/tree")
    assert r.status_code == 401 and r.get_json()["error"] == "Please sign in."
    login(client)
    run_sql(app, "UPDATE sessions SET expires_at = 1")
    assert client.get("/api/admin/tree").status_code == 401


def test_last_seen_refreshes_after_five_minutes(app, client):
    make_user(app)
    login(client)
    run_sql(app, "UPDATE sessions SET last_seen = last_seen - 600000")
    before = sql(app, "SELECT last_seen FROM sessions")[0]["last_seen"]
    client.get("/api/auth/me")
    assert sql(app, "SELECT last_seen FROM sessions")[0]["last_seen"] > before


def test_logout_and_revoke(app, client):
    make_user(app)
    other = app.test_client()
    login(client)
    login(other)
    sessions = client.get("/api/auth/sessions").get_json()["sessions"]
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1 and all(len(s["id"]) == 16 for s in sessions)
    mine_other = next(s for s in sessions if not s["current"])
    assert op(client, "users.list")["users"][0]["sessions"] == 2
    client.post("/api/auth/revoke", json={"id": mine_other["id"]})
    assert other.get("/api/auth/me").get_json()["user"] is None
    assert client.get("/api/auth/me").get_json()["user"] is not None
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").get_json()["user"] is None


def test_password_change_signs_out_other_devices(app, client):
    make_user(app)
    other = app.test_client()
    login(client)
    login(other)
    assert client.post("/api/auth/password", json={"current": "bad", "next": "new password 1"}).get_json()["error"] == "Current password is wrong."
    assert client.post("/api/auth/password", json={"current": PASSWORD, "next": "short"}).get_json()["error"] == "Password must be at least 8 characters"
    assert client.post("/api/auth/password", json={"current": PASSWORD, "next": "new password 1"}).status_code == 200
    assert client.get("/api/auth/me").get_json()["user"] is not None
    assert other.get("/api/auth/me").get_json()["user"] is None
    login(other, password="new password 1")


def test_lockout_when_turned_on(app, client):
    make_user(app)
    make_user(app, "ed", "editor")
    login(client)
    op(client, "settings.set", {"key": "security", "value": {"lockout": True}})
    c2 = app.test_client()
    for _ in range(4):
        assert c2.post("/api/auth/login", json={"username": "ed", "password": "x"}).status_code == 401
    r = c2.post("/api/auth/login", json={"username": "ed", "password": "x"})
    assert r.status_code == 401 and r.get_json()["error"] == "Too many wrong passwords. Locked for 15 minutes."
    r = c2.post("/api/auth/login", json={"username": "ed", "password": PASSWORD})
    assert r.status_code == 429 and r.get_json()["error"] == "Too many wrong passwords. Try again in 15 minutes."
    # turning lock-out off lifts the lock
    op(client, "settings.set", {"key": "security", "value": {"lockout": False}})
    login(c2, "ed")


def test_lockout_off_by_default(app, client):
    make_user(app)
    for _ in range(8):
        client.post("/api/auth/login", json={"username": "owner1", "password": "x"})
    login(client)


def test_disabled_account(app, client):
    make_user(app)
    uid = make_user(app, "ed", "editor")
    ed = app.test_client()
    login(ed, "ed")
    login(client)
    op(client, "users.update", {"id": uid, "disabled": True})
    assert ed.get("/api/admin/tree").status_code == 401
    r = ed.post("/api/auth/login", json={"username": "ed", "password": PASSWORD})
    assert r.status_code == 403 and r.get_json()["error"] == "This account is disabled. Ask an Owner."
    assert op(client, "users.update", {"id": sql(app, "SELECT id FROM users WHERE username='owner1'")[0]["id"], "disabled": True}, status=400)["error"] == "You can't disable your own account"


def test_role_enforcement(app, client):
    make_user(app)
    make_user(app, "ed", "editor")
    make_user(app, "vi", "viewer")
    ed, vi = app.test_client(), app.test_client()
    login(ed, "ed")
    login(vi, "vi")
    login(client)
    fid = op(client, "folder.create", {"parentId": None, "name": {"en": "A"}})["id"]
    # viewer: reads only
    assert vi.get("/api/admin/tree").status_code == 200
    r = vi.post("/api/admin/folder.create", json={"parentId": None, "name": {"en": "B"}})
    assert r.status_code == 403 and r.get_json()["error"] == "Your role can't make changes."
    assert vi.post("/api/admin/reports.storage", json={}).status_code == 200
    assert vi.post("/api/admin/audit.list", json={"kind": "security"}).get_json()["error"] == "Only an Owner can see the security log."
    entries = vi.post("/api/admin/audit.list", json={}).get_json()["entries"]
    assert entries and not any(e["undoable"] for e in entries)
    assert vi.put("/api/admin/upload?key=o/abcdefgh/x.png", data=b"x").status_code == 403
    # editor: content yes, owner things no
    assert ed.post("/api/admin/folder.create", json={"parentId": None, "name": {"en": "C"}}).status_code == 200
    for o in ("purge", "users.list", "users.create"):
        r = ed.post(f"/api/admin/{o}", json={})
        assert r.status_code == 403 and r.get_json()["error"] == "Only an Owner can do this."
    assert ed.get("/api/admin/backup").status_code == 403
    assert ed.post("/api/admin/settings.set", json={"key": "security", "value": {"lockout": True}}).get_json()["error"] == "Only an Owner can change security settings."
    op(client, "trash", {"folderIds": [fid]})
    assert op(client, "purge", {"all": True})["ok"] is True


def test_not_signed_in(client):
    for method, path in (("get", "/api/admin/tree"), ("post", "/api/admin/folder.create"), ("put", "/api/admin/upload"), ("get", "/api/auth/sessions"), ("get", "/api/admin/backup")):
        r = getattr(client, method)(path, json={} if method != "get" else None)
        assert r.status_code == 401, path


def test_origin_check(app, client):
    make_user(app)
    login(client)
    r = client.post("/api/admin/folder.create", json={"name": {"en": "x"}}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and r.get_json()["error"] == "Request refused (wrong origin)"
    assert client.post("/api/auth/login", json={}, headers={"Origin": "null"}).status_code == 403
    ok = client.post("/api/admin/folder.create", json={"name": {"en": "x"}}, headers={"Origin": "http://localhost"})
    assert ok.status_code == 200
    app.config["ALLOWED_ORIGINS"] = ["http://localhost:5173"]
    assert client.post("/api/admin/folder.create", json={"name": {"en": "y"}}, headers={"Origin": "http://localhost:5173"}).status_code == 200
    app.config["ALLOWED_ORIGINS"] = []


def test_api_token_for_scripts(app, client):
    h = {"Authorization": "Bearer " + "x" * 30}
    assert client.get("/api/admin/tree", headers=h).get_json()["user"]["username"] == "api"
    assert client.get("/api/admin/tree", headers={"Authorization": "Bearer " + "y" * 30}).status_code == 401


def test_language_saved_per_account(app, client):
    make_user(app)
    login(client)
    assert client.post("/api/auth/lang", json={"lang": "fr"}).get_json()["error"] == "Unknown language"
    assert client.post("/api/auth/lang", json={"lang": "zh"}).get_json() == {"ok": True, "saved": True}
    other = app.test_client()
    assert login(other).get_json()["user"]["lang"] == "zh"


def test_last_owner_is_protected(app, client):
    uid = make_user(app)
    login(client)
    assert op(client, "users.update", {"id": uid, "role": "editor"}, status=400)["error"] == "There must always be at least one Owner"
    assert op(client, "users.delete", {"id": uid}, status=400)["error"] == "You can't delete your own account"
