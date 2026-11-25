const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReportPdf, closeReportPdfBrowser } = require('../report_pdf');

test('PDF export renders a downloadable report without network access', async () => {
  try {
    const pdf = await renderReportPdf('<!doctype html><html><body class="printing-report"><h1>WipoPublish Vietnam</h1><p>Cấp bằng</p></body></html>');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 1000);
    const hague = await renderReportPdf('<!doctype html><html><body class="printing-hague-report"><h1>DM/225862</h1><p>8-2023-00004</p></body></html>');
    assert.equal(hague.subarray(0, 5).toString(), '%PDF-');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await getDocument({ data: new Uint8Array(hague) }).promise;
    const text = (await (await document.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
    assert.match(text, /DM\/225862/);
    assert.match(text, /8-2023-00004/);
  } finally {
    await closeReportPdfBrowser();
  }
});
