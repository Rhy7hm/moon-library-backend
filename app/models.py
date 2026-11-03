"""
The MySQL schema (the same tables and columns as the D1 migrations 0001–0015).

Notes on the translation from SQLite:
  * ids, storage keys, slugs, user IDs, language codes and setting keys use utf8mb4_bin, so they
    compare exactly (case-sensitive) like SQLite did; everything else uses utf8mb4_unicode_ci.
  * timestamps stay BIGINT milliseconds; REAL → DOUBLE; JSON text → TEXT / MEDIUMTEXT.
  * `key` (settings, drive_state) and `before` (audit_log) are reserved words in MySQL and are
    always written with backticks in SQL.
  * folders.sort is BIGINT: moving a folder sets its sort to the current time in ms.

The Alembic migration in migrations/versions is what actually creates these tables; this file is
the reference for `flask db migrate` (autogenerate) when the schema changes later.
"""
from sqlalchemy import BigInteger, Column, ForeignKey, Index, Integer, MetaData, PrimaryKeyConstraint, Table, Text
from sqlalchemy.dialects.mysql import DOUBLE, MEDIUMTEXT, VARCHAR

metadata = MetaData()

BIN = "utf8mb4_bin"


def KEY():
    return VARCHAR(512, collation=BIN)


TABLE_ARGS = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}

folders = Table(
    "folders",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("parent_id", VARCHAR(64, collation=BIN), ForeignKey("folders.id", name="fk_folders_parent"), nullable=True),
    Column("slug", VARCHAR(100, collation=BIN), nullable=False),
    Column("name", Text, nullable=False),
    Column("sort", BigInteger, nullable=False, server_default="0"),
    Column("cover_item_id", VARCHAR(64, collation=BIN), nullable=True),
    Column("created_at", BigInteger, nullable=False),
    Column("updated_at", BigInteger, nullable=False),
    Column("deleted_at", BigInteger, nullable=True),
    Column("icon", MEDIUMTEXT, nullable=True),
    Column("icon_bg", VARCHAR(16), nullable=True),
    Column("icon_fg", VARCHAR(16), nullable=True),
    # 1 = hidden from the library page, with everything inside (D1 migration 0015)
    Column("hidden", Integer, nullable=False, server_default="0"),
    Index("folders_parent", "parent_id", "sort"),
    **TABLE_ARGS,
)

items = Table(
    "items",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("folder_id", VARCHAR(64, collation=BIN), ForeignKey("folders.id", name="fk_items_folder"), nullable=False),
    Column("title", Text, nullable=False),
    Column("pinned", Integer, nullable=False, server_default="0"),
    Column("created_at", BigInteger, nullable=False),
    Column("updated_at", BigInteger, nullable=False),
    Column("created_by", VARCHAR(100), nullable=True),
    Column("deleted_at", BigInteger, nullable=True),
    Column("sort", DOUBLE(asdecimal=False), nullable=True),
    Column("status", VARCHAR(16, collation=BIN), nullable=False, server_default="live"),
    Column("publish_at", BigInteger, nullable=True),
    Column("hide_at", BigInteger, nullable=True),
    Index("items_folder", "folder_id", "created_at"),
    **TABLE_ARGS,
)


def _file_columns():
    return [
        Column("lang", VARCHAR(8, collation=BIN), nullable=False),
        Column("extra_langs", VARCHAR(255, collation=BIN), nullable=True),
        Column("kind", VARCHAR(16, collation=BIN), nullable=False),
        Column("name", VARCHAR(255), nullable=False),
        Column("mime", VARCHAR(255), nullable=False),
        Column("size", BigInteger, nullable=False),
        Column("width", Integer, nullable=True),
        Column("height", Integer, nullable=True),
        Column("duration", DOUBLE(asdecimal=False), nullable=True),
        Column("key_orig", KEY(), nullable=False),
        Column("key_opt", KEY(), nullable=True),
        Column("opt_mime", VARCHAR(255), nullable=True),
        Column("opt_size", BigInteger, nullable=True),
        Column("key_thumb", KEY(), nullable=True),
        Column("key_poster", KEY(), nullable=True),
        Column("caption", Text, nullable=True),
        Column("focus_y", DOUBLE(asdecimal=False), nullable=True),
        Column("created_at", BigInteger, nullable=False),
    ]


