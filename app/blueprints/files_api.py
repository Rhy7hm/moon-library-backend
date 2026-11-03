"""
Stored files, for signed-in staff only (the admin's thumbnails, previews and downloads):

  GET  /f/<key>  (and HEAD)    a stored file by storage key, with Range support; ?dl=<name> downloads it
  GET  /zip?v=<ids>&o=1&name=  several files as one ZIP, built on the fly and streamed (any size)
"""
from __future__ import annotations

import json
import re

from flask import Blueprint, Response, request, stream_with_context
from zipstream import ZIP_STORED, ZipStream

from ..auth import get_user
from ..db import in_list, q
from ..media import safe_file_headers
from ..langs import LANG_CODES, clean_langs, dl_name, is_file_lang, pick_text
from ..services.admin_ops import content_disposition
from ..storage import StorageError, storage

bp = Blueprint("files_api", __name__)


# ---------------------------------------------------------------- files

_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _parse_range(h: str | None):
    """Same rules as before: one range 'bytes=a-b', 'bytes=a-' or 'bytes=-n'; anything else = whole file."""
    if not h:
        return None
    m = _RANGE.match(h.strip())
    if not m:
        return None
    a, b = m.group(1), m.group(2)
    if a == "" and b != "":
        return f"bytes=-{int(b)}" if int(b) > 0 else None
    if a == "":
        return None
    if b == "":
        return f"bytes={int(a)}-"
    if int(b) < int(a):
        return None
    return f"bytes={int(a)}-{int(b)}"


@bp.route("/f/<path:key>", methods=["GET", "HEAD"])
def serve_file(key: str):
    """A stored file by its storage key, for signed-in staff. Anyone else gets 404 (no hint the file exists)."""
    if not re.match(r"^(o|v|t|p|i|c|u)/", key) or not get_user():
        return Response("Not found", status=404, mimetype="text/plain", headers={"Cache-Control": "no-store"})
    dl = (request.args.get("dl") or key.split("/")[-1] or "download") if "dl" in request.args else None
    # keys never change (a replaced file gets new ones), so the browser may keep its own copy
    return stream_key(key, "private, max-age=86400", dl)


def stream_key(key: str, cache: str, download_name: str | None = None) -> Response:
    """Sends one stored object (HEAD and Range supported) with the safe file headers from app.media."""
    st = storage()
    headers = {"Cache-Control": cache, "Accept-Ranges": "bytes"}

    def finish(content_type: str | None):
        headers["Content-Type"] = content_type or "application/octet-stream"
        headers.update(safe_file_headers(content_type))
        if download_name:
            headers["Content-Disposition"] = content_disposition(download_name)
        elif headers.get("Content-Disposition") == "attachment":
            headers["Content-Disposition"] = content_disposition(key.split("/")[-1] or "download")

    if request.method == "HEAD":
        info = st.head(key)
        if not info:
            return Response("Not found", status=404, mimetype="text/plain")
        finish(info.content_type)
        headers.update({"ETag": info.etag, "Content-Length": str(info.size)})
        return Response(status=200, headers=headers)

    rng = _parse_range(request.headers.get("Range"))
    try:
        got = st.get(key, rng)
    except StorageError:
        info = st.head(key)
        if not info:
            return Response("Not found", status=404, mimetype="text/plain")
        headers["Content-Range"] = f"bytes */{info.size}"
        return Response(status=416, headers=headers)
    if not got:
        return Response("Not found", status=404, mimetype="text/plain")
    info, body, content_range, length = got
    finish(info.content_type)
    headers.update({"ETag": info.etag, "Content-Length": str(length)})

    def gen():
        try:
            for chunk in body.iter_chunks(256 * 1024):
                if chunk:
                    yield chunk
        finally:
            body.close()

    status = 200
    if rng and content_range:
        headers["Content-Range"] = content_range
        status = 206
    return Response(stream_with_context(gen()), status=status, headers=headers, direct_passthrough=True)


# ---------------------------------------------------------------- ZIP

MAX_FILES = 500


