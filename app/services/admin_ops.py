"""
Every change the admin panel (and the import script) can make — ported from
src/lib/server/admin-ops.ts with the same names, inputs, results and messages.
Called from POST /api/admin/<op> with a JSON body.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
from itertools import count
import re
import unicodedata
from typing import Any, Callable

from ..db import in_list, q
from ..langs import FILE_LANG_LABEL, LANG_CODES, clean_langs, is_file_lang
from ..storage import IMMUTABLE, storage
from ..util import HttpError, is_num, new_id, now
from .library import file_keys

Body = dict


class Ctx:
    def __init__(self, user: str):
        self.user = user  # the username written as created_by / replaced_by

    @property
    def bucket(self):
        return storage()


def _dumps(v) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------- languages of a file

def parse_extra(raw, main: str | None = None) -> list[str]:
    if not raw:
        return []
    try:
        return [l for l in clean_langs(json.loads(raw)) if l != "all" and l != main]
    except (ValueError, TypeError):
        return []


def _extra_json(extra: list[str]):
    return _dumps(extra) if extra else None


def _same_langs(a: list[str], b: list[str]) -> bool:
    """The same set of languages (EN + 中文 = 中文 + EN) — sameLangs in langs.ts."""
    return len(a) == len(b) and all(l in b for l in a)


def claim_langs(item_id: str, file_id: str, langs: list[str], user: str) -> list[dict]:
    """
    One card has one version per set of languages. A file in exactly the same languages as another
    version of the card takes its place (that one moves to the version history). Versions that only
    share some languages stay side by side, e.g. "EN + 中文" and "BM + 中文".
    """
    want = [l for l in langs if l != "all"]
    out: list[dict] = []
    if not want:
        return out
    rows = q.all(
        "SELECT id, name, lang, extra_langs FROM files WHERE item_id = ? AND id != ? AND (status IS NULL OR status != 'uploading') ORDER BY created_at, id",
        item_id,
        file_id,
    )
    for r in rows:
        have = [r["lang"], *parse_extra(r["extra_langs"], r["lang"])]
        if not _same_langs(have, want):
            continue
        out.append({"id": r["id"], "name": r["name"], "gave": have, "archived": archive_file(r["id"], "replaced", user)})
    return out


_VERSION_COLS = "lang,extra_langs,kind,name,mime,size,width,height,duration,key_orig,key_opt,opt_mime,opt_size,key_thumb,key_poster,caption,focus_y"


def archive_file(file_id: str, reason: str, user: str) -> str | None:
    """Moves a file into its version history (kept 90 days); the bytes stay in storage."""
    r = q.first("SELECT * FROM files WHERE id = ?", file_id)
    if not r:
        return None
    vid = new_id()
    q.batch(
        [
            (
                f"""INSERT INTO file_versions (id,file_id,item_id,reason,{_VERSION_COLS},created_at,replaced_at,replaced_by)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [
                    vid, r["id"], r["item_id"], reason, r["lang"], r.get("extra_langs"), r["kind"], r["name"], r["mime"], r["size"],
                    r["width"], r["height"], r["duration"], r["key_orig"], r["key_opt"], r["opt_mime"], r["opt_size"], r["key_thumb"],
                    r["key_poster"], r["caption"], r["focus_y"], r["created_at"], now(), user,
                ],
            ),
            ("DELETE FROM files WHERE id = ?", [file_id]),
        ]
    )
    return vid


def restore_version(version_id: str, user: str) -> dict:
    """Puts an earlier version back; the version now in exactly its languages becomes a version itself."""
    v = q.first("SELECT * FROM file_versions WHERE id = ?", version_id)
    if not v:
        raise HttpError(404, "That version is no longer kept")
    if not q.first("SELECT id FROM items WHERE id = ?", v["item_id"]):
        raise HttpError(404, "Its card was deleted forever")
    # the version now in exactly the same languages makes way (one that only shares some stays)
    want = [v["lang"], *parse_extra(v.get("extra_langs"), v["lang"])]
    cur = next(
        (
            r
            for r in q.all("SELECT id, lang, extra_langs FROM files WHERE item_id = ? AND lang != 'all' ORDER BY created_at, id", v["item_id"])
            if v["lang"] != "all" and _same_langs([r["lang"], *parse_extra(r["extra_langs"], r["lang"])], want)
        ),
        None,
    )
    archived = archive_file(cur["id"], "replaced", user) if cur else None
    clash = q.first("SELECT id FROM files WHERE id = ?", v["file_id"])
    file_id = new_id() if clash else v["file_id"]
    t = now()
    q.batch(
        [
            (
                f"""INSERT INTO files (id,item_id,{_VERSION_COLS},status,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ready',?,?)""",
                [
                    file_id, v["item_id"], v["lang"], v.get("extra_langs"), v["kind"], v["name"], v["mime"], v["size"], v["width"],
                    v["height"], v["duration"], v["key_orig"], v["key_opt"], v["opt_mime"], v["opt_size"], v["key_thumb"], v["key_poster"],
                    v["caption"], v["focus_y"], v["created_at"], t,
                ],
            ),
            ("DELETE FROM file_versions WHERE id = ?", [version_id]),
        ]
    )
    claim_langs(v["item_id"], file_id, [v["lang"], *parse_extra(v.get("extra_langs"), v["lang"])], user)
    return {"archived": archived, "fileId": file_id, "itemId": v["item_id"]}


# ---------------------------------------------------------------- input checks (same messages)

def _str(v, field: str, max_len: int = 300) -> str:
    if not isinstance(v, str) or not v.strip():
        raise HttpError(400, f"{field} is required")
    return v.strip()[:max_len]


def _opt_str(v, max_len: int = 5000):
    if v is None:
        return None
    if not isinstance(v, str):
        raise HttpError(400, "Expected text")
    s = v.strip()[:max_len]
    return s or None


