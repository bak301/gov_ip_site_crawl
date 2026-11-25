const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCaseRefResolver, parseCaseRefs } = require('../case_ref_resolver');

test('IP/PR input is normalized and deduplicated', () => {
  assert.deepEqual(parseCaseRefs('IP/PR17258/CDD, ip-pr17258/cdd\nIP/PR18642 IP\\PR18642 IP-TR25170 ip\\dr1555/h'), ['IP/PR17258/CDD', 'IP/PR18642', 'IP/TR25170', 'IP/DR1555/H']);
});

test('trademark and design case tables resolve in both directions', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-case-refs-'));
  const statusJsonPath = path.join(folder, 'status.json');
  const trademarkPath = path.join(folder, 'trademarks.jsonl');
  const designPath = path.join(folder, 'designs.jsonl');
  try {
    fs.writeFileSync(statusJsonPath, JSON.stringify({ rows: [] }));
    fs.writeFileSync(trademarkPath, `${JSON.stringify({ case_ref: 'IP/TR25170', dictionary_app_no: '4-2026-09638' })}\n`);
    fs.writeFileSync(designPath, `${JSON.stringify({ case_ref: 'IP/DR1555/H', app_no: '3-2025-01533' })}\n`);
    const resolver = createCaseRefResolver({ statusJsonPath, caseRecordPaths: [trademarkPath, designPath] });
    assert.deepEqual((await resolver.resolve(['IP/TR25170', 'IP/DR1555'])).matches, [
      { caseRef: 'IP/TR25170', applicationNos: ['4-2026-09638'] },
      { caseRef: 'IP/DR1555', applicationNos: ['3-2025-01533'] },
    ]);
    assert.deepEqual((await resolver.lookupApplications(['4-2026-09638', '3-2025-01533'])).matches, [
      { applicationNo: '4-2026-09638', caseRefs: ['IP/TR25170'] },
      { applicationNo: '3-2025-01533', caseRefs: ['IP/DR1555/H'] },
    ]);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
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
