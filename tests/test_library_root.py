"""Files put straight into the Library (not into a folder) live in one "Unsorted" folder the admin shows as top-level files."""
from tests.conftest import folder, item, op, sql, upload


def tree(c):
    return c.get("/api/admin/tree").get_json()


def test_unsorted_is_made_once_and_holds_top_level_files(owner):
    assert tree(owner)["looseFolderId"] is None  # nothing until a file goes there
    loose = op(owner, "folder.loose")["id"]
    assert op(owner, "folder.loose")["id"] == loose
    t = tree(owner)
    assert t["looseFolderId"] == loose
    f = next(x for x in t["folders"] if x["id"] == loose)
    assert f["name"]["en"] == "Unsorted" and f["parentId"] is None
    # uploading into it, then sorting into a folder by moving
    card = item(owner, loose, "Poster")
    upload(owner, card, "poster.png", b"\x89PNG\r\n\x1a\n" + b"p" * 200)
    campaign = folder(owner, "Campaign")
    op(owner, "move", {"itemIds": [card], "targetId": campaign})
    assert sql(owner.application, "SELECT folder_id FROM items WHERE id = ?", card)[0]["folder_id"] == campaign
    # and back out to the Library
    op(owner, "move", {"itemIds": [card], "folderIds": [], "targetId": None})
    assert sql(owner.application, "SELECT folder_id FROM items WHERE id = ?", card)[0]["folder_id"] == loose
    # folders moved to the Library still go to the top, not into Unsorted
    sub = folder(owner, "Sub", campaign)
    op(owner, "move", {"folderIds": [sub], "targetId": None})
    assert next(x for x in tree(owner)["folders"] if x["id"] == sub)["parentId"] is None


def test_paste_files_into_library_and_unsorted_comes_back(owner):
    f = folder(owner, "A")
    card = item(owner, f, "Logo")
    upload(owner, card, "logo.png", b"\x89PNG\r\n\x1a\n" + b"l" * 200)
    r = op(owner, "copy.start", {"itemIds": [card], "targetId": None})
    copy_folder = sql(owner.application, "SELECT folder_id FROM items WHERE id = (SELECT item_id FROM files WHERE id = ?)", r["files"][0]["id"])[0]["folder_id"]
    loose = tree(owner)["looseFolderId"]
    assert copy_folder == loose
    # someone put Unsorted in the Trash: the next file going to the Library gets a fresh one
    op(owner, "trash", {"folderIds": [loose]})
    assert tree(owner)["looseFolderId"] is None
    op(owner, "move", {"itemIds": [card], "targetId": None})
    fresh = tree(owner)["looseFolderId"]
    assert fresh and fresh != loose
    assert sql(owner.application, "SELECT folder_id FROM items WHERE id = ?", card)[0]["folder_id"] == fresh
