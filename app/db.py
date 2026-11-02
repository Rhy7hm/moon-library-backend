"""
Database access.

The original app used D1 (SQLite) with hand-written SQL, where every statement commits on its
own and `batch()` runs several statements in one transaction. This module keeps exactly that
behaviour on MySQL so the ported operations behave the same:

    q.all(sql, *args)      -> list of dict rows
    q.first(sql, *args)    -> dict or None
    q.run(sql, *args)      -> number of rows changed (own transaction)
    q.batch([(sql, args)]) -> all statements in one transaction

SQL is written with `?` placeholders (like the original); they are turned into bound parameters,
never pasted into the SQL text. Column names that are reserved words in MySQL (`key`, `before`)
are quoted with backticks in the SQL itself.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Iterable, Sequence

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event, text

from .models import metadata

db = SQLAlchemy(metadata=metadata)


def init_engine_events(engine) -> None:
    """Every connection works in UTC, so FROM_UNIXTIME / DATE_FORMAT give the same days as before."""
    if engine.dialect.name != "mysql":
        return

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_conn, _record):  # pragma: no cover - trivial
        cur = dbapi_conn.cursor()
        cur.execute("SET SESSION time_zone = '+00:00'")
        cur.close()


def _bind(sql: str, args: Sequence[Any]):
    parts = sql.split("?")
    if len(parts) - 1 != len(args):
        raise ValueError(f"SQL expects {len(parts) - 1} values, got {len(args)}: {sql[:120]}")
    out = [parts[0]]
    params: dict[str, Any] = {}
    for i, a in enumerate(args):
        name = f"p{i}"
        out.append(f":{name}")
        out.append(parts[i + 1])
        params[name] = a
    return text("".join(out)), params


def _clean(v: Any) -> Any:
    # SUM() / COUNT() come back as Decimal in MySQL; D1 gave plain numbers
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v


def _row(r) -> dict:
    return {k: _clean(v) for k, v in r._mapping.items()}


def in_list(n: int) -> str:
    return ",".join(["?"] * n)


class Q:
    """The query helper (see the module notes)."""

    @staticmethod
    def all(sql: str, *args: Any) -> list[dict]:
        stmt, params = _bind(sql, args)
        with db.engine.begin() as conn:
            return [_row(r) for r in conn.execute(stmt, params)]

    @staticmethod
    def first(sql: str, *args: Any) -> dict | None:
        stmt, params = _bind(sql, args)
        with db.engine.begin() as conn:
            r = conn.execute(stmt, params).first()
            return _row(r) if r is not None else None

    @staticmethod
    def run(sql: str, *args: Any) -> int:
        stmt, params = _bind(sql, args)
        with db.engine.begin() as conn:
            return conn.execute(stmt, params).rowcount

    @staticmethod
    def batch(statements: Iterable[tuple[str, Sequence[Any]]]) -> None:
        stmts = [_bind(s, a) for s, a in statements]
        if not stmts:
            return
        with db.engine.begin() as conn:
            for stmt, params in stmts:
                conn.execute(stmt, params)

    @staticmethod
    def transaction():
        """For the few places that need a row lock (SELECT … FOR UPDATE)."""
        return db.engine.begin()

    @staticmethod
    def exec(conn, sql: str, *args: Any):
        stmt, params = _bind(sql, args)
        return conn.execute(stmt, params)


q = Q()

UPSERT_SETTING = (
    "INSERT INTO settings (`key`, value, updated_at, updated_by) VALUES (?,?,?,?) "
    "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)"
)
