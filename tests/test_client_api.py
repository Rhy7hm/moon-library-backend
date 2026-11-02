"""The client website's API: client logins, seeing only what's shared, and sending files to the team."""
from tests.conftest import folder, item, op, sql, upload

PNG = b"\x89PNG\r\n\x1a\n" + b"c" * 300


def setup_client(owner, name="Acme", email="amy@acme.my"):
    cid = op(owner, "clients.create", {"name": name})["id"]
    r = op(owner, "logins.create", {"clientId": cid, "email": email, "name": "Amy"})
    return cid, r["id"], r["password"]


def client_login(app, email, password, status=200):
    c = app.test_client()
    r = c.post("/api/client/auth/login", json={"email": email, "password": password})
    assert r.status_code == status, r.get_json()
    return c


def test_login_me_logout_and_separate_from_staff(owner, app):
    cid, lid, pw = setup_client(owner)
    assert op(owner, "clients.list")["clients"][0]["logins"][0]["email"] == "amy@acme.my"
    c = client_login(app, "AMY@acme.my ", pw)
    assert c.get("/api/client/auth/me").get_json() == {"user": {"name": "Amy", "email": "amy@acme.my"}, "client": {"name": "Acme", "color": None}}
    # a client session is not a staff session
    assert c.post("/api/admin/clients.list", json={}).status_code == 401
    assert c.get("/api/admin/tree").status_code == 401
    # and a staff session is not a client session
    assert owner.get("/api/client/library").status_code == 401
    c.post("/api/client/auth/logout")
    assert c.get("/api/client/auth/me").get_json() == {"user": None}
    assert c.get("/api/client/library").status_code == 401


def test_wrong_password_lockout_reset_and_turn_off(owner, app):
    cid, lid, pw = setup_client(owner)
    for _ in range(5):
        client_login(app, "amy@acme.my", "nope", status=401)
    client_login(app, "amy@acme.my", pw, status=429)
    pw2 = op(owner, "logins.reset", {"id": lid})["password"]
    client_login(app, "amy@acme.my", pw, status=401)
    c = client_login(app, "amy@acme.my", pw2)
    op(owner, "logins.update", {"id": lid, "disabled": True})
    assert c.get("/api/client/library").status_code == 401  # signed out at once
    client_login(app, "amy@acme.my", pw2, status=401)
    op(owner, "logins.update", {"id": lid, "disabled": False})
    client_login(app, "amy@acme.my", pw2)
    op(owner, "logins.create", {"clientId": cid, "email": "amy@acme.my"}, status=409)
    # a client can change their own password
    c = client_login(app, "amy@acme.my", pw2)
    assert c.post("/api/client/auth/password", json={"current": pw2, "next": "short"}).status_code == 400
    assert c.post("/api/client/auth/password", json={"current": pw2, "next": "a new long one"}).status_code == 200
    client_login(app, "amy@acme.my", "a new long one")


