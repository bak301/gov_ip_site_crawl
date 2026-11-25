'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { usesSourcePreview, publicationPdfBytes } = require('../publication_pdf_bytes');

test('A/B source preview extracts indexed non-contiguous pages only on request', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-source-pages-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const sourcePath = path.join(folder, 'volume.pdf');
  const source = await PDFDocument.create();
  source.addPage([101, 101]);
  source.addPage([202, 202]);
  source.addPage([303, 303]);
  fs.writeFileSync(sourcePath, await source.save());
  const document = { modeId: '10', sourcePath, sourcePages: [1, 3], pdfPath: path.join(folder, 'not-created.pdf') };
  assert.equal(usesSourcePreview(document), true);
  const extracted = await PDFDocument.load(await publicationPdfBytes(document));
  assert.deepEqual(extracted.getPages().map(page => page.getWidth()), [101, 303]);
  assert.equal(fs.existsSync(document.pdfPath), false);
  assert.equal(usesSourcePreview({ ...document, modeId: '4' }), true);
});

test('WIPO filing registration and request identifiers are highlighted in a temporary response', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-highlight-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const sourcePath = path.join(folder, 'volume.pdf');
  const source = await PDFDocument.create();
  const page = source.addPage();
  page.drawText('1-2020-01234 1-0056206-000 DT1-2025-12345', { x: 50, y: 600, size: 12 });
  const original = Buffer.from(await source.save());
  fs.writeFileSync(sourcePath, original);
  const document = { sourcePath, sourcePages: [1], applicationNo: '1-2020-01234', registrationNo: '56206', requestNo: 'DT1-2025-12345', repositoryDatabase: path.join(folder, 'repository.sqlite') };
  const bytes = await publicationPdfBytes(document);
  const output = await PDFDocument.load(bytes);
  assert.equal(output.getPage(0).node.Annots().size(), 3);
  assert.deepEqual(fs.readFileSync(sourcePath), original);
  const shared = require('../../3_Input/Pub/Publication extraction/publication_gui/publication_pdf_resource');
  const legacy = await shared.resolvePublicationResource({ pdfPath: sourcePath, pageCount: 1, applicationNo: document.applicationNo });
  assert.equal(legacy.temporary, true);
  assert.equal((await PDFDocument.load(fs.readFileSync(legacy.path))).getPage(0).node.Annots().size(), 1);
  await legacy.cleanup();
  await legacy.cleanup();
  assert.equal(fs.existsSync(legacy.path), false);
  assert.deepEqual(fs.readFileSync(sourcePath), original);
});
