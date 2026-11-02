"""Google Drive backup against a pretend Drive (tests/fake_drive.py)."""
import hashlib
import json
import os
import threading
import time

from tests.conftest import folder, item, op, run_sql, sql, upload

PNG = b"\x89PNG\r\n\x1a\n" + os.urandom(1000)


def run(app, budget=60):
    from app.drive.backup import run_backup

    with app.app_context():
        return run_backup(budget_ms=budget * 1000)


def drive_files(drive):
    return {f["name"]: f for f in drive.ours() if not f.get("mimeType", "").endswith("folder")}


def drive_path(drive, f):
    parts, cur = [], f
    while cur and cur["id"] != "ROOT":
        parts.insert(0, cur["name"])
        cur = drive.files.get(cur["parents"][0])
    return "/".join(parts)


def test_not_configured(app, owner):
    assert run(app)["configured"] is False
    st = owner.get("/api/admin/backup").get_json()
    assert st["configured"] is False and st["total"] == 0


def test_first_copy_mirrors_folders_and_is_repeatable(app, owner, drive):
    top = folder(owner, "Rebate")
    sub = folder(owner, "Charts", top)
    i = item(owner, sub)
    a, keys, _ = upload(owner, i, "Banner_BM.png", PNG, "ms")
    j = item(owner, top, "Draft one")
    upload(owner, j, "Draft_EN.png", PNG + b"d")
    op(owner, "item.update", {"id": j, "status": "draft"})  # drafts are backed up too
    r = run(app)
    assert r == {"configured": True, "ran": True, "created": 3, "copied": 2, "updated": 0, "toOld": 0, "failed": 0, "remaining": False}
    files = drive_files(drive)
    assert drive_path(drive, files["Banner_BM.png"]) == "Rebate/Charts/Banner_BM.png"
    assert files["Banner_BM.png"]["md5"] == hashlib.md5(PNG).hexdigest()
    assert files["Banner_BM.png"]["appProperties"] == {"moonlib": "1", "moonlibfile": a}
    assert {f["name"] for f in drive.ours() if f["mimeType"].endswith("folder")} == {"Rebate", "Charts", "_Old versions"}
    # nothing changed → no calls to Google at all
    drive.calls.clear()
    assert run(app)["copied"] == 0 and drive.calls == []
    st = owner.get("/api/admin/backup").get_json()
    assert st["configured"] and st["total"] == 2 and st["backedUp"] == 2 and st["waiting"] == 0 and st["folderUrl"] == "https://drive.google.com/drive/folders/ROOT"


def test_rename_move_replace_restore_and_delete(app, owner, drive):
    top = folder(owner, "Rebate")
    other = folder(owner, "Promos")
    i = item(owner, top)
    a, _, _ = upload(owner, i, "Banner_BM.png", PNG, "ms")
    k = item(owner, top, "Keep")
    kf, _, _ = upload(owner, k, "Keep.png", PNG + b"k")
    run(app)
    # rename + move a folder, move a card
    op(owner, "folder.update", {"id": top, "name": {"en": "Rebates"}})
    op(owner, "move", {"itemIds": [k], "targetId": other})
    r = run(app)
    assert r["updated"] == 2 and r["copied"] == 0
    files = drive_files(drive)
    assert drive_path(drive, files["Banner_BM.png"]) == "Rebates/Banner_BM.png"
    assert drive_path(drive, files["Keep.png"]) == "Promos/Keep.png"
    # replace → the old copy moves to "_Old versions"
    b, _, rr = upload(owner, i, "Banner_BM.png", PNG + b"new", "ms", replaces=a)
    r = run(app)
    assert r["toOld"] == 1 and r["copied"] == 1
    old = [f for f in drive.ours() if "(replaced " in f["name"]]
    assert len(old) == 1 and drive_path(drive, old[0]).startswith("_Old versions/Banner_BM (replaced ")
    # restoring the older version brings it back from "_Old versions"
    op(owner, "versions.restore", {"id": rr["versionId"]})
    r = run(app)
    assert r["toOld"] == 1 and r["updated"] == 1
    assert drive_path(drive, drive_files(drive)["Banner_BM.png"]) == "Rebates/Banner_BM.png"
    # deleting in the admin panel leaves Drive alone
    before = len(drive.ours())
    op(owner, "trash", {"itemIds": [k]})
    op(owner, "purge", {"all": True})
    drive.calls.clear()
    run(app)
    assert len(drive.ours()) == before and "Keep.png" in drive_files(drive)
    assert not any(c.startswith("PATCH") for c in drive.calls)