def test_sees_only_whats_shared(owner, app):
    cid, lid, pw = setup_client(owner)
    shared = folder(owner, "Acme CNY")
    sub = folder(owner, "Posters", shared)
    other = folder(owner, "Beta secret")
    i1, i2, i3, i4 = item(owner, shared, "Lion"), item(owner, sub, "Poster A"), item(owner, other, "Secret"), item(owner, other, "One-off")
    f1, _, _ = upload(owner, i1, "lion.png", PNG, thumb=b"t" * 10)
    f2, _, _ = upload(owner, i2, "a.png", PNG)
    f3, _, _ = upload(owner, i3, "secret.png", PNG)
    f4, _, _ = upload(owner, i4, "oneoff.png", PNG)
    item(owner, shared, "Empty card")  # no finished file: not shown
    op(owner, "shares.add", {"clientId": cid, "folderIds": [shared], "itemIds": [i4], "links": [{"url": "https://canva.com/x", "title": "Board"}]})
    c = client_login(app, "amy@acme.my", pw)
    lib = c.get("/api/client/library").get_json()
    assert {x["name"] for x in lib["collections"]} == {"Acme CNY", "Posters"}
    by = {x["name"]: x for x in lib["collections"]}
    assert by["Acme CNY"]["parentId"] is None and by["Posters"]["parentId"] == shared
    assert {x["title"] for x in lib["items"]} == {"Lion", "Poster A", "One-off"}
    assert lib["links"][0]["url"] == "https://canva.com/x"
    assert "key" not in str(lib).lower()  # no storage keys
    # files: shared ones open, others don't exist for them
    assert c.get(f"/api/client/files/{f1}/download").data == PNG
    assert c.get(f"/api/client/files/{f1}/thumb").data == b"t" * 10
    assert c.get(f"/api/client/files/{f2}/preview").status_code == 200
    assert c.get(f"/api/client/files/{f4}/download").status_code == 200
    assert c.get(f"/api/client/files/{f3}/download").status_code == 404
    assert c.get(f"/api/client/files/{f3}/thumb").status_code == 404
    # staff-only file routes stay staff-only
    key = sql(app, "SELECT key_orig FROM files WHERE id = ?", f1)[0]["key_orig"]
    assert c.get(f"/f/{key}").status_code in (401, 403, 404)
    # trashed: gone at once; unshared: gone at once
    op(owner, "trash", {"folderIds": [sub]})
    lib = c.get("/api/client/library").get_json()
    assert {x["name"] for x in lib["collections"]} == {"Acme CNY"} and c.get(f"/api/client/files/{f2}/download").status_code == 404
    op(owner, "shares.remove", {"clientId": cid, "ids": [s["id"] for s in op(owner, "clients.list")["clients"][0]["shares"]]})
    lib = c.get("/api/client/library").get_json()
    assert lib["collections"] == [] and lib["items"] == [] and lib["links"] == []
    assert c.get(f"/api/client/files/{f1}/download").status_code == 404


def test_other_clients_see_nothing(owner, app):
    cid, _, pw = setup_client(owner)
    _, _, pw_b = setup_client(owner, "Beta", "bob@beta.my")
    f = folder(owner, "Acme only")
    fid, _, _ = upload(owner, item(owner, f), "a.png", PNG)
    op(owner, "shares.add", {"clientId": cid, "folderIds": [f]})
    b = client_login(app, "bob@beta.my", pw_b)
    assert b.get("/api/client/library").get_json()["items"] == []
    assert b.get(f"/api/client/files/{fid}/download").status_code == 404


def test_client_uploads_land_in_their_inbox(owner, app):
    cid, _, pw = setup_client(owner)
    c = client_login(app, "amy@acme.my", pw)
    assert c.get("/api/client/uploads").get_json() == {"uploads": []}
    j = c.post("/api/client/uploads/start", json={"name": "logo_final.png", "mime": "image/png", "size": len(PNG), "kind": "image"}).get_json()
    r = c.put("/api/client/upload", query_string={"key": j["keys"]["orig"], "contentType": "image/png", "downloadName": "logo_final.png"}, data=PNG)
    assert r.status_code == 200, r.get_json()
    assert c.post("/api/client/uploads/ready", json={"id": j["id"]}).status_code == 200
    ups = c.get("/api/client/uploads").get_json()["uploads"]
    assert [u["title"] for u in ups] == ["logo final"] and ups[0]["fromTeam"] is False
    assert c.get(f"/api/client/files/{j['id']}/download").data == PNG
    # the team sees it in "From Acme"
    inbox = op(owner, "clients.list")["clients"][0]["inboxFolderId"]
    tree = owner.get("/api/admin/tree").get_json()
    assert any(f["id"] == inbox for f in tree["folders"])
    assert any(i["folderId"] == inbox for i in tree["items"])
    log = [e["summary"] for e in op(owner, "audit.list", {"kind": "content"})["entries"]]
    assert "Amy (Acme) sent “logo_final.png”" in log
    # a finished file can't be overwritten, and keys outside their inbox are refused
    assert c.put("/api/client/upload", query_string={"key": j["keys"]["orig"]}, data=b"x").status_code == 403
    f = folder(owner, "Staff")
    other = op(owner, "file.create", {"itemId": item(owner, f), "lang": "all", "kind": "image", "name": "x.png", "mime": "image/png", "size": 3})
    assert c.put("/api/client/upload", query_string={"key": other["keys"]["orig"]}, data=b"abc").status_code == 403
    assert c.post("/api/client/uploads/ready", json={"id": other["id"]}).status_code == 404
