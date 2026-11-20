"""Shortcuts: a file can also appear in other folders (item_links), with no copy of the file itself."""
from alembic import op
import sqlalchemy as sa

revision = "0011_item_links"
down_revision = "0010_folder_access"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "item_links",
        sa.Column("folder_id", sa.String(64, collation="utf8mb4_bin"), nullable=False),
        sa.Column("item_id", sa.String(64, collation="utf8mb4_bin"), nullable=False),
        sa.Column("created_at", sa.BigInteger, nullable=False),
        sa.Column("created_by", sa.String(100), nullable=True),
        sa.PrimaryKeyConstraint("folder_id", "item_id"),
        mysql_charset="utf8mb4",
    )
    op.create_index("item_links_item", "item_links", ["item_id"])


def downgrade():
    op.drop_table("item_links")