def _ids(v) -> list[str]:
    if v is None:
        return []
    if not isinstance(v, list) or any(not isinstance(x, str) for x in v):
        raise HttpError(400, "Expected a list of ids")
    return v


def _text(v, field: str, required: bool = True) -> dict:
    # like `!v || typeof v !== 'object'` in the original: {} and [] count as given (but empty)
    if not isinstance(v, (dict, list)):
        if required:
            raise HttpError(400, f"{field} is required")
        return {}
    out = {}
    for k in LANG_CODES:
        s = v.get(k) if isinstance(v, dict) else None
        if isinstance(s, str) and s.strip():
            out[k] = s.strip()[:200]
    if required and not out:
        raise HttpError(400, f"{field} needs at least one language")
    return out


_ICON_NAME = re.compile(r"^(d:)?[a-z-]{1,24}$")
_ICON_IMG = re.compile(r"^img:i/[a-z0-9]{6,32}\.webp$")


def _icon_name(v):
    if not isinstance(v, str):
        return None
    if _ICON_NAME.match(v):
        return v
    if _ICON_IMG.match(v):
        return v
    if v.startswith("svg:"):
        return "svg:" + clean_svg(v[4:])
    return None


def _hex_color(v):
    return v.lower() if isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) else None


def clean_svg(raw: str) -> str:
    """Keeps an uploaded SVG to drawing elements only (it is only used as a mask image, but stay safe)."""
    s = re.sub(r"<\?xml[\s\S]*?\?>", "", raw, flags=re.I)
    s = re.sub(r"<!--[\s\S]*?-->", "", s)
    s = re.sub(r"<!DOCTYPE[^>]*>", "", s, flags=re.I).strip()
    if not re.match(r"^<svg[\s>]", s, flags=re.I):
        raise HttpError(400, "Not an SVG file")
    if len(s) > 60_000:
        raise HttpError(413, "SVG is too large (60 KB max)")
    s = re.sub(r"<(script|foreignObject|iframe|object|embed|audio|video)[\s\S]*?</\1\s*>", "", s, flags=re.I)
    s = re.sub(r"<(script|foreignObject|iframe|object|embed|image)\b[^>]*/?>", "", s, flags=re.I)
    s = re.sub(r"\son[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", s, flags=re.I)
    s = re.sub(r"\s(xlink:)?href\s*=\s*(\"(?!#)[^\"]*\"|'(?!#)[^']*')", "", s, flags=re.I)
    s = re.sub(r"@import[^;]*;?", "", s, flags=re.I)
    s = re.sub(r"url\(\s*(['\"]?)(?!#)[^)]*\)", "none", s, flags=re.I)
    s = re.sub(r">\s+<", "><", s)
    return s


def slugify(s: str) -> str:
    out = unicodedata.normalize("NFKD", s)
    out = re.sub(r"[̀-ͯ]", "", out).lower()
    out = re.sub(r"[^a-z0-9]+", "-", out)
    out = re.sub(r"^-+|-+$", "", out)[:60]
    return out or "folder"


def unique_slug(parent_id: str | None, wanted: str, self_id: str | None = None) -> str:
    rows = q.all("SELECT slug FROM folders WHERE parent_id <=> ? AND deleted_at IS NULL AND id != ?", parent_id, self_id or "")
    taken = {r["slug"] for r in rows}
    slug, n = wanted, 2
    while slug in taken:
        slug = f"{wanted}-{n}"
        n += 1
    return slug


def _folder_exists(fid: str) -> None:
    if not q.first("SELECT id FROM folders WHERE id = ?", fid):
        raise HttpError(404, "Folder not found")


def _item_row(iid: str) -> dict:
    r = q.first("SELECT id, folder_id FROM items WHERE id = ?", iid)
    if not r:
        raise HttpError(404, "Item not found")
    return r


def subtree(root_ids: list[str]) -> list[str]:
    """Ids of folders and everything below them (parents before children)."""
    rows = q.all("SELECT id, parent_id FROM folders")
    kids: dict[str, list[str]] = {}
    for r in rows:
        if r["parent_id"]:
            kids.setdefault(r["parent_id"], []).append(r["id"])
    out: list[str] = []
    seen: set[str] = set()
    stack = list(root_ids)
    while stack:
        fid = stack.pop()
        if fid in seen:
            continue
        seen.add(fid)
        out.append(fid)
        stack.extend(kids.get(fid, []))
    # Overlapping roots can visit a descendant before its ancestor. Sort the
    # collected set by actual depth before callers reverse it for deletion.
    parents = {r["id"]: r["parent_id"] for r in rows}

    def depth(fid: str) -> int:
        seen_parents: set[str] = set()
        parent = parents.get(fid)
        while parent and parent not in seen_parents:
            seen_parents.add(parent)
            parent = parents.get(parent)
        return len(seen_parents)

    return sorted(out, key=depth)


def delete_storage(keys: list[str]) -> None:
    if keys:
        storage().delete(keys)


KEY_RE = re.compile(r"^(o|v|t|p)/[a-z0-9]{6,32}(\.[a-z0-9]{2,5}|/[^/]{1,200})?$")


def _make_keys(file_id: str, name: str, b: Body) -> dict:
    safe = re.sub(r"[\\/\u0000-\u001f]", "_", name)[:180]

    def ext(m):
        return {"image/webp": "webp", "image/png": "png", "video/mp4": "mp4"}.get(m if isinstance(m, str) else "", "jpg")

    return {
        "orig": f"o/{file_id}/{safe}",
        "opt": f"v/{file_id}.{ext(b.get('optMime'))}" if b.get("hasOpt") else None,
        "thumb": f"t/{file_id}.webp" if b.get("hasThumb") else None,
        "poster": f"p/{file_id}.webp" if b.get("hasPoster") else None,
    }


def _num(v):
    return v if is_num(v) else None


# ---------------------------------------------------------------- the operations

