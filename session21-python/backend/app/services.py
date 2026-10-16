"""Lending rules.

Every write path locks the rows it decides on before it checks anything, so two
API replicas cannot both lend the last copy of a book or both let a student past
their loan limit. Locks are always taken in the same order to rule out
deadlocks: member, then book, then the loan / hold / copy rows of that book.
On SQLite (unit tests) FOR UPDATE is a no-op and requests are serialised anyway.
"""

from __future__ import annotations

import math
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app import clock, metrics, policy
from app.config import settings
from app.models import Activity, Book, Copy, Hold, Loan, Member
from app.schemas import BookCreate, BookUpdate, CopyCreate, CopyUpdate, MemberIn

DAY = timedelta(days=1)


class DomainError(Exception):
    """A request the rules refuse. Rendered as {"detail": message, "code": code}."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _not_found(kind: str, ident: int) -> DomainError:
    return DomainError(404, f"{kind}_not_found", f"{kind.capitalize()} {ident} does not exist")


def _conflict(code: str, message: str) -> DomainError:
    return DomainError(409, code, message)


# --- helpers ----------------------------------------------------------------


def _lock(db: Session, model, ident: int):
    stmt = select(model).where(model.id == ident).with_for_update().execution_options(populate_existing=True)
    return db.execute(stmt).scalar_one_or_none()


def _clash(db: Session, exc: IntegrityError) -> DomainError:
    db.rollback()
    error = _conflict("conflict", "The change clashes with data saved at the same moment; retry")
    error.__cause__ = exc
    return error


def _flush(db: Session) -> None:
    """Flush, turning a constraint violation (e.g. a race lost to another replica) into a 409."""
    try:
        db.flush()
    except IntegrityError as exc:
        raise _clash(db, exc) from exc


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        raise _clash(db, exc) from exc


def _log(db: Session, kind: str, message: str, at: datetime, **refs) -> None:
    db.add(Activity(at=at, kind=kind, message=message[:300], **refs))


def late_fine(due_at: datetime, at: datetime) -> int:
    if at <= due_at:
        return 0
    days = math.ceil((at - due_at) / DAY)
    return min(days * policy.FINE_PER_DAY, policy.FINE_CAP)


def _days_late(due_at: datetime, at: datetime) -> int:
    return math.ceil((at - due_at) / DAY) if at > due_at else 0


def outstanding_fines(db: Session, member_id: int) -> int:
    stmt = select(func.coalesce(func.sum(Loan.fine_amount), 0)).where(
        Loan.member_id == member_id, Loan.status != "active", Loan.fine_paid_at.is_(None)
    )
    return int(db.scalar(stmt) or 0)


def _active_loans(db: Session, member_id: int) -> list[Loan]:
    stmt = select(Loan).where(Loan.member_id == member_id, Loan.status == "active")
    return list(db.execute(stmt).scalars())


def _member_block(db: Session, member: Member, at: datetime) -> DomainError | None:
    """Why this member may not borrow, renew or place holds right now, if anything."""
    if not member.is_active:
        return _conflict("member_inactive", f"{member.name}'s membership is inactive")
    overdue = sum(1 for loan in _active_loans(db, member.id) if loan.due_at < at)
    if overdue:
        return _conflict("member_has_overdue", f"{member.name} has {overdue} overdue loan(s); return them first")
    owed = outstanding_fines(db, member.id)
    if owed >= policy.FINE_BLOCK_AT:
        return _conflict(
            "fines_unpaid", f"{member.name} owes ₹{owed} in fines; borrowing stops at ₹{policy.FINE_BLOCK_AT}"
        )
    return None


def _require_good_standing(db: Session, member: Member, at: datetime) -> None:
    block = _member_block(db, member, at)
    if block is not None:
        raise block


def _has_book(db: Session, member_id: int, book_id: int) -> bool:
    stmt = (
        select(Loan.id)
        .join(Copy, Loan.copy_id == Copy.id)
        .where(Loan.member_id == member_id, Loan.status == "active", Copy.book_id == book_id)
        .limit(1)
    )
    return db.scalar(stmt) is not None


def _open_hold(db: Session, member_id: int, book_id: int) -> Hold | None:
    stmt = select(Hold).where(
        Hold.member_id == member_id,
        Hold.book_id == book_id,
        Hold.status.in_(("waiting", "ready")),
    )
    return db.execute(stmt).scalar_one_or_none()


def _waiting_count(db: Session, book_id: int) -> int:
    stmt = select(func.count()).select_from(Hold).where(Hold.book_id == book_id, Hold.status == "waiting")
    return int(db.scalar(stmt) or 0)


def _release_copy(db: Session, copy: Copy, at: datetime) -> Hold | None:
    """A copy is free again (returned, new, or its hold lapsed). The first member
    waiting for the book gets it on the hold shelf; otherwise it goes back on the
    open shelf. The caller holds the book lock."""
    _flush(db)  # write the previous hold's closure before this copy is reassigned
    stmt = (
        select(Hold)
        .where(Hold.book_id == copy.book_id, Hold.status == "waiting")
        .order_by(Hold.placed_at, Hold.id)
        .limit(1)
    )
    nxt = db.execute(stmt).scalar_one_or_none()
    if nxt is None:
        copy.status = "available"
        return None
    nxt.status = "ready"
    nxt.copy_id = copy.id
    nxt.ready_at = at
    nxt.expires_at = at + timedelta(days=policy.HOLD_PICKUP_DAYS)
    copy.status = "on_hold_shelf"
    _log(
        db,
        "hold_ready",
        f"{copy.barcode} of “{copy.book.title}” is on the hold shelf for {nxt.member.name}",
        at,
        book_id=copy.book_id,
        member_id=nxt.member_id,
    )
    return nxt


def _expire_holds(db: Session, book_id: int, at: datetime) -> int:
    """Ready holds whose pickup window has passed lapse, and their copy moves on."""
    stmt = (
        select(Hold)
        .where(Hold.book_id == book_id, Hold.status == "ready", Hold.expires_at <= at)
        .order_by(Hold.expires_at, Hold.id)
    )
    expired = list(db.execute(stmt).scalars())
    for hold in expired:
        hold.status = "expired"
        hold.closed_at = at
        _log(
            db,
            "hold_expired",
            f"{hold.member.name}'s hold on “{hold.book.title}” lapsed uncollected",
            at,
            book_id=book_id,
            member_id=hold.member_id,
        )
        _release_copy(db, hold.copy, at)
    return len(expired)


def expire_all_holds(db: Session, at: datetime | None = None) -> int:
    """Sweep every book (run by the hold-expiry CronJob)."""
    at = at or clock.now()
    stmt = select(Hold.book_id).where(Hold.status == "ready", Hold.expires_at <= at).distinct()
    total = 0
    for book_id in list(db.execute(stmt).scalars()):
        _lock(db, Book, book_id)
        total += _expire_holds(db, book_id, at)
    _commit(db)
    return total


# --- books and copies -------------------------------------------------------


def _isbn_taken(db: Session, isbn: str, exclude_id: int | None = None) -> bool:
    stmt = select(Book.id).where(Book.isbn == isbn)
    if exclude_id is not None:
        stmt = stmt.where(Book.id != exclude_id)
    return db.scalar(stmt) is not None


def _new_copy(book: Book, ordinal: int, condition: str = "good", shelf: str | None = None) -> Copy:
    return Copy(
        book=book,
        barcode=f"SW{book.id:04d}-{ordinal:02d}",
        status="available",
        condition=condition,
        shelf=shelf,
    )


def create_book(db: Session, data: BookCreate) -> Book:
    at = clock.now()
    if _isbn_taken(db, data.isbn):
        raise _conflict("isbn_exists", f"A book with ISBN {data.isbn} is already in the catalogue")
    book = Book(**data.model_dump(exclude={"copies"}), created_at=at, updated_at=at)
    db.add(book)
    _flush(db)
    for ordinal in range(1, data.copies + 1):
        db.add(_new_copy(book, ordinal))
    _log(db, "book_added", f"“{book.title}” added with {data.copies} copies", at, book_id=book.id)
    _commit(db)
    return book


def update_book(db: Session, book_id: int, data: BookUpdate) -> Book:
    book = _lock(db, Book, book_id) or _raise(_not_found("book", book_id))
    if _isbn_taken(db, data.isbn, exclude_id=book.id):
        raise _conflict("isbn_exists", f"Another book already has ISBN {data.isbn}")
    for field, value in data.model_dump().items():
        setattr(book, field, value)
    _log(db, "book_updated", f"“{book.title}” details updated", clock.now(), book_id=book.id)
    _commit(db)
    return book


def delete_book(db: Session, book_id: int) -> None:
    book = _lock(db, Book, book_id) or _raise(_not_found("book", book_id))
    lent = db.scalar(select(Loan.id).join(Copy, Loan.copy_id == Copy.id).where(Copy.book_id == book.id).limit(1))
    held = db.scalar(select(Hold.id).where(Hold.book_id == book.id).limit(1))
    if lent is not None or held is not None:
        raise _conflict(
            "book_has_history",
            f"“{book.title}” has lending history and stays in the catalogue; withdraw its copies instead",
        )
    _log(db, "book_deleted", f"“{book.title}” removed from the catalogue", clock.now())
    db.delete(book)
    _commit(db)


def add_copy(db: Session, book_id: int, data: CopyCreate) -> Copy:
    at = clock.now()
    book = _lock(db, Book, book_id) or _raise(_not_found("book", book_id))
    ordinal = int(db.scalar(select(func.count()).select_from(Copy).where(Copy.book_id == book.id)) or 0) + 1
    copy = _new_copy(book, ordinal, data.condition, data.shelf)
    db.add(copy)
    _flush(db)
    hold = _release_copy(db, copy, at)
    where = f"the hold shelf for {hold.member.name}" if hold else "the shelf"
    _log(db, "copy_added", f"{copy.barcode} of “{book.title}” added to {where}", at, book_id=book.id)
    _commit(db)
    return copy


def update_copy(db: Session, copy_id: int, data: CopyUpdate) -> Copy:
    copy = _lock(db, Copy, copy_id) or _raise(_not_found("copy", copy_id))
    if copy.status == "withdrawn":
        raise _conflict("copy_withdrawn", f"{copy.barcode} has been withdrawn")
    copy.condition = data.condition
    copy.shelf = data.shelf
    _commit(db)
    return copy


def withdraw_copy(db: Session, copy_id: int) -> Copy:
    copy = db.get(Copy, copy_id) or _raise(_not_found("copy", copy_id))
    _lock(db, Book, copy.book_id)
    copy = _lock(db, Copy, copy_id)
    if copy.status == "on_loan":
        raise _conflict("copy_on_loan", f"{copy.barcode} is out on loan; it can be withdrawn once returned")
    if copy.status == "on_hold_shelf":
        raise _conflict("copy_reserved", f"{copy.barcode} is reserved for a member; cancel that hold first")
    if copy.status == "withdrawn":
        raise _conflict("copy_withdrawn", f"{copy.barcode} is already withdrawn")
    copy.status = "withdrawn"
    _log(db, "copy_withdrawn", f"{copy.barcode} of “{copy.book.title}” withdrawn", clock.now(), book_id=copy.book_id)
    _commit(db)
    return copy


# --- members ----------------------------------------------------------------


def _email_taken(db: Session, email: str, exclude_id: int | None = None) -> bool:
    stmt = select(Member.id).where(Member.email == email)
    if exclude_id is not None:
        stmt = stmt.where(Member.id != exclude_id)
    return db.scalar(stmt) is not None


def create_member(db: Session, data: MemberIn) -> Member:
    at = clock.now()
    if _email_taken(db, data.email):
        raise _conflict("email_exists", f"{data.email} is already registered")
    member = Member(**data.model_dump(), is_active=True, created_at=at, updated_at=at)
    db.add(member)
    _flush(db)
    joined = f"{member.name} joined as {member.member_type} ({member.card_number})"
    _log(db, "member_joined", joined, at, member_id=member.id)
    _commit(db)
    return member


def update_member(db: Session, member_id: int, data: MemberIn) -> Member:
    member = _lock(db, Member, member_id) or _raise(_not_found("member", member_id))
    if _email_taken(db, data.email, exclude_id=member.id):
        raise _conflict("email_exists", f"{data.email} is already registered")
    active = len(_active_loans(db, member.id))
    limit = policy.MEMBER_POLICIES[data.member_type].max_loans
    if active > limit:
        raise _conflict(
            "loan_limit_exceeded",
            f"{member.name} has {active} active loans; a {data.member_type} may hold {limit}",
        )
    for field, value in data.model_dump().items():
        setattr(member, field, value)
    _commit(db)
    return member


def deactivate_member(db: Session, member_id: int) -> Member:
    at = clock.now()
    member = _lock(db, Member, member_id) or _raise(_not_found("member", member_id))
    if not member.is_active:
        raise _conflict("member_inactive", f"{member.name} is already inactive")
    if _active_loans(db, member.id):
        raise _conflict("member_has_loans", f"{member.name} still has books out")
    owed = outstanding_fines(db, member.id)
    if owed:
        raise _conflict("fines_unpaid", f"{member.name} owes ₹{owed}; settle fines before leaving")
    holds = db.execute(select(Hold).where(Hold.member_id == member.id, Hold.status.in_(("waiting", "ready")))).scalars()
    for hold in list(holds):
        _lock(db, Book, hold.book_id)
        was_ready = hold.status == "ready"
        hold.status = "cancelled"
        hold.closed_at = at
        if was_ready:
            _release_copy(db, hold.copy, at)
    member.is_active = False
    _log(db, "member_left", f"{member.name}'s membership closed", at, member_id=member.id)
    _commit(db)
    return member


# --- loans ------------------------------------------------------------------


def borrow(
    db: Session,
    *,
    member_id: int,
    book_id: int,
    copy_id: int | None = None,
    at: datetime | None = None,
) -> Loan:
    at = at or clock.now()
    member = _lock(db, Member, member_id) or _raise(_not_found("member", member_id))
    book = _lock(db, Book, book_id) or _raise(_not_found("book", book_id))
    _expire_holds(db, book.id, at)
    _require_good_standing(db, member, at)

    rule = policy.MEMBER_POLICIES[member.member_type]
    active = len(_active_loans(db, member.id))
    if active >= rule.max_loans:
        raise _conflict(
            "loan_limit_reached",
            f"{member.name} already has {active} of {rule.max_loans} loans allowed for a {member.member_type}",
        )
    if _has_book(db, member.id, book.id):
        raise _conflict("already_borrowed", f"{member.name} already has a copy of “{book.title}”")

    hold = _open_hold(db, member.id, book.id)
    if hold is not None and hold.status == "ready":
        copy = hold.copy
        if copy_id is not None and copy_id != copy.id:
            raise _conflict("copy_reserved", f"{member.name}'s reserved copy is {copy.barcode}")
        hold.status = "fulfilled"
        hold.closed_at = at
    else:
        stmt = select(Copy).where(Copy.book_id == book.id, Copy.status == "available").order_by(Copy.id)
        if copy_id is not None:
            stmt = stmt.where(Copy.id == copy_id)
        copy = db.execute(stmt.limit(1)).scalar_one_or_none()
        if copy is None:
            if copy_id is not None:
                exists = db.scalar(select(Copy.id).where(Copy.id == copy_id, Copy.book_id == book.id))
                if exists is None:
                    raise _not_found("copy", copy_id)
                raise _conflict("copy_unavailable", f"Copy {copy_id} is not on the shelf")
            queue = " Place a hold to join the queue." if hold is None else " You are already in the queue."
            raise _conflict("no_copy_available", f"No copy of “{book.title}” is on the shelf.{queue}")
        if hold is not None:  # a waiting member who found a copy on the shelf leaves the queue
            hold.status = "fulfilled"
            hold.closed_at = at

    copy.status = "on_loan"
    loan = Loan(
        copy=copy,
        member=member,
        status="active",
        borrowed_at=at,
        due_at=at + timedelta(days=rule.loan_days),
        renewals=0,
        fine_amount=0,
    )
    db.add(loan)
    _flush(db)
    _log(
        db,
        "loan_created",
        f"{member.name} borrowed “{book.title}” ({copy.barcode})",
        at,
        book_id=book.id,
        member_id=member.id,
        loan_id=loan.id,
    )
    _commit(db)
    metrics.LOANS_CREATED.inc()
    return loan


def _loan_with_book_lock(db: Session, loan_id: int) -> Loan:
    loan = db.get(Loan, loan_id) or _raise(_not_found("loan", loan_id))
    _lock(db, Book, loan.copy.book_id)
    return _lock(db, Loan, loan_id)


def return_loan(db: Session, loan_id: int, at: datetime | None = None) -> Loan:
    at = at or clock.now()
    loan = _loan_with_book_lock(db, loan_id)
    if loan.status != "active":
        raise _conflict("loan_closed", f"Loan {loan.id} is already {loan.status}")
    loan.status = "returned"
    loan.closed_at = at
    loan.fine_amount = late_fine(loan.due_at, at)
    hold = _release_copy(db, loan.copy, at)
    late = f", {_days_late(loan.due_at, at)} day(s) late, fine ₹{loan.fine_amount}" if loan.fine_amount else ""
    _log(
        db,
        "loan_returned",
        f"{loan.member.name} returned “{loan.copy.book.title}”{late}",
        at,
        book_id=loan.copy.book_id,
        member_id=loan.member_id,
        loan_id=loan.id,
    )
    _commit(db)
    metrics.RETURNS.labels(late=str(loan.fine_amount > 0).lower()).inc()
    if hold is not None:
        metrics.HOLDS_PROMOTED.inc()
    return loan


def renew(db: Session, loan_id: int, at: datetime | None = None) -> Loan:
    at = at or clock.now()
    loan = _loan_with_book_lock(db, loan_id)
    if loan.status != "active":
        raise _conflict("loan_closed", f"Loan {loan.id} is already {loan.status}")
    if at > loan.due_at:
        raise _conflict("loan_overdue", "Overdue loans cannot be renewed; return the book and settle the fine")
    if loan.renewals >= policy.MAX_RENEWALS:
        raise _conflict("renewal_limit", f"Loan {loan.id} has used all {policy.MAX_RENEWALS} renewals")
    waiting = _waiting_count(db, loan.copy.book_id)
    if waiting:
        raise _conflict("hold_queue", f"{waiting} member(s) are waiting for this book; it cannot be renewed")
    owed = outstanding_fines(db, loan.member_id)
    if owed >= policy.FINE_BLOCK_AT:
        raise _conflict("fines_unpaid", f"{loan.member.name} owes ₹{owed}; renewals stop at ₹{policy.FINE_BLOCK_AT}")
    rule = policy.MEMBER_POLICIES[loan.member.member_type]
    loan.due_at = max(loan.due_at, at + timedelta(days=rule.loan_days))
    loan.renewals += 1
    _log(
        db,
        "loan_renewed",
        f"{loan.member.name} renewed “{loan.copy.book.title}” ({loan.renewals}/{policy.MAX_RENEWALS})",
        at,
        book_id=loan.copy.book_id,
        member_id=loan.member_id,
        loan_id=loan.id,
    )
    _commit(db)
    return loan


def mark_lost(db: Session, loan_id: int, at: datetime | None = None) -> Loan:
    at = at or clock.now()
    loan = _loan_with_book_lock(db, loan_id)
    if loan.status != "active":
        raise _conflict("loan_closed", f"Loan {loan.id} is already {loan.status}")
    loan.status = "lost"
    loan.closed_at = at
    loan.fine_amount = policy.LOST_FEE
    loan.copy.status = "lost"
    _log(
        db,
        "loan_lost",
        f"{loan.member.name} reported {loan.copy.barcode} lost; replacement fee ₹{policy.LOST_FEE}",
        at,
        book_id=loan.copy.book_id,
        member_id=loan.member_id,
        loan_id=loan.id,
    )
    _commit(db)
    return loan


def pay_fine(db: Session, loan_id: int, at: datetime | None = None) -> Loan:
    at = at or clock.now()
    loan = _lock(db, Loan, loan_id) or _raise(_not_found("loan", loan_id))
    if loan.status == "active":
        raise _conflict("loan_active", "Fines are settled once the loan is closed")
    if loan.fine_amount == 0:
        raise _conflict("no_fine", f"Loan {loan.id} has no fine")
    if loan.fine_paid_at is not None:
        raise _conflict("fine_already_paid", f"The fine on loan {loan.id} is already paid")
    loan.fine_paid_at = at
    _log(
        db,
        "fine_paid",
        f"{loan.member.name} paid ₹{loan.fine_amount}",
        at,
        member_id=loan.member_id,
        loan_id=loan.id,
    )
    _commit(db)
    metrics.FINES_COLLECTED.inc(loan.fine_amount)
    return loan


# --- holds ------------------------------------------------------------------


def place_hold(db: Session, *, member_id: int, book_id: int, at: datetime | None = None) -> Hold:
    at = at or clock.now()
    member = _lock(db, Member, member_id) or _raise(_not_found("member", member_id))
    book = _lock(db, Book, book_id) or _raise(_not_found("book", book_id))
    _expire_holds(db, book.id, at)
    _require_good_standing(db, member, at)
    if _has_book(db, member.id, book.id):
        raise _conflict("already_borrowed", f"{member.name} already has a copy of “{book.title}”")
    if _open_hold(db, member.id, book.id) is not None:
        raise _conflict("hold_exists", f"{member.name} is already in the queue for “{book.title}”")
    statuses = Counter(copy.status for copy in book.copies)
    if statuses["available"]:
        raise _conflict("copy_available", f"A copy of “{book.title}” is on the shelf; borrow it instead")
    if not (statuses["on_loan"] or statuses["on_hold_shelf"]):
        raise _conflict("no_circulating_copies", f"No copy of “{book.title}” is in circulation")
    hold = Hold(book=book, member=member, status="waiting", placed_at=at)
    db.add(hold)
    _flush(db)
    _log(
        db,
        "hold_placed",
        f"{member.name} joined the queue for “{book.title}”",
        at,
        book_id=book.id,
        member_id=member.id,
    )
    _commit(db)
    return hold


def cancel_hold(db: Session, hold_id: int, at: datetime | None = None) -> Hold:
    at = at or clock.now()
    hold = db.get(Hold, hold_id) or _raise(_not_found("hold", hold_id))
    _lock(db, Book, hold.book_id)
    hold = _lock(db, Hold, hold_id)
    if hold.status not in ("waiting", "ready"):
        raise _conflict("hold_closed", f"Hold {hold.id} is already {hold.status}")
    was_ready = hold.status == "ready"
    hold.status = "cancelled"
    hold.closed_at = at
    if was_ready:
        _release_copy(db, hold.copy, at)
    _log(
        db,
        "hold_cancelled",
        f"{hold.member.name} left the queue for “{hold.book.title}”",
        at,
        book_id=hold.book_id,
        member_id=hold.member_id,
    )
    _commit(db)
    return hold


def _raise(error: DomainError):
    raise error


# --- read models ------------------------------------------------------------


def copy_counts(db: Session, book_ids: list[int] | None = None) -> dict[int, Counter]:
    stmt = select(Copy.book_id, Copy.status, func.count()).group_by(Copy.book_id, Copy.status)
    if book_ids is not None:
        stmt = stmt.where(Copy.book_id.in_(book_ids))
    counts: dict[int, Counter] = {}
    for book_id, status, n in db.execute(stmt):
        counts.setdefault(book_id, Counter())[status] = n
    return counts


def waiting_counts(db: Session, book_ids: list[int] | None = None) -> dict[int, int]:
    stmt = select(Hold.book_id, func.count()).where(Hold.status == "waiting").group_by(Hold.book_id)
    if book_ids is not None:
        stmt = stmt.where(Hold.book_id.in_(book_ids))
    return dict(db.execute(stmt).all())


def book_out(book: Book, counts: Counter, waiting: int) -> dict:
    circulating = sum(n for status, n in counts.items() if status not in ("lost", "withdrawn"))
    return {
        "id": book.id,
        "isbn": book.isbn,
        "title": book.title,
        "author": book.author,
        "genre": book.genre,
        "published_year": book.published_year,
        "copies_total": circulating,
        "copies_available": counts.get("available", 0),
        "copies_on_loan": counts.get("on_loan", 0),
        "holds_waiting": waiting,
        "created_at": book.created_at,
        "updated_at": book.updated_at,
    }


def list_books(
    db: Session, q: str | None = None, genre: str | None = None, available: bool | None = None
) -> list[dict]:
    stmt = select(Book).order_by(Book.title)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(func.lower(Book.title).like(like), func.lower(Book.author).like(like), Book.isbn.like(f"%{q}%"))
        )
    if genre:
        stmt = stmt.where(Book.genre == genre)
    books = list(db.execute(stmt).scalars())
    ids = [b.id for b in books]
    counts = copy_counts(db, ids)
    waiting = waiting_counts(db, ids)
    rows = [book_out(b, counts.get(b.id, Counter()), waiting.get(b.id, 0)) for b in books]
    if available is not None:
        rows = [r for r in rows if (r["copies_available"] > 0) == available]
    return rows


def hold_out(hold: Hold, position: int | None) -> dict:
    return {
        "id": hold.id,
        "status": hold.status,
        "book_id": hold.book_id,
        "book_title": hold.book.title,
        "member_id": hold.member_id,
        "member_name": hold.member.name,
        "card_number": hold.member.card_number,
        "position": position,
        "copy_barcode": hold.copy.barcode if hold.copy is not None else None,
        "placed_at": hold.placed_at,
        "ready_at": hold.ready_at,
        "expires_at": hold.expires_at,
        "closed_at": hold.closed_at,
    }


def _queue_positions(db: Session, book_ids: set[int]) -> dict[int, int]:
    """Hold id -> 1-based place in its book's waiting queue."""
    if not book_ids:
        return {}
    stmt = (
        select(Hold.id, Hold.book_id)
        .where(Hold.status == "waiting", Hold.book_id.in_(book_ids))
        .order_by(Hold.book_id, Hold.placed_at, Hold.id)
    )
    positions: dict[int, int] = {}
    seen: Counter = Counter()
    for hold_id, book_id in db.execute(stmt):
        seen[book_id] += 1
        positions[hold_id] = seen[book_id]
    return positions


