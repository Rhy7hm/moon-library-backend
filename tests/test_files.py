"""Uploads (single and multipart), language versions, history, restore, undo, /f Range + HEAD, ZIP."""
import io
import os
import zipfile

from tests.conftest import folder, item, op, ready_cards, sql, upload

PNG = b"\x89PNG\r\n\x1a\n" + os.urandom(3000)
MB = 1024 * 1024


def langs_of(client, item_id):
    it = next(i for i in client.get("/api/admin/tree").get_json()["items"] if i["id"] == item_id)
    return sorted((v["name"], tuple(v.get("langs") or [v["lang"]])) for v in it["variants"])


def test_language_versions_and_history(owner):
    f = folder(owner)
    i = item(owner, f)
    a, _, _ = upload(owner, i, "Promo_EN_CN.png", PNG, "en", ["en", "zh"])
    b, _, _ = upload(owner, i, "Promo_CN.png", PNG + b"2", "zh")
    c, _, _ = upload(owner, i, "Promo_BM_CN.png", PNG + b"3", "ms", ["ms", "zh"])
    # versions that only share a language stay side by side (EN + 中文, 中文, BM + 中文)
    assert langs_of(owner, i) == [("Promo_BM_CN.png", ("ms", "zh")), ("Promo_CN.png", ("zh",)), ("Promo_EN_CN.png", ("en", "zh"))]
    assert op(owner, "versions.list", {"itemId": i})["versions"] == []
    # the same languages again replaces only that version ("中文 + BM" = "BM + 中文")
    d, _, _ = upload(owner, i, "Promo_CN_BM.png", PNG + b"4", "zh", ["zh", "ms"])
    assert langs_of(owner, i) == [("Promo_CN.png", ("zh",)), ("Promo_CN_BM.png", ("zh", "ms")), ("Promo_EN_CN.png", ("en", "zh"))]
    assert [x["name"] for x in op(owner, "versions.list", {"itemId": i})["versions"]] == ["Promo_BM_CN.png"]
    # changing a file's languages: only a version in exactly those languages is in the way
    op(owner, "file.update", {"id": a, "langs": ["en", "zh", "ms"]})
    r = owner.post("/api/admin/file.update", json={"id": a, "langs": ["zh"]})
    assert r.status_code == 409 and r.get_json()["error"] == "Another version is already in 简体 (Promo_CN.png)"
    res = op(owner, "file.update", {"id": a, "langs": ["zh"], "replace": True})
    assert res == {"ok": True, "replaced": 1, "trimmed": 0}
    v = op(owner, "versions.list", {"itemId": i})
    assert v["keepDays"] == 90 and v["versions"][0]["name"] == "Promo_CN.png" and v["versions"][0]["reason"] == "replaced"
    # restoring the 中文 version: the file now in exactly 中文 goes to the history
    op(owner, "versions.restore", {"id": v["versions"][0]["id"]})
    assert langs_of(owner, i) == [("Promo_CN.png", ("zh",)), ("Promo_CN_BM.png", ("zh", "ms"))]
    assert op(owner, "versions.list", {"itemId": i})["versions"][0]["name"] == "Promo_EN_CN.png"


def test_replace_keeps_old_version_and_undo(owner):
    f = folder(owner)
    i = item(owner, f)
    a, _, _ = upload(owner, i, "Banner_BM.png", PNG, "ms")
    b, _, r = upload(owner, i, "Banner_BM.png", PNG + b"new", "ms", replaces=a)
    assert r["versionId"]
    assert [x["name"] for x in op(owner, "versions.list", {"itemId": i})["versions"]] == ["Banner_BM.png"]
    log = op(owner, "audit.list", {"kind": "content"})["entries"]
    rep = next(e for e in log if e["action"] == "file.replace")
    assert rep["undoable"] and rep["summary"].startswith("Replaced “Daily Rebate” (BM) with Banner_BM.png in ")
    op(owner, "audit.undo", {"id": rep["id"]})
    tree_files = sql(owner.application, "SELECT id, size FROM files WHERE item_id = ?", i)
    assert [x["size"] for x in tree_files] == [len(PNG)]
    assert owner.post("/api/admin/audit.undo", json={"id": rep["id"]}).get_json()["error"] == "Already undone"


