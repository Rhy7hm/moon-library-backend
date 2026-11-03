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
    assert log[0]["summary"] == "Deleted (moved to Trash) 👤 Acme" and log[0]["undoable"]

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
