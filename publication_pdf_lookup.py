import json
import os
import re
import sqlite3
import sys
import hashlib
from pathlib import Path



def cell(row, name, default=''):
    return row[name] if name in row.keys() and row[name] is not None else default


def indexed_pages(value):
    result=[]
    for token in re.split(r'[,;]+',str(value or '')):
        match=re.fullmatch(r'\s*(\d+)\s*[-–—]\s*(\d+)\s*',token)
        if match:
            first,last=map(int,match.groups());numbers=range(first,last+1) if 0<=last-first<500 else []
        else:numbers=map(int,re.findall(r'\d+',token))
        for number in numbers:
            if number>0 and number not in result:result.append(number)
    return result


def normalize(value):
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper().removeprefix("VN"))


def lookup_international_publications(database_path, identifier):
    raw = re.sub(r"\s+", "", str(identifier or "").upper())
    dm = re.fullmatch(r"DM/?(\d{6})", raw)
    madrid_app = re.fullmatch(r'5-(\d{5,9}[A-Z]?)', raw)
    key = f"DM/{dm.group(1)}" if dm else madrid_app.group(1) if madrid_app else raw
    if not (re.fullmatch(r"8-\d{4}-\d{5}", key)
            or re.fullmatch(r"DM/\d{6}", key)
            or re.fullmatch(r"\d{5,9}[A-Z]?", key)
            or re.fullmatch(r"[SC]Đ[1234]-\d{4}-\d{5}", key)):
        return {"ok": False, "error": "Invalid publication identifier.", "records": []}
    if not os.path.isfile(database_path):
        return {"ok": False, "error": "Publication database is unavailable.", "records": []}
    db = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    try:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='international_publications'").fetchone():
            return {"ok": False, "error": "International publication index is not ready.", "records": []}
        rows = db.execute("""SELECT * FROM international_publications
            WHERE international_registration_no=? OR vn_application_no=? OR request_no=?
               OR international_registration_no IN
                 (SELECT international_registration_no FROM international_publications
                  WHERE vn_application_no=? AND international_registration_no<>'')
            ORDER BY cb_number DESC, source_pages, record_kind LIMIT 100""", (key, key, key, key)).fetchall()
        records = []
        for row in rows:
            item = dict(row)
            item["data"] = json.loads(item.pop("data_json") or "{}")
            records.append(item)
        return {"ok": True, "identifier": key, "records": records}
    finally:
        db.close()