def folder_create(ctx: Ctx, b: Body):
    parent_id = b.get("parentId") or None
    if parent_id is not None and not isinstance(parent_id, str):
        raise HttpError(400, "Expected a folder id")
    if parent_id:
        _folder_exists(parent_id)
    name = _text(b.get("name"), "Name")
    wanted = b["slug"] if isinstance(b.get("slug"), str) and b.get("slug") else (name.get("en") or next(iter(name.values())))
    slug = unique_slug(parent_id, slugify(wanted))
    mx = q.first("SELECT COALESCE(MAX(sort), 0) AS m FROM folders WHERE parent_id <=> ?", parent_id)
    fid = new_id()
    t = now()
    q.run(
        "INSERT INTO folders (id,parent_id,slug,name,sort,icon,icon_bg,icon_fg,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        fid, parent_id, slug, _dumps(name), int((mx or {}).get("m") or 0) + 10, _icon_name(b.get("icon")), _hex_color(b.get("iconBg")), _hex_color(b.get("iconFg")), t, t,
    )
    return {"id": fid, "slug": slug}


def folder_update(ctx: Ctx, b: Body):
    fid = _str(b.get("id"), "id")
    cur = q.first("SELECT parent_id, slug FROM folders WHERE id = ?", fid)
    if not cur:
        raise HttpError(404, "Folder not found")
    sets, vals = [], []
    if "name" in b:
        sets.append("name = ?")
        vals.append(_dumps(_text(b.get("name"), "Name")))
    if isinstance(b.get("slug"), str):
        sets.append("slug = ?")
        vals.append(unique_slug(cur["parent_id"], slugify(b["slug"]), fid))
    if "icon" in b:
        sets.append("icon = ?")
        vals.append(_icon_name(b.get("icon")))
    if "iconBg" in b:
        sets.append("icon_bg = ?")
        vals.append(_hex_color(b.get("iconBg")))
    if "iconFg" in b:
        sets.append("icon_fg = ?")
        vals.append(_hex_color(b.get("iconFg")))
    if "coverItemId" in b:
        sets.append("cover_item_id = ?")
        vals.append(b.get("coverItemId") or None)
    if "hidden" in b:  # hidden from the library page (with everything inside); the files stay in admin
        if not isinstance(b["hidden"], bool):
            raise HttpError(400, "Expected a boolean for hidden")
        sets.append("hidden = ?")
        vals.append(1 if b.get("hidden") else 0)
    if not sets:
        return {"ok": True}
    sets.append("updated_at = ?")
    vals.append(now())
    q.run(f"UPDATE folders SET {', '.join(sets)} WHERE id = ?", *vals, fid)
    return {"ok": True}


def folder_icon_image(ctx: Ctx, b: Body):
    """Stores a category icon image (already WEBP, sent as base64) and returns the icon value."""
    if isinstance(b.get("data"), str) and len(b["data"]) > 600_000:
        raise HttpError(413, "Icon image is too large")
    data = _str(b.get("data"), "data", 600_000)
    try:
        raw = base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError):
        raise HttpError(400, "Bad image data") from None
    if len(raw) < 12 or raw[8:12] != b"WEBP":
        raise HttpError(400, "Icon must be WEBP")
    key = f"i/{new_id(16)}.webp"
    storage().put(key, raw, len(raw), "image/webp", None, IMMUTABLE)
    return {"icon": f"img:{key}"}


def folder_reorder(ctx: Ctx, b: Body):
    lst = _ids(b.get("ids"))
    t = now()
    q.batch([("UPDATE folders SET sort = ?, updated_at = ? WHERE id = ?", [(i + 1) * 10, t, fid]) for i, fid in enumerate(lst)])
    return {"ok": True}


def item_reorder(ctx: Ctx, b: Body):
    lst = _ids(b.get("ids"))
    if not lst:
        return {"ok": True}
    sorts = b.get("sorts") if isinstance(b.get("sorts"), list) else None
    stmts = []
    for i, iid in enumerate(lst):
        v = (sorts[i] if i < len(sorts) else None) if sorts is not None else (i + 1) * 10
        stmts.append(("UPDATE items SET sort = ? WHERE id = ?", [v if is_num(v) else None, iid]))
    q.batch(stmts)
    return {"ok": True}


def item_create(ctx: Ctx, b: Body):
    folder_id = _str(b.get("folderId"), "folderId")
    _folder_exists(folder_id)
    title = _text(b.get("title"), "Title")
    date = b["date"] if is_num(b.get("date")) and b["date"] > 0 else now()
    iid = new_id()
    q.run(
        "INSERT INTO items (id,folder_id,title,pinned,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?)",
        iid, folder_id, _dumps(title), 0, int(date), now(), ctx.user,
    )
    return {"id": iid}


def item_update(ctx: Ctx, b: Body):
    iid = _str(b.get("id"), "id")
    _item_row(iid)
    sets, vals = [], []
    if "title" in b:
        sets.append("title = ?")
        vals.append(_dumps(_text(b.get("title"), "Title")))
    if isinstance(b.get("pinned"), bool):
        sets.append("pinned = ?")
        vals.append(1 if b["pinned"] else 0)
    if is_num(b.get("date")) and b["date"] > 0:
        sets.append("created_at = ?")
        vals.append(int(b["date"]))
    if b.get("status") in ("live", "draft"):
        sets.append("status = ?")
        vals.append(b["status"])

    def when(v):
        return int(v) if is_num(v) and v > 0 else None

    if "publishAt" in b:
        sets.append("publish_at = ?")
        vals.append(when(b.get("publishAt")))
    if "hideAt" in b:
        sets.append("hide_at = ?")
        vals.append(when(b.get("hideAt")))
    if not sets:
        return {"ok": True}
    sets.append("updated_at = ?")
    vals.append(now())
    q.run(f"UPDATE items SET {', '.join(sets)} WHERE id = ?", *vals, iid)
    return {"ok": True}


