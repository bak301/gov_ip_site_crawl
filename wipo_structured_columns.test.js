'use strict';

const assert = require('node:assert/strict');
const { splitStructuredColumns } = require('./wipo_structured_columns');

for (const type of ['DESIGNS', 'TRADEMARKS']) {
  const row = splitStructuredColumns(type, 'image\tIndustrial Design\tKiểu dáng công nghiệp\t3-2022-00762 19.04.2022\tdiary\n', 2);
  assert.equal(row.recordType, 'Industrial Design');
  assert.deepEqual(row.fieldValues, ['Kiểu dáng công nghiệp', '3-2022-00762 19.04.2022']);
  assert.equal(row.diaryRaw, 'diary');
}
const patent = splitStructuredColumns('PATENTS', 'image\tPatent title\tdiary\n', 1);
assert.deepEqual(patent.fieldValues, ['Patent title']);
assert.equal(patent.diaryRaw, 'diary');

console.log('wipo_structured_columns tests passed');