files = Table(
    "files",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("item_id", VARCHAR(64, collation=BIN), ForeignKey("items.id", name="fk_files_item"), nullable=False),
    *_file_columns(),
    Column("status", VARCHAR(16, collation=BIN), nullable=False, server_default="uploading"),
    Column("updated_at", BigInteger, nullable=False),
    Index("files_item", "item_id"),
    Index("files_key_orig", "key_orig"),
    Index("files_key_opt", "key_opt"),
    Index("files_key_thumb", "key_thumb"),
    Index("files_key_poster", "key_poster"),
    **TABLE_ARGS,
)

file_versions = Table(
    "file_versions",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("file_id", VARCHAR(64, collation=BIN), nullable=False),
    Column("item_id", VARCHAR(64, collation=BIN), nullable=False),
    Column("reason", VARCHAR(16, collation=BIN), nullable=False),
    *_file_columns(),
    Column("replaced_at", BigInteger, nullable=False),
    Column("replaced_by", VARCHAR(100), nullable=True),
    Index("versions_item", "item_id"),
    Index("versions_file", "file_id"),
    Index("versions_key_orig", "key_orig"),
    Index("versions_key_thumb", "key_thumb"),
    Index("versions_replaced", "replaced_at"),
    **TABLE_ARGS,
)

users = Table(
    "users",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("username", VARCHAR(64, collation=BIN), nullable=False, unique=True),
    Column("display_name", VARCHAR(100), nullable=False),
    Column("role", VARCHAR(16, collation=BIN), nullable=False),
    Column("pass_hash", VARCHAR(255, collation=BIN), nullable=False),
    Column("pass_salt", VARCHAR(255, collation=BIN), nullable=False),
    Column("pass_iter", Integer, nullable=False),
    Column("disabled", Integer, nullable=False, server_default="0"),
    Column("failed_count", Integer, nullable=False, server_default="0"),
    Column("locked_until", BigInteger, nullable=True),
    Column("last_login_at", BigInteger, nullable=True),
    Column("created_at", BigInteger, nullable=False),
    Column("created_by", VARCHAR(100), nullable=True),
    Column("updated_at", BigInteger, nullable=False),
    Column("ui_lang", VARCHAR(8, collation=BIN), nullable=True),
    Column("avatar_key", VARCHAR(512, collation=BIN), nullable=True),  # R2 key for profile photo (u/…)
    **TABLE_ARGS,
)

sessions = Table(
    "sessions",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),  # SHA-256 (hex) of the cookie token
    Column("user_id", VARCHAR(64, collation=BIN), ForeignKey("users.id", name="fk_sessions_user"), nullable=False),
    Column("created_at", BigInteger, nullable=False),
    Column("last_seen", BigInteger, nullable=False),
    Column("expires_at", BigInteger, nullable=False),
    Column("ip", VARCHAR(64), nullable=True),
    Column("ua", VARCHAR(300), nullable=True),
    Column("revoked_at", BigInteger, nullable=True),
    Index("sessions_user", "user_id"),
    **TABLE_ARGS,
)

