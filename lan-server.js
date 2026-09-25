'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { parseApplicationNumbers, normalizeApplicationNo, getRecordApplicationNo } = require('./tracker_core');
const { createOriginalOutputWorkbook } = require('./wipo_excel_export');
const { resolvePublicationPdf, listPublicationPdfs, checkPublicationA } = require('./publication_pdf');
const { createCaseRefResolver } = require('./case_ref_resolver');
const { renderReportPdf } = require('./report_pdf');

const ROOT = __dirname;
const ROUTE = '/wipo-application-tracker';
const DEFAULT_PORT = 47834;

function localDateFolder() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createDatabaseClient(databaseFile) {
  const helper = path.join(ROOT, 'wipo_history_db.py');
  return function callDatabase(command, payload = {}, extraArgs = []) {
    return new Promise((resolve, reject) => {
      const child = spawn(String(process.env.WIPO_PYTHON || 'python'), [helper, databaseFile, command, ...extraArgs], {
        cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(stderr.trim() || `Database helper exited with code ${code}.`));
        try { resolve(JSON.parse(stdout || '{}')); }
        catch { reject(new Error('Database helper returned invalid JSON.')); }
      });
      if (command === 'ingest' || command === 'list') child.stdin.end(JSON.stringify(payload));
      else child.stdin.end();
    });
  };
}

function latestRecords(applicationNos, folder = path.join(ROOT, 'Output', localDateFolder())) {
  const wanted = new Set(applicationNos.map(normalizeApplicationNo));
  const latest = new Map();
  if (!fs.existsSync(folder)) return [];
  for (const fileName of fs.readdirSync(folder)) {
    if (!/^(SC|KD|NH)_WIPO_\d{4}-\d{2}-\d{2}\.json$/i.test(fileName)) continue;
    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(path.join(folder, fileName), 'utf8')); } catch { continue; }
    for (const row of Array.isArray(rows) ? rows : []) {
      const applicationNo = getRecordApplicationNo(row);
      if (!wanted.has(applicationNo)) continue;
      const previous = latest.get(applicationNo);
      if (!previous || String(row.scraped_at || '') >= String(previous.scraped_at || '')) latest.set(applicationNo, row);
    }
  }
  return [...latest.values()];
}

function createScrapeRunner(callDatabase, onChild = () => {}) {
  return async function scrape(applicationNos, presetIndex = 1, retryCount = 10, onMessage = () => {}, jobId = '') {
    const ids = parseApplicationNumbers(applicationNos);
    if (!ids.length) throw new Error('No valid application numbers were supplied.');
    const safeJobId = String(jobId || `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-z0-9-]/gi, '_');
    const runRoot = path.join(ROOT, 'data', 'lan-runs', safeJobId);
    const inputFile = path.join(runRoot, 'input.txt');
    const outputDir = path.join(runRoot, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(inputFile, `${ids.join('\n')}\n`, 'utf8');
    try {
      const liveImported = new Map();
      const livePending = new Set();
      let liveIngest = Promise.resolve();
      const retries = Math.min(50, Math.max(0, Number.parseInt(retryCount, 10) || 0));
      const child = spawn(process.execPath, [path.join(ROOT, 'index_Wipo.js'), `--preset-index=${Number(presetIndex) || 1}`, `--retry-count=${retries}`, '--force-rescrape'], {
        cwd: ROOT, windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WIPO_LAN_FAIL_FAST: '1', WIPO_SKIP_POST_RETRY: '1', WIPO_INPUT_FILE: inputFile, WIPO_OUTPUT_DIR: outputDir },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      onChild(child, jobId);
      child.on('message', (payload) => {
        if (payload?.type !== 'wipo-record' || !payload.record) return;
        const applicationNo = getRecordApplicationNo(payload.record);
        if (!applicationNo || liveImported.has(applicationNo) || livePending.has(applicationNo)) return;
        livePending.add(applicationNo);
        liveIngest = liveIngest.then(async () => {
          const result = await callDatabase('ingest', { records: [payload.record], source: `LAN WIPO preset #${Number(presetIndex) || 1}` });
          const imported = (result.results || [])[0];
          if (imported) {
            liveImported.set(applicationNo, imported);
            onMessage({ type: 'record', applicationNo, imported });
          }
        }).catch((error) => onMessage({ type: 'log', level: 'error', message: `Could not store ${applicationNo} immediately: ${error.message}` }))
          .finally(() => livePending.delete(applicationNo));
      });
      const maximumDuration = Math.max(30000, Number(process.env.WIPO_LAN_SCRAPE_TIMEOUT_MS || 300000));
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGINT'); }, maximumDuration);
      let stderr = '';
      child.stdout.on('data', (chunk) => onMessage(chunk.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()));
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-12000); onMessage(chunk.toString().trim()); });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (value) => resolve(Number(value ?? 0))); }).finally(() => clearTimeout(timeout));
      await liveIngest;
      if (timedOut) throw new Error(`The shared scraper exceeded ${Math.round(maximumDuration / 60000)} minutes and was stopped so another user can continue.`);
      const records = latestRecords(ids, outputDir);
      const remainingRecords = records.filter((record) => !liveImported.has(getRecordApplicationNo(record)));
      const finalImported = remainingRecords.length ? await callDatabase('ingest', { records: remainingRecords, source: `LAN WIPO preset #${Number(presetIndex) || 1}` }) : { results: [] };
      const importedResults = [...liveImported.values(), ...(finalImported.results || [])];
      const importedNos = new Set(importedResults.map((item) => item.applicationNo));
      const missing = ids.filter((id) => !importedNos.has(id));
      return { ok: code === 0 && !missing.length, code, imported: importedResults, missing, error: code ? stderr : '' };
    } finally {
      try { fs.rmSync(runRoot, { recursive: true, force: true }); } catch { /* best-effort cleanup of this job's private files */ }
    }
  };
}

