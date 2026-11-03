"""Tags on files (e.g. "CNY 2027", "approved", "IG story"), and an optional end date on client shares."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import VARCHAR

revision = "0007_tags_share_expiry"
down_revision = "0006_user_avatar"
branch_labels = None
depends_on = None

BIN = "utf8mb4_bin"
ARGS = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}


def upgrade():
    op.create_table(
        "tags",
        sa.Column("id", VARCHAR(64, collation=BIN), primary_key=True),
        sa.Column("name", VARCHAR(60), nullable=False),
        sa.Column("color", VARCHAR(16, collation=BIN), nullable=True),
        sa.Column("created_at", sa.BigInteger, nullable=False),
        sa.Column("created_by", VARCHAR(100), nullable=True),
        sa.UniqueConstraint("name", name="tags_name"),
        **ARGS,
    )
    op.create_table(
        "item_tags",
        sa.Column("item_id", VARCHAR(64, collation=BIN), sa.ForeignKey("items.id", name="fk_item_tags_item", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", VARCHAR(64, collation=BIN), sa.ForeignKey("tags.id", name="fk_item_tags_tag", ondelete="CASCADE"), primary_key=True),
        sa.Index("item_tags_tag", "tag_id"),
        **ARGS,
    )
    # null = no end date; after it, the client no longer sees what was shared
    op.add_column("client_shares", sa.Column("expires_at", sa.BigInteger, nullable=True))


def downgrade():
    op.drop_column("client_shares", "expires_at")
    op.drop_table("item_tags")
    op.drop_table("tags")
