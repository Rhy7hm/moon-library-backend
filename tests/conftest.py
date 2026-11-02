"""
Test set-up.

Needs a MySQL server (the same engine as production). The tests create and empty their own
database — its name must end in "_test" — given by TEST_DATABASE_URL, default:
    mysql+pymysql://root@127.0.0.1:3306/moon_library_test?charset=utf8mb4

R2 is replaced by moto's S3 server (in-process), Google Drive by tests/fake_drive.py.
Run:  pytest -q
"""
from __future__ import annotations

import json
import os
import sys

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEST_DB = os.environ.get("TEST_DATABASE_URL", "mysql+pymysql://root@127.0.0.1:3306/moon_library_test?charset=utf8mb4")
PASSWORD = "correct horse 1"


@pytest.fixture(scope="session")
def s3_server():
    from moto.server import ThreadedMotoServer

    server = ThreadedMotoServer(ip_address="127.0.0.1", port=0)
    server.start()
    host, port = server.get_host_and_port()
    url = f"http://{host}:{port}"
    import boto3

    boto3.client("s3", endpoint_url=url, aws_access_key_id="t", aws_secret_access_key="t", region_name="us-east-1").create_bucket(Bucket="moonlib-test")
    yield url
    server.stop()


@pytest.fixture(scope="session")
def sa_key():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    return {"type": "service_account", "client_email": "robot@moonlib-test.iam.gserviceaccount.com", "private_key": pem}


@pytest.fixture(scope="session")
def database():
    url = make_url(TEST_DB)
    assert url.database and url.database.endswith("_test"), "TEST_DATABASE_URL must point at a database whose name ends in _test"
    server = create_engine(url._replace(database=None))
    with server.begin() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS `{url.database}`"))
        c.execute(text(f"CREATE DATABASE `{url.database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
    server.dispose()
    return url


@pytest.fixture(scope="session")
def base_env(database, s3_server, sa_key):
    env = {
        "APP_ENV": "test",
        "SECRET_KEY": "test-secret",
        "DATABASE_URL": database.render_as_string(hide_password=False),
        "R2_ENDPOINT_URL": s3_server,
        "R2_ACCESS_KEY_ID": "t",
        "R2_SECRET_ACCESS_KEY": "t",
        "R2_BUCKET_NAME": "moonlib-test",
        "R2_REGION": "us-east-1",
        "ASSET_BASE": "",
        "SETUP_KEY": "setup-key-123",
        "ADMIN_API_TOKEN": "x" * 30,
        "TRUST_PROXY_HOPS": "0",
    }
    old = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    for k in ("GDRIVE_SA_JSON", "GDRIVE_FOLDER_ID", "GDRIVE_API", "GDRIVE_TOKEN_URL", "ALLOW_SETUP_WITHOUT_KEY", "GDRIVE_SA_FILE"):
        os.environ.pop(k, None)
    yield env
    for k, v in old.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


@pytest.fixture(scope="session")
def app(base_env):
    from flask_migrate import upgrade

    from app import create_app

    a = create_app()
    with a.app_context():
        upgrade()
    return a


@pytest.fixture(autouse=True)
def clean(app):
    """Every test starts with empty tables (only the default security setting)."""
    from app.db import db
    from app.models import ALL_TABLES

    with app.app_context():
        with db.engine.begin() as c:
            c.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
            for t in ALL_TABLES:
                c.execute(text(f"DELETE FROM `{t}`"))
            c.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
            c.execute(text("INSERT INTO settings (`key`, value, updated_at, updated_by) VALUES ('security', :v, 1, 'setup')"), {"v": '{"lockout":false}'})
        app.config["ALLOW_SETUP_WITHOUT_KEY"] = False
        app.config["COOKIE_SECURE_ALWAYS"] = False
        app.config["GDRIVE_SA_JSON"] = None
        app.config["GDRIVE_FOLDER_ID"] = None
        app.extensions.pop("moonlib_storage", None)
    yield


@pytest.fixture
def client(app):
    return app.test_client()


# ---------------------------------------------------------------- helpers

def make_user(app, username="owner1", role="owner", password=PASSWORD, name=None):
    from app.auth import hash_password
    from app.db import q
    from app.util import new_id, now

    with app.app_context():
        h = hash_password(password)
        uid = new_id()
        q.run(
            "INSERT INTO users (id,username,display_name,role,pass_hash,pass_salt,pass_iter,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            uid, username, name or username.title(), role, h["hash"], h["salt"], h["iter"], now(), now(),
        )
        return uid


def login(client, username="owner1", password=PASSWORD):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.get_json()
    return r


def op(client, name, body=None, status=200):
    r = client.post(f"/api/admin/{name}", json=body or {})
    assert r.status_code == status, (name, r.status_code, r.get_json())
    return r.get_json()


def upload(client, item_id, name, data: bytes, lang="en", langs=None, replaces=None, thumb=None, opt=None, touch=True, mime="image/png", kind="image"):
    """The browser's upload flow: file.create → PUT the bytes → file.ready."""
    j = op(client, "file.create", {"itemId": item_id, "lang": lang, "langs": langs, "kind": kind, "name": name, "mime": mime, "size": len(data), "width": 10, "height": 20, "hasThumb": thumb is not None, "hasOpt": opt is not None, "optMime": "image/webp" if opt else None})
    keys = j["keys"]
    if thumb is not None:
        assert client.put("/api/admin/upload", query_string={"key": keys["thumb"], "contentType": "image/webp"}, data=thumb).status_code == 200
    if opt is not None:
        assert client.put("/api/admin/upload", query_string={"key": keys["opt"], "contentType": "image/webp", "downloadName": "x.webp"}, data=opt).status_code == 200
    r = client.put("/api/admin/upload", query_string={"key": keys["orig"], "contentType": mime, "downloadName": name}, data=data)
    assert r.status_code == 200, r.get_json()
    body = {"id": j["id"], "touch": touch}
    if replaces:
        body["replaces"] = replaces
    ready = op(client, "file.ready", body)
    return j["id"], keys, ready


def ready_cards(app):
    """Cards outside the Trash that have at least one finished upload (what staff can use)."""
    from app.services.library import load_library

    with app.app_context():
        d = load_library(asset_base="")
    return {"items": [i for i in d["items"] if not i["deletedAt"] and any(v["status"] == "ready" for v in i["variants"])]}


def folder(client, name="Rebate", parent=None):
    return op(client, "folder.create", {"parentId": parent, "name": {"en": name}})["id"]


def item(client, folder_id, title="Daily Rebate"):
    return op(client, "item.create", {"folderId": folder_id, "title": {"en": title}})["id"]


def sql(app, query, *args):
    from app.db import q

    with app.app_context():
        return q.all(query, *args)


def run_sql(app, query, *args):
    from app.db import q

    with app.app_context():
        return q.run(query, *args)


@pytest.fixture
def owner(app, client):
    make_user(app)
    login(client)
    return client


@pytest.fixture
def drive(app, sa_key):
    from tests.fake_drive import FakeDrive

    fd = FakeDrive(sa_key["client_email"])
    app.config.update(GDRIVE_SA_JSON=json.dumps(sa_key), GDRIVE_FOLDER_ID="ROOT", GDRIVE_API=fd.url, GDRIVE_TOKEN_URL=fd.url + "/token")
    from app.drive import google

    google._tokens.clear()
    yield fd
    fd.close()
    app.config.update(GDRIVE_SA_JSON=None, GDRIVE_FOLDER_ID=None, GDRIVE_API=None, GDRIVE_TOKEN_URL=None)
