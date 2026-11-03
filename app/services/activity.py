"""
The activity log for content changes: who changed what, a readable sentence, and what's needed
to undo it later (ported from src/lib/server/activity.ts — the sentences are identical, because
the admin panel translates them to 中文 by matching the English text).
"""
from __future__ import annotations

import json
from typing import Callable

from ..auth import SessionUser, write_log
from ..db import in_list, q, UPSERT_SETTING
from ..langs import FILE_LANG_LABEL
from ..util import HttpError, now
from . import admin_ops
from .admin_ops import Ctx, parse_extra, restore_version, subtree
from .library import file_keys

# lowest role allowed to run each admin operation (anything not listed needs Editor)
NEED = {
    # purge of specific items is Editor; emptying the whole Trash (all: true) is checked in admin_api
    "pins.set": "viewer",  # pinning folders in your own sidebar is personal, so every role may
    "users.list": "owner",
    "users.create": "owner",
    "users.update": "owner",
    "users.password": "owner",
    "users.signout": "owner",
    "users.delete": "owner",
    "audit.list": "viewer",
    "versions.list": "viewer",
    "reports.team": "viewer",
    "reports.storage": "viewer",
    "settings.get": "viewer",
    "clients.list": "viewer",
    "clients.delete": "owner",
}

QUIET = {
    "copy.files", "file.create", "item.create", "mpu.create", "mpu.complete", "mpu.abort", "file.setopt", "folder.iconImage", "audit.list",
    "versions.list", "reports.team", "reports.storage", "settings.get", "users.list", "clients.list",
}

LANG = FILE_LANG_LABEL


def en(t) -> str:
    try:
        v = json.loads(t if t is not None else "{}")
        if isinstance(v, dict):
            return v.get("en") or (next(iter(v.values()), None) if v else None) or "Untitled"
        return "Untitled"
    except (ValueError, TypeError):
        return t or "Untitled"


def _list(names: list[str]) -> str:
    qn = [f"“{n}”" for n in names]
    return ", ".join(qn) if len(qn) <= 3 else f"{', '.join(qn[:3])} and {len(qn) - 3} more"


def _arr(v) -> list[str]:
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def _folder_names(ids: list[str]) -> dict:
    if not ids:
        return {}
    rows = q.all(f"SELECT id, name FROM folders WHERE id IN ({in_list(len(ids))})", *ids)
    return {r["id"]: en(r["name"]) for r in rows}


def _item_info(ids: list[str]) -> dict:
    if not ids:
        return {}
    rows = q.all(f"SELECT id, title, folder_id FROM items WHERE id IN ({in_list(len(ids))})", *ids)
    return {r["id"]: {"title": en(r["title"]), "folderId": r["folder_id"]} for r in rows}


def _folder_name(fid) -> str:
    if not fid:
        return "All categories"
    return _folder_names([fid]).get(fid, "a folder")


def _name_en(v) -> str | None:
    return v.get("en") if isinstance(v, dict) else None


def _first_value(v) -> str | None:
    if isinstance(v, dict):
        for x in v.values():
            return x
    return None


Plan = Callable[[dict | None], dict | None]


