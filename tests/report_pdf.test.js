const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReportPdf, closeReportPdfBrowser } = require('../report_pdf');

test('PDF export renders a downloadable report without network access', async () => {
  try {
    const pdf = await renderReportPdf('<!doctype html><html><body class="printing-report"><h1>WipoPublish Vietnam</h1><p>Cấp bằng</p></body></html>');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 1000);
  } finally {
    await closeReportPdfBrowser();
  }
});