def test_delete_version_goes_to_history(owner):
    f = folder(owner)
    i = item(owner, f)
    a, keys, _ = upload(owner, i, "x_EN.png", PNG)
    r = op(owner, "file.delete", {"id": a})
    assert r["versionId"]
    assert owner.get("/f/" + keys["orig"]).status_code == 200  # bytes kept for restoring
    op(owner, "versions.restore", {"id": r["versionId"]})
    assert langs_of(owner, i) == [("x_EN.png", ("en",))]


def test_undo_and_activity(owner):
    f = folder(owner, "Rebate")
    g = folder(owner, "Other")
    i = item(owner, f)
    upload(owner, i, "a.png", PNG)
    op(owner, "move", {"itemIds": [i], "targetId": g})
    op(owner, "item.update", {"id": i, "title": {"en": "New name"}, "pinned": True})
    op(owner, "trash", {"folderIds": [g]})
    log = op(owner, "audit.list", {"kind": "content"})["entries"]
    by = {e["action"]: e for e in log}
    assert by["move"]["summary"] == "Moved “Daily Rebate” to Other"
    assert by["item.update"]["summary"] == "“Daily Rebate”: renamed to “New name”, pinned to top"
    assert by["trash"]["summary"] == "Deleted (moved to Trash) “📁 Other”"
    for a in ("trash", "item.update", "move"):
        op(owner, "audit.undo", {"id": by[a]["id"]})
    row = sql(owner.application, "SELECT folder_id, pinned, title FROM items WHERE id = ?", i)[0]
    assert row["folder_id"] == f and row["pinned"] == 0 and "Daily Rebate" in row["title"]
    assert sql(owner.application, "SELECT deleted_at FROM folders WHERE id = ?", g)[0]["deleted_at"] is None
    undo_lines = [e for e in op(owner, "audit.list", {"kind": "content"})["entries"] if e["action"] == "undo"]
    assert [e["summary"] for e in undo_lines][-1] == "Undid: Deleted (moved to Trash) “📁 Other”"


def test_move_rules(owner):
    f = folder(owner, "A")
    g = folder(owner, "B", f)
    i = item(owner, f)
    assert op(owner, "move", {"folderIds": [f], "targetId": g}, status=400)["error"] == "A folder can't be moved into itself"
    assert op(owner, "move", {"itemIds": [i], "targetId": None}, status=400)["error"] == "Files have to be inside a folder"
    h = folder(owner, "B")  # same name at the top → its link name gets "-2" when moved next to another "b"
    op(owner, "move", {"folderIds": [h], "targetId": f})
    assert sql(owner.application, "SELECT slug FROM folders WHERE id = ?", h)[0]["slug"] == "b-2"


def test_purge_removes_files_from_storage(owner, app):
    f = folder(owner)
    i = item(owner, f)
    a, keys, _ = upload(owner, i, "a.png", PNG, thumb=b"RIFF0000WEBPthumb")
    op(owner, "folder.update", {"id": f, "coverItemId": i})
    op(owner, "trash", {"folderIds": [f]})
    r = op(owner, "purge", {"all": True})
    assert r == {"ok": True, "items": 1, "folders": 1}
    assert owner.get("/f/" + keys["orig"]).status_code == 404 and owner.get("/f/" + keys["thumb"]).status_code == 404
    assert sql(app, "SELECT COUNT(*) AS n FROM folders")[0]["n"] == 0


def test_folder_icon_and_svg_cleaning(owner):
    f = folder(owner)
    op(owner, "folder.update", {"id": f, "icon": 'svg:<svg viewBox="0 0 1 1" onload="x()"><script>alert(1)</script><path d="M0" style="fill:url(http://evil)"/></svg>'})
    icon = sql(owner.application, "SELECT icon FROM folders WHERE id = ?", f)[0]["icon"]
    assert "script" not in icon and "onload" not in icon and "evil" not in icon and icon.startswith("svg:<svg")
    import base64

    r = op(owner, "folder.iconImage", {"data": base64.b64encode(b"RIFF\x00\x00\x00\x00WEBPVP8 data").decode()})
    assert r["icon"].startswith("img:i/") and owner.get("/f/" + r["icon"][4:]).headers["Content-Type"] == "image/webp"
    assert op(owner, "folder.iconImage", {"data": base64.b64encode(b"\x89PNG....").decode()}, status=400)["error"] == "Icon must be WEBP"


