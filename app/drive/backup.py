"""
Google Drive backup — one way: admin panel → Drive (ported from src/lib/server/drive/backup.ts).

Every run compares the library with what Drive already has (the drive_* tables) and does only
what's missing, so it is safe to run as often as you like and it picks up where it left off:
  • new folders / files            → created / copied (originals, every language, drafts too)
  • renamed or moved folder / file → renamed / moved in Drive
  • replaced file                  → the old copy moves to "_Old versions", the new one is copied
  • restored older version         → moves back from "_Old versions"
  • deleted in the admin panel     → left untouched in Drive — unless "remove from Drive when deleted
                                     for good" is on: then, once it's gone for good (Delete now, Empty
                                     Trash, the 90-day clean-up), its copy goes to Drive's own Trash
Nothing done in Drive ever changes the library. A daily check re-copies anything someone removed
from the backup in Drive.

Runs every 5 minutes from Linux cron (`flask backup run`), and on "Back up now" in the admin panel.
Both use run_backup() below; a lock in drive_state stops two runs at once.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from urllib.parse import quote

from ..db import in_list, q
from ..storage import storage
from ..util import now
from .google import Drive, DriveConfig, DriveError, drive_config

log = logging.getLogger(__name__)

OLD = "__old__"
OLD_NAME = "_Old versions"
PART = 8 * 1024 * 1024  # bytes per upload request (a multiple of 256 KB, as Google requires)
VERIFY_EVERY = 20 * 3600_000  # the full "is everything still in Drive?" check, about daily
MAX_WAIT = 6 * 3600_000  # longest pause between retries of a failing file


def _en_name(raw: str, fallback: str) -> str:
    try:
        v = json.loads(raw)
        if isinstance(v, dict):
            return (v.get("en") or next((x for x in v.values() if x), None) or fallback).strip() or fallback
        return fallback
    except (ValueError, TypeError):
        return raw or fallback


def _old_name(name: str, at: int) -> str:
    """'Banner_BM.png' → 'Banner_BM (replaced 2026-10-07).png' (Malaysia date)."""
    day = datetime.fromtimestamp((at + 8 * 3600_000) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    dot = name.rfind(".")
    return f"{name[:dot]} (replaced {day}){name[dot:]}" if dot > 0 else f"{name} (replaced {day})"


def _get_state(key: str):
    r = q.first("SELECT value FROM drive_state WHERE `key` = ?", key)
    return r["value"] if r else None


def _set_state(key: str, value: str) -> None:
    q.run("INSERT INTO drive_state (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", key, value)


def _error(message: str) -> None:
    _set_state("lastError", json.dumps({"at": now(), "message": message}, ensure_ascii=False))


def _lock(until: int) -> bool:
    """Only one run at a time (cron and "Back up now" can overlap). An expired lock is taken over."""
    from sqlalchemy.exc import OperationalError

    q.run("INSERT IGNORE INTO drive_state (`key`, value) VALUES ('lock', '0')")
    try:
        # the row lock makes runs that start at the same moment take turns here
        with q.transaction() as conn:
            row = q.exec(conn, "SELECT value FROM drive_state WHERE `key` = 'lock' FOR UPDATE").first()
            try:
                held = int(row[0]) if row else 0
            except (TypeError, ValueError):
                held = 0
            if held >= now():
                return False
            q.exec(conn, "UPDATE drive_state SET value = ? WHERE `key` = 'lock'", str(until))
            return True
    except OperationalError:  # lock wait timeout / deadlock: another run has it
        log.warning("backup lock busy")
        return False


def _unlock() -> None:
    q.run("UPDATE drive_state SET value = '0' WHERE `key` = 'lock'")


def _live_folders(rows: list[dict]) -> list[dict]:
    """Library folders that are not in the Trash (nor inside a folder that is), parents first."""
    by_id = {r["id"]: r for r in rows}
    live: dict[str, bool] = {}

    def is_live(r, seen=0) -> bool:
        if r["id"] in live:
            return live[r["id"]]
        parent = by_id.get(r["parent_id"]) if r["parent_id"] else None
        ok = not r["deleted_at"] and seen < 50 and (r["parent_id"] is None or (parent is not None and is_live(parent, seen + 1)))
        live[r["id"]] = ok
        return ok

    def depth(r) -> int:
        d, p = 0, r["parent_id"]
        while p and d < 50:
            d += 1
            p = (by_id.get(p) or {}).get("parent_id")
        return d

    return sorted([r for r in rows if is_live(r)], key=depth)


def _blank_result() -> dict:
    return {"configured": False, "ran": False, "created": 0, "copied": 0, "updated": 0, "toOld": 0, "removed": 0, "failed": 0, "remaining": False}


MIRROR_KEY = "mirrorDeletes"  # drive_state: "1" = remove Drive copies of things deleted for good


def mirror_deletes() -> bool:
    return _get_state(MIRROR_KEY) == "1"


def set_mirror_deletes(on: bool) -> None:
    _set_state(MIRROR_KEY, "1" if on else "0")


def run_backup(budget_ms: int) -> dict:
    res = _blank_result()
    try:
        cfg = drive_config()
    except RuntimeError as e:
        res["error"] = str(e)
        return res
    if not cfg:
        return res
    res["configured"] = True
    start = now()
    deadline = start + budget_ms
    if not _lock(deadline + 60_000):
        return res
    res["ran"] = True
    try:
        _set_state("lastRun", str(start))
        _reconcile(cfg, deadline, res)
        if not res["remaining"] and now() < deadline - 5_000:
            _maybe_verify(cfg, res)
        _set_state("lastOk", str(now()))
        if not res["failed"]:
            _set_state("lastError", "")
    except Exception as e:  # noqa: BLE001
        res["error"] = str(getattr(e, "message", None) or e)
        try:
            _error(res["error"])
        except Exception:  # noqa: BLE001
            log.exception("backup state")
    finally:
        try:
            _unlock()
        except Exception:  # noqa: BLE001
            log.exception("backup unlock")
    return res


def _reconcile(cfg: DriveConfig, deadline: int, res: dict) -> None:
    drive = Drive(cfg)
    folders = q.all("SELECT id, parent_id, name, slug, deleted_at FROM folders")
    files = q.all(
        """SELECT f.id, f.name, f.mime, f.size, f.key_orig, i.folder_id
             FROM files f JOIN items i ON i.id = f.item_id
            WHERE f.status = 'ready' AND i.deleted_at IS NULL
            ORDER BY f.created_at, f.id"""
    )
    fmap = {r["folder_id"]: r for r in q.all("SELECT folder_id, drive_id, name, parent_drive_id FROM drive_folders")}
    filemap = {r["key_orig"]: r for r in q.all("SELECT * FROM drive_files")}
    replaced_at = {r["key_orig"]: r["at"] for r in q.all("SELECT key_orig, MAX(replaced_at) AS at FROM file_versions WHERE reason = 'replaced' GROUP BY key_orig")}

    # ---- 1. folders: create, rename, move (folders deleted in the admin panel are left alone)
    def ensure_folder(fid: str, name: str, parent: str) -> None:
        m = fmap.get(fid)
        if not m:
            drive_id = drive.create_folder(name, parent, {"moonlib": "1", "moonlibfolder": fid})
            q.run("REPLACE INTO drive_folders (folder_id, drive_id, name, parent_drive_id, updated_at) VALUES (?, ?, ?, ?, ?)", fid, drive_id, name, parent, now())
            fmap[fid] = {"folder_id": fid, "drive_id": drive_id, "name": name, "parent_drive_id": parent}
            res["created"] += 1
        elif m["name"] != name or m["parent_drive_id"] != parent:
            drive.update(m["drive_id"], name=name if m["name"] != name else None, frm=m["parent_drive_id"], to=parent)
            q.run("UPDATE drive_folders SET name = ?, parent_drive_id = ?, updated_at = ? WHERE folder_id = ?", name, parent, now(), fid)
            m["name"], m["parent_drive_id"] = name, parent
            res["updated"] += 1

    live = _live_folders(folders)
    live_ids = {f["id"] for f in live}
    blocked: set[str] = set()  # folders that failed (their contents wait for the next run)
    for f in live:
        if now() > deadline:
            res["remaining"] = True
            return
        parent = (fmap.get(f["parent_id"]) or {}).get("drive_id") if f["parent_id"] else cfg.root
        if not parent or (f["parent_id"] and f["parent_id"] in blocked):
            blocked.add(f["id"])
            continue
        try:
            ensure_folder(f["id"], _en_name(f["name"], f["slug"] or "Folder"), parent)
        except Exception as e:  # noqa: BLE001
            blocked.add(f["id"])
            res["failed"] += 1
            _error(f"Folder “{_en_name(f['name'], f['slug'])}”: {getattr(e, 'message', None) or e}")
            if isinstance(e, DriveError) and e.status in (401, 403, 404) and not f["parent_id"]:
                raise  # wrong key / no access to the backup folder
    ensure_folder(OLD, OLD_NAME, cfg.root)
    old_folder = fmap[OLD]["drive_id"]

    # ---- 2. files no longer in the library: replaced → "_Old versions"; deleted → left untouched
    current = {f["key_orig"]: f for f in files if f["folder_id"] in live_ids}
    all_current_keys = {f["key_orig"] for f in files}
    for m in list(filemap.values()):
        if m["state"] != "done" or not m["drive_id"] or m["key_orig"] in all_current_keys:
            continue
        at = replaced_at.get(m["key_orig"])
        if at is None:
            continue  # deleted (or its card is in the Trash): stays where it is
        if now() > deadline:
            res["remaining"] = True
            return
        name = _old_name(m["name"] or "file", at)
        try:
            drive.update(m["drive_id"], name=name, frm=m["parent_drive_id"] or None, to=old_folder)
            q.run("UPDATE drive_files SET state = 'old', name = ?, parent_drive_id = ?, updated_at = ? WHERE key_orig = ?", name, old_folder, now(), m["key_orig"])
            m.update(state="old", name=name, parent_drive_id=old_folder)
            res["toOld"] += 1
        except Exception as e:  # noqa: BLE001
            res["failed"] += 1
            _error(f"Moving an old version: {getattr(e, 'message', None) or e}")

    # ---- 2b. deleted for good (not in the library, not kept as an old version): to Drive's Trash, if asked
    if mirror_deletes():
        _remove_gone(drive, folders, filemap, fmap, deadline, res)
        if res["remaining"]:
            return

    # ---- 3. files in the library: rename / move what's there, copy what isn't
    to_copy = []
    for f in current.values():
        parent = (fmap.get(f["folder_id"]) or {}).get("drive_id")
        if not parent or f["folder_id"] in blocked:
            continue
        m = filemap.get(f["key_orig"])
        if m and m["state"] in ("done", "old") and m["drive_id"]:
            if m["name"] == f["name"] and m["parent_drive_id"] == parent and m["state"] == "done" and m["file_id"] == f["id"]:
                continue
            if now() > deadline:
                res["remaining"] = True
                return
            try:
                drive.update(m["drive_id"], name=f["name"] if m["name"] != f["name"] else None, frm=m["parent_drive_id"] or None, to=parent)
                q.run(
                    "UPDATE drive_files SET state = 'done', file_id = ?, name = ?, parent_drive_id = ?, updated_at = ? WHERE key_orig = ?",
                    f["id"], f["name"], parent, now(), f["key_orig"],
                )
                m.update(state="done", file_id=f["id"], name=f["name"], parent_drive_id=parent)
                res["updated"] += 1
            except Exception as e:  # noqa: BLE001
                res["failed"] += 1
                _error(f"“{f['name']}”: {getattr(e, 'message', None) or e}")
            continue
        if m and m["state"] == "failed" and m["next_try_at"] and m["next_try_at"] > now():
            continue  # waiting to retry
        to_copy.append((f, m, parent))
    # half-sent uploads first, then everything else oldest first
    to_copy.sort(key=lambda j: -((j[1] or {}).get("sent") or 0))
    for f, m, parent in to_copy:
        if now() > deadline - 2_000:
            res["remaining"] = True
            return
        done = _copy_file(drive, f, m, parent, deadline)
        if done == "done":
            res["copied"] += 1
        elif done == "failed":
            res["failed"] += 1
        else:
            res["remaining"] = True
            return


def _remove_gone(drive: Drive, folders: list, filemap: dict, fmap: dict, deadline: int, res: dict) -> None:
    """
    Copies of files and folders that have been deleted for good go to Drive's Trash. A file in the
    library's Trash still has its row, and a replaced file still has its old-version row, so neither
    counts as gone — only Delete now / Empty Trash / the 90-day clean-up make something gone.
    """
    exists = {r["key_orig"] for r in q.all("SELECT key_orig FROM files")} | {r["key_orig"] for r in q.all("SELECT key_orig FROM file_versions")}
    for m in list(filemap.values()):
        if m["key_orig"] in exists:
            continue
        if now() > deadline:
            res["remaining"] = True
            return
        try:
            if m["drive_id"] and m["state"] in ("done", "old"):
                drive.trash(m["drive_id"])
                res["removed"] += 1
            q.run("DELETE FROM drive_files WHERE key_orig = ?", m["key_orig"])
            filemap.pop(m["key_orig"], None)
        except Exception as e:  # noqa: BLE001
            res["failed"] += 1
            _error(f"Removing “{m['name'] or 'a file'}” from Drive: {getattr(e, 'message', None) or e}")
    still = {f["id"] for f in folders}
    for fid, m in list(fmap.items()):
        if fid == OLD or fid in still:
            continue
        if now() > deadline:
            res["remaining"] = True
            return
        try:
            if m.get("drive_id"):
                drive.trash(m["drive_id"])
            q.run("DELETE FROM drive_folders WHERE folder_id = ?", fid)
            fmap.pop(fid, None)
        except Exception as e:  # noqa: BLE001
            res["failed"] += 1
            _error(f"Removing the folder “{m.get('name') or ''}” from Drive: {getattr(e, 'message', None) or e}")


def _copy_file(drive: Drive, f: dict, m: dict | None, parent: str, deadline: int) -> str:
    """Copies one original into Drive, in parts; can stop and carry on in the next run."""
    t = now()
    session = (m or {}).get("session_url")
    sent = (m or {}).get("sent") or 0
    st = storage()
    try:
        head = st.head(f["key_orig"])
        if head is None:
            raise RuntimeError("The original file is missing from storage")
        size = head.size
        if not m:
            q.run(
                "INSERT INTO drive_files (key_orig, file_id, state, size, sent, attempts, created_at, updated_at) VALUES (?, ?, 'uploading', ?, 0, 0, ?, ?)",
                f["key_orig"], f["id"], size, t, t,
            )
        # the folder it was being sent to changed, or the address expired → start again
        if session and m and m.get("parent_drive_id") and m["parent_drive_id"] != parent:
            session = None
        if session:
            try:
                s = drive.upload_status(session, size)
                if "id" in s:
                    return _finish(f, s["id"], parent, size)
                sent = s["next"]
            except DriveError as e:
                if e.status in (404, 410):
                    session = None
                else:
                    raise
        if not session:
            session = drive.start_upload(f["name"], parent, f["mime"], size, {"moonlib": "1", "moonlibfile": f["id"]})
            sent = 0
            q.run(
                "UPDATE drive_files SET state = 'uploading', file_id = ?, session_url = ?, sent = 0, size = ?, name = ?, parent_drive_id = ?, updated_at = ? WHERE key_orig = ?",
                f["id"], session, size, f["name"], parent, now(), f["key_orig"],
            )
        if size == 0:
            r = drive.send_part(session, b"", 0, 0)
            if "id" in r:
                return _finish(f, r["id"], parent, size)
        while sent < size:
            if now() > deadline:
                return "paused"
            ln = min(PART, size - sent)
            data = st.read_range(f["key_orig"], sent, ln)
            r = drive.send_part(session, data, sent, size)
            if "id" in r:
                return _finish(f, r["id"], parent, size)
            sent = r["next"]
            q.run("UPDATE drive_files SET sent = ?, updated_at = ? WHERE key_orig = ?", sent, now(), f["key_orig"])
        s = drive.upload_status(session, size)
        if "id" in s:
            return _finish(f, s["id"], parent, size)
        raise RuntimeError("Google did not confirm the upload")
    except Exception as e:  # noqa: BLE001
        attempts = ((m or {}).get("attempts") or 0) + 1
        wait = min(MAX_WAIT, 60_000 * 2 ** min(attempts, 10))
        try:
            q.run(
                "UPDATE drive_files SET state = 'failed', session_url = ?, sent = ?, attempts = ?, next_try_at = ?, error = ?, updated_at = ? WHERE key_orig = ?",
                session, sent, attempts, now() + wait, str(getattr(e, "message", None) or e)[:500], now(), f["key_orig"],
            )
        except Exception:  # noqa: BLE001
            log.exception("drive_files update")
        return "failed"


def _finish(f: dict, drive_id: str, parent: str, size: int) -> str:
    q.run(
        """UPDATE drive_files SET state = 'done', file_id = ?, drive_id = ?, name = ?, parent_drive_id = ?, size = ?, sent = ?,
                  session_url = NULL, attempts = 0, next_try_at = NULL, error = NULL, updated_at = ? WHERE key_orig = ?""",
        f["id"], drive_id, f["name"], parent, size, size, now(), f["key_orig"],
    )
    return "done"


def _maybe_verify(cfg: DriveConfig, res: dict) -> None:
    """About once a day: is everything we copied still in Drive? Anything removed there is copied again."""
    try:
        last = int(_get_state("verifiedAt") or 0)
    except ValueError:
        last = 0
    if now() - last < VERIFY_EVERY:
        return
    drive = Drive(cfg)
    root = drive.get(cfg.root)
    if root.get("trashed"):
        raise DriveError(404, "The backup folder itself is in Drive’s bin")
    there = drive.list_ours(root.get("driveId"))
    fs = q.all("SELECT folder_id, drive_id FROM drive_folders")
    fl = q.all("SELECT key_orig, drive_id FROM drive_files WHERE state IN ('done', 'old') AND drive_id IS NOT NULL")
    gone_folders = [r["folder_id"] for r in fs if r["drive_id"] not in there]
    gone_files = [r["key_orig"] for r in fl if r["drive_id"] not in there]
    for i in range(0, len(gone_folders), 50):
        c = gone_folders[i : i + 50]
        q.run(f"DELETE FROM drive_folders WHERE folder_id IN ({in_list(len(c))})", *c)
    for i in range(0, len(gone_files), 50):
        c = gone_files[i : i + 50]
        q.run(f"DELETE FROM drive_files WHERE key_orig IN ({in_list(len(c))})", *c)
    _set_state("verifiedAt", str(now()))
    if gone_folders or gone_files:
        _set_state("verifyNote", json.dumps({"at": now(), "folders": len(gone_folders), "files": len(gone_files)}))
        res["remaining"] = True


# ---------------------------------------------------------------- what the admin panel shows

def backup_status() -> dict:
    config_error = None
    cfg = None
    try:
        cfg = drive_config()
    except RuntimeError as e:
        config_error = str(e)
    blank = {
        "configured": False, "running": False, "lastRun": None, "lastOk": None, "lastError": None, "verifiedAt": None,
        "total": 0, "backedUp": 0, "waiting": 0, "failing": [], "failed": 0, "old": 0,
    }
    if config_error:
        blank["configError"] = config_error
    if not cfg:
        return blank
    state = {r["key"]: r["value"] for r in q.all("SELECT `key`, value FROM drive_state")}
    folders = q.all("SELECT id, parent_id, name, slug, deleted_at FROM folders")
    files = q.all("SELECT f.id, f.name, f.key_orig, i.folder_id FROM files f JOIN items i ON i.id = f.item_id WHERE f.status = 'ready' AND i.deleted_at IS NULL")
    dfiles = q.all("SELECT key_orig, state, name, error, attempts, next_try_at FROM drive_files")

    def num(k):
        try:
            return int(state[k]) or None if state.get(k) else None
        except ValueError:
            return None

    live = {f["id"] for f in _live_folders(folders)}
    cur = [f for f in files if f["folder_id"] in live]
    dmap = {r["key_orig"]: r for r in dfiles}
    backed_up = 0
    failing = []
    for f in cur:
        m = dmap.get(f["key_orig"])
        if m and m["state"] == "done":
            backed_up += 1
        elif m and m["state"] == "failed":
            failing.append({"name": f["name"], "error": m["error"] or "", "attempts": m["attempts"], "nextTry": m["next_try_at"]})
    last_error = None
    try:
        last_error = json.loads(state["lastError"]) if state.get("lastError") else None
    except ValueError:
        last_error = None
    return {
        "configured": True,
        "folderUrl": f"https://drive.google.com/drive/folders/{quote(cfg.root, safe='')}",
        "running": (num("lock") or 0) > now(),
        "lastRun": num("lastRun"),
        "lastOk": num("lastOk"),
        "lastError": last_error,
        "verifiedAt": num("verifiedAt"),
        "total": len(cur),
        "backedUp": backed_up,
        "waiting": len(cur) - backed_up - len(failing),
        "failing": failing[:20],
        "failed": len(failing),
        "old": len([r for r in dfiles if r["state"] == "old"]),
        "mirrorDeletes": state.get(MIRROR_KEY) == "1",
    }
