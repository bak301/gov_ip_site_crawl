'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { normalizeHagueNo, parseHagueNos, hagueUrl, parseHagueHtml, parseHaguePdfText, lookupHagueDesign, haguePdfPath, cachedHagueDesign } = require('../hague_design');

const html = `<div id="hagueTabs"><div id="currentStatus">
<div class="inid"><div class="inidCode">(11)</div><div class="inidText">International Registration Number</div></div><div class="text">DM/213 380</div>
<div class="inid"><div class="inidCode">(15)</div><div class="inidText">Date of the international registration</div></div><div class="text">15.03.2021</div>
<div class="inid"><div class="inidCode">(73)</div><div class="inidText">Name and address of the holder(s)</div></div><div class="text">Holder Ltd<br>123 Street<br>Hanoi</div>
<div class="inid"><div class="inidCode">(72)</div><div class="inidText">Name and address of creator of designs</div></div><div class="text"><ul><li><strong>1. </strong>Creator One<br>Address One</li><li><strong>2. </strong>Creator Two<br>Address Two</li></ul></div>
<div class="inid"><div class="inidCode">(81)</div><div class="inidText">Designated Contracting Parties</div></div><div class="text">US 1999 VN 1999</div>
</div><div id="history">
<div class="transaction countrySpecific VN"><h2 class="box">Refusal: VN: Bulletin No. 41/2021 (15.10.2021) <a class="pdfLink" href="https://www.wipo.int/idpub/41_2021/213380/970104173_REFUSAL.pdf">PDF</a></h2><div class="inid"><div class="inidCode">(24)</div><div class="inidText">Effect date</div></div><div class="text">01.10.2021</div></div>
<div class="transaction countrySpecific CN"><h2 class="box">Refusal: CN: Bulletin No. 50/2024 (01.12.2024)</h2></div>
<div class="transaction countrySpecific VN"><h2 class="box">Statement of Grant of Protection: VN: Bulletin No. 03/2025 (17.01.2025) <a class="pdfLink" href="https://www.wipo.int/idpub/03_2025/213380/970272755_STATEMENT.pdf">PDF</a></h2><div class="inid"><div class="inidCode">(24)</div><div class="inidText">Protection effective date</div></div><div class="text">19.04.2024</div></div>
</div></div>`;

test('Hague variants normalize to one six-digit identity and safe WIPO link', () => {
  assert.equal(normalizeHagueNo('DM/213 380'), 'DM/213380');
  assert.equal(normalizeHagueNo('dm213380'), 'DM/213380');
  assert.equal(normalizeHagueNo('DM/ 252407'), 'DM/252407');
  assert.equal(normalizeHagueNo('DM/21338'), '');
  assert.deepEqual(parseHagueNos('DM/213 380\nDM213380\nDM/ 252407\n1-2023-02108'), ['DM/213380', 'DM/252407']);
  assert.equal(hagueUrl('DM/213380'), 'https://designdb.wipo.int/designdb/en/showData.jsp?ID=HAGUE.D213380');
});

test('latest VN decision sets status while all VN fields and PDFs remain visible', () => {
  const result = parseHagueHtml(html, 'DM/213380');
  assert.equal(result.status, 'Granted');
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map(item => item.kind), ['Granted', 'Refusal']);
  assert.equal(result.events[0].effectiveDate, '19/04/2024');
  assert.equal(result.events[0].pdfUrl, 'https://www.wipo.int/idpub/03_2025/213380/970272755_STATEMENT.pdf');
  assert.equal(result.registrationDate, '15/03/2021');
  assert.deepEqual(result.holders, [{ name: 'Holder Ltd', address: '123 Street\nHanoi' }]);
  assert.deepEqual(result.creators, [{ designNo: '1', name: 'Creator One', address: 'Address One' }, { designNo: '2', name: 'Creator Two', address: 'Address Two' }]);
  assert.throws(() => parseHagueHtml(html, 'DM/999999'), /different Hague record/);
  assert.deepEqual(parseHaguePdfText('The protection is granted by Decision No.: 45905/QĐ-SHTT.IP of 19/04/2024. Protection is granted for all the industrial designs.'),
    { registrationNo: '', vnApplicationNos: [], decisionNo: '45905/QĐ-SHTT.IP', decisionDate: '19/04/2024', scope: 'All designs', office: '', amendments: '', refusalGrounds: '', effectDate: '', statementDate: '' });
  const parsedPdf = parseHaguePdfText('I. Office sending the statement: IP VIETNAM II. Number of international registration: DM/213380 III. Protection is granted for all the industrial designs IV. The protection is granted by Decision No.: 45905/QĐ-SHTT.IP of 19/04/2024 V. Information concerning amendments (where applicable): The description has been correctly amended. VI. Date on which the registration produced the effect: 19/04/2024 VII. Date of the statement: 19/04/2024 VIII. Signature');
  assert.equal(parsedPdf.registrationNo, 'DM/213380');
  assert.equal(parsedPdf.amendments, 'The description has been correctly amended.');
  assert.equal(parsedPdf.effectDate, '19/04/2024');
  assert.equal(parsedPdf.statementDate, '19/04/2024');
  const refusalPdf = parseHaguePdfText('II. Number of international registration: DM/225862 VIII. Subsequent procedures: The request should refer to application number in IP Viet Nam: 8 - 2023 - 00004. Also 8-2023-00004.');
  assert.deepEqual(refusalPdf.vnApplicationNos, ['8-2023-00004']);
});

