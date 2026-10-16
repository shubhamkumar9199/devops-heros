"""Request and response models. Validation that needs no database lives here;
rules that need the database live in services.py."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app import policy

Genre = Literal[policy.GENRES]
Condition = Literal[policy.COPY_CONDITIONS]
MemberType = Literal[policy.MEMBER_TYPES]
CopyStatus = Literal[policy.COPY_STATUSES]
LoanStatus = Literal[policy.LOAN_STATUSES]
HoldStatus = Literal[policy.HOLD_STATUSES]


def _isbn13_check_digit(first12: str) -> str:
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(first12))
    return str((10 - total % 10) % 10)


def normalize_isbn(raw: str) -> str:
    """Accept ISBN-10 or ISBN-13 (hyphens and spaces allowed) and return ISBN-13."""
    digits = raw.replace("-", "").replace(" ", "").upper()
    if len(digits) == 10:
        if not digits[:9].isdigit() or not (digits[9].isdigit() or digits[9] == "X"):
            raise ValueError("ISBN-10 must be 9 digits followed by a digit or X")
        total = sum((10 - i) * (10 if c == "X" else int(c)) for i, c in enumerate(digits))
        if total % 11:
            raise ValueError("ISBN-10 check digit does not match")
        core = "978" + digits[:9]
        return core + _isbn13_check_digit(core)
    if len(digits) == 13 and digits.isdigit():
        if digits[:3] not in ("978", "979"):
            raise ValueError("ISBN-13 must start with 978 or 979")
        if _isbn13_check_digit(digits[:12]) != digits[12]:
            raise ValueError("ISBN-13 check digit does not match")
        return digits
    raise ValueError("ISBN must have 10 or 13 digits")


class _Trimmed(BaseModel):
    @field_validator("*", mode="before")
    @classmethod
    def _strip_strings(cls, value):
        return value.strip() if isinstance(value, str) else value


# --- books and copies -------------------------------------------------------


class BookIn(_Trimmed):
    isbn: str = Field(examples=["0-13-235088-2"])
    title: str = Field(min_length=1, max_length=200)
    author: str = Field(min_length=1, max_length=120)
    genre: Genre
    published_year: int | None = Field(default=None, ge=1450, le=2100)

    @field_validator("isbn")
    @classmethod
    def _valid_isbn(cls, value: str) -> str:
        return normalize_isbn(value)


class BookCreate(BookIn):
    copies: int = Field(default=1, ge=0, le=20, description="Copies to put on the shelf")


class BookUpdate(BookIn):
    """PUT replaces every editable field."""


class CopyCreate(_Trimmed):
    condition: Condition = "good"
    shelf: str | None = Field(default=None, max_length=20)


class CopyUpdate(_Trimmed):
    condition: Condition
    shelf: str | None = Field(default=None, max_length=20)


class CopyOut(BaseModel):
    id: int
    book_id: int
    barcode: str
    status: CopyStatus
    condition: Condition
    shelf: str | None
    due_at: datetime | None = None
    reserved_for: str | None = None


class BookOut(BaseModel):
    id: int
    isbn: str
    title: str
    author: str
    genre: str
    published_year: int | None
    copies_total: int
    copies_available: int
    copies_on_loan: int
    holds_waiting: int
    created_at: datetime
    updated_at: datetime


class HoldOut(BaseModel):
    id: int
    status: HoldStatus
    book_id: int
    book_title: str
    member_id: int
    member_name: str
    card_number: str
    position: int | None
    copy_barcode: str | None
    placed_at: datetime
    ready_at: datetime | None
    expires_at: datetime | None
    closed_at: datetime | None


class BookDetail(BookOut):
    copies: list[CopyOut]
    queue: list[HoldOut]


# --- members ----------------------------------------------------------------


class MemberIn(_Trimmed):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    member_type: MemberType

    @field_validator("email")
    @classmethod
    def _lowercase(cls, value: str) -> str:
        return value.lower()


class MemberOut(BaseModel):
    id: int
    card_number: str
    name: str
    email: str
    member_type: MemberType
    is_active: bool
    loans_active: int
    loans_overdue: int
    max_loans: int
    fines_outstanding: int
    can_borrow: bool
    blocked_reason: str | None
    created_at: datetime


# --- loans ------------------------------------------------------------------


class LoanCreate(BaseModel):
    member_id: int
    book_id: int
    copy_id: int | None = Field(default=None, description="Lend this exact copy")


class LoanOut(BaseModel):
    id: int
    status: LoanStatus
    book_id: int
    book_title: str
    copy_id: int
    barcode: str
    member_id: int
    member_name: str
    card_number: str
    borrowed_at: datetime
    due_at: datetime
    closed_at: datetime | None
    renewals: int
    renewals_left: int
    is_overdue: bool
    days_overdue: int
    fine_amount: int = Field(description="Final fine once closed; fine so far while active")
    fine_paid: bool


class MemberDetail(MemberOut):
    loans: list[LoanOut]
    holds: list[HoldOut]


class HoldCreate(BaseModel):
    member_id: int
    book_id: int


# --- dashboard --------------------------------------------------------------


class Stats(BaseModel):
    books: int
    copies: int
    copies_by_status: dict[str, int]
    members_active: int
    loans_active: int
    loans_overdue: int
    holds_waiting: int
    holds_ready: int
    fines_outstanding: int
    loans_today: int
    returns_today: int


class ActivityOut(BaseModel):
    id: int
    at: datetime
    kind: str
    message: str
    book_id: int | None
    member_id: int | None
    loan_id: int | None


class Info(BaseModel):
    app: str
    version: str
    pod: str
    server_time: datetime
    timezone: str
    policy: dict
