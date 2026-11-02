"""
Checks everything before the server starts, and asks for anything missing (saved to .env):

  1. .env exists            (created from .env.example if not)
  2. MySQL                  can we sign in? does the database exist? (offers to create it)
  3. Cloudflare R2          can we write to the bucket?
  4. Tables                 brings the database schema up to date

Run by start.sh; safe to run again at any time.
"""
from __future__ import annotations

import getpass
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.join(ROOT, ".env")

GREEN, RED, DIM, BOLD, END = "\033[32m", "\033[31m", "\033[2m", "\033[1m", "\033[0m"


def ok(msg):
    print(f"  {GREEN}✓{END} {msg}")


def bad(msg):
    print(f"  {RED}✗{END} {msg}")


def step(msg):
    print(f"\n{BOLD}{msg}{END}")


def ask(label, default=""):
    shown = f" [{default}]" if default else ""
    v = input(f"    {label}{shown}: ").strip()
    return v or default


def yes(label, default=True):
    v = input(f"    {label} [{'Y/n' if default else 'y/N'}]: ").strip().lower()
    return default if not v else v.startswith("y")


def read_env() -> dict:
    from dotenv import dotenv_values

    return {k: (v or "").strip() for k, v in dotenv_values(ENV).items()}


def save_env(changes: dict):
    """Updates (or adds) lines in .env, keeping everything else as it is."""
    lines = open(ENV, encoding="utf-8").read().splitlines() if os.path.exists(ENV) else []
    done = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if key in changes and not line.lstrip().startswith("#"):
            lines[i] = f"{key}={changes[key]}"
            done.add(key)
    lines += [f"{k}={v}" for k, v in changes.items() if k not in done]
    with open(ENV, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(ENV, 0o600)


# ---------------------------------------------------------------- 1. .env

def check_env_file():
    step("1/4  Settings (.env)")
    if not os.path.exists(ENV):
        shutil.copy(os.path.join(ROOT, ".env.example"), ENV)
        save_env({"APP_ENV": "development", "ALLOW_SETUP_WITHOUT_KEY": "1"})
        ok("Created .env from .env.example")
    else:
        ok(".env found")
    if read_env().get("APP_ENV") != "development" and not read_env().get("SECRET_KEY"):
        save_env({"APP_ENV": "development"})
        ok("Set APP_ENV=development (local computer)")


# ---------------------------------------------------------------- 2. MySQL

def check_mysql():
    import pymysql

    step("2/4  MySQL")
    for attempt in range(3):
        e = read_env()
        host, port = e.get("DB_HOST") or "127.0.0.1", int(e.get("DB_PORT") or 3306)
        user, pw, name = e.get("DB_USER") or "root", e.get("DB_PASSWORD", ""), e.get("DB_NAME") or "moon_library"
        try:
            conn = pymysql.connect(host=host, port=port, user=user, password=pw, connect_timeout=5)
        except pymysql.err.OperationalError as err:
            code = err.args[0]
            if code == 2003:
                bad(f"Can't reach MySQL at {host}:{port}. Is it running?  {DIM}(brew services start mysql){END}")
            elif code == 1045:
                bad(f"MySQL said the user or password is wrong for “{user}”.")
            else:
                bad(f"MySQL error: {err}")
            if attempt == 2 or not sys.stdin.isatty():
                return False
            print(f"    {DIM}Enter your MySQL details (press Enter to keep the value in brackets):{END}")
            new = {
                "DB_HOST": ask("Host", host),
                "DB_PORT": ask("Port", str(port)),
                "DB_USER": ask("User", user),
            }
            new["DB_PASSWORD"] = getpass.getpass("    Password (hidden): ")
            new["DB_NAME"] = ask("Database name", name)
            save_env(new)
            ok("Saved to .env")
            continue

        ok(f"Signed in to MySQL at {host}:{port} as {user}")
        with conn.cursor() as c:
            c.execute("SHOW DATABASES LIKE %s", (name,))
            exists = c.fetchone() is not None
            if not exists:
                bad(f"Database “{name}” doesn't exist yet.")
                if sys.stdin.isatty() and yes(f"Create “{name}” now?"):
                    c.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
                    ok(f"Created database “{name}”")
                else:
                    conn.close()
                    return False
            else:
                ok(f"Database “{name}” found")
        conn.close()
        return True
    return False


# ---------------------------------------------------------------- 3. R2

R2_KEYS = ["R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]


def check_r2():
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError

    step("3/4  Cloudflare R2 (file storage)")
    for attempt in range(2):
        e = read_env()
        missing = [k for k in R2_KEYS if not e.get(k) or "<" in e.get(k, "")]
        if missing:
            bad("Missing: " + ", ".join(missing))
            if attempt == 1 or not sys.stdin.isatty():
                return False
            print(f"    {DIM}From Cloudflare → R2 → your bucket → Settings (S3 API), and R2 → Manage API tokens:{END}")
            new = {}
            for k in missing:
                new[k] = getpass.getpass(f"    {k} (hidden): ") if "SECRET" in k else ask(k)
            new["R2_REGION"] = e.get("R2_REGION") or "auto"
            save_env(new)
            ok("Saved to .env")
            continue
        endpoint = e["R2_ENDPOINT_URL"].rstrip("/")
        bucket = e["R2_BUCKET_NAME"]
        if endpoint.endswith("/" + bucket):  # the S3 API address shown in Cloudflare includes the bucket
            endpoint = endpoint[: -len(bucket) - 1]
            save_env({"R2_ENDPOINT_URL": endpoint})
        try:
            s3 = boto3.client(
                "s3", endpoint_url=endpoint, aws_access_key_id=e["R2_ACCESS_KEY_ID"], aws_secret_access_key=e["R2_SECRET_ACCESS_KEY"],
                region_name=e.get("R2_REGION") or "auto", config=Config(signature_version="s3v4", connect_timeout=8, retries={"max_attempts": 1}),
            )
            s3.put_object(Bucket=bucket, Key="_moonlib-check", Body=b"ok")
            s3.delete_object(Bucket=bucket, Key="_moonlib-check")
            ok(f"Bucket “{bucket}” works (write + delete)")
            return True
        except (BotoCoreError, ClientError) as err:
            bad(f"Can't use bucket “{bucket}”: {err}")
            print(f"    {DIM}Check the keys have “Object Read & Write” on this bucket, then edit .env and start again.{END}")
            return False
    return False


# ---------------------------------------------------------------- 4. tables

def check_tables():
    step("4/4  Database tables")
    sys.path.insert(0, ROOT)
    os.chdir(ROOT)
    from flask_migrate import upgrade

    from app import create_app

    import logging

    app = create_app()
    logging.disable(logging.INFO)  # the migration tool's own log lines
    with app.app_context():
        upgrade()
        from app.db import q

        n = q.first("SELECT COUNT(*) AS n FROM users")["n"]
    logging.disable(logging.NOTSET)
    ok("Tables are up to date")
    return n


def main():
    print(f"{BOLD}Moon Library — checking your setup{END}")
    check_env_file()
    if not check_mysql():
        print(f"\n{RED}Stopped: MySQL isn't ready.{END} Fix the details in .env (DB_*), then run start.sh again.")
        sys.exit(1)
    if not check_r2():
        print(f"\n{RED}Stopped: R2 isn't ready.{END} Fix the R2_* lines in .env, then run start.sh again.")
        sys.exit(1)
    users = check_tables()
    if not users:
        print(f"\n  {DIM}No accounts yet — the first page will ask you to create the Owner account.{END}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