def test_failure_retry_and_resume_mid_file(app, owner, drive):
    f = folder(owner)
    i = item(owner, f)
    big = os.urandom(12 * 1024 * 1024 + 7)  # two 8 MB parts
    upload(owner, i, "Big.png", big)
    drive.fail, drive.skip = 1, 1  # first part goes in, the second is refused
    r = run(app)
    assert r["failed"] == 1 and r["copied"] == 0
    row = sql(app, "SELECT state, sent, attempts, next_try_at, error FROM drive_files")[0]
    assert row["state"] == "failed" and row["sent"] == 8 * 1024 * 1024 and row["attempts"] == 1 and "Backend Error (pretend)" in row["error"]
    st = owner.get("/api/admin/backup").get_json()
    assert st["failed"] == 1 and st["failing"][0]["name"] == "Big.png" and st["failing"][0]["nextTry"]
    # waits until its retry time
    assert run(app)["copied"] == 0
    run_sql(app, "UPDATE drive_files SET next_try_at = 1")
    drive.calls.clear()
    r = run(app)
    assert r["copied"] == 1
    # it carried on from 8 MB (one status check, one part), not from the start
    puts = [c for c in drive.calls if c.startswith("PUT /upload/session/")]
    assert len(puts) == 2
    assert drive_files(drive)["Big.png"]["md5"] == hashlib.md5(big).hexdigest()
    assert sql(app, "SELECT state, attempts, error FROM drive_files")[0] == {"state": "done", "attempts": 0, "error": None}


def test_time_budget_pauses_and_next_run_continues(app, owner, drive, monkeypatch):
    f = folder(owner)
    i = item(owner, f)
    big = os.urandom(17 * 1024 * 1024)
    upload(owner, i, "Video.png", big)
    from app.drive import backup

    real = backup.now
    calls = {"n": 0}

    def clock():  # time runs out after the first part
        calls["n"] += 1
        return real() + (10**9 if calls["n"] > 12 else 0)

    monkeypatch.setattr(backup, "now", clock)
    r = run(app)
    monkeypatch.setattr(backup, "now", real)
    assert r["remaining"] is True and r["copied"] == 0
    sent = sql(app, "SELECT sent FROM drive_files")[0]["sent"]
    assert 0 < sent < len(big)
    assert run(app)["copied"] == 1
    assert drive_files(drive)["Video.png"]["md5"] == hashlib.md5(big).hexdigest()


def test_overlapping_runs(app, owner, drive):
    f = folder(owner)
    i = item(owner, f)
    upload(owner, i, "a.png", PNG)
    # a run is going (its lock is still valid): the second exits at once
    run_sql(app, "INSERT INTO drive_state (`key`, value) VALUES ('lock', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", str(int(time.time() * 1000) + 60_000))
    assert run(app) == {"configured": True, "ran": False, "created": 0, "copied": 0, "updated": 0, "toOld": 0, "failed": 0, "remaining": False}
    assert owner.get("/api/admin/backup").get_json()["running"] is True
    # an expired lock (crashed run) is taken over
    run_sql(app, "UPDATE drive_state SET value = '1' WHERE `key` = 'lock'")
    assert run(app)["ran"] is True
    # two at the same moment: exactly one runs
    results, errors = [], []

    def go():
        try:
            results.append(run(app)["ran"])
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    ts = [threading.Thread(target=go) for _ in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert errors == [] and len(results) == 4 and results.count(True) >= 1
    assert sql(app, "SELECT value FROM drive_state WHERE `key` = 'lock'")[0]["value"] == "0"


def test_daily_check_recopies_what_was_removed_in_drive(app, owner, drive):
    f = folder(owner)
    i = item(owner, f)
    upload(owner, i, "a.png", PNG)
    run(app)
    fid = drive_files(drive)["a.png"]["id"]
    drive.files[fid]["trashed"] = True
    run_sql(app, "UPDATE drive_state SET value = '1' WHERE `key` = 'verifiedAt'")
    r = run(app)
    assert r["remaining"] is True
    assert run(app)["copied"] == 1
    assert len([f for f in drive.ours() if f["name"] == "a.png" and not f["trashed"]]) == 1


def test_wrong_key_shows_error(app, owner, drive, sa_key):
    f = folder(owner)
    item(owner, f)
    drive.client_email = "someone-else@x"
    r = run(app)
    assert "Google sign-in failed: invalid_grant" in r["error"]
    st = owner.get("/api/admin/backup").get_json()
    assert "Google sign-in failed" in st["lastError"]["message"]
    app.config["GDRIVE_SA_JSON"] = "not json"
    st = owner.get("/api/admin/backup").get_json()
    assert st["configured"] is False and st["configError"].startswith("GDRIVE_SA_JSON is not valid JSON")


def test_back_up_now_and_cli(app, owner, drive):
    f = folder(owner)
    i = item(owner, f)
    upload(owner, i, "a.png", PNG)
    r = owner.post("/api/admin/backup").get_json()
    assert r["result"]["copied"] == 1 and r["status"]["backedUp"] == 1
    log = op(owner, "audit.list", {"kind": "content"})["entries"]
    assert log[0]["action"] == "backup.run" and log[0]["summary"] == "Started a Google Drive backup — 1 file copied"
    upload(owner, i, "b_BM.png", PNG + b"b", "ms")
    res = app.test_cli_runner().invoke(args=["backup", "run", "--budget", "30"])
    assert res.exit_code == 0 and json.loads(res.output)["copied"] == 1
    st = app.test_cli_runner().invoke(args=["backup", "status"])
    assert json.loads(st.output)["backedUp"] == 2
