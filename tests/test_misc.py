"""Housekeeping, the owner command, admin page serving, error format, config."""

from tests.conftest import folder, item, login, op, run_sql, sql, upload

PNG = b"\x89PNG\r\n\x1a\n" + b"z" * 100


def test_cleanup_after_90_days(app, owner):
    f = folder(owner)
    i = item(owner, f)
    a, keys, _ = upload(owner, i, "a.png", PNG)
    b, _, r = upload(owner, i, "a.png", PNG + b"2", replaces=a)
    j = item(owner, f, "Old")
    op(owner, "trash", {"itemIds": [j]})
    old = 91 * 24 * 3600_000
    run_sql(app, "UPDATE file_versions SET replaced_at = replaced_at - ?", old)
    run_sql(app, "UPDATE items SET deleted_at = deleted_at - ? WHERE id = ?", old, j)
    owner.get("/api/admin/tree")  # the hourly clean-up runs on an admin visit
    assert sql(app, "SELECT COUNT(*) AS n FROM file_versions")[0]["n"] == 0
    assert sql(app, "SELECT COUNT(*) AS n FROM items WHERE id = ?", j)[0]["n"] == 0
    assert owner.get("/f/" + keys["orig"]).status_code == 404
    entry = next(e for e in op(owner, "audit.list", {"kind": "content"})["entries"] if e["action"] == "purge.auto")
    assert entry["summary"] == "Trash emptied automatically: 1 file and 0 folders older than 90 days" and entry["username"] == "system"
    # at most once an hour
    j2 = item(owner, f, "Old 2")
    op(owner, "trash", {"itemIds": [j2]})
    run_sql(app, "UPDATE items SET deleted_at = deleted_at - ? WHERE id = ?", old, j2)
    owner.get("/api/admin/tree")
    assert sql(app, "SELECT COUNT(*) AS n FROM items WHERE id = ?", j2)[0]["n"] == 1


def test_create_owner_command(app, client):
    runner = app.test_cli_runner()
    res = runner.invoke(args=["create-owner", "--username", "Moon", "--name", "Moon", "--password", "long enough 1"])
    assert res.exit_code == 0, res.output
    login(client, "moon", "long enough 1")
    res = runner.invoke(args=["create-owner", "--username", "two", "--name", "Two", "--password", "long enough 1"])
    assert res.exit_code != 0 and "Accounts already exist" in res.output


def test_errors_are_json_and_generic_in_production(app, owner, monkeypatch):
    r = owner.post("/api/admin/nope.op", json={})
    assert r.status_code == 404 and r.get_json() == {"error": "Unknown operation: nope.op"}
    assert owner.get("/api/admin/nope").get_json() == {"error": "Unknown request"}
    from app.services import admin_ops

    def boom(ctx, b):
        raise RuntimeError("secret detail")

    monkeypatch.setitem(admin_ops.OPS, "move", boom)
    app.config["PRODUCTION"] = True
    r = owner.post("/api/admin/move", json={})
    assert r.status_code == 500 and r.get_json() == {"error": "Server error"}
    app.config["PRODUCTION"] = False


def test_admin_page_served_by_flask(app, client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "fonts").mkdir()
    (dist / "index.html").write_text("<!doctype html><title>Moon Library — Admin</title>")
    (dist / "assets" / "index-abc.js").write_text("console.log(1)")
    (dist / "fonts" / "m2sans.css").write_text("@font-face{}")
    old = app.config["ADMIN_DIST"]
    app.config["ADMIN_DIST"] = str(dist)
    try:
        r = client.get("/admin")
        assert r.status_code == 200 and b"Moon Library" in r.data and r.headers["Cache-Control"] == "no-store" and r.headers["X-Robots-Tag"] == "noindex, nofollow"
        assert client.get("/admin/assets/index-abc.js").headers["Cache-Control"] == "public, max-age=31536000, immutable"
        assert client.get("/admin/fonts/m2sans.css").status_code == 200 and client.get("/fonts/m2sans.css").status_code == 200
        assert client.get("/admin/anything/else").data == r.data
        assert client.get("/admin/../app/config.py").status_code in (200, 404) and b"SECRET" not in client.get("/admin/%2e%2e/app/config.py").data
    finally:
        app.config["ADMIN_DIST"] = old
    app.config["ADMIN_DIST"] = str(tmp_path / "missing")
    assert client.get("/admin").status_code == 503
    app.config["ADMIN_DIST"] = old


def test_database_url_with_special_characters(monkeypatch):
    from app.config import database_url

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DB_PASSWORD", "p@ss:w/rd#%?&")
    monkeypatch.setenv("DB_USER", "moonlib")
    monkeypatch.setenv("DB_HOST", "db.internal")
    monkeypatch.setenv("DB_NAME", "moon_library")
    u = database_url()
    assert u.password == "p@ss:w/rd#%?&" and u.host == "db.internal" and u.database == "moon_library" and u.query["charset"] == "utf8mb4"


def test_production_needs_secret_key(monkeypatch):
    import pytest

    from app.config import Config

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError):
        Config()
    monkeypatch.setenv("SECRET_KEY", "x")
    monkeypatch.setenv("ALLOW_SETUP_WITHOUT_KEY", "1")
    monkeypatch.delenv("TRUST_PROXY_HOPS", raising=False)
    c = Config()
    assert c.ALLOW_SETUP_WITHOUT_KEY is False and c.COOKIE_SECURE_ALWAYS is True and c.TRUST_PROXY_HOPS == 1


def test_refuses_the_m2_database_and_bucket(monkeypatch):
    import pytest

    from app.config import Config

    monkeypatch.delenv("DATABASE_URL", raising=False)
    for db_name in ("m2library", "m2win-api"):
        monkeypatch.setenv("DB_NAME", db_name)
        with pytest.raises(RuntimeError, match="M2 database"):
            Config()
    monkeypatch.setenv("DB_NAME", "moon_library")
    for bucket in ("m2-library", "m2win"):
        monkeypatch.setenv("R2_BUCKET_NAME", bucket)
        with pytest.raises(RuntimeError, match="M2 bucket"):
            Config()
    monkeypatch.setenv("DATABASE_URL", "mysql+pymysql://u@h/m2library")
    monkeypatch.setenv("R2_BUCKET_NAME", "moon-library")
    with pytest.raises(RuntimeError, match="M2 database"):
        Config()