def test_upload_key_checks_and_limits(owner, app):
    assert owner.put("/api/admin/upload?key=o/BAD", data=b"x").get_json() == {"error": "Bad key"}
    assert owner.put("/api/admin/upload?key=o/abcdefgh/x.png", data=b"x").get_json() == {"error": "Unknown upload key"}
    f = folder(owner)
    i = item(owner, f)
    j = op(owner, "file.create", {"itemId": i, "lang": "en", "kind": "image", "name": "a.png", "mime": "image/png", "size": 1})
    k = j["keys"]["orig"]
    assert owner.put("/api/admin/upload", query_string={"key": k}, data=b"").get_json() == {"error": "Empty upload"}
    app.config["MAX_UPLOAD_BODY"] = 1000
    r = owner.put("/api/admin/upload", query_string={"key": k}, data=b"x" * 2000)
    assert r.status_code == 413 and r.get_json() == {"error": "Upload part too large"}
    app.config["MAX_UPLOAD_BODY"] = 95 * MB
    r = owner.put("/api/admin/upload", query_string={"key": k, "uploadId": "u", "part": "0"}, data=b"x")
    assert r.get_json() == {"error": "Bad part number"}


def test_multipart_upload_and_range_requests(owner, client):
    """A 25 MB file in 10 MB parts (as the browser sends it), then read back in ranges."""
    f = folder(owner)
    i = item(owner, f)
    data = os.urandom(25 * MB + 123)
    j = op(owner, "file.create", {"itemId": i, "lang": "en", "kind": "video", "name": "Big 中文.mp4", "mime": "video/mp4", "size": len(data)})
    key = j["keys"]["orig"]
    up = op(owner, "mpu.create", {"key": key, "contentType": "video/mp4", "downloadName": "Big 中文.mp4"})["uploadId"]
    parts = []
    for n, start in enumerate(range(0, len(data), 10 * MB), 1):
        r = owner.put("/api/admin/upload", query_string={"key": key, "uploadId": up, "part": str(n)}, data=data[start : start + 10 * MB])
        assert r.status_code == 200
        parts.append(r.get_json())
    assert [p["partNumber"] for p in parts] == [1, 2, 3]
    op(owner, "mpu.complete", {"key": key, "uploadId": up, "parts": list(reversed(parts))})
    op(owner, "file.ready", {"id": j["id"]})
    path = "/f/" + "/".join(__import__("urllib.parse").parse.quote(x, safe="") for x in key.split("/"))

    h = client.head(path)
    assert h.status_code == 200 and h.headers["Content-Length"] == str(len(data)) and h.headers["Accept-Ranges"] == "bytes"
    assert h.headers["Content-Type"] == "video/mp4" and h.headers["Cache-Control"] == "private, max-age=86400" and h.headers["ETag"].startswith('"')
    r = client.get(path, headers={"Range": "bytes=100-1099"})
    assert r.status_code == 206 and r.data == data[100:1100] and r.headers["Content-Range"] == f"bytes 100-1099/{len(data)}" and r.headers["Content-Length"] == "1000"
    r = client.get(path, headers={"Range": f"bytes={len(data) - 10}-"})
    assert r.status_code == 206 and r.data == data[-10:]
    r = client.get(path, headers={"Range": "bytes=-5"})
    assert r.status_code == 206 and r.data == data[-5:]
    r = client.get(path, headers={"Range": "bytes=0-1,5-6"})  # several ranges: the whole file, as before
    assert r.status_code == 200 and len(r.data) == len(data)
    r = client.get(path, headers={"Range": f"bytes={len(data) + 5}-"})
    assert r.status_code == 416 and r.headers["Content-Range"] == f"bytes */{len(data)}"
    r = client.get(path + "?dl=Big%20%E4%B8%AD%E6%96%87.mp4")
    assert r.headers["Content-Disposition"] == "attachment; filename=\"Big __.mp4\"; filename*=UTF-8''Big%20%E4%B8%AD%E6%96%87.mp4"
    assert len(r.data) == len(data)
    assert client.get("/f/x/abc").status_code == 404 and client.get("/f/o/abcdefgh/none.png").status_code == 404


