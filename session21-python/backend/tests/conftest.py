"""Test setup. The app never sees a real database: DATABASE_URL points at a
throwaway SQLite file (or, in CI's integration job, a disposable PostgreSQL
container named by TEST_DATABASE_URL) before the app is imported, and the schema
is built by running the real Alembic migrations, so they are tested too."""

import itertools
import os
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL") or (
    f"sqlite+pysqlite:///{tempfile.mkdtemp(prefix='shelfwise-test-')}/test.db"
)
os.environ.setdefault("APP_VERSION", "test")

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402

TABLES = ("activity", "holds", "loans", "copies", "members", "books")  # children first


def alembic_config() -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.attributes["configure_logger"] = False
    return cfg


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    command.upgrade(alembic_config(), "head")
    yield


@pytest.fixture(autouse=True)
def empty_tables(migrated_db):
    with engine.begin() as conn:
        for table in TABLES:
            conn.execute(text(f"DELETE FROM {table}"))  # noqa: S608 (fixed table names)
    yield


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


class FrozenClock:
    """Replaces app.clock.now so a test can move time forward."""

    def __init__(self):
        self.value = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.value

    def advance(self, **delta) -> datetime:
        self.value += timedelta(**delta)
        return self.value


@pytest.fixture
def clock(monkeypatch):
    frozen = FrozenClock()
    monkeypatch.setattr("app.clock.now", frozen)
    return frozen


_isbn_seq = itertools.count(1)


def valid_isbn13() -> str:
    """A fresh ISBN-13 with a correct check digit."""
    first12 = f"979{next(_isbn_seq):09d}"
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(first12))
    return first12 + str((10 - total % 10) % 10)


@pytest.fixture
def make_book(client):
    def _make(copies: int = 1, **fields) -> dict:
        body = {
            "isbn": valid_isbn13(),
            "title": "The Guide",
            "author": "R. K. Narayan",
            "genre": "Fiction",
            "published_year": 1958,
            "copies": copies,
            **fields,
        }
        response = client.post("/api/books", json=body)
        assert response.status_code == 201, response.text
        return response.json()

    return _make


_email_seq = itertools.count(1)


@pytest.fixture
def make_member(client):
    def _make(member_type: str = "student", name: str | None = None) -> dict:
        n = next(_email_seq)
        body = {
            "name": name or f"Member {n}",
            "email": f"member{n}@campus.example",
            "member_type": member_type,
        }
        response = client.post("/api/members", json=body)
        assert response.status_code == 201, response.text
        return response.json()

    return _make


@pytest.fixture
def borrow(client):
    def _borrow(member: dict, book: dict, expect: int = 201) -> dict:
        response = client.post("/api/loans", json={"member_id": member["id"], "book_id": book["id"]})
        assert response.status_code == expect, response.text
        return response.json()

    return _borrow