def prepare_madrid_documents(database_path, output_root, registration_no):
    """Resolve exact Madrid entries for the shared page fetcher; store no extracts."""
    import fitz
    number = str(registration_no or '').strip().upper()
    if not re.fullmatch(r'\d{5,9}[A-Z]?', number):
        return {'ok': False, 'error': 'Invalid Madrid registration number.', 'documents': []}
    if not os.path.isfile(database_path):
        return {'ok': False, 'error': 'Publication database is unavailable.', 'documents': []}
    db = sqlite3.connect(f'file:{database_path}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    documents = []
    try:
        rows = db.execute('''SELECT *
                             FROM international_publications
                             WHERE international_registration_no=? AND volume IN ('A','B')
                               AND record_kind IN ('madrid_registration','madrid_grant_after_refusal','madrid_renewal')
                             ORDER BY cb_number DESC,source_pages,record_kind''', (number,)).fetchall()
        inventory = {}
        for item in db.execute('SELECT source_path FROM inventory_files'):
            path = Path(item['source_path'])
            if path.is_file():inventory.setdefault(path.name.casefold(),set()).add(path.resolve())
        for row in rows:
            candidates = inventory.get(str(row['source_file']).casefold(),set())
            # Never choose an arbitrary volume when filenames are ambiguous.
            if len(candidates)!=1:continue
            source = next(iter(candidates))
            page_numbers = indexed_pages(cell(row,'source_pages'))
            if not page_numbers or len(page_numbers) > 500:
                continue
            identity = f"{source.resolve()}|{source.stat().st_mtime_ns}|{row['record_key']}|{page_numbers}"
            token = hashlib.sha256(identity.encode('utf-8')).hexdigest()[:20]
            try:
                with fitz.open(source) as source_pdf:
                    if source_pdf.needs_pass or any(page < 1 or page > source_pdf.page_count for page in page_numbers):
                        continue
            except (OSError, RuntimeError, ValueError):
                continue
            kind = row['record_kind']
            category = 'renewal' if kind == 'madrid_renewal' else 'publication_a' if row['volume'] == 'A' else 'publication_b'
            documents.append({'id': f"madrid:{token}", 'category': category,
                              'modeId': kind, 'registrationNo': number, 'applicationNo': f'5-{number}',
                              'sourceFile': row['source_file'], 'sourcePages': page_numbers,
                              'pages': cell(row,'source_pages'), 'pageCount': len(page_numbers),
                              'cbNumber': row['cb_number'], 'volume': row['volume'], 'book': cell(row,'book'),
                              'sourcePath': str(source), 'pdfPath': '', 'page': 1})
    finally:
        db.close()
    return {'ok': True, 'registrationNo': number, 'documents': documents}


def normalize_registration(value):
    compact = re.sub(r"\s+B\b", "", str(value or "").upper()).strip()
    patent = re.match(r"^[12]-0*(\d+)(?:-0+)?$", compact)
    if patent:
        return patent.group(1)
    number = re.search(r"\d{4,}", compact)
    return number.group(0).lstrip("0") if number else ""


REGISTRATION_MODES = {
    "patent": ("3",),
    "design": ("11", "2"),
    "trademark": ("12", "5", "6", "7", "10"),
}


def parse_registration(value, selected_type="patent"):
    text = re.sub(r"\s+B\s*$", "", str(value or "").upper()).strip()
    if re.search(r"(?:^|[^A-Z0-9])[1-5]\s*[-/]\s*\d{4}\s*[-/]\s*\d{4,}(?![A-Z0-9])", text):
        return None
    explicit = re.search(r"(?:^|[^A-Z0-9])([1-4])\s*[-/]\s*0*(\d{1,7})(?:\s*[-/]\s*(\d{1,3}))?(?!\d)", text)
    digits_only = None if explicit else re.fullmatch(r"0*(\d{1,7})(?:\s*[-/]\s*(\d{1,3}))?", text)
    if not explicit and not digits_only:
        return None
    selected_type = selected_type if selected_type in REGISTRATION_MODES else "patent"
    prefix = explicit.group(1) if explicit else {"patent": "1", "design": "3", "trademark": "4"}[selected_type]
    record_type = "patent" if prefix in ("1", "2") else "design" if prefix == "3" else "trademark"
    number_value = (explicit.group(2) if explicit else digits_only.group(1)).lstrip("0") or "0"
    number = number_value.zfill(7)
    suffix = ((explicit.group(3) if explicit else digits_only.group(2)) or "000").zfill(3)
    return {
        "type": record_type,
        "prefix": prefix,
        "number": number,
        "suffix": suffix,
        "lookupKey": number_value,
        "formatted": f"{prefix}-{number}-{suffix}",
    }


def lookup_registrations(database_path):
    payload = json.load(sys.stdin)
    selected_type = str(payload.get("registrationType") or "patent").lower()
    requested = []
    seen = set()
    for value in payload.get("registrationNumbers") or []:
        parsed = parse_registration(value, selected_type)
        if parsed and parsed["formatted"] not in seen:
            requested.append(parsed)
            seen.add(parsed["formatted"])
    applications = []
    for value in payload.get("applicationNos") or []:
        canonical = re.search(r"[1-5]-\d{4}-\d{4,}", str(value or "").upper())
        if canonical and canonical.group(0) not in applications:
            applications.append(canonical.group(0))

    if not os.path.isfile(database_path):
        print(json.dumps({"ok": False, "error": "Publication registration database is unavailable.", "matches": [], "missing": [item["formatted"] for item in requested]}))
        return

    wipo_database_path = sys.argv[3] if len(sys.argv) > 3 else ""
    repository_path = sys.argv[4] if len(sys.argv) > 4 else ""
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    matches = []
    match_keys = set()
    indexed_registrations = set()
    if os.path.isfile(repository_path):
        repository = sqlite3.connect(f"file:{repository_path}?mode=ro", uri=True)
        repository.row_factory = sqlite3.Row
        try:
            has_links = repository.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pdf_registration_links'"
            ).fetchone()
            if has_links:
                for item in requested:
                    if item["type"] not in ("design", "trademark"):
                        continue
                    book = "2" if item["type"] == "design" else "3"
                    rows = repository.execute(
                        "SELECT d.* "
                        "FROM pdf_registration_links l JOIN pdf_documents d ON d.id=l.document_id "
                        "WHERE l.book=? AND l.registration_key=? AND d.mode_id IN (?, ?) "
                        "ORDER BY d.cb_number DESC, d.id DESC",
                        (book, item["lookupKey"], "11" if book == "2" else "12", "13" if book == "2" else "6"),
                    )
                    for row in rows:
                        if not (os.path.isfile(row["pdf_path"] or "") or
                                (str(row["mode_id"]) in ("11", "12") and os.path.isfile(cell(row,"source_path") or ""))):
                            continue
                        indexed_registrations.add(item["formatted"])
                        if str(row["mode_id"]) not in ("11", "12"):
                            continue
                        application_match = re.fullmatch(r"[1-5]-\d{4}-\d{4,}", str(row["application_number"] or "").upper())
                        if application_match:
                            key = (item["formatted"], application_match.group(0))
                            if key not in match_keys:
                                match_keys.add(key)
                                matches.append({**item, "applicationNo": application_match.group(0),
                                                "publicationRegistrationNo": row["registration_number"] or "",
                                                "modeId": str(row["mode_id"])})
        finally:
            repository.close()
    try:
        for item in requested:
            if item["formatted"] in indexed_registrations:
                continue
            modes = REGISTRATION_MODES[item["type"]]
            placeholders = ",".join("?" for _ in modes)
            rows = connection.execute(
                f"SELECT mode_id, application_number, registration_number FROM publication_records WHERE mode_id IN ({placeholders}) AND registration_number LIKE ? AND COALESCE(application_number, '') <> '' ORDER BY cb_number DESC, id DESC",
                (*modes, f"%{item['lookupKey']}%"),
            ).fetchall()
            for row in rows:
                stored = parse_registration(row["registration_number"], item["type"])
                application_match = re.search(r"[1-5]-\d{4}-\d{4,}", str(row["application_number"] or "").upper())
                if not stored or stored["lookupKey"] != item["lookupKey"] or stored["prefix"] != item["prefix"] or not application_match:
                    continue
                key = (item["formatted"], application_match.group(0))
                if key in match_keys:
                    continue
                match_keys.add(key)
                matches.append({
                    **item,
                    "applicationNo": application_match.group(0),
                    "publicationRegistrationNo": str(row["registration_number"] or ""),
                    "modeId": str(row["mode_id"]),
                })

        if applications:
            placeholders = ",".join("?" for _ in applications)
            rows = connection.execute(
                f"SELECT mode_id, application_number, registration_number FROM publication_records WHERE application_number IN ({placeholders}) AND COALESCE(registration_number, '') <> '' ORDER BY cb_number DESC, id DESC",
                applications,
            ).fetchall()
            for row in rows:
                application_no = str(row["application_number"] or "")
                mode_type = "patent" if str(row["mode_id"]) in ("3", "4") else "design" if str(row["mode_id"]) in ("2", "11") else "trademark"
                stored = parse_registration(row["registration_number"], mode_type)
                if not stored:
                    continue
                key = (stored["formatted"], application_no)
                if key in match_keys:
                    continue
                match_keys.add(key)
                matches.append({
                    **stored,
                    "applicationNo": application_no,
                    "publicationRegistrationNo": str(row["registration_number"] or ""),
                    "modeId": str(row["mode_id"]),
                })
    finally:
        connection.close()

    # Historical design and trademark rows may lack the original application
    # number. Use migrated WIPOPublish history as a fallback after checking
    # the Publication Workbench registration records.
    if os.path.isfile(wipo_database_path):
        wipo = sqlite3.connect(f"file:{wipo_database_path}?mode=ro", uri=True)
        wipo.row_factory = sqlite3.Row
        try:
            pending = {item["formatted"]: item for item in requested
                       if item["type"] != "patent" and item["formatted"] not in {key[0] for key in match_keys}}
            if pending:
                placeholders = ",".join("?" for _ in pending)
                rows = wipo.execute(
                    f"SELECT application_number, registration_number FROM applications WHERE registration_number IN ({placeholders})",
                    list(pending),
                )
                for row in rows:
                    item = pending.get(str(row["registration_number"] or ""))
                    application_match = re.search(r"[1-5]-\d{4}-\d{4,}", str(row["application_number"] or "").upper())
                    if not item or not application_match:
                        continue
                    key = (item["formatted"], application_match.group(0))
                    if key in match_keys:
                        continue
                    match_keys.add(key)
                    matches.append({**item, "applicationNo": application_match.group(0), "publicationRegistrationNo": str(row["registration_number"] or ""), "modeId": "wipo"})
            if applications:
                # The migrated history stores VN-prefixed IDs; older rows may
                # still use the unprefixed display form. Match both at read time.
                history_applications = [form for app in applications for form in (app, f"VN-{app}")]
                placeholders = ",".join("?" for _ in history_applications)
                for row in wipo.execute(
                    f"SELECT application_number, registration_number FROM applications WHERE application_number IN ({placeholders}) AND registration_number <> ''",
                    history_applications,
                ):
                    application_no = str(row["application_number"] or "").removeprefix("VN-")
                    prefix_type = "design" if application_no.startswith("3-") else "trademark" if application_no.startswith(("4-", "5-")) else "patent"
                    stored = parse_registration(row["registration_number"], prefix_type)
                    if not stored:
                        continue
                    key = (stored["formatted"], application_no)
                    if key in match_keys:
                        continue
                    match_keys.add(key)
                    matches.append({**stored, "applicationNo": application_no, "publicationRegistrationNo": str(row["registration_number"] or ""), "modeId": "wipo"})
        finally:
            wipo.close()

    renewal_matches = []
    if os.path.isfile(repository_path):
        repository = sqlite3.connect(f"file:{repository_path}?mode=ro", uri=True)
        repository.row_factory = sqlite3.Row
        try:
            has_links = repository.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pdf_registration_links'"
            ).fetchone()
            if has_links:
                for item in requested:
                    if item["type"] not in ("design", "trademark"):
                        continue
                    book = "2" if item["type"] == "design" else "3"
                    mode = "13" if book == "2" else "6"
                    rows = repository.execute(
                        "SELECT d.id, d.request_number, d.publication_number, d.source_file, d.cb_number, d.pdf_path "
                        "FROM pdf_registration_links l JOIN pdf_documents d ON d.id=l.document_id "
                        "WHERE l.book=? AND l.registration_key=? AND d.mode_id=? "
                        "ORDER BY d.cb_number DESC, d.id DESC",
                        (book, item["lookupKey"], mode),
                    )
                    seen_requests = set()
                    for row in rows:
                        request_no = str(row["request_number"] or "").strip().upper()
                        identity = request_no or f"document:{row['id']}"
                        if identity in seen_requests or not os.path.isfile(row["pdf_path"] or ""):
                            continue
                        seen_requests.add(identity)
                        renewal_matches.append({"formatted": item["formatted"], "type": item["type"],
                                                "requestNo": request_no, "documentId": row["id"],
                                                "decisionNo": row["publication_number"], "sourceFile": row["source_file"],
                                                "cbNumber": row["cb_number"]})
        finally:
            repository.close()
    found = {item["formatted"] for item in matches}
    found.update(item["formatted"] for item in renewal_matches)
    print(json.dumps({"ok": True, "matches": matches, "renewalMatches": renewal_matches,
                      "missing": [item["formatted"] for item in requested if item["formatted"] not in found]}, ensure_ascii=False))


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


