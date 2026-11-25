'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');
const ExcelJS = require('exceljs');
const { mergePdfBuffers, createBatchExport } = require('../batch_export');

async function samplePdf(pageCount = 1) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) pdf.addPage();
  return Buffer.from(await pdf.save());
}

test('PDF batches merge every report page in selected order', async () => {
  const merged = await mergePdfBuffers([await samplePdf(1), await samplePdf(2)]);
  assert.equal((await PDFDocument.load(merged)).getPageCount(), 3);
});

test('one selected output returns directly while several outputs create a ZIP', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-batch-'));
  const publicationPath = path.join(folder, 'publication.pdf');
  fs.writeFileSync(publicationPath, await samplePdf());
  const dependencies = {
    callDatabase: async () => ({}),
    exportWorkbook: async () => ({ name: 'list.xlsx', buffer: Buffer.from('xlsx') }),
    renderReportPdf: async () => samplePdf(),
    listPublicationPdfs: async () => [{ category: 'publication_a', pdfPath: publicationPath, cbNumber: 1 }],
  };
  const direct = await createBatchExport({ outputs: { publicationA: true }, applicationNos: ['1-2022-01543'], orders: { publicationA: ['1-2022-01543'] } }, dependencies);
  assert.equal(direct.type, 'application/pdf');
  const bundle = await createBatchExport({ outputs: { excel: true, publicationA: true }, applicationNos: ['1-2022-01543'], orders: { excel: ['1-2022-01543'], publicationA: ['1-2022-01543'] } }, dependencies);
  assert.equal(bundle.type, 'application/zip');
  const zip = await JSZip.loadAsync(bundle.buffer);
  assert.equal(Object.keys(zip.files).length, 2);
  fs.rmSync(folder, { recursive: true, force: true });
});

test('indexed Publication A exports only its source pages without creating a split file', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-indexed-export-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const sourcePath = path.join(folder, 'bulletin.pdf');
  fs.writeFileSync(sourcePath, await samplePdf(3));
  const result = await createBatchExport({
    outputs: { publicationA: true },
    applicationNos: ['4-2025-12495'],
    orders: { publicationA: ['4-2025-12495'] },
  }, {
    callDatabase: async () => ({}),
    listPublicationPdfs: async () => [{
      category: 'publication_a', modeId: '10', sourcePath, sourcePages: [2], cbNumber: 448,
    }],
  });
  assert.equal(result.type, 'application/pdf');
  assert.equal((await PDFDocument.load(result.buffer)).getPageCount(), 1);
  assert.deepEqual(fs.readdirSync(folder), ['bulletin.pdf']);
});

test('batch Excel forwards selected columns to the workbook builder', async () => {
  const chosen = { columns: ['applicationNo', 'currentApplicantName'], currentApplicantsOnly: true };
  let received;
  await createBatchExport({ outputs: { excel: true }, applicationNos: ['4-2025-12495'], excelColumns: chosen }, {
    callDatabase: async () => ({}),
    exportWorkbook: async (_db, ids, columns) => {
      received = { ids, columns };
      return { name: 'list.xlsx', buffer: Buffer.from('xlsx') };
    },
  });
  assert.deepEqual(received, { ids: ['4-2025-12495'], columns: chosen });
});

test('request-only exports include matched PDFs and all parsed renewal fields in one Excel row per publication', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-request-export-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const pdfPath = path.join(folder, 'renewal.pdf');
  fs.writeFileSync(pdfPath, await samplePdf(2));
  const requestNos = ['GH4-2025-09186', 'GH4-2025-09311'];
  const records = [
    { requestNo: requestNos[0], modeId: '6', documentId: 42, pdfPath, sourceFile: 'CB_448.pdf', cbNumber: 448,
      record: { Decision_Number: '123/QD', Decision_Date: '01/10/2025', Application_Number: '4-2020-12345', Filing_Date: '02/03/2020',
        Registrations: [
          { Registration_Number: '4-00000001-000', Registration_Date: '10/01/2021', Renewal_To: '10/01/2031' },
          { Registration_Number: '4-00000002-000', Registration_Date: '11/01/2021', Renewal_To: '11/01/2031' },
        ] } },
    { requestNo: requestNos[1], modeId: '6', status: 'No PDF', record: {} },
  ];
  const dependencies = { lookupRequestExportRecords: async ids => { assert.deepEqual(ids, requestNos); return records; } };
  const excel = await createBatchExport({ outputs: { requestExcel: true }, requestNos }, dependencies);
  assert.match(excel.name, /\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excel.buffer);
  const sheet = workbook.getWorksheet('Publication requests');
  const headers = sheet.getRow(1).values;
  const cell = (row, name) => row.getCell(headers.indexOf(name)).value;
  assert.equal(sheet.rowCount, 3);
  assert.equal(cell(sheet.getRow(2), 'Decision no.'), '123/QD');
  assert.equal(cell(sheet.getRow(2), 'Filing date'), '02/03/2020');
  assert.equal(cell(sheet.getRow(2), 'Registration no.'), '4-00000001-000\n4-00000002-000');
  assert.equal(cell(sheet.getRow(2), 'Grant date'), '10/01/2021\n11/01/2021');
  assert.equal(cell(sheet.getRow(3), 'PDF status'), 'No PDF');
  assert.equal(sheet.getRow(2).getCell(headers.indexOf('Registration no.')).alignment.wrapText, true);
  const pdf = await createBatchExport({ outputs: { requestPdf: true }, requestNos }, dependencies);
  assert.equal((await PDFDocument.load(pdf.buffer)).getPageCount(), 2);
  const bundle = await createBatchExport({ outputs: { requestPdf: true, requestExcel: true }, requestNos }, dependencies);
  assert.equal(bundle.type, 'application/zip');
  assert.equal(Object.keys((await JSZip.loadAsync(bundle.buffer)).files).length, 2);
  const missingOnly = { lookupRequestExportRecords: async () => [records[1]] };
  const missingExcel = await createBatchExport({ outputs: { requestExcel: true }, requestNos: [requestNos[1]] }, missingOnly);
  assert.equal(missingExcel.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await assert.rejects(createBatchExport({ outputs: { requestPdf: true }, requestNos: [requestNos[1]] }, missingOnly), /No publication PDFs/);
});

