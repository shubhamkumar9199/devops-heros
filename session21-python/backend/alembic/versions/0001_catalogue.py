"""catalogue: books and their physical copies

Revision ID: 0001_catalogue
Revises:
Create Date: 2026-10-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_catalogue"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "books",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("isbn", sa.String(13), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("author", sa.String(120), nullable=False),
        sa.Column("genre", sa.String(40), nullable=False),
        sa.Column("published_year", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("isbn", name="uq_books_isbn"),
        sa.CheckConstraint("length(isbn) = 13", name="ck_books_isbn_13_digits"),
        sa.CheckConstraint(
            "published_year IS NULL OR published_year BETWEEN 1450 AND 2100",
            name="ck_books_published_year",
        ),
    )
    op.create_table(
        "copies",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("book_id", sa.Integer, sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False),
        sa.Column("barcode", sa.String(24), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="available"),
        sa.Column("condition", sa.String(10), nullable=False, server_default="good"),
        sa.Column("shelf", sa.String(20)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("barcode", name="uq_copies_barcode"),
        sa.CheckConstraint(
            "status IN ('available', 'on_loan', 'on_hold_shelf', 'lost', 'withdrawn')",
            name="ck_copies_status",
        ),
        sa.CheckConstraint("condition IN ('new', 'good', 'worn', 'damaged')", name="ck_copies_condition"),
    )
    op.create_index("ix_copies_book_id", "copies", ["book_id"])


def downgrade() -> None:
    op.drop_index("ix_copies_book_id", table_name="copies")
    op.drop_table("copies")
    op.drop_table("books")
