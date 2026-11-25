'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { mergePublicationPdfs } = require('../publication_pdf_merge');

test('annuity PDFs merge in the supplied document order', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-annuity-merge-'));
  try {
    const files = [];
    for (const pageCount of [1, 2, 3]) {
      const pdf = await PDFDocument.create();
      for (let page = 0; page < pageCount; page += 1) pdf.addPage([300, 400]);
      const file = path.join(folder, `${pageCount}.pdf`);
      fs.writeFileSync(file, await pdf.save());
      files.push({ pdfPath: file });
    }
    const merged = await PDFDocument.load(await mergePublicationPdfs(files));
    assert.equal(merged.getPageCount(), 6);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