def test_mpu_abort(owner):
    f = folder(owner)
    i = item(owner, f)
    k = op(owner, "file.create", {"itemId": i, "lang": "en", "kind": "video", "name": "v.mp4", "mime": "video/mp4", "size": 1})["keys"]["orig"]
    up = op(owner, "mpu.create", {"key": k, "contentType": "video/mp4"})["uploadId"]
    assert op(owner, "mpu.abort", {"key": k, "uploadId": up}) == {"ok": True}


def test_zip_streams_files_with_download_names(owner, client, app):
    f = folder(owner)
    i1, i2, i3 = item(owner, f, "One"), item(owner, f, "Two"), item(owner, f, "Three")
    a, _, _ = upload(owner, i1, "IMG_4821.png", PNG, "ms")  # named after the card: "One_BM.png"
    b, _, _ = upload(owner, i2, "Promo_BM.png", PNG + b"2", "ms", opt=b"RIFF0000WEBPlight")  # light copy by default
    c, _, _ = upload(owner, i3, "Secret.png", PNG, "en")
    # staff only
    assert app.test_client().get(f"/zip?v={a}").status_code == 404
    r = client.get(f"/zip?v={a},{b},{c}&name=M2%20Ads%20%E4%B8%AD")
    assert r.status_code == 200 and r.headers["Content-Type"] == "application/zip" and r.headers["Cache-Control"] == "no-store"
    assert r.headers["Content-Length"] == str(len(r.data))
    assert r.headers["Content-Disposition"] == "attachment; filename=\"M2 Ads _.zip\"; filename*=UTF-8''M2%20Ads%20%E4%B8%AD.zip"
    z = zipfile.ZipFile(io.BytesIO(r.data))
    assert z.testzip() is None
    assert [n.filename for n in z.infolist()] == ["One_BM.png", "Two_BM.webp", "Three_EN.png"]
    assert z.read("One_BM.png") == PNG and z.read("Two_BM.webp") == b"RIFF0000WEBPlight"
    z2 = zipfile.ZipFile(io.BytesIO(client.get(f"/zip?v={a},{b},{a}&o=1").data))
    assert [n.filename for n in z2.infolist()] == ["One_BM.png", "Two_BM.png"]
    # the title in the language the library shows (l=…), English when it has no translation
    op(owner, "item.update", {"id": i1, "title": {"en": "One", "ms": "Satu", "zh": "一号/图"}})
    names = lambda l: [n.filename for n in zipfile.ZipFile(io.BytesIO(client.get(f"/zip?v={a},{b}&l={l}").data)).infolist()]  # noqa: E731
    assert names("ms") == ["Satu_BM.png", "Two_BM.webp"]
    assert names("zh") == ["一号 图_BM.png", "Two_BM.webp"]  # "/" can't be in a file name
    assert names("ta") == ["One_BM.png", "Two_BM.webp"]
    # two files with the same download name get "(2)"
    i4 = item(owner, f, "One")
    d, _, _ = upload(owner, i4, "Other.png", PNG + b"3", "ms")
    z3 = zipfile.ZipFile(io.BytesIO(client.get(f"/zip?v={a},{d}").data))
    assert [n.filename for n in z3.infolist()] == ["One_BM.png", "One_BM (2).png"]
    # a design in two languages, and one with no language
    e, _, _ = upload(owner, i4, "Other EN CN.png", PNG + b"4", "en", langs=["en", "zh"])
    g, _, _ = upload(owner, i3, "Logo.png", PNG + b"5", "all")
    z4 = zipfile.ZipFile(io.BytesIO(client.get(f"/zip?v={e},{g}").data))
    assert [n.filename for n in z4.infolist()] == ["One_EN_CN.png", "Three.png"]
    assert client.get("/zip").status_code == 400
    # nothing from the Trash
    op(owner, "trash", {"itemIds": [i3]})
    assert client.get(f"/zip?v={c}").status_code == 404


def test_zip_is_streamed(owner, app, monkeypatch):
    """The ZIP is produced while the files are read (never held whole in memory)."""
    f = folder(owner)
    i = item(owner, f)
    a, _, _ = upload(owner, i, "a.png", os.urandom(3 * MB))
    with app.test_request_context():
        pass
    r = owner.get(f"/zip?v={a}", buffered=False)
    assert r.is_streamed
    first = next(iter(r.response))
    assert 0 < len(first) < 3 * MB
    r.close()