def plan_log(op: str, b: dict) -> Plan | None:
    """What the log needs to know before an operation runs, and the line to write after it."""
    if op in QUIET:
        return None
    c = "content"

    if op == "folder.create":
        parent = _folder_name(b.get("parentId") or None)
        name = _name_en(b.get("name")) or _first_value(b.get("name")) or "folder"
        return lambda r: {
            "kind": c, "action": op, "summary": f"Created folder “{name}” in {parent}", "targetType": "folder",
            "targetIds": [str((r or {}).get("id"))], "folderId": b.get("parentId") or None,
        }

    if op == "folder.update":
        fid = str(b.get("id"))
        row = q.first("SELECT id, name, slug, icon, icon_bg, icon_fg, cover_item_id, parent_id, hidden FROM folders WHERE id = ?", fid)
        if not row:
            return None
        before = {
            "id": fid, "name": json.loads(row["name"]), "slug": row["slug"], "icon": row["icon"], "iconBg": row["icon_bg"],
            "iconFg": row["icon_fg"], "coverItemId": row["cover_item_id"], "hidden": bool(row["hidden"]),
        }
        # only made private / shared again?
        only_hidden = "hidden" in b and all(k in ("id", "hidden") for k in b)
        new_name = _name_en(b.get("name"))
        renamed = bool(new_name) and new_name != en(row["name"])
        cover_changed = "coverItemId" in b and (b.get("coverItemId") or None) != row["cover_item_id"]

        def same(k, v):
            return k not in b or b.get(k) == v

        only_cover = (
            cover_changed and not renamed and same("icon", row["icon"]) and same("iconBg", row["icon_bg"]) and same("iconFg", row["icon_fg"])
            and ("slug" not in b or b.get("slug") == row["slug"])
            and ("name" not in b or b.get("name") == json.loads(row["name"]))
        )
        summary = (
            (f"Made folder “{en(row['name'])}” private (staff only)" if b.get("hidden") else f"Shared folder “{en(row['name'])}” with clients again")
            if only_hidden
            else f"Renamed folder “{en(row['name'])}” to “{new_name}”" if renamed
            else f"Changed the cover picture of folder “{en(row['name'])}”" if only_cover
            else f"Edited folder “{en(row['name'])}” (name, link or icon)"
        )
        return lambda r: {"kind": c, "action": op, "summary": summary, "targetType": "folder", "targetIds": [fid], "folderId": row["parent_id"], "before": before}

    if op == "folder.reorder":
        ids = _arr(b.get("ids"))
        if not ids:
            return None
        first = q.first("SELECT parent_id FROM folders WHERE id = ?", ids[0])
        parent = (first or {}).get("parent_id")
        cur = q.all("SELECT id FROM folders WHERE parent_id <=> ? AND deleted_at IS NULL ORDER BY sort, created_at", parent)
        where = _folder_name(parent)
        return lambda r: {"kind": c, "action": op, "summary": f"Changed the order of folders in {where}", "targetType": "folder", "targetIds": ids, "folderId": parent, "before": {"ids": [x["id"] for x in cur]}}

    if op == "item.reorder":
        ids = _arr(b.get("ids"))
        if not ids:
            return None
        rows = q.all(f"SELECT id, sort, folder_id FROM items WHERE id IN ({in_list(len(ids))})", *ids)
        m = {x["id"]: x for x in rows}
        folder_id = rows[0]["folder_id"] if rows else None
        where = _folder_name(folder_id)
        return lambda r: {
            "kind": c, "action": op, "summary": f"Changed the order of {len(ids)} files in {where}", "targetType": "item", "targetIds": ids,
            "folderId": folder_id, "before": {"ids": ids, "sorts": [m.get(i, {}).get("sort") for i in ids]},
        }

    if op == "item.update":
        iid = str(b.get("id"))
        row = q.first("SELECT title, pinned, created_at, folder_id, status, publish_at, hide_at FROM items WHERE id = ?", iid)
        if not row:
            return None
        name = en(row["title"])
        what = []
        if "title" in b and _name_en(b.get("title")) != name:
            what.append(f"renamed to “{_name_en(b.get('title')) or ''}”")
        elif "title" in b:
            what.append("edited the title")
        if isinstance(b.get("pinned"), bool):
            what.append("pinned to top" if b["pinned"] else "unpinned")
        if b.get("status") == "draft":
            what.append("made a draft (hidden)")
        if b.get("status") == "live":
            what.append("published")
        if "publishAt" in b or "hideAt" in b:
            what.append("changed the show / hide schedule")
        before = {"id": iid, "title": json.loads(row["title"]), "pinned": bool(row["pinned"]), "status": row["status"], "publishAt": row["publish_at"], "hideAt": row["hide_at"]}
        return lambda r: {"kind": c, "action": op, "summary": f"“{name}”: {', '.join(what) or 'edited'}", "targetType": "item", "targetIds": [iid], "folderId": row["folder_id"], "before": before}

    if op == "items.status":
        ids = _arr(b.get("ids"))
        rows = q.all(f"SELECT id, status FROM items WHERE id IN ({in_list(len(ids) or 1)})", *(ids or [""]))
        m = {x["id"]: x["status"] for x in rows}
        info = _item_info(ids)
        verb = "Published" if b.get("status") == "live" else "Made drafts of"
        return lambda r: {
            "kind": c, "action": op, "summary": f"{verb} {_list([info.get(i, {}).get('title', '?') for i in ids])}", "targetType": "item",
            "targetIds": ids, "folderId": info.get(ids[0], {}).get("folderId") if ids else None, "before": {"ids": ids, "statuses": [m.get(i, "live") for i in ids]},
        }

    if op == "file.ready":
        fid = str(b.get("id"))
        f = q.first("SELECT f.item_id, f.name, f.lang, i.title, i.folder_id FROM files f JOIN items i ON i.id = f.item_id WHERE f.id = ?", fid)
        if not f:
            return None
        where = _folder_name(f["folder_id"])
        lang = f" ({LANG[f['lang']]})" if LANG.get(f["lang"]) else ""
        if b.get("touch") is False and not b.get("replaces"):
            return lambda r: {"kind": c, "action": "file.lightcopy", "summary": f"Added a light copy of “{f['name']}”{lang}", "targetType": "file", "targetIds": [fid], "folderId": f["folder_id"]}
        if isinstance(b.get("replaces"), str):
            return lambda r: {
                "kind": c, "action": "file.replace", "summary": f"Replaced “{en(f['title'])}”{lang} with {f['name']} in {where}", "targetType": "file",
                "targetIds": [fid], "folderId": f["folder_id"], "before": {"versionId": (r or {}).get("versionId")},
            }
        return lambda r: {
            "kind": c, "action": "file.upload", "summary": f"Uploaded {f['name']}{lang} to {where}", "targetType": "file", "targetIds": [fid],
            "folderId": f["folder_id"], "before": {"fileId": fid, "itemId": f["item_id"]},
        }

    if op == "file.update":
        fid = str(b.get("id"))
        f = q.first("SELECT f.lang, f.extra_langs, f.caption, f.name, i.folder_id FROM files f JOIN items i ON i.id = f.item_id WHERE f.id = ?", fid)
        if not f:
            return None
        was = [f["lang"], *parse_extra(f["extra_langs"], f["lang"])]
        langs_now = [str(x) for x in b["langs"]] if isinstance(b.get("langs"), list) else ([str(b.get("lang"))] if "lang" in b else None)

        def names(ls):
            return " + ".join(LANG.get(l) or l for l in ls)

        s = f"Changed the language of {f['name']} to {names(langs_now)}" if langs_now is not None else f"Edited the caption of {f['name']}"

        def entry(r):
            rep = (r or {}).get("replaced")
            extra = f" ({rep} other version{'' if rep == 1 else 's'} moved to the history)" if rep else ""
            return {"kind": c, "action": op, "summary": s + extra, "targetType": "file", "targetIds": [fid], "folderId": f["folder_id"], "before": {"id": fid, "langs": was, "replace": True, "caption": f["caption"] or ""}}

        return entry

    if op == "file.setthumb":
        f = q.first("SELECT f.name, i.title, i.folder_id FROM files f JOIN items i ON i.id = f.item_id WHERE f.id = ?", str(b.get("id")))
        if not f:
            return None
        return lambda r: {"kind": c, "action": op, "summary": f"Changed the cover of “{en(f['title'])}” ({f['name']})", "targetType": "file", "targetIds": [str(b.get("id"))], "folderId": f["folder_id"]}

    if op == "file.clearopt":
        fid = str(b.get("id"))
        return lambda r: {"kind": c, "action": op, "summary": "Removed a light copy (downloads give the original)", "targetType": "file", "targetIds": [fid]}

    if op == "file.delete":
        fid = str(b.get("id"))
        f = q.first("SELECT f.name, f.lang, i.title, i.folder_id FROM files f JOIN items i ON i.id = f.item_id WHERE f.id = ?", fid)
        if not f:
            return None

        def entry(r):
            if not (r or {}).get("versionId"):
                return None
            return {"kind": c, "action": op, "summary": f"Deleted the {LANG.get(f['lang']) or ''} version of “{en(f['title'])}” ({f['name']})", "targetType": "file", "targetIds": [fid], "folderId": f["folder_id"], "before": {"versionId": r["versionId"]}}

        return entry

    if op == "versions.restore":
        v = q.first("SELECT v.name, v.lang, i.title, i.folder_id FROM file_versions v JOIN items i ON i.id = v.item_id WHERE v.id = ?", str(b.get("id")))
        if not v:
            return None
        return lambda r: {
            "kind": c, "action": op, "summary": f"Restored an earlier {LANG.get(v['lang']) or ''} version of “{en(v['title'])}” ({v['name']})", "targetType": "file",
            "targetIds": [str((r or {}).get("fileId") or "")], "folderId": v["folder_id"], "before": {"fileId": (r or {}).get("fileId"), "versionId": (r or {}).get("archived")},
        }

    if op == "move":
        folder_ids = _arr(b.get("folderIds"))
        item_ids = _arr(b.get("itemIds"))
        fr = q.all(f"SELECT id, parent_id, name FROM folders WHERE id IN ({in_list(len(folder_ids))})", *folder_ids) if folder_ids else []
        ir = q.all(f"SELECT id, folder_id, title FROM items WHERE id IN ({in_list(len(item_ids))})", *item_ids) if item_ids else []
        names = [en(x["name"]) for x in fr] + [en(x["title"]) for x in ir]
        target = _folder_name(b.get("targetId") or None)
        ttype = "mixed" if folder_ids and item_ids else "folder" if folder_ids else "item"
        return lambda r: {
            "kind": c, "action": op, "summary": f"Moved {_list(names)} to {target}", "targetType": ttype, "targetIds": [*folder_ids, *item_ids],
            "folderId": b.get("targetId") or None,
            "before": {"folders": [{"id": x["id"], "parentId": x["parent_id"]} for x in fr], "items": [{"id": x["id"], "folderId": x["folder_id"]} for x in ir]},
        }

    if op == "copy.start":
        folder_ids = _arr(b.get("folderIds"))
        item_ids = _arr(b.get("itemIds"))
        fn = _folder_names(folder_ids)
        info = _item_info(item_ids)
        names = [f"📁 {fn.get(i, '?')}" for i in folder_ids] + [info.get(i, {}).get("title", "?") for i in item_ids]
        target = _folder_name(b.get("targetId") or None)

        def entry(r):
            r = r or {}
            nf, ni = r.get("folderIds") or [], r.get("itemIds") or []
            n = len(r.get("files") or [])
            return {
                "kind": c, "action": op, "summary": f"Copied {_list(names)} to {target}" + (f" ({n} file{'' if n == 1 else 's'})" if n else ""),
                "targetType": "mixed" if nf and ni else "folder" if nf else "item", "targetIds": [*nf, *ni],
                "folderId": b.get("targetId") or None,
                "before": {"folderIds": nf, "itemIds": ni},  # undo = the copies go to the Trash
            }

        return entry

    if op in ("trash", "restore", "purge"):
        folder_ids = _arr(b.get("folderIds"))
        item_ids = _arr(b.get("itemIds"))
        if op == "purge" and b.get("all") is True:
            folder_ids = [r["id"] for r in q.all("SELECT id FROM folders WHERE deleted_at IS NOT NULL")]
            item_ids = [r["id"] for r in q.all("SELECT id FROM items WHERE deleted_at IS NOT NULL")]
        fn = _folder_names(folder_ids)
        info = _item_info(item_ids)
        names = [f"📁 {fn.get(i, '?')}" for i in folder_ids] + [info.get(i, {}).get("title", "?") for i in item_ids]
        if not names:
            return None
        verb = "Deleted (moved to Trash)" if op == "trash" else "Restored from Trash" if op == "restore" else "Deleted forever"
        ttype = "mixed" if folder_ids and item_ids else "folder" if folder_ids else "item"

        def entry(r):
            e = {
                "kind": c, "action": op, "summary": f"{verb} {_list(names)}", "targetType": ttype, "targetIds": [*folder_ids, *item_ids],
                "folderId": info.get(item_ids[0], {}).get("folderId") if item_ids else None, "detail": {"names": names},
            }
            if op != "purge":
                e["before"] = {"folderIds": folder_ids, "itemIds": item_ids}
            return e

        return entry

    if op == "settings.set":
        return None
    if op.startswith("users."):
        return None
    return lambda r: {"kind": c, "action": op, "summary": f"Ran {op}"}