audit_log = Table(
    "audit_log",
    metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("at", BigInteger, nullable=False),
    Column("user_id", VARCHAR(64, collation=BIN), nullable=True),
    Column("username", VARCHAR(100), nullable=True),
    Column("kind", VARCHAR(16, collation=BIN), nullable=False),
    Column("action", VARCHAR(64, collation=BIN), nullable=False),
    Column("summary", Text, nullable=False),
    Column("target_type", VARCHAR(16, collation=BIN), nullable=True),
    Column("target_ids", MEDIUMTEXT, nullable=True),
    Column("folder_id", VARCHAR(64, collation=BIN), nullable=True),
    Column("before", MEDIUMTEXT, nullable=True),
    Column("detail", MEDIUMTEXT, nullable=True),
    Column("ip", VARCHAR(64), nullable=True),
    Column("ua", VARCHAR(300), nullable=True),
    Column("undone_at", BigInteger, nullable=True),
    Column("undone_by", VARCHAR(100), nullable=True),
    Index("audit_at", "at"),
    Index("audit_user", "user_id", "at"),
    Index("audit_action_ip", "action", "ip", "at"),
    Index("audit_kind", "kind", "id"),
    **TABLE_ARGS,
)

usage_daily = Table(
    "usage_daily",
    metadata,
    Column("day", VARCHAR(10, collation=BIN), nullable=False),  # YYYY-MM-DD (UTC+8)
    Column("item_id", VARCHAR(64, collation=BIN), nullable=False),
    Column("lang", VARCHAR(8, collation=BIN), nullable=False),
    Column("kind", VARCHAR(16, collation=BIN), nullable=False),
    Column("device", VARCHAR(16, collation=BIN), nullable=False),
    Column("n", Integer, nullable=False, server_default="0"),
    PrimaryKeyConstraint("day", "item_id", "lang", "kind", "device", name="pk_usage_daily"),
    **TABLE_ARGS,
)

settings = Table(
    "settings",
    metadata,
    Column("key", VARCHAR(64, collation=BIN), primary_key=True),
    Column("value", MEDIUMTEXT, nullable=False),
    Column("updated_at", BigInteger, nullable=False),
    Column("updated_by", VARCHAR(100), nullable=True),
    **TABLE_ARGS,
)

