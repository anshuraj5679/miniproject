"""The suite runs on SQLite, so compile statements for Postgres explicitly: production is Postgres."""

from __future__ import annotations

from sqlalchemy import insert
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from app.core.database import Base
from app.models import Chunk


def test_array_columns_compile_for_postgres_inserts() -> None:
    statement = insert(Chunk).values(keywords=["warranty", "gst"], hypothetical_questions=["When does it expire?"])
    compiled = statement.compile(dialect=postgresql.dialect())
    assert "keywords" in str(compiled)


def test_every_table_compiles_for_postgres() -> None:
    dialect = postgresql.dialect()
    for table in Base.metadata.sorted_tables:
        ddl = str(CreateTable(table).compile(dialect=dialect))
        assert table.name in ddl
    chunk_ddl = str(CreateTable(Chunk.__table__).compile(dialect=dialect))
    assert "TEXT[]" in chunk_ddl
