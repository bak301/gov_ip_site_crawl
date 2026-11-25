const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require('os');
const { spawn } = require("child_process");
const { recordActivity, flushActivity } = require('../../electron-app/softip_activity_log');
const { pathToFileURL } = require("url");
const { parseApplicationNumbers, normalizeApplicationNo, getRecordApplicationNo } = require("../tracker_core");
const { createOriginalOutputWorkbook, createConfiguredOutputWorkbook } = require("../wipo_excel_export");
const { listPublicationPdfs, checkPublicationA, lookupPublicationRegistrations, lookupInternationalPublications, syncHaguePublicationIndex } = require("../publication_pdf");
const { lookupRequestPublication, lookupRequestPublications, lookupRequestExportRecords, normalizeRequestNo } = require('../request_publication');
const { createCaseRefResolver } = require("../case_ref_resolver");
const { desktopApplicationMedia } = require("../application_media");
const { renderReportPdf } = require("../report_pdf");
const { createBatchExport } = require("../batch_export");
const { mergePublicationPdfs } = require("../publication_pdf_merge");
const { usesSourcePreview, publicationPdfBytes } = require('../publication_pdf_bytes');
const { createWipoSiteMonitor } = require("../wipo_site_status");
const { lookupHagueDesign, normalizeHagueNo, haguePdfPath, cachedHagueDesign } = require('../hague_design');
const { createScrapePriorityResolver } = require('../scrape_priority');

const ROOT_DIR = path.resolve(__dirname, "..");
const SCRAPER_ROOT = path.resolve(process.env.WIPO_SCRAPER_ROOT || path.join(ROOT_DIR, "..", "Wipopublish_Scrape_ApplicationDetails"));
const SCRIPT_FILE = path.join(SCRAPER_ROOT, "index_Wipo.js");
const OUTPUT_DIR = path.join(ROOT_DIR, "Output");
const DATABASE_FILE = String(process.env.WIPO_TRACKER_DATABASE || path.join(ROOT_DIR, "data", "WIPO_Application_History.sqlite"));
const DB_HELPER = path.join(ROOT_DIR, "wipo_history_db.py");
const PRESETS_FILE = path.join(SCRAPER_ROOT, "presets.json");
const caseRefResolver = createCaseRefResolver();
const siteMonitor = createWipoSiteMonitor({
  historyDir: path.join(path.dirname(DATABASE_FILE), "wipo-site-checks"),
  snapshotEvents: async (since) => (await callDatabase("scrape-events", { since })).snapshots,
});
const scrapePriorityLookup = createScrapePriorityResolver({ tracker: DATABASE_FILE });
let mainWindow;
const activeChildren = new Map();
let desktopRunSequence = 0;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480, height: 900, minWidth: 1050, minHeight: 680, backgroundColor: "#f4f5f7",
    icon: path.join(ROOT_DIR, "data-searching.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  const capturePath = String(process.env.WIPO_UI_SMOKE_CAPTURE || "").trim();
  if (capturePath) {
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await mainWindow.webContents.executeJavaScript("document.querySelector('.case-row')?.click()");
        await new Promise((resolve) => setTimeout(resolve, 700));
        const image = await mainWindow.webContents.capturePage();
        fs.mkdirSync(path.dirname(capturePath), { recursive: true });
        fs.writeFileSync(capturePath, image.toPNG());
      } catch (error) {
        fs.writeFileSync(`${capturePath}.error.txt`, error.stack || error.message || String(error), "utf8");
      } finally {
        app.quit();
      }
    });
  }
}

