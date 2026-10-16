"""Database tables. The CHECK constraints and partial unique indexes mirror the
migrations, so the database refuses bad rows even if a bug slips past the API."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    TypeDecorator,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app import clock
from app.db import Base


def _now() -> datetime:
    return clock.now()


class UTCDateTime(TypeDecorator):
    """Timezone-aware UTC datetimes on every backend (SQLite drops the offset)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime given to a UTC column")
        value = value.astimezone(UTC)
        return value.replace(tzinfo=None) if dialect.name == "sqlite" else value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class Book(Base):
    __tablename__ = "books"
    __table_args__ = (
        CheckConstraint("length(isbn) = 13", name="ck_books_isbn_13_digits"),
        CheckConstraint(
            "published_year IS NULL OR published_year BETWEEN 1450 AND 2100",
            name="ck_books_published_year",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    isbn: Mapped[str] = mapped_column(String(13), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    author: Mapped[str] = mapped_column(String(120))
    genre: Mapped[str] = mapped_column(String(40))
    published_year: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now)

    copies: Mapped[list[Copy]] = relationship(back_populates="book", cascade="all, delete-orphan", order_by="Copy.id")


class Copy(Base):
    __tablename__ = "copies"
    __table_args__ = (
        CheckConstraint(
            "status IN ('available', 'on_loan', 'on_hold_shelf', 'lost', 'withdrawn')",
            name="ck_copies_status",
        ),
        CheckConstraint("condition IN ('new', 'good', 'worn', 'damaged')", name="ck_copies_condition"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True)
    barcode: Mapped[str] = mapped_column(String(24), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="available")
    condition: Mapped[str] = mapped_column(String(10), default="good")
    shelf: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)

    book: Mapped[Book] = relationship(back_populates="copies")


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (CheckConstraint("member_type IN ('student', 'faculty')", name="ck_members_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    member_type: Mapped[str] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now)

    @property
    def card_number(self) -> str:
        return f"LIB-{self.id:05d}"


class Loan(Base):
    __tablename__ = "loans"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'returned', 'lost')", name="ck_loans_status"),
        CheckConstraint("renewals BETWEEN 0 AND 2", name="ck_loans_renewals"),
        CheckConstraint("fine_amount >= 0", name="ck_loans_fine_not_negative"),
        CheckConstraint("due_at > borrowed_at", name="ck_loans_due_after_borrow"),
        CheckConstraint(
            "(status = 'active' AND closed_at IS NULL) OR (status <> 'active' AND closed_at IS NOT NULL)",
            name="ck_loans_closed_matches_status",
        ),
        CheckConstraint("fine_paid_at IS NULL OR fine_amount > 0", name="ck_loans_paid_needs_fine"),
        # A copy can be on at most one active loan, whatever the API does.
        Index(
            "uq_loans_one_active_per_copy",
            "copy_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),
        ),
        Index("ix_loans_member_status", "member_id", "status"),
        Index("ix_loans_status_due", "status", "due_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    copy_id: Mapped[int] = mapped_column(ForeignKey("copies.id"))
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    status: Mapped[str] = mapped_column(String(10), default="active")
    borrowed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    due_at: Mapped[datetime] = mapped_column(UTCDateTime)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    renewals: Mapped[int] = mapped_column(Integer, default=0)
    fine_amount: Mapped[int] = mapped_column(Integer, default=0)
    fine_paid_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    copy: Mapped[Copy] = relationship()
    member: Mapped[Member] = relationship()


class Hold(Base):
    __tablename__ = "holds"
    __table_args__ = (
        CheckConstraint(
            "status IN ('waiting', 'ready', 'fulfilled', 'cancelled', 'expired')",
            name="ck_holds_status",
        ),
        CheckConstraint(
            "status <> 'ready' OR (copy_id IS NOT NULL AND expires_at IS NOT NULL)",
            name="ck_holds_ready_has_copy",
        ),
        # One open hold per member per book, and one ready hold per copy.
        Index(
            "uq_holds_one_open_per_member_book",
            "member_id",
            "book_id",
            unique=True,
            postgresql_where=text("status IN ('waiting', 'ready')"),
            sqlite_where=text("status IN ('waiting', 'ready')"),
        ),
        Index(
            "uq_holds_one_ready_per_copy",
            "copy_id",
            unique=True,
            postgresql_where=text("status = 'ready'"),
            sqlite_where=text("status = 'ready'"),
        ),
        Index("ix_holds_book_status", "book_id", "status", "placed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id"))
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"))
    copy_id: Mapped[int | None] = mapped_column(ForeignKey("copies.id"))
    status: Mapped[str] = mapped_column(String(10), default="waiting")
    placed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ready_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    book: Mapped[Book] = relationship()
    member: Mapped[Member] = relationship()
    copy: Mapped[Copy | None] = relationship()


class Activity(Base):
    """Audit trail: one row per change, shown as the dashboard's activity feed."""

    __tablename__ = "activity"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, index=True)
    kind: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(String(300))
    book_id: Mapped[int | None] = mapped_column(Integer)
    member_id: Mapped[int | None] = mapped_column(Integer)
    loan_id: Mapped[int | None] = mapped_column(Integer)
