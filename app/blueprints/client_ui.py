"""
The client website: the Vite build in client/dist, served at the site's root.

  /                 index.html — the one sign-in page for everyone. Clients (who sign in with their
                    email) stay here; staff (who sign in with their ID) are sent on to /admin.
                    Never cached, so a new build is picked up at once.
  /assets/…         the built JS / CSS (file names carry a hash → cached for a year)

The site uses #hash addresses, so nothing else needs a page of its own. /favicon.png comes from the
admin build (admin_ui) — both sites use the same logo.
"""
from __future__ import annotations

import os

from flask import Blueprint, Response, current_app, send_from_directory

bp = Blueprint("client_ui", __name__)


def _dist() -> str:
    return current_app.config["CLIENT_DIST"]


@bp.get("/")
def client_index():
    if not os.path.isfile(os.path.join(_dist(), "index.html")):
        return Response(
            "The client website hasn't been built yet. Run:  cd client && npm install && npm run build",
            status=503,
            mimetype="text/plain",
        )
    res = send_from_directory(_dist(), "index.html", max_age=0, conditional=False)
    res.headers["Cache-Control"] = "no-store"
    res.headers["X-Robots-Tag"] = "noindex, nofollow"
    res.headers["X-Frame-Options"] = "DENY"
    res.headers["Referrer-Policy"] = "same-origin"
    return res


@bp.get("/assets/<path:name>")
def client_assets(name: str):
    res = send_from_directory(os.path.join(_dist(), "assets"), name, max_age=31536000)
    res.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return res
