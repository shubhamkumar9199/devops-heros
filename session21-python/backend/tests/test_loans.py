"""Loans: borrowing rules, the loan state machine, renewals, fines."""

from datetime import datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models import Loan


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


@pytest.mark.parametrize(("member_type", "days"), [("student", 14), ("faculty", 28)])
def test_loan_period_depends_on_member_type(clock, make_member, make_book, borrow, member_type, days):
    loan = borrow(make_member(member_type), make_book())
    assert loan["status"] == "active"
    assert (parse(loan["due_at"]) - parse(loan["borrowed_at"])).days == days
    assert loan["renewals_left"] == 2
    assert loan["fine_amount"] == 0


def test_last_copy_cannot_be_lent_twice(client, make_member, make_book, borrow):
    book = make_book(copies=1)
    borrow(make_member(), book)
    refused = borrow(make_member(), book, expect=409)
    assert refused["code"] == "no_copy_available"
    assert client.get(f"/api/books/{book['id']}").json()["copies_available"] == 0


def test_student_loan_limit(make_member, make_book, borrow):
    student = make_member("student")
    for _ in range(3):
        borrow(student, make_book())
    assert borrow(student, make_book(), expect=409)["code"] == "loan_limit_reached"


def test_member_cannot_borrow_two_copies_of_one_book(make_member, make_book, borrow):
    member, book = make_member(), make_book(copies=2)
    borrow(member, book)
    assert borrow(member, book, expect=409)["code"] == "already_borrowed"


def test_unknown_member_or_book_is_404(client, make_member, make_book):
    book, member = make_book(), make_member()
    assert client.post("/api/loans", json={"member_id": 999_999, "book_id": book["id"]}).status_code == 404
    assert client.post("/api/loans", json={"member_id": member["id"], "book_id": 999_999}).status_code == 404
    assert client.post("/api/loans/999999/return").status_code == 404


def test_on_time_return_has_no_fine(client, clock, make_member, make_book, borrow):
    book = make_book()
    loan = borrow(make_member(), book)
    clock.advance(days=10)
    returned = client.post(f"/api/loans/{loan['id']}/return").json()
    assert returned["status"] == "returned"
    assert returned["fine_amount"] == 0
    assert client.get(f"/api/books/{book['id']}").json()["copies_available"] == 1


@pytest.mark.parametrize(("days_late", "fine"), [(1, 5), (3, 15), (40, 200)])  # ₹5/day, capped at ₹200
def test_late_return_is_fined(client, clock, make_member, make_book, borrow, days_late, fine):
    loan = borrow(make_member(), make_book())
    clock.advance(days=14 + days_late)
    returned = client.post(f"/api/loans/{loan['id']}/return").json()
    assert returned["days_overdue"] == days_late
    assert returned["fine_amount"] == fine
    assert returned["fine_paid"] is False


def test_partial_late_day_counts_as_a_day(client, clock, make_member, make_book, borrow):
    loan = borrow(make_member(), make_book())
    clock.advance(days=14, hours=2)
    assert client.post(f"/api/loans/{loan['id']}/return").json()["fine_amount"] == 5


def test_closed_loan_rejects_every_transition(client, make_member, make_book, borrow):
    loan = borrow(make_member(), make_book())
    assert client.post(f"/api/loans/{loan['id']}/return").status_code == 200
    for action in ("return", "renew", "lost"):
        response = client.post(f"/api/loans/{loan['id']}/{action}")
        assert response.status_code == 409, action
        assert response.json()["code"] == "loan_closed"


def test_renewal_extends_due_date_until_the_limit(client, clock, make_member, make_book, borrow):
    loan = borrow(make_member(), make_book())
    clock.advance(days=10)
    renewed = client.post(f"/api/loans/{loan['id']}/renew").json()
    assert renewed["renewals"] == 1
    assert parse(renewed["due_at"]) == clock.value + timedelta(days=14)  # a fresh period from today
    clock.advance(days=10)
    assert client.post(f"/api/loans/{loan['id']}/renew").json()["renewals"] == 2
    clock.advance(days=10)
    refused = client.post(f"/api/loans/{loan['id']}/renew")
    assert refused.status_code == 409
    assert refused.json()["code"] == "renewal_limit"


def test_overdue_loan_cannot_be_renewed(client, clock, make_member, make_book, borrow):
    loan = borrow(make_member(), make_book())
    clock.advance(days=15)
    assert client.post(f"/api/loans/{loan['id']}/renew").json()["code"] == "loan_overdue"


