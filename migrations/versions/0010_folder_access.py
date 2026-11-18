"""Folders can be limited to chosen people: folders.restricted, and who may open them in folder_access."""
from alembic import op
import sqlalchemy as sa

revision = "0010_folder_access"
down_revision = "0009_client_trash"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("folders", sa.Column("restricted", sa.Integer, nullable=False, server_default="0"))
    op.create_table(
        "folder_access",
        sa.Column("folder_id", sa.String(64, collation="utf8mb4_bin"), nullable=False),
        sa.Column("user_id", sa.String(64, collation="utf8mb4_bin"), nullable=False),
        sa.PrimaryKeyConstraint("folder_id", "user_id"),
        mysql_charset="utf8mb4",
    )
    op.create_index("folder_access_user", "folder_access", ["user_id"])


def downgrade():
    op.drop_table("folder_access")
    op.drop_column("folders", "restricted")
