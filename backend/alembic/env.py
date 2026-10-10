import os
import sys
from logging.config import fileConfig
from sqlalchemy import Column, MetaData, String, Table, engine_from_config, pool
from alembic import context

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.realpath(__file__))))

from app.core.config import settings
from app.db.base import Base
import app.db.models  # Ensures all models are registered

config = context.config

if config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def get_url():
    return settings.DATABASE_URL

def _ensure_wide_version_table(connection) -> None:
    """
    Alembic's own alembic_version.version_num column defaults to VARCHAR(32), but this
    project's revision ids are long descriptive names (e.g.
    '002_phase2a_trusted_contacts_and_communication_logs', 53 chars) — create the tracking
    table ourselves with a wide-enough column before Alembic's own lazy auto-create (which
    always uses the narrow default) has a chance to run. No-op if the table already exists.
    """
    meta = MetaData()
    Table("alembic_version", meta, Column("version_num", String(255), primary_key=True))
    meta.create_all(connection, checkfirst=True)
    # SQLAlchemy 2.0 "autobegins" an implicit transaction on that create_all call. Committing
    # it here (rather than leaving it open) is what lets Alembic's own per-migration
    # transactions (transaction_per_migration=True, below) start clean instead of silently
    # inheriting and reusing this one for the entire run.
    connection.commit()

def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section)
    if not configuration:
        configuration = {}
    configuration["sqlalchemy.url"] = get_url()

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        _ensure_wide_version_table(connection)
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # Each migration commits before the next starts. Needed so that migration 005's
            # dedicated AUTOCOMMIT connection (for Postgres's ALTER TYPE ... ADD VALUE, which
            # cannot run inside a transaction) can see enum types created by earlier,
            # already-committed migrations — a second DB connection can't see another
            # connection's uncommitted work.
            transaction_per_migration=True,
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
