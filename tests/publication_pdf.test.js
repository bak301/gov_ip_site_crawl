const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bulletinIdentity, classifyPdf, parsePublicationPages } = require('../publication_pdf');

test('publication PDF identity is recovered from historical patent metadata', () => {
  const record = { Abstract: 'CÔNG BÁO SỞ HỮU CÔNG NGHIỆP SỐ 399 TẬP A - QUYỂN 1 (06.2021)' };
  assert.deepEqual(bulletinIdentity(record), { cb: 399, volume: 'A', book: '1' });
  assert.deepEqual(classifyPdf('CB_399_A1_Sáng chế_06_2021.pdf'), { cb: 399, volume: 'A', book: '1' });
});

test('publication page designations preserve lists and ranges', () => {
  assert.deepEqual(parsePublicationPages('7, 8'), [7, 8]);
  assert.deepEqual(parsePublicationPages('10-12; 12, 15'), [10, 11, 12, 15]);
});

test('publication list never falls back to loading an entire source volume', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'publication_pdf.js'), 'utf8');
  const listBody = source.slice(source.indexOf('async function listPublicationPdfs'), source.indexOf('function lookupHistoricalRecord'));
  assert.doesNotMatch(listBody, /buildPublicationPdf\s*\(/);
  assert.match(listBody, /have not been prepared in the Publication Workbench PDF repository/);
});

test('publication list prepares a missing historical page and persists it for reuse', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'publication_pdf.js'), 'utf8');
  const listBody = source.slice(source.indexOf('async function listPublicationPdfs'), source.indexOf('function lookupHistoricalRecord'));
  const helper = fs.readFileSync(path.join(__dirname, '..', 'publication_pdf_lookup.py'), 'utf8');
  assert.match(listBody, /queryPublicationDatabase[\s\S]*prepareHistoricalPublicationDocument/);
  assert.match(source, /--upsert-document/);
  assert.match(helper, /def upsert_document\(database_path\):/);
});
