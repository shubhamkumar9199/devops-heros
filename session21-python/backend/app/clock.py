"""The one place the app reads the time, so tests and the seed script can move it."""

from datetime import UTC, datetime


def now() -> datetime:
    return datetime.now(UTC)