def items_status(ctx: Ctx, b: Body):
    lst = _ids(b.get("ids"))
    if not lst:
        return {"ok": True}
    if b.get("status") not in ("live", "draft"):
        raise HttpError(400, "Unknown status")
    each = b.get("statuses") if isinstance(b.get("statuses"), list) else None
    stmts = []
    for i, iid in enumerate(lst):
        st = each[i] if each is not None and i < len(each) and each[i] in ("live", "draft") else b["status"]
        stmts.append(("UPDATE items SET status = ?, updated_at = ? WHERE id = ?", [st, now(), iid]))
    q.batch(stmts)
    return {"ok": True}


def file_create(ctx: Ctx, b: Body):
    """Registers a file before its bytes are uploaded; returns the storage keys to upload to."""
    item_id = _str(b.get("itemId"), "itemId")
    _item_row(item_id)
    lang = b["lang"] if is_file_lang(b.get("lang")) else "en"
    extra = [] if lang == "all" else [l for l in clean_langs(b.get("langs")) if l != lang and l != "all"]
    kind = b.get("kind") if b.get("kind") in ("image", "video", "audio", "document", "other") else "other"
    name = _str(b.get("name"), "name", 200)
    mime = _str(b.get("mime"), "mime", 100)
    try:
        size = int(float(b.get("size") or 0))
    except (TypeError, ValueError):
        size = 0
    fid = new_id()
    keys = _make_keys(fid, name, b)
    t = now()
    q.run(
        """INSERT INTO files (id,item_id,lang,extra_langs,kind,name,mime,size,width,height,duration,key_orig,key_opt,opt_mime,key_thumb,key_poster,caption,focus_y,status,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'uploading',?,?)""",
        fid, item_id, lang, _extra_json(extra), kind, name, mime, size,
        _int_or_none(b.get("width")), _int_or_none(b.get("height")), _num(b.get("duration")),
        keys["orig"], keys["opt"], (b.get("optMime") if isinstance(b.get("optMime"), str) else None) if keys["opt"] else None,
        keys["thumb"], keys["poster"], _opt_str(b.get("caption")), _num(b.get("focusY")), t, t,
    )
    return {"id": fid, "keys": keys}


def _int_or_none(v):
    return int(round(v)) if is_num(v) else None


def file_ready(ctx: Ctx, b: Body):
    """Marks a file visible once all its parts are stored (see the notes in admin-ops.ts)."""
    fid = _str(b.get("id"), "id")
    row = q.first("SELECT item_id, key_orig, key_opt, lang, extra_langs FROM files WHERE id = ?", fid)
    if not row:
        raise HttpError(404, "File not found")
    head = storage().head(row["key_orig"])
    if not head:
        raise HttpError(409, "The original file has not finished uploading")
    opt_size = None
    if row["key_opt"]:
        h = storage().head(row["key_opt"])
        opt_size = h.size if h else None
    q.run(
        "UPDATE files SET status = 'ready', size = ?, opt_size = ?, key_opt = ?, updated_at = ? WHERE id = ?",
        head.size, opt_size, row["key_opt"] if opt_size else None, now(), fid,
    )
    version_id = None
    replaces = b.get("replaces")
    if isinstance(replaces, str) and replaces != fid:
        if q.first("SELECT id FROM files WHERE id = ? AND item_id = ?", replaces, row["item_id"]):
            version_id = archive_file(replaces, "replaced", ctx.user)
    claim_langs(row["item_id"], fid, [row["lang"], *parse_extra(row["extra_langs"], row["lang"])], ctx.user)
    if b.get("touch") is not False:
        t = now()
        q.run("UPDATE items SET created_at = ?, updated_at = ? WHERE id = ?", t, t, row["item_id"])
    return {"ok": True, "versionId": version_id}


def file_update(ctx: Ctx, b: Body):
    fid = _str(b.get("id"), "id")
    row = q.first("SELECT item_id, lang, extra_langs FROM files WHERE id = ?", fid)
    if not row:
        raise HttpError(404, "File not found")
    sets, vals = [], []
    langs = None
    if "langs" in b:
        langs = clean_langs(b.get("langs"))
        if not langs:
            raise HttpError(400, "Choose at least one language")
    elif "lang" in b:
        if not is_file_lang(b.get("lang")):
            raise HttpError(400, "Unknown language")
        langs = ["all"] if b["lang"] == "all" else [b["lang"], *parse_extra(row["extra_langs"], b["lang"])]
    gave: list[dict] = []
    if langs is not None:
        want = [l for l in langs if l != "all"]
        if want and b.get("replace") is not True:
            others = q.all("SELECT name, lang, extra_langs FROM files WHERE item_id = ? AND id != ? ORDER BY created_at, id", row["item_id"], fid)
            # only a version in exactly the same languages clashes (sharing some is fine)
            clash = [
                f"{' + '.join(FILE_LANG_LABEL.get(l, l) for l in want)} ({o['name']})"
                for o in others
                if _same_langs([o["lang"], *parse_extra(o["extra_langs"], o["lang"])], want)
            ]
            if clash:
                raise HttpError(409, f"Another version is already in {', '.join(clash)}")
        gave = claim_langs(row["item_id"], fid, langs, ctx.user)
        sets += ["lang = ?", "extra_langs = ?"]
        vals += [langs[0], _extra_json(langs[1:])]
    if "caption" in b:
        sets.append("caption = ?")
        vals.append(_opt_str(b.get("caption")))
    if not sets:
        return {"ok": True}
    sets.append("updated_at = ?")
    vals.append(now())
    q.run(f"UPDATE files SET {', '.join(sets)} WHERE id = ?", *vals, fid)
    return {"ok": True, "replaced": len([g for g in gave if g["archived"]]), "trimmed": len([g for g in gave if not g["archived"]])}


