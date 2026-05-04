const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const puppeteer = require("puppeteer");

const ROOT_DIR = path.resolve(__dirname, "..");
const LOOKUP_FILE = path.join(ROOT_DIR, "Lookup.tsv");
const DEFAULT_SOURCE_DIR = path.join(ROOT_DIR, "Output", "IPVietnam_Monthly_Lookup");
const DEFAULT_DOWNLOAD_DIR = "D:\\";
const SCRAPER_SCRIPT = path.join(ROOT_DIR, "scrape_ipvietnam_monthly_lookup.js");
const UNIFIED_SOURCE_BASENAME = "ipvietnam_monthly_lookup_unified";

let sourceDir = DEFAULT_SOURCE_DIR;
let downloadRoot = DEFAULT_DOWNLOAD_DIR;

let mainWindow = null;
const downloadControl = {
  running: false,
  cancelRequested: false,
};

const scrapeControl = {
  running: false,
  child: null,
};

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

function pushScrapeLog(stream, textChunk) {
  const text = String(textChunk || "");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    sendToRenderer("lookupgui:scrape-log", { stream, line });
  }
}

function startMonthlyScrapeProcess() {
  if (scrapeControl.running) {
    return { ok: false, error: "Monthly scrape is already running." };
  }

  if (!fs.existsSync(SCRAPER_SCRIPT)) {
    return { ok: false, error: "Monthly scraper script was not found." };
  }

  const args = [
    SCRAPER_SCRIPT,
    "--headless=false",
    "--single-output=true",
    `--output-base=${UNIFIED_SOURCE_BASENAME}`,
  ];

  const child = spawn(process.execPath, args, {
    cwd: ROOT_DIR,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  scrapeControl.running = true;
  scrapeControl.child = child;
  sendToRenderer("lookupgui:scrape-status", {
    state: "started",
    sourceJsonFile: `${UNIFIED_SOURCE_BASENAME}.json`,
  });

  child.stdout.on("data", (chunk) => {
    pushScrapeLog("stdout", chunk);
  });

  child.stderr.on("data", (chunk) => {
    pushScrapeLog("stderr", chunk);
  });

  child.on("error", (error) => {
    sendToRenderer("lookupgui:scrape-log", {
      stream: "stderr",
      line: error.message || String(error),
    });
  });

  child.on("close", (code) => {
    scrapeControl.running = false;
    scrapeControl.child = null;

    sendToRenderer("lookupgui:scrape-status", {
      state: "finished",
      ok: code === 0,
      code,
      sourceJsonFile: `${UNIFIED_SOURCE_BASENAME}.json`,
      sourceCsvFile: `${UNIFIED_SOURCE_BASENAME}.csv`,
      sourceExcelTsvFile: `${UNIFIED_SOURCE_BASENAME}.excel.tsv`,
    });
  });

  return { ok: true };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 880,
    minWidth: 1100,
    minHeight: 760,
    webPreferences: {
      preload: path.join(__dirname, "lookup-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "lookup-renderer", "index.html"));
}

function normalizeHeader(header) {
  return String(header || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

function normalizeHeaderToken(header) {
  return normalizeHeader(header).replace(/[^a-z0-9]/g, "");
}

function parseDelimitedText(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((h) => String(h || "").replace(/^\uFEFF/, "").trim());
  const objects = [];

  for (let r = 1; r < rows.length; r += 1) {
    const values = rows[r];
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = (values[c] || "").trim();
    }

    const hasData = Object.values(obj).some((v) => String(v || "").trim().length > 0);
    if (hasData) {
      objects.push(obj);
    }
  }

  return objects;
}

function readTextFileWithEncoding(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }

  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function listSourceFiles() {
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^ipvietnam_monthly_lookup_.*\.(excel\.tsv|csv|json)$/i.test(name))
    .sort((a, b) => b.localeCompare(a));
}

function getSafeSourcePath(fileName) {
  const clean = String(fileName || "").trim();
  if (!clean) {
    throw new Error("Missing source file name.");
  }
  if (clean.includes("..") || clean.includes("/") || clean.includes("\\")) {
    throw new Error("Invalid source file path.");
  }

  const fullPath = path.join(sourceDir, clean);
  if (!fs.existsSync(fullPath)) {
    throw new Error("Selected source file does not exist.");
  }

  return fullPath;
}

function loadSourceRows(fileName) {
  const sourcePath = getSafeSourcePath(fileName);
  const lower = sourcePath.toLowerCase();

  if (lower.endsWith(".json")) {
    const parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((row) => ({ ...row }));
  }

  const text = readTextFileWithEncoding(sourcePath);
  if (lower.endsWith(".csv")) {
    return parseDelimitedText(text, ",");
  }

  return parseDelimitedText(text, "\t");
}

function toTitleCounts(rows) {
  const map = new Map();
  for (const row of rows) {
    const title = String(row.source_entry_title || "").trim();
    if (!title) {
      continue;
    }
    map.set(title, (map.get(title) || 0) + 1);
  }

  const extractMonthYear = (title) => {
    const text = String(title || "").toLowerCase();
    const monthSectionMatch = text.match(/th[aá]ng\s*([^\n]+)/i);
    if (!monthSectionMatch) {
      return null;
    }

    const section = monthSectionMatch[1];
    const yearMatch = section.match(/(20\d{2}|19\d{2})/);
    if (!yearMatch) {
      return null;
    }

    const year = Number.parseInt(yearMatch[1], 10);
    if (Number.isNaN(year)) {
      return null;
    }

    const beforeYear = section.slice(0, yearMatch.index);
    const monthMatches = beforeYear.match(/\d{1,2}/g) || [];
    const validMonths = monthMatches
      .map((m) => Number.parseInt(m, 10))
      .filter((m) => !Number.isNaN(m) && m >= 1 && m <= 12);

    if (validMonths.length === 0) {
      return null;
    }

    // For ranges like 03-04/2020, use 04 as the sorting month.
    const month = Math.max(...validMonths);
    return { month, year };
  };

  return Array.from(map.entries())
    .map(([title, count]) => {
      const date = extractMonthYear(title);
      return { title, count, date };
    })
    .sort((a, b) => {
      if (a.date && b.date) {
        if (a.date.year !== b.date.year) {
          return b.date.year - a.date.year;
        }
        if (a.date.month !== b.date.month) {
          return b.date.month - a.date.month;
        }
        return a.title.localeCompare(b.title);
      }

      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return a.title.localeCompare(b.title);
    })
    .map(({ title, count }) => ({ title, count }));
}

function loadLookupRows() {
  if (!fs.existsSync(LOOKUP_FILE)) {
    throw new Error("Lookup.tsv was not found in workspace root.");
  }

  const text = readTextFileWithEncoding(LOOKUP_FILE);
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) {
    return [];
  }

  // Use a tolerant parser dedicated for Lookup.tsv where we only need the first 6 columns.
  // This avoids losing rows when some cells contain malformed quotes/newlines.
  const headers = ["App No.", "Attorney", "Case Ref", "Client", "Applicant name", "Status"];
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.trim()) {
      continue;
    }

    const parts = line.split("\t");
    const row = {
      [headers[0]]: (parts[0] || "").trim(),
      [headers[1]]: (parts[1] || "").trim(),
      [headers[2]]: (parts[2] || "").trim(),
      [headers[3]]: (parts[3] || "").trim(),
      [headers[4]]: (parts[4] || "").trim(),
      [headers[5]]: (parts[5] || "").trim(),
    };

    const hasData = Object.values(row).some((v) => String(v || "").length > 0);
    if (hasData) {
      rows.push(row);
    }
  }

  return rows;
}

function buildLookupMap(lookupRows) {
  const tokenNameSets = {
    appNo: new Set(["appno", "applicationno", "applicationnumber"]),
    attorney: new Set(["attorney"]),
    caseRef: new Set(["caseref", "casefile", "case"]),
    client: new Set(["client"]),
    applicantName: new Set(["applicantname", "applicant"]),
    status: new Set(["status"]),
  };

  const extractByToken = (row, tokenSet, fallbackIndex = -1) => {
    const keys = Object.keys(row || {});
    for (const key of keys) {
      const token = normalizeHeaderToken(key);
      if (tokenSet.has(token)) {
        return String(row[key] || "").trim();
      }
    }

    if (fallbackIndex >= 0 && fallbackIndex < keys.length) {
      return String(row[keys[fallbackIndex]] || "").trim();
    }

    return "";
  };

  const map = new Map();
  for (const row of lookupRows) {
    // Fallback index 0 ensures we still parse App No. even if header text is malformed.
    const appNoRaw = extractByToken(row, tokenNameSets.appNo, 0);
    const appNo = normalizeAppNo(appNoRaw);
    if (!appNo) {
      continue;
    }

    map.set(appNo, {
      appNo,
      attorney: extractByToken(row, tokenNameSets.attorney, 1),
      caseRef: extractByToken(row, tokenNameSets.caseRef, 2),
      client: extractByToken(row, tokenNameSets.client, 3),
      applicantName: extractByToken(row, tokenNameSets.applicantName, 4),
      status: extractByToken(row, tokenNameSets.status, 5),
    });
  }

  return map;
}

function sanitizeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[- ]+|[- ]+$/g, "")
    .slice(0, 140);
}