def lookup_request_documents_batch(repository_path, status_database_path, request_numbers):
    kinds = {
        "DT1": ("Patent annuity", "PF", "annuity", "4"),
        "DT2": ("Utility-solution annuity", "PF", "annuity", "4"),
        "GH3": ("Design renewal", "DA", "publication_b", "13"),
        "GH4": ("Trademark renewal", "TA", "publication_b", "6"),
    }
    requested = list(dict.fromkeys(str(value or "").strip().upper() for value in request_numbers))
    if any(not re.fullmatch(r"(?:DT[12]|GH[34])-\d{4}-\d{5}", number) for number in requested):
        raise ValueError("Invalid request number.")
    results = {}
    for request_no in requested:
        label, case_family, _category, _mode_id = kinds[request_no[:3]]
        results[request_no] = {"ok": True, "requestNo": request_no, "kind": label,
                               "caseFamily": case_family, "caseRefs": [], "documents": []}
    refs = {number: set() for number in requested}
    if os.path.isfile(repository_path):
        repository = sqlite3.connect(f"file:{repository_path}?mode=ro", uri=True)
        repository.row_factory = sqlite3.Row
        try:
            for offset in range(0, len(requested), 400):
                chunk = requested[offset:offset + 400]
                if not chunk:
                    continue
                placeholders = ",".join("?" for _ in chunk)
                rows = repository.execute(
                    f"SELECT * FROM pdf_documents WHERE request_number IN ({placeholders}) "
                    "ORDER BY request_number, cb_number DESC, generated_at DESC", chunk,
                ).fetchall()
                for row in rows:
                    request_no = row["request_number"]
                    _label, case_family, category, mode_id = kinds[request_no[:3]]
                    if row["category"] != category or row["mode_id"] != mode_id:
                        continue
                    pdf_path = row["pdf_path"] or ""
                    if not (os.path.isfile(pdf_path) or (cell(row,'source_pages') and os.path.isfile(cell(row,'source_path') or ''))):
                        continue
                    try:
                        record = json.loads(row["record_json"] or "{}")
                    except (TypeError, ValueError):
                        record = {}
                    if not isinstance(record, dict):
                        record = {}
                    candidate = str(record.get("Case Ref") or record.get("Case_Ref") or "").strip().upper()
                    if re.fullmatch(rf"IP/{case_family}\d+(?:/[A-Z0-9-]+)*", candidate):
                        refs[request_no].add(candidate)
                    results[request_no]["documents"].append({
                        "id": str(row["id"]), "category": row["category"], "lookupKey": row["lookup_key"],
                        "modeId": row["mode_id"], "requestNo": request_no,
                        "applicationNo": row["application_number"] or "", "registrationNo": row["registration_number"] or "",
                        "publicationNo": row["publication_number"] or "", "pages": cell(row,"source_pages") or "",
                        "page": 1, "pageCount": row["page_count"] or 0, "pdfPath": pdf_path,
                        "sourcePath": cell(row,"source_path") or "", "sourcePages": indexed_pages(cell(row,"source_pages")),
                        "sourceFile": row["source_file"] or "", "cbNumber": row["cb_number"] or 0,
                        "volume": row["volume"] or "", "book": row["book"] or "", "generatedAt": row["generated_at"] or "",
                    })
        finally:
            repository.close()
    if os.path.isfile(status_database_path):
        status = sqlite3.connect(f"file:{status_database_path}?mode=ro", uri=True)
        try:
            try:
                for offset in range(0, len(requested), 400):
                    chunk = requested[offset:offset + 400]
                    if not chunk:
                        continue
                    placeholders = ",".join("?" for _ in chunk)
                    rows = status.execute(
                        f"SELECT DISTINCT request_no, case_ref FROM status_records WHERE request_no IN ({placeholders})", chunk,
                    )
                    for request_no, case_ref in rows:
                        if request_no not in results:
                            continue
                        case_family = results[request_no]["caseFamily"]
                        candidate = str(case_ref or "").strip().upper()
                        if re.fullmatch(rf"IP/{case_family}\d+(?:/[A-Z0-9-]+)*", candidate):
                            refs[request_no].add(candidate)
            except sqlite3.OperationalError:
                pass
        finally:
            status.close()
    for number in requested:
        results[number]["caseRefs"] = sorted(refs[number])
    return [results[number] for number in requested]


