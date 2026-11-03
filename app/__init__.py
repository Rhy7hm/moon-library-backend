"""
Moon Library — backend (Flask): staff admin + API for the marketing asset library.

    create_app()   the application factory (used by `flask`, Gunicorn and the tests)
"""
from __future__ import annotations

import logging
import os

from flask import Flask, redirect, request
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import Config
from .db import db, init_engine_events
from .util import HttpError, json_response

log = logging.getLogger("moonlib")


def create_app(overrides: dict | None = None) -> Flask:
    _load_dotenv()
    app = Flask(__name__, static_folder=None)
    cfg = Config()
    app.config.from_mapping(cfg.as_dict())
    if overrides:
        app.config.update(overrides)
    app.json.sort_keys = False
    app.json.ensure_ascii = False
    app.json.compact = True

    hops = int(app.config.get("TRUST_PROXY_HOPS") or 0)
    if hops > 0:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops, x_host=hops, x_port=hops, x_prefix=0)

    db.init_app(app)
    with app.app_context():
        init_engine_events(db.engine)

    from flask_migrate import Migrate

    Migrate(app, db, directory=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations"), compare_type=True)

    from .blueprints import admin_api, admin_ui, auth_api, client_api, client_ui, files_api

    app.register_blueprint(auth_api.bp)
    app.register_blueprint(admin_api.bp)
    app.register_blueprint(files_api.bp)
    app.register_blueprint(client_api.bp)
    app.register_blueprint(admin_ui.bp)
    app.register_blueprint(client_ui.bp)

    from .cli import register_cli

    register_cli(app)
    _register_errors(app)

    @app.after_request
    def _security_headers(res):
        res.headers.setdefault("X-Content-Type-Options", "nosniff")
        return res

    return app


def _register_errors(app: Flask) -> None:
    @app.errorhandler(HttpError)
    def _http_error(e: HttpError):
        return json_response({"error": e.message}, e.status)

    @app.errorhandler(HTTPException)
    def _werkzeug(e: HTTPException):
        # Unknown browser pages land on the staff admin. Preserve real route
        # errors and missing API/media resources instead of returning HTML.
        namespace = request.path.strip("/").split("/", 1)[0]
        if (
            e.code == 404
            and request.method in ("GET", "HEAD")
            and request.url_rule is None
            and namespace not in {"api", "f", "zip", "admin"}
        ):
            return redirect("/admin", code=302)
        if request.path.startswith("/api/"):
            msg = "Upload part too large" if e.code == 413 else (e.description or e.name)
            return json_response({"error": msg}, e.code or 500)
        return e

    @app.errorhandler(Exception)
    def _unexpected(e: Exception):
        log.exception("unhandled error on %s %s", request.method, request.path)
        # the original sent the raw error message; in production only a generic one goes out
        msg = "Server error" if app.config.get("PRODUCTION") else (str(e) or "Server error")
        return json_response({"error": msg}, 500)


def _load_dotenv() -> None:
    """Loads backend/.env in development (real environment variables always win)."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.isfile(path):
        try:
            from dotenv import load_dotenv

            load_dotenv(path, override=False)
        except ImportError:  # pragma: no cover
            pass
