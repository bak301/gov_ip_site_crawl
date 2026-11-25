const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseRequestNos, requestKind, lookupRequestPublication, lookupRequestPublications, lookupRequestExportRecords } = require('../request_publication');

test('request numbers are distinct from application numbers', () => {
  assert.deepEqual(parseRequestNos('DT1-2026-03417\nDT2-2026-12405, GH3-2026-01947 GH4-2026-02947 DT1-2026-03417 1-2023-02108'), [
    'DT1-2026-03417', 'DT2-2026-12405', 'GH3-2026-01947', 'GH4-2026-02947',
  ]);
  assert.equal(requestKind('GH3-2026-01947').caseFamily, 'DA');
  assert.equal(requestKind('GH4-2026-02947').caseFamily, 'TA');
  assert.equal(requestKind('DT2-2026-12405').caseFamily, 'PF');
});

test('registration lookup returns older trademark renewal PDFs without inventing a request number', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-old-gh4-lookup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const publication = path.join(directory, 'publication.sqlite');
  const repository = path.join(directory, 'repository.sqlite');
  const pdf = path.join(directory, 'notice.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n');
  execFileSync('python', ['-c', `import sqlite3,sys
publication,repository,pdf=sys.argv[1:]
c=sqlite3.connect(publication)
c.execute('CREATE TABLE publication_records (mode_id TEXT, application_number TEXT, registration_number TEXT, cb_number INTEGER, id INTEGER)')
c.commit();c.close()
c=sqlite3.connect(repository)
c.execute('CREATE TABLE pdf_documents (id INTEGER PRIMARY KEY, mode_id TEXT, application_number TEXT, registration_number TEXT, request_number TEXT, publication_number TEXT, source_file TEXT, cb_number INTEGER, pdf_path TEXT)')
c.execute('CREATE TABLE pdf_registration_links (document_id INTEGER, book TEXT, registration_key TEXT)')
c.execute('INSERT INTO pdf_documents VALUES (1,?,?,?,?,?,?,?,?)',('6','','','','100278/QĐ-SHTT','CB_418_B3.pdf',418,pdf))
c.execute('INSERT INTO pdf_registration_links VALUES (1,?,?)',('3','205569'))
c.commit();c.close()`, publication, repository, pdf]);
  const helper = path.join(__dirname, '..', 'publication_pdf_lookup.py');
  const output = execFileSync('python', [helper, '--lookup-registrations', publication, '', repository], {
    encoding: 'utf8', input: JSON.stringify({ registrationNumbers: ['4-00205569-000'], registrationType: 'trademark' }),
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const result = JSON.parse(output);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.missing, []);
  assert.equal(result.renewalMatches[0].requestNo, '');
  assert.equal(result.renewalMatches[0].documentId, 1);
  assert.equal(result.renewalMatches[0].decisionNo, '100278/QĐ-SHTT');
});

