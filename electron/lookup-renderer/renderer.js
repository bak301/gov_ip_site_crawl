const sourceFileSelect = document.getElementById("sourceFileSelect");
const sourceDirInput = document.getElementById("sourceDirInput");
const browseSourceDirButton = document.getElementById("browseSourceDirButton");
const downloadDirInput = document.getElementById("downloadDirInput");
const browseDownloadDirButton = document.getElementById("browseDownloadDirButton");
const savePathSettingsButton = document.getElementById("savePathSettingsButton");
const refreshFilesButton = document.getElementById("refreshFilesButton");
const loadSourceButton = document.getElementById("loadSourceButton");
const rowCountBadge = document.getElementById("rowCountBadge");
const titleList = document.getElementById("titleList");
const headlessCheckbox = document.getElementById("headlessCheckbox");
const startScrapeButton = document.getElementById("startScrapeButton");
const selectAllButton = document.getElementById("selectAllButton");
const clearSelectionButton = document.getElementById("clearSelectionButton");
const lookupButton = document.getElementById("lookupButton");
const downloadButton = document.getElementById("downloadButton");
const openOutputFolderButton = document.getElementById("openOutputFolderButton");
const abortDownloadButton = document.getElementById("abortDownloadButton");
const appNoInput = document.getElementById("appNoInput");
const appNoMatchStatus = document.getElementById("appNoMatchStatus");
const summaryBox = document.getElementById("summaryBox");
const preview = document.getElementById("preview");
const toggleAutoScrollButton = document.getElementById("toggleAutoScrollButton");
const togglePreviewButton = document.getElementById("togglePreviewButton");
const log = document.getElementById("log");
const clearLogButton = document.getElementById("clearLogButton");

let currentTitleCounts = [];
let previewAutoScroll = true;
let previewVisible = true;
let downloadInProgress = false;
let scrapeInProgress = false;
let lastOutputDir = "";
let currentSourceDir = "";
let currentDownloadDir = "";
const APP_NO_PATTERN = /^[12]-\d{4}-\d{5,}$/;

function appendLog(text) {
  log.textContent += `${text}\n`;
  log.scrollTop = log.scrollHeight;
}

function setSummary(lines) {
  summaryBox.textContent = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
}

function appendPreviewLine(text) {
  preview.textContent += `${text}\n`;
  if (previewAutoScroll) {
    preview.scrollTop = preview.scrollHeight;
  }
}

function clearPreview() {
  preview.textContent = "";
}

