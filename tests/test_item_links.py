"""Shortcuts: one file shown in another folder too (a client's folder), with no copy made."""
from tests.conftest import folder, item, op, sql, upload
from tests.test_client_api import client_login, setup_client

PNG = b"\x89PNG\r\n\x1a\n" + b"p" * 500


def tree(c):
    return c.get("/api/admin/tree").get_json()


def setup(owner):
    design = folder(owner, "DESIGNER")
    a, b = item(owner, design, "Poster"), item(owner, design, "Banner")
    upload(owner, a, "poster.png", PNG)
    upload(owner, b, "banner.png", PNG)
    cid, _, pw = setup_client(owner, "Ari Hubs", "ari@hubs.my")
    target = op(owner, "clients.newFolder", {"clientId": cid, "name": "Video 1-4", "place": "client"})["id"]
    return design, a, b, cid, pw, target


def test_add_shows_the_file_in_both_places_without_copying(owner, app):
    design, a, b, cid, pw, target = setup(owner)
    files_before = len(sql(app, "SELECT id FROM files"))
    assert op(owner, "links.add", {"folderId": target, "itemIds": [a, b]})["added"] == 2
    assert op(owner, "links.add", {"folderId": target, "itemIds": [a]})["added"] == 0  # already there
    assert op(owner, "links.add", {"folderId": design, "itemIds": [a]})["added"] == 0  # its own folder
    t = tree(owner)
    assert {(l["folderId"], l["itemId"]) for l in t["links"]} == {(target, a), (target, b)}
    assert {i["folderId"] for i in t["items"] if i["id"] in (a, b)} == {design}  # still where it was
    assert len(sql(app, "SELECT id FROM files")) == files_before  # nothing copied

    # the client website shows them inside the shared folder, and lets them open the file
    c = client_login(app, "ari@hubs.my", pw)
    lib = c.get("/api/client/library").get_json()
    got = {i["id"]: i["collectionId"] for i in lib["items"]}
    assert got == {a: target, b: target}
    fid = lib["items"][0]["files"][0]["id"]
    assert c.get(f"/api/client/files/{fid}/download").status_code == 200

    # taking one out leaves the file where it is
    assert op(owner, "links.remove", {"folderId": target, "itemIds": [a]})["removed"] == 1
    assert {i["id"] for i in c.get("/api/client/library").get_json()["items"]} == {b}
    assert next(i for i in tree(owner)["items"] if i["id"] == a)["deletedAt"] is None


def test_trash_hides_it_everywhere_and_delete_for_good_drops_the_shortcut(owner, app):
    design, a, b, cid, pw, target = setup(owner)
    op(owner, "links.add", {"folderId": target, "itemIds": [a]})
    c = client_login(app, "ari@hubs.my", pw)
    op(owner, "trash", {"itemIds": [a], "folderIds": []})
    assert c.get("/api/client/library").get_json()["items"] == []
    op(owner, "purge", {"itemIds": [a], "folderIds": []})
    assert sql(app, "SELECT * FROM item_links") == []


def test_bad_requests(owner, app):
    design, a, b, cid, pw, target = setup(owner)
    op(owner, "links.add", {"folderId": "nope", "itemIds": [a]}, status=404)
    op(owner, "links.add", {"folderId": target, "itemIds": []}, status=400)
    op(owner, "links.add", {"folderId": target, "itemIds": ["missing"]}, status=404)
