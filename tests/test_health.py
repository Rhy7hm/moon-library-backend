"""Settings → Connections: live checks of MySQL, R2 and Google Drive."""
from tests.conftest import login, make_user, upload, folder, item

PNG = b"\x89PNG\r\n\x1a\n" + b"h" * 300


def checks(client):
    r = client.get("/api/admin/status")
    assert r.status_code == 200, r.get_json()
    assert r.headers["Cache-Control"] == "no-store"
    return {c["key"]: c for c in r.get_json()["checks"]}


def probes(app):
    from app.storage import storage

    with app.app_context():
        st = storage()
        return st.client.list_objects_v2(Bucket=st.bucket, Prefix="_health/").get("KeyCount", 0)


def test_all_working_and_drive_off(app, owner):
    c = checks(owner)
    assert c["mysql"]["state"] == "ok" and c["mysql"]["summary"].startswith("Connected to ")
    assert c["r2"]["state"] == "ok" and {f["label"] for f in c["r2"]["facts"]} >= {"Bucket", "Read / write / delete"}
    assert c["drive"]["state"] == "off"
    assert all(isinstance(x["ms"], int) for x in c.values())
    assert probes(app) == 0  # the test file is cleaned up
    body = str(c)
    # no secret values: the server's key, the database password, R2 keys, a robot's private key
    assert app.config["SECRET_KEY"] not in body and "private_key" not in body
    for k in ("DB_PASSWORD", "R2_SECRET_ACCESS_KEY", "R2_ACCESS_KEY_ID"):
        v = app.config.get(k)
        assert not v or len(v) < 6 or v not in body  # (the test setup uses one-letter stand-ins)


def test_drive_connected(app, owner, drive):
    upload(owner, item(owner, folder(owner, "Rebate")), "a.png", PNG)
    d = checks(owner)["drive"]
    assert d["state"] == "ok", d
    facts = {f["label"]: f["value"] for f in d["facts"]}
    assert facts["Folder"] == "Moon Library backup" and facts["Where"] == "Shared drive"
    assert "Backed up" not in facts  # progress comes from /api/admin/backup, shown under the card
    assert d["link"] == "https://drive.google.com/drive/folders/ROOT"


def test_my_drive_folder_warns(app, owner, drive):
    drive.files["ROOT"]["driveId"] = None  # a folder in someone's own My Drive (Google leaves driveId out)
    d = checks(owner)["drive"]
    assert d["state"] == "ok" and "My Drive" in d["warning"] and "Shared drive" in d["warning"]
    assert {f["label"]: f["value"] for f in d["facts"]}["Where"] == "My Drive"


def test_drive_folder_in_bin_fails(app, owner, drive):
    drive.files["ROOT"]["trashed"] = True
    d = checks(owner)["drive"]
    assert d["state"] == "fail" and "bin" in d["error"]


def test_one_failure_doesnt_hide_the_others(app, owner, monkeypatch):
    import app.storage as st_mod

    def broken():
        raise st_mod.StorageError("R2 is not configured: set R2_ENDPOINT_URL")

    monkeypatch.setattr(st_mod, "storage", broken)
    c = checks(owner)
    assert c["r2"]["state"] == "fail" and "R2 is not configured" in c["r2"]["error"]
    assert c["mysql"]["state"] == "ok" and c["drive"]["state"] == "off"


def test_owners_only(app, client):
    make_user(app, "ed", role="editor")
    login(client, "ed")
    assert client.get("/api/admin/status").status_code == 403
