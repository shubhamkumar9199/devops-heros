"""The migrations run up, down and up again on a scratch database."""

import tempfile

from alembic import command
from sqlalchemy import create_engine, inspect

from tests.conftest import alembic_config


def test_migrations_upgrade_downgrade_upgrade():
    scratch = create_engine(f"sqlite+pysqlite:///{tempfile.mkdtemp()}/scratch.db")
    cfg = alembic_config()
    with scratch.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
        assert set(inspect(conn).get_table_names()) >= {"books", "copies", "members", "loans", "holds", "activity"}
        index_names = {ix["name"] for ix in inspect(conn).get_indexes("loans")}
        assert "uq_loans_one_active_per_copy" in index_names

        command.downgrade(cfg, "base")
        assert set(inspect(conn).get_table_names()) <= {"alembic_version"}

        command.upgrade(cfg, "head")
        assert "holds" in inspect(conn).get_table_names()
    scratch.dispose()
