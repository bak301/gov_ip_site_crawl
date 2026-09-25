"""SQLite storage helper for the WIPO Puppeteer scraper.

Uses only the Python standard library. The JavaScript scraper calls the `merge`
command after every page; the historical converter uses the streaming `import`
command so the 90+ MB tracking file never needs to be loaded into memory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


# The helper exchanges JSON with Node through redirected standard streams.
# Pin all streams to UTF-8 because Windows otherwise commonly inherits an ANSI
# code page and corrupts Vietnamese/Chinese text before json.load sees it.
for _stream in (sys.stdin, sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")


DATA_FIELDS = (
    "record_id",
    "mode",
    "title",
    "application_number",
    "filing_date",
    "publication_number",
    "publication_date",
    "registration_number",
    "registration_date",
    "classification_primary",
    "classification_secondary",
    "applicant_owner",
    "creator",
    "status",
    "priority_country",
    "priority_number",
    "priority_date",
)
APPLICATION_RE = re.compile(r"\b(?:[A-Z]{2,5}-)?\d{1,2}-\d{4}-\d{4,}\b", re.I)
DATE_RE = re.compile(r"\b\d{2}\.\d{2}\.\d{4}\b")
SURROGATE_RE = re.compile(r"[\ud800-\udfff]")
MOJIBAKE_MARKERS = ("Ã", "Â", "Ä", "Æ", "â", "ð", "ï", "�")


def mojibake_score(value: str) -> int:
    return sum(value.count(marker) for marker in MOJIBAKE_MARKERS)


def repair_mojibake(value: str) -> str:
    """Reverse the common UTF-8-as-Windows-1252 corruption when provably better."""
    if not value or mojibake_score(value) == 0:
        return value
    candidate = value
    # Two passes cover strings that were accidentally re-decoded more than once.
    for _ in range(2):
        try:
            repaired = candidate.encode("cp1252").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if mojibake_score(repaired) >= mojibake_score(candidate):
            break
        candidate = repaired
    return candidate


def repair_json_value(value: Any) -> Any:
    if isinstance(value, str):
        return repair_mojibake(value)
    if isinstance(value, list):
        return [repair_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: repair_json_value(item) for key, item in value.items()}
    return value


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").strip()
    # Browser text can occasionally contain an unpaired UTF-16 surrogate.
    # Such values are valid inside JavaScript strings but cannot be encoded as
    # UTF-8 by Python or SQLite. Preserve the position using U+FFFD.
    return repair_mojibake(SURROGATE_RE.sub("\ufffd", text))


def normalize_mode(mode: Any) -> str:
    if mode in (1, "1"):
        return "Trademarks"
    if mode in (2, "2"):
        return "Patents"
    if mode in (3, "3"):
        return "Designs"
    value = clean(mode)
    lowered = value.lower()
    if lowered.startswith("trademark"):
        return "Trademarks"
    if lowered.startswith("patent"):
        return "Patents"
    if lowered.startswith("design"):
        return "Designs"
    return value or "Unknown"


def extract_application_number(value: Any) -> str:
    text = clean(value).upper()
    match = APPLICATION_RE.search(text)
    return match.group(0) if match else text


def normalize_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = clean(value)
        try:
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
                parsed = datetime.fromisoformat(text).replace(tzinfo=timezone.utc)
            else:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            parsed = datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalize_record(row: list[Any], mode: Any) -> dict[str, str]:
    values = [clean(value) for value in row]
    record = {field: "" for field in DATA_FIELDS}
    record["record_id"] = values[0] if values else ""
    record["mode"] = normalize_mode(mode)

    if record["mode"] == "Designs":
        fields = (
            "status", "title", "application_number", "filing_date",
            "publication_number", "publication_date", "priority_country",
            "priority_number", "priority_date", "classification_primary",
            "registration_number", "registration_date", "applicant_owner", "creator",
        )
    elif record["mode"] == "Patents":
        fields = (
            "title", "application_number", "filing_date", "publication_number",
            "publication_date", "registration_number", "registration_date",
            "classification_primary", "applicant_owner", "creator", "status",
        )
    else:
        fields = (
            "title", "application_number", "filing_date", "publication_number",
            "publication_date", "registration_number", "registration_date",
            "classification_primary", "classification_secondary", "applicant_owner", "status",
        )

    for field, value in zip(fields, values[1:]):
        record[field] = value
    record["application_number"] = extract_application_number(record["application_number"])
    if not record["application_number"]:
        record["application_number"] = f"ID:{record['record_id']}"
    return record


def stable_json(record: dict[str, str]) -> str:
    return json.dumps(
        {field: clean(record.get(field)) for field in DATA_FIELDS},
        ensure_ascii=False,
        separators=(",", ":"),
    )


def connect(database_path: Path) -> sqlite3.Connection:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA foreign_keys=ON")
    create_schema(connection)
    return connection


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS applications (
            application_number TEXT PRIMARY KEY,
            record_id TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '', filing_date TEXT NOT NULL DEFAULT '',
            publication_number TEXT NOT NULL DEFAULT '', publication_date TEXT NOT NULL DEFAULT '',
            registration_number TEXT NOT NULL DEFAULT '', registration_date TEXT NOT NULL DEFAULT '',
            classification_primary TEXT NOT NULL DEFAULT '',
            classification_secondary TEXT NOT NULL DEFAULT '',
            applicant_owner TEXT NOT NULL DEFAULT '', creator TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '', priority_country TEXT NOT NULL DEFAULT '',
            priority_number TEXT NOT NULL DEFAULT '', priority_date TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '', first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            content_hash TEXT NOT NULL, data_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS application_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_number TEXT NOT NULL, content_hash TEXT NOT NULL,
            first_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL,
            seen_count INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT '',
            data_json TEXT NOT NULL, UNIQUE(application_number, content_hash)
        );
        CREATE TABLE IF NOT EXISTS application_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_number TEXT NOT NULL, changed_at TEXT NOT NULL,
            field_name TEXT NOT NULL, old_value TEXT NOT NULL DEFAULT '',
            new_value TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
            old_content_hash TEXT NOT NULL, new_content_hash TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_applications_record_id ON applications(record_id);
        CREATE INDEX IF NOT EXISTS idx_applications_last_seen ON applications(last_seen_at);
        CREATE INDEX IF NOT EXISTS idx_snapshots_application_time
            ON application_snapshots(application_number, first_observed_at);
        CREATE INDEX IF NOT EXISTS idx_changes_application_time
            ON application_changes(application_number, changed_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_changes_unique_transition
            ON application_changes(
                application_number, changed_at, field_name, old_value, new_value,
                old_content_hash, new_content_hash
            );
        """
    )


