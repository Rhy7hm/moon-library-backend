"""
Who can open which folder.

Everyone on the team sees every folder, except one an Owner has limited to chosen people
("Who can open this"). A limited folder, and everything inside it (sub-folders, cards, files),
is then invisible to anyone not on its list: it's left out of the library, its files won't load
or download, and changes aimed at it are refused as if it didn't exist. Owners and the Super
admin always see everything, so nothing can be locked away from the people running the library.
"""
from __future__ import annotations

from flask import g

from .db import in_list, q
from .util import HttpError

SEES_ALL = ("owner", "superadmin")


def blocked_folders(user) -> set[str]:
    """Folder ids this person can't open (limited folders they aren't on, with everything under them)."""
    if user is None or user.role in SEES_ALL:
        return set()
    cached = getattr(g, "_blocked", None)
    if cached is not None and cached[0] == user.id:
        return cached[1]
    roots = {
        r["id"]
        for r in q.all(
            "SELECT id FROM folders WHERE restricted = 1 AND id NOT IN (SELECT folder_id FROM folder_access WHERE user_id = ?)",
            user.id,
        )
    }
    out: set[str] = set()
    if roots:
        kids: dict[str, list[str]] = {}
        for r in q.all("SELECT id, parent_id FROM folders WHERE parent_id IS NOT NULL"):
            kids.setdefault(r["parent_id"], []).append(r["id"])
        todo = list(roots)
        while todo:
            fid = todo.pop()
            if fid in out:
                continue
            out.add(fid)
            todo.extend(kids.get(fid, []))
    g._blocked = (user.id, out)
    return out


def _strings(v, out: set, depth: int = 0) -> None:
    if depth > 4 or len(out) > 3000:
        return
    if isinstance(v, str):
        if 0 < len(v) <= 64:
            out.add(v)
    elif isinstance(v, list):
        for x in v:
            _strings(x, out, depth + 1)
    elif isinstance(v, dict):
        for x in v.values():
            _strings(x, out, depth + 1)


def _folders_of(sql: str, ids: list[str]) -> set[str]:
    found: set[str] = set()
    for i in range(0, len(ids), 500):
        part = ids[i : i + 500]
        found.update(r["folder_id"] for r in q.all(sql.format(in_list(len(part))), *part))
    return found


def guard_request(user, op: str, body: dict) -> None:
    """Refuses (as 'not found') any change that names a folder, card, file or version in a folder this person can't open."""
    blocked = blocked_folders(user)
    if not blocked:
        return
    if op == "audit.undo":
        try:
            row = q.first("SELECT folder_id FROM audit_log WHERE id = ?", int(float(body.get("id"))))
        except (TypeError, ValueError):
            row = None
        if row and row["folder_id"] in blocked:
            raise HttpError(404, "Log entry not found")
    cand: set[str] = set()
    _strings(body, cand)
    if not cand:
        return
    ids = sorted(cand)
    hit = (
        {i for i in ids if i in blocked}
        or _folders_of("SELECT folder_id FROM items WHERE id IN ({})", ids) & blocked
        or _folders_of("SELECT it.folder_id AS folder_id FROM files f JOIN items it ON it.id = f.item_id WHERE f.id IN ({})", ids) & blocked
        or _folders_of("SELECT it.folder_id AS folder_id FROM file_versions v JOIN items it ON it.id = v.item_id WHERE v.id IN ({})", ids) & blocked
    )
    if hit:
        raise HttpError(404, "Not found")


def key_allowed(user, key: str) -> bool:
    """May this person load the stored file with this key? (Anything that isn't a library file, like an avatar, is fine.)"""
    blocked = blocked_folders(user)
    if not blocked:
        return True
    rows = q.all(
        """SELECT it.folder_id FROM files f JOIN items it ON it.id = f.item_id WHERE f.key_orig = ?
           UNION ALL SELECT it.folder_id FROM files f JOIN items it ON it.id = f.item_id WHERE f.key_opt = ?
           UNION ALL SELECT it.folder_id FROM files f JOIN items it ON it.id = f.item_id WHERE f.key_thumb = ?
           UNION ALL SELECT it.folder_id FROM files f JOIN items it ON it.id = f.item_id WHERE f.key_poster = ?
           UNION ALL SELECT it.folder_id FROM file_versions v JOIN items it ON it.id = v.item_id WHERE v.key_orig = ?
           UNION ALL SELECT it.folder_id FROM file_versions v JOIN items it ON it.id = v.item_id WHERE v.key_thumb = ?""",
        *([key] * 6),
    )
    return not any(r["folder_id"] in blocked for r in rows)
