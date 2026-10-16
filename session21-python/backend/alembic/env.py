from logging.config import fileConfig

from alembic import context
from sqlalchemy import text

import app.models  # noqa: F401  (registers the tables on Base.metadata)
from app.config import settings
from app.db import Base, make_engine

config = context.config
if config.config_file_name and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata

# Every replica runs `alembic upgrade head` at start-up. A PostgreSQL advisory
# lock makes them take turns: one migrates, the others wait and then find
# nothing left to do. Any constant works as long as every replica uses it.
MIGRATION_LOCK_ID = 2110_2026


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url.render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection) -> None:
    is_postgres = connection.dialect.name == "postgresql"
    if is_postgres:
        connection.execute(text("SELECT pg_advisory_lock(:id)"), {"id": MIGRATION_LOCK_ID})
        connection.commit()
    try:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    finally:
        if is_postgres:
            connection.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": MIGRATION_LOCK_ID})
            connection.commit()


def run_migrations_online() -> None:
    # Tests can hand in their own connection (to migrate a scratch database).
    given = config.attributes.get("connection")
    if given is not None:
        _run(given)
        return
    engine = make_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            _run(connection)
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
