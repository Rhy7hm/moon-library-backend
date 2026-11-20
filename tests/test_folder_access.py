"""A folder an Owner limits to chosen people: invisible and untouchable for everyone else on the team."""
from tests.conftest import PASSWORD, folder, item, login, make_user, op, upload

PNG = b"\x89PNG\r\n\x1a\n" + b"p" * 500


def sign_in(app, username, role):
    uid = make_user(app, username, role=role)
    c = app.test_client()
    login(c, username)
    return uid, c


def tree(c):
    return c.get("/api/admin/tree").get_json()


def setup(owner, app):
    mkt = folder(owner, "CLIENT (MKT)")
    inner = folder(owner, "Briefs", mkt)
    shared = folder(owner, "Designs")
    secret = item(owner, inner, "Plan")
    _, keys, _ = upload(owner, secret, "plan.png", PNG, thumb=b"RIFF0000WEBPxxxx")
    open_item = item(owner, shared, "Poster")
    upload(owner, open_item, "poster.png", PNG)
    return mkt, inner, shared, secret, open_item, keys


def test_limited_folder_is_gone_for_everyone_not_on_the_list(owner, app):
    mkt, inner, shared, secret, open_item, keys = setup(owner, app)
    marketer, mc = sign_in(app, "marketer", "editor")
    _, dc = sign_in(app, "designer", "editor")
    op(owner, "folder.access", {"id": mkt, "restricted": True, "userIds": [marketer]})

    t = tree(owner)  # Owners see everything, and who it's shared with
    assert {f["id"] for f in t["folders"]} >= {mkt, inner, shared}
    assert next(f for f in t["folders"] if f["id"] == mkt)["access"] == [marketer]
    assert {i["id"] for i in t["items"]} == {secret, open_item}

    t = tree(mc)  # listed: sees it, but not the list
    assert mkt in {f["id"] for f in t["folders"]} and secret in {i["id"] for i in t["items"]}
    assert next(f for f in t["folders"] if f["id"] == mkt)["restricted"] is True and "access" not in next(f for f in t["folders"] if f["id"] == mkt)

    t = tree(dc)  # not listed: nothing of it, including sub-folders, cards and files
    assert {f["id"] for f in t["folders"]} == {shared} | {f["id"] for f in t["folders"] if f["id"] not in (mkt, inner)}
    assert mkt not in {f["id"] for f in t["folders"]} and inner not in {f["id"] for f in t["folders"]}
    assert {i["id"] for i in t["items"]} == {open_item}


def test_the_files_inside_wont_load_or_download(owner, app):
    mkt, inner, shared, secret, open_item, keys = setup(owner, app)
    marketer, mc = sign_in(app, "marketer", "editor")
    _, dc = sign_in(app, "designer", "editor")
    op(owner, "folder.access", {"id": mkt, "restricted": True, "userIds": [marketer]})
    for k in ("orig", "thumb"):
        assert owner.get(f"/f/{keys[k]}").status_code == 200
        assert mc.get(f"/f/{keys[k]}").status_code == 200
        assert dc.get(f"/f/{keys[k]}").status_code == 404
    fid = next(v["id"] for i in tree(owner)["items"] if i["id"] == secret for v in i["variants"])
    assert mc.get(f"/zip?v={fid}").status_code == 200
    assert dc.get(f"/zip?v={fid}").status_code == 404
    assert dc.get(f"/zip?folder={mkt}").status_code == 404


def test_changes_aimed_at_it_are_refused(owner, app):
    mkt, inner, shared, secret, open_item, keys = setup(owner, app)
    marketer, _ = sign_in(app, "marketer", "editor")
    _, dc = sign_in(app, "designer", "editor")
    op(owner, "folder.access", {"id": mkt, "restricted": True, "userIds": [marketer]})
    fid = next(v["id"] for i in tree(owner)["items"] if i["id"] == secret for v in i["variants"])
    for name, body in [
        ("folder.update", {"id": mkt, "name": {"en": "Mine"}}),
        ("folder.create", {"parentId": inner, "name": {"en": "Sneaky"}}),
        ("item.create", {"folderId": inner, "title": {"en": "x"}}),
        ("item.update", {"id": secret, "title": {"en": "x"}}),
        ("trash", {"itemIds": [secret]}),
        ("trash", {"folderIds": [mkt]}),
        ("file.delete", {"id": fid}),
        ("move", {"itemIds": [open_item], "folderId": inner}),
        ("move", {"itemIds": [secret], "folderId": shared}),
        ("versions.list", {"itemId": secret}),
        ("tags.set", {"itemIds": [secret], "add": []}),
    ]:
        op(dc, name, body, status=404)
    assert any(i["id"] == secret and not i["deletedAt"] for i in tree(owner)["items"])


def test_only_owners_decide_and_only_real_team_members_can_be_listed(owner, app):
    mkt = folder(owner, "MKT")
    ed, ec = sign_in(app, "ed", "editor")
    op(ec, "folder.access", {"id": mkt, "restricted": True, "userIds": [ed]}, status=403)
    op(owner, "folder.access", {"id": mkt, "restricted": "yes"}, status=400)
    other_owner = make_user(app, "owner2", role="owner")
    op(owner, "folder.access", {"id": mkt, "restricted": True, "userIds": [other_owner]}, status=400)
    op(owner, "folder.access", {"id": mkt, "restricted": True, "userIds": ["nobody"]}, status=400)
    op(owner, "folder.access", {"id": "missing", "restricted": True, "userIds": []}, status=404)