function getSelectedTitles() {
  const checks = titleList.querySelectorAll("input[type=checkbox][data-title]");
  return Array.from(checks)
    .filter((x) => x.checked)
    .map((x) => String(x.dataset.title || ""))
    .filter((x) => x.length > 0);
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

function analyzeManualAppNos() {
  const text = String(appNoInput && appNoInput.value ? appNoInput.value : "");
  const lines = text.split(/\r?\n/).map((line) => String(line || "").trim()).filter(Boolean);

  const found = [];
  const invalidLines = [];

  for (const rawLine of lines) {
    const normalizedLine = rawLine
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
      .toUpperCase();

    const matches = normalizedLine.match(/[12]-\d{4}-\d{1,}/g) || [];
    if (matches.length === 0) {
      invalidLines.push(rawLine);
      continue;
    }

    matches.forEach((id) => {
      found.push(normalizeAppNo(id));
    });
  }

  const valid = Array.from(new Set(found));

  return {
    inputCount: lines.length,
    uniqueCount: valid.length,
    validUnique: valid,
    invalidUnique: invalidLines,
  };
}

function setAppNoMatchStatus(text = "") {
  if (!appNoMatchStatus) {
    return;
  }
  appNoMatchStatus.textContent = text ? `(${text})` : "";
}

function updateAppNoInputStatus() {
  const analyzed = analyzeManualAppNos();
  if (analyzed.uniqueCount === 0) {
    setAppNoMatchStatus("");
    return;
  }

  if (analyzed.invalidUnique.length > 0) {
    setAppNoMatchStatus(`${analyzed.validUnique.length} valid, ${analyzed.invalidUnique.length} invalid format`);
    return;
  }

  setAppNoMatchStatus(`${analyzed.validUnique.length} IDs detected`);
}

function renderTitleList(titleCounts) {
  titleList.innerHTML = "";

  if (!titleCounts || titleCounts.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No source_entry_title found in this file.";
    titleList.appendChild(empty);
    return;
  }

  titleCounts.forEach((entry) => {
    const row = document.createElement("label");
    row.className = "item";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.dataset.title = entry.title;

    const title = document.createElement("div");
    title.textContent = entry.title;

    const count = document.createElement("div");
    count.className = "count";
    count.textContent = `${entry.count} rows`;

    row.appendChild(check);
    row.appendChild(title);
    row.appendChild(count);
    titleList.appendChild(row);
  });
}

async function refreshSourceFiles() {
  const result = await window.lookupGui.listSourceFiles();
  if (!result.ok) {
    appendLog(`[ERR] ${result.error}`);
    return;
  }

  sourceFileSelect.innerHTML = "";
  (result.files || []).forEach((fileName) => {
    const option = document.createElement("option");
    option.value = fileName;
    option.textContent = fileName;
    sourceFileSelect.appendChild(option);
  });

  appendLog(`[INFO] Source files loaded: ${(result.files || []).length}`);
  if ((result.files || []).length === 0) {
    appendLog(`[INFO] Source directory: ${currentSourceDir || sourceDirInput.value || "(not set)"}`);
  }
}

async function loadPathSettings() {
  const result = await window.lookupGui.getPathSettings();
  if (!result.ok) {
    appendLog(`[ERR] Unable to load path settings: ${result.error}`);
    return;
  }

  currentSourceDir = String(result.sourceDir || "");
  currentDownloadDir = String(result.downloadDir || "");
  sourceDirInput.value = currentSourceDir;
  downloadDirInput.value = currentDownloadDir;
  appendLog(`[INFO] Source directory: ${currentSourceDir}`);
  appendLog(`[INFO] Download directory: ${currentDownloadDir}`);
}

async function applyPathSettings() {
  const sourceDir = String(sourceDirInput.value || "").trim();
  const downloadDir = String(downloadDirInput.value || "").trim();

  const result = await window.lookupGui.setPathSettings({ sourceDir, downloadDir });
  if (!result.ok) {
    appendLog(`[ERR] ${result.error}`);
    return;
  }

  currentSourceDir = String(result.sourceDir || "");
  currentDownloadDir = String(result.downloadDir || "");
  sourceDirInput.value = currentSourceDir;
  downloadDirInput.value = currentDownloadDir;

  appendLog(`[INFO] Paths applied.`);
  appendLog(`[INFO] Source directory: ${currentSourceDir}`);
  appendLog(`[INFO] Download directory: ${currentDownloadDir}`);

  await refreshSourceFiles();
  await loadSelectedSource();
}

async function browseDirectoryForInput(inputElement) {
  const startPath = String(inputElement.value || "").trim();
  const result = await window.lookupGui.pickDirectory({ startPath });
  if (!result.ok) {
    appendLog(`[ERR] ${result.error}`);
    return;
  }
  if (result.canceled) {
    return;
  }

  inputElement.value = String(result.path || "");
}

async function loadSelectedSource() {
  const fileName = sourceFileSelect.value;
  if (!fileName) {
    appendLog("[WARN] No source file selected.");
    return;
  }

  const result = await window.lookupGui.loadSourceSummary({ fileName });
  if (!result.ok) {
    appendLog(`[ERR] ${result.error}`);
    return;
  }

  currentTitleCounts = result.titleCounts || [];
  rowCountBadge.textContent = `Rows: ${result.rowCount || 0}`;
  renderTitleList(currentTitleCounts);
  setSummary([
    `Source: ${fileName}`,
    `Loaded rows: ${result.rowCount || 0}`,
    `source_entry_title count: ${currentTitleCounts.length}`,
  ]);
  appendLog(`[INFO] Loaded ${fileName} with ${result.rowCount || 0} rows.`);
}

async function startMonthlyScrape() {
  if (scrapeInProgress) {
    appendLog("[WARN] Scrape is already running.");
    return;
  }

  appendLog("[INFO] Starting monthly scrape (unified continuously-updated output)...");
  const result = await window.lookupGui.startMonthlyScrape();
  if (!result.ok) {
    appendLog(`[ERR] ${result.error}`);
    return;
  }

  scrapeInProgress = true;
  startScrapeButton.disabled = true;
  startScrapeButton.textContent = "Scraping...";
}

async function runLookup() {
  const fileName = sourceFileSelect.value;
  const analyzed = analyzeManualAppNos();
  const manualAppNos = analyzed.validUnique;

  if (!fileName) {
    appendLog("[WARN] Select a source file first.");
    return;
  }
  if (manualAppNos.length === 0) {
    appendLog("[WARN] Paste valid Application No. values before lookup. Required format: 1-yyyy-00000");
    return;
  }
  if (analyzed.invalidUnique.length > 0) {
    appendLog(`[WARN] Ignoring ${analyzed.invalidUnique.length} invalid IDs (expected format: 1-yyyy-00000).`);
  }

  appendLog(`[LOOKUP] Searching ${manualAppNos.length} unique valid App Nos...`);
  const result = await window.lookupGui.lookupMatches({ fileName, selectedTitles: [], manualAppNos });
  if (!result.ok) {
    appendLog(`[ERR] ${result.error}`);
    return;
  }

  const stats = result.stats || {};
  setAppNoMatchStatus(`${result.matchCount} matches found`);

  const lines = [];
  lines.push(`Lookup input (valid unique IDs): ${manualAppNos.length}`);
  lines.push(`Matches found: ${result.matchCount}`);
  lines.push(`Found in source file: ${stats.manualFoundInSourceCount || 0}`);
  lines.push(`Matched in Lookup.tsv: ${stats.manualMatchedCount || 0}`);
  lines.push(`Missing from source file: ${stats.manualMissingInSourceCount || 0}`);
  lines.push(`Missing from Lookup.tsv: ${stats.manualMissingInLookupCount || 0}`);
  if (result.truncated) {
    lines.push("Preview truncated to first 400 matches.");
  }

  const previewLines = (result.preview || []).slice(0, 120).map((m, idx) =>
    `${idx + 1}. ${m.so_don} | ${m.so_bang} | ${m.attorney} | ${m.caseRef} | ${m.status}`
  );

  clearPreview();
  previewLines.forEach((line) => appendPreviewLine(line));

  if (Array.isArray(stats.manualMissingInSource) && stats.manualMissingInSource.length > 0) {
    appendPreviewLine(`[MISS-SOURCE] ${stats.manualMissingInSource.slice(0, 30).join(", ")}`);
  }
  if (Array.isArray(stats.manualMissingInLookup) && stats.manualMissingInLookup.length > 0) {
    appendPreviewLine(`[MISS-LOOKUP] ${stats.manualMissingInLookup.slice(0, 30).join(", ")}`);
  }

  setSummary(lines);
  appendLog(`[LOOKUP] Done. matches=${result.matchCount}, sourceFound=${stats.manualFoundInSourceCount || 0}, lookupFound=${stats.manualMatchedCount || 0}, missSource=${stats.manualMissingInSourceCount || 0}, missLookup=${stats.manualMissingInLookupCount || 0}`);
}

async function downloadSelected() {
  const fileName = sourceFileSelect.value;
  const analyzed = analyzeManualAppNos();
  const manualAppNos = analyzed.validUnique;
  const downloadDir = String(downloadDirInput.value || "").trim();

  if (!fileName) {
    appendLog("[WARN] Select a source file first.");
    return;
  }
  if (manualAppNos.length === 0) {
    appendLog("[WARN] Paste valid Application No. values before download. Required format: 1-yyyy-00000");
    return;
  }

  if (analyzed.invalidUnique.length > 0) {
    appendLog(`[WARN] Ignoring ${analyzed.invalidUnique.length} invalid IDs (expected format: 1-yyyy-00000).`);
  }

  appendLog(`[DOWNLOAD] Starting download for ${manualAppNos.length} valid App Nos...`);
  clearPreview();
  appendPreviewLine(`[DOWNLOAD] Started (appNos=${manualAppNos.length})...`);
  downloadInProgress = true;
  abortDownloadButton.disabled = false;
  downloadButton.disabled = true;

  let result;
  try {
    result = await window.lookupGui.downloadMatches({
      fileName,
      selectedTitles: [],
      manualAppNos,
      downloadDir,
      headlessBrowser: !!headlessCheckbox.checked,
    });
  } catch (error) {
    appendLog(`[ERR] Download request failed: ${error.message || String(error)}`);
    appendPreviewLine(`[ERROR] Download request failed: ${error.message || String(error)}`);
    return;
  } finally {
    downloadInProgress = false;
    abortDownloadButton.disabled = true;
    downloadButton.disabled = false;
  }

  if (!result.ok) {
    appendLog(`[ERR] ${result.error}`);
    appendPreviewLine(`[ERROR] ${result.error}`);
    return;
  }

  setSummary([
    `Total matches: ${result.totalMatches}`,
    result.stats ? `Manual App No. count: ${result.stats.manualAppNoCount || 0}` : "",
    result.stats ? `Found in source file: ${result.stats.manualFoundInSourceCount || 0}` : "",
    result.stats ? `Matched in Lookup.tsv: ${result.stats.manualMatchedCount || 0}` : "",
    result.stats ? `Missing from source file: ${result.stats.manualMissingInSourceCount || 0}` : "",
    result.stats ? `Missing from Lookup.tsv: ${result.stats.manualMissingInLookupCount || 0}` : "",
    result.stats ? `Candidate rows: ${result.stats.candidateRows}` : "",
    result.stats ? `Rows with App No.: ${result.stats.candidateWithAppNo}` : "",
    `Downloaded (all ok): ${result.downloaded}`,
    `Downloaded (new): ${result.downloadedNew || 0}`,
    `Skipped existing: ${result.skippedExisting || 0}`,
    `Failed: ${result.failed}`,
    `Cancelled: ${result.cancelled || 0}`,
    `Output folder: ${result.outputDir}`,
  ].filter(Boolean));

  appendPreviewLine(`[DOWNLOAD] Done. Downloaded=${result.downloaded}, New=${result.downloadedNew || 0}, Skipped=${result.skippedExisting || 0}, Failed=${result.failed}, Cancelled=${result.cancelled || 0}`);
  appendPreviewLine(`[OUTPUT] ${result.outputDir}`);
  lastOutputDir = String(result.outputDir || "");

  if (result.failures && result.failures.length > 0) {
    appendLog(`[WARN] Download failures: ${result.failures.length} (showing up to 50)`);
    result.failures.forEach((f) => {
      appendLog(`  - ${f.so_don} :: ${f.error}`);
      appendPreviewLine(`[FAIL] ${f.so_don} :: ${f.error}`);
    });
  } else {
    appendLog(`[INFO] Download completed with no failures.`);
  }
}

async function abortDownload() {
  if (!downloadInProgress) {
    appendLog("[WARN] No active download job.");
    return;
  }

  const result = await window.lookupGui.abortDownload();
  if (!result.ok) {
    appendLog(`[WARN] ${result.error}`);
    appendPreviewLine(`[ABORT] ${result.error}`);
    return;
  }

  appendLog("[INFO] Abort requested.");
  appendPreviewLine("[ABORT] Abort requested. Waiting workers to stop...");
}

async function openOutputFolder() {
  const result = await window.lookupGui.openOutputFolder({ path: lastOutputDir || downloadDirInput.value || "" });
  if (!result.ok) {
    appendLog(`[ERR] Open folder failed: ${result.error}`);
    return;
  }
  appendLog(`[INFO] Opened output folder: ${result.path}`);
}

refreshFilesButton.addEventListener("click", refreshSourceFiles);
loadSourceButton.addEventListener("click", loadSelectedSource);
browseSourceDirButton.addEventListener("click", () => browseDirectoryForInput(sourceDirInput));
browseDownloadDirButton.addEventListener("click", () => browseDirectoryForInput(downloadDirInput));
savePathSettingsButton.addEventListener("click", applyPathSettings);
startScrapeButton.addEventListener("click", startMonthlyScrape);
lookupButton.addEventListener("click", runLookup);
downloadButton.addEventListener("click", downloadSelected);
openOutputFolderButton.addEventListener("click", openOutputFolder);
abortDownloadButton.addEventListener("click", abortDownload);

selectAllButton.addEventListener("click", () => {
  const checks = titleList.querySelectorAll("input[type=checkbox][data-title]");
  checks.forEach((x) => {
    x.checked = true;
  });
});

clearSelectionButton.addEventListener("click", () => {
  const checks = titleList.querySelectorAll("input[type=checkbox][data-title]");
  checks.forEach((x) => {
    x.checked = false;
  });
});

clearLogButton.addEventListener("click", () => {
  log.textContent = "";
});

appNoInput.addEventListener("input", () => {
  updateAppNoInputStatus();
});

toggleAutoScrollButton.addEventListener("click", () => {
  previewAutoScroll = !previewAutoScroll;
  toggleAutoScrollButton.textContent = previewAutoScroll ? "Auto Scroll: On" : "Auto Scroll: Off";
});

togglePreviewButton.addEventListener("click", () => {
  previewVisible = !previewVisible;
  preview.classList.toggle("is-hidden", !previewVisible);
  togglePreviewButton.textContent = previewVisible ? "Hide" : "Show";
});

window.lookupGui.onScrapeLog((payload) => {
  const line = String(payload.line || "").trim();
  if (!line) {
    return;
  }
  appendLog(`[SCRAPE] ${line}`);
  appendPreviewLine(`[SCRAPE] ${line}`);
});

window.lookupGui.onScrapeStatus(async (payload) => {
  const state = String(payload.state || "");
  if (state === "started") {
    scrapeInProgress = true;
    startScrapeButton.disabled = true;
    startScrapeButton.textContent = "Scraping...";
    appendLog("[INFO] Scraper process started.");
    return;
  }

  if (state === "finished") {
    scrapeInProgress = false;
    startScrapeButton.disabled = false;
    startScrapeButton.textContent = "Start Monthly Scrape";

    if (payload.ok) {
      appendLog("[INFO] Scraper finished successfully.");
      const unifiedJson = String(payload.sourceJsonFile || "");
      await refreshSourceFiles();
      if (unifiedJson) {
        sourceFileSelect.value = unifiedJson;
      }
      await loadSelectedSource();
      appendLog(`[INFO] Auto-loaded unified source file: ${sourceFileSelect.value}`);
    } else {
      appendLog(`[ERR] Scraper failed (exit code ${payload.code}).`);
    }
  }
});

window.lookupGui.onDownloadLog((payload) => {
  const type = String(payload.type || "");
  const appNo = String(payload.so_don || "").trim() || "(no-app-no)";
  const title = String(payload.source_entry_title || "").trim() || "(no-title)";
  const filePath = String(payload.filePath || "").trim();

  if (type === "check") {
    appendPreviewLine(`[CHECK] ${appNo} | ${title}`);
    return;
  }

  if (type === "try-fetch") {
    appendPreviewLine(`[TRY] ${appNo} | fetch`);
    if (filePath) {
      appendPreviewLine(`      -> ${filePath}`);
    }
    return;
  }

  if (type === "try-fallback") {
    appendPreviewLine(`[TRY] ${appNo} | browser fallback`);
    if (filePath) {
      appendPreviewLine(`      -> ${filePath}`);
    }
    return;
  }

  if (type === "try-chrome") {
    appendPreviewLine(`[TRY] ${appNo} | chrome fallback`);
    if (filePath) {
      appendPreviewLine(`      -> ${filePath}`);
    }
    return;
  }

  if (type === "try-powershell") {
    appendPreviewLine(`[TRY] ${appNo} | powershell fallback`);
    if (filePath) {
      appendPreviewLine(`      -> ${filePath}`);
    }
    return;
  }

  if (type === "skip") {
    appendPreviewLine(`[SKIP] ${appNo} | ${title} | ${payload.reason || "skip"}`);
    if (filePath) {
      appendPreviewLine(`      -> ${filePath}`);
      appendLog(`[SKIP] ${appNo} -> ${filePath}`);
    }
    return;
  }

  if (type === "downloaded") {
    appendPreviewLine(`[OK] ${appNo} | ${title}`);
    if (filePath) {
      appendPreviewLine(`      -> ${filePath}`);
      appendLog(`[DOWNLOADED] ${appNo} -> ${filePath}`);
    }
    return;
  }

  if (type === "failed") {
    const err = String(payload.error || "failed");
    appendPreviewLine(`[FAIL] ${appNo} | ${title} :: ${err}`);
    appendLog(`[FAIL] ${appNo} :: ${err}`);
  }
});

Promise.resolve()
  .then(loadPathSettings)
  .then(refreshSourceFiles)
  .then(loadSelectedSource)
  .then(() => updateAppNoInputStatus())
  .catch((error) => {
    appendLog(`[ERR] Initialization failed: ${error.message}`);
  });
