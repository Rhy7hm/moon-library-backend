"""Client profile picture (avatar) stored in R2."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.mysql import VARCHAR

revision = "0005_client_avatar"
down_revision = "0004_client_logins"
branch_labels = None
depends_on = None

BIN = "utf8mb4_bin"


def upgrade():
    op.add_column("clients", sa.Column("avatar_key", VARCHAR(512, collation=BIN), nullable=True))


def downgrade():
    op.drop_column("clients", "avatar_key")
