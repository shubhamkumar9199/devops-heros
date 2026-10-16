"""Holds: the waiting queue and the hold shelf."""


def hold(client, member, book, expect=201):
    response = client.post("/api/holds", json={"member_id": member["id"], "book_id": book["id"]})
    assert response.status_code == expect, response.text
    return response.json()


def test_no_hold_while_a_copy_is_on_the_shelf(client, make_member, make_book):
    assert hold(client, make_member(), make_book(), expect=409)["code"] == "copy_available"


def test_queue_positions_and_duplicates(client, make_member, make_book, borrow):
    book = make_book(copies=1)
    borrow(make_member(), book)
    first, second = make_member(), make_member()
    assert hold(client, first, book)["position"] == 1
    assert hold(client, second, book)["position"] == 2
    assert hold(client, first, book, expect=409)["code"] == "hold_exists"
    queue = client.get(f"/api/books/{book['id']}").json()["queue"]
    assert [(h["member_id"], h["position"]) for h in queue] == [(first["id"], 1), (second["id"], 2)]


def test_cannot_hold_a_book_you_have(client, make_member, make_book, borrow):
    member, book = make_member(), make_book(copies=1)
    borrow(member, book)
    assert hold(client, member, book, expect=409)["code"] == "already_borrowed"


def test_returned_copy_goes_to_the_first_member_waiting(client, make_member, make_book, borrow):
    book = make_book(copies=1)
    loan = borrow(make_member(), book)
    waiting = make_member(name="Rohan Gupta")
    placed = hold(client, waiting, book)

    client.post(f"/api/loans/{loan['id']}/return")
    ready = client.get(f"/api/holds/{placed['id']}").json()
    assert ready["status"] == "ready"
    assert ready["copy_barcode"] == f"SW{book['id']:04d}-01"
    assert ready["expires_at"] is not None
    copy = client.get(f"/api/books/{book['id']}").json()["copies"][0]
    assert (copy["status"], copy["reserved_for"]) == ("on_hold_shelf", "Rohan Gupta")

    # Someone else walks up to the desk: the reserved copy is not for them.
    assert borrow(make_member(), book, expect=409)["code"] == "no_copy_available"

    picked_up = borrow(waiting, book)
    assert picked_up["copy_id"] == copy["id"]
    assert client.get(f"/api/holds/{placed['id']}").json()["status"] == "fulfilled"


def test_cancelling_a_ready_hold_passes_the_copy_on(client, make_member, make_book, borrow):
    book = make_book(copies=1)
    loan = borrow(make_member(), book)
    first = hold(client, make_member(), book)
    second = hold(client, make_member(), book)
    client.post(f"/api/loans/{loan['id']}/return")

    assert client.delete(f"/api/holds/{first['id']}").status_code == 204
    assert client.get(f"/api/holds/{second['id']}").json()["status"] == "ready"
    assert client.delete(f"/api/holds/{first['id']}").json()["code"] == "hold_closed"


def test_uncollected_hold_lapses_and_the_next_member_gets_the_copy(client, clock, make_member, make_book, borrow):
    book = make_book(copies=1)
    loan = borrow(make_member(), book)
    slow = hold(client, make_member(), book)
    patient = hold(client, make_member(), book)
    client.post(f"/api/loans/{loan['id']}/return")

    clock.advance(days=2)
    assert client.post("/api/holds/expire").json() == {"expired": 0}
    clock.advance(days=1, minutes=1)
    assert client.post("/api/holds/expire").json() == {"expired": 1}
    assert client.get(f"/api/holds/{slow['id']}").json()["status"] == "expired"
    assert client.get(f"/api/holds/{patient['id']}").json()["status"] == "ready"


def test_last_hold_lapsing_puts_the_copy_back_on_the_shelf(client, clock, make_member, make_book, borrow):
    book = make_book(copies=1)
    loan = borrow(make_member(), book)
    hold(client, make_member(), book)
    client.post(f"/api/loans/{loan['id']}/return")
    clock.advance(days=4)
    borrow(make_member(), book)  # the borrow itself sweeps the lapsed hold first


def test_new_copy_goes_straight_to_the_waiting_member(client, make_member, make_book, borrow):
    book = make_book(copies=1)
    borrow(make_member(), book)
    placed = hold(client, make_member(), book)
    added = client.post(f"/api/books/{book['id']}/copies", json={}).json()
    assert added["status"] == "on_hold_shelf"
    assert client.get(f"/api/holds/{placed['id']}").json()["status"] == "ready"


def test_no_hold_on_a_book_with_no_copies_in_circulation(client, make_member, make_book):
    assert hold(client, make_member(), make_book(copies=0), expect=409)["code"] == "no_circulating_copies"
