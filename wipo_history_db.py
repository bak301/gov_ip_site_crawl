"""Small JSON-over-stdio SQLite service for the WIPO application tracker."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

for stream in (sys.stdin, sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def stable(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: stable(value[key]) for key in sorted(value) if key != "scraped_at"}
    if isinstance(value, list):
        return [stable(item) for item in value]
    return "" if value is None else value


def flatten(value: Any, prefix: str = "", output: dict[str, str] | None = None) -> dict[str, str]:
    output = output if output is not None else {}
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "scraped_at":
                continue
            path = f"{prefix}.{key}" if prefix else key
            if isinstance(item, dict):
                flatten(item, path, output)
            elif isinstance(item, list):
                output[path] = json.dumps(stable(item), ensure_ascii=False, separators=(",", ":"))
            else:
                output[path] = "" if item is None else str(item)
    else:
        output[prefix] = "" if value is None else str(value)
    return output


def application_no(record: dict[str, Any]) -> str:
    split = record.get("split_fields") or {}
    app = split.get("application_number_date") or {}
    fields = record.get("fields") or {}
    raw = app.get("application_no") or app.get("number") or fields.get("(20) Số đơn và Ngày nộp đơn") or fields.get("(200) Số đơn và Ngày nộp đơn") or record.get("id") or ""
    text = str(raw).strip().upper().removeprefix("VN").strip()
    import re
    match = re.search(r"[1-5]-\d{4}-\d{4,}", text)
    return match.group(0) if match else text


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=30000")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS applications (
            application_no TEXT PRIMARY KEY,
            latest_snapshot_id INTEGER,
            first_scraped_at TEXT NOT NULL,
            last_scraped_at TEXT NOT NULL,
            scrape_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_no TEXT NOT NULL,
            scraped_at TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT '',
            content_hash TEXT NOT NULL,
            data_json TEXT NOT NULL,
            changes_json TEXT NOT NULL DEFAULT '[]',
            previous_snapshot_id INTEGER,
            FOREIGN KEY(application_no) REFERENCES applications(application_no)
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_app_time ON snapshots(application_no, scraped_at DESC, id DESC);
    """)
    return db


