"""
Everything stored, as one document for the staff admin: folders, cards and their files,
including the Trash and unfinished uploads.
"""
from __future__ import annotations

import json
from functools import cmp_to_key

from ..db import q
from ..langs import FILE_LANGS, clean_langs
from ..util import now

KINDS = ("image", "video", "audio", "document", "other")


def parse_text(s) -> dict:
    if not s:
        return {}
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else {}
    except (ValueError, TypeError):
        return {"en": s}


def _extra_langs(main: str, raw) -> dict:
    if not raw or main == "all":
        return {}
    try:
        extra = [l for l in clean_langs(json.loads(raw)) if l != main and l != "all"]
    except (ValueError, TypeError):
        return {}
    return {"langs": [main, *extra]} if extra else {}


def default_item_order(a: dict, b: dict) -> int:
    """Pinned first, then cards not placed by hand (newest first), then the order set in /admin."""
    pin = int(b["pinned"]) - int(a["pinned"])
    if pin:
        return pin
    sa, sb = a.get("sort"), b.get("sort")
    if sa is None and sb is None:
        return _sign(b["date"] - a["date"])
    if sa is None:
        return -1
    if sb is None:
        return 1
    return _sign(sa - sb) or _sign(b["date"] - a["date"])


def _sign(x) -> int:
    return (x > 0) - (x < 0)


def _lang_index(lang: str) -> int:
    try:
        return FILE_LANGS.index(lang)
    except ValueError:
        return -1


def load_library(asset_base: str) -> dict:
    folder_rows = q.all("SELECT id,parent_id,slug,name,sort,cover_item_id,icon,icon_bg,icon_fg,hidden,created_at,deleted_at FROM folders ORDER BY sort, created_at, id")
    item_rows = q.all("SELECT id,folder_id,title,pinned,created_at,created_by,deleted_at,sort,status,publish_at,hide_at FROM items ORDER BY id")
    tag_rows = q.all("SELECT id, name, color FROM tags ORDER BY name")
    tags_of: dict[str, list[str]] = {}
    for r in q.all("SELECT item_id, tag_id FROM item_tags"):
        tags_of.setdefault(r["item_id"], []).append(r["tag_id"])
    file_rows = q.all(
        "SELECT id,item_id,lang,extra_langs,kind,name,mime,size,width,height,duration,key_orig,key_opt,opt_mime,opt_size,key_thumb,key_poster,caption,focus_y,status FROM files ORDER BY id"
    )

    folders = []
    for r in folder_rows:
        f = {
            "id": r["id"],
            "parentId": r["parent_id"],
            "slug": r["slug"],
            "name": parse_text(r["name"]),
            "sort": r["sort"],
            "coverItemId": r["cover_item_id"],
            "icon": r["icon"],
            "iconBg": r["icon_bg"],
            "iconFg": r["icon_fg"],
            "hidden": bool(r["hidden"]),
            "deletedAt": r["deleted_at"],
            "createdAt": r["created_at"],
        }
        folders.append(f)

    by_item: dict[str, list] = {}
    for r in file_rows:
        v = {"id": r["id"], "lang": r["lang"], **_extra_langs(r["lang"], r["extra_langs"])}
        v.update(
            {
                "kind": r["kind"] if r["kind"] in KINDS else "other",
                "name": r["name"],
                "mime": r["mime"],
                "size": r["size"],
                "w": r["width"],
                "h": r["height"],
                "dur": r["duration"],
                "orig": r["key_orig"],
                "opt": r["key_opt"],
                "optMime": r["opt_mime"],
                "optSize": r["opt_size"],
                "thumb": r["key_thumb"],
                "poster": r["key_poster"],
                "caption": r["caption"],
                "focusY": r["focus_y"],
                "status": r["status"],
            }
        )
        by_item.setdefault(r["item_id"], []).append(v)
    for lst in by_item.values():
        lst.sort(key=lambda v: _lang_index(v["lang"]))

    items = []
    for r in item_rows:
        it = {
            "id": r["id"],
            "folderId": r["folder_id"],
            "title": parse_text(r["title"]),
            "pinned": bool(r["pinned"]),
            "date": r["created_at"],
            "sort": r["sort"],
            "variants": by_item.get(r["id"], []),
            "deletedAt": r["deleted_at"],
            "createdBy": r["created_by"],
            "status": "draft" if r["status"] == "draft" else "live",
            "publishAt": r["publish_at"],
            "hideAt": r["hide_at"],
            "tags": tags_of.get(r["id"], []),
        }
        items.append(it)

    items.sort(key=cmp_to_key(default_item_order))
    tags = [{"id": r["id"], "name": r["name"], "color": r["color"]} for r in tag_rows]
    return {"folders": folders, "items": items, "tags": tags, "assetBase": asset_base, "generatedAt": now()}


def file_keys(r: dict) -> list[str]:
    """All storage keys belonging to a file row."""
    return [k for k in (r.get("key_orig"), r.get("key_opt"), r.get("key_thumb"), r.get("key_poster")) if k]
