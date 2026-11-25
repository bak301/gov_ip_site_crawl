"""Add the legacy All Patent master to an existing WIPO Next Page database."""

import argparse
import csv
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from wipo_database_helper import create_schema, merge_records


PATENT_NUMBER = re.compile(r"[12]-\d{4}-\d{5,}")
HEADERS = {
    "Application No.", "Filing Date", "Registration No. With Type", "Registration Date",
}


def read_master(filename):
    records = {}
    invalid_dates = []
    with filename.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        if not HEADERS.issubset(reader.fieldnames or ()):
            raise ValueError("Expected the All Patent master headings.")
        for row in reader:
            number = row["Application No."].strip()
            if not PATENT_NUMBER.fullmatch(number) or number in records:
                raise ValueError(f"Invalid or duplicate application number on row {reader.line_num}.")
            dates = []
            for field in ("Filing Date", "Registration Date"):
                value = row[field].strip()
                if value:
                    try:
                        value = datetime.strptime(value, "%d/%m/%Y").strftime("%d/%m/%Y")
                    except ValueError:
                        invalid_dates.append({"application": number, "field": field, "sourceValue": value})
                        value = ""
                dates.append(value)
            registration = row["Registration No. With Type"].strip()
            records[number] = ["", "", number, dates[0], "", "", registration, dates[1]]
    return records, invalid_dates


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--input", type=Path, required=True)
    arguments.add_argument("--db", type=Path, required=True)
    arguments.add_argument("--apply", action="store_true", help="Write the validated rows to the database.")
    options = arguments.parse_args()
    records, invalid_dates = read_master(options.input)
    if not records:
        raise ValueError("The All Patent master is empty.")
    observed = datetime.fromtimestamp(options.input.stat().st_mtime, timezone.utc)
    uri = options.db.resolve(strict=True).as_uri()
    with sqlite3.connect(uri + ("?mode=rw" if options.apply else "?mode=ro"), uri=True, timeout=20) as database:
        database.row_factory = sqlite3.Row
        if options.apply:
            create_schema(database)
            database.execute("BEGIN IMMEDIATE")
        existing = {
            row["application_number"].removeprefix("VN-")
            for row in database.execute(
                """SELECT application_number FROM applications WHERE application_number GLOB '1-*'
                   OR application_number GLOB '2-*' OR application_number GLOB 'VN-1-*'
                   OR application_number GLOB 'VN-2-*'"""
            )
        }
        rows = [row for number, row in records.items() if number not in existing]
        summary = {"sourceRows": len(records), "alreadyInHistory": len(records) - len(rows),
                   "newRows": len(rows), "invalidDatesLeftEmpty": invalid_dates}
        if options.apply:
            summary.update(merge_records(database, rows, "Patents", options.input.name, observed))
        print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
