"""Members: registration, edits and closing a membership."""

import pytest


def test_register_member(client):
    response = client.post(
        "/api/members", json={"name": "Diya Patel", "email": " Diya.Patel@Campus.Example ", "member_type": "student"}
    )
    assert response.status_code == 201
    member = response.json()
    assert member["email"] == "diya.patel@campus.example"
    assert member["card_number"] == f"LIB-{member['id']:05d}"
    assert member["max_loans"] == 3
    assert member["can_borrow"] is True


def test_email_is_unique_ignoring_case(client, make_member):
    first = make_member()
    response = client.post(
        "/api/members", json={"name": "Someone Else", "email": first["email"].upper(), "member_type": "faculty"}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "email_exists"


@pytest.mark.parametrize(
    "body",
    [
        {"name": "A", "email": "a@campus.example", "member_type": "student"},  # name too short
        {"name": "Ann", "email": "not-an-email", "member_type": "student"},
        {"name": "Ann", "email": "ann@campus.example", "member_type": "alumni"},  # no such membership
    ],
)
def test_invalid_member_is_rejected(client, body):
    assert client.post("/api/members", json=body).status_code == 422


def test_cannot_downgrade_member_below_their_current_loans(client, make_member, make_book, borrow):
    professor = make_member("faculty", name="Kavita Rao")
    for _ in range(4):
        borrow(professor, make_book())
    body = {"name": "Kavita Rao", "email": professor["email"], "member_type": "student"}
    response = client.put(f"/api/members/{professor['id']}", json=body)
    assert response.status_code == 409
    assert response.json()["code"] == "loan_limit_exceeded"


def test_close_membership(client, make_member, make_book, borrow):
    member = make_member()
    book = make_book()
    loan = borrow(member, book)

    still_out = client.delete(f"/api/members/{member['id']}")
    assert still_out.status_code == 409
    assert still_out.json()["code"] == "member_has_loans"

    client.post(f"/api/loans/{loan['id']}/return")
    assert client.delete(f"/api/members/{member['id']}").status_code == 204
    detail = client.get(f"/api/members/{member['id']}").json()
    assert detail["is_active"] is False
    assert member["id"] not in [m["id"] for m in client.get("/api/members").json()]
    assert borrow(member, book, expect=409)["code"] == "member_inactive"


def test_member_detail_lists_loans_and_holds(client, make_member, make_book, borrow):
    reader, other = make_member(), make_member()
    popular = make_book(title="Atomic Habits", genre="Non-fiction")
    borrow(other, popular)
    borrow(reader, make_book(title="Cosmos", genre="Science"))
    client.post("/api/holds", json={"member_id": reader["id"], "book_id": popular["id"]})

    detail = client.get(f"/api/members/{reader['id']}").json()
    assert detail["loans_active"] == 1
    assert [loan["book_title"] for loan in detail["loans"]] == ["Cosmos"]
    assert [(h["book_title"], h["position"]) for h in detail["holds"]] == [("Atomic Habits", 1)]
