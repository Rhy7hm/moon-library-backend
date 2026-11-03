"""
The admin API (ported from src/app/api/admin/*):

  GET  /api/admin/tree        everything, including the Trash, drafts and unfinished uploads
  POST /api/admin/<op>        every change, as a named operation with a JSON body
  PUT  /api/admin/upload      file bytes → R2 (whole file, or one part of a multipart upload)
  GET  /api/admin/status      connection checks: MySQL, R2, Google Drive (Owners)
  GET  /api/admin/backup      Google Drive backup status (Owners)
  POST /api/admin/backup      "Back up now" (Owners)
  POST /api/admin/backup/settings   { mirrorDeletes } — remove Drive copies of things deleted for good (Owners)
  GET  /api/admin/drive/connect     → Google's sign-in page ("Connect Google Drive", Owners)
  GET  /api/admin/drive/callback    ← Google sends the Owner back here; saves the connection
  POST /api/admin/drive/disconnect  cancels it (Owners)
"""
from __future__ import annotations

import html
import logging
import tempfile

from flask import Blueprint, Response, current_app, redirect, request

from ..auth import check_origin, get_user, require_user, write_log
from ..services import activity
from ..services.admin_ops import OPS, Ctx, check_key, http_meta
from ..services.library import load_library
from ..services.client_ops import CLIENT_OPS
from ..services.manage_ops import MANAGE_OPS, pins_of
from ..services.tag_ops import TAG_OPS
from ..storage import storage
from ..util import HttpError, json_response

log = logging.getLogger(__name__)
bp = Blueprint("admin_api", __name__)

SPOOL_IN_MEMORY = 8 * 1024 * 1024  # bigger request bodies spill to a temporary file


@bp.get("/api/admin/<op>")
def admin_get(op: str):
    user = require_user("viewer")
    if op != "tree":
        raise HttpError(404, "Unknown request")
    # old Trash and old file versions are cleared out as people use the panel (at most hourly)
    try:
        activity.cleanup()
    except Exception:  # noqa: BLE001
        log.exception("cleanup")
    data = load_library(asset_base=current_app.config["ASSET_BASE"])
    data["user"] = {"id": user.id, "username": user.username, "name": user.name, "role": user.role, "pins": pins_of(user.id)}
    return json_response(data, headers={"Cache-Control": "no-store"})


@bp.post("/api/admin/<op>")
def admin_post(op: str):
    check_origin()
    body = request.get_json(silent=True, force=True)
    body = body if isinstance(body, dict) else {}
    # Emptying the whole Trash stays Owner-only; deleting one item from Trash is Editor.
    need = "owner" if op == "purge" and body.get("all") is True else activity.NEED.get(op, "editor")
    user = require_user(need)

    manage = MANAGE_OPS.get(op) or CLIENT_OPS.get(op) or TAG_OPS.get(op)
    if manage:
        result = manage(user, body)
        return json_response(result if result is not None else {"ok": True})

    fn = OPS.get(op)
    if not fn:
        raise HttpError(404, f"Unknown operation: {op}")
    try:
        plan = activity.plan_log(op, body)
    except Exception:  # noqa: BLE001 - logging must never block the change
        log.exception("plan_log %s", op)
        plan = None
    result = fn(Ctx(user.username), body)
    if plan:
        try:
            entry = plan(result if isinstance(result, dict) else None)
        except Exception:  # noqa: BLE001
            log.exception("log entry %s", op)
            entry = None
        if entry:
            write_log(user, entry)
    return json_response(result if result is not None else {"ok": True})


def _read_body(max_bytes: int):
    """The request body in a temporary file (in memory up to 8 MB), with its length. Never loads more than max_bytes."""
    spool = tempfile.SpooledTemporaryFile(max_size=SPOOL_IN_MEMORY)
    total = 0
    stream = request.stream
    while True:
        chunk = stream.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            spool.close()
            raise HttpError(413, "Upload part too large")
        spool.write(chunk)
    spool.seek(0)
    return spool, total


@bp.put("/api/admin/upload")
def admin_upload():
    """
    PUT /api/admin/upload?key=…                         whole file (small files)
    PUT /api/admin/upload?key=…&uploadId=…&part=N       one part of a multipart upload
    Optional: &contentType=…&downloadName=…  (stored with the object)
    """
    check_origin()
    require_user("editor")
    key = check_key(request.args.get("key"))
    max_body = current_app.config["MAX_UPLOAD_BODY"]
    declared = request.content_length
    if declared is not None and declared > max_body:
        raise HttpError(413, "Upload part too large")
    spool, size = _read_body(max_body)
    try:
        if not size:
            raise HttpError(400, "Empty upload")
        upload_id = request.args.get("uploadId")
        if upload_id:
            try:
                part = int(request.args.get("part", ""))
            except ValueError:
                part = 0
            if part < 1 or part > 10000:
                raise HttpError(400, "Bad part number")
            etag = storage().upload_part(key, upload_id, part, spool, size)
            return json_response({"partNumber": part, "etag": etag})
        meta = http_meta(key, {"contentType": request.args.get("contentType"), "downloadName": request.args.get("downloadName")})
        storage().put(key, spool, size, meta["content_type"], meta["content_disposition"], meta["cache_control"])
        return json_response({"ok": True, "size": size})
    finally:
        spool.close()


