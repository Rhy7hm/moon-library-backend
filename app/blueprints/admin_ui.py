"""
The admin panel's web page: the Vite build in admin/dist, served at /admin.

  /admin, /admin/            index.html (never cached, so a new build is picked up at once)
  /admin/assets/…            the built JS / CSS (file names carry a hash → cached for a year)
  /fonts/…, /category-icons/…, /favicon.png, /logo.webp
                             the shared public files the admin pages use (copied into the build)
                               when the API and the public site run on different addresses
"""
from __future__ import annotations

import os

from flask import Blueprint, Response, abort, current_app, send_from_directory

bp = Blueprint("admin_ui", __name__)


def _dist() -> str:
    return current_app.config["ADMIN_DIST"]


def _not_built() -> Response:
    return Response(
        "The admin panel hasn't been built yet. Run:  cd admin && npm install && npm run build",
        status=503,
        mimetype="text/plain",
    )


@bp.get("/admin")
@bp.get("/admin/")
def admin_index():
    path = os.path.join(_dist(), "index.html")
    if not os.path.isfile(path):
        return _not_built()
    res = send_from_directory(_dist(), "index.html", max_age=0, conditional=False)
    res.headers["Cache-Control"] = "no-store"
    res.headers["X-Robots-Tag"] = "noindex, nofollow"
    res.headers["X-Frame-Options"] = "DENY"
    res.headers["Referrer-Policy"] = "same-origin"
    return res


@bp.get("/admin/assets/<path:name>")
def admin_assets(name: str):
    res = send_from_directory(os.path.join(_dist(), "assets"), name, max_age=31536000)
    res.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return res


@bp.get("/admin/<path:rest>")
def admin_deep(rest: str):
    # files the build copied (fonts, icons, logo); anything else under /admin is the same page
    # (the panel itself uses #hash addresses)
    full = os.path.realpath(os.path.join(_dist(), rest))
    if full.startswith(os.path.realpath(_dist()) + os.sep) and os.path.isfile(full) and not rest.endswith("index.html"):
        return send_from_directory(_dist(), rest, max_age=86400)
    return admin_index()


def _public(sub: str, name: str):
    folder = os.path.join(_dist(), sub) if sub else _dist()
    if not os.path.isdir(folder):
        abort(404)
    return send_from_directory(folder, name, max_age=86400)


@bp.get("/fonts/<path:name>")
def fonts(name: str):
    return _public("fonts", name)


@bp.get("/category-icons/<path:name>")
def category_icons(name: str):
    return _public("category-icons", name)


@bp.get("/favicon.png")
def favicon():
    return _public("", "favicon.png")


@bp.get("/logo.webp")
def logo():
    return _public("", "logo.webp")
