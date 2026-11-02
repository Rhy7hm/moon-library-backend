"""Allow folders and their descendants to be hidden from the public library."""
from alembic import op
import sqlalchemy as sa

revision = "0002_folder_visibility"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("folders", sa.Column("hidden", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    op.drop_column("folders", "hidden")
