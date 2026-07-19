"""Database engine and session helpers."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from . import config

# check_same_thread=False: the scheduler runs jobs on background threads that
# need their own sessions against the same SQLite file.
_engine = create_engine(
    f"sqlite:///{config.DB_PATH}",
    echo=False,
    connect_args={"check_same_thread": False},
)


def _migrate() -> None:
    """Add any columns that exist on the models but not yet in the DB.

    SQLModel.create_all() creates missing *tables* but never alters existing
    ones, so new fields on a model would be invisible to an already-created
    database. This lightweight migration adds them (nullable) in place, so we
    keep existing accounts and run history across upgrades.
    """
    insp = inspect(_engine)
    existing_tables = set(insp.get_table_names())
    for table in SQLModel.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            coltype = col.type.compile(_engine.dialect)
            with _engine.begin() as conn:
                if col.name not in have:
                    conn.execute(text(
                        f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {coltype}'
                    ))
                # Backfill NULLs on numeric/bool/text columns so response
                # validation (which expects int/bool/str, not NULL) never fails
                # on rows created before the column existed. Idempotent, and
                # skips genuinely-nullable types like DATETIME.
                affinity = coltype.upper()
                if any(t in affinity for t in ("INT", "BOOL", "FLOAT", "REAL", "NUMERIC")):
                    fill = "0"
                elif any(t in affinity for t in ("CHAR", "TEXT", "CLOB")):
                    fill = "''"
                else:
                    fill = None
                if fill is not None:
                    conn.execute(text(
                        f'UPDATE "{table.name}" SET "{col.name}" = {fill} '
                        f'WHERE "{col.name}" IS NULL'
                    ))


def init_db() -> None:
    config.ensure_dirs()
    SQLModel.metadata.create_all(_engine)
    _migrate()


def get_engine():
    return _engine


def get_session() -> Iterator[Session]:
    """FastAPI dependency: yields a session and closes it afterwards."""
    with Session(_engine) as session:
        yield session


def new_session() -> Session:
    """Standalone session for background (scheduler) work."""
    return Session(_engine)
