const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createScrapePriorityResolver } = require('../scrape_priority');

test('scrape priority checks exact patent, design, and trademark numbers across all three indexes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-priority-'));
  try {
    const tracker = path.join(directory, 'tracker.sqlite');
    const wipo = path.join(directory, 'wipo.sqlite');
    const publication = path.join(directory, 'publication.sqlite');
    execFileSync('python', ['-c', `
import sqlite3, sys
tracker, wipo, publication = sys.argv[1:]
for file, table, column, number in [
    (tracker, 'applications', 'application_no', '1-2023-02108'),
    (wipo, 'applications', 'application_number', 'VN-3-2025-01533'),
    (publication, 'publication_records', 'application_number', '4-2022-52292'),
]:
    con = sqlite3.connect(file)
    con.execute(f'CREATE TABLE {table} ({column} TEXT PRIMARY KEY)')
    con.execute(f'INSERT INTO {table} VALUES (?)', (number,))
    con.commit()
    con.close()
`, tracker, wipo, publication]);
    const resolve = createScrapePriorityResolver({ tracker, wipo, publication });
    const result = await resolve(['1-2023-02108', '3-2025-01533', '4-2022-52292', '4-2099-99999']);
    assert.equal(result.ok, true);
    assert.deepEqual(Object.values(result.priorities).map((item) => item.rank), [0, 0, 0, 1]);
    assert.equal(result.priorities['1-2023-02108'].trackerHistory, true);
    assert.equal(result.priorities['3-2025-01533'].wipoHistory, true);
    assert.equal(result.priorities['4-2022-52292'].publication, true);
    assert.deepEqual(result.priorities['4-2099-99999'], {
      rank: 1, trackerHistory: false, wipoHistory: false, publication: false,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