def _holds_out(db: Session, holds: list[Hold]) -> list[dict]:
    positions = _queue_positions(db, {h.book_id for h in holds if h.status == "waiting"})
    return [hold_out(h, positions.get(h.id)) for h in holds]


def _hold_query():
    return select(Hold).options(selectinload(Hold.book), selectinload(Hold.member), selectinload(Hold.copy))


def book_detail(db: Session, book_id: int) -> dict:
    book = db.get(Book, book_id) or _raise(_not_found("book", book_id))
    counts = copy_counts(db, [book.id]).get(book.id, Counter())
    queue = list(
        db.execute(
            _hold_query()
            .where(Hold.book_id == book.id, Hold.status.in_(("waiting", "ready")))
            .order_by(Hold.status.asc(), Hold.placed_at, Hold.id)
        ).scalars()
    )
    active = {
        loan.copy_id: loan
        for loan in db.execute(
            select(Loan).join(Copy, Loan.copy_id == Copy.id).where(Copy.book_id == book.id, Loan.status == "active")
        ).scalars()
    }
    reserved = {h.copy_id: h.member.name for h in queue if h.status == "ready"}
    copies = [
        {
            "id": c.id,
            "book_id": c.book_id,
            "barcode": c.barcode,
            "status": c.status,
            "condition": c.condition,
            "shelf": c.shelf,
            "due_at": active[c.id].due_at if c.id in active else None,
            "reserved_for": reserved.get(c.id),
        }
        for c in book.copies
    ]
    out = book_out(book, counts, sum(1 for h in queue if h.status == "waiting"))
    return {**out, "copies": copies, "queue": _holds_out(db, queue)}


