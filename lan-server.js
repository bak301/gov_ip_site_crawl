'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { recordActivity, flushActivity } = require('../electron-app/softip_activity_log');
const { currentIcon } = require('../electron-app/wipo_lan_icon');
const { parseApplicationNumbers, normalizeApplicationNo, getRecordApplicationNo } = require('./tracker_core');
const { createOriginalOutputWorkbook, createConfiguredOutputWorkbook } = require('./wipo_excel_export');
const { resolvePublicationPdf, listPublicationPdfs, checkPublicationA, lookupPublicationRegistrations, lookupInternationalPublications, syncHaguePublicationIndex } = require('./publication_pdf');
const { lookupRequestPublication, lookupRequestPublications, lookupRequestExportRecords, normalizeRequestNo } = require('./request_publication');
const { createCaseRefResolver } = require('./case_ref_resolver');
const { renderReportPdf } = require('./report_pdf');
const { createBatchExport } = require('./batch_export');
const { listApplicationMedia, readApplicationMedia } = require('./application_media');
const { mergePublicationPdfs } = require('./publication_pdf_merge');
const { usesSourcePreview, publicationPdfBytes } = require('./publication_pdf_bytes');
const { createWipoSiteMonitor } = require('./wipo_site_status');
const { lookupHagueDesign, normalizeHagueNo, haguePdfPath, cachedHagueDesign } = require('./hague_design');
const { createScrapePriorityResolver } = require('./scrape_priority');

const ROOT = __dirname;
const SCRAPER_ROOT = path.resolve(process.env.WIPO_SCRAPER_ROOT || path.join(ROOT, '..', 'Wipopublish_Scrape_ApplicationDetails'));
const SCRAPER_SCRIPT = path.join(SCRAPER_ROOT, 'index_Wipo.js');
const SCRAPER_PRESETS = path.join(SCRAPER_ROOT, 'presets.json');
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
      if (['ingest', 'list', 'scrape-events', 'latest-records', 'hague-ingest', 'hague-list'].includes(command)) child.stdin.end(JSON.stringify(payload));
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

function createScraperLineEmitter(onLine) {
  let pending = '';
  return {
    push(chunk) {
      const lines = `${pending}${String(chunk || '').replace(/\r\n?/g, '\n')}`.split('\n');
      pending = lines.pop();
      for (const line of lines) if (line.trim()) onLine(line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd());
    },
    flush() {
      if (pending.trim()) onLine(pending.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd());
      pending = '';
    },
  };
}

function createScrapeRunner(callDatabase, onChild = () => {}) {
  return async function scrape(applicationNos, presetIndex = 1, retryCount = 10, onMessage = () => {}, jobId = '', userId = '', clientAddress = '') {
    const ids = parseApplicationNumbers(applicationNos);
    if (!ids.length) throw new Error('No valid application numbers were supplied.');
    const safeJobId = String(jobId || `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-z0-9-]/gi, '_');
    const runRoot = path.join(ROOT, 'data', 'lan-runs', safeJobId);
    const inputFile = path.join(runRoot, 'input.txt');
    const outputDir = path.join(runRoot, 'output');
    const madridImageDir = path.join(ROOT, 'data', 'madrid-images');
    function preserveMadridImage(record) {
      const id = getRecordApplicationNo(record);
      if (!/^5-\d{7}$/.test(id)) return record;
      const source = path.resolve(String(record?.madrid?.local_image_path || record?.image || ''));
      const relative = path.relative(path.join(outputDir, 'Madrid_Images'), source);
      const extension = path.extname(source).toLowerCase();
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) ||
        !['.png', '.jpg', '.jpeg', '.gif'].includes(extension) ||
        path.basename(source).toLowerCase() !== `${id}${extension}`.toLowerCase() || !fs.existsSync(source)) return record;
      fs.mkdirSync(madridImageDir, { recursive: true });
      const saved = path.join(madridImageDir, `${id}${extension}`);
      fs.copyFileSync(source, saved);
      return { ...record, image: saved, madrid: { ...record.madrid, local_image_path: saved } };
    }
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(inputFile, `${ids.join('\n')}\n`, 'utf8');
    try {
      const liveImported = new Map();
      const livePending = new Set();
      const notFound = new Map();
      let liveIngest = Promise.resolve();
      const retries = Math.min(50, Math.max(0, Number.parseInt(retryCount, 10) || 0));
      if (!fs.existsSync(SCRAPER_SCRIPT)) throw new Error(`Migrated WIPO scraper was not found at ${SCRAPER_SCRIPT}`);
      const child = spawn(process.execPath, [SCRAPER_SCRIPT, `--preset-index=${Number(presetIndex) || 1}`, `--retry-count=${retries}`, '--force-rescrape'], {
        cwd: SCRAPER_ROOT, windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WIPO_LAN_FAIL_FAST: '1', WIPO_SKIP_POST_RETRY: '1', WIPO_BETWEEN_REQUEST_MS: '1000', WIPO_INPUT_FILE: inputFile, WIPO_OUTPUT_DIR: outputDir },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      onChild(child, jobId);
      child.on('message', (payload) => {
        if (payload?.type === 'wipo-not-found' && payload.applicationNo) {
          const applicationNo = normalizeApplicationNo(payload.applicationNo);
          notFound.set(applicationNo, payload);
          onMessage({ type: 'not-found', applicationNo, reason: payload.reason, attempts: payload.attempts });
          return;
        }
        if (payload?.type !== 'wipo-record' || !payload.record) return;
        let record = payload.record;
        try { record = preserveMadridImage(record); }
        catch (error) { onMessage({ type: 'log', level: 'error', message: `Could not retain Madrid sample image: ${error.message}` }); }
        const applicationNo = getRecordApplicationNo(record);
        if (!applicationNo || liveImported.has(applicationNo) || livePending.has(applicationNo)) return;
        livePending.add(applicationNo);
        liveIngest = liveIngest.then(async () => {
          const result = await callDatabase('ingest', { records: [record], source: `LAN WIPO preset #${Number(presetIndex) || 1}` });
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
      const stdoutLines = createScraperLineEmitter((line) => onMessage({ type: 'log', message: line }));
      const stderrLines = createScraperLineEmitter((line) => onMessage({ type: 'log', level: 'error', message: line }));
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => stdoutLines.push(chunk));
      child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); stderrLines.push(chunk); });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (value) => resolve(Number(value ?? 0))); }).finally(() => clearTimeout(timeout));
      stdoutLines.flush();
      stderrLines.flush();
      await liveIngest;
      if (timedOut) throw new Error(`The shared scraper exceeded ${Math.round(maximumDuration / 60000)} minutes and was stopped so another user can continue.`);
      const records = latestRecords(ids, outputDir);
      const remainingRecords = records.filter((record) => !liveImported.has(getRecordApplicationNo(record))).map((record) => {
        try { return preserveMadridImage(record); }
        catch (error) { onMessage({ type: 'log', level: 'error', message: `Could not retain Madrid sample image: ${error.message}` }); return record; }
      });
      const finalImported = remainingRecords.length ? await callDatabase('ingest', { records: remainingRecords, source: `LAN WIPO preset #${Number(presetIndex) || 1}` }) : { results: [] };
      const importedResults = [...liveImported.values(), ...(finalImported.results || [])];
      const importedNos = new Set(importedResults.map((item) => item.applicationNo));
      const missing = ids.filter((id) => !importedNos.has(id));
      return { ok: code === 0 && !missing.length, code, imported: importedResults, missing, notFound: [...notFound.values()], error: code ? stderr : '' };
    } finally {
      await flushActivity().catch((error) => console.error('Activity log:', error.message));
      try { fs.rmSync(runRoot, { recursive: true, force: true }); } catch { /* best-effort cleanup of this job's private files */ }
    }
  };
}