def file_setopt(ctx: Ctx, b: Body):
    fid = _str(b.get("id"), "id")
    row = q.first("SELECT key_opt FROM files WHERE id = ?", fid)
    if not row:
        raise HttpError(404, "File not found")
    mime = _str(b.get("optMime"), "optMime", 100)
    ext = {"video/mp4": "mp4", "image/webp": "webp", "image/png": "png"}.get(mime, "jpg")
    key = f"v/{fid}{new_id(4)}.{ext}"
    if row["key_opt"]:
        delete_storage([row["key_opt"]])
    q.run("UPDATE files SET key_opt = ?, opt_mime = ?, opt_size = NULL, updated_at = ? WHERE id = ?", key, mime, now(), fid)
    return {"key": key}


def file_setthumb(ctx: Ctx, b: Body):
    fid = _str(b.get("id"), "id")
    row = q.first("SELECT key_thumb, kind FROM files WHERE id = ?", fid)
    if not row:
        raise HttpError(404, "File not found")
    if row["kind"] != "image":
        raise HttpError(400, "Only pictures have a cover")
    key = f"t/{fid}{new_id(4)}.webp"
    if row["key_thumb"] and not q.first("SELECT 1 AS x FROM file_versions WHERE key_thumb = ?", row["key_thumb"]):
        delete_storage([row["key_thumb"]])
    focus = min(1, max(0, b["focusY"])) if is_num(b.get("focusY")) else None
    q.run("UPDATE files SET key_thumb = ?, focus_y = ?, updated_at = ? WHERE id = ?", key, focus, now(), fid)
    return {"key": key}


def file_clearopt(ctx: Ctx, b: Body):
    fid = _str(b.get("id"), "id")
    row = q.first("SELECT key_opt FROM files WHERE id = ?", fid)
    if row and row["key_opt"]:
        delete_storage([row["key_opt"]])
    q.run("UPDATE files SET key_opt = NULL, opt_mime = NULL, opt_size = NULL, updated_at = ? WHERE id = ?", now(), fid)
    return {"ok": True}


def file_delete(ctx: Ctx, b: Body):
    fid = _str(b.get("id"), "id")
    row = q.first("SELECT item_id, status, key_orig, key_opt, key_thumb, key_poster FROM files WHERE id = ?", fid)
    if not row:
        return {"ok": True}
    if row["status"] != "ready":
        delete_storage(file_keys(row))
        q.run("DELETE FROM files WHERE id = ?", fid)
        return {"ok": True, "versionId": None}
    return {"ok": True, "versionId": archive_file(fid, "deleted", ctx.user)}


def versions_restore(ctx: Ctx, b: Body):
    return {"ok": True, **restore_version(_str(b.get("id"), "id"), ctx.user)}


# ---------------------------------------------------------------- copy / paste / duplicate

MAX_COPY_FOLDERS = 300
MAX_COPY_FILES = 3000


def _parse_name(raw) -> dict:
    try:
        v = json.loads(raw or "")
        return v if isinstance(v, dict) else {"en": str(raw or "")}
    except (ValueError, TypeError):
        return {"en": str(raw or "")}


def _en_of(n: dict) -> str:
    return n.get("en") or next(iter(n.values()), "")


def _with_copy(name: dict, taken: set[str]) -> dict:
    """'Rebate' → 'Rebate (copy)', 'Rebate (copy 2)'… — the first one not taken."""
    for n in count(1):
        tag = " (copy)" if n == 1 else f" (copy {n})"
        nxt = {k: f"{v}{tag}" for k, v in name.items()}
        if _en_of(nxt).lower() not in taken:
            return nxt


def _swap_key(k: str | None, fid: str, source: str | None = None) -> str | None:
    """Independent keys; originals include the source id to validate subsequent copy batches."""
    if not k:
        return None
    if k.startswith("o/"):
        return f"o/{fid}/{source}/{k.rsplit('/', 1)[-1]}" if source else f"o/{fid}/{'/'.join(k.split('/')[2:])}"
    dot = k.rfind(".")
    return f"{k[:2]}{fid}{k[dot:] if dot > 1 else ''}"


