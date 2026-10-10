"""
Regression test for a real Alembic-against-PostgreSQL migration run.

The rest of the backend test suite runs against SQLite (see conftest.py) and never executes the
Alembic migration files at all — models and migrations are independent code paths in this
project. That is exactly how a real production bug (PostgreSQL DuplicateObject on a fresh
database, root-caused in migration 001/002/006/007's enum columns, plus two further issues in
the Alembic setup itself: a too-narrow alembic_version.version_num column, and a transaction
left open before Alembic took control) went undetected for a long time.

This test is opt-in: it needs a real, disposable PostgreSQL database, which CI/local SQLite runs
don't have. Set MIGRATION_TEST_DATABASE_URL to run it, e.g.:

    MIGRATION_TEST_DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/sheguard_migration_test \
        venv/Scripts/python.exe -m pytest tests/test_migrations_postgres.py -v

The target database is dropped and recreated by this test — point it at a throwaway database,
never at a database with real data.
"""
import os
import pathlib

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic import command

MIGRATION_TEST_DATABASE_URL = os.getenv("MIGRATION_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not MIGRATION_TEST_DATABASE_URL,
    reason="Set MIGRATION_TEST_DATABASE_URL to a disposable Postgres database to run this test",
)

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent

EXPECTED_TABLES = {
    "users", "devices", "refresh_sessions", "trusted_contacts", "emergency_events",
    "emergency_locations", "emergency_communication_logs", "route_safety_sessions",
    "route_safety_communication_logs", "evidence_items", "incident_reports",
    "evidence_delivery_logs",
}
EXPECTED_ENUMS = {
    "emergency_trigger_source_enum", "emergency_state_enum", "communication_channel_enum",
    "communication_status_enum", "emergency_location_kind_enum", "route_safety_status_enum",
    "route_deviation_state_enum", "evidence_upload_status_enum",
}


@pytest.fixture
def fresh_postgres_db():
    # Can't DROP/CREATE the target database while connected to it — connect to the "postgres"
    # maintenance database on the same server instead.
    target_url = sa.engine.make_url(MIGRATION_TEST_DATABASE_URL)
    db_name = target_url.database
    admin_engine = sa.create_engine(target_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{db_name}"'))
        conn.execute(sa.text(f'CREATE DATABASE "{db_name}"'))
    admin_engine.dispose()
    yield MIGRATION_TEST_DATABASE_URL


def _alembic_config(database_url: str) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    os.environ["DATABASE_URL"] = database_url
    return cfg


def test_fresh_database_migrates_to_head_without_duplicate_object_errors(fresh_postgres_db):
    cfg = _alembic_config(fresh_postgres_db)
    command.upgrade(cfg, "head")  # must not raise DuplicateObject / StringDataRightTruncation / etc.

    engine = sa.create_engine(fresh_postgres_db)
    with engine.connect() as conn:
        current = conn.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()
        assert current == "007_phaseb_evidence_and_reports"

        tables = set(sa.inspect(conn).get_table_names())
        assert EXPECTED_TABLES <= tables

        enum_names = {
            row[0]
            for row in conn.execute(sa.text("SELECT typname FROM pg_type WHERE typtype = 'e'"))
        }
        assert EXPECTED_ENUMS <= enum_names

        # The two values migration 005 adds via a dedicated AUTOCOMMIT connection.
        status_values = {
            row[0]
            for row in conn.execute(
                sa.text("SELECT enumlabel FROM pg_enum WHERE enumtypid = 'communication_status_enum'::regtype")
            )
        }
        assert {"NOT_SENT", "UNCERTAIN"} <= status_values


def test_upgrade_head_is_idempotent_on_an_already_migrated_database(fresh_postgres_db):
    cfg = _alembic_config(fresh_postgres_db)
    command.upgrade(cfg, "head")
    command.upgrade(cfg, "head")  # must be a safe no-op, not an error

    engine = sa.create_engine(fresh_postgres_db)
    with engine.connect() as conn:
        current = conn.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()
        assert current == "007_phaseb_evidence_and_reports"