def test_book_with_a_queue_cannot_be_renewed(client, make_member, make_book, borrow):
    book = make_book(copies=1)
    loan = borrow(make_member(), book)
    client.post("/api/holds", json={"member_id": make_member()["id"], "book_id": book["id"]})
    refused = client.post(f"/api/loans/{loan['id']}/renew")
    assert refused.status_code == 409
    assert refused.json()["code"] == "hold_queue"


def test_lost_copy_costs_the_replacement_fee(client, make_member, make_book, borrow):
    book = make_book(copies=1)
    loan = borrow(make_member(), book)
    lost = client.post(f"/api/loans/{loan['id']}/lost").json()
    assert lost["status"] == "lost"
    assert lost["fine_amount"] == 500
    assert client.get(f"/api/books/{book['id']}").json()["copies"][0]["status"] == "lost"


def test_paying_a_fine(client, make_member, make_book, borrow):
    loan = borrow(make_member(), make_book())
    assert client.post(f"/api/loans/{loan['id']}/pay").json()["code"] == "loan_active"
    client.post(f"/api/loans/{loan['id']}/lost")
    paid = client.post(f"/api/loans/{loan['id']}/pay")
    assert paid.status_code == 200
    assert paid.json()["fine_paid"] is True
    assert client.post(f"/api/loans/{loan['id']}/pay").json()["code"] == "fine_already_paid"


def test_on_time_loan_has_no_fine_to_pay(client, make_member, make_book, borrow):
    loan = borrow(make_member(), make_book())
    client.post(f"/api/loans/{loan['id']}/return")
    assert client.post(f"/api/loans/{loan['id']}/pay").json()["code"] == "no_fine"


def test_unpaid_fines_block_borrowing_until_paid(client, make_member, make_book, borrow):
    member = make_member()
    loan = borrow(member, make_book())
    client.post(f"/api/loans/{loan['id']}/lost")  # ₹500 owed

    blocked = borrow(member, make_book(), expect=409)
    assert blocked["code"] == "fines_unpaid"
    assert client.get(f"/api/members/{member['id']}").json()["can_borrow"] is False

    client.post(f"/api/loans/{loan['id']}/pay")
    borrow(member, make_book())


def test_small_fines_do_not_block(client, clock, make_member, make_book, borrow):
    member = make_member()
    loan = borrow(member, make_book())
    clock.advance(days=16)  # 2 days late: ₹10
    client.post(f"/api/loans/{loan['id']}/return")
    borrow(member, make_book())


def test_overdue_loan_blocks_new_borrowing(client, clock, make_member, make_book, borrow):
    member = make_member()
    borrow(member, make_book())
    clock.advance(days=15)
    assert borrow(member, make_book(), expect=409)["code"] == "member_has_overdue"


def test_loan_filters(client, clock, make_member, make_book, borrow):
    early = borrow(make_member(), make_book(title="Early"))
    clock.advance(days=10)
    borrow(make_member(), make_book(title="Later"))
    done = borrow(make_member(), make_book(title="Done"))
    client.post(f"/api/loans/{done['id']}/return")
    clock.advance(days=5)  # the first loan is now 1 day overdue

    overdue = client.get("/api/loans", params={"status": "overdue"}).json()
    assert [(loan["id"], loan["days_overdue"], loan["fine_amount"]) for loan in overdue] == [(early["id"], 1, 5)]
    assert [loan["book_title"] for loan in client.get("/api/loans").json()] == ["Early", "Later"]
    assert [loan["book_title"] for loan in client.get("/api/loans", params={"status": "returned"}).json()] == ["Done"]
    assert client.get("/api/loans", params={"status": "bogus"}).status_code == 422


def test_database_refuses_a_fourth_renewal_even_without_the_api(make_member, make_book, borrow):
    loan = borrow(make_member(), make_book())
    with SessionLocal() as db:
        row = db.get(Loan, loan["id"])
        row.renewals = 3
        with pytest.raises(IntegrityError):
            db.commit()


def test_database_refuses_a_second_active_loan_for_one_copy(make_member, make_book, borrow):
    loan = borrow(make_member(), make_book())
    with SessionLocal() as db:
        original = db.get(Loan, loan["id"])
        db.add(
            Loan(
                copy_id=original.copy_id,
                member_id=original.member_id,
                status="active",
                borrowed_at=original.borrowed_at,
                due_at=original.due_at,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
