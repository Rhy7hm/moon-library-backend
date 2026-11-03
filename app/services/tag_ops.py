"""
Tags: short labels on files ("CNY 2027", "approved", "IG story"). A file can have several; one tag can
be on many files. Typing a new name creates the tag, so there's no separate "make a tag" step.

  tags.set     { itemIds, add?: [names], remove?: [tagIds] }  → { tags }   (Editor)
  tags.update  { id, name?, color? }                          → { ok }     (Editor)
  tags.delete  { id }                                         → { ok }     (Editor) — the files stay, only the label goes
"""
from __future__ import annotations

import re

from ..auth import SessionUser, write_log
from ..db import in_list, q
from ..util import HttpError, new_id, now

# soft colours handed out to new tags in turn
PALETTE = ["#4c8dff", "#9b7bff", "#ff7a59", "#f5b83d", "#30b0c7", "#34c759", "#ff5c8a", "#8e8e93"]


def _name(v) -> str:
    n = re.sub(r"\s+", " ", v).strip()[:60] if isinstance(v, str) else ""
    if not n:
        raise HttpError(400, "A tag needs a name")
    return n


def _color(v):
    if v is None or v == "":
        return None
    if not isinstance(v, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", v):
        raise HttpError(400, "Colour must look like #4c8dff")
    return v.lower()


def _ids(v) -> list[str]:
    return list(dict.fromkeys(x for x in v if isinstance(x, str) and x))[:1000] if isinstance(v, list) else []


def all_tags() -> list[dict]:
    return [{"id": r["id"], "name": r["name"], "color": r["color"]} for r in q.all("SELECT id, name, color FROM tags ORDER BY name")]


def tags_set(user: SessionUser, b: dict):
    item_ids = _ids(b.get("itemIds"))
    add = [_name(x) for x in (b.get("add") or []) if isinstance(x, str) and x.strip()] if isinstance(b.get("add"), list) else []
    remove = _ids(b.get("remove"))
    if not item_ids or (not add and not remove):
        raise HttpError(400, "Choose files and tags")
    found = {r["id"] for r in q.all(f"SELECT id FROM items WHERE id IN ({in_list(len(item_ids))})", *item_ids)}
    if found != set(item_ids):
        raise HttpError(404, "Some of those files are no longer in the library")

    # find tags by name, ignoring case; make the ones that don't exist yet
    tag_ids: list[str] = []
    if add:
        existing = {r["name"].lower(): r["id"] for r in q.all("SELECT id, name FROM tags")}
        count = len(existing)
        for n in dict.fromkeys(add):
            tid = existing.get(n.lower())
            if not tid:
                tid = new_id()
                q.run("INSERT INTO tags (id, name, color, created_at, created_by) VALUES (?,?,?,?,?)", tid, n, PALETTE[count % len(PALETTE)], now(), user.username)
                existing[n.lower()] = tid
                count += 1
            if tid not in tag_ids:  # "CNY 2027" and "cny  2027" are the same tag
                tag_ids.append(tid)
        have = {(r["item_id"], r["tag_id"]) for r in q.all(f"SELECT item_id, tag_id FROM item_tags WHERE item_id IN ({in_list(len(item_ids))})", *item_ids)}
        rows = [(i, t) for i in item_ids for t in tag_ids if (i, t) not in have]
        if rows:
            q.batch([("INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)", list(r)) for r in rows])
    if remove:
        q.run(
            f"DELETE FROM item_tags WHERE item_id IN ({in_list(len(item_ids))}) AND tag_id IN ({in_list(len(remove))})",
            *item_ids,
            *remove,
        )
    n = len(item_ids)
    what = []
    if add:
        what.append(f"tagged {n} file{'s' if n != 1 else ''} “{'”, “'.join(dict.fromkeys(add))}”")
    if remove:
        names = [r["name"] for r in q.all(f"SELECT name FROM tags WHERE id IN ({in_list(len(remove))})", *remove)]
        what.append(f"removed {', '.join(f'“{x}”' for x in names) or 'tags'} from {n} file{'s' if n != 1 else ''}")
    write_log(user, {"kind": "content", "action": "tags.set", "summary": "; ".join(what).capitalize(), "targetType": "item", "targetIds": item_ids[:50]})
    return {"tags": all_tags()}


def tags_update(user: SessionUser, b: dict):
    t = q.first("SELECT id, name FROM tags WHERE id = ?", str(b.get("id") or ""))
    if not t:
        raise HttpError(404, "Tag not found")
    sets, vals = [], []
    if "name" in b:
        name = _name(b.get("name"))
        if q.first("SELECT id FROM tags WHERE LOWER(name) = LOWER(?) AND id != ?", name, t["id"]):
            raise HttpError(409, f"There's already a tag called “{name}”")
        sets.append("name = ?")
        vals.append(name)
    if "color" in b:
        sets.append("color = ?")
        vals.append(_color(b.get("color")))
    if sets:
        q.run(f"UPDATE tags SET {', '.join(sets)} WHERE id = ?", *vals, t["id"])
        write_log(user, {"kind": "content", "action": "tags.update", "summary": f"Changed the tag “{t['name']}”"})
    return {"ok": True}


def tags_delete(user: SessionUser, b: dict):
    t = q.first("SELECT id, name FROM tags WHERE id = ?", str(b.get("id") or ""))
    if not t:
        raise HttpError(404, "Tag not found")
    q.batch([("DELETE FROM item_tags WHERE tag_id = ?", [t["id"]]), ("DELETE FROM tags WHERE id = ?", [t["id"]])])
    write_log(user, {"kind": "content", "action": "tags.delete", "summary": f"Deleted the tag “{t['name']}” (the files are untouched)"})
    return {"ok": True}


TAG_OPS = {"tags.set": tags_set, "tags.update": tags_update, "tags.delete": tags_delete}