def copy_out(copy: Copy) -> dict:
    return {
        "id": copy.id,
        "book_id": copy.book_id,
        "barcode": copy.barcode,
        "status": copy.status,
        "condition": copy.condition,
        "shelf": copy.shelf,
    }


def loan_out(loan: Loan, at: datetime) -> dict:
    active = loan.status == "active"
    until = at if active else loan.closed_at
    return {
        "id": loan.id,
        "status": loan.status,
        "book_id": loan.copy.book_id,
        "book_title": loan.copy.book.title,
        "copy_id": loan.copy_id,
        "barcode": loan.copy.barcode,
        "member_id": loan.member_id,
        "member_name": loan.member.name,
        "card_number": loan.member.card_number,
        "borrowed_at": loan.borrowed_at,
        "due_at": loan.due_at,
        "closed_at": loan.closed_at,
        "renewals": loan.renewals,
        "renewals_left": max(0, policy.MAX_RENEWALS - loan.renewals) if active else 0,
        "is_overdue": active and at > loan.due_at,
        "days_overdue": _days_late(loan.due_at, until),
        "fine_amount": late_fine(loan.due_at, at) if active else loan.fine_amount,
        "fine_paid": loan.fine_paid_at is not None,
    }


def _loan_query():
    return select(Loan).options(selectinload(Loan.copy).selectinload(Copy.book), selectinload(Loan.member))