function createScrapeQueue(runTask, maxConcurrent = 3) {
  const pendingByApplication = new Map();
  const jobs = new Map();
  const waiting = [];
  const activeJobs = new Map();
  let sequence = 0;

  function pump() {
    while (activeJobs.size < maxConcurrent && waiting.length) {
      const entry = waiting.shift();
      const { job, applicationNos, presetIndex, retryCount, resolve, reject, promise } = entry;
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      job.message = `Scraping ${applicationNos.length} application${applicationNos.length === 1 ? '' : 's'} in shared slot ${activeJobs.size + 1}/${maxConcurrent}…`;
      activeJobs.set(job.id, { job, applicationNos });
      Promise.resolve().then(() => runTask(applicationNos, presetIndex, retryCount, (message) => {
        if (!message) return;
        if (typeof message === 'object' && message.type === 'record') {
          if (!job.completedApplications.includes(message.applicationNo)) job.completedApplications.push(message.applicationNo);
          job.revision += 1;
          job.message = `Stored ${job.completedApplications.length}/${applicationNos.length}: ${message.applicationNo}`;
          return;
        }
        job.message = String(typeof message === 'object' ? message.message || '' : message).slice(-500);
      }, job.id))
        .then(resolve, reject)
        .finally(() => {
          activeJobs.delete(job.id);
          applicationNos.forEach((applicationNo) => { if (pendingByApplication.get(applicationNo) === promise) pendingByApplication.delete(applicationNo); });
          pump();
        });
    }
    waiting.forEach((entry, index) => {
      entry.job.message = `Waiting for shared scraper slot ${index + 1}; ${activeJobs.size}/${maxConcurrent} slots are active…`;
    });
  }

  function enqueue(applicationNos, presetIndex = 1, retryCount = 10) {
    const ids = parseApplicationNumbers(applicationNos);
    if (!ids.length) throw new Error('Add at least one valid application number.');
    const id = `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    const job = { id, status: 'queued', applicationNos: ids, message: `Waiting for one of ${maxConcurrent} shared scraper slots…`, createdAt: new Date().toISOString(), result: null, error: '' };
    job.completedApplications = [];
    job.revision = 0;
    jobs.set(id, job);
    const dependencies = [];
    const newIds = [];
    for (const applicationNo of ids) {
      const existing = pendingByApplication.get(applicationNo);
      if (existing) dependencies.push(existing);
      else newIds.push(applicationNo);
    }
    let ownPromise = Promise.resolve({ ok: true, imported: [], missing: [] });
    if (newIds.length) {
      let resolveTask;
      let rejectTask;
      const task = new Promise((resolve, reject) => { resolveTask = resolve; rejectTask = reject; });
      ownPromise = task;
      newIds.forEach((applicationNo) => pendingByApplication.set(applicationNo, task));
      waiting.push({ job, applicationNos: newIds, presetIndex, retryCount, resolve: resolveTask, reject: rejectTask, promise: task });
      pump();
    }
    Promise.allSettled([ownPromise, ...dependencies]).then((settled) => {
      const failure = settled.find((item) => item.status === 'rejected');
      if (failure) {
        job.status = 'failed'; job.error = failure.reason?.message || String(failure.reason); job.message = job.error; return;
      }
      const results = settled.map((item) => item.value).filter(Boolean);
      const requested = new Set(ids);
      const imported = results.flatMap((result) => result.imported || []).filter((item) => requested.has(normalizeApplicationNo(item.applicationNo)));
      const missing = [...new Set(results.flatMap((result) => result.missing || []).filter((item) => requested.has(normalizeApplicationNo(item))))];
      job.result = { ok: results.every((result) => result.ok !== false), imported, missing };
      job.status = 'done';
      job.message = `Shared history updated for ${ids.length - missing.length}/${ids.length} application${ids.length === 1 ? '' : 's'}.`;
    });
    return job;
  }

  return {
    enqueue,
    get(id) { return jobs.get(String(id)); },
    pendingCount() { return pendingByApplication.size; },
    snapshot() {
      return {
        pendingApplications: pendingByApplication.size,
        capacity: maxConcurrent,
        activeJobIds: [...activeJobs.keys()],
        activeApplications: [...activeJobs.values()].flatMap((entry) => entry.applicationNos),
        activeJobs: activeJobs.size,
        queuedJobs: waiting.length,
      };
    },
  };
}

async function exportWorkbook(callDatabase, applicationNos) {
  const ids = parseApplicationNumbers(applicationNos);
  if (!ids.length) throw new Error('No applications were selected for export.');
  const details = (await Promise.all(ids.map((id) => callDatabase('detail', {}, ['--application-no', id])))).map((result) => result.detail).filter(Boolean);
  if (!details.length) throw new Error('The selected applications do not have scraped data yet.');
  const workbook = await createOriginalOutputWorkbook(details);
  return { buffer: await workbook.xlsx.writeBuffer(), count: details.length, name: ids.length === 1 ? `WIPO_${ids[0].replace(/-/g, '_')}.xlsx` : `WIPO_export_${localDateFolder()}.xlsx` };
}

function encodeHeaderFileName(filePath) {
  const original = path.basename(String(filePath || 'publication.pdf'));
  const fallback = original
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'publication.pdf';
  const encoded = encodeURIComponent(original).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function streamPdf(request, response, filePath) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const etag = `W/\"${size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}\"`;
  const disposition = encodeHeaderFileName(filePath);
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=3600' });
    return response.end();
  }
  const range = String(request.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return response.end();
    }
    response.writeHead(206, { 'Content-Type': 'application/pdf', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Disposition': disposition, ETag: etag, 'Cache-Control': 'public, max-age=3600' });
    if (request.method === 'HEAD') return response.end();
    return fs.createReadStream(filePath, { start, end }).pipe(response);
  }
  response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Content-Disposition': disposition, ETag: etag, 'Cache-Control': 'public, max-age=3600' });
  if (request.method === 'HEAD') return response.end();
  return fs.createReadStream(filePath).pipe(response);
}

function createLanServer(options = {}) {
  const host = String(options.host || process.env.WIPO_TRACKER_HOST || '0.0.0.0');
  const port = Number(options.port ?? process.env.WIPO_TRACKER_PORT ?? DEFAULT_PORT);
  const databaseFile = path.resolve(options.databaseFile || process.env.WIPO_TRACKER_DATABASE || path.join(ROOT, 'data', 'WIPO_Application_History.sqlite'));
  const callDatabase = options.callDatabase || createDatabaseClient(databaseFile);
  const publicationResolver = options.resolvePublicationPdf || resolvePublicationPdf;
  const publicationLister = options.listPublicationPdfs || listPublicationPdfs;
  const publicationAChecker = options.checkPublicationA || checkPublicationA;
  const caseRefResolver = options.caseRefResolver || createCaseRefResolver();
  const pdfRenderer = options.renderReportPdf || renderReportPdf;
  const activeChildren = new Map();
  const runner = options.runTask || createScrapeRunner(callDatabase, (child, jobId) => {
    activeChildren.set(String(jobId), child);
    child.once('close', () => { if (activeChildren.get(String(jobId)) === child) activeChildren.delete(String(jobId)); });
  });
  const queue = createScrapeQueue(runner, Number(options.maxConcurrent || process.env.WIPO_TRACKER_CONCURRENT_USERS || 3));
  const presets = (() => { try { return (JSON.parse(fs.readFileSync(path.join(ROOT, 'presets.json'), 'utf8')).presets || []).map((item, index) => ({ index: index + 1, name: item.name || `Preset ${index + 1}` })); } catch { return [{ index: 1, name: 'Fast' }]; } })();
  const assets = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'], ['/renderer.js', 'renderer.js'], ['/lan-bridge.js', 'lan-bridge.js'], ['/publication-viewer.mjs', 'publication-viewer.mjs'], ['/favicon.ico', 'favicon.ico'], ['/data-searching.png', 'data-searching.png'], ['/excel.png', 'excel.png'], ['/pdf.png', 'pdf.png'], ['/refresh.png', 'refresh.png'], ['/pencil.png', 'pencil.png'], ['/plus.png', 'plus.png'], ['/delete.png', 'delete.png']]);
  const vendorAssets = new Map([
    ['/vendor/pdf.mjs', path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs')],
    ['/vendor/pdf.worker.mjs', path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs')],
  ]);
  let server;

  async function body(request, maxBytes = 1_000_000) {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > maxBytes) throw new Error('Request is too large.'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }
  function json(response, status, value) {
    const data = Buffer.from(JSON.stringify(value));
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store' }); response.end(data);
  }

  async function handler(request, response) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = url.pathname.startsWith(`${ROUTE}/`) ? url.pathname.slice(ROUTE.length) : url.pathname;
      if (request.method === 'GET' && (url.pathname === ROUTE || url.pathname === '/')) { response.writeHead(302, { Location: `${ROUTE}/` }); return response.end(); }
      if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { service: 'WipoPublish Vietnam Search', ok: true, ...queue.snapshot() });
      if (request.method === 'GET' && pathname === '/api/init') { await callDatabase('init'); return json(response, 200, { ok: true, database: 'Shared LAN SQLite history', presets }); }
      if (request.method === 'POST' && pathname === '/api/list') return json(response, 200, await callDatabase('list', { applicationNos: parseApplicationNumbers((await body(request)).applicationNos || []) }));
      if (request.method === 'POST' && pathname === '/api/resolve-case-refs') return json(response, 200, await caseRefResolver.resolve((await body(request)).caseRefs || []));
      if (request.method === 'POST' && pathname === '/api/lookup-application-refs') return json(response, 200, await caseRefResolver.lookupApplications((await body(request)).applicationNos || []));
      if (request.method === 'GET' && pathname === '/api/publication-a-status') return json(response, 200, await publicationAChecker(normalizeApplicationNo(url.searchParams.get('applicationNo'))));
      if (request.method === 'GET' && pathname === '/api/detail') return json(response, 200, await callDatabase('detail', {}, ['--application-no', normalizeApplicationNo(url.searchParams.get('applicationNo'))]));
      if (request.method === 'GET' && pathname === '/api/publication-pdf-open') {
        const applicationNo = normalizeApplicationNo(url.searchParams.get('applicationNo'));
        const publication = await publicationResolver(applicationNo);
        response.writeHead(302, { Location: `${ROUTE}/api/publication-pdf?applicationNo=${encodeURIComponent(applicationNo)}#page=${publication.page || 1}`, 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (request.method === 'GET' && pathname === '/api/publication-pdfs') {
        const applicationNo = normalizeApplicationNo(url.searchParams.get('applicationNo'));
        const registrationNo = String(url.searchParams.get('registrationNo') || '');
        const documents = await publicationLister(applicationNo, registrationNo);
        return json(response, 200, { ok: true, documents: documents.map(item => ({ ...item, pdfPath: undefined, url: `${ROUTE}/api/publication-pdf?applicationNo=${encodeURIComponent(applicationNo)}&registrationNo=${encodeURIComponent(registrationNo)}&documentId=${encodeURIComponent(item.id || item.lookupKey || '')}#page=${item.page || 1}` })) });
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/api/publication-pdf') {
        const applicationNo = normalizeApplicationNo(url.searchParams.get('applicationNo'));
        const documentId = String(url.searchParams.get('documentId') || '');
        const publication = documentId
          ? (await publicationLister(applicationNo, String(url.searchParams.get('registrationNo') || ''))).find(item => String(item.id || item.lookupKey || '') === documentId)
          : await publicationResolver(applicationNo);
        if (!publication) return json(response, 404, { error: 'Publication PDF document was not found.' });
        response.setHeader('X-Publication-Page', String(publication.page || 1));
        return streamPdf(request, response, publication.pdfPath);
      }
      if (request.method === 'POST' && pathname === '/api/scrape') { const payload = await body(request); const job = queue.enqueue(payload.applicationNos || [], payload.presetIndex || 1, payload.retryCount ?? 10); return json(response, 202, { ok: true, jobId: job.id, message: job.message }); }
      if (request.method === 'GET' && pathname.startsWith('/api/jobs/')) { const job = queue.get(decodeURIComponent(pathname.slice('/api/jobs/'.length))); return job ? json(response, 200, job) : json(response, 404, { error: 'Scrape job not found.' }); }
      if (request.method === 'POST' && pathname === '/api/stop') {
        const payload = await body(request);
        const requestedJobId = String(payload.jobId || '');
        const child = requestedJobId ? activeChildren.get(requestedJobId) : (activeChildren.size === 1 ? [...activeChildren.values()][0] : null);
        if (!child) return json(response, 409, { error: activeChildren.size > 1 ? 'Choose the scrape job to stop; other users are currently scraping.' : 'No scrape is running for this user.' });
        child.kill('SIGINT');
        return json(response, 200, { ok: true, jobId: requestedJobId });
      }
      if (request.method === 'POST' && pathname === '/api/export') {
        const exported = await exportWorkbook(callDatabase, (await body(request)).applicationNos || []);
        response.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Length': exported.buffer.length, 'Content-Disposition': `attachment; filename="${exported.name}"`, 'X-Export-Count': String(exported.count), 'Cache-Control': 'no-store' }); return response.end(Buffer.from(exported.buffer));
      }
      if (request.method === 'POST' && pathname === '/api/export-pdf') {
        const payload = await body(request, 8_500_000);
        const applicationNo = normalizeApplicationNo(payload.applicationNo);
        if (!/^[1-5]-\d{4}-\d{4,}$/.test(applicationNo)) return json(response, 400, { error: 'A valid application number is required.' });
        if (typeof payload.html !== 'string' || !payload.html.includes(applicationNo)) return json(response, 400, { error: 'The PDF report does not match the selected application.' });
        const pdf = await pdfRenderer(payload.html);
        response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Content-Disposition': `attachment; filename="WIPO_${applicationNo}.pdf"`, 'Cache-Control': 'no-store' });
        return response.end(pdf);
      }
      const asset = assets.get(pathname);
      const vendorAsset = vendorAssets.get(pathname);
      if (vendorAsset) {
        const data = await fs.promises.readFile(vendorAsset);
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' });
        return response.end(data);
      }
      if (!asset) return json(response, 404, { error: 'Not found.' });
      const filePath = path.join(ROOT, 'electron', 'renderer', asset);
      const data = await fs.promises.readFile(filePath);
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
      response.writeHead(200, { 'Content-Type': types[path.extname(filePath)], 'Content-Length': data.length, 'Cache-Control': 'no-store' }); response.end(data);
    } catch (error) { if (!response.headersSent) json(response, 500, { error: error.message }); else response.end(); }
  }

  return {
    queue,
    async start() { await callDatabase('init'); server = http.createServer(handler); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); return { host, port: server.address().port, route: `${ROUTE}/` }; },
    async close() { for (const child of activeChildren.values()) child.kill(); activeChildren.clear(); if (server) await new Promise((resolve) => server.close(resolve)); },
  };
}

if (require.main === module) {
  const lan = createLanServer();
  lan.start().then((info) => console.log(`WipoPublish Vietnam Search LAN ready at http://${info.host}:${info.port}${info.route}`)).catch((error) => { console.error(error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await lan.close(); process.exit(0); });
}

module.exports = { ROUTE, DEFAULT_PORT, createScrapeQueue, createLanServer, exportWorkbook, encodeHeaderFileName, streamPdf };