def lookup_request_documents(repository_path, status_database_path, request_no):
    result = lookup_request_documents_batch(repository_path, status_database_path, [request_no])[0]
    print(json.dumps(result, ensure_ascii=False))


def export_request_records(repository_path, request_numbers):
    requested = list(dict.fromkeys(str(value or '').strip().upper() for value in request_numbers))
    modes = {'DT1': '4', 'DT2': '4', 'GH3': '13', 'GH4': '6'}
    if any(not re.fullmatch(r'(?:DT[12]|GH[34])-\d{4}-\d{5}', number) for number in requested):
        raise ValueError('Invalid request number.')
    if not os.path.isfile(repository_path):
        return [{'requestNo': number, 'modeId': modes[number[:3]], 'record': {}, 'status': 'No PDF'} for number in requested]
    connection = sqlite3.connect(f'file:{repository_path}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    records = {number: [] for number in requested}
    try:
        for offset in range(0, len(requested), 400):
            chunk = requested[offset:offset + 400]
            if not chunk:
                continue
            placeholders = ','.join('?' for _ in chunk)
            for row in connection.execute(
                f'SELECT * '
                f'FROM pdf_documents WHERE request_number IN ({placeholders}) '
                'ORDER BY cb_number DESC, id DESC', chunk,
            ):
                request_no = row['request_number']
                if row['mode_id'] != modes[request_no[:3]] or not (os.path.isfile(row['pdf_path'] or '') or (indexed_pages(cell(row,'source_pages')) and os.path.isfile(cell(row,'source_path')))):
                    continue
                try:
                    parsed = json.loads(row['record_json'] or '{}')
                except (TypeError, ValueError):
                    parsed = {}
                if isinstance(parsed, dict):
                    parsed.pop('Raw_Text', None)
                    parsed.pop('Registration_Table_Text', None)
                records[request_no].append({
                    'requestNo': request_no, 'modeId': row['mode_id'], 'documentId': row['id'],
                    'sourceFile': row['source_file'], 'cbNumber': row['cb_number'],
                    'pdfPath': row['pdf_path'], 'record': parsed if isinstance(parsed, dict) else {},
                })
    finally:
        connection.close()
    return [record for number in requested for record in (records[number] or [{
        'requestNo': number, 'modeId': modes[number[:3]], 'record': {}, 'status': 'No PDF',
    }])]


def main():
    # The LAN host may inherit a Windows cp1252 console. Publication filenames
    # contain Vietnamese characters, so JSON output must be UTF-8 regardless.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) > 1 and sys.argv[1] == "--lookup-request-documents":
        lookup_request_documents(sys.argv[2], sys.argv[3], sys.argv[4])
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--lookup-request-documents-batch":
        request_numbers = json.load(sys.stdin)
        print(json.dumps({"results": lookup_request_documents_batch(sys.argv[2], sys.argv[3], request_numbers)}, ensure_ascii=False))
        return
    if len(sys.argv) > 1 and sys.argv[1] == '--export-request-records':
        print(json.dumps({'records': export_request_records(sys.argv[2], json.load(sys.stdin))}, ensure_ascii=False))
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--upsert-document":
        upsert_document(sys.argv[2])
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--lookup-registrations":
        lookup_registrations(sys.argv[2])
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--lookup-international-publications":
        print(json.dumps(lookup_international_publications(sys.argv[2], sys.argv[3]), ensure_ascii=False))
        return
    if len(sys.argv) > 1 and sys.argv[1] == '--prepare-madrid-documents':
        print(json.dumps(prepare_madrid_documents(sys.argv[2], sys.argv[3], sys.argv[4]), ensure_ascii=False))
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
                    has_registration_links = repository.execute(
                        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pdf_registration_links'"
                    ).fetchone()
                    found = repository.execute(
                        "SELECT * FROM pdf_documents WHERE application_number=? ORDER BY cb_number DESC, generated_at DESC",
                        (canonical.upper(),),
                    ).fetchall() if canonical else []
                    registrations = {normalize_registration(registration_no), str(registration_no or "").strip().upper()}
                    for row in found:
                        registrations.add(str(row["registration_number"] or "").strip().upper())
                        registrations.add(normalize_registration(row["registration_number"]))
                    registrations.discard("")
                    prefix_match = re.match(r"^([1-4])-", canonical) or re.match(r"^([1-4])-", str(registration_no or ""))
                    prefix = prefix_match.group(1) if prefix_match else ""
                    book = "1" if prefix in ("1", "2") else "2" if prefix == "3" else "3" if prefix == "4" else ""
                    linked = []
                    for number in registrations:
                        book_filter = (
                            "AND (book=? OR (book='' AND mode_id='12')) " if book == "3"
                            else "AND book=? " if book else ""
                        )
                        linked.extend(repository.execute(
                            "SELECT * FROM pdf_documents WHERE registration_number=? "
                            + book_filter
                            + "ORDER BY cb_number DESC, generated_at DESC",
                            (number, book) if book else (number,),
                        ).fetchall())
                        key = normalize_registration(number)
                        if has_registration_links and book and key:
                            linked.extend(repository.execute(
                                "SELECT d.* FROM pdf_registration_links l JOIN pdf_documents d ON d.id=l.document_id "
                                "WHERE (l.book=? " + ("OR (l.book='' AND d.mode_id='12')" if book == "3" else "")
                                + ") AND l.registration_key=? ORDER BY d.cb_number DESC, d.generated_at DESC",
                                (book, key),
                            ).fetchall())
                    for linked_row in list(linked):
                        if str(linked_row["mode_id"]) not in ("11", "12") or not linked_row["application_number"]:
                            continue
                        linked.extend(repository.execute(
                            "SELECT * FROM pdf_documents WHERE application_number=? AND (book=? "
                            + ("OR (book='' AND mode_id='12')" if book == "3" else "") + ") "
                            "ORDER BY cb_number DESC, generated_at DESC",
                            (linked_row["application_number"], book),
                        ).fetchall())
                    seen = set()
                    for row in [*found, *linked]:
                        source_available = bool(cell(row,"source_pages")) and os.path.isfile(cell(row,"source_path") or "")
                        if row["id"] in seen or not (source_available or os.path.isfile(row["pdf_path"] or "")):
                            continue
                        seen.add(row["id"])
                        documents.append({
                            "id": row["id"], "category": row["category"], "modeId": row["mode_id"], "lookupKey": row["lookup_key"],
                            "applicationNo": row["application_number"] or "", "registrationNo": row["registration_number"] or "",
                            "requestNo": row["request_number"] or "", "publicationNo": row["publication_number"] or "",
                            "pages": cell(row,"source_pages") or "", "page": int(re.search(r"\d+", cell(row,"source_pages") or "1").group()), "pageCount": row["page_count"] or 0,
                            "pdfPath": row["pdf_path"], "sourcePath": cell(row,"source_path"), "sourceFile": row["source_file"] or "",
                            "cbNumber": row["cb_number"] or 0, "volume": row["volume"] or "", "book": row["book"] or "",
                            "generatedAt": row["generated_at"] or "",
                        })
            finally:
                repository.close()
        if not canonical:
            print(json.dumps({"documents": documents, "record": None}, ensure_ascii=False))
            return
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
        row_query = """
            SELECT r.mode_id, r.application_number, r.source_file,
                   s.source_path, r.record_json
            FROM publication_records r
            JOIN source_files s
              ON s.mode_id = r.mode_id AND s.source_key = r.source_key
            WHERE r.application_number IN (?, ?, ?, ?)
            ORDER BY CASE r.mode_id WHEN '1' THEN 0 WHEN '3' THEN 1 WHEN '4' THEN 2 ELSE 3 END,
                     r.cb_number DESC, r.id DESC
            """
        exact_candidates = (canonical, f"VN-{canonical}", f"VN {canonical}", f"VN -{canonical}")
        rows = connection.execute(row_query, exact_candidates).fetchall()
        if not rows:
            # Preserve the historical fuzzy fallback for unusual imported IDs,
            # but do not scan the million-row table on every ordinary lookup.
            rows = connection.execute(
                row_query.replace("IN (?, ?, ?, ?)", "LIKE ?"),
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
                "sourcePath": cell(row,"source_path") or "",
                "source": "publication_cache.sqlite",
            }, ensure_ascii=False))
            return
        print(json.dumps({"documents": documents, "record": None}))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