def test_owners_always_see_it_and_it_can_be_opened_up_again(owner, app):
    mkt, inner, shared, secret, open_item, keys = setup(owner, app)
    _, dc = sign_in(app, "designer", "editor")
    boss = make_user(app, "owner2", role="owner")
    oc = app.test_client()
    login(oc, "owner2")
    op(owner, "folder.access", {"id": mkt, "restricted": True, "userIds": []})  # Owners only
    assert mkt in {f["id"] for f in tree(oc)["folders"]} and mkt not in {f["id"] for f in tree(dc)["folders"]}
    op(owner, "folder.access", {"id": mkt, "restricted": False})
    assert mkt in {f["id"] for f in tree(dc)["folders"]} and dc.get(f"/f/{keys['orig']}").status_code == 200


def test_the_activity_log_hides_what_happened_inside(owner, app):
    mkt, inner, shared, secret, open_item, keys = setup(owner, app)
    marketer, mc = sign_in(app, "marketer", "editor")
    _, dc = sign_in(app, "designer", "editor")
    op(owner, "folder.access", {"id": mkt, "restricted": True, "userIds": [marketer]})
    mine = op(mc, "audit.list", {"kind": "content"})["entries"]
    theirs = op(dc, "audit.list", {"kind": "content"})["entries"]
    assert any(e["action"] == "folder.access" for e in mine)
    assert not any(e["action"] == "folder.access" for e in theirs)
    entry = next(e for e in op(owner, "audit.list", {"kind": "content"})["entries"] if e["action"] == "folder.access")
    assert "CLIENT (MKT)" in entry["summary"]
    op(dc, "audit.undo", {"id": entry["id"]}, status=404)


def test_a_folder_shared_with_a_client_is_for_owners_only(owner, app):
    from tests.conftest import sql

    shared = folder(owner, "Ari Hubs")
    plain = folder(owner, "Designs")
    sub = folder(owner, "Posters", shared)
    ed, ec = sign_in(app, "designer", "editor")
    cid = op(owner, "clients.create", {"name": "Ari Hubs"})["id"]
    op(owner, "shares.add", {"clientId": cid, "folderIds": [shared]})
    ids = {f["id"] for f in tree(ec)["folders"]}
    assert shared not in ids and sub not in ids and plain in ids  # gone for the designer, sub-folders too
    assert shared in {f["id"] for f in tree(owner)["folders"]}
    assert next(f for f in tree(owner)["folders"] if f["id"] == shared)["access"] == []
    # a folder made for the client from its page is limited as well
    new = op(owner, "clients.newFolder", {"clientId": cid, "name": "Reels"})["id"]
    assert new not in {f["id"] for f in tree(ec)["folders"]}
    # one an Owner already limited to chosen people keeps that list
    mine = folder(owner, "Mine")
    op(owner, "folder.access", {"id": mine, "restricted": True, "userIds": [ed]})
    op(owner, "shares.add", {"clientId": cid, "folderIds": [mine]})
    assert next(f for f in tree(owner)["folders"] if f["id"] == mine)["access"] == [ed]


def test_designers_dont_see_or_touch_clients(owner, app):
    """Clients are the Owners' (marketing's) work: Editors and Viewers get no clients and can't share."""
    _, ec = sign_in(app, "designer", "editor")
    f = folder(ec, "Designs")
    i = item(ec, f, "Poster")
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    assert op(ec, "clients.list")["clients"] == []
    assert len(op(owner, "clients.list")["clients"]) == 1
    for name, body in [
        ("clients.create", {"name": "Nope"}),
        ("clients.update", {"id": cid, "name": "x"}),
        ("clients.newFolder", {"clientId": cid, "name": "x"}),
        ("clients.home", {"clientId": cid}),
        ("shares.add", {"clientId": cid, "folderIds": [f]}),
        ("shares.remove", {"clientId": cid, "ids": ["x"]}),
        ("logins.create", {"clientId": cid, "email": "a@b.co", "name": "A"}),
        ("links.add", {"folderId": f, "itemIds": [i]}),
    ]:
        op(ec, name, body, status=403)


def test_command_limits_folders_that_were_already_shared(owner, app):
    from tests.conftest import run_sql

    f = folder(owner, "Old share")
    cid = op(owner, "clients.create", {"name": "Acme"})["id"]
    op(owner, "shares.add", {"clientId": cid, "folderIds": [f]})
    run_sql(app, "UPDATE folders SET restricted = 0 WHERE id = ?", f)  # as it was before this feature
    _, dc = sign_in(app, "designer", "editor")
    assert f in {x["id"] for x in tree(dc)["folders"]}
    r = app.test_cli_runner().invoke(args=["limit-shared-folders"])
    assert r.exit_code == 0 and "Old share" in r.output and "now limited" in r.output
    assert f not in {x["id"] for x in tree(dc)["folders"]}
    assert "Nothing to do" in app.test_cli_runner().invoke(args=["limit-shared-folders"]).output