drive_folders = Table(
    "drive_folders",
    metadata,
    Column("folder_id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("drive_id", VARCHAR(128, collation=BIN), nullable=False),
    Column("name", VARCHAR(255), nullable=False),
    Column("parent_drive_id", VARCHAR(128, collation=BIN), nullable=False),
    Column("updated_at", BigInteger, nullable=False),
    **TABLE_ARGS,
)

drive_files = Table(
    "drive_files",
    metadata,
    Column("key_orig", KEY(), primary_key=True),
    Column("file_id", VARCHAR(64, collation=BIN), nullable=True),
    Column("state", VARCHAR(16, collation=BIN), nullable=False),
    Column("drive_id", VARCHAR(128, collation=BIN), nullable=True),
    Column("name", VARCHAR(255), nullable=True),
    Column("parent_drive_id", VARCHAR(128, collation=BIN), nullable=True),
    Column("size", BigInteger, nullable=True),
    Column("session_url", Text, nullable=True),
    Column("sent", BigInteger, nullable=False, server_default="0"),
    Column("attempts", Integer, nullable=False, server_default="0"),
    Column("next_try_at", BigInteger, nullable=True),
    Column("error", Text, nullable=True),
    Column("created_at", BigInteger, nullable=False),
    Column("updated_at", BigInteger, nullable=False),
    Index("drive_files_state", "state"),
    **TABLE_ARGS,
)

drive_state = Table(
    "drive_state",
    metadata,
    Column("key", VARCHAR(64, collation=BIN), primary_key=True),
    Column("value", Text, nullable=False),
    **TABLE_ARGS,
)

clients = Table(
    "clients",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("name", VARCHAR(200), nullable=False),
    Column("email", VARCHAR(255), nullable=True),
    Column("notes", Text, nullable=True),
    Column("color", VARCHAR(16), nullable=True),
    Column("avatar_key", VARCHAR(512, collation=BIN), nullable=True),  # R2 key for profile photo (c/…)
    Column("created_at", BigInteger, nullable=False),
    Column("created_by", VARCHAR(100), nullable=True),
    Column("updated_at", BigInteger, nullable=False),
    Column("inbox_folder_id", VARCHAR(64, collation=BIN), nullable=True),  # where the client's own uploads go
    Column("home_folder_id", VARCHAR(64, collation=BIN), nullable=True),  # Clients › <client> in the library
    **TABLE_ARGS,
)

client_shares = Table(
    "client_shares",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("client_id", VARCHAR(64, collation=BIN), ForeignKey("clients.id", name="fk_shares_client", ondelete="CASCADE"), nullable=False),
    Column("kind", VARCHAR(16, collation=BIN), nullable=False),  # folder | item | link
    Column("target_id", VARCHAR(64, collation=BIN), nullable=True),
    Column("url", Text, nullable=True),
    Column("title", VARCHAR(300), nullable=True),
    Column("created_at", BigInteger, nullable=False),
    Column("created_by", VARCHAR(100), nullable=True),
    Column("expires_at", BigInteger, nullable=True),  # null = no end date; after it the client no longer sees it
    Index("shares_client", "client_id", "created_at"),
    Index("shares_target", "kind", "target_id"),
    **TABLE_ARGS,
)

client_users = Table(
    "client_users",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("client_id", VARCHAR(64, collation=BIN), ForeignKey("clients.id", name="fk_cusers_client", ondelete="CASCADE"), nullable=False),
    Column("email", VARCHAR(255, collation=BIN), nullable=False, unique=True),
    Column("name", VARCHAR(100), nullable=False),
    Column("pass_hash", VARCHAR(255, collation=BIN), nullable=False),
    Column("pass_salt", VARCHAR(255, collation=BIN), nullable=False),
    Column("pass_iter", Integer, nullable=False),
    Column("disabled", Integer, nullable=False, server_default="0"),
    Column("failed_count", Integer, nullable=False, server_default="0"),
    Column("locked_until", BigInteger, nullable=True),
    Column("last_login_at", BigInteger, nullable=True),
    Column("created_at", BigInteger, nullable=False),
    Column("created_by", VARCHAR(100), nullable=True),
    Index("cusers_client", "client_id"),
    **TABLE_ARGS,
)

client_sessions = Table(
    "client_sessions",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("client_user_id", VARCHAR(64, collation=BIN), ForeignKey("client_users.id", name="fk_csessions_user", ondelete="CASCADE"), nullable=False),
    Column("created_at", BigInteger, nullable=False),
    Column("last_seen", BigInteger, nullable=False),
    Column("expires_at", BigInteger, nullable=False),
    Column("revoked_at", BigInteger, nullable=True),
    Column("ip", VARCHAR(64), nullable=True),
    Column("ua", VARCHAR(300), nullable=True),
    Index("csessions_user", "client_user_id"),
    **TABLE_ARGS,
)

# labels on files ("CNY 2027", "approved", "IG story"); a file can have several
tags = Table(
    "tags",
    metadata,
    Column("id", VARCHAR(64, collation=BIN), primary_key=True),
    Column("name", VARCHAR(60), nullable=False, unique=True),
    Column("color", VARCHAR(16, collation=BIN), nullable=True),
    Column("created_at", BigInteger, nullable=False),
    Column("created_by", VARCHAR(100), nullable=True),
    **TABLE_ARGS,
)

item_tags = Table(
    "item_tags",
    metadata,
    Column("item_id", VARCHAR(64, collation=BIN), ForeignKey("items.id", name="fk_item_tags_item", ondelete="CASCADE"), nullable=False),
    Column("tag_id", VARCHAR(64, collation=BIN), ForeignKey("tags.id", name="fk_item_tags_tag", ondelete="CASCADE"), nullable=False),
    PrimaryKeyConstraint("item_id", "tag_id"),
    Index("item_tags_tag", "tag_id"),
    **TABLE_ARGS,
)

ALL_TABLES = [
    "item_tags",
    "tags",
    "folders",
    "items",
    "files",
    "file_versions",
    "users",
    "sessions",
    "audit_log",
    "usage_daily",
    "settings",
    "drive_folders",
    "drive_files",
    "drive_state",
    "client_sessions",
    "client_users",
    "client_shares",
    "clients",
]