function localDateFolder() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function callDatabase(command, payload = {}, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(String(process.env.WIPO_PYTHON || "python"), [DB_HELPER, DATABASE_FILE, command, ...extraArgs], {
      cwd: ROOT_DIR, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Database helper exited with code ${code}.`));
      try { resolve(JSON.parse(stdout || "{}")); }
      catch { reject(new Error(`Database returned invalid data: ${stdout.slice(0, 300)}`)); }
    });
    if (["ingest", "list", "scrape-events", "latest-records", "hague-ingest", "hague-list"].includes(command)) child.stdin.end(JSON.stringify(payload));
    else child.stdin.end();
  });
}

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("scrape:progress", payload);
}

function loadPresets() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PRESETS_FILE, "utf8"));
    return (parsed.presets || []).map((preset, index) => ({ index: index + 1, name: preset.name || `Preset ${index + 1}` }));
  } catch { return [{ index: 1, name: "Fast" }]; }
}

function readLatestScrapedRecords(applicationNos, folder = path.join(OUTPUT_DIR, localDateFolder())) {
  const wanted = new Set(applicationNos.map(normalizeApplicationNo));
  const latest = new Map();
  if (!fs.existsSync(folder)) return [];
  for (const fileName of fs.readdirSync(folder)) {
    if (!/^(SC|KD|NH)_WIPO_\d{4}-\d{2}-\d{2}\.json$/i.test(fileName)) continue;
    let records = [];
    try { records = JSON.parse(fs.readFileSync(path.join(folder, fileName), "utf8")); } catch { continue; }
    for (const record of Array.isArray(records) ? records : []) {
      const appNo = getRecordApplicationNo(record);
      if (!wanted.has(appNo)) continue;
      const previous = latest.get(appNo);
      if (!previous || String(record.scraped_at || "") >= String(previous.scraped_at || "")) latest.set(appNo, record);
    }
  }
  return [...latest.values()];
}

async function runScraper(applicationNos, presetIndex = 1, retryCount = 10) {
  const ids = parseApplicationNumbers(applicationNos);
  if (!ids.length) throw new Error("Add at least one valid application number.");
  recordActivity({ service: 'wipo', action: 'scrape_request', query: ids.join(', '),
    resultCount: ids.length, source: 'desktop', userId: os.userInfo().username,
    clientAddress: 'local', detail: `Preset ${Number(presetIndex) || 1}` });
  const runId = `desktop-${Date.now().toString(36)}-${(++desktopRunSequence).toString(36)}`;
  const runRoot = path.join(ROOT_DIR, "data", "desktop-runs", runId);
  const inputFile = path.join(runRoot, "input.txt");
  const outputDir = path.join(runRoot, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(inputFile, `${ids.join("\n")}\n`, "utf8");
  const retries = Math.min(50, Math.max(0, Number.parseInt(retryCount, 10) || 0));
  const args = [SCRIPT_FILE, `--preset-index=${Number(presetIndex) || 1}`, `--retry-count=${retries}`, "--force-rescrape"];
  const liveImported = new Map();
  const livePending = new Set();
  const notFound = new Map();
  let liveIngest = Promise.resolve();
  sendProgress({ type: "start", total: ids.length, message: `Scraping ${ids.length} application${ids.length === 1 ? "" : "s"}…` });
  try {
  const result = await new Promise((resolve, reject) => {
    if (!fs.existsSync(SCRIPT_FILE)) return reject(new Error(`Migrated WIPO scraper was not found at ${SCRIPT_FILE}`));
    const child = spawn(process.execPath, args, {
      cwd: SCRAPER_ROOT, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", WIPO_INPUT_FILE: inputFile, WIPO_OUTPUT_DIR: outputDir, WIPO_SKIP_POST_RETRY: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    activeChildren.set(runId, child);
    child.on("message", (payload) => {
      if (payload?.type === "wipo-not-found" && payload.applicationNo) {
        const applicationNo = normalizeApplicationNo(payload.applicationNo);
        notFound.set(applicationNo, payload);
        sendProgress({ type: "not-found", applicationNo, reason: payload.reason, attempts: payload.attempts, message: `Not found: ${applicationNo}` });
        return;
      }
      if (payload?.type !== "wipo-record" || !payload.record) return;
      const applicationNo = getRecordApplicationNo(payload.record);
      if (!applicationNo || liveImported.has(applicationNo) || livePending.has(applicationNo)) return;
      livePending.add(applicationNo);
      liveIngest = liveIngest.then(async () => {
        const response = await callDatabase("ingest", { records: [payload.record], source: `WIPO preset #${Number(presetIndex) || 1}` });
        const imported = (response.results || [])[0];
        if (imported) {
          liveImported.set(applicationNo, imported);
          siteMonitor.confirmScrapeSuccess(applicationNo, imported);
          recordActivity({ service: 'wipo', action: 'scraped_entry', query: imported.applicationNo,
            resultCount: 1, source: 'desktop', userId: os.userInfo().username, clientAddress: 'local',
            detail: JSON.stringify({ snapshotId: imported.snapshotId, changedFields: (imported.changes || []).length, runId }) });
          sendProgress({ type: "record", applicationNo, imported, message: `Stored ${applicationNo}` });
        }
      }).catch((error) => sendProgress({ type: "log", level: "error", message: `Could not store ${applicationNo} immediately: ${error.message}` }))
        .finally(() => livePending.delete(applicationNo));
    });
    let stderr = "";
    child.stdout.on("data", (chunk) => sendProgress({ type: "log", stream: true, streamId: runId, message: chunk.toString() }));
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12000);
      sendProgress({ type: "log", level: "error", stream: true, streamId: `${runId}:stderr`, message: chunk.toString() });
    });
    child.on("error", (error) => { activeChildren.delete(runId); reject(error); });
    child.on("close", (code) => { activeChildren.delete(runId); resolve({ code: Number(code ?? 0), stderr }); });
  });
  await liveIngest;
  const records = readLatestScrapedRecords(ids, outputDir);
  const remainingRecords = records.filter((record) => !liveImported.has(getRecordApplicationNo(record)));
  const finalImported = remainingRecords.length ? await callDatabase("ingest", { records: remainingRecords, source: `WIPO preset #${Number(presetIndex) || 1}` }) : { results: [] };
  const importedResults = [...liveImported.values(), ...(finalImported.results || [])];
  for (const imported of finalImported.results || []) siteMonitor.confirmScrapeSuccess(imported.applicationNo, imported);
  for (const imported of finalImported.results || []) recordActivity({ service: 'wipo', action: 'scraped_entry',
    query: imported.applicationNo, resultCount: 1, source: 'desktop', userId: os.userInfo().username, clientAddress: 'local',
    detail: JSON.stringify({ snapshotId: imported.snapshotId, changedFields: (imported.changes || []).length, runId }) });
  const importedNos = new Set(importedResults.map((item) => item.applicationNo));
  const missing = ids.filter((id) => !importedNos.has(id));
  sendProgress({ type: "done", total: ids.length, imported: importedNos.size, missing, message: `Stored ${importedNos.size}/${ids.length} result${importedNos.size === 1 ? "" : "s"} in history.` });
  return { ok: result.code === 0 && !missing.length, code: result.code, imported: importedResults, missing, notFound: [...notFound.values()], error: result.code ? result.stderr : "" };
  } finally {
    await flushActivity().catch((error) => console.error('Activity log:', error.message));
    activeChildren.delete(runId);
    try { fs.rmSync(runRoot, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

async function exportApplications(applicationNos) {
  const ids = parseApplicationNumbers(applicationNos);
  if (!ids.length) throw new Error("No applications were selected for export.");
  const details = (await Promise.all(ids.map((id) => callDatabase("detail", {}, ["--application-no", id])))).map((result) => result.detail).filter(Boolean);
  if (!details.length) throw new Error("The selected applications do not have scraped data yet.");
  const workbook = await createOriginalOutputWorkbook(details);
  // Match the original runner's SC/KD/NH output naming for each record family.
  const types = new Set(details.map((detail) => {
    const data = detail?.latest?.data || {};
    const explicit = String(data.type || '').toUpperCase();
    if (explicit === 'DESIGNS') return 'KD';
    if (explicit === 'TRADEMARKS') return 'NH';
    const prefix = String(data.id || detail.applicationNo || '').match(/^([1-5])-/)?.[1];
    return prefix === '3' ? 'KD' : (prefix === '4' || prefix === '5' ? 'NH' : 'SC');
  }));
  const defaultName = `${types.size === 1 ? [...types][0] : 'WIPO'}_WIPO_${localDateFolder()}.xlsx`;
  const choice = await dialog.showSaveDialog(mainWindow, { title: "Export WIPO data", defaultPath: path.join(ROOT_DIR, "exports", defaultName), filters: [{ name: "Excel workbook", extensions: ["xlsx"] }] });
  if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
  fs.mkdirSync(path.dirname(choice.filePath), { recursive: true });
  await workbook.xlsx.writeFile(choice.filePath);
  shell.showItemInFolder(choice.filePath);
  return { ok: true, path: choice.filePath, count: details.length };
}

ipcMain.handle("tracker:health", () => ({ ok: true, service: "WipoPublish Vietnam Search" }));
ipcMain.handle("tracker:site-status", (_event, payload) => siteMonitor.check(Boolean(payload?.refresh)));
ipcMain.handle("tracker:site-status-history", (_event, payload) => siteMonitor.history(payload?.day));
ipcMain.handle("tracker:init", async () => {
  const db = await callDatabase("init");
  let status = null; let statusDatabaseError = "";
  try { status = caseRefResolver.initialize ? await caseRefResolver.initialize() : null; }
  catch (error) { statusDatabaseError = error.message; }
  return { ok: true, database: db.database, statusDatabase: status?.database || "", statusDatabaseError, presets: loadPresets() };
});
ipcMain.handle("tracker:list", async (_event, payload) => callDatabase("list", { applicationNos: parseApplicationNumbers(payload?.applicationNos || []) }));
ipcMain.handle("tracker:detail", async (_event, payload) => callDatabase("detail", {}, ["--application-no", normalizeApplicationNo(payload?.applicationNo)]));
ipcMain.handle("tracker:application-media", async (_event, payload) => desktopApplicationMedia(payload?.applicationNo));
ipcMain.handle("tracker:resolve-case-refs", async (_event, payload) => {
  try { return await caseRefResolver.resolve(payload?.caseRefs || []); }
  catch (error) { return { ok: false, error: error.message, matches: [], missing: [] }; }
});
ipcMain.handle("tracker:lookup-application-refs", async (_event, payload) => {
  try { return await caseRefResolver.lookupApplications(payload?.applicationNos || []); }
  catch (error) { return { ok: false, error: error.message, matches: [] }; }
});
ipcMain.handle("tracker:lookup-registrations", async (_event, payload) => {
  try { return await lookupPublicationRegistrations(payload?.registrationNumbers || [], payload?.registrationType || "patent", payload?.applicationNos || []); }
  catch (error) { return { ok: false, error: error.message, matches: [], missing: [] }; }
});
ipcMain.handle("tracker:scrape-priorities", async (_event, payload) => scrapePriorityLookup(payload?.applicationNos || []));
ipcMain.handle("tracker:scrape", async (_event, payload) => {
  try { return await runScraper(payload?.applicationNos || [], payload?.presetIndex || 1, payload?.retryCount ?? 10); }
  catch (error) { sendProgress({ type: "done", level: "error", message: error.message }); return { ok: false, error: error.message }; }
});
ipcMain.handle("tracker:stop", () => {
  if (!activeChildren.size) return { ok: false, error: "No scrape is running." };
  const stopped = activeChildren.size;
  for (const child of activeChildren.values()) child.kill("SIGINT");
  return { ok: true, stopped };
});
ipcMain.handle("tracker:export", async (_event, payload) => {
  try { return await exportApplications(payload?.applicationNos || []); }
  catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("tracker:export-batch", async (_event, payload) => {
  try {
    const exported = await createBatchExport(payload || {}, { callDatabase, exportWorkbook: async (_db, ids, excelColumns) => {
      const details = (await Promise.all(parseApplicationNumbers(ids).map((id) => callDatabase("detail", {}, ["--application-no", id])))).map((result) => result.detail).filter(Boolean);
      if (!details.length) throw new Error("The selected applications do not have scraped data yet.");
      const workbook = await createConfiguredOutputWorkbook(details, excelColumns);
      return { name: `WIPO_export_${localDateFolder()}.xlsx`, buffer: await workbook.xlsx.writeBuffer(), count: details.length };
    }, renderReportPdf, listPublicationPdfs, lookupRequestExportRecords });
    const extension = path.extname(exported.name).slice(1);
    const choice = await dialog.showSaveDialog(mainWindow, { title: "Export WIPO list", defaultPath: path.join(ROOT_DIR, "exports", exported.name), filters: [{ name: extension === "zip" ? "ZIP archive" : extension === "pdf" ? "PDF document" : "Excel workbook", extensions: [extension] }] });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    await fs.promises.mkdir(path.dirname(choice.filePath), { recursive: true });
    await fs.promises.writeFile(choice.filePath, exported.buffer);
    shell.showItemInFolder(choice.filePath);
    return { ok: true, path: choice.filePath, count: exported.count, fileName: path.basename(choice.filePath) };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("tracker:download-pdf", async (_event, payload) => {
  try {
    const applicationNo = normalizeApplicationNo(payload?.applicationNo);
    if (!/^[1-5]-\d{4}-\d{4,}$/.test(applicationNo)) throw new Error("A valid application number is required.");
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: "Export WIPO report as PDF",
      defaultPath: path.join(ROOT_DIR, "exports", `WIPO_${applicationNo}.pdf`),
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
    });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
    await fs.promises.mkdir(path.dirname(choice.filePath), { recursive: true });
    await fs.promises.writeFile(choice.filePath, pdf);
    return { ok: true, path: choice.filePath };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("tracker:download-hague-pdf", async (_event, payload) => {
  try {
    const number = normalizeHagueNo(payload?.number);
    if (!number) throw new Error('A valid Hague design number is required.');
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Hague record as PDF',
      defaultPath: path.join(ROOT_DIR, 'exports', `WIPO_Hague_${number.replace('/', '_')}.pdf`),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    await fs.promises.mkdir(path.dirname(choice.filePath), { recursive: true });
    await fs.promises.writeFile(choice.filePath, pdf);
    return { ok: true, path: choice.filePath };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("tracker:open-publication-pdf", async (_event, payload) => {
  try {
    const documents = await listPublicationPdfs(normalizeApplicationNo(payload?.applicationNo), payload?.registrationNo || '');
    return { ok: true, documents: documents.map(item => {
      const needsPreparation = usesSourcePreview(item);
      return { ...item, url: needsPreparation ? 'about:blank' : `${pathToFileURL(item.pdfPath).href}#page=1`,
        sourcePreview: false, needsPreparation, entryPdf: true, pdfPath: undefined, sourcePath: undefined };
    }) };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('tracker:prepare-publication-pdf', async (_event, payload) => {
  try {
    const applicationNo = normalizeApplicationNo(payload?.applicationNo);
    const documents = payload?.requestNo ? (await lookupRequestPublication(payload.requestNo)).documents : await listPublicationPdfs(applicationNo, payload?.registrationNo || '');
    const document = documents
      .find(item => String(item.id || item.lookupKey || '') === String(payload?.documentId || ''));
    if (!document) throw new Error('Publication PDF document was not found.');
    const bytes = await publicationPdfBytes(document);
    return { ok: true, url: `data:application/pdf;base64,${bytes.toString('base64')}` };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('tracker:request-publications', async (_event, payload) => {
  try {
    const result = await lookupRequestPublication(payload?.requestNo);
    return { ...result, documents: result.documents.map((item) => ({ ...item,
      url: usesSourcePreview(item) ? 'about:blank' : `${pathToFileURL(item.pdfPath).href}#page=1`, needsPreparation: usesSourcePreview(item), sourcePreview: false, pdfPath: undefined, sourcePath: undefined })) };
  } catch (error) { return { ok: false, error: error.message, documents: [] }; }
});
ipcMain.handle('tracker:request-publications-batch', async (_event, payload) => {
  try {
    const results = await lookupRequestPublications(payload?.requestNos);
    return { ok: true, results: results.map((result) => ({ ...result,
      documents: result.documents.map((item) => ({ ...item,
        url: usesSourcePreview(item) ? 'about:blank' : `${pathToFileURL(item.pdfPath).href}#page=1`, needsPreparation: usesSourcePreview(item), sourcePreview: false, pdfPath: undefined, sourcePath: undefined })) })) };
  } catch (error) { return { ok: false, error: error.message, results: [] }; }
});
ipcMain.handle('tracker:hague-design', async (_event, payload) => {
  try {
    const result = await lookupHagueDesign(payload?.number, { refresh: Boolean(payload?.refresh) });
    const stored = result.ok && !result.stale ? (await callDatabase('hague-ingest', { record: result })).stored : null;
    if (result.ok && !result.stale) await syncHaguePublicationIndex(result.number).catch(error => console.warn(`Hague publication index: ${error.message}`));
    return { ...withHaguePdfUrls(result), snapshotId: stored?.snapshotId || null,
      changeCount: stored?.changes?.length || 0, lastScrapedAt: stored?.scrapedAt || result.checkedAt || null };
  } catch (error) { return { ok: false, error: error.message, events: [] }; }
});
ipcMain.handle('tracker:international-publications', async (_event, payload) => {
  try { return await lookupInternationalPublications(payload?.identifier); }
  catch (error) { return { ok: false, error: error.message, records: [] }; }
});
function withHaguePdfUrls(data) {
  const mapped = events => (events || []).map(event => ({ ...event,
    url: event.pdfAvailable && haguePdfPath(data.number, event.id) ? `${pathToFileURL(haguePdfPath(data.number, event.id)).href}#page=1` : '' }));
  return { ...data, events: mapped(data.events), renewalEvents: mapped(data.renewalEvents) };
}
ipcMain.handle('tracker:hague-list', async (_event, payload) => {
  const numbers = Array.isArray(payload?.registrationNos) ? payload.registrationNos : [];
  let result = await callDatabase('hague-list', { registrationNos: numbers });
  const found = new Set((result.registrations || []).map(item => item.number));
  for (const number of numbers.map(normalizeHagueNo).filter(Boolean)) {
    if (found.has(number)) continue;
    const cached = cachedHagueDesign(number);
    if (cached) { await callDatabase('hague-ingest', { record: cached }); found.add(number); }
  }
  if (found.size > (result.registrations || []).length) result = await callDatabase('hague-list', { registrationNos: numbers });
  return { ...result, registrations: (result.registrations || []).map(item => ({ ...item, data: withHaguePdfUrls(item.data) })) };
});
ipcMain.handle('tracker:hague-detail', async (_event, payload) => {
  const number = normalizeHagueNo(payload?.number);
  const result = await callDatabase('hague-detail', {}, ['--application-no', number]);
  return { ...result, detail: result.detail ? { ...result.detail,
    snapshots: result.detail.snapshots.map(item => ({ ...item, data: withHaguePdfUrls(item.data) })) } : null };
});
ipcMain.handle('tracker:save-hague-pdf', async (_event, payload) => {
  try {
    const number = normalizeHagueNo(payload?.number);
    const source = haguePdfPath(number, payload?.eventId);
    if (!source) throw new Error('This WIPO PDF has not been downloaded. Open the source document link to check it.');
    const choice = await dialog.showSaveDialog(mainWindow, { title: 'Save Hague VN document',
      defaultPath: path.join(ROOT_DIR, 'exports', `${number.replace('/', '-')}_VN_${payload.eventId}.pdf`),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    await fs.promises.mkdir(path.dirname(choice.filePath), { recursive: true });
    await fs.promises.copyFile(source, choice.filePath);
    return { ok: true, path: choice.filePath };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('tracker:save-request-publication-pdf', async (_event, payload) => {
  try {
    const requestNo = normalizeRequestNo(payload?.requestNo);
    const result = await lookupRequestPublication(requestNo);
    const wantedIds = new Set((payload?.documentIds || [payload?.documentId]).filter(Boolean).map(String));
    const selected = payload?.all ? result.documents.filter((item) => !wantedIds.size || wantedIds.has(String(item.id)))
      : result.documents.filter((item) => wantedIds.has(String(item.id))).slice(0, 1);
    if (!selected.length) throw new Error('Request publication PDF was not found.');
    const name = payload?.all ? `${requestNo}_publications.pdf` : path.basename(selected[0].sourceFile || selected[0].pdfPath);
    const choice = await dialog.showSaveDialog(mainWindow, { title: 'Save request publication PDF',
      defaultPath: path.join(ROOT_DIR, 'exports', name), filters: [{ name: 'PDF document', extensions: ['pdf'] }] });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    await fs.promises.mkdir(path.dirname(choice.filePath), { recursive: true });
    if (payload?.all) await fs.promises.writeFile(choice.filePath, await mergePublicationPdfs(selected));
    else await fs.promises.writeFile(choice.filePath, await publicationPdfBytes(selected[0]));
    return { ok: true, path: choice.filePath };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("tracker:save-publication-pdf", async (_event, payload) => {
  try {
    const applicationNo = normalizeApplicationNo(payload?.applicationNo);
    const documents = await listPublicationPdfs(applicationNo, payload?.registrationNo || '');
    const documentIds = new Set((payload?.documentIds || [payload?.documentId]).filter(Boolean).map(String));
    const selected = payload?.all
      ? documents.filter((item) => (payload.category === 'renewal' ? ['6', '13'].includes(String(item.modeId)) || item.category === 'renewal' : item.category === payload.category)
        && (!documentIds.size || documentIds.has(String(item.id || item.lookupKey || ''))))
      : documents.filter((item) => documentIds.has(String(item.id || item.lookupKey || ''))).slice(0, 1);
    if (!selected.length) throw new Error("Publication PDF document was not found.");
    const sourceName = payload?.all ? `WIPO_${applicationNo}_${payload.category || 'publications'}_all.pdf`
      : usesSourcePreview(selected[0]) ? `WIPO_${applicationNo}_${selected[0].category}.pdf`
        : path.basename(selected[0].sourceFile || selected[0].pdfPath || `WIPO_${applicationNo}_publication.pdf`);
    const defaultName = path.extname(sourceName).toLowerCase() === '.pdf' ? sourceName : `${sourceName}.pdf`;
    const choice = await dialog.showSaveDialog(mainWindow, { title: "Save publication PDF", defaultPath: path.join(ROOT_DIR, "exports", defaultName), filters: [{ name: "PDF document", extensions: ["pdf"] }] });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    await fs.promises.mkdir(path.dirname(choice.filePath), { recursive: true });
    if (payload?.all) await fs.promises.writeFile(choice.filePath, await mergePublicationPdfs(selected));
    else await fs.promises.writeFile(choice.filePath, await publicationPdfBytes(selected[0]));
    return { ok: true, path: choice.filePath };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("tracker:check-publication-a", async (_event, payload) => {
  try { return await checkPublicationA(normalizeApplicationNo(payload?.applicationNo)); }
  catch (error) { return { ok: false, error: error.message }; }
});

app.whenReady().then(() => { siteMonitor.start(); createWindow(); });
app.on("before-quit", () => siteMonitor.stop());
app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