test('creator given name and surname split across Hague lines remain one name', () => {
  const source = html.replace('Creator One<br>Address One', 'Michael<br>Best<br>12 Deerhunt Close')
    .replace('Creator Two<br>Address Two', 'Michael<br>Best<br>12 Deerhunt Close');
  const result = parseHagueHtml(source, 'DM/213380');
  assert.deepEqual(result.creators[0], { designNo: '1', name: 'Michael Best', address: '12 Deerhunt Close' });
  assert.equal(result.creators[1].name, 'Michael Best');
});

test('Hague international renewal is retained separately from VN protection status', () => {
  const renewal = `<div class="transaction"><h2 class="box">Partial Renewal (1R): VN: Bulletin No. 03/2026 (17.01.2026)</h2>
    <div class="inid"><div class="inidCode">(15)</div><div class="inidText">Date of renewal</div></div>
    <div class="text">15.03.2026</div>
    <div class="inid"><div class="inidCode">(18)</div><div class="inidText">Expected expiration date</div></div>
    <div class="text">15.03.2031</div></div>`;
  const result = parseHagueHtml(html.replace(/<\/div><\/div>$/, `${renewal}</div></div>`), 'DM/213380');
  assert.equal(result.status, 'Granted');
  assert.equal(result.events.length, 2);
  assert.equal(result.renewalEvents[0].kind, 'Partial renewal');
  assert.equal(result.renewalEvents[0].renewalDate, '15/03/2026');
  assert.equal(result.renewalEvents[0].expirationDate, '15/03/2031');
});

test('Hague PDFs are cached only when the response contains PDF bytes', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hague-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const pdf = await PDFDocument.create(); pdf.addPage();
  const pdfBytes = Buffer.from(await pdf.save());
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    return new Response(url.includes('showData.jsp') ? html : pdfBytes,
      { status: 200, headers: { 'content-type': url.includes('showData.jsp') ? 'text/html' : 'application/pdf' } });
  };
  const result = await lookupHagueDesign('DM/213 380', { cacheRoot: folder, fetcher });
  assert.equal(result.events.length, 2);
  assert.equal(result.events.every(item => item.pdfAvailable), true);
  assert.ok(haguePdfPath('DM/213380', result.events[0].id, folder));
  const again = await lookupHagueDesign('DM/213380', { cacheRoot: folder, fetcher });
  assert.equal(again.status, 'Granted');
  assert.equal(cachedHagueDesign('DM/213380', folder).status, 'Granted');
  assert.equal(cachedHagueDesign('DM/999999', folder), null);
  assert.equal(calls.length, 3);
  assert.equal(haguePdfPath('DM/213380', '../2', folder), '');
});

test('an HTTP 202 document response remains a source link, not a saved PDF', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hague-no-pdf-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const fetcher = async url => url.includes('showData.jsp') ? new Response(html, { status: 200 }) : new Response('', { status: 202 });
  const record = await lookupHagueDesign('DM/213380', { cacheRoot: folder, fetcher });
  assert.equal(record.status, 'Granted');
  assert.equal(record.events[0].pdfAvailable, false);
  assert.match(record.events[0].pdfError, /HTTP 202/);
  assert.match(record.events[0].pdfUrl, /STATEMENT\.pdf$/);
  assert.equal(haguePdfPath(record.number, record.events[0].id, folder), '');
});
