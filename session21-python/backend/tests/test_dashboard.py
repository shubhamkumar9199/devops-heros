"""Dashboard numbers and the activity feed."""


def test_stats_follow_the_library(client, clock, make_member, make_book, borrow):
    book = make_book(copies=2)
    lost_book = make_book(copies=1)
    late = borrow(make_member(), book)
    borrow(make_member(), book)
    lost = borrow(make_member(), lost_book)
    client.post(f"/api/loans/{lost['id']}/lost")
    clock.advance(days=15)

    stats = client.get("/api/stats").json()
    assert stats["books"] == 2
    assert stats["copies"] == 2  # the lost copy no longer counts
    assert stats["copies_by_status"] == {"available": 0, "on_loan": 2, "on_hold_shelf": 0, "lost": 1, "withdrawn": 0}
    assert stats["loans_active"] == 2
    assert stats["loans_overdue"] == 2
    assert stats["fines_outstanding"] == 500

    client.post(f"/api/loans/{late['id']}/return")  # 1 day late: ₹5
    stats = client.get("/api/stats").json()
    assert stats["returns_today"] == 1
    assert stats["fines_outstanding"] == 505


def test_activity_feed_is_newest_first(client, clock, make_member, make_book, borrow):
    member = make_member(name="Meera Nair")
    book = make_book(title="Malgudi Days", genre="Children")
    clock.advance(minutes=1)
    loan = borrow(member, book)
    clock.advance(minutes=1)
    client.post(f"/api/loans/{loan['id']}/return")

    feed = client.get("/api/activity", params={"limit": 3}).json()
    assert [entry["kind"] for entry in feed] == ["loan_returned", "loan_created", "book_added"]
    assert feed[1]["message"] == f"Meera Nair borrowed “Malgudi Days” (SW{book['id']:04d}-01)"
    assert feed[1]["loan_id"] == loan["id"]