def copy_start(ctx: Ctx, b: Body):
    """
    Copies folders (with everything inside) and cards into a folder (copy.start in admin-ops.ts):
      folderIds, itemIds   what to copy
      targetId             where (null = top level; only folders can go there)
    The new folders, cards and file rows are made at once; the files stay 'uploading' until
    `copy.files` has made their stored copies. Pasted next to a namesake → " (copy)".
    """
    folder_ids = list(dict.fromkeys(_ids(b.get("folderIds"))))
    item_ids = list(dict.fromkeys(_ids(b.get("itemIds"))))
    target = b.get("targetId")
    if target is not None and (not isinstance(target, str) or not target):
        raise HttpError(400, "Expected a folder id")
    if not folder_ids and not item_ids:
        raise HttpError(400, "Nothing to copy")

    f_all = q.all("SELECT * FROM folders WHERE deleted_at IS NULL ORDER BY sort, created_at, id")
    by_id = {f["id"]: f for f in f_all}

    def lineage(fid):
        seen = set()
        while fid is not None:
            if fid not in by_id or fid in seen:
                raise HttpError(404, "Folder not found")
            seen.add(fid)
            fid = by_id[fid]["parent_id"]
        return seen

    if target is not None:
        lineage(target)
    selected = set(folder_ids)
    roots = [fid for fid in folder_ids if not ((lineage(fid) - {fid}) & selected)]
    kids: dict[str, list[str]] = {}
    for f in f_all:
        if f["parent_id"]:
            kids.setdefault(f["parent_id"], []).append(f["id"])
    order: list[str] = []
    queue = list(roots)
    while queue:  # a snapshot, top first (so pasting a folder into itself is fine)
        fid = queue.pop(0)
        if fid in order:
            continue
        order.append(fid)
        queue += kids.get(fid, [])
    if len(order) > MAX_COPY_FOLDERS:
        raise HttpError(413, f"Too many folders to copy at once ({len(order)}; up to {MAX_COPY_FOLDERS})")
    items: dict[str, dict] = {}
    for i in range(0, len(order), 90):
        part = order[i : i + 90]
        for r in q.all(f"SELECT * FROM items WHERE deleted_at IS NULL AND folder_id IN ({in_list(len(part))}) ORDER BY id", *part):
            items[r["id"]] = r
    for i in range(0, len(item_ids), 90):
        part = item_ids[i : i + 90]
        for r in q.all(f"SELECT * FROM items WHERE deleted_at IS NULL AND id IN ({in_list(len(part))}) ORDER BY id", *part):
            items[r["id"]] = r
    if any(i not in items for i in item_ids):
        raise HttpError(404, "Item not found")
    for it in items.values():
        lineage(it["folder_id"])
    # A selected descendant is already included in the selected ancestor's copy.
    item_ids = [i for i in item_ids if items[i]["folder_id"] not in order]
    if item_ids and target is None:
        raise HttpError(400, "Files have to be inside a folder")
    item_list = list(items.values())
    files: list[dict] = []
    for i in range(0, len(item_list), 90):
        part = [it["id"] for it in item_list[i : i + 90]]
        files += q.all(f"SELECT * FROM files WHERE status = 'ready' AND item_id IN ({in_list(len(part))}) ORDER BY created_at, id", *part)
    if len(files) > MAX_COPY_FILES:
        raise HttpError(413, f"Too many files to copy at once ({len(files)}; up to {MAX_COPY_FILES})")

    t = now()
    stmts = []
    new_folder: dict[str, str] = {}
    new_item: dict[str, str] = {}
    taken = {_en_of(_parse_name(r["name"])).lower() for r in q.all("SELECT name FROM folders WHERE parent_id <=> ? AND deleted_at IS NULL", target)}
    mx = q.first("SELECT COALESCE(MAX(sort), 0) AS m FROM folders WHERE parent_id <=> ?", target)
    next_sort = int((mx or {}).get("m") or 0) + 10
    taken_slugs = {f["slug"] for f in f_all if f["parent_id"] == target}
    icons = []
    for fid in order:
        f = by_id[fid]
        top = fid in roots
        parent = target if top else new_folder[f["parent_id"]]
        name = _parse_name(f["name"])
        if top and _en_of(name).lower() in taken:
            name = _with_copy(name, taken)
        if top:
            taken.add(_en_of(name).lower())
        nid = new_id()
        new_folder[fid] = nid
        slug = f["slug"]
        if top:
            base = slugify(_en_of(name) or f["slug"])
            slug, n = base, 2
            while slug in taken_slugs:
                slug, n = f"{base}-{n}", n + 1
            taken_slugs.add(slug)
        icon = f["icon"]
        if icon and icon.startswith("img:i/"):
            key = f"i/{new_id()}.webp"
            icons.append((icon[4:], key))
            icon = "img:" + key
        if top and (f["parent_id"] or None) == target:
            sort = int(f["sort"]) + 1  # a duplicate goes right after the original
        elif top:
            sort = next_sort
            next_sort += 10
        else:
            sort = int(f["sort"])
        stmts.append((
            "INSERT INTO folders (id,parent_id,slug,name,sort,icon,icon_bg,icon_fg,hidden,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [nid, parent, slug, _dumps(name), sort, icon, f["icon_bg"], f["icon_fg"], 1 if f.get("hidden") else 0, t, t],
        ))
    # Leave space deterministically, including when existing siblings have tied sorts.
    siblings = [f["id"] for f in f_all if f["parent_id"] == target]
    placement = []
    for fid in siblings:
        placement.append(fid)
        if fid in roots:
            placement.append(new_folder[fid])
    placement += [new_folder[fid] for fid in roots if by_id[fid]["parent_id"] != target]
    if roots:
        stmts += [("UPDATE folders SET sort = ? WHERE id = ?", [(n + 1) * 10, fid]) for n, fid in enumerate(placement)]
    titles: set[str] = set()
    if target and item_ids:
        titles = {_en_of(_parse_name(r["title"])).lower() for r in q.all("SELECT title FROM items WHERE folder_id = ? AND deleted_at IS NULL", target)}
    for it in item_list:
        loose = it["id"] in item_ids
        folder = target if loose else new_folder[it["folder_id"]]
        title = _parse_name(it["title"])
        if loose and _en_of(title).lower() in titles:
            title = _with_copy(title, titles)
        if loose:
            titles.add(_en_of(title).lower())
        nid = new_id()
        new_item[it["id"]] = nid
        stmts.append((
            "INSERT INTO items (id,folder_id,title,pinned,created_at,updated_at,created_by,sort,status,publish_at,hide_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [nid, folder, _dumps(title), 1 if it["pinned"] else 0, it["created_at"], t, ctx.user, None if loose else it["sort"], it["status"] or "live", it["publish_at"], it["hide_at"]],
        ))
    for fid in order:  # folder covers point at the copied cards
        cover = by_id[fid]["cover_item_id"]
        if cover and cover in new_item:
            stmts.append(("UPDATE folders SET cover_item_id = ? WHERE id = ?", [new_item[cover], new_folder[fid]]))
    pending = []
    for f in files:
        nid = new_id()
        pending.append({"id": nid, "src": f["id"], "size": (f["size"] or 0) + (f["opt_size"] or 0)})
        stmts.append((
            f"""INSERT INTO files (id,item_id,{_VERSION_COLS},status,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'uploading',?,?)""",
            [
                nid, new_item[f["item_id"]], f["lang"], f.get("extra_langs"), f["kind"], f["name"], f["mime"], f["size"], f["width"],
                f["height"], f["duration"], _swap_key(f["key_orig"], nid, f["id"]), _swap_key(f["key_opt"], nid), f["opt_mime"], f["opt_size"],
                _swap_key(f["key_thumb"], nid), _swap_key(f["key_poster"], nid), f["caption"], f["focus_y"], f["created_at"], t,
            ],
        ))
    # Uploaded folder icons also need independent objects: purge removes their keys.
    copied_icons = []
    try:
        for src, dst in icons:
            copied_icons.append(dst)
            storage().copy(src, dst)
        q.batch(stmts)
    except Exception:
        if copied_icons:
            storage().delete(copied_icons)
        raise
    return {
        "folderIds": [new_folder[i] for i in roots],
        "itemIds": [new_item[i] for i in item_ids if i in new_item],
        "folders": len(order),
        "items": len(item_list),
        "files": pending,
        "bytes": sum(p["size"] for p in pending),
    }


