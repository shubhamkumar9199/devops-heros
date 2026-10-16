#!/bin/sh
# Wait for PostgreSQL, migrate (replicas take turns via an advisory lock), serve.
set -eu

python -m app.wait_for_db
alembic upgrade head

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --proxy-headers \
  --forwarded-allow-ips='*' \
  --timeout-graceful-shutdown 20 \
  --no-server-header
