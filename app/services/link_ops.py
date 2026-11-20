"""
Shortcuts: a file shown in another folder too (for example a client's folder), without copying it.

  links.add     { folderId, itemIds }  → { added }    the files also appear in that folder (Editor)
  links.remove  { folderId, itemIds }  → { removed }  they no longer appear there; the files themselves stay put

Storage, the Google Drive backup and the original's folder are untouched: there is still one file. Moving the
original to the Trash hides it everywhere; deleting it for good removes its shortcuts too.
"""
from __future__ import annotations

from ..auth import SessionUser, write_log
from ..db import in_list, q
from ..util import HttpError, now
from .activity import en


def _ids(v) -> list[str]:
    return list(dict.fromkeys(x for x in v if isinstance(x, str) and x))[:500] if isinstance(v, list) else []


def _folder(fid) -> dict:
    f = q.first("SELECT id, name FROM folders WHERE id = ? AND deleted_at IS NULL", str(fid or ""))
    if not f:
        raise HttpError(404, "Folder not found")
    return f


def links_add(user: SessionUser, b: dict):
    f = _folder(b.get("folderId"))
    ids = _ids(b.get("itemIds"))
    if not ids:
        raise HttpError(400, "Choose files to add")
    rows = q.all(f"SELECT id, folder_id FROM items WHERE deleted_at IS NULL AND id IN ({in_list(len(ids))})", *ids)
    if len(rows) != len(ids):
        raise HttpError(404, "Some of those files are no longer in the library")
    have = {r["item_id"] for r in q.all(f"SELECT item_id FROM item_links WHERE folder_id = ? AND item_id IN ({in_list(len(ids))})", f["id"], *ids)}
    new = [r["id"] for r in rows if r["folder_id"] != f["id"] and r["id"] not in have]  # not where it already is
    if new:
        t = now()
        q.batch([("INSERT INTO item_links (folder_id, item_id, created_at, created_by) VALUES (?, ?, ?, ?)", [f["id"], i, t, user.username]) for i in new])
        write_log(user, {"kind": "content", "action": "links.add", "summary": f"Added {len(new)} file{'s' if len(new) != 1 else ''} to “{en(f['name'])}” (shortcuts, no copies)", "targetType": "item", "targetIds": new[:50], "folderId": f["id"]})
    return {"added": len(new)}


def links_remove(user: SessionUser, b: dict):
    f = _folder(b.get("folderId"))
    ids = _ids(b.get("itemIds"))
    if not ids:
        return {"removed": 0}
    n = q.run(f"DELETE FROM item_links WHERE folder_id = ? AND item_id IN ({in_list(len(ids))})", f["id"], *ids)
    if n:
        write_log(user, {"kind": "content", "action": "links.remove", "summary": f"Took {n} file{'s' if n != 1 else ''} out of “{en(f['name'])}” (the files stay where they are)", "targetType": "item", "targetIds": ids[:50], "folderId": f["id"]})
    return {"removed": n}


LINK_OPS = {"links.add": links_add, "links.remove": links_remove}
