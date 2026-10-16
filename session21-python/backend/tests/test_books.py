"""Catalogue: books (GET/POST/PUT/DELETE) and their copies."""

import pytest

from app.schemas import normalize_isbn


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0-13-235088-2", "9780132350884"),  # ISBN-10 with hyphens becomes ISBN-13
        ("080442957X", "9780804429573"),  # X check digit
        ("978 0 13 235088 4", "9780132350884"),
    ],
)
def test_isbn_is_normalised_to_13_digits(raw, expected):
    assert normalize_isbn(raw) == expected


def test_create_book_puts_copies_on_the_shelf(client):
    response = client.post(
        "/api/books",
        json={
            "isbn": "0-13-235088-2",
            "title": "  Clean Code ",
            "author": "Robert C. Martin",
            "genre": "Technology",
            "published_year": 2008,
            "copies": 3,
        },
    )
    assert response.status_code == 201
    book = response.json()
    assert book["isbn"] == "9780132350884"
    assert book["title"] == "Clean Code"  # trimmed
    assert book["copies_total"] == book["copies_available"] == 3
    assert [c["barcode"] for c in book["copies"]] == [f"SW{book['id']:04d}-0{i}" for i in (1, 2, 3)]
    assert {c["status"] for c in book["copies"]} == {"available"}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("isbn", "9780132350885"),  # wrong check digit
        ("isbn", "12345"),
        ("genre", "Poetry"),  # not one of the library's genres
        ("published_year", 1200),
        ("title", "   "),
        ("copies", 21),
    ],
)
def test_invalid_book_is_rejected(client, field, value):
    body = {"isbn": "9780132350884", "title": "Clean Code", "author": "Robert C. Martin", "genre": "Technology"}
    body[field] = value
    assert client.post("/api/books", json=body).status_code == 422


def test_duplicate_isbn_is_a_conflict(client, make_book):
    book = make_book()
    response = client.post(
        "/api/books", json={"isbn": book["isbn"], "title": "Copycat", "author": "Someone", "genre": "Fiction"}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "isbn_exists"


def test_list_and_search_books(client, make_book):
    make_book(title="Sapiens", author="Yuval Noah Harari", genre="History")
    make_book(title="The Selfish Gene", author="Richard Dawkins", genre="Science", copies=0)
    make_book(title="Cosmos", author="Carl Sagan", genre="Science")

    assert [b["title"] for b in client.get("/api/books").json()] == ["Cosmos", "Sapiens", "The Selfish Gene"]
    assert [b["title"] for b in client.get("/api/books", params={"q": "dawkins"}).json()] == ["The Selfish Gene"]
    assert len(client.get("/api/books", params={"genre": "Science"}).json()) == 2
    on_shelf = client.get("/api/books", params={"genre": "Science", "available": True}).json()
    assert [b["title"] for b in on_shelf] == ["Cosmos"]


def test_get_unknown_book_is_404(client):
    response = client.get("/api/books/424242")
    assert response.status_code == 404
    assert response.json()["code"] == "book_not_found"


def test_put_replaces_book_details(client, make_book):
    book = make_book(title="Wings of Fire", author="A. P. J. Abdul Kalam", genre="Biography")
    body = {
        "isbn": book["isbn"],
        "title": "Wings of Fire: An Autobiography",
        "author": "A. P. J. Abdul Kalam",
        "genre": "Biography",
        "published_year": 1999,
    }
    response = client.put(f"/api/books/{book['id']}", json=body)
    assert response.status_code == 200
    assert response.json()["title"] == "Wings of Fire: An Autobiography"
    assert client.get(f"/api/books/{book['id']}").json()["published_year"] == 1999


def test_put_cannot_take_another_books_isbn(client, make_book):
    first, second = make_book(), make_book()
    body = {"isbn": first["isbn"], "title": "x", "author": "y", "genre": "Fiction"}
    assert client.put(f"/api/books/{second['id']}", json=body).status_code == 409


def test_delete_book_without_history(client, make_book):
    book = make_book(copies=2)
    assert client.delete(f"/api/books/{book['id']}").status_code == 204
    assert client.get(f"/api/books/{book['id']}").status_code == 404


def test_book_with_lending_history_cannot_be_deleted(client, make_book, make_member, borrow):
    book = make_book()
    loan = borrow(make_member(), book)
    client.post(f"/api/loans/{loan['id']}/return")
    response = client.delete(f"/api/books/{book['id']}")
    assert response.status_code == 409
    assert response.json()["code"] == "book_has_history"


def test_add_update_and_withdraw_copies(client, make_book, make_member, borrow):
    book = make_book(copies=1)
    added = client.post(f"/api/books/{book['id']}/copies", json={"condition": "new", "shelf": "T-04"})
    assert added.status_code == 201
    assert added.json()["barcode"] == f"SW{book['id']:04d}-02"
    assert added.json()["status"] == "available"

    copy_id = added.json()["id"]
    updated = client.put(f"/api/copies/{copy_id}", json={"condition": "worn", "shelf": "T-05"})
    assert updated.json()["condition"] == "worn"

    loan = borrow(make_member(), book)  # takes the first copy
    on_loan = client.delete(f"/api/copies/{loan['copy_id']}")
    assert on_loan.status_code == 409
    assert on_loan.json()["code"] == "copy_on_loan"

    assert client.delete(f"/api/copies/{copy_id}").status_code == 204
    detail = client.get(f"/api/books/{book['id']}").json()
    assert {c["id"]: c["status"] for c in detail["copies"]}[copy_id] == "withdrawn"
    assert detail["copies_total"] == 1  # withdrawn copies no longer count
    assert client.delete(f"/api/copies/{copy_id}").json()["code"] == "copy_withdrawn"
