const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCaseRefResolver, parseCaseRefs } = require('../case_ref_resolver');

test('IP/PR input is normalized and deduplicated', () => {
  assert.deepEqual(parseCaseRefs('IP/PR17258/CDD, ip-pr17258/cdd\nIP/PR18642 IP\\PR18642'), ['IP/PR17258/CDD', 'IP/PR18642']);
});

test('shared Export-PR status resolves exact and base refs to all linked applications', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-pr-status-'));
  const statusJsonPath = path.join(folder, 'status.json');
  try {
    fs.writeFileSync(statusJsonPath, JSON.stringify({ rows: [
      { _canonical: { sourceFile: 'export-PR-21-09-2026.xlsx', caseRef: 'IP/PR17258/CDD', appNo: '1-2022-03660' } },
      { _canonical: { sourceFile: 'export-PR-21-09-2026.xlsx', caseRef: 'IP/PR18642', appNo: '1-2026-08115 | 1-2026-08116' } },
      { _canonical: { sourceFile: 'export-TR-21-09-2026.xlsx', caseRef: 'IP/PR99999', appNo: '1-2026-09999' } },
    ] }));
    const resolver = createCaseRefResolver({ statusJsonPath });
    const result = await resolver.resolve(['IP/PR17258', 'IP/PR17258/OTHER', 'IP/PR18642', 'IP/PR99999']);
    assert.deepEqual(result.matches, [
      { caseRef: 'IP/PR17258', applicationNos: ['1-2022-03660'] },
      { caseRef: 'IP/PR18642', applicationNos: ['1-2026-08115', '1-2026-08116'] },
    ]);
    assert.deepEqual(result.missing, ['IP/PR17258/OTHER', 'IP/PR99999']);
    const inverse = await resolver.lookupApplications(['1-2022-03660', '1-2026-08115', '1-2026-09999']);
    assert.deepEqual(inverse.matches, [
      { applicationNo: '1-2022-03660', caseRefs: ['IP/PR17258/CDD'] },
      { applicationNo: '1-2026-08115', caseRefs: ['IP/PR18642'] },
      { applicationNo: '1-2026-09999', caseRefs: [] },
    ]);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
