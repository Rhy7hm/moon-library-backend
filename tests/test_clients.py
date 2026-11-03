"""Clients, and sharing folders, files and links with them."""
import base64

from tests.conftest import folder, item, login, make_user, op, upload

PNG = b"\x89PNG\r\n\x1a\n" + b"c" * 300
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"x" * 40


def clients(owner):
    return {c["name"]: c for c in op(owner, "clients.list")["clients"]}


def test_create_update_and_list(owner):
    cid = op(owner, "clients.create", {"name": "Acme Sdn Bhd", "email": "ops@acme.my", "notes": "Prefers WhatsApp", "color": "#ff9500"})["id"]
    c = clients(owner)["Acme Sdn Bhd"]
    assert c["id"] == cid and c["email"] == "ops@acme.my" and c["color"] == "#ff9500" and c["shares"] == [] and c["createdBy"] == "owner1"
    op(owner, "clients.update", {"id": cid, "name": "Acme", "color": "nope"})
    c = clients(owner)["Acme"]
    assert c["color"] is None and c["notes"] == "Prefers WhatsApp"
    # names are unique, emails must look like emails, a name is required
    assert op(owner, "clients.create", {"name": "Acme"}, status=409)["error"] == "There's already a client called “Acme”"
    op(owner, "clients.create", {"name": "Beta", "email": "not-an-email"}, status=400)
    op(owner, "clients.create", {"name": "  "}, status=400)
    log = [e["summary"] for e in op(owner, "audit.list", {"kind": "content"})["entries"]]
    assert "Added client “Acme Sdn Bhd”" in log and "Updated client “Acme”" in log


def test_share_folders_files_and_links(owner):
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    f = folder(owner, "Acme / CNY 2027")
    i = item(owner, f, "Lion dance")
    upload(owner, i, "lion.png", PNG)
    r = op(owner, "shares.add", {"clientId": cid, "folderIds": [f], "itemIds": [i], "links": [{"url": "canva.com/design/abc", "title": "Canva board"}, {"url": "https://youtu.be/xyz"}]})
    assert r == {"added": 4, "skipped": 0}
    shares = clients(owner)["Acme"]["shares"]
    by = {s["kind"]: s for s in shares}
    assert by["folder"]["targetId"] == f and by["item"]["targetId"] == i
    links = sorted((s["url"], s["title"]) for s in shares if s["kind"] == "link")
    assert links == [("https://canva.com/design/abc", "Canva board"), ("https://youtu.be/xyz", "youtu.be")]
    # sharing the same things again adds nothing
    assert op(owner, "shares.add", {"clientId": cid, "folderIds": [f], "links": [{"url": "https://canva.com/design/abc"}]}) == {"added": 0, "skipped": 2}
    # only web links
    op(owner, "shares.add", {"clientId": cid, "links": [{"url": "javascript:alert(1)"}]}, status=400)
    op(owner, "shares.add", {"clientId": cid, "links": [{"url": "ftp://files.example.com/x"}]}, status=400)
    # unknown or trashed targets can't be shared
    op(owner, "shares.add", {"clientId": cid, "itemIds": ["nope"]}, status=404)
    # removing a share keeps the file
    op(owner, "shares.remove", {"clientId": cid, "ids": [by["item"]["id"]]})
    assert {s["kind"] for s in clients(owner)["Acme"]["shares"]} == {"folder", "link"}
    assert any(x["id"] == i for x in owner.get("/api/admin/tree").get_json()["items"])
    log = [e["summary"] for e in op(owner, "audit.list", {"kind": "content"})["entries"]]
    assert "Shared 1 folder, 1 file, 2 links with “Acme”" in log and "Stopped sharing 1 item with “Acme”" in log


def test_permanent_delete_removes_shares_but_trash_keeps_them(owner):
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    f = folder(owner, "Campaign")
    i = item(owner, f, "Poster")
    upload(owner, i, "p.png", PNG)
    op(owner, "shares.add", {"clientId": cid, "folderIds": [f], "itemIds": [i]})
    op(owner, "trash", {"folderIds": [f]})
    assert len(clients(owner)["Acme"]["shares"]) == 2  # still shared while in the Trash (Restore brings it back)
    op(owner, "purge", {"folderIds": [f]})
    assert clients(owner)["Acme"]["shares"] == []


def test_deleting_a_client_keeps_the_files(owner):
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    f = folder(owner)
    op(owner, "shares.add", {"clientId": cid, "folderIds": [f]})
    op(owner, "clients.delete", {"id": cid})  # to the Trash
    assert op(owner, "clients.list")["clients"][0]["deletedAt"]
    op(owner, "purge", {"clientIds": [cid]})  # and for good
    assert op(owner, "clients.list")["clients"] == []
    assert any(x["id"] == f for x in owner.get("/api/admin/tree").get_json()["folders"])


def test_roles(owner, app):
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    make_user(app, "viewer1", "viewer")
    make_user(app, "editor1", "editor")
    viewer, editor = app.test_client(), app.test_client()
    login(viewer, "viewer1")
    login(editor, "editor1")
    assert op(viewer, "clients.list")["clients"][0]["name"] == "Acme"
    op(viewer, "clients.create", {"name": "Nope"}, status=403)
    op(viewer, "shares.add", {"clientId": cid, "links": [{"url": "https://example.com"}]}, status=403)
    op(editor, "shares.add", {"clientId": cid, "links": [{"url": "https://example.com"}]})
    op(editor, "clients.delete", {"id": cid}, status=403)
    op(owner, "clients.delete", {"id": cid})
    assert app.test_client().post("/api/admin/clients.list", json={}).status_code == 401


def test_client_avatar(owner):
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    assert clients(owner)["Acme"]["avatarKey"] is None
    r = op(owner, "clients.setAvatar", {"id": cid, "data": base64.b64encode(WEBP).decode()})
    key = r["avatarKey"]
    assert key.startswith("c/") and key.endswith(".webp")
    assert clients(owner)["Acme"]["avatarKey"] == key
    assert owner.get("/f/" + key).headers["Content-Type"] == "image/webp"
    # replace, then clear
    r2 = op(owner, "clients.setAvatar", {"id": cid, "data": base64.b64encode(PNG).decode()})
    assert r2["avatarKey"] != key and r2["avatarKey"].endswith(".png")
    assert owner.get("/f/" + key).status_code == 404
    op(owner, "clients.clearAvatar", {"id": cid})
    assert clients(owner)["Acme"]["avatarKey"] is None
    assert owner.get("/f/" + r2["avatarKey"]).status_code == 404
    op(owner, "clients.setAvatar", {"id": cid, "data": base64.b64encode(b"not-an-image").decode()}, status=400)
    op(owner, "clients.setAvatar", {"id": cid, "data": base64.b64encode(b"\x89PNG....").decode()}, status=400)
