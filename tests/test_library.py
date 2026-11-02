"""The admin tree (everything stored, including Trash and unfinished uploads), reports, folder flags."""
from tests.conftest import folder, item, login, make_user, op, upload

PNG = b"\x89PNG\r\n\x1a\n" + b"p" * 500


def test_admin_tree_shape(owner):
    f = folder(owner, "Rebate")
    sub = folder(owner, "Charts", f)
    op(owner, "folder.update", {"id": f, "name": {"en": "Rebate", "zh": "返水", "ta": "ரிபேட்"}})
    i = item(owner, sub, "Daily Rebate")
    vid, keys, _ = upload(owner, i, "Daily Rebate_EN_CN.png", PNG, "en", ["en", "zh"], thumb=b"RIFF0000WEBPxxxx")
    t = owner.get("/api/admin/tree").get_json()
    assert set(t) == {"folders", "items", "assetBase", "generatedAt", "user"}
    fo = next(x for x in t["folders"] if x["id"] == f)
    assert fo["name"] == {"en": "Rebate", "zh": "返水", "ta": "ரிபேட்"} and fo["slug"] == "rebate" and fo["hidden"] is False and "createdAt" in fo
    ti = t["items"][0]
    assert ti["status"] == "live" and ti["createdBy"] == "owner1" and "deletedAt" in ti
    v = ti["variants"][0]
    assert v["langs"] == ["en", "zh"] and v["orig"] == keys["orig"] and v["thumb"] == keys["thumb"] and v["status"] == "ready"
    assert v["size"] == len(PNG) and v["w"] == 10 and v["h"] == 20
    assert t["user"]["role"] == "owner"
    # the tree is for staff only, and the old public library endpoint is gone
    assert owner.application.test_client().get("/api/admin/tree").status_code == 401
    assert owner.get("/api/library").status_code == 404


def test_trash_keeps_items_in_the_tree(owner):
    f = folder(owner)
    i = item(owner, f)
    upload(owner, i, "x.png", PNG)
    op(owner, "trash", {"itemIds": [i]})
    it = owner.get("/api/admin/tree").get_json()["items"][0]
    assert it["deletedAt"]
    op(owner, "restore", {"itemIds": [i]})
    assert owner.get("/api/admin/tree").get_json()["items"][0]["deletedAt"] is None


def test_unfinished_uploads(owner):
    f = folder(owner)
    i = item(owner, f)
    j = op(owner, "file.create", {"itemId": i, "lang": "en", "kind": "image", "name": "x.png", "mime": "image/png", "size": 3})
    assert owner.get("/api/admin/tree").get_json()["items"][0]["variants"][0]["status"] == "uploading"
    assert op(owner, "file.ready", {"id": j["id"]}, status=409)["error"] == "The original file has not finished uploading"


def test_reports_storage_and_team(owner):
    f = folder(owner)
    i = item(owner, f)
    upload(owner, i, "a.png", PNG)
    s = op(owner, "reports.storage")
    assert s["live"] == {"files": 1, "orig": len(PNG), "opt": 0} and s["months"][0]["files"] == 1
    t = op(owner, "reports.team", {"days": 30})
    assert {(a["username"], a["action"]) for a in t["actions"]} >= {("owner1", "folder.create"), ("owner1", "file.upload")}
    assert t["perDay"][0]["day"].count("-") == 2

def test_folder_visibility_validation_permissions_and_undo(owner, app):
    f = folder(owner)
    for invalid in ("false", 1, None):
        op(owner, "folder.update", {"id": f, "hidden": invalid}, status=400)
    make_user(app, "viewer1", "viewer")
    viewer = app.test_client()
    login(viewer, "viewer1")
    op(viewer, "folder.update", {"id": f, "hidden": True}, status=403)
    op(owner, "folder.update", {"id": f, "hidden": True})
    entry = next(e for e in op(owner, "audit.list", {"kind": "content"})["entries"] if e["action"] == "folder.update")
    assert "private (staff only)" in entry["summary"]
    op(owner, "audit.undo", {"id": entry["id"]})
    assert owner.get("/api/admin/tree").get_json()["folders"][0]["hidden"] is False

def test_visibility_upgrade_preserves_existing_folders(app):
    """Exercise the existing initial-schema upgrade, not a second hidden-column migration."""
    from flask_migrate import downgrade, upgrade
    from app.db import q

    with app.app_context():
        downgrade(revision="0001_initial")
        try:
            q.run("INSERT INTO folders (id,slug,name,created_at,updated_at) VALUES (?,?,?,?,?)",
                  "existing", "existing", '{"en":"Existing"}', 1, 1)
        finally:
            upgrade()
        assert q.first("SELECT hidden FROM folders WHERE id = ?", "existing")["hidden"] == 0
        assert q.first("SELECT version_num FROM alembic_version")["version_num"] == "0004_client_logins"
