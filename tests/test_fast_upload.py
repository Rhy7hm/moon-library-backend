"""Big uploads: the card and its file are made in one call; a failed upload leaves no empty card."""
import os

from tests.conftest import folder, op, sql

PNG = b"\x89PNG\r\n\x1a\n" + os.urandom(300)


def items(app, fid):
    return sql(app, "SELECT id, title FROM items WHERE folder_id = ?", fid)


def test_file_create_makes_the_card_too(owner, app):
    fid = folder(owner, "Raya")
    j = op(owner, "file.create", {"folderId": fid, "title": {"en": "Lion dance"}, "lang": "all", "kind": "image", "name": "lion.png", "mime": "image/png", "size": len(PNG), "hasThumb": True})
    assert j["itemId"] and j["keys"]["orig"] and j["keys"]["thumb"]
    assert [r["id"] for r in items(app, fid)] == [j["itemId"]]
    assert owner.put("/api/admin/upload", query_string={"key": j["keys"]["thumb"], "contentType": "image/webp"}, data=b"thumb").status_code == 200
    assert owner.put("/api/admin/upload", query_string={"key": j["keys"]["orig"], "contentType": "image/png", "downloadName": "lion.png"}, data=PNG).status_code == 200
    op(owner, "file.ready", {"id": j["id"]})
    assert sql(app, "SELECT status FROM files WHERE id = ?", j["id"])[0]["status"] == "ready"
    # the old two-call way still works, and a folder that isn't there is refused
    op(owner, "file.create", {"folderId": "nope", "title": {"en": "x"}, "kind": "image", "name": "x.png", "mime": "image/png"}, status=404)
    op(owner, "file.create", {"folderId": fid, "title": {"en": " "}, "kind": "image", "name": "x.png", "mime": "image/png"}, status=400)
    assert len(items(app, fid)) == 1


def test_a_failed_upload_leaves_no_empty_card(owner, app):
    fid = folder(owner, "Raya")
    j = op(owner, "file.create", {"folderId": fid, "title": {"en": "Half"}, "kind": "image", "name": "half.png", "mime": "image/png"})
    op(owner, "file.delete", {"id": j["id"], "dropEmptyItem": True})
    assert items(app, fid) == [] and sql(app, "SELECT id FROM files WHERE id = ?", j["id"]) == []
    # a card that has another file keeps it
    a = op(owner, "file.create", {"folderId": fid, "title": {"en": "Two"}, "kind": "image", "name": "a.png", "mime": "image/png"})
    b = op(owner, "file.create", {"itemId": a["itemId"], "kind": "image", "name": "b.png", "mime": "image/png"})
    op(owner, "file.delete", {"id": b["id"], "dropEmptyItem": True})
    assert [r["id"] for r in items(app, fid)] == [a["itemId"]]
