"""Allow recurring projections to expire after their effective due date.

Revision ID: 097
Revises: 096
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "097"
down_revision: Union[str, None] = "096"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "recurring_transactions",
        sa.Column(
            "hide_projection_after_due",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_check_constraint(
        "ck_recurring_transactions_expiring_projection",
        "recurring_transactions",
        "NOT hide_projection_after_due OR NOT auto_generate",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_recurring_transactions_expiring_projection",
        "recurring_transactions",
        type_="check",
    )
    op.drop_column("recurring_transactions", "hide_projection_after_due")