def test_copy_paste_and_duplicate(owner, client):
    """Copy / paste / duplicate: folders with everything inside, and cards; the stored files are copied too."""
    top = folder(owner, "Rebate")
    sub = folder(owner, "Charts", top)
    i = item(owner, sub, "Game Rebate")
    a, ka, _ = upload(owner, i, "Rebate_EN.png", PNG, "en", thumb=b"RIFF0000WEBPthumb", opt=b"RIFF0000WEBPlight")
    b, kb, _ = upload(owner, i, "Rebate_BM.png", PNG + b"bm", "ms")
    op(owner, "folder.update", {"id": sub, "coverItemId": i})
    other = folder(owner, "Promos")

    # paste the whole "Rebate" folder into "Promos"
    r = op(owner, "copy.start", {"folderIds": [top], "itemIds": [], "targetId": other})
    assert r["folders"] == 2 and r["items"] == 1 and len(r["files"]) == 2 and len(r["folderIds"]) == 1
    # not on the library until the stored copies are made
    pub = ready_cards(client.application)
    assert len([x for x in pub["items"] if x["title"]["en"] == "Game Rebate"]) == 1
    res = op(owner, "copy.files", {"pairs": [{"id": f["id"], "src": f["src"]} for f in r["files"]]})
    assert sorted(res["done"]) == sorted(f["id"] for f in r["files"]) and res["failed"] == []
    t = owner.get("/api/admin/tree").get_json()
    fid = r["folderIds"][0]
    new_sub = next(f for f in t["folders"] if f["parentId"] == fid)
    assert next(f for f in t["folders"] if f["id"] == fid)["name"] == {"en": "Rebate"} and new_sub["name"] == {"en": "Charts"}
    copy = next(x for x in t["items"] if x["folderId"] == new_sub["id"])
    assert copy["title"] == {"en": "Game Rebate"} and new_sub["coverItemId"] == copy["id"]
    en = next(v for v in copy["variants"] if v["lang"] == "en")
    assert en["orig"] != ka["orig"] and en["orig"].endswith("/Rebate_EN.png") and en["status"] == "ready"
    assert client.get(f"/f/{en['orig']}").data == PNG and client.get(f"/f/{en['opt']}").data == b"RIFF0000WEBPlight" and client.get(f"/f/{en['thumb']}").data == b"RIFF0000WEBPthumb"
    assert len([x for x in ready_cards(client.application)["items"] if x["title"]["en"] == "Game Rebate"]) == 2

    # the log line, and undo from it sends the copy to the Trash
    log = op(owner, "audit.list", {"kind": "content"})["entries"]
    assert log[0]["summary"] == "Copied “📁 Rebate” to Promos (2 files)" and log[0]["undoable"]

    # duplicate next to the original: "(copy)", "(copy 2)", own links
    d1 = op(owner, "copy.start", {"folderIds": [top], "itemIds": [], "targetId": None})
    d2 = op(owner, "copy.start", {"folderIds": [top], "itemIds": [], "targetId": None})
    t = owner.get("/api/admin/tree").get_json()
    names = {f["id"]: (f["name"]["en"], f["slug"]) for f in t["folders"]}
    assert names[d1["folderIds"][0]] == ("Rebate (copy)", "rebate-copy") and names[d2["folderIds"][0]] == ("Rebate (copy 2)", "rebate-copy-2")

    # a card pasted into its own folder
    c = op(owner, "copy.start", {"folderIds": [], "itemIds": [i], "targetId": sub})
    op(owner, "copy.files", {"pairs": [{"id": f["id"], "src": f["src"]} for f in c["files"]]})
    t = owner.get("/api/admin/tree").get_json()
    assert next(x for x in t["items"] if x["id"] == c["itemIds"][0])["title"] == {"en": "Game Rebate (copy)"}
    # cards need a folder; nothing to copy is refused
    op(owner, "copy.start", {"folderIds": [], "itemIds": [i], "targetId": None}, status=400)
    op(owner, "copy.start", {"folderIds": [], "itemIds": [], "targetId": sub}, status=400)

    # deleting the copies for good leaves the original's files alone
    op(owner, "audit.undo", {"id": log[0]["id"]})
    op(owner, "purge", {"all": True})
    assert client.get(f"/f/{ka['orig']}").data == PNG and client.get(f"/f/{kb['orig']}").status_code == 200
