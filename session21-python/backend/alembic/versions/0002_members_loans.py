"""members and loans, with one active loan per copy enforced by the database

Revision ID: 0002_members_loans
Revises: 0001_catalogue
Create Date: 2026-10-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_members_loans"
down_revision: str | None = "0001_catalogue"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "members",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("member_type", sa.String(10), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email", name="uq_members_email"),
        sa.CheckConstraint("member_type IN ('student', 'faculty')", name="ck_members_type"),
    )
    op.create_table(
        "loans",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("copy_id", sa.Integer, sa.ForeignKey("copies.id"), nullable=False),
        sa.Column("member_id", sa.Integer, sa.ForeignKey("members.id"), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="active"),
        sa.Column("borrowed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("renewals", sa.Integer, nullable=False, server_default="0"),
        sa.Column("fine_amount", sa.Integer, nullable=False, server_default="0"),
        sa.Column("fine_paid_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('active', 'returned', 'lost')", name="ck_loans_status"),
        sa.CheckConstraint("renewals BETWEEN 0 AND 2", name="ck_loans_renewals"),
        sa.CheckConstraint("fine_amount >= 0", name="ck_loans_fine_not_negative"),
        sa.CheckConstraint("due_at > borrowed_at", name="ck_loans_due_after_borrow"),
        sa.CheckConstraint(
            "(status = 'active' AND closed_at IS NULL) OR (status <> 'active' AND closed_at IS NOT NULL)",
            name="ck_loans_closed_matches_status",
        ),
        sa.CheckConstraint("fine_paid_at IS NULL OR fine_amount > 0", name="ck_loans_paid_needs_fine"),
    )
    # The last line of defence against lending one copy twice.
    op.create_index(
        "uq_loans_one_active_per_copy",
        "loans",
        ["copy_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
        sqlite_where=sa.text("status = 'active'"),
    )
    op.create_index("ix_loans_member_status", "loans", ["member_id", "status"])
    op.create_index("ix_loans_status_due", "loans", ["status", "due_at"])


def downgrade() -> None:
    op.drop_index("ix_loans_status_due", table_name="loans")
    op.drop_index("ix_loans_member_status", table_name="loans")
    op.drop_index("uq_loans_one_active_per_copy", table_name="loans")
    op.drop_table("loans")
    op.drop_table("members")
