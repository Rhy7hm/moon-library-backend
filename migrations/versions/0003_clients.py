"""Clients, and what is shared with each of them (folders, single files, links)."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import VARCHAR

revision = "0003_clients"
down_revision = "0002_folder_visibility"
branch_labels = None
depends_on = None

BIN = "utf8mb4_bin"
ARGS = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}


def upgrade():
    op.create_table(
        "clients",
        sa.Column("id", VARCHAR(64, collation=BIN), primary_key=True),
        sa.Column("name", VARCHAR(200), nullable=False),
        sa.Column("email", VARCHAR(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("color", VARCHAR(16), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("created_by", VARCHAR(100), nullable=True),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        **ARGS,
    )
    op.create_table(
        "client_shares",
        sa.Column("id", VARCHAR(64, collation=BIN), primary_key=True),
        sa.Column("client_id", VARCHAR(64, collation=BIN), sa.ForeignKey("clients.id", name="fk_shares_client", ondelete="CASCADE"), nullable=False),
        # folder (live: includes everything inside it, now and later), item (one file card) or link
        sa.Column("kind", VARCHAR(16, collation=BIN), nullable=False),
        sa.Column("target_id", VARCHAR(64, collation=BIN), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("title", VARCHAR(300), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("created_by", VARCHAR(100), nullable=True),
        sa.Index("shares_client", "client_id", "created_at"),
        sa.Index("shares_target", "kind", "target_id"),
        **ARGS,
    )


def downgrade():
    op.drop_table("client_shares")
    op.drop_table("clients")