test('Hague-only export contains national application numbers and parsed VN decisions', async () => {
  const ids = ['DM/225862', 'DM/213380', 'DM/999999'];
  const saved = [
    { number: ids[0], lastScrapedAt: '2026-10-08T01:00:00Z', data: { number: ids[0], status: 'Refusal', registrationDate: '29/08/2022',
      holders: [{ name: 'HZAT, LLC', address: 'Miami, US' }], events: [{ kind: 'Refusal', bulletinNo: '29/2023', bulletinDate: '21/07/2023',
        pdfData: { vnApplicationNos: ['8-2023-00004'], refusalGrounds: 'Description must be amended.' }, pdfUrl: 'https://www.wipo.int/refusal.pdf' }] } },
    { number: ids[1], data: { number: ids[1], status: 'Granted', events: [{ kind: 'Granted', pdfData: { decisionNo: '45905/QĐ-SHTT.IP' } }] } },
  ];
  const dependencies = { callDatabase: async (command, payload) => {
    assert.equal(command, 'hague-list'); assert.deepEqual(payload.registrationNos, ids);
    return { ok: true, registrations: saved };
  } };
  const exported = await createBatchExport({ outputs: { hagueExcel: true }, hagueNos: ids }, dependencies);
  assert.match(exported.name, /Hague_designs.*\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.buffer);
  const designs = workbook.getWorksheet('Hague designs');
  const decisions = workbook.getWorksheet('VN decisions');
  const cell = (sheet, row, header) => row.getCell(sheet.getRow(1).values.indexOf(header)).value;
  assert.equal(designs.rowCount, 4);
  assert.equal(cell(designs, designs.getRow(2), 'VN application no. (refusal PDF)'), '8-2023-00004');
  assert.equal(cell(designs, designs.getRow(2), 'Holder(s)'), 'HZAT, LLC — Miami, US');
  assert.equal(cell(designs, designs.getRow(4), 'VN status'), 'Not scraped');
  assert.equal(decisions.rowCount, 3);
  assert.equal(cell(decisions, decisions.getRow(2), 'Grounds for refusal'), 'Description must be amended.');
  assert.equal(cell(decisions, decisions.getRow(3), 'Decision no.'), '45905/QĐ-SHTT.IP');
  assert.equal(designs.getRow(2).getCell(2).alignment.wrapText, true);
});

test('Hague refusal export creates separate ZIP notices or one merged PDF', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-hague-refusals-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const pdf1 = path.join(folder, 'one.pdf');
  const pdf2 = path.join(folder, 'two.pdf');
  fs.writeFileSync(pdf1, await samplePdf(1));
  fs.writeFileSync(pdf2, await samplePdf(2));
  const ids = ['DM/225862', 'DM/213380'];
  const records = [{ number: ids[0], data: { events: [{ id: 'REFUSAL1', kind: 'Refusal', pdfAvailable: true }, { id: 'GRANT', kind: 'Granted', pdfAvailable: true }] } },
    { number: ids[1], data: { events: [{ id: 'REFUSAL2', kind: 'Refusal', pdfAvailable: true }] } }];
  const dependencies = {
    callDatabase: async (command, payload) => { assert.equal(command, 'hague-list'); assert.deepEqual(payload.registrationNos, ids); return { registrations: records }; },
    resolveHaguePdf: (_number, id) => ({ REFUSAL1: pdf1, REFUSAL2: pdf2, GRANT: pdf1 })[id],
  };
  const payload = { outputs: { hagueRefusals: true }, hagueNos: ids, orders: { hagueRefusals: ids } };
  const separate = await createBatchExport(payload, dependencies);
  assert.equal(separate.type, 'application/zip');
  const zip = await JSZip.loadAsync(separate.buffer);
  assert.deepEqual(Object.keys(zip.files), ['DM-225862_REFUSAL1_refusal.pdf', 'DM-213380_REFUSAL2_refusal.pdf']);
  const combined = await createBatchExport({ ...payload, combineHagueRefusals: true }, dependencies);
  assert.equal(combined.type, 'application/pdf');
  assert.equal((await PDFDocument.load(combined.buffer)).getPageCount(), 3);
  const one = await createBatchExport({ ...payload, hagueNos: [ids[0]], orders: { hagueRefusals: [ids[0]] } }, {
    ...dependencies, callDatabase: async () => ({ registrations: [records[0]] }),
  });
  assert.equal(one.type, 'application/zip');
  assert.equal(Object.keys((await JSZip.loadAsync(one.buffer)).files).length, 1);
});