UNDOABLE = {
    "folder.create", "folder.update", "folder.reorder", "item.reorder", "item.update", "items.status", "file.upload", "file.replace",
    "file.update", "file.delete", "versions.restore", "move", "trash", "restore", "copy.start", "settings.set",
}


def undo_entry(user: SessionUser, entry: dict) -> str:
    """Reverses one log entry. Returns a sentence for the new log line."""
    ctx = Ctx(user.username)

    def run(op, body):
        return admin_ops.OPS[op](ctx, body)

    before = json.loads(entry["before"]) if entry.get("before") else {}
    if not isinstance(before, dict):
        before = {}
    targets = json.loads(entry["target_ids"]) if entry.get("target_ids") else []
    a = entry["action"]
    if a == "folder.create":
        run("trash", {"folderIds": targets, "itemIds": []})
    elif a == "folder.update":
        run("folder.update", before)
    elif a == "folder.reorder":
        run("folder.reorder", {"ids": before.get("ids")})
    elif a == "item.reorder":
        run("item.reorder", {"ids": before.get("ids"), "sorts": before.get("sorts")})
    elif a == "item.update":
        run("item.update", before)
    elif a == "items.status":
        run("items.status", {"ids": before.get("ids"), "statuses": before.get("statuses"), "status": "live"})
    elif a == "file.upload":
        n = q.first("SELECT COUNT(*) AS n FROM files WHERE item_id = ?", before.get("itemId"))
        if (n or {}).get("n", 0) <= 1:
            run("trash", {"folderIds": [], "itemIds": [before.get("itemId")]})
        else:
            run("file.delete", {"id": before.get("fileId")})
    elif a in ("file.replace", "file.delete"):
        if not before.get("versionId"):
            raise HttpError(409, "The earlier version is no longer kept")
        restore_version(str(before["versionId"]), user.username)
    elif a == "versions.restore":
        if not before.get("versionId"):
            raise HttpError(409, "There was nothing in that language before")
        restore_version(str(before["versionId"]), user.username)
    elif a == "file.update":
        run("file.update", before)
    elif a == "move":
        for f in before.get("folders") or []:
            run("move", {"folderIds": [f["id"]], "itemIds": [], "targetId": f.get("parentId")})
        for i in before.get("items") or []:
            run("move", {"folderIds": [], "itemIds": [i["id"]], "targetId": i.get("folderId")})
    elif a == "trash":
        run("restore", before)
    elif a in ("restore", "copy.start"):
        run("trash", before)
    elif a == "settings.set":
        q.run(UPSERT_SETTING, str(before.get("key")), json.dumps(before.get("value"), ensure_ascii=False, separators=(",", ":")), now(), user.username)
    else:
        raise HttpError(400, "This can't be undone")
    return f"Undid: {entry['summary']}"


