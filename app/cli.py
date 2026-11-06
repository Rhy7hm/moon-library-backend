"""
Command-line tasks (run with `flask --app wsgi <command>` from the backend folder):

  flask backup run [--budget 240]   one Google Drive backup run (Linux cron runs this every 5 minutes)
  flask backup status               the backup status as JSON
  flask cleanup                     empty Trash / old versions older than 90 days now
  flask create-owner                create the first Owner account (prompts for the password)
  flask create-superadmin           create the Super admin (prompts for the password); --promote ID makes an
                                    existing account the Super admin instead
"""
from __future__ import annotations

import json
import re
import sys

import click
from flask import Flask
from flask.cli import AppGroup


def register_cli(app: Flask) -> None:
    backup = AppGroup("backup", help="Google Drive backup.")

    @backup.command("run")
    @click.option("--budget", default=240, show_default=True, help="Seconds this run may take; the next run carries on.")
    def backup_run(budget: int):
        """One backup run. Safe to start while another runs: the second one just exits."""
        from .drive.backup import run_backup

        res = run_backup(budget_ms=max(10, budget) * 1000)
        click.echo(json.dumps(res, ensure_ascii=False))
        if res.get("error"):
            sys.exit(1)

    @backup.command("status")
    def backup_status_cmd():
        from .drive.backup import backup_status

        click.echo(json.dumps(backup_status(), ensure_ascii=False, indent=2))

    app.cli.add_command(backup)

    @app.cli.command("cleanup")
    def cleanup_cmd():
        """Empty the Trash and version history of things older than 90 days (normally done hourly by admin visits)."""
        from .services.activity import cleanup

        click.echo(json.dumps(cleanup(force=True)))

    @app.cli.command("create-owner")
    @click.option("--username", prompt="Sign-in ID (3–40 letters, numbers, . _ -)")
    @click.option("--name", prompt="Display name")
    @click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
    @click.option("--allow-existing", is_flag=True, help="Also allow it when accounts already exist.")
    def create_owner(username: str, name: str, password: str, allow_existing: bool):
        """Create an Owner account (the first-time setup without the web page)."""
        from .auth import check_password_rules, hash_password, new_user_id, write_log
        from .db import q
        from .util import HttpError, now

        username = username.strip().lower()
        if not re.fullmatch(r"[a-z0-9._-]{3,40}", username):
            raise click.ClickException("ID: 3–40 letters, numbers, dot, dash or underscore")
        try:
            check_password_rules(password)
        except HttpError as e:
            raise click.ClickException(e.message) from None
        n = q.first("SELECT COUNT(*) AS n FROM users")["n"]
        if n and not allow_existing:
            raise click.ClickException("Accounts already exist — sign in and add people in Users, or pass --allow-existing.")
        if q.first("SELECT id FROM users WHERE username = ?", username):
            raise click.ClickException("That ID is already taken")
        h = hash_password(password)
        uid = new_user_id()
        t = now()
        q.run(
            "INSERT INTO users (id,username,display_name,role,pass_hash,pass_salt,pass_iter,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            uid, username, (name.strip() or username)[:60], "owner", h["hash"], h["salt"], h["iter"], t, "cli", t,
        )
        write_log({"id": uid, "username": username}, {"kind": "security", "action": "user.setup", "summary": f"{name.strip() or username} created an Owner account (command line)"}, with_request=False)
        click.echo(f"Owner “{username}” created.")

    @app.cli.command("create-superadmin")
    @click.option("--promote", default=None, help="Make this existing account (its sign-in ID) the Super admin instead.")
    def create_superadmin(promote: str | None):
        """Create the Super admin — everything an Owner has, plus powers only she has. Only possible here, on the server."""
        from .auth import check_password_rules, hash_password, new_user_id, write_log
        from .db import q
        from .util import HttpError, now

        if promote:
            u = q.first("SELECT id, username, display_name FROM users WHERE username = ?", promote.strip().lower())
            if not u:
                raise click.ClickException("No account with that ID")
            q.run("UPDATE users SET role = 'superadmin', disabled = 0, updated_at = ? WHERE id = ?", now(), u["id"])
            write_log({"id": u["id"], "username": u["username"]}, {"kind": "security", "action": "user.superadmin", "summary": f"{u['display_name']} ({u['username']}) was made the Super admin (command line)"}, with_request=False)
            click.echo(f"“{u['username']}” is now the Super admin.")
            return
        username = click.prompt("Sign-in ID (3–40 letters, numbers, . _ -)").strip().lower()
        if not re.fullmatch(r"[a-z0-9._-]{3,40}", username):
            raise click.ClickException("ID: 3–40 letters, numbers, dot, dash or underscore")
        if q.first("SELECT id FROM users WHERE username = ?", username):
            raise click.ClickException("That ID is already taken (use --promote to make that account the Super admin)")
        name = click.prompt("Display name").strip() or username
        password = click.prompt("Password", hide_input=True, confirmation_prompt=True)
        try:
            check_password_rules(password)
        except HttpError as e:
            raise click.ClickException(e.message) from None
        h = hash_password(password)
        uid = new_user_id()
        t = now()
        q.run(
            "INSERT INTO users (id,username,display_name,role,pass_hash,pass_salt,pass_iter,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            uid, username, name[:60], "superadmin", h["hash"], h["salt"], h["iter"], t, "cli", t,
        )
        write_log({"id": uid, "username": username}, {"kind": "security", "action": "user.superadmin", "summary": f"{name} ({username}) was created as the Super admin (command line)"}, with_request=False)
        click.echo(f"Super admin “{username}” created. Sign in at /admin.")