def merge_records(
    connection: sqlite3.Connection,
    rows: Iterable[list[Any]],
    mode: Any,
    source: Any,
    observed_at: Any,
) -> dict[str, int]:
    observed = normalize_timestamp(observed_at)
    source_text = clean(source)
    stats = {"inserted": 0, "updated": 0, "unchanged": 0, "historical": 0, "changes": 0}

    with connection:
        for row in rows:
            record = normalize_record(row, mode)
            data_json = stable_json(record)
            content_hash = hashlib.sha256(data_json.encode("utf-8")).hexdigest()
            application_number = record["application_number"]
            current = connection.execute(
                "SELECT * FROM applications WHERE application_number=?", (application_number,)
            ).fetchone()
            snapshot_exists = connection.execute(
                """
                SELECT 1 FROM application_snapshots
                WHERE application_number=? AND content_hash=?
                """,
                (application_number, content_hash),
            ).fetchone() is not None

            connection.execute(
                """
                INSERT INTO application_snapshots (
                    application_number, content_hash, first_observed_at,
                    last_observed_at, seen_count, source, data_json
                ) VALUES (?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(application_number, content_hash) DO UPDATE SET
                    first_observed_at=MIN(first_observed_at, excluded.first_observed_at),
                    last_observed_at=MAX(last_observed_at, excluded.last_observed_at),
                    seen_count=seen_count + CASE
                        WHEN excluded.first_observed_at < first_observed_at
                          OR excluded.last_observed_at > last_observed_at
                        THEN 1 ELSE 0 END
                """,
                (application_number, content_hash, observed, observed, source_text, data_json),
            )

            if current is None:
                values = [record[field] for field in DATA_FIELDS]
                connection.execute(
                    f"""
                    INSERT INTO applications (
                        {', '.join(DATA_FIELDS)}, source, first_seen_at, last_seen_at,
                        updated_at, content_hash, data_json
                    ) VALUES ({', '.join('?' for _ in range(len(DATA_FIELDS) + 6))})
                    """,
                    (*values, source_text, observed, observed, observed, content_hash, data_json),
                )
                stats["inserted"] += 1
                continue

            first_seen = min(observed, current["first_seen_at"])
            last_seen = max(observed, current["last_seen_at"])
            if current["content_hash"] == content_hash:
                connection.execute(
                    "UPDATE applications SET first_seen_at=?, last_seen_at=? WHERE application_number=?",
                    (first_seen, last_seen, application_number),
                )
                stats["unchanged"] += 1
                continue

            if observed < current["last_seen_at"] or (
                snapshot_exists and observed == current["last_seen_at"]
            ):
                connection.execute(
                    "UPDATE applications SET first_seen_at=?, last_seen_at=? WHERE application_number=?",
                    (first_seen, last_seen, application_number),
                )
                stats["historical"] += 1
                continue

            for field in DATA_FIELDS:
                old_value = clean(current[field])
                new_value = clean(record[field])
                if old_value != new_value:
                    change_cursor = connection.execute(
                        """
                        INSERT OR IGNORE INTO application_changes (
                            application_number, changed_at, field_name, old_value, new_value,
                            source, old_content_hash, new_content_hash
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            application_number, observed, field, old_value, new_value,
                            source_text, current["content_hash"], content_hash,
                        ),
                    )
                    stats["changes"] += change_cursor.rowcount

            assignments = ", ".join(f"{field}=?" for field in DATA_FIELDS if field != "application_number")
            update_values = [record[field] for field in DATA_FIELDS if field != "application_number"]
            connection.execute(
                f"""
                UPDATE applications SET {assignments}, source=?, first_seen_at=?, last_seen_at=?,
                    updated_at=?, content_hash=?, data_json=?
                WHERE application_number=?
                """,
                (*update_values, source_text, first_seen, last_seen, observed, content_hash, data_json, application_number),
            )
            stats["updated"] += 1
    return stats


def split_combined(value: str) -> tuple[str, str, str]:
    text = clean(value)
    application = extract_application_number(text)
    date_match = DATE_RE.search(text)
    date = date_match.group(0) if date_match else ""
    number = text.replace(application, "", 1).replace(date, "", 1).strip()
    return application, date, number


def parse_tracking_line(line: str, line_number: int) -> tuple[str, str, str, list[str]] | None:
    if line_number == 1 and line.lower().startswith("run_date\t"):
        return None
    columns = line.rstrip("\r\n").split("\t")
    if len(columns) == 14:
        return columns[0], columns[2] or "NextPage_Scraper", "Trademarks", [columns[1], *columns[3:]]
    if len(columns) in (15, 18):
        return columns[0], columns[2] or "NextPage_Scraper", columns[3], [columns[1], *columns[4:]]
    if len(columns) == 24:
        application, filing_date, _ = split_combined(columns[10])
        _, publication_date, publication_number = split_combined(columns[11])
        row = [
            columns[1], columns[12], application, filing_date, publication_number,
            publication_date, "", "", columns[15], columns[16], columns[17], columns[8],
        ]
        return columns[0], columns[3] or "NextPage_Scraper", columns[2] or columns[5], row
    raise ValueError(f"Unsupported {len(columns)}-column layout at line {line_number}")


def import_tracking(connection: sqlite3.Connection, input_path: Path) -> dict[str, int]:
    totals = {
        "lines": 0, "parsed": 0, "skipped": 0, "inserted": 0,
        "updated": 0, "unchanged": 0, "historical": 0, "changes": 0,
    }
    batches: dict[tuple[str, str, str], list[list[str]]] = {}

    def flush() -> None:
        nonlocal batches
        for (observed, source, mode), rows in batches.items():
            stats = merge_records(connection, rows, mode, source, observed)
            for key, value in stats.items():
                totals[key] += value
        batches = {}

    with input_path.open("r", encoding="utf-8", newline="") as stream:
        for line_number, line in enumerate(stream, 1):
            totals["lines"] = line_number
            if not line.strip():
                totals["skipped"] += 1
                continue
            parsed = parse_tracking_line(line, line_number)
            if parsed is None:
                totals["skipped"] += 1
                continue
            observed, source, mode, row = parsed
            batches.setdefault((observed, source, mode), []).append(row)
            totals["parsed"] += 1
            if sum(map(len, batches.values())) >= 2000:
                flush()
            if line_number % 50000 == 0:
                print(f"Processed {line_number:,} lines...", flush=True)
    flush()
    return totals


def repair_current_encoding(connection: sqlite3.Connection, dry_run: bool = False) -> dict[str, int]:
    """Repair mojibake in current application rows without rewriting history tables."""
    stats = {"scanned": 0, "rows_repaired": 0, "fields_repaired": 0, "json_repaired": 0}
    select_fields = ", ".join(DATA_FIELDS)
    rows = connection.execute(
        f"SELECT {select_fields}, data_json FROM applications"
    )
    updates: list[tuple[Any, ...]] = []
    for row in rows:
        stats["scanned"] += 1
        record = {field: row[field] for field in DATA_FIELDS}
        original_record = {
            field: SURROGATE_RE.sub("\ufffd", str(value if value is not None else "").replace("\r\n", "\n").strip())
            for field, value in record.items()
        }
        repaired_record = {field: repair_mojibake(value) for field, value in original_record.items()}
        changed_fields = sum(repaired_record[field] != original_record[field] for field in DATA_FIELDS)
        try:
            parsed_json = json.loads(row["data_json"] or "{}")
            repaired_json_value = repair_json_value(parsed_json)
            repaired_json = stable_json(repaired_json_value)
        except (TypeError, ValueError):
            original_json = str(row["data_json"] or "").strip()
            repaired_json = repair_mojibake(original_json)
        json_changed = repaired_json != str(row["data_json"] or "").strip()
        if not changed_fields and not json_changed:
            continue
        content_hash = hashlib.sha256(repaired_json.encode("utf-8")).hexdigest()
        updates.append((
            *(repaired_record[field] for field in DATA_FIELDS if field != "application_number"),
            content_hash,
            repaired_json,
            original_record["application_number"],
        ))
        stats["rows_repaired"] += 1
        stats["fields_repaired"] += changed_fields
        stats["json_repaired"] += int(json_changed)
        if len(updates) >= 1000:
            if not dry_run:
                assignments = ", ".join(f"{field}=?" for field in DATA_FIELDS if field != "application_number")
                connection.executemany(
                    f"UPDATE applications SET {assignments}, content_hash=?, data_json=? WHERE application_number=?",
                    updates,
                )
                connection.commit()
            updates = []
    if updates and not dry_run:
        assignments = ", ".join(f"{field}=?" for field in DATA_FIELDS if field != "application_number")
        connection.executemany(
            f"UPDATE applications SET {assignments}, content_hash=?, data_json=? WHERE application_number=?",
            updates,
        )
        connection.commit()
    return stats


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "merge"):
        command = subparsers.add_parser(name)
        command.add_argument("--db", required=True, type=Path)
    repair_command = subparsers.add_parser("repair-encoding")
    repair_command.add_argument("--db", required=True, type=Path)
    repair_command.add_argument("--dry-run", action="store_true")
    import_command = subparsers.add_parser("import")
    import_command.add_argument("--db", required=True, type=Path)
    import_command.add_argument("--input", required=True, type=Path)
    args = parser.parse_args()

    connection = connect(args.db)
    try:
        if args.command == "init":
            connection.commit()
            return 0
        if args.command == "merge":
            request = json.load(sys.stdin)
            stats = merge_records(
                connection,
                request.get("records", []),
                request.get("mode"),
                request.get("source"),
                request.get("observedAt"),
            )
            print(json.dumps(stats))
            return 0
        if args.command == "repair-encoding":
            stats = repair_current_encoding(connection, args.dry_run)
            stats["dry_run"] = bool(args.dry_run)
            print(json.dumps(stats, ensure_ascii=False, indent=2))
            return 0
        if not args.input.exists():
            raise FileNotFoundError(f"Input file not found: {args.input}")
        print(f"Importing: {args.input}")
        print(f"SQLite:   {args.db}")
        totals = import_tracking(connection, args.input)
        print("Import complete:")
        print(json.dumps(totals, indent=2))
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
