"""Races that only a real PostgreSQL can show.

Each contender runs in its own process with its own connection, like separate
API replicas, and they all start at the same instant. (Threads are not enough:
the GIL staggers them so much that the first one usually finishes before the
others look.) CI runs these against a throwaway postgres service container:

    TEST_DATABASE_URL=postgresql+psycopg://... pytest -m postgres
"""

import multiprocessing

import pytest
from sqlalchemy import func, select

from app import services
from app.db import SessionLocal, engine
from app.models import Loan
from app.schemas import BookCreate, MemberIn
from tests.conftest import valid_isbn13

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(engine.dialect.name != "postgresql", reason="needs PostgreSQL row locks"),
]


def _contender(barrier, results, member_id: int, book_id: int) -> None:
    from app import services
    from app.db import SessionLocal

    with SessionLocal() as db:
        db.connection()  # connect before the starting gun
        barrier.wait()
        try:
            services.borrow(db, member_id=member_id, book_id=book_id)
            results.put("ok")
        except services.DomainError as exc:
            results.put(exc.code)
        except Exception as exc:  # anything else is a bug: report it, don't hang
            results.put(type(exc).__name__)


def _race(attempts: list[tuple[int, int]]) -> list[str]:
    ctx = multiprocessing.get_context("spawn")
    barrier = ctx.Barrier(len(attempts))
    results = ctx.Queue()
    procs = [ctx.Process(target=_contender, args=(barrier, results, m, b)) for m, b in attempts]
    for p in procs:
        p.start()
    outcome = [results.get(timeout=120) for _ in procs]
    for p in procs:
        p.join(timeout=30)
    return outcome


def _book(copies: int) -> int:
    with SessionLocal() as db:
        data = BookCreate(
            isbn=valid_isbn13(), title="Race Condition", author="T. Hreads", genre="Technology", copies=copies
        )
        return services.create_book(db, data).id


def _member(n: int) -> int:
    with SessionLocal() as db:
        data = MemberIn(name=f"Racer {n}", email=f"racer{n}@campus.example", member_type="student")
        return services.create_member(db, data).id


def _active_loans() -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(Loan).where(Loan.status == "active"))


def test_ten_replicas_racing_for_the_last_copy_only_one_wins():
    book_id = _book(copies=1)
    results = _race([(_member(i), book_id) for i in range(10)])

    assert results.count("ok") == 1, results
    assert results.count("no_copy_available") == 9, results  # refused by the rules, not by a crash
    assert _active_loans() == 1


def test_one_student_racing_six_desks_gets_only_three_loans():
    student = _member(100)
    results = _race([(student, _book(copies=1)) for _ in range(6)])

    assert results.count("ok") == 3, results
    assert results.count("loan_limit_reached") == 3, results
    assert _active_loans() == 3
