"""Removing a client moves it to the Trash: restore brings everything back; deleting for good is final."""
from tests.conftest import folder, login, make_user, op, run_sql
from tests.test_client_api import client_login, setup_client


def client(owner, cid):
    return next(c for c in op(owner, "clients.list")["clients"] if c["id"] == cid)


def test_trash_signs_them_out_and_restore_brings_it_all_back(owner, app):
    cid, _, pw = setup_client(owner)
    f = folder(owner, "Acme CNY")
    op(owner, "shares.add", {"clientId": cid, "folderIds": [f]})
    c = client_login(app, "amy@acme.my", pw)
    assert c.get("/api/client/library").status_code == 200

    op(owner, "clients.delete", {"id": cid})
    gone = client(owner, cid)
    assert gone["deletedAt"] and len(gone["shares"]) == 1 and len(gone["logins"]) == 1  # kept for a restore
    assert c.get("/api/client/library").status_code == 401  # signed out at once
    client_login(app, "amy@acme.my", pw, status=401)  # and can't sign in
    op(owner, "shares.add", {"clientId": cid, "folderIds": [f]}, status=409)  # nothing can be changed while it's in the Trash
    # the same name can't be reused while it's in the Trash
    r = op(owner, "clients.create", {"name": "Acme"}, status=409)
    assert "Trash" in r["error"]
    log = op(owner, "audit.list", {"kind": "content"})["entries"]
    assert log[0]["summary"] == "Deleted (moved to Trash) 👤 Acme and their folder" and log[0]["undoable"]

    op(owner, "restore", {"clientIds": [cid]})
    back = client(owner, cid)
    assert back["deletedAt"] is None and len(back["shares"]) == 1
    assert client_login(app, "amy@acme.my", pw).get("/api/client/library").status_code == 200


def test_only_owners_and_only_from_the_trash(owner, app):
    cid, _, _ = setup_client(owner)
    op(owner, "purge", {"clientIds": [cid]}, status=400)  # not in the Trash yet
    op(owner, "clients.delete", {"id": cid})
    make_user(app, "ed", role="editor")
    ed = app.test_client()
    login(ed, "ed")
    op(ed, "restore", {"clientIds": [cid]}, status=403)
    op(ed, "purge", {"clientIds": [cid]}, status=403)
    op(ed, "trash", {"clientIds": [cid]}, status=403)
    op(owner, "purge", {"clientIds": [cid]})
    assert all(c["id"] != cid for c in op(owner, "clients.list")["clients"])


def test_empty_trash_and_the_90_day_clean_up(owner, app):
    from app.services.activity import cleanup

    a, _, _ = setup_client(owner, "Acme", "amy@acme.my")
    b, _, _ = setup_client(owner, "Nike", "nina@nike.my")
    op(owner, "clients.delete", {"id": a})
    op(owner, "clients.delete", {"id": b})
    op(owner, "purge", {"all": True})
    assert op(owner, "clients.list")["clients"] == []

    c, _, _ = setup_client(owner, "Adidas", "ada@adidas.my")
    op(owner, "clients.delete", {"id": c})
    run_sql(app, "UPDATE clients SET deleted_at = 1 WHERE id = ?", c)
    with app.app_context():
        assert cleanup(force=True)["clients"] == 1
    assert op(owner, "clients.list")["clients"] == []


def test_their_folder_goes_with_them_and_comes_back(owner, app):
    from tests.conftest import item, upload

    cid, _, _ = setup_client(owner)
    home = client(owner, cid)["homeFolderId"]
    card = item(owner, home, "Logo")
    upload(owner, card, "logo.png", b"\x89PNG\r\n\x1a\n" + b"l" * 200)
    elsewhere = folder(owner, "Campaign")  # only shared with them: never touched
    op(owner, "shares.add", {"clientId": cid, "folderIds": [elsewhere]})

    assert op(owner, "clients.delete", {"id": cid})["withFolder"] is True
    folders = {f["id"]: f for f in owner.get("/api/admin/tree").get_json()["folders"]}
    assert folders[home]["deletedAt"] and not folders[elsewhere]["deletedAt"]
    log = op(owner, "audit.list", {"kind": "content"})["entries"]
    assert log[0]["summary"] == "Deleted (moved to Trash) 👤 Acme and their folder"

    op(owner, "restore", {"clientIds": [cid]})  # one restore brings both back
    folders = {f["id"]: f for f in owner.get("/api/admin/tree").get_json()["folders"]}
    assert not folders[home]["deletedAt"] and client(owner, cid)["deletedAt"] is None

    op(owner, "clients.delete", {"id": cid})
    op(owner, "purge", {"clientIds": [cid]})  # and Delete now removes both, files included
    t = owner.get("/api/admin/tree").get_json()
    assert home not in {f["id"] for f in t["folders"]} and card not in {i["id"] for i in t["items"]}
    assert elsewhere in {f["id"] for f in t["folders"]}


def test_keep_their_folder(owner):
    cid, _, _ = setup_client(owner)
    home = client(owner, cid)["homeFolderId"]
    assert op(owner, "clients.delete", {"id": cid, "withFolder": False})["withFolder"] is False
    op(owner, "purge", {"clientIds": [cid]})
    f = next(x for x in owner.get("/api/admin/tree").get_json()["folders"] if x["id"] == home)
    assert not f["deletedAt"]  # still in the Library