@bp.get("/zip")
def zip_download():
    if not get_user():
        return Response("Not found", status=404, mimetype="text/plain")
    ids = list(dict.fromkeys(x.strip() for x in (request.args.get("v") or "").split(",") if x.strip()))[:MAX_FILES]
    # ?folder=<id>: everything in a folder and its sub-folders, laid out in the same sub-folders
    prefix: dict[str, str] = {}
    folder_name = None
    if request.args.get("folder"):
        got = _folder_files(request.args["folder"])
        if got is None:
            return Response("Not found", status=404, mimetype="text/plain")
        ids, prefix, folder_name = got
        if len(ids) > MAX_FILES:
            return Response(f"That folder has more than {MAX_FILES} files. Download its sub-folders one by one.", status=413, mimetype="text/plain")
    if not ids:
        return Response("Nothing to zip", status=400, mimetype="text/plain")
    original = request.args.get("o") == "1"
    zip_name = re.sub(r'[\\/:*?"<>|]+', " ", request.args.get("name") or folder_name or "Moon Library files").strip()[:120] or "Moon Library files"
    # the language the library is showing: files are named after their card's title in it ("Rebate_BM.png")
    lang_shown = request.args.get("l") if request.args.get("l") in LANG_CODES else "en"

    # finished uploads that aren't in the Trash
    rows: list[dict] = []
    for i in range(0, len(ids), 90):
        part = ids[i : i + 90]
        rows += q.all(
            f"""SELECT f.id, f.name, f.lang, f.extra_langs, f.size, f.key_orig, f.key_opt, f.opt_mime, f.opt_size, it.folder_id, it.title
                  FROM files f JOIN items it ON it.id = f.item_id
                 WHERE f.id IN ({in_list(len(part))}) AND f.status = 'ready' AND it.deleted_at IS NULL""",
            *part,
        )
    if rows:
        trashed = _trashed_folders()
        rows = [r for r in rows if r["folder_id"] not in trashed]
    if not rows:
        return Response("Not found", status=404, mimetype="text/plain")
    by_id = {r["id"]: r for r in rows}

    used: dict[str, int] = {}

    def unique(name: str) -> str:
        n = used.get(name, 0)
        used[name] = n + 1
        if not n:
            return name
        dot = name.rfind(".")
        return f"{name[:dot]} ({n + 1}){name[dot:]}" if dot > 0 else f"{name} ({n + 1})"

    plan = []
    for fid in ids:
        r = by_id.get(fid)
        if not r:
            continue
        use_opt = not original and bool(r["key_opt"])
        lang = r["lang"] if is_file_lang(r["lang"]) else "all"
        try:
            extra = [l for l in clean_langs(json.loads(r["extra_langs"])) if l != lang and l != "all"] if r["extra_langs"] else []
        except (ValueError, TypeError):
            extra = []
        title = _text(r["title"])
        t = pick_text(title, lang_shown) or pick_text(title, "en")
        name = dl_name(r["name"], r["opt_mime"], r["key_opt"], lang, [lang, *extra] if extra else None, original=not use_opt, title=t)
        plan.append({"key": r["key_opt"] if use_opt else r["key_orig"], "name": unique(prefix.get(r["folder_id"], "") + name)})

    st = storage()
    files = []
    for p in plan:  # exact sizes from storage, so the download can show its total and progress
        h = st.head(p["key"])
        if h:
            files.append({**p, "size": h.size})
    if not files:
        return Response("Not found", status=404, mimetype="text/plain")

    zs = ZipStream(compress_type=ZIP_STORED, sized=True)
    for f in files:
        # (entries carry the time of the download as their date: zipstream-ng sets it for streamed data)
        zs.add(_lazy(st, f["key"], f["size"]), arcname=f["name"], size=f["size"], compress_type=ZIP_STORED)
    headers = {
        "Content-Type": "application/zip",
        "Content-Disposition": content_disposition(f"{zip_name}.zip"),
        "Cache-Control": "no-store",
        "Content-Length": str(len(zs)),
    }
    return Response(stream_with_context(iter(zs)), status=200, headers=headers, direct_passthrough=True)


def _lazy(st, key: str, size: int):
    """Opens the stored file only when the ZIP reaches it, and checks its size didn't change."""
    sent = 0
    for chunk in st.iter_object(key):
        sent += len(chunk)
        yield chunk
    if sent != size:
        raise RuntimeError(f"{key} changed while zipping")


def _text(raw) -> dict:
    """A stored title: JSON {"en": …}, or plain text from very old rows."""
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except (ValueError, TypeError):
        return {"en": raw}


def _folder_files(root: str):
    """
    Finished files in a folder and every sub-folder that isn't in the Trash → (file ids, {folder id: "Sub/Sub2/"}, folder name),
    or None when the folder doesn't exist or is in the Trash.
    """
    trashed = _trashed_folders()
    folders = {r["id"]: r for r in q.all("SELECT id, parent_id, name FROM folders")}
    if root not in folders or root in trashed:
        return None
    kids: dict[str, list[str]] = {}
    for f in folders.values():
        if f["parent_id"]:
            kids.setdefault(f["parent_id"], []).append(f["id"])
    safe = lambda n: re.sub(r'[\\/:*?"<>|]+', " ", n).strip() or "Folder"
    prefix: dict[str, str] = {root: ""}
    todo = [root]
    while todo:
        fid = todo.pop()
        for k in kids.get(fid, []):
            if k in trashed or k in prefix:
                continue
            prefix[k] = f"{prefix[fid]}{safe(pick_text(_text(folders[k]['name']), 'en') or 'Folder')}/"
            todo.append(k)
    ids = [
        r["id"]
        for r in q.all(
            f"""SELECT f.id FROM files f JOIN items it ON it.id = f.item_id
                 WHERE it.folder_id IN ({in_list(len(prefix))}) AND it.deleted_at IS NULL AND f.status = 'ready'
                 ORDER BY it.folder_id, it.sort, f.id""",
            *prefix,
        )
    ]
    return ids, prefix, safe(pick_text(_text(folders[root]["name"]), "en") or "Folder")


def _trashed_folders() -> set[str]:
    """Folders in the Trash, or inside one that is."""
    rows = q.all("SELECT id, parent_id, deleted_at FROM folders")
    parent = {r["id"]: r["parent_id"] for r in rows}
    gone = {r["id"] for r in rows if r["deleted_at"]}
    out = set()
    for r in rows:
        cur, guard = r["id"], set()
        while cur and cur not in guard:
            if cur in gone:
                out.add(r["id"])
                break
            guard.add(cur)
            cur = parent.get(cur)
    return out
