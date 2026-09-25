import json
import os
import re
import sqlite3
import sys


def normalize(value):
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper().removeprefix("VN"))


def normalize_registration(value):
    compact = re.sub(r"\s+B\b", "", str(value or "").upper()).strip()
    patent = re.match(r"^[12]-0*(\d+)(?:-0+)?$", compact)
    if patent:
        return patent.group(1)
    number = re.search(r"\d{4,}", compact)
    return number.group(0).lstrip("0") if number else ""


def upsert_document(database_path):
    document = json.load(sys.stdin)
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute(
            """
            INSERT INTO pdf_documents(
                category, lookup_key, mode_id, application_number, registration_number, request_number,
                publication_number, source_path, source_file, cb_number, volume, book, source_pages,
                source_size, source_mtime_ms, pdf_path, page_count, record_json, generated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(category, lookup_key, source_path) DO UPDATE SET
                mode_id=excluded.mode_id, application_number=excluded.application_number,
                registration_number=excluded.registration_number, request_number=excluded.request_number,
                publication_number=excluded.publication_number, source_file=excluded.source_file,
                cb_number=excluded.cb_number, volume=excluded.volume, book=excluded.book,
                source_pages=excluded.source_pages, source_size=excluded.source_size,
                source_mtime_ms=excluded.source_mtime_ms, pdf_path=excluded.pdf_path,
                page_count=excluded.page_count, record_json=excluded.record_json, generated_at=excluded.generated_at
            """,
            (
                document.get("category", ""), document.get("lookupKey", ""), document.get("modeId", ""),
                document.get("applicationNumber", ""), document.get("registrationNumber", ""), document.get("requestNumber", ""),
                document.get("publicationNumber", ""), document.get("sourcePath", ""), document.get("sourceFile", ""),
                document.get("cbNumber", 0), document.get("volume", ""), document.get("book", ""),
                document.get("sourcePages", ""), document.get("sourceSize", 0), document.get("sourceMtimeMs", 0),
                document.get("pdfPath", ""), document.get("pageCount", 0),
                json.dumps(document.get("record") or {}, ensure_ascii=False), document.get("generatedAt", ""),
            ),
        )
        connection.commit()
        row = connection.execute(
            "SELECT id FROM pdf_documents WHERE category=? AND lookup_key=? AND source_path=?",
            (document.get("category", ""), document.get("lookupKey", ""), document.get("sourcePath", "")),
        ).fetchone()
        print(json.dumps({"ok": True, "id": row[0] if row else None}))
    finally:
        connection.close()


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--upsert-document":
        upsert_document(sys.argv[2])
        return
    database_path = sys.argv[1]
    application_no = sys.argv[2]
    repository_path = sys.argv[3] if len(sys.argv) > 3 else ""
    registration_no = sys.argv[4] if len(sys.argv) > 4 else ""
    if not os.path.isfile(database_path):
        print(json.dumps({"record": None}))
        return

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        canonical_match = re.search(r"[123]-\d{4}-\d{5}", str(application_no or "").upper())
        canonical = canonical_match.group(0) if canonical_match else str(application_no or "").strip()
        documents = []
        if repository_path and os.path.isfile(repository_path):
            repository = sqlite3.connect(repository_path)
            repository.row_factory = sqlite3.Row
            try:
                has_documents = repository.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pdf_documents'"
                ).fetchone()
                if has_documents:
                    found = repository.execute(
                        "SELECT * FROM pdf_documents WHERE UPPER(application_number)=? ORDER BY cb_number DESC, generated_at DESC",
                        (canonical.upper(),),
                    ).fetchall()
                    registrations = {normalize_registration(registration_no)}
                    registrations.update(str(row["registration_number"] or "") for row in found)
                    registrations.discard("")
                    annuity = []
                    for number in registrations:
                        annuity.extend(repository.execute(
                            "SELECT * FROM pdf_documents WHERE category='annuity' AND registration_number=? ORDER BY cb_number DESC, generated_at DESC",
                            (number,),
                        ).fetchall())
                    seen = set()
                    for row in [*found, *annuity]:
                        if row["id"] in seen or not os.path.isfile(row["pdf_path"] or ""):
                            continue
                        seen.add(row["id"])
                        documents.append({
                            "id": row["id"], "category": row["category"], "lookupKey": row["lookup_key"],
                            "applicationNo": row["application_number"] or "", "registrationNo": row["registration_number"] or "",
                            "requestNo": row["request_number"] or "", "publicationNo": row["publication_number"] or "",
                            "pages": row["source_pages"] or "", "page": 1, "pageCount": row["page_count"] or 0,
                            "pdfPath": row["pdf_path"], "sourceFile": row["source_file"] or "",
                            "cbNumber": row["cb_number"] or 0, "volume": row["volume"] or "", "book": row["book"] or "",
                            "generatedAt": row["generated_at"] or "",
                        })
            finally:
                repository.close()
        has_application_pdf_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='application_pdfs'"
        ).fetchone()
        if has_application_pdf_table:
            cached = connection.execute(
                "SELECT * FROM application_pdfs WHERE application_number = ?",
                (canonical,),
            ).fetchone()
            if cached and os.path.isfile(cached["pdf_path"] or ""):
                print(json.dumps({
                    "cachedPdf": {
                        "applicationNo": cached["application_number"],
                        "publicationNo": cached["publication_number"] or "",
                        "pages": cached["source_pages"] or "",
                        "page": 1,
                        "pdfPath": cached["pdf_path"],
                        "sourceFile": cached["source_file"] or "",
                        "pageCount": cached["page_count"] or 0,
                        "generatedAt": cached["generated_at"] or "",
                    },
                    "documents": documents,
                    "record": None,
                    "source": "publication_cache.sqlite application_pdfs",
                }, ensure_ascii=False))
                return
        rows = connection.execute(
            """
            SELECT r.mode_id, r.application_number, r.source_file,
                   s.source_path, r.record_json
            FROM publication_records r
            JOIN source_files s
              ON s.mode_id = r.mode_id AND s.source_key = r.source_key
            WHERE r.application_number LIKE ?
            ORDER BY CASE r.mode_id WHEN '1' THEN 0 WHEN '3' THEN 1 WHEN '4' THEN 2 ELSE 3 END,
                     r.cb_number DESC, r.id DESC
            """,
            (f"%{application_no}%",),
        ).fetchall()
        wanted = normalize(application_no)
        for row in rows:
            if normalize(row["application_number"]) != wanted:
                continue
            record = json.loads(row["record_json"] or "{}")
            print(json.dumps({
                "documents": documents,
                "record": record,
                "modeId": row["mode_id"],
                "sourceFile": row["source_file"] or "",
                "sourcePath": row["source_path"] or "",
                "source": "publication_cache.sqlite",
            }, ensure_ascii=False))
            return
        print(json.dumps({"documents": documents, "record": None}))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