# ---------------------------------------------------------------- housekeeping (90 days)

KEEP_MS = 90 * 24 * 3600_000


def cleanup(force: bool = False) -> dict:
    """Empties old Trash and old file versions. Runs at most once an hour (triggered by admin visits)."""
    t = now()
    last = q.first("SELECT value FROM settings WHERE `key` = 'cleanup_at'")
    if not force and last:
        try:
            if t - int(json.loads(last["value"])) < 3600_000:
                return {"ran": False}
        except (ValueError, TypeError):
            pass
    q.run(
        "INSERT INTO settings (`key`, value, updated_at) VALUES ('cleanup_at', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)",
        json.dumps(t), t,
    )
    cut = t - KEEP_MS
    vs = q.all("SELECT id, key_orig, key_opt, key_thumb, key_poster FROM file_versions WHERE replaced_at < ? LIMIT 300", cut)
    if vs:
        # a key still used by a current file (or a newer version) is kept
        keys = [k for v in vs for k in file_keys(v)]
        admin_ops.delete_storage(_unused_keys(keys, [v["id"] for v in vs]))
        ids = [v["id"] for v in vs]
        q.run(f"DELETE FROM file_versions WHERE id IN ({in_list(len(ids))})", *ids)
    fs = q.all("SELECT id FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 50", cut)
    its = q.all("SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 200", cut)
    folder_ids = [r["id"] for r in fs]
    item_ids = [r["id"] for r in its]
    if folder_ids or item_ids:
        all_f = subtree(folder_ids) if folder_ids else []
        admin_ops.purge(Ctx("system"), {"folderIds": folder_ids, "itemIds": item_ids})
        write_log(
            {"id": "system", "username": "system"},
            {
                "kind": "content",
                "action": "purge.auto",
                "summary": f"Trash emptied automatically: {len(item_ids)} file{'' if len(item_ids) == 1 else 's'} and {len(all_f)} folder{'' if len(all_f) == 1 else 's'} older than 90 days",
            },
            with_request=False,
        )
    return {"ran": True, "versions": len(vs), "folders": len(folder_ids), "items": len(item_ids)}


def _unused_keys(keys: list[str], version_ids: list[str]) -> list[str]:
    out = []
    for k in dict.fromkeys(keys):
        used = q.first(
            "SELECT 1 AS x FROM files WHERE key_orig = ? OR key_opt = ? OR key_thumb = ? OR key_poster = ? LIMIT 1", k, k, k, k
        ) or q.first(
            f"SELECT 1 AS x FROM file_versions WHERE (key_orig = ? OR key_opt = ? OR key_thumb = ? OR key_poster = ?) AND id NOT IN ({in_list(len(version_ids))}) LIMIT 1",
            k, k, k, k, *version_ids,
        )
        if not used:
            out.append(k)
    return out
