"""Tags on files, end dates on client shares, and downloading a whole folder as a ZIP."""
import io
import zipfile

from tests.conftest import folder, item, op, upload
from tests.test_client_api import client_login, setup_client

PNG = b"\x89PNG\r\n\x1a\n" + b"t" * 300


def tree(c):
    return c.get("/api/admin/tree").get_json()


def test_tags_add_remove_rename_delete(owner):
    f = folder(owner, "CNY")
    a, b = item(owner, f, "Poster"), item(owner, f, "Story")
    r = op(owner, "tags.set", {"itemIds": [a, b], "add": ["CNY 2027", "approved", "  cny   2027 "]})
    names = {t["name"]: t["id"] for t in r["tags"]}
    assert set(names) == {"CNY 2027", "approved"}  # same name in another case or spacing is the same tag
    t = tree(owner)
    by = {i["id"]: set(i["tags"]) for i in t["items"]}
    assert by[a] == by[b] == set(names.values())
    assert {x["name"] for x in t["tags"]} == {"CNY 2027", "approved"} and all(x["color"] for x in t["tags"])
    op(owner, "tags.set", {"itemIds": [b], "remove": [names["approved"]]})
    assert set(next(i for i in tree(owner)["items"] if i["id"] == b)["tags"]) == {names["CNY 2027"]}
    op(owner, "tags.update", {"id": names["approved"], "name": "Approved ✓", "color": "#34c759"})
    op(owner, "tags.update", {"id": names["approved"], "name": "cny 2027"}, status=409)
    op(owner, "tags.update", {"id": names["approved"], "color": "red"}, status=400)
    op(owner, "tags.delete", {"id": names["CNY 2027"]})
    t = tree(owner)
    assert [x["name"] for x in t["tags"]] == ["Approved ✓"] and set(next(i for i in t["items"] if i["id"] == b)["tags"]) == set()
    op(owner, "tags.set", {"itemIds": ["nope"], "add": ["x"]}, status=404)
    op(owner, "tags.set", {"itemIds": [a]}, status=400)


def test_tags_go_with_purged_files(owner, app):
    from tests.conftest import sql

    f = folder(owner)
    a = item(owner, f)
    op(owner, "tags.set", {"itemIds": [a], "add": ["IG story"]})
    op(owner, "trash", {"itemIds": [a]})
    op(owner, "purge", {"itemIds": [a]})
    assert sql(app, "SELECT COUNT(*) AS n FROM item_tags")[0]["n"] == 0
    assert [x["name"] for x in tree(owner)["tags"]] == ["IG story"]  # the label itself stays for next time


def test_share_end_date(owner, app, monkeypatch):
    import app.blueprints.client_api as capi
    import app.services.client_ops as cops

    cid, _, pw = setup_client(owner)
    f = folder(owner, "Acme CNY")
    fid, _, _ = upload(owner, item(owner, f, "Lion"), "lion.png", PNG)
    t0 = 1_900_000_000_000
    monkeypatch.setattr(cops, "now", lambda: t0)
    monkeypatch.setattr(capi, "now", lambda: t0)
    op(owner, "shares.add", {"clientId": cid, "folderIds": [f], "expiresAt": t0 - 1}, status=400)  # not in the past
    op(owner, "shares.add", {"clientId": cid, "folderIds": [f], "expiresAt": t0 + 1000})
    share = op(owner, "clients.list")["clients"][0]["shares"][0]
    assert share["expiresAt"] == t0 + 1000
    c = client_login(app, "amy@acme.my", pw)
    assert [x["title"] for x in c.get("/api/client/library").get_json()["items"]] == ["Lion"]
    # the day passes: the client no longer sees it, nor can open the file
    monkeypatch.setattr(capi, "now", lambda: t0 + 2000)
    assert c.get("/api/client/library").get_json()["items"] == []
    assert c.get(f"/api/client/files/{fid}/download").status_code == 404
    # moving the end date (or clearing it) brings it back
    op(owner, "shares.expire", {"clientId": cid, "ids": [share["id"]], "expiresAt": None})
    assert len(c.get("/api/client/library").get_json()["items"]) == 1
    # sharing again with an end date moves the end date of what's already shared
    op(owner, "shares.add", {"clientId": cid, "folderIds": [f], "expiresAt": t0 + 5000})
    assert op(owner, "clients.list")["clients"][0]["shares"][0]["expiresAt"] == t0 + 5000


def test_bulk_share_many_files(owner):
    cid, _, _ = setup_client(owner)
    f = folder(owner)
    ids = [item(owner, f, f"Card {i}") for i in range(5)]
    assert op(owner, "shares.add", {"clientId": cid, "itemIds": ids})["added"] == 5
    assert op(owner, "shares.add", {"clientId": cid, "itemIds": ids})["skipped"] == 5


def test_zip_a_whole_folder(owner):
    top = folder(owner, "Campaign")
    sub = folder(owner, "Posters", top)
    gone = folder(owner, "Old", top)
    upload(owner, item(owner, top, "Brief"), "brief.png", PNG)
    upload(owner, item(owner, sub, "Lion"), "lion.png", PNG + b"1")
    upload(owner, item(owner, gone, "Old one"), "old.png", PNG + b"2")
    op(owner, "trash", {"folderIds": [gone]})
    r = owner.get(f"/zip?folder={top}&o=1")
    assert r.status_code == 200 and "Campaign" in r.headers["Content-Disposition"]
    names = sorted(zipfile.ZipFile(io.BytesIO(r.data)).namelist())
    assert len(names) == 2 and any(n.startswith("Posters/") for n in names) and not any("Old" in n for n in names)
    assert owner.get(f"/zip?folder={gone}").status_code == 404
    assert owner.get("/zip?folder=nope").status_code == 404
