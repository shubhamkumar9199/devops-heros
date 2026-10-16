"""The seed replays 60 days of lending through the real rules. Afterwards the
library must still be consistent, whatever sequence of desk actions happened."""

from collections import Counter

from sqlalchemy import func, select

from app import expire_holds, seed, wait_for_db
from app.db import SessionLocal
from app.models import Book, Copy, Hold, Loan


def test_sixty_days_of_lending_leave_a_consistent_library(capsys):
    summary = seed.simulate()

    assert summary["books"] == len(seed.BOOKS)
    assert summary["members_active"] == len(seed.MEMBERS)
    assert summary["loans_active"] > 0
    with SessionLocal() as db:
        active = list(db.execute(select(Loan).where(Loan.status == "active")).scalars())
        ready = list(db.execute(select(Hold).where(Hold.status == "ready")).scalars())
        waiting = list(db.execute(select(Hold).where(Hold.status == "waiting")).scalars())
        copies = list(db.execute(select(Copy)).scalars())
        history = db.scalar(select(func.count()).select_from(Loan))

        # A copy is never on two active loans, and on_loan means exactly that.
        on_loan = Counter(loan.copy_id for loan in active)
        assert max(on_loan.values()) == 1
        assert {c.id for c in copies if c.status == "on_loan"} == set(on_loan)

        # Every copy on the hold shelf belongs to exactly one ready hold, and back.
        shelf = {c.id for c in copies if c.status == "on_hold_shelf"}
        assert shelf == {h.copy_id for h in ready}
        assert len(ready) == len(shelf)

        # Nobody waits for a book that has a copy sitting on the open shelf.
        available_books = {c.book_id for c in copies if c.status == "available"}
        assert not available_books & {h.book_id for h in waiting}

        # Students never hold more than 3 books at once, faculty never more than 6.
        per_member = Counter(loan.member_id for loan in active)
        for loan in active:
            assert per_member[loan.member_id] <= (3 if loan.member.member_type == "student" else 6)

    assert history > summary["loans_active"]  # there is returned history, not just open loans


def test_seed_command_is_idempotent(capsys, monkeypatch):
    monkeypatch.setattr("sys.argv", ["seed"])
    seed.main()
    first = capsys.readouterr().out
    assert first.startswith("seeded:")
    seed.main()
    assert "nothing to do" in capsys.readouterr().out
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Book)) == len(seed.BOOKS)


def test_hold_expiry_job_and_db_wait_entrypoints(capsys):
    expire_holds.main()
    assert "uncollected hold(s)" in capsys.readouterr().out
    assert wait_for_db.main(timeout=5) == 0