def get_loan(db: Session, loan_id: int) -> Loan:
    loan = db.execute(_loan_query().where(Loan.id == loan_id)).scalar_one_or_none()
    return loan or _raise(_not_found("loan", loan_id))


def list_loans(
    db: Session,
    status: str = "active",
    member_id: int | None = None,
    book_id: int | None = None,
    limit: int = 200,
) -> list[dict]:
    at = clock.now()
    stmt = _loan_query()
    if status == "overdue":
        stmt = stmt.where(Loan.status == "active", Loan.due_at < at).order_by(Loan.due_at)
    elif status == "active":
        stmt = stmt.where(Loan.status == "active").order_by(Loan.due_at)
    elif status == "closed":
        stmt = stmt.where(Loan.status != "active").order_by(Loan.closed_at.desc())
    elif status == "unpaid":
        stmt = stmt.where(Loan.status != "active", Loan.fine_amount > 0, Loan.fine_paid_at.is_(None)).order_by(
            Loan.closed_at.desc()
        )
    elif status in ("returned", "lost"):
        stmt = stmt.where(Loan.status == status).order_by(Loan.closed_at.desc())
    else:
        stmt = stmt.order_by(Loan.borrowed_at.desc())
    if member_id is not None:
        stmt = stmt.where(Loan.member_id == member_id)
    if book_id is not None:
        stmt = stmt.join(Copy, Loan.copy_id == Copy.id).where(Copy.book_id == book_id)
    return [loan_out(loan, at) for loan in db.execute(stmt.limit(limit)).scalars()]