function createScrapeQueue(runTask, maxConcurrent = 15, options = {}) {
  const perClientConcurrent = Math.max(1, Number(options.perClientConcurrent ?? 5));
  const dispatchIntervalMs = Math.max(0, Number(options.dispatchIntervalMs ?? 1000));
  const retryPasses = Math.max(0, Math.min(10, Math.floor(Number(options.retryPasses ?? 0) || 0)));
  const consecutiveRetries = options.retryMode === 'consecutive';
  const burstRetries = options.retryMode === 'burst';
  const burstSize = Math.max(1, Math.floor(Number(options.burstSize ?? 5) || 5));
  const requestedReserve = Number(options.firstSlotReserve ?? 0);
  const firstSlotReserve = Number.isFinite(requestedReserve) ? Math.max(0, Math.min(maxConcurrent, Math.floor(requestedReserve))) : 0;
  const burstCapacity = maxConcurrent - firstSlotReserve;
  const onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : () => {};
  const jobLogs = new Map();
  function recordLog(job, message) {
    const log = jobLogs.get(job.id);
    if (!log) return;
    for (const line of String(message || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      log.sequence += 1;
      log.events.push({ sequence: log.sequence, message: text });
      if (log.events.length > 300) log.events.shift();
    }
  }
  const pendingByApplication = new Map();
  const jobs = new Map();
  const flows = new Map();
  const flowOrder = [];
  const activeJobs = new Map();
  const activeByClient = new Map();
  const lastDispatchByClient = new Map();
  let sequence = 0;
  let flowCursor = 0;
  let pumpTimer = null;
  let pumpDueAt = 0;

  function cancelledResult(applicationNo) {
    return { ok: false, cancelled: true, imported: [], missing: [], notFound: [], applicationNo, error: 'Stopped by user.' };
  }

  function applicationState(entry, status, extra = {}) {
    return { status, attempt: entry.attempt, maxAttempts: entry.maxAttempts,
      initialAttempts: entry.initialAttempts, maxRetries: entry.maxRetries,
      ...(burstRetries ? { scrapeCap: entry.maxAttempts, burstSize } : {}), ...extra };
  }

  function attemptLabel(entry, attempt = entry.attempt) {
    if (burstRetries) return `scrape ${attempt}/${entry.maxAttempts}`;
    return attempt <= entry.initialAttempts
      ? `attempt ${attempt}/${entry.initialAttempts}`
      : `retry ${attempt - entry.initialAttempts}/${entry.maxRetries}`;
  }

  function addToFlow(entry) {
    if (!flows.has(entry.clientId)) {
      flows.set(entry.clientId, []);
      flowOrder.push(entry.clientId);
    }
    const flow = flows.get(entry.clientId);
    if ((consecutiveRetries && entry.attempt > 0)
      || (burstRetries && entry.attempt > 0 && entry.attempt % burstSize !== 0)) {
      flow.unshift(entry);
      return;
    }
    const entryPriority = [entry.attempt > 0 ? 1 : 0, entry.rank];
    const afterHigherPriority = flow.findIndex((queued) => {
      const queuedPriority = [queued.attempt > 0 ? 1 : 0, queued.rank];
      return queuedPriority[0] > entryPriority[0]
        || (queuedPriority[0] === entryPriority[0] && queuedPriority[1] > entryPriority[1]);
    });
    if (afterHigherPriority < 0) flow.push(entry);
    else flow.splice(afterHigherPriority, 0, entry);
  }

  function takeNextBatch(availableSlots, now = Date.now()) {
    if (!flowOrder.length) return { entries: [], delay: Infinity };
    let minimumDelay = Infinity;
    const activeBurst = activeJobs.size - activeByClient.size;
    const checked = flowOrder.length;
    for (let count = 0; count < checked && flowOrder.length; count += 1) {
      flowCursor %= flowOrder.length;
      const clientId = flowOrder[flowCursor];
      const active = activeByClient.get(clientId) || 0;
      if (active > 0 && activeBurst >= burstCapacity) {
        flowCursor = (flowCursor + 1) % flowOrder.length;
        continue;
      }
      const delay = Math.max(0, dispatchIntervalMs - (now - (lastDispatchByClient.get(clientId) || 0)));
      if (active < perClientConcurrent && delay === 0) {
        const flow = flows.get(clientId);
        const first = flow.shift();
        if (!flow.length) {
          flows.delete(clientId);
          flowOrder.splice(flowCursor, 1);
          if (flowCursor >= flowOrder.length) flowCursor = 0;
        } else flowCursor = (flowCursor + 1) % flowOrder.length;
        return { entries: [first], delay: 0 };
      }
      if (active < perClientConcurrent) minimumDelay = Math.min(minimumDelay, delay);
      flowCursor = (flowCursor + 1) % flowOrder.length;
    }
    return { entries: [], delay: minimumDelay };
  }

  function queuedEntries() { return flowOrder.flatMap((clientId) => flows.get(clientId) || []); }

  function schedulePump(delay) {
    if (!Number.isFinite(delay)) return;
    const dueAt = Date.now() + Math.max(1, delay);
    if (pumpTimer && pumpDueAt <= dueAt) return;
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpDueAt = dueAt;
    pumpTimer = setTimeout(() => { pumpTimer = null; pumpDueAt = 0; pump(); }, Math.max(1, delay));
  }

  function pump() {
    if (pumpTimer) { clearTimeout(pumpTimer); pumpTimer = null; pumpDueAt = 0; }
    let nextDelay = Infinity;
    while (activeJobs.size < maxConcurrent && flowOrder.length) {
      const next = takeNextBatch(maxConcurrent - activeJobs.size);
      const entries = next.entries;
      if (!entries.length) { nextDelay = next.delay; break; }
      const clientId = entries[0].clientId;
      const applicationNos = entries.map((entry) => entry.applicationNo);
      entries.forEach((entry) => {
        entry.attempt += 1;
        entry.job.status = 'running';
        if (!entry.job.startedAt) entry.job.startedAt = new Date().toISOString();
        entry.job.applicationStates[entry.applicationNo] = applicationState(entry, 'running');
        entry.job.message = `Fast batch ${applicationNos.join(', ')} · ${attemptLabel(entry)}`;
        recordLog(entry.job, entry.job.message);
        activeJobs.set(entry.taskId, { job: entry.job, applicationNos: [entry.applicationNo], clientId });
      });
      activeByClient.set(clientId, (activeByClient.get(clientId) || 0) + entries.length);
      lastDispatchByClient.set(clientId, Date.now());
      const batchTaskId = entries.map((entry) => entry.taskId).join('__');
      Promise.resolve().then(() => runTask(applicationNos, entries[0].presetIndex, 0, (message) => {
        if (!message || entries.every((entry) => entry.job.cancelRequested)) return;
        if (typeof message === 'object' && message.type === 'record') {
          const target = entries.find((entry) => entry.applicationNo === normalizeApplicationNo(message.applicationNo));
          if (target && !target.job.completedApplications.includes(message.applicationNo)) target.job.completedApplications.push(message.applicationNo);
          if (target) { target.job.revision += 1; target.job.message = `Stored ${message.applicationNo}`; }
          return;
        }
        if (typeof message === 'object' && message.type === 'not-found') {
          const target = entries.find((entry) => entry.applicationNo === normalizeApplicationNo(message.applicationNo));
          if (target) {
            target.job.revision += 1;
            target.job.message = `Not found after ${message.attempts || 2} valid responses: ${message.applicationNo}`;
            recordLog(target.job, target.job.message);
          }
          return;
        }
        const text = String(typeof message === 'object' ? message.message || '' : message).slice(-500);
        entries.forEach((entry) => { entry.job.message = text; recordLog(entry.job, text); });
      }, batchTaskId, clientId, entries[0].clientAddress))
        .then((result) => {
          const missing = new Set((result?.missing || []).map(normalizeApplicationNo));
          const notFound = new Map((result?.notFound || []).map((item) => [normalizeApplicationNo(item.applicationNo), item]));
          for (const entry of entries) {
            if (entry.job.cancelRequested) {
              entry.job.applicationStates[entry.applicationNo] = applicationState(entry, 'cancelled');
              entry.resolve(cancelledResult(entry.applicationNo));
              continue;
            }
            const imported = (result?.imported || []).filter((item) => normalizeApplicationNo(item.applicationNo) === entry.applicationNo);
            const isMissing = missing.has(entry.applicationNo);
            const perResult = { ok: !isMissing, imported, missing: isMissing ? [entry.applicationNo] : [], notFound: notFound.has(entry.applicationNo) ? [notFound.get(entry.applicationNo)] : [], error: result?.error || '' };
            if (isMissing && !notFound.has(entry.applicationNo) && entry.attempt < entry.maxAttempts) {
              entry.job.applicationStates[entry.applicationNo] = applicationState(entry, 'queued');
              const nextPosition = consecutiveRetries || (burstRetries && entry.attempt % burstSize !== 0) ? 'next' : 'after the other queued records';
              entry.job.message = `${entry.applicationNo} will ${burstRetries ? 'scrape' : 'retry'} ${nextPosition} · ${attemptLabel(entry, entry.attempt + 1)}`;
              recordLog(entry.job, entry.job.message);
              entry.job.revision += 1;
              addToFlow(entry);
            } else {
              entry.job.applicationStates[entry.applicationNo] = applicationState(entry, isMissing ? 'failed' : 'done');
              if (!isMissing) Promise.resolve(onSuccess({
                applicationNo: entry.applicationNo,
                imported,
                jobId: entry.job.id,
                clientId: entry.clientId,
                clientAddress: entry.clientAddress,
                attempt: entry.attempt,
              })).catch((error) => console.error('WipoPublish success log:', error.message));
              entry.resolve(perResult);
            }
          }
        }, (error) => {
          entries.forEach((entry) => {
            if (entry.job.cancelRequested) {
              entry.job.applicationStates[entry.applicationNo] = applicationState(entry, 'cancelled');
              entry.resolve(cancelledResult(entry.applicationNo));
            } else if (entry.attempt < entry.maxAttempts) {
              entry.job.applicationStates[entry.applicationNo] = applicationState(entry, 'queued');
              const nextPosition = consecutiveRetries || (burstRetries && entry.attempt % burstSize !== 0) ? 'next' : 'after the other queued records';
              entry.job.message = `${entry.applicationNo} will ${burstRetries ? 'scrape' : 'retry'} ${nextPosition} · ${attemptLabel(entry, entry.attempt + 1)}`;
              recordLog(entry.job, entry.job.message);
              entry.job.revision += 1;
              addToFlow(entry);
            } else entry.reject(error);
          });
        })
        .finally(() => {
          entries.forEach((entry) => {
            activeJobs.delete(entry.taskId);
            if (!flows.get(entry.clientId)?.includes(entry) && entry.job.applicationStates[entry.applicationNo]?.status !== 'queued' && pendingByApplication.get(entry.applicationNo) === entry.promise) pendingByApplication.delete(entry.applicationNo);
          });
          const remainingActive = Math.max(0, (activeByClient.get(clientId) || entries.length) - entries.length);
          if (remainingActive) activeByClient.set(clientId, remainingActive); else activeByClient.delete(clientId);
          pump();
        });
    }
    queuedEntries().forEach((entry, index) => {
      entry.job.applicationStates[entry.applicationNo] = applicationState(entry, 'queued', { position: index + 1 });
      if (entry.job.status === 'queued') entry.job.message = `Queued fairly by user · position ${index + 1} · ${activeJobs.size}/${maxConcurrent} slots active`;
    });
    if (flowOrder.length && activeJobs.size < maxConcurrent) schedulePump(nextDelay);
  }

  function enqueue(applicationNos, presetIndex = 1, retryCount = 10, clientId = 'anonymous', clientAddress = '', priorities = {}) {
    const ids = parseApplicationNumbers(applicationNos);
    if (!ids.length) throw new Error('Add at least one valid application number.');
    const id = `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    const owner = String(clientId || 'anonymous').slice(0, 100);
    const job = { id, clientId: owner, status: 'queued', applicationNos: ids, applicationStates: {}, message: `Waiting for one of ${maxConcurrent} shared scraper slots…`, createdAt: new Date().toISOString(), result: null, error: '' };
    job.completedApplications = [];
    job.revision = 0;
    jobs.set(id, job);
    jobLogs.set(id, { sequence: 0, events: [] });
    const dependencies = [];
    const newIds = [];
    for (const applicationNo of ids) {
      const existing = pendingByApplication.get(applicationNo);
      if (existing) dependencies.push(existing);
      else newIds.push(applicationNo);
    }
    const ownPromises = newIds.map((applicationNo, index) => {
      let resolveTask; let rejectTask;
      const task = new Promise((resolve, reject) => { resolveTask = resolve; rejectTask = reject; });
      pendingByApplication.set(applicationNo, task);
      const initialAttempts = consecutiveRetries ? 1 : Math.max(1, Number(retryCount) || 1);
      const maxRetries = consecutiveRetries ? Math.max(0, Math.min(5, Math.floor(Number(retryCount) || 0))) : retryPasses;
      const maxAttempts = burstRetries ? Math.max(1, Math.min(100, Math.floor(Number(retryCount) || 25))) : initialAttempts + maxRetries;
      const suggestedRank = Number(priorities[applicationNo]?.rank ?? priorities[applicationNo] ?? 1);
      const rank = Number.isFinite(suggestedRank) ? Math.max(0, Math.min(2, suggestedRank)) : 1;
      job.applicationStates[applicationNo] = { status: 'queued', attempt: 0, maxAttempts, initialAttempts, maxRetries,
        ...(burstRetries ? { scrapeCap: maxAttempts, burstSize } : {}) };
      addToFlow({ taskId: `${id}-${index + 1}`, clientId: owner, clientAddress, job, applicationNo, presetIndex, rank,
        attempt: 0, maxAttempts, initialAttempts, maxRetries, resolve: resolveTask, reject: rejectTask, promise: task });
      return task;
    });
    if (newIds.length) pump();
    Promise.allSettled([...ownPromises, ...dependencies]).then((settled) => {
      if (job.cancelRequested) return;
      const failure = settled.find((item) => item.status === 'rejected');
      if (failure) {
        job.status = 'failed'; job.error = failure.reason?.message || String(failure.reason); job.message = job.error;
        recordLog(job, `Scrape failed: ${job.error}`);
        return;
      }
      const results = settled.map((item) => item.value).filter(Boolean);
      const requested = new Set(ids);
      const imported = results.flatMap((result) => result.imported || []).filter((item) => requested.has(normalizeApplicationNo(item.applicationNo)));
      const missing = [...new Set(results.flatMap((result) => result.missing || []).filter((item) => requested.has(normalizeApplicationNo(item))))];
      const notFound = results.flatMap((result) => result.notFound || []).filter((item) => requested.has(normalizeApplicationNo(item.applicationNo)));
      job.result = { ok: results.every((result) => result.ok !== false), imported, missing, notFound };
      job.status = 'done';
      job.message = `Shared history updated for ${ids.length - missing.length}/${ids.length} application${ids.length === 1 ? '' : 's'}.`;
      recordLog(job, job.message);
    });
    return job;
  }

  function cancel(id, clientId, pumpAfter = true) {
    const job = jobs.get(String(id));
    if (!job) return { ok: false, statusCode: 404, error: 'Scrape job not found.' };
    const owner = String(clientId || '').slice(0, 100);
    if (!owner || job.clientId !== owner) return { ok: false, statusCode: 403, error: 'This scrape job belongs to another user.' };
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
      return { ok: job.status === 'cancelled', statusCode: 409, error: job.status === 'cancelled' ? 'This scrape job is already stopped.' : 'This scrape job has already finished.' };
    }

    job.cancelRequested = true;
    job.status = 'cancelled';
    job.message = 'Stopped by user.';
    recordLog(job, job.message);
    job.error = '';
    job.completedAt = new Date().toISOString();
    job.result = { ok: false, cancelled: true, imported: [], missing: [], notFound: [], error: 'Stopped by user.' };

    let queuedCancelled = 0;
    for (const [flowClientId, flow] of [...flows.entries()]) {
      const remaining = [];
      for (const entry of flow) {
        if (entry.job.id !== job.id) { remaining.push(entry); continue; }
        queuedCancelled += 1;
        job.applicationStates[entry.applicationNo] = { status: 'cancelled', attempt: entry.attempt, maxAttempts: entry.maxAttempts };
        if (pendingByApplication.get(entry.applicationNo) === entry.promise) pendingByApplication.delete(entry.applicationNo);
        entry.resolve(cancelledResult(entry.applicationNo));
      }
      if (remaining.length) flows.set(flowClientId, remaining); else flows.delete(flowClientId);
    }
    for (let index = flowOrder.length - 1; index >= 0; index -= 1) {
      if (!flows.has(flowOrder[index])) flowOrder.splice(index, 1);
    }
    flowCursor = flowOrder.length ? flowCursor % flowOrder.length : 0;
    const activeTaskIds = [...activeJobs.entries()].filter(([, active]) => active.job.id === job.id).map(([taskId]) => taskId);
    job.revision += 1;
    if (pumpAfter) pump();
    return { ok: true, jobId: job.id, status: 'cancelled', queuedCancelled, activeTaskIds };
  }

  function cancelAll(clientId) {
    const owner = String(clientId || '').slice(0, 100);
    if (!owner) return { ok: false, statusCode: 400, error: 'A browser user is required.' };
    const ownedJobs = [...jobs.values()].filter((job) => job.clientId === owner && (job.status === 'queued' || job.status === 'running'));
    const results = ownedJobs.map((job) => cancel(job.id, owner, false)).filter((result) => result.ok);
    pump();
    return {
      ok: true,
      status: 'cancelled',
      jobsStopped: results.length,
      queuedCancelled: results.reduce((total, result) => total + (result.queuedCancelled || 0), 0),
      activeTaskIds: [...new Set(results.flatMap((result) => result.activeTaskIds || []))],
      jobIds: results.map((result) => result.jobId),
      message: results.length ? `Stopped ${results.length} scrape job${results.length === 1 ? '' : 's'} for this user.` : 'No scrape jobs are active for this user.',
    };
  }

  return {
    enqueue,
    cancel,
    cancelAll,
    get(id) { return jobs.get(String(id)); },
    logEvents(id, after = 0) {
      return (jobLogs.get(String(id))?.events || []).filter((event) => event.sequence > Number(after || 0));
    },
    listByClient(clientId, activeOnly = true) {
      const owner = String(clientId || '').slice(0, 100);
      if (!owner) return [];
      return [...jobs.values()].filter((job) => job.clientId === owner && (!activeOnly || job.status === 'queued' || job.status === 'running'));
    },
    pendingCount() { return pendingByApplication.size; },
    snapshot() {
      return {
        pendingApplications: pendingByApplication.size,
        capacity: maxConcurrent,
        perClientCapacity: perClientConcurrent,
        firstSlotReserve,
        burstCapacity,
        activeBurst: activeJobs.size - activeByClient.size,
        dispatchIntervalMs,
        activeJobIds: [...activeJobs.keys()],
        activeApplications: [...activeJobs.values()].flatMap((entry) => entry.applicationNos),
        activeJobs: activeJobs.size,
        queuedJobs: queuedEntries().length,
        queuedClients: flowOrder.length,
        activeByClient: Object.fromEntries(activeByClient),
      };
    },
  };
}

async function exportWorkbook(callDatabase, applicationNos, excelColumns) {
  const ids = parseApplicationNumbers(applicationNos);
  if (!ids.length) throw new Error('No applications were selected for export.');
  const details = (await Promise.all(ids.map((id) => callDatabase('detail', {}, ['--application-no', id])))).map((result) => result.detail).filter(Boolean);
  if (!details.length) throw new Error('The selected applications do not have scraped data yet.');
  const workbook = excelColumns ? await createConfiguredOutputWorkbook(details, excelColumns) : await createOriginalOutputWorkbook(details);
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

async function streamPublicationEntry(request, response, document) {
  const shared = require('../3_Input/Pub/Publication extraction/publication_gui/publication_pdf_resource');
  const resource = await shared.resolvePublicationResource(document, document.repositoryDatabase ? { databasePath: document.repositoryDatabase } : {});
  response.once('close', () => resource.cleanup().catch(error => console.warn(`Publication temporary PDF cleanup: ${error.message}`)));
  return streamPdf(request, response, resource.path);
}

function createLanServer(options = {}) {
  const host = String(options.host || process.env.WIPO_TRACKER_HOST || '0.0.0.0');
  const port = Number(options.port ?? process.env.WIPO_TRACKER_PORT ?? DEFAULT_PORT);
  const databaseFile = path.resolve(options.databaseFile || process.env.WIPO_TRACKER_DATABASE || path.join(ROOT, 'data', 'WIPO_Application_History.sqlite'));
  const callDatabase = options.callDatabase || createDatabaseClient(databaseFile);
  const publicationResolver = options.resolvePublicationPdf || resolvePublicationPdf;
  const publicationLister = options.listPublicationPdfs || listPublicationPdfs;
  const requestPublicationLookup = options.lookupRequestPublication || lookupRequestPublication;
  const requestPublicationLookupMany = options.lookupRequestPublications || lookupRequestPublications;
  const hagueLookup = options.lookupHagueDesign || lookupHagueDesign;
  const hagueCacheReader = options.cachedHagueDesign || cachedHagueDesign;
  const haguePdfResolver = options.haguePdfPath || haguePdfPath;
  const publicationAChecker = options.checkPublicationA || checkPublicationA;
  const scrapePriorityLookup = options.lookupScrapePriorities || createScrapePriorityResolver({ tracker: databaseFile });
  const registrationLookup = options.lookupPublicationRegistrations || lookupPublicationRegistrations;
  const internationalPublicationLookup = options.lookupInternationalPublications || lookupInternationalPublications;
  const caseRefResolver = options.caseRefResolver || createCaseRefResolver();
  const pdfRenderer = options.renderReportPdf || renderReportPdf;
  const batchExporter = options.createBatchExport || createBatchExport;
  const siteMonitor = options.siteMonitor || createWipoSiteMonitor({
    historyDir: path.join(path.dirname(databaseFile), 'wipo-site-checks'),
    snapshotEvents: async (since) => (await callDatabase('scrape-events', { since })).snapshots,
  });
  const activeChildren = new Map();
  const runner = options.runTask || createScrapeRunner(callDatabase, (child, jobId) => {
    activeChildren.set(String(jobId), child);
    child.once('close', () => { if (activeChildren.get(String(jobId)) === child) activeChildren.delete(String(jobId)); });
  });
  const requestedCapacity = Number(options.maxConcurrent ?? process.env.WIPO_TRACKER_MAX_CONCURRENT_REQUESTS ?? 25);
  const maxConcurrent = Number.isFinite(requestedCapacity) ? Math.max(1, Math.floor(requestedCapacity)) : 25;
  const queue = createScrapeQueue(
    runner,
    maxConcurrent,
    {
      perClientConcurrent: Number(options.perClientConcurrent || process.env.WIPO_TRACKER_PER_USER_CONCURRENT || 5),
      dispatchIntervalMs: Number(options.dispatchIntervalMs ?? process.env.WIPO_TRACKER_PER_USER_INTERVAL_MS ?? 1000),
      retryMode: 'burst',
      burstSize: 5,
      firstSlotReserve: Number(options.firstSlotReserve ?? process.env.WIPO_TRACKER_FIRST_SLOT_RESERVE ?? Math.floor(maxConcurrent * 0.8)),
      onSuccess({ applicationNo, imported, jobId, clientId, clientAddress, attempt }) {
        const stored = imported.at(-1) || {};
        if (!stored.applicationNo && !stored.snapshotId) return;
        siteMonitor.confirmScrapeSuccess?.(applicationNo, stored);
        recordActivity({ service: 'wipo', action: 'scraped_entry', query: applicationNo,
          resultCount: 1, source: 'lan', userId: clientId, clientAddress,
          detail: JSON.stringify({ snapshotId: stored.snapshotId, changedFields: (stored.changes || []).length, jobId, attempt }) });
        flushActivity().catch((error) => console.error('Activity log:', error.message));
      },
    },
  );
  const presets = (() => { try { return (JSON.parse(fs.readFileSync(SCRAPER_PRESETS, 'utf8')).presets || []).map((item, index) => ({ index: index + 1, name: item.name || `Preset ${index + 1}` })); } catch { return [{ index: 1, name: 'Fast' }]; } })();
  const assets = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'], ['/renderer.js', 'renderer.js'], ['/lan-bridge.js', 'lan-bridge.js'], ['/publication-viewer.mjs', 'publication-viewer.mjs'], ['/favicon.ico', 'favicon.ico'], ['/data-searching.png', 'data-searching.png'], ['/setting.png', 'setting.png'], ['/eye.png', 'eye.png'], ['/excel.png', 'excel.png'], ['/pdf.png', 'pdf.png'], ['/refresh.png', 'refresh.png'], ['/pencil.png', 'pencil.png'], ['/plus.png', 'plus.png'], ['/delete.png', 'delete.png']]);
  assets.set('/softip_display_hash.js', path.resolve(ROOT, '..', 'electron-app', 'softip_display_hash.js'));
  assets.set('/text_diff.js', path.resolve(ROOT, '..', 'electron-app', 'text_diff.js'));
  assets.set('/wipo_applicant_history.js', path.resolve(ROOT, '..', 'electron-app', 'wipo_applicant_history.js'));
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
      if (request.method === 'GET' && pathname === '/api/site-status') return json(response, 200, await siteMonitor.check(url.searchParams.get('refresh') === '1'));
      if (request.method === 'GET' && pathname === '/api/site-status-history') return json(response, 200, await siteMonitor.history(url.searchParams.get('day')));
      if (request.method === 'GET' && pathname === '/api/brand-icon') {
        const icon = currentIcon();
        response.writeHead(200, { 'Content-Type': icon.mime, 'Content-Length': icon.bytes.length, 'Cache-Control': 'no-store' });
        return response.end(icon.bytes);
      }
      if (request.method === 'GET' && pathname === '/api/init') {
        await callDatabase('init');
        let status = null; let statusDatabaseError = '';
        try { status = caseRefResolver.initialize ? await caseRefResolver.initialize() : null; }
        catch (error) { statusDatabaseError = error.message; }
        return json(response, 200, { ok: true, database: 'Shared LAN SQLite history', statusDatabase: status?.database || '', statusDatabaseError, presets });
      }
      if (request.method === 'POST' && pathname === '/api/list') return json(response, 200, await callDatabase('list', { applicationNos: parseApplicationNumbers((await body(request)).applicationNos || []) }));
      if (request.method === 'POST' && pathname === '/api/resolve-case-refs') return json(response, 200, await caseRefResolver.resolve((await body(request)).caseRefs || []));
      if (request.method === 'POST' && pathname === '/api/lookup-application-refs') return json(response, 200, await caseRefResolver.lookupApplications((await body(request)).applicationNos || []));
      if (request.method === 'POST' && pathname === '/api/lookup-registrations') {
        const payload = await body(request);
        return json(response, 200, await registrationLookup(payload.registrationNumbers || [], payload.registrationType || 'patent', payload.applicationNos || []));
      }
      if (request.method === 'GET' && pathname === '/api/publication-a-status') return json(response, 200, await publicationAChecker(normalizeApplicationNo(url.searchParams.get('applicationNo'))));
      if (request.method === 'GET' && pathname === '/api/international-publications') {
        const identifier = String(url.searchParams.get('identifier') || '').trim();
        if (!identifier || identifier.length > 40) return json(response, 400, { ok: false, error: 'Invalid publication identifier.', records: [] });
        const result = await internationalPublicationLookup(identifier);
        return json(response, result.ok ? 200 : 400, result);
      }
      if (request.method === 'GET' && pathname === '/api/detail') return json(response, 200, await callDatabase('detail', {}, ['--application-no', normalizeApplicationNo(url.searchParams.get('applicationNo'))]));
      const withHaguePdfUrls = (data) => {
        const mapped = events => (events || []).map(event => ({ ...event,
          url: event.pdfAvailable && haguePdfResolver(data.number, event.id) ? `${ROUTE}/api/hague-pdf?number=${encodeURIComponent(data.number)}&eventId=${encodeURIComponent(event.id)}#page=1` : '' }));
        return { ...data, events: mapped(data.events), renewalEvents: mapped(data.renewalEvents) };
      };
      if (request.method === 'POST' && pathname === '/api/hague-list') {
        const requested = (await body(request)).registrationNos;
        const numbers = Array.isArray(requested) ? requested : [];
        let result = await callDatabase('hague-list', { registrationNos: numbers });
        const found = new Set((result.registrations || []).map(item => item.number));
        for (const number of numbers.map(normalizeHagueNo).filter(Boolean)) {
          if (found.has(number)) continue;
          const cached = hagueCacheReader(number);
          if (cached) { await callDatabase('hague-ingest', { record: cached }); found.add(number); }
        }
        if (found.size > (result.registrations || []).length) result = await callDatabase('hague-list', { registrationNos: numbers });
        return json(response, 200, { ...result, registrations: (result.registrations || []).map(item => ({ ...item, data: withHaguePdfUrls(item.data) })) });
      }
      if (request.method === 'GET' && pathname === '/api/hague-detail') {
        const number = normalizeHagueNo(url.searchParams.get('number'));
        if (!number) return json(response, 400, { ok: false, error: 'Invalid Hague design number.' });
        const result = await callDatabase('hague-detail', {}, ['--application-no', number]);
        return json(response, 200, { ...result, detail: result.detail ? { ...result.detail,
          snapshots: result.detail.snapshots.map(item => ({ ...item, data: withHaguePdfUrls(item.data) })) } : null });
      }
      if (request.method === 'GET' && pathname === '/api/hague-design') {
        const number = normalizeHagueNo(url.searchParams.get('number'));
        if (!number) return json(response, 400, { ok: false, error: 'Invalid Hague design number.' });
        const result = await hagueLookup(number, { refresh: url.searchParams.get('refresh') === '1' });
        const stored = result.ok && !result.stale ? (await callDatabase('hague-ingest', { record: result })).stored : null;
        if (result.ok && !result.stale) await syncHaguePublicationIndex(number).catch(error => console.warn(`Hague publication index: ${error.message}`));
        return json(response, 200, { ...withHaguePdfUrls(result), snapshotId: stored?.snapshotId || null,
          changeCount: stored?.changes?.length || 0, lastScrapedAt: stored?.scrapedAt || result.checkedAt || null });
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/api/hague-pdf') {
        const file = haguePdfResolver(url.searchParams.get('number'), url.searchParams.get('eventId'));
        if (!file) return json(response, 404, { error: 'Hague document PDF is not available.' });
        return streamPdf(request, response, file);
      }
      if (request.method === 'GET' && pathname === '/api/application-media') {
        const media = await listApplicationMedia(url.searchParams.get('applicationNo'));
        media.images = media.images.map((image) => ({ ...image, url: `${ROUTE}/api/application-image?applicationNo=${encodeURIComponent(media.applicationNo)}&index=${image.index}` }));
        return json(response, 200, media);
      }
      if (request.method === 'GET' && pathname === '/api/application-image') {
        const image = await readApplicationMedia(url.searchParams.get('applicationNo'), url.searchParams.get('index'));
        if (!image.ok) return json(response, image.statusCode || 404, { error: 'Application image was not found.' });
        response.writeHead(200, { 'Content-Type': image.contentType || 'application/octet-stream', 'Content-Length': image.buffer.length, 'Cache-Control': 'public, max-age=86400' });
        return response.end(image.buffer);
      }
      if (request.method === 'GET' && pathname === '/api/publication-pdf-open') {
        const applicationNo = normalizeApplicationNo(url.searchParams.get('applicationNo'));
        const publication = await publicationResolver(applicationNo);
        response.writeHead(302, { Location: `${ROUTE}/api/publication-pdf?applicationNo=${encodeURIComponent(applicationNo)}#page=1`, 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (request.method === 'GET' && pathname === '/api/publication-pdfs') {
        const applicationNo = normalizeApplicationNo(url.searchParams.get('applicationNo'));
        const registrationNo = String(url.searchParams.get('registrationNo') || '');
        const documents = await publicationLister(applicationNo, registrationNo);
        return json(response, 200, { ok: true, documents: documents.map(item => {
          const query = `applicationNo=${encodeURIComponent(applicationNo)}&registrationNo=${encodeURIComponent(registrationNo)}&documentId=${encodeURIComponent(item.id || item.lookupKey || '')}`;
          return { ...item, pdfPath: undefined, sourcePath: undefined, repositoryDatabase: undefined, sourcePreview: false, entryPdf: true,
            url: `${ROUTE}/api/publication-pdf?${query}#page=1`,
            extractUrl: `${ROUTE}/api/publication-pdf?${query}` };
        }) });
      }
      if (request.method === 'GET' && pathname === '/api/request-publication-pdfs') {
        const requestNo = normalizeRequestNo(url.searchParams.get('requestNo'));
        if (!requestNo) return json(response, 400, { ok: false, error: 'Invalid request number.' });
        const result = await requestPublicationLookup(requestNo);
        return json(response, 200, { ...result, documents: result.documents.map((item) => ({ ...item, pdfPath: undefined,
          url: `${ROUTE}/api/request-publication-pdf?requestNo=${encodeURIComponent(requestNo)}&documentId=${encodeURIComponent(item.id)}#page=1` })) });
      }
      if (request.method === 'POST' && pathname === '/api/request-publication-pdfs/batch') {
        const payload = await body(request);
        const requestNos = payload.requestNos;
        if (!Array.isArray(requestNos) || requestNos.length > 500 || requestNos.some((item) => !normalizeRequestNo(item))) {
          return json(response, 400, { ok: false, error: 'Enter up to 500 valid request numbers.' });
        }
        const results = await requestPublicationLookupMany(requestNos);
        return json(response, 200, { ok: true, results: results.map((result) => ({ ...result,
          documents: result.documents.map((item) => ({ ...item, pdfPath: undefined,
            url: `${ROUTE}/api/request-publication-pdf?requestNo=${encodeURIComponent(result.requestNo)}&documentId=${encodeURIComponent(item.id)}#page=1` })) })) });
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && pathname === '/api/request-publication-pdf') {
        const requestNo = normalizeRequestNo(url.searchParams.get('requestNo'));
        const documentId = String(url.searchParams.get('documentId') || '');
        if (!requestNo || !/^\d+$/.test(documentId)) return json(response, 400, { error: 'Invalid request publication document.' });
        const result = await requestPublicationLookup(requestNo);
        const document = result.documents.find((item) => String(item.id) === documentId);
        if (!document) return json(response, 404, { error: 'Request publication PDF was not found.' });
        return await streamPublicationEntry(request, response, document);
      }
      if (request.method === 'GET' && pathname === '/api/request-publication-pdf-merged') {
        const requestNo = normalizeRequestNo(url.searchParams.get('requestNo'));
        if (!requestNo) return json(response, 400, { error: 'Invalid request number.' });
        const result = await requestPublicationLookup(requestNo);
        const wantedIds = new Set(url.searchParams.getAll('documentId').filter(Boolean));
        const documents = result.documents.filter((item) => !wantedIds.size || wantedIds.has(String(item.id)));
        const merged = await mergePublicationPdfs(documents);
        response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': merged.length,
          'Content-Disposition': `attachment; filename="${requestNo}_publications.pdf"`, 'Cache-Control': 'no-store' });
        return response.end(merged);
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && (pathname === '/api/publication-pdf' || pathname === '/api/publication-pdf-source')) {
        const applicationNo = normalizeApplicationNo(url.searchParams.get('applicationNo'));
        const documentId = String(url.searchParams.get('documentId') || '');
        const publication = documentId
          ? (await publicationLister(applicationNo, String(url.searchParams.get('registrationNo') || ''))).find(item => String(item.id || item.lookupKey || '') === documentId)
          : await publicationResolver(applicationNo);
        if (!publication) return json(response, 404, { error: 'Publication PDF document was not found.' });
        if (pathname === '/api/publication-pdf-source') {
          if (!usesSourcePreview(publication)) return json(response, 404, { error: 'Indexed source PDF is unavailable.' });
          return streamPdf(request, response, publication.sourcePath);
        }
        response.setHeader('X-Publication-Page', '1');
        return await streamPublicationEntry(request, response, publication);
      }
      if (request.method === 'GET' && pathname === '/api/publication-pdf-merged') {
        const applicationNo = normalizeApplicationNo(url.searchParams.get('applicationNo'));
        const registrationNo = String(url.searchParams.get('registrationNo') || '');
        const category = String(url.searchParams.get('category') || 'annuity');
        const wantedIds = new Set(url.searchParams.getAll('documentId').filter(Boolean));
        const documents = (await publicationLister(applicationNo, registrationNo)).filter((item) =>
          (category === 'renewal' ? ['6', '13'].includes(String(item.modeId)) || item.category === 'renewal' : item.category === category)
          && (!wantedIds.size || wantedIds.has(String(item.id || item.lookupKey || ''))));
        const merged = await mergePublicationPdfs(documents);
        const fileName = `WIPO_${applicationNo}_${category}_all.pdf`.replace(/[^A-Z0-9_.-]/gi, '_');
        response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': merged.length, 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' });
        return response.end(merged);
      }
      if (request.method === 'POST' && pathname === '/api/scrape-priorities') {
        const payload = await body(request);
        const ids = parseApplicationNumbers(payload.applicationNos || []);
        if (ids.length > 5000) return json(response, 400, { error: 'Check up to 5000 application numbers at once.' });
        return json(response, 200, await scrapePriorityLookup(ids));
      }
      if (request.method === 'POST' && pathname === '/api/scrape') {
        const payload = await body(request);
        const clientAddress = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
        const ids = parseApplicationNumbers(payload.applicationNos || []);
        const lookup = await scrapePriorityLookup(ids);
        const knownNotFound = new Set(parseApplicationNumbers(payload.knownNotFound || []));
        const priorities = Object.fromEntries(ids.map((id) => {
          const evidence = lookup.priorities?.[id] || { rank: 1 };
          return [id, { ...evidence, rank: Number(evidence.rank) === 0 ? 0 : knownNotFound.has(id) ? 2 : 1 }];
        }));
        const job = queue.enqueue(ids, payload.presetIndex || 1, payload.scrapeCap ?? payload.retryCount ?? 25,
          payload.clientId || request.socket.remoteAddress || 'anonymous', clientAddress, priorities);
        recordActivity({ service: 'wipo', action: 'scrape_request', query: job.applicationNos.join(', '),
          resultCount: job.applicationNos.length, source: 'lan', userId: job.clientId,
          clientAddress,
          detail: `Preset ${Number(payload.presetIndex) || 1}; job ${job.id}` });
        return json(response, 202, { ok: true, jobId: job.id, message: job.message });
      }
      if (request.method === 'GET' && pathname === '/api/jobs') return json(response, 200, { jobs: queue.listByClient(url.searchParams.get('clientId'), true) });
      if (request.method === 'GET' && pathname.startsWith('/api/jobs/')) {
        const jobId = decodeURIComponent(pathname.slice('/api/jobs/'.length));
        const job = queue.get(jobId);
        const afterLog = Math.max(0, Number(url.searchParams.get('afterLog')) || 0);
        return job ? json(response, 200, { ...job, logEvents: queue.logEvents(jobId, afterLog) }) : json(response, 404, { error: 'Scrape job not found.' });
      }
      if (request.method === 'POST' && pathname === '/api/stop') {
        const payload = await body(request);
        const requestedJobId = String(payload.jobId || '');
        const cancelled = payload.all === true
          ? queue.cancelAll(payload.clientId)
          : requestedJobId
            ? queue.cancel(requestedJobId, payload.clientId)
            : { ok: false, statusCode: 400, error: 'A scrape job is required.' };
        if (!cancelled.ok) return json(response, cancelled.statusCode || 409, { error: cancelled.error });
        const activeTaskIds = new Set(cancelled.activeTaskIds || []);
        const matchingChildren = [...activeChildren.entries()]
          .filter(([batchId]) => [...activeTaskIds].some((taskId) => batchId === taskId || batchId.split('__').includes(taskId)))
          .map(([, child]) => child);
        matchingChildren.forEach((item) => item.kill('SIGINT'));
        return json(response, 200, { ...cancelled, activeStopped: matchingChildren.length });
      }
      if (request.method === 'POST' && pathname === '/api/export') {
        const exported = await exportWorkbook(callDatabase, (await body(request)).applicationNos || []);
        response.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Length': exported.buffer.length, 'Content-Disposition': `attachment; filename="${exported.name}"`, 'X-Export-Count': String(exported.count), 'Cache-Control': 'no-store' }); return response.end(Buffer.from(exported.buffer));
      }
      if (request.method === 'POST' && pathname === '/api/export-batch') {
        const payload = await body(request, 80_000_000);
        const exported = await batchExporter(payload, { callDatabase, exportWorkbook, renderReportPdf: pdfRenderer, listPublicationPdfs: publicationLister, lookupRequestExportRecords });
        response.writeHead(200, { 'Content-Type': exported.type, 'Content-Length': exported.buffer.length, 'Content-Disposition': `attachment; filename="${exported.name}"`, 'X-Export-Count': String(exported.count), 'X-Export-Files': encodeURIComponent(JSON.stringify(exported.files || [])), 'Cache-Control': 'no-store' });
        return response.end(exported.buffer);
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
      if (request.method === 'POST' && pathname === '/api/hague-report-pdf') {
        const payload = await body(request, 8_500_000);
        const number = normalizeHagueNo(payload.number);
        if (!number) return json(response, 400, { error: 'A valid Hague design number is required.' });
        if (typeof payload.html !== 'string' || !payload.html.includes(number) || !payload.html.includes('printing-hague-report'))
          return json(response, 400, { error: 'The PDF report does not match the selected Hague design.' });
        const pdf = await pdfRenderer(payload.html);
        response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length,
          'Content-Disposition': `attachment; filename="WIPO_Hague_${number.replace('/', '_')}.pdf"`, 'Cache-Control': 'no-store' });
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
      const filePath = path.isAbsolute(asset) ? asset : path.resolve(ROOT, 'electron', 'renderer', asset);
      const data = await fs.promises.readFile(filePath);
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
      response.writeHead(200, { 'Content-Type': types[path.extname(filePath)], 'Content-Length': data.length, 'Cache-Control': 'no-store' }); response.end(data);
    } catch (error) { if (!response.headersSent) json(response, 500, { error: error.message }); else response.end(); }
  }

  return {
    queue,
    async start() { await callDatabase('init'); if (caseRefResolver.initialize) await caseRefResolver.initialize().catch(() => null); server = http.createServer(handler); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); siteMonitor.start(); return { host, port: server.address().port, route: `${ROUTE}/` }; },
    async close() { siteMonitor.stop(); for (const child of activeChildren.values()) child.kill(); activeChildren.clear(); if (server) await new Promise((resolve) => server.close(resolve)); },
  };
}

if (require.main === module) {
  const lan = createLanServer();
  lan.start().then((info) => console.log(`WipoPublish Vietnam Search LAN ready at http://${info.host}:${info.port}${info.route}`)).catch((error) => { console.error(error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await lan.close(); process.exit(0); });
}

module.exports = { ROUTE, DEFAULT_PORT, createScraperLineEmitter, createScrapeQueue, createLanServer, exportWorkbook, encodeHeaderFileName, streamPdf };