def copy_files(ctx: Ctx, b: Body):
    """Makes the stored copies for files made by copy.start and marks them ready. pairs: [{id, src}] (up to 20 per call)."""
    pairs = b.get("pairs")
    if not isinstance(pairs, list) or not pairs or len(pairs) > 20:
        raise HttpError(400, "Expected 1 to 20 copy pairs")
    if any(not isinstance(p, dict) or not isinstance(p.get("id"), str) or not p["id"]
           or not isinstance(p.get("src"), str) or not p["src"] for p in pairs):
        raise HttpError(400, "Expected copy file ids")
    if len({p["id"] for p in pairs}) != len(pairs):
        raise HttpError(400, "Duplicate copy file ids")
    st = storage()
    done, failed = [], []
    keys = ("key_orig", "key_opt", "key_thumb", "key_poster")
    for p in pairs:
        fid, src = p["id"], p["src"]
        try:
            with q.transaction() as conn:
                rows = q.exec(conn, "SELECT * FROM files WHERE id IN (?, ?) ORDER BY id FOR UPDATE", fid, src).mappings().all()
                by_id = {r["id"]: dict(r) for r in rows}
                to, frm = by_id.get(fid), by_id.get(src)
                if (not to or not frm or fid == src or to["status"] not in ("uploading", "ready")
                        or frm["status"] != "ready" or not frm["key_orig"]):
                    failed.append(fid)
                    continue
                # The source id in the new original key binds the pair without a schema change.
                # Derived keys must also belong to this destination, never to the source.
                if any(to[k] != _swap_key(frm[k], fid, src if k == "key_orig" else None) for k in keys):
                    failed.append(fid)
                    continue
                if any(to[k] != frm[k] for k in ("name", "mime", "size", "opt_mime", "opt_size")):
                    failed.append(fid)
                    continue
                active = q.exec(conn, "SELECT id FROM items WHERE id IN (?, ?) AND deleted_at IS NULL FOR UPDATE", to["item_id"], frm["item_id"]).mappings().all()
                if {r["id"] for r in active} != {to["item_id"], frm["item_id"]}:
                    failed.append(fid)
                    continue
                if to["status"] == "ready":  # safely retry a response lost after completion
                    done.append(fid)
                    continue
                for key in keys:
                    if frm[key]:
                        st.copy(frm[key], to[key])
                q.exec(conn, "UPDATE files SET status = 'ready', updated_at = ? WHERE id = ?", now(), fid)
            done.append(fid)
        except Exception:  # incomplete files stay hidden; the remaining batch still runs
            logging.getLogger(__name__).exception("Could not copy file %s", fid)
            failed.append(fid)
    return {"done": done, "failed": failed}


def move(ctx: Ctx, b: Body):
    folder_ids = _ids(b.get("folderIds"))
    item_ids = _ids(b.get("itemIds"))
    target = b.get("targetId") or None
    if target is not None and not isinstance(target, str):
        raise HttpError(400, "Expected a folder id")
    if target:
        _folder_exists(target)
    if item_ids and not target:
        raise HttpError(400, "Files have to be inside a folder")
    if folder_ids and target:
        if target in subtree(folder_ids):
            raise HttpError(400, "A folder can't be moved into itself")
    t = now()
    stmts = []
    for fid in folder_ids:
        cur = q.first("SELECT slug FROM folders WHERE id = ?", fid)
        if not cur:
            continue
        slug = unique_slug(target, cur["slug"], fid)
        stmts.append(("UPDATE folders SET parent_id = ?, slug = ?, sort = ?, updated_at = ? WHERE id = ?", [target, slug, t, t, fid]))
    if item_ids:
        stmts.append((f"UPDATE items SET folder_id = ?, updated_at = ? WHERE id IN ({in_list(len(item_ids))})", [target, t, *item_ids]))
    q.batch(stmts)
    return {"ok": True}


def trash(ctx: Ctx, b: Body):
    folder_ids = _ids(b.get("folderIds"))
    item_ids = _ids(b.get("itemIds"))
    t = now()
    stmts = []
    if folder_ids:
        stmts.append((f"UPDATE folders SET deleted_at = ? WHERE id IN ({in_list(len(folder_ids))})", [t, *folder_ids]))
    if item_ids:
        stmts.append((f"UPDATE items SET deleted_at = ? WHERE id IN ({in_list(len(item_ids))})", [t, *item_ids]))
    q.batch(stmts)
    return {"ok": True}


def restore(ctx: Ctx, b: Body):
    folder_ids = _ids(b.get("folderIds"))
    item_ids = _ids(b.get("itemIds"))
    stmts = []
    if folder_ids:
        stmts.append((f"UPDATE folders SET deleted_at = NULL WHERE id IN ({in_list(len(folder_ids))})", folder_ids))
    if item_ids:
        stmts.append((f"UPDATE items SET deleted_at = NULL WHERE id IN ({in_list(len(item_ids))})", item_ids))
    q.batch(stmts)
    return {"ok": True}


