"""Block until PostgreSQL accepts connections (container entrypoint, before migrations)."""

import os
import sys
import time

from sqlalchemy import text

from app.db import engine


def main(timeout: int) -> int:
    deadline = time.monotonic() + timeout
    attempt = 0
    while True:
        attempt += 1
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print(f"database reachable after {attempt} attempt(s)", flush=True)
            return 0
        except Exception as exc:
            if time.monotonic() > deadline:
                print(f"database still unreachable after {timeout}s: {exc}", file=sys.stderr, flush=True)
                return 1
            print(f"waiting for database ({type(exc).__name__})", flush=True)
            time.sleep(2)


if __name__ == "__main__":
    sys.exit(main(int(os.getenv("DB_WAIT_SECONDS", "90"))))