@bp.get("/api/admin/status")
def connection_status_route():
    """Settings → Connections: MySQL, R2 and Google Drive, checked live (Owners only)."""
    require_user("owner")
    from ..services.health import check_all

    return json_response(check_all(), headers={"Cache-Control": "no-store"})


@bp.get("/api/admin/backup")
def backup_status_route():
    require_user("owner")
    from ..drive.backup import backup_status

    return json_response(backup_status(), headers={"Cache-Control": "no-store"})


@bp.post("/api/admin/backup")
def backup_now_route():
    check_origin()
    user = require_user("owner")
    from ..drive.backup import backup_status, run_backup

    result = run_backup(budget_ms=20_000)
    if result.get("ran"):
        copied = result.get("copied") or 0
        write_log(
            user,
            {
                "kind": "content",
                "action": "backup.run",
                "summary": f"Started a Google Drive backup{f' — {copied} file' + ('' if copied == 1 else 's') + ' copied' if copied else ''}",
            },
        )
    return json_response({"result": result, "status": backup_status()})


@bp.post("/api/admin/backup/settings")
def backup_settings_route():
    check_origin()
    user = require_user("owner")
    from ..drive.backup import backup_status, set_mirror_deletes

    b = request.get_json(silent=True, force=True) or {}
    if not isinstance(b.get("mirrorDeletes"), bool):
        raise HttpError(400, "mirrorDeletes must be true or false")
    set_mirror_deletes(b["mirrorDeletes"])
    write_log(
        user,
        {
            "kind": "security",
            "action": "backup.settings",
            "summary": f"{user.name} turned {'on' if b['mirrorDeletes'] else 'off'} removing Google Drive copies of files deleted for good",
        },
    )
    return json_response({"status": backup_status()})


# ---------------------------------------------------------------- Connect Google Drive (drive/connect.py)

def _drive_page(message: str) -> Response:
    """A plain page for when the Google sign-in can't finish (the person arrives here from Google, not from the app)."""
    body = f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moon Library — Google Drive</title>
<body style="font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#1d1d1f">
<h1 style="font-size:22px">Google Drive wasn't connected</h1><p>{html.escape(message)}</p>
<p><a href="/admin#/settings/connections">Back to Settings → Connections</a></p></body>"""
    return Response(body, status=400, mimetype="text/html", headers={"Cache-Control": "no-store"})


@bp.get("/api/admin/drive/connect")
def drive_connect_route():
    from ..drive.connect import ConnectError, start

    user = get_user()
    if not user or user.role != "owner":
        return _drive_page("Only an Owner can connect Google Drive. Sign in as an Owner and try again.")
    try:
        return redirect(start(user.id), code=302)
    except ConnectError as e:
        return _drive_page(str(e))


@bp.get("/api/admin/drive/callback")
def drive_callback_route():
    from ..drive.connect import ConnectError, finish

    user = get_user()
    if not user or user.role != "owner":
        return _drive_page("Only an Owner can connect Google Drive. Sign in as an Owner and try again.")
    if request.args.get("error"):
        why = "you chose not to allow it" if request.args["error"] == "access_denied" else request.args["error"]
        return _drive_page(f"Google didn't give access ({why}). Nothing was changed.")
    try:
        conn = finish(user.id, user.username, request.args.get("code", ""), request.args.get("state", ""))
    except ConnectError as e:
        return _drive_page(str(e))
    write_log(user, {"kind": "security", "action": "drive.connect", "summary": f"{user.name} connected Google Drive ({conn['email']}) for the backup"})
    return redirect("/admin#/settings/connections", code=302)


@bp.post("/api/admin/drive/disconnect")
def drive_disconnect_route():
    check_origin()
    user = require_user("owner")
    from ..drive.connect import disconnect

    conn = disconnect()
    if conn:
        write_log(user, {"kind": "security", "action": "drive.disconnect", "summary": f"{user.name} disconnected Google Drive ({conn.get('email') or 'unknown'}) — what's already there stays"})
    return json_response({"ok": True})

