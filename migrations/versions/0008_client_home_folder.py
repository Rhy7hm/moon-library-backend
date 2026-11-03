"""Each client gets a home folder in the library (Clients › <client>), where their folders and inbox live."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import VARCHAR

revision = "0008_client_home_folder"
down_revision = "0007_tags_share_expiry"
branch_labels = None
depends_on = None

BIN = "utf8mb4_bin"


def upgrade():
    op.add_column("clients", sa.Column("home_folder_id", VARCHAR(64, collation=BIN), nullable=True))


def downgrade():
    op.drop_column("clients", "home_folder_id")