def get_hold(db: Session, hold_id: int) -> dict:
    hold = db.execute(_hold_query().where(Hold.id == hold_id)).scalar_one_or_none()
    hold = hold or _raise(_not_found("hold", hold_id))
    return _holds_out(db, [hold])[0]


def list_holds(
    db: Session, status: str = "open", member_id: int | None = None, book_id: int | None = None
) -> list[dict]:
    stmt = _hold_query()
    if status == "open":
        stmt = stmt.where(Hold.status.in_(("waiting", "ready")))
    elif status != "all":
        stmt = stmt.where(Hold.status == status)
    if member_id is not None:
        stmt = stmt.where(Hold.member_id == member_id)
    if book_id is not None:
        stmt = stmt.where(Hold.book_id == book_id)
    stmt = stmt.order_by(Hold.status.asc(), Hold.placed_at, Hold.id)
    return _holds_out(db, list(db.execute(stmt).scalars()))


def member_out(db: Session, member: Member, at: datetime) -> dict:
    active = _active_loans(db, member.id)
    block = _member_block(db, member, at)
    reason = block.message if block is not None else None
    rule = policy.MEMBER_POLICIES[member.member_type]
    if reason is None and len(active) >= rule.max_loans:
        reason = f"{member.name} has reached the {rule.max_loans}-loan limit"
    return {
        "id": member.id,
        "card_number": member.card_number,
        "name": member.name,
        "email": member.email,
        "member_type": member.member_type,
        "is_active": member.is_active,
        "loans_active": len(active),
        "loans_overdue": sum(1 for loan in active if loan.due_at < at),
        "max_loans": rule.max_loans,
        "fines_outstanding": outstanding_fines(db, member.id),
        "can_borrow": reason is None,
        "blocked_reason": reason,
        "created_at": member.created_at,
    }