def purge(ctx: Ctx, b: Body):
    """Permanently removes things from the Trash. `all: true` empties it."""
    folder_ids = _ids(b.get("folderIds"))
    item_ids = _ids(b.get("itemIds"))
    if b.get("all") is True:
        folder_ids = [r["id"] for r in q.all("SELECT id FROM folders WHERE deleted_at IS NOT NULL")]
        item_ids = [r["id"] for r in q.all("SELECT id FROM items WHERE deleted_at IS NOT NULL")]
    all_folders = subtree(folder_ids) if folder_ids else []
    if all_folders:
        inner = q.all(f"SELECT id FROM items WHERE folder_id IN ({in_list(len(all_folders))})", *all_folders)
        item_ids = list(dict.fromkeys([*item_ids, *[r["id"] for r in inner]]))
    for i in range(0, len(item_ids), 50):
        chunk = item_ids[i : i + 50]
        ph = in_list(len(chunk))
        fl = q.all(f"SELECT key_orig, key_opt, key_thumb, key_poster FROM files WHERE item_id IN ({ph})", *chunk)
        old = q.all(f"SELECT key_orig, key_opt, key_thumb, key_poster FROM file_versions WHERE item_id IN ({ph})", *chunk)
        delete_storage([k for r in [*fl, *old] for k in file_keys(r)])
        q.batch(
            [
                (f"DELETE FROM file_versions WHERE item_id IN ({ph})", chunk),
                (f"DELETE FROM files WHERE item_id IN ({ph})", chunk),
                (f"UPDATE folders SET cover_item_id = NULL WHERE cover_item_id IN ({ph})", chunk),
                (f"DELETE FROM client_shares WHERE kind = 'item' AND target_id IN ({ph})", chunk),
                (f"DELETE FROM items WHERE id IN ({ph})", chunk),
            ]
        )
    if all_folders:
        icons = q.all(f"SELECT icon FROM folders WHERE icon LIKE ? AND id IN ({in_list(len(all_folders))})", "img:%", *all_folders)
        delete_storage([r["icon"][4:] for r in icons])
        q.run(f"DELETE FROM client_shares WHERE kind = 'folder' AND target_id IN ({in_list(len(all_folders))})", *all_folders)
        # children first, so no row ever points at a missing parent
        q.batch([("DELETE FROM folders WHERE id = ?", [fid]) for fid in reversed(all_folders)])
    return {"ok": True, "items": len(item_ids), "folders": len(all_folders)}


# ---------------------------------------------------------------- large uploads (multipart)

def check_key(v) -> str:
    """An upload key must be one that file.create (or file.setopt / setthumb) handed out."""
    if not isinstance(v, str) or not KEY_RE.match(v):
        raise HttpError(400, "Bad key")
    row = q.first("SELECT id, status FROM files WHERE key_orig = ? OR key_opt = ? OR key_thumb = ? OR key_poster = ? LIMIT 1", v, v, v, v)
    if not row:
        raise HttpError(403, "Unknown upload key")
    # a finished file can't be overwritten: replacing one always uploads under new keys
    if row["status"] != "uploading" and storage().head(v):
        raise HttpError(409, "This file is already uploaded")
    return v


def content_disposition(name: str) -> str:
    from urllib.parse import quote

    ascii_name = re.sub(r"[^\x20-\x7e]", "_", name)
    ascii_name = re.sub(r'["\\]', "_", ascii_name)
    # encodeURIComponent keeps A-Z a-z 0-9 - _ . ! ~ * ' ( )
    encoded = quote(name, safe="-_.!~*'()")
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded}'


def http_meta(key: str, b: dict) -> dict:
    """Content type + download name stored with the object."""
    ct = b.get("contentType") if isinstance(b.get("contentType"), str) else "application/octet-stream"
    meta = {"content_type": ct, "content_disposition": None, "cache_control": IMMUTABLE}
    dn = b.get("downloadName")
    if (key.startswith("o/") or key.startswith("v/")) and isinstance(dn, str) and dn:
        meta["content_disposition"] = content_disposition(dn)
    return meta


def mpu_create(ctx: Ctx, b: Body):
    key = check_key(b.get("key"))
    m = http_meta(key, b)
    upload_id = storage().create_multipart(key, m["content_type"], m["content_disposition"], m["cache_control"])
    return {"uploadId": upload_id}


def mpu_complete(ctx: Ctx, b: Body):
    key = check_key(b.get("key"))
    upload_id = _str(b.get("uploadId"), "uploadId", 2000)
    parts = b.get("parts")
    if not isinstance(parts, list) or not parts:
        raise HttpError(400, "parts required")
    try:
        clean = [{"partNumber": int(p["partNumber"]), "etag": str(p["etag"])} for p in parts]
    except (KeyError, TypeError, ValueError):
        raise HttpError(400, "parts required") from None
    clean.sort(key=lambda p: p["partNumber"])
    storage().complete_multipart(key, upload_id, clean)
    return {"ok": True}


def mpu_abort(ctx: Ctx, b: Body):
    key = check_key(b.get("key"))
    storage().abort_multipart(key, _str(b.get("uploadId"), "uploadId", 2000))
    return {"ok": True}


OPS: dict[str, Callable[[Ctx, Body], Any]] = {
    "folder.create": folder_create,
    "folder.update": folder_update,
    "folder.iconImage": folder_icon_image,
    "folder.reorder": folder_reorder,
    "item.reorder": item_reorder,
    "item.create": item_create,
    "item.update": item_update,
    "items.status": items_status,
    "file.create": file_create,
    "file.ready": file_ready,
    "file.update": file_update,
    "file.setopt": file_setopt,
    "file.setthumb": file_setthumb,
    "file.clearopt": file_clearopt,
    "file.delete": file_delete,
    "versions.restore": versions_restore,
    "copy.start": copy_start,
    "copy.files": copy_files,
    "move": move,
    "trash": trash,
    "restore": restore,
    "purge": purge,
    "mpu.create": mpu_create,
    "mpu.complete": mpu_complete,
    "mpu.abort": mpu_abort,
}
