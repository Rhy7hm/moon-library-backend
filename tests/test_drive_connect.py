"""'Connect Google Drive': the backup signing in as a person (personal Drive), against the pretend Drive."""
import json
import os
from urllib.parse import parse_qs, urlsplit

import pytest

from tests.conftest import folder, item, login, make_user, sql, upload

PNG = b"\x89PNG\r\n\x1a\n" + os.urandom(800)


@pytest.fixture
def gdrive(app):
    from app.drive import google
    from tests.fake_drive import FakeDrive

    fd = FakeDrive("robot@unused.iam.gserviceaccount.com")
    app.config.update(
        GDRIVE_CLIENT_ID="cid-123.apps.googleusercontent.com",
        GDRIVE_CLIENT_SECRET="shh",
        GDRIVE_API=fd.url,
        GDRIVE_TOKEN_URL=fd.url + "/token",
        GDRIVE_AUTH_URL=fd.url + "/auth",
        GDRIVE_REVOKE_URL=fd.url + "/revoke",
    )
    google._tokens.clear()
    yield fd
    fd.close()
    google._tokens.clear()
    app.config.update(GDRIVE_CLIENT_ID=None, GDRIVE_CLIENT_SECRET=None, GDRIVE_API=None, GDRIVE_TOKEN_URL=None, GDRIVE_AUTH_URL=None, GDRIVE_REVOKE_URL=None)


def drive_check(c):
    return next(x for x in c.get("/api/admin/status").get_json()["checks"] if x["key"] == "drive")


def connect(owner, code="good-code"):
    """Press Connect, 'allow' at Google, come back."""
    r = owner.get("/api/admin/drive/connect")
    assert r.status_code == 302
    url = urlsplit(r.headers["Location"])
    qs = {k: v[0] for k, v in parse_qs(url.query).items()}
    return qs, owner.get("/api/admin/drive/callback", query_string={"code": code, "state": qs["state"]})


def test_not_set_up(owner):
    d = drive_check(owner)
    assert d["state"] == "off" and d["canConnect"] is False and "GDRIVE_CLIENT_ID" in d["note"]
    r = owner.get("/api/admin/drive/connect")
    assert r.status_code == 400 and b"GDRIVE_CLIENT_ID" in r.data


def test_connect_back_up_and_disconnect(app, owner, gdrive):
    from app.drive.backup import run_backup

    d = drive_check(owner)
    assert d["state"] == "off" and d["canConnect"] is True and d["connected"] is False
    qs, back = connect(owner)
    # what we asked Google for: only the files this app makes, kept working offline
    assert qs["scope"] == "https://www.googleapis.com/auth/drive.file" and qs["access_type"] == "offline"
    assert "select_account" in qs["prompt"]  # Google always asks which account
    assert qs["redirect_uri"].endswith("/api/admin/drive/callback") and qs["client_id"].startswith("cid-123")
    assert back.status_code == 302 and back.headers["Location"].endswith("/admin#/settings/connections")
    # a "Moon Library backup" folder at the top of their My Drive
    made = [f for f in gdrive.files.values() if f["name"] == "Moon Library backup" and f["parents"] == ["MYROOT"]]
    assert len(made) == 1 and made[0]["driveId"] is None
    # the token is stored encrypted
    stored = sql(app, "SELECT value FROM settings WHERE `key` = 'gdrive.oauth'")[0]["value"]
    assert "r-" not in stored and "moon@example.com" not in stored
    d = drive_check(owner)
    assert d["state"] == "ok" and d["connected"] is True and d["account"] == "moon@example.com"
    facts = {f["label"]: f["value"] for f in d["facts"]}
    assert facts["Signed in as"] == "moon@example.com" and facts["Where"] == "My Drive" and "warning" not in d

    # the backup copies into it
    upload(owner, item(owner, folder(owner, "Rebate")), "a.png", PNG)
    with app.app_context():
        r = run_backup(budget_ms=30_000)
    assert r["copied"] == 1 and r["failed"] == 0
    copied = next(f for f in gdrive.files.values() if f["name"] == "a.png")
    rebate = gdrive.files[copied["parents"][0]]
    assert rebate["name"] == "Rebate" and rebate["parents"] == [made[0]["id"]]

    # connecting the same account again keeps the folder and what's in it (and cancels the old permission)
    assert connect(owner)[1].status_code == 302
    assert len([f for f in gdrive.files.values() if f["name"] == "Moon Library backup" and f["parents"] == ["MYROOT"]]) == 1
    assert sql(app, "SELECT COUNT(*) AS n FROM drive_files WHERE state = 'done'")[0]["n"] == 1

    # disconnect: Google is told, the token is forgotten, Drive keeps the copies
    assert owner.post("/api/admin/drive/disconnect").get_json() == {"ok": True}
    assert len(gdrive.revoked) == 2 and not gdrive.refresh
    assert sql(app, "SELECT COUNT(*) AS n FROM settings WHERE `key` = 'gdrive.oauth'")[0]["n"] == 0
    assert drive_check(owner)["state"] == "off" and "a.png" in {f["name"] for f in gdrive.files.values()}
    log = owner.post("/api/admin/audit.list", json={"kind": "security"}).get_json()["entries"]
    assert {"drive.connect", "drive.disconnect"} <= {e["action"] for e in log}


def test_refused_expired_and_wrong_people(app, owner, gdrive):
    # they pressed "Cancel" at Google
    r = owner.get("/api/admin/drive/callback", query_string={"error": "access_denied", "state": "x"})
    assert r.status_code == 400 and b"chose not to allow" in r.data
    # a made-up state, or one used twice
    qs, ok = connect(owner)
    assert ok.status_code == 302
    again = owner.get("/api/admin/drive/callback", query_string={"code": "good-code", "state": qs["state"]})
    assert again.status_code == 400 and b"expired" in again.data
    # a bad code
    _, bad = connect(owner, code="nope")
    assert bad.status_code == 400 and b"didn" in bad.data
    # Editors can't connect or disconnect
    make_user(app, "ed", role="editor")
    ed = app.test_client()
    login(ed, "ed")
    assert ed.get("/api/admin/drive/connect").status_code == 400
    assert ed.post("/api/admin/drive/disconnect").status_code == 403


def test_permission_removed_at_google_shows_reconnect(app, owner, gdrive):
    from app.drive import google

    connect(owner)
    gdrive.refresh.clear()  # someone removed the app in their Google account settings
    google._tokens.clear()
    d = drive_check(owner)
    assert d["state"] == "fail" and "Connect Google Drive again" in d["error"] and d["connected"] is True


def test_secret_key_changed(app, owner, gdrive):
    connect(owner)
    old = app.config["SECRET_KEY"]
    app.config["SECRET_KEY"] = "a-different-one"
    try:
        d = drive_check(owner)
        assert d["state"] == "fail" and "SECRET_KEY" in d["error"] and d["connected"] is False
    finally:
        app.config["SECRET_KEY"] = old
