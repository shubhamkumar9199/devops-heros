"""Runtime settings, read from environment variables only.

In Kubernetes, DB_HOST / DB_PORT / DB_NAME / DB_USER come from a ConfigMap and
DB_PASSWORD from a Secret. A complete DATABASE_URL (tests, docker compose)
overrides all of them.
"""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field

from sqlalchemy.engine import URL, make_url


def _database_url() -> URL:
    explicit = os.getenv("DATABASE_URL")
    if explicit:
        return make_url(explicit)
    # URL.create escapes the password, so special characters in a Secret are safe.
    return URL.create(
        drivername="postgresql+psycopg",
        username=os.getenv("DB_USER", "shelfwise"),
        password=os.getenv("DB_PASSWORD", ""),
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "shelfwise"),
    )


@dataclass(frozen=True)
class Settings:
    app_name: str = "ShelfWise"
    version: str = field(default_factory=lambda: os.getenv("APP_VERSION", "dev"))
    pod_name: str = field(default_factory=lambda: os.getenv("POD_NAME") or socket.gethostname())
    timezone: str = field(default_factory=lambda: os.getenv("LIBRARY_TIMEZONE", "Asia/Kolkata"))
    database_url: URL = field(default_factory=_database_url)


settings = Settings()
