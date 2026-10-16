"""holds queue and the activity audit trail

Revision ID: 0003_holds_activity
Revises: 0002_members_loans
Create Date: 2026-10-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_holds_activity"
down_revision: str | None = "0002_members_loans"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "holds",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("book_id", sa.Integer, sa.ForeignKey("books.id"), nullable=False),
        sa.Column("member_id", sa.Integer, sa.ForeignKey("members.id"), nullable=False),
        sa.Column("copy_id", sa.Integer, sa.ForeignKey("copies.id")),
        sa.Column("status", sa.String(10), nullable=False, server_default="waiting"),
        sa.Column("placed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('waiting', 'ready', 'fulfilled', 'cancelled', 'expired')",
            name="ck_holds_status",
        ),
        sa.CheckConstraint(
            "status <> 'ready' OR (copy_id IS NOT NULL AND expires_at IS NOT NULL)",
            name="ck_holds_ready_has_copy",
        ),
    )
    op.create_index(
        "uq_holds_one_open_per_member_book",
        "holds",
        ["member_id", "book_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('waiting', 'ready')"),
        sqlite_where=sa.text("status IN ('waiting', 'ready')"),
    )
    op.create_index(
        "uq_holds_one_ready_per_copy",
        "holds",
        ["copy_id"],
        unique=True,
        postgresql_where=sa.text("status = 'ready'"),
        sqlite_where=sa.text("status = 'ready'"),
    )
    op.create_index("ix_holds_book_status", "holds", ["book_id", "status", "placed_at"])

    op.create_table(
        "activity",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("message", sa.String(300), nullable=False),
        sa.Column("book_id", sa.Integer),
        sa.Column("member_id", sa.Integer),
        sa.Column("loan_id", sa.Integer),
    )
    op.create_index("ix_activity_at", "activity", ["at"])


def downgrade() -> None:
    op.drop_index("ix_activity_at", table_name="activity")
    op.drop_table("activity")
    op.drop_index("ix_holds_book_status", table_name="holds")
    op.drop_index("uq_holds_one_ready_per_copy", table_name="holds")
    op.drop_index("uq_holds_one_open_per_member_book", table_name="holds")
    op.drop_table("holds")
