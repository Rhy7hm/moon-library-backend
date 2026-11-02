"""Client logins for the client website, their sessions, and each client's upload inbox folder."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import VARCHAR

revision = "0004_client_logins"
down_revision = "0003_clients"
branch_labels = None
depends_on = None

BIN = "utf8mb4_bin"
ARGS = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}


def upgrade():
    op.create_table(
        "client_users",
        sa.Column("id", VARCHAR(64, collation=BIN), primary_key=True),
        sa.Column("client_id", VARCHAR(64, collation=BIN), sa.ForeignKey("clients.id", name="fk_cusers_client", ondelete="CASCADE"), nullable=False),
        sa.Column("email", VARCHAR(255, collation=BIN), nullable=False, unique=True),
        sa.Column("name", VARCHAR(100), nullable=False),
        sa.Column("pass_hash", VARCHAR(255, collation=BIN), nullable=False),
        sa.Column("pass_salt", VARCHAR(255, collation=BIN), nullable=False),
        sa.Column("pass_iter", sa.Integer(), nullable=False),
        sa.Column("disabled", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.BigInteger(), nullable=True),
        sa.Column("last_login_at", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("created_by", VARCHAR(100), nullable=True),
        sa.Index("cusers_client", "client_id"),
        **ARGS,
    )
    op.create_table(
        "client_sessions",
        sa.Column("id", VARCHAR(64, collation=BIN), primary_key=True),  # SHA-256 of the cookie token
        sa.Column("client_user_id", VARCHAR(64, collation=BIN), sa.ForeignKey("client_users.id", name="fk_csessions_user", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("last_seen", sa.BigInteger(), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
        sa.Column("revoked_at", sa.BigInteger(), nullable=True),
        sa.Column("ip", VARCHAR(64), nullable=True),
        sa.Column("ua", VARCHAR(300), nullable=True),
        sa.Index("csessions_user", "client_user_id"),
        **ARGS,
    )
    # where the client's own uploads go (a normal library folder the team can open)
    op.add_column("clients", sa.Column("inbox_folder_id", VARCHAR(64, collation=BIN), nullable=True))


def downgrade():
    op.drop_column("clients", "inbox_folder_id")
    op.drop_table("client_sessions")
    op.drop_table("client_users")