function normalizeAppNo(value) {
  const normalized = String(value || "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();

  const match = normalized.match(/^([12])-(\d{4})-(\d{1,})$/);
  if (!match) {
    return normalized;
  }

  const prefix = match[1];
  const year = match[2];
  const sequence = Number.parseInt(match[3], 10);
  if (Number.isNaN(sequence)) {
    return normalized;
  }

  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`;
}

function normalizeTokenForMatch(value) {
  return String(value || "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();
}

function findExistingPdfMatchByTokens(dirPath, soBang, soDon) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  const tokenSoBang = normalizeTokenForMatch(soBang);
  const tokenSoDon = normalizeTokenForMatch(soDon);
  if (!tokenSoBang || !tokenSoDon) {
    return null;
  }

  let files = [];
  try {
    files = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_error) {
    return null;
  }

  for (const entry of files) {
    if (!entry.isFile()) {
      continue;
    }

    const name = String(entry.name || "");
    if (!name.toLowerCase().endsWith(".pdf")) {
      continue;
    }

    const tokenName = normalizeTokenForMatch(name);
    if (tokenName.includes(tokenSoBang) && tokenName.includes(tokenSoDon)) {
      return path.join(dirPath, name);
    }
  }

  return null;
}

function buildOutputFileName(match) {
  const soBang = sanitizeFilePart(match.so_bang || "UNKNOWN_SO_BANG");
  const soDon = sanitizeFilePart(match.so_don || "UNKNOWN_SO_DON");
  const attorney = sanitizeFilePart(match.attorney || "UNKNOWN_ATTORNEY");
  const caseRef = sanitizeFilePart(match.caseRef || "UNKNOWN_CASE_REF");
  const status = sanitizeFilePart(match.status || "NA");

  return `${soBang}_${soDon}_${attorney}_${caseRef}_[${status}].pdf`;
}

function normalizeFolderNameFromTitle(title) {
  return sanitizeFilePart(title || "UNTITLED_SOURCE_ENTRY") || "UNTITLED_SOURCE_ENTRY";
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_error) {
    // Best effort cleanup.
  }
}

function isPdfBuffer(buffer) {
  if (!buffer || buffer.length < 8) {
    return false;
  }
  const head = buffer.subarray(0, 5).toString("ascii");
  return head === "%PDF-";
}

function validatePdfFile(filePath, minBytes = 128) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: "missing-file" };
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return { ok: false, reason: "not-file" };
  }

  if (stat.size < minBytes) {
    return { ok: false, reason: `too-small-${stat.size}` };
  }

  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(8);
    const read = fs.readSync(fd, buf, 0, 8, 0);
    if (read < 5) {
      return { ok: false, reason: "header-too-short" };
    }

    if (!isPdfBuffer(buf)) {
      return { ok: false, reason: "invalid-pdf-header" };
    }
  } finally {
    fs.closeSync(fd);
  }

  return { ok: true, size: stat.size };
}

function writeBufferAtomic(filePath, data) {
  const tempPath = `${filePath}.part`;
  safeUnlink(tempPath);
  fs.writeFileSync(tempPath, data);
  fs.renameSync(tempPath, filePath);
}

function createSafeTempFilePath(dirPath, ext = ".tmp") {
  const stamp = Date.now();
  const rnd = Math.random().toString(36).slice(2, 10);
  return path.join(dirPath, `dl_${stamp}_${rnd}${ext}`);
}

function buildMatches({ sourceRows, selectedTitles, manualAppNos, lookupMap }) {
  const selectedSet = new Set((selectedTitles || []).map((s) => String(s || "").trim()).filter(Boolean));
  const manualAppNoSet = new Set((manualAppNos || []).map((s) => normalizeAppNo(s)).filter(Boolean));
  const hasTitleFilter = selectedSet.size > 0;
  const hasManualAppNoFilter = manualAppNoSet.size > 0;

  const matches = [];
  let candidateRows = 0;
  let candidateWithAppNo = 0;
  let notFoundInLookup = 0;
  const selectedUniqueAppNos = new Set();
  const foundInSourceAppNos = new Set();
  const foundInLookupAppNos = new Set();

  for (const row of sourceRows) {
    const title = String(row.source_entry_title || "").trim();
    if (hasTitleFilter && !selectedSet.has(title)) {
      continue;
    }

    const soDonRaw = String(row.so_don || row["so_don"] || "").trim();
    const soDon = normalizeAppNo(soDonRaw);
    if (hasManualAppNoFilter && !manualAppNoSet.has(soDon)) {
      continue;
    }

    if (hasManualAppNoFilter && soDon) {
      foundInSourceAppNos.add(soDon);
    }

    candidateRows += 1;

    if (!soDon) {
      continue;
    }
    candidateWithAppNo += 1;
    selectedUniqueAppNos.add(soDon);

    const lookup = lookupMap.get(soDon) || null;
    if (!lookup) {
      notFoundInLookup += 1;
    } else if (hasManualAppNoFilter) {
      foundInLookupAppNos.add(soDon);
    }

    const soBangPdfUrl = String(row.so_bang_pdf_url || "").trim();
    if (!soBangPdfUrl) {
      continue;
    }

    const match = {
      source_entry_title: title,
      source_entry_url: String(row.source_entry_url || "").trim(),
      stt: String(row.stt || "").trim(),
      so_bang: String(row.so_bang || "").trim(),
      so_don: soDonRaw,
      ten_sc_gphi: String(row.ten_sc_gphi || "").trim(),
      ten_chu_van_bang: String(row.ten_chu_van_bang || "").trim(),
      so_bang_pdf_url: soBangPdfUrl,
      attorney: lookup ? lookup.attorney : "",
      caseRef: lookup ? lookup.caseRef : "",
      client: lookup ? lookup.client : "",
      applicantName: lookup ? lookup.applicantName : "",
      status: lookup ? lookup.status : "",
    };

    match.outputFileName = buildOutputFileName(match);
    matches.push(match);
  }

  const manualRequested = Array.from(manualAppNoSet);
  const manualFoundInSource = Array.from(foundInSourceAppNos);
  const manualMatched = Array.from(foundInLookupAppNos);
  const manualMissingInSource = manualRequested.filter((id) => !foundInSourceAppNos.has(id));
  const manualMissingInLookup = manualFoundInSource.filter((id) => !foundInLookupAppNos.has(id));

  return {
    matches,
    stats: {
      selectedTitleCount: selectedSet.size,
      manualAppNoCount: manualAppNoSet.size,
      candidateRows,
      candidateWithAppNo,
      selectedUniqueAppNoCount: selectedUniqueAppNos.size,
      lookupKeyCount: lookupMap.size,
      notFoundInLookup,
      matchedCount: matches.length,
      manualFoundInSourceCount: manualFoundInSource.length,
      manualMatchedCount: manualMatched.length,
      manualMissingInSourceCount: manualMissingInSource.length,
      manualMissingInLookupCount: manualMissingInLookup.length,
      manualMatchedAppNos: manualMatched,
      manualMissingInSource,
      manualMissingInLookup,
    },
  };
}

async function downloadPdfViaFetch(url, filePath, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("fetch timeout"));
  }, timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://ipvietnam.gov.vn/",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response || !response.ok) {
    throw new Error(`HTTP ${response ? response.status : "no-response"}`);
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (!isPdfBuffer(data)) {
    throw new Error("Fetch response is not a valid PDF payload.");
  }

  writeBufferAtomic(filePath, data);
  const check = validatePdfFile(filePath);
  if (!check.ok) {
    safeUnlink(filePath);
    throw new Error(`Fetch output invalid: ${check.reason}`);
  }
}

const CHROME_CANDIDATE_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.USERPROFILE || ""}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findChromeExecutable() {
  for (const p of CHROME_CANDIDATE_PATHS) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

async function downloadPdfViaPuppeteer(url, filePath, { headless = true, timeoutMs = 90000 } = {}) {
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    throw new Error("Could not find Chrome or Edge executable on this machine.");
  }

  const launchAttempts = [
    { headless, executablePath },
  ];

  let lastError = null;

  for (const options of launchAttempts) {
    let browser = null;
    try {
      browser = await puppeteer.launch({
        ...options,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      );

      const response = await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: timeoutMs,
      });

      if (!response) {
        throw new Error("No response from Chrome fallback.");
      }

      if (!response.ok()) {
        throw new Error(`Chrome fallback HTTP ${response.status()}`);
      }

      const data = await response.buffer();
      if (!isPdfBuffer(data)) {
        throw new Error("Chrome fallback response is not PDF.");
      }

      writeBufferAtomic(filePath, data);
      const check = validatePdfFile(filePath);
      if (!check.ok) {
        safeUnlink(filePath);
        throw new Error(`Chrome fallback invalid output: ${check.reason}`);
      }

      await browser.close();
      return;
    } catch (error) {
      lastError = error;
      if (browser) {
        try {
          await browser.close();
        } catch (_closeErr) {
          // ignore
        }
      }
    }
  }

  throw lastError || new Error("Chrome fallback failed.");
}

function psSingleQuoted(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

async function downloadPdfViaPowerShell(url, filePath, timeoutMs = 90000) {
  const tempRoot = path.join(os.tmpdir(), "ipvn_lookup_dl");
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempPath = createSafeTempFilePath(tempRoot, ".ps.part");
  safeUnlink(tempPath);

  const command = [
    "$ErrorActionPreference='Stop'",
    `$u=${psSingleQuoted(url)}`,
    `$out=${psSingleQuoted(tempPath)}`,
    "Invoke-WebRequest -Uri $u -OutFile $out -UseBasicParsing -MaximumRedirection 10 -TimeoutSec 60",
  ].join("; ");

  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    safeUnlink(tempPath);
    throw result.error;
  }

  if (result.status !== 0) {
    safeUnlink(tempPath);
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(stderr || stdout || `PowerShell download failed with code ${result.status}`);
  }

  if (!fs.existsSync(tempPath)) {
    throw new Error("PowerShell download did not produce a file.");
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  safeUnlink(filePath);
  try {
    fs.renameSync(tempPath, filePath);
  } catch (_renameError) {
    // Fallback when rename cannot be completed due to file locks or transient issues.
    fs.copyFileSync(tempPath, filePath);
    safeUnlink(tempPath);
  }

  const check = validatePdfFile(filePath);
  if (!check.ok) {
    safeUnlink(filePath);
    throw new Error(`PowerShell output invalid: ${check.reason}`);
  }
}

async function withTimeout(promiseFactory, timeoutMs, timeoutMessage) {
  let timer = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage || "Operation timeout."));
    }, timeoutMs);

    Promise.resolve()
      .then(() => promiseFactory())
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function retryOperation(operation, attempts, perAttemptTimeoutMs, timeoutMessageBase) {
  const maxAttempts = Math.max(1, Number.parseInt(String(attempts || 1), 10) || 1);
  let lastError = null;

  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      await withTimeout(
        () => operation(i),
        perAttemptTimeoutMs,
        `${timeoutMessageBase || "Operation"} timeout (attempt ${i}/${maxAttempts})`
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Operation failed.");
}

function emitDownloadLog(type, match, extra = {}) {
  sendToRenderer("lookupgui:download-log", {
    type,
    so_don: match.so_don,
    source_entry_title: match.source_entry_title,
    ...extra,
  });
}

function resolveDownloadTarget(outputDir, match) {
  const titleFolder = normalizeFolderNameFromTitle(match.source_entry_title);
  const targetDir = path.join(outputDir, titleFolder);
  fs.mkdirSync(targetDir, { recursive: true });

  let fileName = String(match.outputFileName || "file.pdf");
  let destination = path.join(targetDir, fileName);

  const MAX_SAFE_PATH = 235;
  if (destination.length > MAX_SAFE_PATH) {
    const ext = path.extname(fileName) || ".pdf";
    const base = path.basename(fileName, ext);
    const overflow = destination.length - MAX_SAFE_PATH;
    const trimBy = overflow + 20;
    const shortened = base.slice(0, Math.max(24, base.length - trimBy));
    fileName = `${shortened}${ext}`;
    destination = path.join(targetDir, fileName);
  }

  return { titleFolder, targetDir, destination };
}

function resolveExistingDownloadedFile(targetDir, destination, match) {
  const byTokens = findExistingPdfMatchByTokens(targetDir, match.so_bang, match.so_don);
  if (byTokens) {
    const check = validatePdfFile(byTokens);
    if (check.ok) {
      return byTokens;
    }
    safeUnlink(byTokens);
  }

  if (fs.existsSync(destination)) {
    const check = validatePdfFile(destination);
    if (check.ok) {
      return destination;
    }
    safeUnlink(destination);
  }

  return null;
}

async function tryDownloadWithMethods(match, destination, options) {
  const methods = [
    {
      key: "fetch",
      logType: "try-fetch",
      run: async () => {
        await retryOperation(
          () => downloadPdfViaFetch(match.so_bang_pdf_url, destination, 45000),
          2,
          60000,
          "Fetch"
        );
      },
    },
    {
      key: "powershell-fallback",
      logType: "try-powershell",
      run: async () => {
        await retryOperation(
          () => downloadPdfViaPowerShell(match.so_bang_pdf_url, destination, 90000),
          2,
          100000,
          "PowerShell fallback"
        );
      },
    },
    {
      key: "chrome-fallback",
      logType: "try-chrome",
      run: async () => {
        await retryOperation(
          () =>
            downloadPdfViaPuppeteer(match.so_bang_pdf_url, destination, {
              headless: options.headlessBrowser !== false,
              timeoutMs: 60000,
            }),
          2,
          90000,
          "Chrome fallback"
        );
      },
    },
  ];

  const errors = [];

  for (const method of methods) {
    safeUnlink(destination);
    emitDownloadLog(method.logType, match, {
      filePath: destination,
      url: match.so_bang_pdf_url,
    });

    try {
      await method.run();
      const check = validatePdfFile(destination);
      if (!check.ok) {
        safeUnlink(destination);
        throw new Error(`Output invalid: ${check.reason}`);
      }
      return { ok: true, via: method.key };
    } catch (error) {
      errors.push(`${method.key}: ${error.message || String(error)}`);
      safeUnlink(destination);
    }
  }

  return { ok: false, error: errors.join(" | ") };
}

async function runWithConcurrency(items, worker, concurrency, shouldStop) {
  const limit = Math.max(1, Number.parseInt(String(concurrency || 1), 10) || 1);
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      if (typeof shouldStop === "function" && shouldStop()) {
        return;
      }

      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }

      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { ok: false, error: error.message || String(error) };
      }
    }
  }

  const workers = [];
  for (let i = 0; i < limit; i += 1) {
    workers.push(runner());
  }
  await Promise.all(workers);
  return results;
}

async function downloadMatches({ sourceFileName, selectedTitles, manualAppNos, headlessBrowser = true, downloadDir = "" }) {
  const options = { headlessBrowser };
  if (downloadControl.running) {
    return { ok: false, error: "A download job is already running." };
  }

  downloadControl.running = true;
  downloadControl.cancelRequested = false;

  const sourceRows = loadSourceRows(sourceFileName);
  const lookupRows = loadLookupRows();
  const lookupMap = buildLookupMap(lookupRows);
  const built = buildMatches({ sourceRows, selectedTitles, manualAppNos, lookupMap });
  const matches = built.matches;

  const selectedRoot = String(downloadDir || "").trim() || downloadRoot;
  const outputDir = path.resolve(selectedRoot);
  fs.mkdirSync(outputDir, { recursive: true });
  const seenTargetPaths = new Set();

  let results = [];
  try {
    results = await runWithConcurrency(
      matches,
      async (match) => {
        if (downloadControl.cancelRequested) {
          return { ok: false, cancelled: true, match };
        }

        const { targetDir, destination } = resolveDownloadTarget(outputDir, match);
        const dedupeKey = destination.toLowerCase();

        emitDownloadLog("check", match, { filePath: destination });

        if (seenTargetPaths.has(dedupeKey)) {
          emitDownloadLog("skip", match, {
            reason: "duplicate-target-in-run",
            filePath: destination,
          });
          return { ok: true, skippedExisting: true, duplicateInRun: true, filePath: destination, match };
        }
        seenTargetPaths.add(dedupeKey);

        const existingFilePath = resolveExistingDownloadedFile(targetDir, destination, match);
        if (existingFilePath) {
          emitDownloadLog("skip", match, {
            reason: "already-downloaded",
            filePath: existingFilePath,
          });
          return { ok: true, skippedExisting: true, filePath: existingFilePath, match };
        }

        const downloaded = await tryDownloadWithMethods(match, destination, options);
        if (downloaded.ok) {
          emitDownloadLog("downloaded", match, {
            via: downloaded.via,
            filePath: destination,
          });
          return { ok: true, filePath: destination, match };
        }

        emitDownloadLog("failed", match, {
          filePath: destination,
          error: downloaded.error,
        });
        return {
          ok: false,
          error: downloaded.error,
          match,
        };
      },
      1,
      () => downloadControl.cancelRequested
    );
  } finally {
    downloadControl.running = false;
  }

  const downloaded = results.filter((r) => r.ok).length;
  const skippedExisting = results.filter((r) => r && r.ok && r.skippedExisting).length;
  const downloadedNew = results.filter((r) => r && r.ok && !r.skippedExisting).length;
  const failed = results.filter((r) => !r.ok).length;
  const cancelled = results.filter((r) => r && r.cancelled).length;

  return {
    ok: true,
    totalMatches: matches.length,
    stats: built.stats,
    downloaded,
    downloadedNew,
    skippedExisting,
    failed,
    cancelled,
    outputDir,
    failures: results.filter((r) => !r.ok).slice(0, 50).map((r) => ({
      so_don: r.match.so_don,
      so_bang_pdf_url: r.match.so_bang_pdf_url,
      error: r.cancelled ? "Cancelled" : r.error,
    })),
  };
}

ipcMain.handle("lookupgui:list-source-files", () => {
  try {
    const files = listSourceFiles();
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lookupgui:load-source-summary", (_event, payload) => {
  try {
    const fileName = payload ? payload.fileName : "";
    const rows = loadSourceRows(fileName);
    const titleCounts = toTitleCounts(rows);
    return {
      ok: true,
      rowCount: rows.length,
      titleCounts,
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lookupgui:lookup-matches", (_event, payload) => {
  try {
    const fileName = payload ? payload.fileName : "";
    const selectedTitles = payload && Array.isArray(payload.selectedTitles) ? payload.selectedTitles : [];
    const manualAppNos = payload && Array.isArray(payload.manualAppNos) ? payload.manualAppNos : [];

    const sourceRows = loadSourceRows(fileName);
    const lookupRows = loadLookupRows();
    const lookupMap = buildLookupMap(lookupRows);
    const built = buildMatches({ sourceRows, selectedTitles, manualAppNos, lookupMap });
    const matches = built.matches;

    return {
      ok: true,
      matchCount: matches.length,
      stats: built.stats,
      preview: matches.slice(0, 400),
      truncated: matches.length > 400,
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lookupgui:download-matches", async (_event, payload) => {
  try {
    const fileName = payload ? payload.fileName : "";
    const selectedTitles = payload && Array.isArray(payload.selectedTitles) ? payload.selectedTitles : [];
    const manualAppNos = payload && Array.isArray(payload.manualAppNos) ? payload.manualAppNos : [];
    const headlessBrowser = payload && payload.headlessBrowser === false ? false : true;
    const downloadDir = payload && payload.downloadDir ? String(payload.downloadDir) : "";
    return await downloadMatches({ sourceFileName: fileName, selectedTitles, manualAppNos, headlessBrowser, downloadDir });
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lookupgui:get-path-settings", () => {
  return {
    ok: true,
    sourceDir,
    downloadDir: downloadRoot,
  };
});

ipcMain.handle("lookupgui:set-path-settings", (_event, payload) => {
  try {
    const nextSource = payload && payload.sourceDir ? String(payload.sourceDir).trim() : "";
    const nextDownload = payload && payload.downloadDir ? String(payload.downloadDir).trim() : "";

    if (!nextSource) {
      return { ok: false, error: "Source directory is required." };
    }

    const resolvedSource = path.resolve(nextSource);
    if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isDirectory()) {
      return { ok: false, error: "Source directory does not exist." };
    }

    const resolvedDownload = path.resolve(nextDownload || DEFAULT_DOWNLOAD_DIR);
    fs.mkdirSync(resolvedDownload, { recursive: true });

    sourceDir = resolvedSource;
    downloadRoot = resolvedDownload;

    return {
      ok: true,
      sourceDir,
      downloadDir: downloadRoot,
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lookupgui:pick-directory", async (_event, payload) => {
  try {
    const startPath = payload && payload.startPath ? String(payload.startPath).trim() : "";
    const defaultPath = startPath || ROOT_DIR;

    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath,
      properties: ["openDirectory", "createDirectory"],
      title: "Select Directory",
    });

    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return { ok: true, canceled: true };
    }

    return { ok: true, canceled: false, path: result.filePaths[0] };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lookupgui:abort-download", () => {
  if (!downloadControl.running) {
    return { ok: false, error: "No running download job." };
  }

  downloadControl.cancelRequested = true;
  return { ok: true };
});

ipcMain.handle("lookupgui:start-monthly-scrape", () => {
  try {
    return startMonthlyScrapeProcess();
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lookupgui:open-output-folder", async (_event, payload) => {
  try {
    const requested = payload && payload.path ? String(payload.path) : "";
    const targetPath = requested || downloadRoot;
    const resolved = path.resolve(targetPath);

    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }

    const openError = await shell.openPath(resolved);
    if (openError) {
      return { ok: false, error: openError };
    }

    return { ok: true, path: resolved };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
