"""The Super admin: everything an Owner has, plus powers only she has; made on the server only."""
from tests.conftest import PASSWORD, login, make_user, op


def me(c):
    return c.get("/api/auth/me").get_json()["user"]


def users(c):
    return {u["username"]: u for u in op(c, "users.list")["users"]}


def test_without_a_super_admin_owners_keep_every_power(owner, app):
    assert me(owner)["powers"] == {"super": False, "manageOwners": True, "deleteUsers": True, "settings": True, "securityLog": True}
    uid = make_user(app, "ed", role="editor")
    op(owner, "users.create", {"name": "Second", "username": "owner2", "role": "owner", "password": PASSWORD})
    op(owner, "users.delete", {"id": uid})
    op(owner, "audit.list", {"kind": "security"})


def test_cli_creates_and_promotes(app):
    r = app.test_cli_runner().invoke(args=["create-superadmin"], input=f"boss\nThe Boss\n{PASSWORD}\n{PASSWORD}\n")
    assert r.exit_code == 0, r.output
    make_user(app, "owner1")
    r = app.test_cli_runner().invoke(args=["create-superadmin", "--promote", "owner1"])
    assert r.exit_code == 0 and "Super admin" in r.output
    c = app.test_client()
    login(c, "owner1")
    assert me(c)["role"] == "superadmin" and me(c)["powers"]["super"] is True


def test_her_powers_and_her_protected_account(owner, app):
    sid = make_user(app, "boss", role="superadmin", name="The Boss")
    boss = app.test_client()
    login(boss, "boss")
    other_owner = make_user(app, "owner2", role="owner")
    ed = make_user(app, "ed", role="editor")

    # Owners lose the Super admin's powers once she exists
    assert me(owner)["powers"] == {"super": False, "manageOwners": False, "deleteUsers": False, "settings": False, "securityLog": False}
    op(owner, "users.create", {"name": "X", "username": "owner3", "role": "owner", "password": PASSWORD}, status=403)
    op(owner, "users.update", {"id": ed, "role": "owner"}, status=403)
    op(owner, "users.update", {"id": other_owner, "disabled": True}, status=403)
    op(owner, "users.password", {"id": other_owner, "password": PASSWORD + "x"}, status=403)
    op(owner, "users.delete", {"id": ed}, status=403)
    op(owner, "audit.list", {"kind": "security"}, status=403)
    op(owner, "settings.set", {"key": "security", "value": {"lockout": True}}, status=403)
    assert owner.post("/api/admin/backup/settings", json={"mirrorDeletes": True}).status_code == 403
    assert owner.post("/api/admin/drive/disconnect").status_code == 403
    # …but still run Editors and Viewers, and the library itself
    op(owner, "users.update", {"id": ed, "role": "viewer"})
    op(owner, "users.create", {"name": "V", "username": "view2", "role": "viewer", "password": PASSWORD})
    op(owner, "audit.list", {"kind": "content"})

    # her account is protected
    op(owner, "users.update", {"id": sid, "disabled": True}, status=403)
    op(owner, "users.password", {"id": sid, "password": PASSWORD + "x"}, status=403)
    op(owner, "users.signout", {"id": sid}, status=403)
    # and the role can't be given or taken from the website, by anyone
    op(boss, "users.create", {"name": "Y", "username": "boss2", "role": "superadmin", "password": PASSWORD}, status=400)
    op(boss, "users.update", {"id": ed, "role": "superadmin"}, status=400)

    # she can do all of it
    assert me(boss)["powers"]["super"] is True
    op(boss, "users.update", {"id": ed, "role": "owner"})
    op(boss, "users.update", {"id": other_owner, "disabled": True})
    op(boss, "audit.list", {"kind": "security"})
    op(boss, "settings.set", {"key": "security", "value": {"lockout": True}})
    op(boss, "users.delete", {"id": other_owner})
    assert "owner2" not in users(boss) and users(boss)["boss"]["role"] == "superadmin"
    assert list(users(boss))[0] == "boss"  # listed first


def test_she_counts_as_someone_who_can_run_the_library(app, client):
    sid = make_user(app, "boss", role="superadmin")
    oid = make_user(app, "owner1", role="owner")
    login(client, "boss")
    op(client, "users.delete", {"id": oid})  # she's still there, so the last Owner can go
    r = op(client, "users.delete", {"id": sid}, status=400)
    assert "own account" in r["error"]
