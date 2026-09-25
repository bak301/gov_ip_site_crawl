const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createScrapeQueue, createLanServer, encodeHeaderFileName } = require('../lan-server');

async function waitForJob(queue, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = queue.get(id);
    if (job?.status === 'done' || job?.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job ${id} did not finish.`);
}

test('shared scrape queue coalesces overlapping application requests', async () => {
  const calls = [];
  const queue = createScrapeQueue(async (ids) => {
    calls.push(ids);
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  });
  const first = queue.enqueue(['1-2022-01097', '1-2021-00452']);
  const second = queue.enqueue(['1-2021-00452', '1-2021-03185']);
  const [firstResult, secondResult] = await Promise.all([waitForJob(queue, first.id), waitForJob(queue, second.id)]);
  assert.equal(firstResult.status, 'done');
  assert.equal(secondResult.status, 'done');
  assert.deepEqual(calls, [['1-2022-01097', '1-2021-00452'], ['1-2021-03185']]);
  assert.deepEqual(secondResult.result.imported.map((item) => item.applicationNo), ['1-2021-03185', '1-2021-00452']);
});

test('shared scrape queue runs three isolated user jobs concurrently', async () => {
  let active = 0;
  let maximum = 0;
  const releases = [];
  const queue = createScrapeQueue(async (ids) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  }, 3);
  const jobs = ['1-2022-00001', '1-2022-00002', '1-2022-00003', '1-2022-00004'].map((id) => queue.enqueue([id]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queue.snapshot().activeJobs, 3);
  assert.equal(queue.snapshot().queuedJobs, 1);
  releases.shift()();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queue.snapshot().activeJobs, 3);
  while (releases.length) releases.shift()();
  await Promise.all(jobs.map((job) => waitForJob(queue, job.id)));
  assert.equal(maximum, 3);
});

test('shared scrape queue passes the user retry count to the scraper', async () => {
  const calls = [];
  const queue = createScrapeQueue(async (ids, presetIndex, retryCount) => {
    calls.push({ ids, presetIndex, retryCount });
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  });
  const job = queue.enqueue(['4-2025-31926'], 2, 7);
  await waitForJob(queue, job.id);
  assert.deepEqual(calls, [{ ids: ['4-2025-31926'], presetIndex: 2, retryCount: 7 }]);
});

test('shared scrape queue exposes each stored application before the batch finishes', async () => {
  let finish;
  const queue = createScrapeQueue(async (ids, _presetIndex, _retryCount, onMessage) => {
    onMessage({ type: 'record', applicationNo: ids[0] });
    await new Promise((resolve) => { finish = resolve; });
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  });
  const job = queue.enqueue(['1-2025-00613', '4-2025-31926']);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(queue.get(job.id).status, 'running');
  assert.deepEqual(queue.get(job.id).completedApplications, ['1-2025-00613']);
  finish();
  await waitForJob(queue, job.id);
});

test('publication Content-Disposition safely preserves Vietnamese filenames', () => {
  const header = encodeHeaderFileName('CB_411_A1_Sáng chế_06_2022.pdf');
  assert.match(header, /^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.match(header, /S%C3%A1ng%20ch%E1%BA%BF/);
  assert.doesNotThrow(() => new Headers({ 'Content-Disposition': header }));
});

test('LAN server exposes the tracker page and shared database APIs', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-lan-'));
  const pdfPath = path.join(folder, 'CB_399_A1_Sáng chế.pdf');
  fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\ntracker-test'));
  const server = createLanServer({
    host: '127.0.0.1', port: 0, databaseFile: path.join(folder, 'history.sqlite'),
    caseRefResolver: {
      resolve: async (refs) => ({ ok: true, matches: [{ caseRef: refs[0], applicationNos: ['1-2022-03660'] }], missing: [] }),
      lookupApplications: async () => ({ ok: true, matches: [{ applicationNo: '1-2022-03660', caseRefs: ['IP/PR17258/CDD'] }] }),
    },
    checkPublicationA: async () => ({ ok: true, hasPublicationA: false }),
    renderReportPdf: async () => Buffer.from('%PDF-1.4\nreport-test'),
    resolvePublicationPdf: async () => ({ pdfPath, page: 588 }),
    listPublicationPdfs: async () => ([
      { id: 1, category: 'publication_a', applicationNo: '1-2021-00451', pdfPath, page: 1 },
      { id: 2, category: 'publication_b', applicationNo: '1-2021-00451', pdfPath, page: 1 },
      { id: 3, category: 'annuity', requestNo: 'DT1-2026-00100', pdfPath, page: 1 },
    ]),
  });
  const info = await server.start();
  const base = `http://127.0.0.1:${info.port}/wipo-application-tracker`;
  try {
    const page = await fetch(`${base}/`).then((response) => response.text());
    assert.match(page, /WipoPublish Vietnam Search/);
    assert.match(page, /<link rel="icon" type="image\/x-icon" href="favicon\.ico\?v=2">/);
    assert.match(page, /<link rel="icon" type="image\/png" sizes="512x512" href="data-searching\.png\?v=2">/);
    assert.match(page, /<img class="brand-mark" src="data-searching\.png" alt="">/);
    const icon = await fetch(`${base}/data-searching.png`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()), fs.readFileSync(path.join(__dirname, '..', 'data-searching.png')));
    const favicon = await fetch(`${base}/favicon.ico?v=2`);
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get('content-type'), 'image/x-icon');
    assert.deepEqual(Buffer.from(await favicon.arrayBuffer()), fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer', 'favicon.ico')));
    for (const iconName of ['pencil.png', 'plus.png', 'delete.png']) {
      const response = await fetch(`${base}/${iconName}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer', iconName)));
    }
    const init = await fetch(`${base}/api/init`).then((response) => response.json());
    assert.equal(init.ok, true);
    assert.equal(init.database, 'Shared LAN SQLite history');
    const list = await fetch(`${base}/api/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationNos: ['1-2022-01097'] }) }).then((response) => response.json());
    assert.deepEqual(list.applications, []);
    const references = await fetch(`${base}/api/resolve-case-refs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseRefs: ['IP/PR17258/CDD'] }) }).then((response) => response.json());
    assert.deepEqual(references.matches, [{ caseRef: 'IP/PR17258/CDD', applicationNos: ['1-2022-03660'] }]);
    const inverse = await fetch(`${base}/api/lookup-application-refs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationNos: ['1-2022-03660'] }) }).then((response) => response.json());
    assert.deepEqual(inverse.matches, [{ applicationNo: '1-2022-03660', caseRefs: ['IP/PR17258/CDD'] }]);
    const publicationAStatus = await fetch(`${base}/api/publication-a-status?applicationNo=1-2022-03660`).then((response) => response.json());
    assert.deepEqual(publicationAStatus, { ok: true, hasPublicationA: false });
    const report = await fetch(`${base}/api/export-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationNo: '1-2022-03660', html: '<html class="printing-report">1-2022-03660</html>' }) });
    assert.equal(report.status, 200);
    assert.equal(report.headers.get('content-type'), 'application/pdf');
    assert.match(report.headers.get('content-disposition'), /WIPO_1-2022-03660\.pdf/);
    assert.equal(await report.text(), '%PDF-1.4\nreport-test');
    const documents = await fetch(`${base}/api/publication-pdfs?applicationNo=1-2021-00451`).then((response) => response.json());
    assert.deepEqual(documents.documents.map(item => item.category), ['publication_a', 'publication_b', 'annuity']);
    const redirect = await fetch(`${base}/api/publication-pdf-open?applicationNo=1-2021-00451`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.match(redirect.headers.get('location'), /api\/publication-pdf\?applicationNo=1-2021-00451#page=588$/);
    const pdf = await fetch(`${base}/api/publication-pdf?applicationNo=1-2021-00451`, { headers: { Range: 'bytes=0-7' } });
    assert.equal(pdf.status, 206);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition'), /filename\*=UTF-8''CB_399_A1_S%C3%A1ng%20ch%E1%BA%BF\.pdf/);
    assert.equal(await pdf.text(), '%PDF-1.4');
  } finally {
    await server.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
