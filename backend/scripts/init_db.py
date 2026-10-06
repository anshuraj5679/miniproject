from __future__ import annotations

from pathlib import Path
import sys

from sqlalchemy import text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import engine


def split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    in_line_comment = False
    in_block_comment = False
    dollar_tag: str | None = None
    i = 0
    length = len(sql)

    while i < length:
        char = sql[i]
        nxt = sql[i + 1] if i + 1 < length else ""

        if in_line_comment:
            current.append(char)
            if char == "\n":
                in_line_comment = False
            i += 1
            continue

        if in_block_comment:
            current.append(char)
            if char == "*" and nxt == "/":
                current.append(nxt)
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue

        if dollar_tag:
            if sql.startswith(dollar_tag, i):
                current.extend(list(dollar_tag))
                i += len(dollar_tag)
                dollar_tag = None
                continue
            current.append(char)
            i += 1
            continue

        if not in_single_quote and not in_double_quote:
            if char == "-" and nxt == "-":
                current.append(char)
                current.append(nxt)
                in_line_comment = True
                i += 2
                continue
            if char == "/" and nxt == "*":
                current.append(char)
                current.append(nxt)
                in_block_comment = True
                i += 2
                continue
            if char == "$":
                end = i + 1
                while end < length and (sql[end].isalnum() or sql[end] == "_"):
                    end += 1
                if end < length and sql[end] == "$":
                    tag = sql[i : end + 1]
                    dollar_tag = tag
                    current.extend(list(tag))
                    i = end + 1
                    continue
            if char == ";":
                statement = "".join(current).strip()
                if statement:
                    statements.append(statement)
                current = []
                i += 1
                continue

        if char == "'" and not in_double_quote:
            in_single_quote = not in_single_quote
        elif char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote

        current.append(char)
        i += 1

    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


def run_sql_file(path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    statements = split_sql_statements(sql)
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def main() -> None:
    base = Path(__file__).resolve().parents[1] / "sql"
    for script in (
        "001_extensions.sql",
        "002_schema.sql",
        "004_notifications.sql",
        "005_top_tier_features.sql",
        "006_vectorless_cleanup.sql",
        "007_async_extraction_jobs.sql",
    ):
        run_sql_file(base / script)


if __name__ == "__main__":
    main()
