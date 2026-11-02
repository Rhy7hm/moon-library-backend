"""Stored files: staff only, can't run as pages on this site, finished files can't be overwritten."""
import os

from tests.conftest import folder, item, login, make_user, upload

PNG = b"\x89PNG\r\n\x1a\n" + os.urandom(500)
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>'


def f_path(key):
    return "/f/" + key


def test_files_need_a_staff_sign_in(owner, app):
    i = item(owner, folder(owner))
    _, keys, _ = upload(owner, i, "a.png", PNG)
    for key in (keys["orig"], keys["thumb"] or keys["orig"]):
        r = app.test_client().get(f_path(key))
        assert r.status_code == 404 and r.headers["Cache-Control"] == "no-store"
    r = owner.get(f_path(keys["orig"]))
    assert r.status_code == 200 and r.data == PNG and r.headers["Cache-Control"] == "private, max-age=86400"
    # every role may look; a signed-out browser may not
    make_user(app, "viewer1", "viewer")
    viewer = app.test_client()
    login(viewer, "viewer1")
    assert viewer.get(f_path(keys["orig"])).status_code == 200


def test_svg_and_html_download_in_a_sandbox(owner):
    f = folder(owner)
    _, svg_keys, _ = upload(owner, item(owner, f, "Logo"), "logo.svg", SVG, mime="image/svg+xml")
    _, html_keys, _ = upload(owner, item(owner, f, "Page"), "page.html", b"<script>alert(1)</script>", mime="text/html", kind="other")
    for key in (svg_keys["orig"], html_keys["orig"]):
        r = owner.get(f_path(key))
        assert r.status_code == 200
        assert r.headers["Content-Disposition"].startswith("attachment")
        assert "sandbox" in r.headers["Content-Security-Policy"]
        assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_pictures_open_in_the_browser_but_still_sandboxed(owner):
    i = item(owner, folder(owner))
    _, keys, _ = upload(owner, i, "a.png", PNG)
    r = owner.get(f_path(keys["orig"]))
    assert r.status_code == 200 and "Content-Disposition" not in r.headers and "sandbox" in r.headers["Content-Security-Policy"]


def test_pdf_opens_without_sandbox(owner):
    i = item(owner, folder(owner))
    _, keys, _ = upload(owner, i, "brief.pdf", b"%PDF-1.4 test", mime="application/pdf", kind="document")
    r = owner.get(f_path(keys["orig"]))
    assert r.status_code == 200 and "Content-Security-Policy" not in r.headers and "Content-Disposition" not in r.headers


def test_finished_file_cannot_be_overwritten(owner):
    i = item(owner, folder(owner))
    _, keys, _ = upload(owner, i, "a.png", PNG)
    r = owner.put("/api/admin/upload", query_string={"key": keys["orig"], "contentType": "text/html"}, data=b"<script>x</script>")
    assert r.status_code == 409
    r = owner.post("/api/admin/mpu.create", json={"key": keys["orig"], "contentType": "text/html"})
    assert r.status_code == 409
    assert owner.get(f_path(keys["orig"])).data == PNG


def test_old_versions_stay_downloadable_for_staff(owner, app):
    i = item(owner, folder(owner))
    a, old_keys, _ = upload(owner, i, "a.png", PNG, "ms")
    upload(owner, i, "a.png", PNG + b"new", "ms", replaces=a)
    assert owner.get(f_path(old_keys["orig"])).data == PNG
    assert app.test_client().get(f_path(old_keys["orig"])).status_code == 404


def test_no_public_api(app):
    c = app.test_client()
    for path in ("/api/public/v1/assets", "/api/public/v1/collections", "/media/abc/preview", "/api/library", "/api/track"):
        assert c.get(path).status_code in (302, 404), path  # unknown pages go to the admin sign-in
