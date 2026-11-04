"""Every client has a home folder (Clients › <client>) that their folders and inbox live in — in the library and in the Drive backup."""
import os

from tests.conftest import folder, item, login, make_user, op, run_sql, upload
from tests.test_client_api import PNG, client_login, setup_client
from tests.test_drive_connect import connect, gdrive  # noqa: F401  (fixture)


def tree(c):
    return c.get("/api/admin/tree").get_json()


def path_of(t, fid):
    by = {f["id"]: f for f in t["folders"]}
    out = []
    while fid:
        f = by[fid]
        out.insert(0, f["name"]["en"])
        fid = f["parentId"]
    return out


def client(owner, cid):
    return next(c for c in op(owner, "clients.list")["clients"] if c["id"] == cid)


def test_new_client_gets_a_home_folder_and_new_folders_go_in_it(owner):
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    home = client(owner, cid)["homeFolderId"]
    assert path_of(tree(owner), home) == ["Clients", "Acme"]
    # a second client shares the same "Clients" folder
    other = op(owner, "clients.create", {"name": "Adidas"})["id"]
    assert path_of(tree(owner), client(owner, other)["homeFolderId"]) == ["Clients", "Adidas"]
    assert [f["name"]["en"] for f in tree(owner)["folders"] if f["parentId"] is None] == ["Clients"]

    # from the client's page: inside their folder, and shared with them
    fid = op(owner, "clients.newFolder", {"clientId": cid, "name": "CNY 2027"})["id"]
    assert path_of(tree(owner), fid) == ["Clients", "Acme", "CNY 2027"]
    assert [(s["kind"], s["targetId"]) for s in client(owner, cid)["shares"]] == [("folder", fid)]
    # or kept to the team for now
    draft = op(owner, "clients.newFolder", {"clientId": cid, "name": "Drafts", "share": False})["id"]
    assert path_of(tree(owner), draft) == ["Clients", "Acme", "Drafts"] and len(client(owner, cid)["shares"]) == 1
    # folders made in the library stay where they're made
    raw = folder(owner, "linmama")
    assert path_of(tree(owner), raw) == ["linmama"]
    op(owner, "clients.newFolder", {"clientId": cid, "name": "  "}, status=400)
    op(owner, "clients.newFolder", {"clientId": "nope", "name": "x"}, status=404)


def test_rename_trash_and_remove(owner, app):
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    home = client(owner, cid)["homeFolderId"]
    op(owner, "clients.update", {"id": cid, "name": "Acme Sdn Bhd"})
    assert path_of(tree(owner), home) == ["Clients", "Acme Sdn Bhd"]
    # if their folder was deleted, the next folder made for them brings a new one
    op(owner, "trash", {"folderIds": [home]})
    fid = op(owner, "clients.newFolder", {"clientId": cid, "name": "Raya"})["id"]
    new_home = client(owner, cid)["homeFolderId"]
    assert new_home != home and path_of(tree(owner), fid) == ["Clients", "Acme Sdn Bhd", "Raya"]
    # removing the client leaves their folder and files in the library
    op(owner, "clients.delete", {"id": cid})
    assert any(f["id"] == new_home for f in tree(owner)["folders"])
    # Viewers can't make folders for clients
    cid = op(owner, "clients.create", {"name": "Nike"})["id"]
    make_user(app, "vi", role="viewer")
    vi = app.test_client()
    login(vi, "vi")
    assert vi.post("/api/admin/clients.newFolder", json={"clientId": cid, "name": "x"}).status_code == 403


def test_inbox_goes_in_the_home_folder_and_old_ones_move_in(owner, app):
    cid, _, pw = setup_client(owner)
    c = client_login(app, "amy@acme.my", pw)
    j = c.post("/api/client/uploads/start", json={"name": "logo.png", "mime": "image/png", "size": len(PNG), "kind": "image"}).get_json()
    assert c.put("/api/client/upload", query_string={"key": j["keys"]["orig"], "contentType": "image/png", "downloadName": "logo.png"}, data=PNG).status_code == 200
    inbox = client(owner, cid)["inboxFolderId"]
    assert path_of(tree(owner), inbox) == ["Clients", "Acme", "From Acme"]

    # a client from before home folders: inbox at the top, no home folder yet
    home = client(owner, cid)["homeFolderId"]
    run_sql(app, "UPDATE folders SET parent_id = NULL WHERE id = ?", inbox)
    run_sql(app, "UPDATE clients SET home_folder_id = NULL WHERE id = ?", cid)
    op(owner, "trash", {"folderIds": [home]})
    c2 = client(owner, cid)  # opening Clients sorts them out
    assert path_of(tree(owner), inbox) == ["Clients", "Acme", "From Acme"] and c2["homeFolderId"] != home


def test_drive_backup_is_sorted_by_client(app, owner, gdrive):  # noqa: F811
    from app.drive.backup import run_backup

    connect(owner)
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    fid = op(owner, "clients.newFolder", {"clientId": cid, "name": "CNY 2027"})["id"]
    upload(owner, item(owner, fid, "Lion"), "lion.png", b"\x89PNG\r\n\x1a\n" + os.urandom(500))
    upload(owner, item(owner, folder(owner, "linmama"), "Mama"), "mama.png", b"\x89PNG\r\n\x1a\n" + os.urandom(500))
    with app.app_context():
        assert run_backup(budget_ms=30_000)["failed"] == 0

    def drive_path(name):
        f = next(x for x in gdrive.files.values() if x["name"] == name)
        out = []
        while f["parents"] and f["parents"][0] in gdrive.files:
            f = gdrive.files[f["parents"][0]]
            out.insert(0, f["name"])
        return out

    assert drive_path("lion.png")[1:] == ["Moon Library backup", "Clients", "Acme", "CNY 2027"]
    assert drive_path("mama.png")[1:] == ["Moon Library backup", "linmama"]


def test_clients_home_returns_or_remakes_their_folder(owner):
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    home = op(owner, "clients.home", {"clientId": cid})["id"]
    assert home == client(owner, cid)["homeFolderId"]
    op(owner, "trash", {"folderIds": [home]})
    again = op(owner, "clients.home", {"clientId": cid})["id"]
    assert again != home and path_of(tree(owner), again) == ["Clients", "Acme"]
