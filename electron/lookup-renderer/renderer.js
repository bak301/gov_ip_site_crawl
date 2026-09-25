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
const downloadDrawer = document.getElementById("downloadDrawer");
const downloadDrawerBackdrop = document.getElementById("downloadDrawerBackdrop");
const closeDownloadDrawerButton = document.getElementById("closeDownloadDrawerButton");
const drawerDownloadDirInput = document.getElementById("drawerDownloadDirInput");
const drawerBrowseDownloadDirButton = document.getElementById("drawerBrowseDownloadDirButton");
const drawerSelectAllButton = document.getElementById("drawerSelectAllButton");
const drawerClearSelectionButton = document.getElementById("drawerClearSelectionButton");
const drawerStats = document.getElementById("drawerStats");
const drawerTableBody = document.getElementById("drawerTableBody");
const drawerRunDownloadButton = document.getElementById("drawerRunDownloadButton");

let currentTitleCounts = [];
let previewAutoScroll = true;
let previewVisible = true;
let downloadInProgress = false;
let scrapeInProgress = false;
let lastOutputDir = "";
let currentSourceDir = "";
let currentDownloadDir = "";
const APP_NO_PATTERN = /^[12]-\d{4}-\d{5,}$/;
const LOOKUP_GUI_STATE_KEY = "lookupGuiStateV1";

let drawerMatches = [];
let lastDrawerStats = {};

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

function saveGuiState() {
  const payload = {
    appNoInput: String(appNoInput && appNoInput.value ? appNoInput.value : ""),
    sourceDir: String(sourceDirInput && sourceDirInput.value ? sourceDirInput.value : ""),
    downloadDir: String(downloadDirInput && downloadDirInput.value ? downloadDirInput.value : ""),
    drawerDownloadDir: String(drawerDownloadDirInput && drawerDownloadDirInput.value ? drawerDownloadDirInput.value : ""),
    sourceFile: String(sourceFileSelect && sourceFileSelect.value ? sourceFileSelect.value : ""),
  };
  try {
    localStorage.setItem(LOOKUP_GUI_STATE_KEY, JSON.stringify(payload));
  } catch (_error) {
    // Ignore state write failures.
  }
}

