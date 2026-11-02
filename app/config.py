"""
Settings, all read from environment variables (a local `.env` file is loaded in development).

Nothing secret is ever sent to the browser: the admin panel only talks to this server's API.
"""
from __future__ import annotations

import os

from sqlalchemy.engine import URL


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None:
        return default
    v = v.strip()
    return v if v != "" else default


def _int(name: str, default: int) -> int:
    v = _env(name)
    try:
        return int(v) if v is not None else default
    except ValueError:
        raise RuntimeError(f"{name} must be a whole number") from None


def _bool(name: str, default: bool = False) -> bool:
    v = _env(name)
    if v is None:
        return default
    return v.lower() in ("1", "true", "yes", "on")


def database_url() -> URL:
    """
    Built with URL.create, so any character in the password (@ : / # % …) works without escaping.
    DATABASE_URL may be given instead of the DB_* parts (used by the tests).
    """
    raw = _env("DATABASE_URL")
    if raw:
        from sqlalchemy.engine import make_url

        return make_url(raw)
    return URL.create(
        "mysql+pymysql",
        username=_env("DB_USER", "moon_library"),
        password=os.environ.get("DB_PASSWORD", ""),  # not stripped: spaces may be part of a password
        host=_env("DB_HOST", "127.0.0.1"),
        port=_int("DB_PORT", 3306),
        database=_env("DB_NAME", "moon_library"),
        query={"charset": "utf8mb4"},
    )


# databases and buckets that belong to the M2 Material Library
M2_DATABASES = {"m2library", "m2analytics", "m2win-api"}
M2_BUCKETS = {"m2-library", "m2win"}


def _refuse_m2_resources(db_url: URL, bucket: str | None) -> None:
    name = (db_url.database or "").lower()
    if name in M2_DATABASES:
        raise RuntimeError(f"DB_NAME / DATABASE_URL points at the M2 database '{db_url.database}'. Use this project's own database.")
    if (bucket or "").lower() in M2_BUCKETS:
        raise RuntimeError(f"R2_BUCKET_NAME is the M2 bucket '{bucket}'. Use this project's own bucket.")


class Config:
    def __init__(self) -> None:
        self.APP_ENV = (_env("APP_ENV", "production") or "production").lower()
        self.PRODUCTION = self.APP_ENV == "production"
        self.TESTING = self.APP_ENV == "test"

        secret = _env("SECRET_KEY")
        if not secret:
            if self.PRODUCTION:
                raise RuntimeError("SECRET_KEY must be set in production")
            secret = "dev-only-not-secret"
        self.SECRET_KEY = secret

        # database
        self.SQLALCHEMY_DATABASE_URI = database_url()
        self.SQLALCHEMY_ENGINE_OPTIONS = {
            "pool_pre_ping": True,
            "pool_recycle": 280,
            "pool_size": _int("DB_POOL_SIZE", 5),
            "max_overflow": _int("DB_MAX_OVERFLOW", 10),
        }
        self.SQLALCHEMY_TRACK_MODIFICATIONS = False

        # file storage: Cloudflare R2 through its S3 API
        self.R2_ENDPOINT_URL = _env("R2_ENDPOINT_URL")
        self.R2_ACCESS_KEY_ID = _env("R2_ACCESS_KEY_ID")
        self.R2_SECRET_ACCESS_KEY = _env("R2_SECRET_ACCESS_KEY")
        self.R2_BUCKET_NAME = _env("R2_BUCKET_NAME", "moon-library")
        self.R2_REGION = _env("R2_REGION", "auto")
        # optional public R2 domain, e.g. https://files.example.com (empty = files go through /f/…)
        self.ASSET_BASE = _env("ASSET_BASE", "") or ""

        # never point this project at the M2 library's data (it was forked from it)
        _refuse_m2_resources(self.SQLALCHEMY_DATABASE_URI, self.R2_BUCKET_NAME)

        # accounts
        self.SESSION_COOKIE = _env("SESSION_COOKIE", "moonlib_session")
        self.CLIENT_SESSION_COOKIE = _env("CLIENT_SESSION_COOKIE", "moonlib_client")
        self.SETUP_KEY = _env("SETUP_KEY")
        # development only: the first Owner can be created without SETUP_KEY (the old ADMIN_AUTH=off)
        self.ALLOW_SETUP_WITHOUT_KEY = _bool("ALLOW_SETUP_WITHOUT_KEY") and not self.PRODUCTION
        self.ADMIN_API_TOKEN = _env("ADMIN_API_TOKEN")
        # Secure cookies: always in production; elsewhere when the request came over https
        self.COOKIE_SECURE_ALWAYS = self.PRODUCTION or _bool("COOKIE_SECURE")
        # other origins allowed to send changes (e.g. the Vite dev server when it doesn't forward the host)
        self.ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in (_env("ALLOWED_ORIGINS", "") or "").split(",") if o.strip()]
        # how many reverse proxies (nginx, CloudPanel) sit in front: their X-Forwarded-* headers are trusted
        self.TRUST_PROXY_HOPS = _int("TRUST_PROXY_HOPS", 1 if self.PRODUCTION else 0)


        # Google Drive backup (off unless both are set)
        self.GDRIVE_FOLDER_ID = _env("GDRIVE_FOLDER_ID")
        sa = _env("GDRIVE_SA_JSON")
        sa_file = _env("GDRIVE_SA_FILE")
        if not sa and sa_file:
            try:
                with open(sa_file, encoding="utf-8") as f:
                    sa = f.read().strip()
            except OSError as e:
                sa = None
                self.GDRIVE_SA_FILE_ERROR = f"GDRIVE_SA_FILE can't be read: {e}"
        self.GDRIVE_SA_JSON = sa
        # tests only: a pretend Drive API / sign-in address
        self.GDRIVE_API = _env("GDRIVE_API")
        self.GDRIVE_TOKEN_URL = _env("GDRIVE_TOKEN_URL")

        # uploads: the admin panel sends at most 20 MB in one piece, or 10 MB parts
        self.MAX_UPLOAD_BODY = 95 * 1024 * 1024
        self.MAX_CONTENT_LENGTH = 96 * 1024 * 1024
        # the built admin panel (npm run build in admin/)
        self.ADMIN_DIST = _env("ADMIN_DIST") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "admin", "dist")

    def as_dict(self) -> dict:
        return {k: getattr(self, k) for k in dir(self) if k.isupper()}
