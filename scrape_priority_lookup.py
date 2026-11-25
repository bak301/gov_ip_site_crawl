"""Read-only, exact application-number evidence for the shared scrape queue."""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path


APP_NO = re.compile(r"^[1-4]-\d{4}-\d{5}$")


def open_existing(path: str):
    file = Path(path)
    if not file.is_file():
        return None
    return sqlite3.connect(file.resolve().as_uri() + "?mode=ro", uri=True, timeout=3)


def lookup(path: str, table: str, column: str, numbers: list[str]) -> set[str]:
    connection = open_existing(path)
    if connection is None:
        return set()
    try:
        if not connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone():
            return set()
        found = set()
        for start in range(0, len(numbers), 400):
            batch = numbers[start:start + 400]
            forms = [form for number in batch for form in (number, f"VN-{number}")]
            marks = ",".join("?" for _ in forms)
            rows = connection.execute(
                f"SELECT DISTINCT {column} FROM {table} "
                f"WHERE {column} IN ({marks})", forms
            )
            for (raw,) in rows:
                canonical = str(raw or "").upper().removeprefix("VN-")
                if canonical in batch:
                    found.add(canonical)
        return found
    finally:
        connection.close()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    tracker_path, history_path, publication_path = sys.argv[1:4]
    requested = json.load(sys.stdin)
    numbers = list(dict.fromkeys(
        text for value in requested
        if APP_NO.fullmatch(text := str(value or "").strip().upper())
    ))
    tracker = lookup(tracker_path, "applications", "application_no", numbers)
    history = lookup(history_path, "applications", "application_number", numbers)
    publication = lookup(publication_path, "publication_records", "application_number", numbers)
    print(json.dumps({number: {
        "rank": 0 if number in tracker or number in history or number in publication else 1,
        "trackerHistory": number in tracker,
        "wipoHistory": number in history,
        "publication": number in publication,
    } for number in numbers}, ensure_ascii=False))


if __name__ == "__main__":
    main()