def list_members(db: Session, q: str | None = None, include_inactive: bool = False) -> list[dict]:
    at = clock.now()
    stmt = select(Member).order_by(Member.name)
    if not include_inactive:
        stmt = stmt.where(Member.is_active.is_(True))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Member.name).like(like), Member.email.like(like)))
    return [member_out(db, m, at) for m in db.execute(stmt).scalars()]


def member_detail(db: Session, member_id: int) -> dict:
    at = clock.now()
    member = db.get(Member, member_id) or _raise(_not_found("member", member_id))
    loans = list(
        db.execute(
            _loan_query().where(Loan.member_id == member.id).order_by(Loan.status, Loan.borrowed_at.desc()).limit(50)
        ).scalars()
    )
    holds = list(
        db.execute(
            _hold_query()
            .where(Hold.member_id == member.id, Hold.status.in_(("waiting", "ready")))
            .order_by(Hold.placed_at)
        ).scalars()
    )
    return {
        **member_out(db, member, at),
        "loans": [loan_out(loan, at) for loan in loans],
        "holds": _holds_out(db, holds),
    }


def _local_midnight(at: datetime) -> datetime:
    local = at.astimezone(ZoneInfo(settings.timezone))
    return local.replace(hour=0, minute=0, second=0, microsecond=0)


