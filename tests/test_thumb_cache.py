"""Thumbnails are kept on the server's disk after the first look, and dropped when the file is deleted."""
import os

from tests.conftest import folder, item, op, upload

PNG = b"\x89PNG\r\n\x1a\n" + os.urandom(300)


def test_thumbnails_are_served_from_disk_after_the_first_time(owner, app, tmp_path, monkeypatch):
    app.config.update(THUMB_CACHE_MB=1, THUMB_CACHE_DIR=str(tmp_path))
    try:
        fid, keys, _ = upload(owner, item(owner, folder(owner, "Raya")), "lion.png", PNG, thumb=b"thumb-bytes")
        r = owner.get("/f/" + keys["thumb"])
        assert r.status_code == 200 and r.data == b"thumb-bytes" and "immutable" in r.headers["Cache-Control"]
        etag = r.headers["ETag"]
        assert sum(len(n) for _d, _s, n in os.walk(tmp_path)) == 1

        # the second time storage isn't asked at all
        from app.storage import storage

        with app.app_context():
            st = storage()
        monkeypatch.setattr(st, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("went to storage")))
        r = owner.get("/f/" + keys["thumb"])
        assert r.status_code == 200 and r.data == b"thumb-bytes" and r.headers["Content-Type"] == "image/webp" and r.headers["ETag"] == etag
        assert owner.get("/f/" + keys["thumb"], headers={"If-None-Match": etag}).status_code == 304
        # still only for people who are signed in
        assert app.test_client().get("/f/" + keys["thumb"]).status_code == 404
        monkeypatch.undo()

        # originals are never kept here
        assert owner.get("/f/" + keys["orig"]).status_code == 200
        assert sum(len(n) for _d, _s, n in os.walk(tmp_path)) == 1

        # deleting the file for good drops the copy
        from app.storage import storage as s2

        with app.app_context():
            s2().delete([keys["thumb"]])
        assert sum(len(n) for _d, _s, n in os.walk(tmp_path)) == 0
        assert owner.get("/f/" + keys["thumb"]).status_code == 404
    finally:
        app.config.update(THUMB_CACHE_MB=0, THUMB_CACHE_DIR=None)


def test_the_cache_folder_stays_under_its_limit(app, tmp_path):
    from app import thumb_cache

    app.config.update(THUMB_CACHE_MB=1, THUMB_CACHE_DIR=str(tmp_path))
    try:
        with app.app_context():
            for i in range(6):
                thumb_cache.put(f"t/file{i:04d}.webp", "image/webp", '"e"', os.urandom(300 * 1024))
                os.utime(thumb_cache._path(str(tmp_path), f"t/file{i:04d}.webp"), (1000 + i, 1000 + i))
            assert thumb_cache.prune() > 0
            assert thumb_cache.get("t/file0000.webp") is None and thumb_cache.get("t/file0005.webp") is not None
            thumb_cache.put("o/abcdef/big.png", "image/png", "", b"x")  # not a thumbnail: ignored
            assert thumb_cache.get("o/abcdef/big.png") is None
    finally:
        app.config.update(THUMB_CACHE_MB=0, THUMB_CACHE_DIR=None)
