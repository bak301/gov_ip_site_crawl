const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { parseApplicationNumbers, normalizeApplicationNo, getRecordApplicationNo } = require("../tracker_core");
const { createOriginalOutputWorkbook } = require("../wipo_excel_export");
const { listPublicationPdfs, checkPublicationA } = require("../publication_pdf");
const { createCaseRefResolver } = require("../case_ref_resolver");

const ROOT_DIR = path.resolve(__dirname, "..");
const SCRIPT_FILE = path.join(ROOT_DIR, "index_Wipo.js");
const INPUT_FILE = path.join(ROOT_DIR, "ID_WIPO.txt");
const OUTPUT_DIR = path.join(ROOT_DIR, "Output");
const DATABASE_FILE = String(process.env.WIPO_TRACKER_DATABASE || path.join(ROOT_DIR, "data", "WIPO_Application_History.sqlite"));
const DB_HELPER = path.join(ROOT_DIR, "wipo_history_db.py");
const PRESETS_FILE = path.join(ROOT_DIR, "presets.json");
const caseRefResolver = createCaseRefResolver();
let mainWindow;
let activeChild;

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
    if (command === "ingest" || command === "list") child.stdin.end(JSON.stringify(payload));
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

function readLatestScrapedRecords(applicationNos) {
  const folder = path.join(OUTPUT_DIR, localDateFolder());
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
  if (activeChild) throw new Error("A scrape is already running.");
  const ids = parseApplicationNumbers(applicationNos);
  if (!ids.length) throw new Error("Add at least one valid application number.");
  fs.writeFileSync(INPUT_FILE, `${ids.join("\n")}\n`, "utf8");
  const retries = Math.min(50, Math.max(0, Number.parseInt(retryCount, 10) || 0));
  const args = [SCRIPT_FILE, `--preset-index=${Number(presetIndex) || 1}`, `--retry-count=${retries}`, "--force-rescrape"];
  const liveImported = new Map();
  const livePending = new Set();
  let liveIngest = Promise.resolve();
  sendProgress({ type: "start", total: ids.length, message: `Scraping ${ids.length} application${ids.length === 1 ? "" : "s"}…` });
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT_DIR, windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    activeChild = child;
    child.on("message", (payload) => {
      if (payload?.type !== "wipo-record" || !payload.record) return;
      const applicationNo = getRecordApplicationNo(payload.record);
      if (!applicationNo || liveImported.has(applicationNo) || livePending.has(applicationNo)) return;
      livePending.add(applicationNo);
      liveIngest = liveIngest.then(async () => {
        const response = await callDatabase("ingest", { records: [payload.record], source: `WIPO preset #${Number(presetIndex) || 1}` });
        const imported = (response.results || [])[0];
        if (imported) {
          liveImported.set(applicationNo, imported);
          sendProgress({ type: "record", applicationNo, imported, message: `Stored ${applicationNo}` });
        }
      }).catch((error) => sendProgress({ type: "log", level: "error", message: `Could not store ${applicationNo} immediately: ${error.message}` }))
        .finally(() => livePending.delete(applicationNo));
    });
    let stderr = "";
    child.stdout.on("data", (chunk) => sendProgress({ type: "log", message: chunk.toString() }));
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12000);
      sendProgress({ type: "log", level: "error", message: chunk.toString() });
    });
    child.on("error", (error) => { activeChild = null; reject(error); });
    child.on("close", (code) => { activeChild = null; resolve({ code: Number(code ?? 0), stderr }); });
  });
  await liveIngest;
  const records = readLatestScrapedRecords(ids);
  const remainingRecords = records.filter((record) => !liveImported.has(getRecordApplicationNo(record)));
  const finalImported = remainingRecords.length ? await callDatabase("ingest", { records: remainingRecords, source: `WIPO preset #${Number(presetIndex) || 1}` }) : { results: [] };
  const importedResults = [...liveImported.values(), ...(finalImported.results || [])];
  const importedNos = new Set(importedResults.map((item) => item.applicationNo));
  const missing = ids.filter((id) => !importedNos.has(id));
  sendProgress({ type: "done", total: ids.length, imported: importedNos.size, missing, message: `Stored ${importedNos.size}/${ids.length} result${importedNos.size === 1 ? "" : "s"} in history.` });
  return { ok: result.code === 0 && !missing.length, code: result.code, imported: importedResults, missing, error: result.code ? result.stderr : "" };
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

ipcMain.handle("tracker:init", async () => {
  const db = await callDatabase("init");
  return { ok: true, database: db.database, presets: loadPresets() };
});
ipcMain.handle("tracker:list", async (_event, payload) => callDatabase("list", { applicationNos: parseApplicationNumbers(payload?.applicationNos || []) }));
ipcMain.handle("tracker:detail", async (_event, payload) => callDatabase("detail", {}, ["--application-no", normalizeApplicationNo(payload?.applicationNo)]));
ipcMain.handle("tracker:resolve-case-refs", async (_event, payload) => {
  try { return await caseRefResolver.resolve(payload?.caseRefs || []); }
  catch (error) { return { ok: false, error: error.message, matches: [], missing: [] }; }
});
ipcMain.handle("tracker:lookup-application-refs", async (_event, payload) => {
  try { return await caseRefResolver.lookupApplications(payload?.applicationNos || []); }
  catch (error) { return { ok: false, error: error.message, matches: [] }; }
});
ipcMain.handle("tracker:scrape", async (_event, payload) => {
  try { return await runScraper(payload?.applicationNos || [], payload?.presetIndex || 1, payload?.retryCount ?? 10); }
  catch (error) { sendProgress({ type: "done", level: "error", message: error.message }); return { ok: false, error: error.message }; }
});
ipcMain.handle("tracker:stop", () => {
  if (!activeChild) return { ok: false, error: "No scrape is running." };
  activeChild.kill("SIGINT");
  return { ok: true };
});
ipcMain.handle("tracker:export", async (_event, payload) => {
  try { return await exportApplications(payload?.applicationNos || []); }
  catch (error) { return { ok: false, error: error.message }; }
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
ipcMain.handle("tracker:open-publication-pdf", async (_event, payload) => {
  try {
    const documents = await listPublicationPdfs(normalizeApplicationNo(payload?.applicationNo), payload?.registrationNo || '');
    return { ok: true, documents: documents.map(item => ({ ...item, url: `${pathToFileURL(item.pdfPath).href}#page=${item.page || 1}`, pdfPath: undefined })) };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle("tracker:check-publication-a", async (_event, payload) => {
  try { return await checkPublicationA(normalizeApplicationNo(payload?.applicationNo)); }
  catch (error) { return { ok: false, error: error.message }; }
});

app.whenReady().then(createWindow);
app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