def stats(db: Session, at: datetime | None = None) -> dict:
    at = at or clock.now()
    midnight = _local_midnight(at)
    by_status = dict(db.execute(select(Copy.status, func.count()).group_by(Copy.status)).all())
    holds = dict(
        db.execute(
            select(Hold.status, func.count()).where(Hold.status.in_(("waiting", "ready"))).group_by(Hold.status)
        ).all()
    )

    def count(stmt) -> int:
        return int(db.scalar(stmt) or 0)

    return {
        "books": count(select(func.count()).select_from(Book)),
        "copies": sum(n for status, n in by_status.items() if status not in ("lost", "withdrawn")),
        "copies_by_status": {status: int(by_status.get(status, 0)) for status in policy.COPY_STATUSES},
        "members_active": count(select(func.count()).select_from(Member).where(Member.is_active.is_(True))),
        "loans_active": count(select(func.count()).select_from(Loan).where(Loan.status == "active")),
        "loans_overdue": count(select(func.count()).select_from(Loan).where(Loan.status == "active", Loan.due_at < at)),
        "holds_waiting": int(holds.get("waiting", 0)),
        "holds_ready": int(holds.get("ready", 0)),
        "fines_outstanding": count(
            select(func.coalesce(func.sum(Loan.fine_amount), 0)).where(
                Loan.status != "active", Loan.fine_paid_at.is_(None)
            )
        ),
        "loans_today": count(select(func.count()).select_from(Loan).where(Loan.borrowed_at >= midnight)),
        "returns_today": count(
            select(func.count()).select_from(Loan).where(Loan.status == "returned", Loan.closed_at >= midnight)
        ),
    }


def recent_activity(db: Session, limit: int = 20) -> list[Activity]:
    return list(db.execute(select(Activity).order_by(Activity.at.desc(), Activity.id.desc()).limit(limit)).scalars())