function loadGuiState() {
  try {
    const raw = localStorage.getItem(LOOKUP_GUI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function openDownloadDrawer() {
  if (!downloadDrawer || !downloadDrawerBackdrop) {
    throw new Error("Download drawer elements are missing from renderer HTML.");
  }
  downloadDrawer.classList.remove("is-hidden");
  downloadDrawerBackdrop.classList.remove("is-hidden");
  downloadDrawer.setAttribute("aria-hidden", "false");
}

function closeDownloadDrawer() {
  if (!downloadDrawer || !downloadDrawerBackdrop) {
    return;
  }
  downloadDrawer.classList.add("is-hidden");
  downloadDrawerBackdrop.classList.add("is-hidden");
  downloadDrawer.setAttribute("aria-hidden", "true");
}

function getSelectedDrawerMatchKeys() {
  const checks = drawerTableBody.querySelectorAll('input[type="checkbox"][data-match-key]');
  return Array.from(checks)
    .filter((x) => x.checked && !x.disabled)
    .map((x) => String(x.dataset.matchKey || ""))
    .filter(Boolean);
}

function updateDrawerStats(stats = null) {
  if (stats && typeof stats === "object") {
    lastDrawerStats = { ...stats };
  }
  const viewStats = (lastDrawerStats && typeof lastDrawerStats === "object") ? lastDrawerStats : {};

  const checkedCount = getSelectedDrawerMatchKeys().length;
  const selectableCount = drawerMatches.filter((match) => {
    const isMissingInSource = Boolean(match && match.missingInSource);
    const hasKey = String(match && match.matchKey ? match.matchKey : "").length > 0;
    return !isMissingInSource && hasKey;
  }).length;

  const lines = [
    `Rows in table: ${drawerMatches.length}`,
    `Selected rows: ${checkedCount}`,
    `Selectable rows: ${selectableCount}`,
    `Found in source file: ${viewStats.manualFoundInSourceCount || 0}`,
    `Matched in Lookup.tsv: ${viewStats.manualMatchedCount || 0}`,
    `Missing from source file: ${viewStats.manualMissingInSourceCount || 0}`,
    `Missing from Lookup.tsv: ${viewStats.manualMissingInLookupCount || 0}`,
  ];

  if (selectableCount === 0) {
    lines.push("No selectable rows. Rows marked Missing from source are read-only.");
  }

  drawerStats.textContent = lines.join("\n");

  if (drawerRunDownloadButton) {
    drawerRunDownloadButton.disabled = checkedCount === 0;
  }
}

function renderDrawerRows(matches, stats = {}) {
  lastDrawerStats = (stats && typeof stats === "object") ? { ...stats } : {};
  const sourceMatches = Array.isArray(matches) ? matches : [];
  const missingInSource = Array.isArray(stats.manualMissingInSource) ? stats.manualMissingInSource : [];

  drawerMatches = [
    ...sourceMatches,
    ...missingInSource.map((appNo) => ({
      so_don: appNo,
      so_bang: "",
      caseRef: "",
      attorney: "",
      status: "",
      source_entry_title: "Not found in source file",
      lookupMatched: false,
      missingInSource: true,
      matchKey: "",
    })),
  ];

  drawerTableBody.innerHTML = "";

  drawerMatches.forEach((match) => {
    const isMissingInSource = Boolean(match.missingInSource);
    const isLookupUnmatched = !isMissingInSource && !Boolean(match.lookupMatched);
    const selectable = !isMissingInSource && String(match.matchKey || "").length > 0;

    const tr = document.createElement("tr");
    if (!selectable) {
      tr.classList.add("is-row-disabled");
    }

    const tdCheck = document.createElement("td");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = selectable;
    check.disabled = !selectable;
    check.dataset.matchKey = String(match.matchKey || "");
    check.addEventListener("change", () => updateDrawerStats(stats));
    tdCheck.appendChild(check);

    const fields = [
      String(match.so_don || ""),
      String(match.so_bang || ""),
      String(match.caseRef || ""),
      String(match.attorney || ""),
      isMissingInSource ? "Missing from source" : (isLookupUnmatched ? "Missing in Lookup.tsv" : String(match.status || "")),
      String(match.source_entry_title || ""),
    ];

    tr.appendChild(tdCheck);
    fields.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });

    drawerTableBody.appendChild(tr);
  });

  updateDrawerStats(lastDrawerStats);
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
  if (!drawerDownloadDirInput.value) {
    drawerDownloadDirInput.value = currentDownloadDir;
  }
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
  if (!String(drawerDownloadDirInput.value || "").trim()) {
    drawerDownloadDirInput.value = currentDownloadDir;
  }
  saveGuiState();

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

async function prepareDownloadDrawer() {
  try {
    const fileName = sourceFileSelect.value;
    const analyzed = analyzeManualAppNos();
    const manualAppNos = analyzed.validUnique;

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

    appendLog(`[DOWNLOAD] Preparing drawer for ${manualAppNos.length} valid App Nos...`);
    const result = await window.lookupGui.lookupMatches({ fileName, selectedTitles: [], manualAppNos });
    if (!result.ok) {
      appendLog(`[ERR] ${result.error}`);
      return;
    }

    const allMatches = Array.isArray(result.matches) ? result.matches : (result.preview || []);
    renderDrawerRows(allMatches, result.stats || {});

    if (!drawerDownloadDirInput) {
      throw new Error("Drawer download directory input is missing from renderer HTML.");
    }

    if (!String(drawerDownloadDirInput.value || "").trim()) {
      drawerDownloadDirInput.value = String(downloadDirInput.value || currentDownloadDir || "");
    }
    saveGuiState();
    openDownloadDrawer();
  } catch (error) {
    appendLog(`[ERR] Download drawer open failed: ${error.message || String(error)}`);
  }
}

async function downloadSelected() {
  const fileName = sourceFileSelect.value;
  const analyzed = analyzeManualAppNos();
  const manualAppNos = analyzed.validUnique;
  const selectedMatchKeys = getSelectedDrawerMatchKeys();
  const downloadDir = String(drawerDownloadDirInput.value || downloadDirInput.value || "").trim();

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

  if (selectedMatchKeys.length === 0) {
    appendLog("[WARN] Select at least one row in the download drawer.");
    return;
  }

  appendLog(`[DOWNLOAD] Starting download for ${selectedMatchKeys.length} selected rows (from ${manualAppNos.length} App Nos)...`);
  clearPreview();
  appendPreviewLine(`[DOWNLOAD] Started (selectedRows=${selectedMatchKeys.length}, appNos=${manualAppNos.length})...`);
  downloadInProgress = true;
  abortDownloadButton.disabled = false;
  downloadButton.disabled = true;
  drawerRunDownloadButton.disabled = true;

  let result;
  try {
    result = await window.lookupGui.downloadMatches({
      fileName,
      selectedTitles: [],
      manualAppNos,
      selectedMatchKeys,
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
    drawerRunDownloadButton.disabled = false;
  }

  if (!result.ok) {
    appendLog(`[ERR] ${result.error}`);
    appendPreviewLine(`[ERROR] ${result.error}`);
    return;
  }

  setSummary([
    `Total matches: ${result.totalMatches}`,
    `Requested matches before selection: ${result.requestedMatches || 0}`,
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
    `Aggregate copy folder: ${result.aggregateDir || ""}`,
    `Aggregate copies written: ${result.aggregateCopied || 0}`,
  ].filter(Boolean));

  appendPreviewLine(`[DOWNLOAD] Done. Downloaded=${result.downloaded}, New=${result.downloadedNew || 0}, Skipped=${result.skippedExisting || 0}, Failed=${result.failed}, Cancelled=${result.cancelled || 0}`);
  appendPreviewLine(`[OUTPUT] ${result.outputDir}`);
  appendPreviewLine(`[AGGREGATE] ${result.aggregateDir || ""}`);
  lastOutputDir = String(result.outputDir || "");
  closeDownloadDrawer();

  if (Array.isArray(result.aggregateCopyErrors) && result.aggregateCopyErrors.length > 0) {
    appendLog(`[WARN] Aggregate copy errors: ${result.aggregateCopyErrors.length} (showing up to 50)`);
    result.aggregateCopyErrors.forEach((line) => appendLog(`  - ${line}`));
  }

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
downloadButton.addEventListener("click", prepareDownloadDrawer);
openOutputFolderButton.addEventListener("click", openOutputFolder);
abortDownloadButton.addEventListener("click", abortDownload);
if (closeDownloadDrawerButton) {
  closeDownloadDrawerButton.addEventListener("click", closeDownloadDrawer);
}

if (downloadDrawerBackdrop) {
  downloadDrawerBackdrop.addEventListener("click", closeDownloadDrawer);
}

if (drawerBrowseDownloadDirButton && drawerDownloadDirInput) {
  drawerBrowseDownloadDirButton.addEventListener("click", async () => {
    await browseDirectoryForInput(drawerDownloadDirInput);
    saveGuiState();
  });
}
if (drawerSelectAllButton) {
  drawerSelectAllButton.addEventListener("click", () => {
    const checks = drawerTableBody.querySelectorAll('input[type="checkbox"][data-match-key]');
    checks.forEach((x) => {
      if (x.disabled) {
        x.checked = false;
        return;
      }
      x.checked = true;
    });
    updateDrawerStats();
  });
}

if (drawerClearSelectionButton) {
  drawerClearSelectionButton.addEventListener("click", () => {
    const checks = drawerTableBody.querySelectorAll('input[type="checkbox"][data-match-key]');
    checks.forEach((x) => {
      x.checked = false;
    });
    updateDrawerStats();
  });
}

if (drawerRunDownloadButton) {
  drawerRunDownloadButton.addEventListener("click", downloadSelected);
}

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
  saveGuiState();
});

sourceFileSelect.addEventListener("change", saveGuiState);
sourceDirInput.addEventListener("change", saveGuiState);
downloadDirInput.addEventListener("change", saveGuiState);
drawerDownloadDirInput.addEventListener("change", saveGuiState);

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
  .then(() => {
    const saved = loadGuiState();
    if (saved) {
      if (typeof saved.appNoInput === "string") {
        appNoInput.value = saved.appNoInput;
      }
      if (typeof saved.drawerDownloadDir === "string" && saved.drawerDownloadDir.trim()) {
        drawerDownloadDirInput.value = saved.drawerDownloadDir.trim();
      }
    }
  })
  .then(loadPathSettings)
  .then(refreshSourceFiles)
  .then(() => {
    const saved = loadGuiState();
    if (saved && typeof saved.sourceFile === "string" && saved.sourceFile.trim()) {
      const found = Array.from(sourceFileSelect.options).some((opt) => opt.value === saved.sourceFile);
      if (found) {
        sourceFileSelect.value = saved.sourceFile;
      }
    }
  })
  .then(loadSelectedSource)
  .then(() => {
    if (!String(drawerDownloadDirInput.value || "").trim()) {
      drawerDownloadDirInput.value = String(downloadDirInput.value || "");
    }
    updateAppNoInputStatus();
    saveGuiState();
  })
  .catch((error) => {
    appendLog(`[ERR] Initialization failed: ${error.message}`);
  });