def diff(previous: dict[str, Any] | None, current: dict[str, Any]) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []

    def display(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            return json.dumps(stable(value), ensure_ascii=False, separators=(",", ":"))
        return str(value)

    def row_identity(path: str, row: Any) -> str:
        if not isinstance(row, dict):
            return f"value:{display(row)}"
        if path == "diary":
            date = row.get("date") or {}
            date_text = (date.get("iso") or date.get("raw")) if isinstance(date, dict) else date
            date_text = date_text or row.get("date_text") or ""
            event = row.get("description") or row.get("event") or row.get("title") or row.get("raw") or ""
            if date_text or event:
                return f"event:{date_text}|{event}"
        for key in ("application_no", "priority_no", "reference_no", "applicant_name", "inventor_name", "representative_name", "name", "code", "number", "id"):
            if row.get(key) not in (None, ""):
                return f"{key}:{row[key]}"
        if row.get("order") not in (None, ""):
            return f"order:{row['order']}"
        return f"value:{display(row)}"

    def rows_by_identity(path: str, rows: list[Any]) -> dict[str, tuple[int, Any]]:
        result: dict[str, tuple[int, Any]] = {}
        seen: dict[str, int] = {}
        for index, row in enumerate(rows):
            identity = row_identity(path, row)
            seen[identity] = seen.get(identity, 0) + 1
            result[f"{identity}#{seen[identity]}"] = (index, row)
        return result

    def compare(path: str, old: Any, new: Any) -> None:
        if isinstance(old, dict) or isinstance(new, dict):
            old_dict = old if isinstance(old, dict) else {}
            new_dict = new if isinstance(new, dict) else {}
            for key in sorted(set(old_dict) | set(new_dict)):
                if key != "scraped_at":
                    compare(f"{path}.{key}" if path else key, old_dict.get(key), new_dict.get(key))
            return
        if isinstance(old, list) or isinstance(new, list):
            old_rows = rows_by_identity(path, old if isinstance(old, list) else [])
            new_rows = rows_by_identity(path, new if isinstance(new, list) else [])
            for identity in dict.fromkeys([*old_rows, *new_rows]):
                old_entry = old_rows.get(identity)
                new_entry = new_rows.get(identity)
                old_value = old_entry[1] if old_entry else None
                new_value = new_entry[1] if new_entry else None
                if stable(old_value) == stable(new_value):
                    continue
                index = new_entry[0] if new_entry else old_entry[0]
                changes.append({
                    "field": f"{path}[{index}]", "oldValue": display(old_value), "newValue": display(new_value),
                    "changeType": "changed" if old_entry and new_entry else ("added" if new_entry else "removed"),
                })
            return
        if stable(old) != stable(new):
            changes.append({"field": path, "oldValue": display(old), "newValue": display(new)})

    compare("", previous or {}, current)
    return sorted(changes, key=lambda change: change["field"])


def ingest(db: sqlite3.Connection, record: dict[str, Any], source: str = "") -> dict[str, Any]:
    app_no = application_no(record)
    if not app_no:
        raise ValueError("Could not determine the application number from the scraped record.")
    scraped_at = str(record.get("scraped_at") or now_iso())
    current = db.execute("SELECT * FROM applications WHERE application_no=?", (app_no,)).fetchone()
    previous_row = None
    previous = None
    if current and current["latest_snapshot_id"]:
        previous_row = db.execute("SELECT * FROM snapshots WHERE id=?", (current["latest_snapshot_id"],)).fetchone()
        previous = json.loads(previous_row["data_json"])
    changes = diff(previous, record) if previous is not None else []
    canonical = json.dumps(stable(record), ensure_ascii=False, separators=(",", ":"))
    content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    data_json = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    with db:
        if not current:
            db.execute("INSERT INTO applications(application_no, first_scraped_at, last_scraped_at, scrape_count) VALUES(?,?,?,0)", (app_no, scraped_at, scraped_at))
        cursor = db.execute(
            "INSERT INTO snapshots(application_no,scraped_at,source,content_hash,data_json,changes_json,previous_snapshot_id) VALUES(?,?,?,?,?,?,?)",
            (app_no, scraped_at, source, content_hash, data_json, json.dumps(changes, ensure_ascii=False), previous_row["id"] if previous_row else None),
        )
        db.execute("UPDATE applications SET latest_snapshot_id=?, last_scraped_at=?, scrape_count=scrape_count+1 WHERE application_no=?", (cursor.lastrowid, scraped_at, app_no))
    return {"applicationNo": app_no, "snapshotId": cursor.lastrowid, "scrapedAt": scraped_at, "changes": changes}


def list_apps(db: sqlite3.Connection, requested: list[str] | None = None) -> list[dict[str, Any]]:
    rows = db.execute("""
        SELECT a.application_no, a.first_scraped_at, a.last_scraped_at, a.scrape_count,
               s.id snapshot_id, s.data_json, s.changes_json, p.data_json previous_data_json
        FROM applications a LEFT JOIN snapshots s ON s.id=a.latest_snapshot_id
        LEFT JOIN snapshots p ON p.id=s.previous_snapshot_id
        ORDER BY a.last_scraped_at DESC, a.application_no
    """).fetchall()
    wanted = {str(item).strip().upper() for item in (requested or [])}
    result = []
    for row in rows:
        if wanted and row["application_no"].upper() not in wanted:
            continue
        data = json.loads(row["data_json"]) if row["data_json"] else None
        fields = (data or {}).get("fields") or {}
        title = ((data or {}).get("split_fields") or {}).get("title") or fields.get("(54) Tên") or fields.get("(54) Tên kiểu dáng") or fields.get("(541) Nhãn hiệu") or fields.get("(571) Nhãn hiệu") or ""
        status = ((data or {}).get("split_fields") or {}).get("status") or ((data or {}).get("fields") or {}).get("Trạng thái") or ""
        result.append({
            "applicationNo": row["application_no"], "firstScrapedAt": row["first_scraped_at"],
            "lastScrapedAt": row["last_scraped_at"], "scrapeCount": row["scrape_count"],
            "snapshotId": row["snapshot_id"], "title": title, "status": status,
            "changeCount": len(diff(json.loads(row["previous_data_json"]), data)) if row["previous_data_json"] else 0,
        })
    return result


def detail(db: sqlite3.Connection, app_no: str) -> dict[str, Any] | None:
    rows = db.execute("SELECT * FROM snapshots WHERE application_no=? ORDER BY scraped_at DESC, id DESC", (app_no,)).fetchall()
    if not rows:
        return None
    data_by_id = {row["id"]: json.loads(row["data_json"]) for row in rows}
    snapshots = [{
        "id": row["id"], "scrapedAt": row["scraped_at"], "source": row["source"],
        "contentHash": row["content_hash"], "data": data_by_id[row["id"]],
        "changes": diff(data_by_id[row["previous_snapshot_id"]], data_by_id[row["id"]]) if row["previous_snapshot_id"] in data_by_id else [],
        "previousSnapshotId": row["previous_snapshot_id"],
    } for row in rows]
    return {"applicationNo": app_no, "latest": snapshots[0], "snapshots": snapshots}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("database")
    parser.add_argument("command", choices=("init", "ingest", "list", "detail"))
    parser.add_argument("--application-no", default="")
    args = parser.parse_args()
    db = connect(Path(args.database))
    payload = json.load(sys.stdin) if args.command in ("ingest", "list") and not sys.stdin.isatty() else {}
    if args.command == "init":
        result = {"ok": True, "database": str(Path(args.database).resolve())}
    elif args.command == "ingest":
        records = payload.get("records") if isinstance(payload, dict) else None
        records = records if isinstance(records, list) else [payload.get("record") or payload]
        result = {"ok": True, "results": [ingest(db, record, str(payload.get("source") or "")) for record in records if isinstance(record, dict)]}
    elif args.command == "list":
        result = {"ok": True, "applications": list_apps(db, payload.get("applicationNos") if isinstance(payload, dict) else None)}
    else:
        result = {"ok": True, "detail": detail(db, args.application_no)}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
