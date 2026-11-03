"""Removing a client moves it to the Trash (deleted_at); it's deleted for good from there."""
from alembic import op
import sqlalchemy as sa

revision = "0009_client_trash"
down_revision = "0008_client_home_folder"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("clients", sa.Column("deleted_at", sa.BigInteger, nullable=True))


def downgrade():
    op.drop_column("clients", "deleted_at")
