"""Archive the mixed publication imports and restore independently sourced WIPO history."""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
import csv
import hashlib
import json
from pathlib import Path
import sqlite3

from wipo_database_helper import DATA_FIELDS, normalize_record, stable_json

IMPORTS = ("Patent publications A/B, CB 454-471", "Local WIPO archives and patent gazettes")
LIVE = "NextPage_Patents_Scraper"
LEGACY_CAPTURE_FIELDS = (
    "record_id", "title", "application_number", "filing_date", "publication_number",
    "publication_date", "registration_number", "registration_date", "classification_primary",
    "applicant_owner", "creator", "status",
)
TABLES = ("applications", "application_snapshots", "application_changes")


def raw_captures(path):
    captures = defaultdict(lambda: defaultdict(set))
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = csv.reader(stream, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(rows, [])
        if len(header) != 12 or header[0] != "ID" or header[2] != "Số đơn gốc":
            raise ValueError("The raw capture does not use the expected Next Page patent format.")
        for row in rows:
            if len(row) != 12:
                continue
            record = normalize_record(row, "Patents")
            for field in LEGACY_CAPTURE_FIELDS:
                if value := record[field]:
                    captures[record["application_number"]][field].add(value)
    return captures


def record_data(snapshot):
    values = json.loads(snapshot["data_json"])
    return {field: values.get(field, "") for field in DATA_FIELDS}


def reconstruct(snapshots, current, captures):
    if not any(row["source"] in IMPORTS for row in snapshots):
        return None
    current_hash = current["content_hash"]
    if current_hash not in {row["content_hash"] for row in snapshots}:
        raise ValueError(f"Missing current snapshot for {current['application_number']}.")

    tainted = set()
    earlier = []
    rebuilt = []
    cutoff = None
    previous = dict.fromkeys(DATA_FIELDS, "")
    clean = previous
    chosen = None
    for snapshot in snapshots:
        values = record_data(snapshot)
        source = snapshot["source"]
        if source in IMPORTS:
            cutoff = cutoff or snapshot["first_observed_at"]
            tainted.update(field for field in DATA_FIELDS
                           if field not in ("application_number", "mode") and values[field] != previous[field])
        elif cutoff is None:
            earlier.append(snapshot)
            clean = values
            chosen = (snapshot, values)
        else:
            if source != LIVE:
                raise ValueError(f"Unexpected later source {source!r} for {current['application_number']}.")
            verified = captures.get(current["application_number"], {})
            recovered = dict(values)
            for field in tainted:
                if field == "bibliographic_source":
                    recovered[field] = ""
                elif values[field] == previous[field] and values[field] not in verified.get(field, ()):
                    recovered[field] = clean[field]
            rebuilt.append((snapshot, clean, recovered))
            clean = recovered
            chosen = (snapshot, recovered)
        previous = values
    return cutoff, earlier, rebuilt, chosen


def encoded(record):
    data = stable_json(record)
    return hashlib.sha256(data.encode("utf-8")).hexdigest(), data


def restore(db, application, plan):
    cutoff, earlier, rebuilt, chosen = plan
    db.execute("DELETE FROM application_snapshots WHERE application_number=? AND id>?",
               (application, earlier[-1]["id"] if earlier else 0))
    db.execute("DELETE FROM application_changes WHERE application_number=? AND changed_at>=?", (application, cutoff))
    if chosen is None:
        db.execute("DELETE FROM applications WHERE application_number=?", (application,))
        return
    for snapshot, old, new in rebuilt:
        content_hash, data = encoded(new)
        db.execute("""
            INSERT INTO application_snapshots (application_number, content_hash, first_observed_at,
              last_observed_at, seen_count, source, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(application_number, content_hash) DO UPDATE SET
              last_observed_at=MAX(last_observed_at, excluded.last_observed_at),
              seen_count=seen_count+excluded.seen_count
            """, (application, content_hash, snapshot["first_observed_at"], snapshot["last_observed_at"],
                  snapshot["seen_count"], snapshot["source"], data))
        if old["application_number"]:
            previous_hash, _ = encoded(old)
            db.executemany("""
                INSERT OR IGNORE INTO application_changes (application_number, changed_at, field_name,
                  old_value, new_value, source, old_content_hash, new_content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, [(application, snapshot["first_observed_at"], field, old[field], new[field],
                       snapshot["source"], previous_hash, content_hash)
                      for field in DATA_FIELDS if old[field] != new[field]])
    snapshot, record = chosen
    content_hash, data = encoded(record)
    first_seen = earlier[0]["first_observed_at"] if earlier else rebuilt[0][0]["first_observed_at"]
    fields = [field for field in DATA_FIELDS if field != "application_number"]
    db.execute(f"""UPDATE applications SET {', '.join(f'{field}=?' for field in fields)},
               source=?, first_seen_at=?, last_seen_at=?, updated_at=?, content_hash=?, data_json=?
               WHERE application_number=?""",
               (*[record[field] for field in fields], snapshot["source"], first_seen, snapshot["last_observed_at"],
                snapshot["first_observed_at"], content_hash, data, application))


def run(db, archive, captures_path, apply):
    keys = [row[0] for row in db.execute("""
        SELECT DISTINCT application_number FROM application_snapshots
        WHERE source IN (?, ?) AND (application_number GLOB '1-*' OR application_number GLOB '2-*')
        ORDER BY application_number
        """, IMPORTS)]
    totals = Counter()
    captures = {}
    last_capture = None
    for offset in range(0, len(keys), 400):
        batch = keys[offset:offset + 400]
        marks = ",".join("?" for _ in batch)
        if apply:
            db.execute("BEGIN IMMEDIATE")
        try:
            stamp = captures_path.stat().st_size
            if stamp != last_capture:
                captures = raw_captures(captures_path)
                last_capture = stamp
            groups = defaultdict(list)
            for row in db.execute(f"SELECT * FROM application_snapshots WHERE application_number IN ({marks}) ORDER BY id", batch):
                groups[row["application_number"]].append(row)
            plans = {}
            for current in db.execute(f"SELECT * FROM applications WHERE application_number IN ({marks})", batch):
                key = current["application_number"]
                plan = reconstruct(groups[key], current, captures)
                if plan is not None:
                    plans[key] = plan
                    totals["publication_only_removed" if plan[-1] is None else
                           "wipo_capture_retained" if plan[2] else "earlier_record_restored"] += 1
            if apply and plans:
                with archive:
                    for table in TABLES:
                        original = db.execute(f"SELECT * FROM {table} WHERE application_number IN ({marks})", batch)
                        placeholders = ",".join("?" for _ in original.description)
                        archive.executemany(f"INSERT INTO {table} VALUES ({placeholders})", original)
                for key, plan in plans.items():
                    restore(db, key, plan)
            if apply:
                db.commit()
        except Exception:
            if apply:
                db.rollback()
            raise
    print(json.dumps(totals))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply and not args.archive:
        parser.error("--apply requires a new --archive file")
    uri = args.db.resolve(strict=True).as_uri()
    with closing(sqlite3.connect(uri + ("?mode=rw" if args.apply else "?mode=ro"), uri=True, timeout=20)) as db:
        db.row_factory = sqlite3.Row
        if args.apply:
            args.archive.touch(exist_ok=False)
            with closing(sqlite3.connect(args.archive)) as archive:
                with archive:
                    for table in TABLES:
                        columns = [row["name"] for row in db.execute(f"PRAGMA table_info({table})")]
                        archive.execute(f"CREATE TABLE {table} ({', '.join(columns)})")
                run(db, archive, args.capture, True)
        else:
            run(db, None, args.capture, False)


if __name__ == "__main__":
    main()