test('exact request lookup uses the corresponding publication mode and case family', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-request-publication-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repository = path.join(directory, 'publication.sqlite');
  const status = path.join(directory, 'status.sqlite');
  const pdf = path.join(directory, 'request.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4\n');
  const script = `import sqlite3,sys,json
repo,status,pdf=sys.argv[1:]
c=sqlite3.connect(repo)
c.execute('CREATE TABLE pdf_documents (id INTEGER PRIMARY KEY, request_number TEXT, category TEXT, mode_id TEXT, pdf_path TEXT, record_json TEXT, lookup_key TEXT, application_number TEXT, registration_number TEXT, publication_number TEXT, source_pages TEXT, page_count INTEGER, source_file TEXT, cb_number INTEGER, volume TEXT, book TEXT, generated_at TEXT)')
for i,(number,category,mode,case_ref) in enumerate([('DT1-2026-03417','annuity','4','IP/PF42'),('DT2-2026-12405','annuity','4','IP/PF43'),('GH3-2026-01947','publication_b','13','IP/DA44'),('GH4-2026-02947','publication_b','6','IP/TA45'),('GH4-2026-02947','publication_b','13','IP/TA99')],1):
 c.execute('INSERT INTO pdf_documents VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(i,number,category,mode,pdf,json.dumps({'Case Ref':case_ref}),number,'','','','1',1,'Sáng chế.pdf',457,'B','1','2026-10-01'))
c.commit();c.close()
c=sqlite3.connect(status)
c.execute('CREATE TABLE status_records (request_no TEXT, case_ref TEXT)')
c.execute('INSERT INTO status_records VALUES (?,?)',('GH3-2026-01947','IP/DA46'))
c.execute('INSERT INTO status_records VALUES (?,?)',('GH3-2026-01947','IP/TA99'))
c.commit();c.close()`;
  execFileSync('python', ['-c', script, repository, status, pdf]);
  for (const [requestNo, expectedFamily, expectedCount] of [
    ['DT1-2026-03417', 'PF', 1], ['DT2-2026-12405', 'PF', 1],
    ['GH3-2026-01947', 'DA', 1], ['GH4-2026-02947', 'TA', 1],
  ]) {
    const result = await lookupRequestPublication(requestNo, { repository, statusDatabase: status });
    assert.equal(result.ok, true);
    assert.equal(result.documents.length, expectedCount);
    assert.ok(result.caseRefs.every((caseRef) => caseRef.startsWith(`IP/${expectedFamily}`)));
  }
  const design = await lookupRequestPublication('GH3-2026-01947', { repository, statusDatabase: status });
  assert.deepEqual(design.caseRefs, ['IP/DA44', 'IP/DA46']);
  const batch = await lookupRequestPublications(['DT1-2026-03417', 'GH3-2026-01947', 'GH4-2026-02947', 'DT1-2026-99999'], { repository, statusDatabase: status });
  assert.deepEqual(batch.map((item) => item.documents.length), [1, 1, 1, 0]);
  assert.deepEqual(batch[1].caseRefs, ['IP/DA44', 'IP/DA46']);
  assert.deepEqual(batch[2].caseRefs, ['IP/TA45']);
  const exportRecords = await lookupRequestExportRecords(['DT1-2026-03417', 'GH4-2026-02947', 'DT1-2026-99999'], { repository });
  assert.deepEqual(exportRecords.map(item => item.requestNo), ['DT1-2026-03417', 'GH4-2026-02947', 'DT1-2026-99999']);
  assert.equal(exportRecords[1].record['Case Ref'], 'IP/TA45');
  assert.equal(exportRecords[2].status, 'No PDF');
  await assert.rejects(lookupRequestPublications(['DT1-2026-03417', '1-2023-02108'], { repository, statusDatabase: status }), /valid/i);
  const cached = lookupRequestPublication('DT1-2026-03417', { repository, statusDatabase: status });
  assert.strictEqual(lookupRequestPublication('DT1-2026-03417', { repository, statusDatabase: status }), cached);
  const changedAt = new Date(Date.now() + 5000);
  fs.utimesSync(status, changedAt, changedAt);
  const refreshed = lookupRequestPublication('DT1-2026-03417', { repository, statusDatabase: status });
  assert.notStrictEqual(refreshed, cached);
  await refreshed;
  const commandLine = JSON.parse(execFileSync('python', [path.join(__dirname, '..', 'publication_pdf_lookup.py'), '--lookup-request-documents', repository, status, 'DT1-2026-03417'], {
    encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'cp1252' },
  }));
  assert.equal(commandLine.documents[0].sourceFile, 'Sáng chế.pdf');
  execFileSync('python', ['-c', "import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);d.execute('ALTER TABLE pdf_documents ADD COLUMN source_path TEXT');d.execute(\"UPDATE pdf_documents SET source_path=?,pdf_path='',source_pages='1-3' WHERE id=1\",(sys.argv[2],));d.commit()", repository, pdf]);
  const sourceOnly = await lookupRequestPublication('DT1-2026-03417', { repository, statusDatabase: status });
  assert.equal(sourceOnly.documents.length, 1);
  assert.deepEqual(sourceOnly.documents[0].sourcePages, [1, 2, 3]);
  assert.equal(sourceOnly.documents[0].sourcePath, pdf);
  const sourceOnlyExport = await lookupRequestExportRecords(['DT1-2026-03417'], { repository });
  assert.notEqual(sourceOnlyExport[0].status, 'No PDF');

  await assert.rejects(lookupRequestPublication('1-2023-02108', { repository, statusDatabase: status }), /request number/i);
});
