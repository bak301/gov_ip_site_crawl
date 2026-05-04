const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const BASE_URL =
  "https://ipvietnam.gov.vn/bang-oc-quyen-sang-che/giai-phap-huu-ich-uoc-cap-hang-thang";

const OUTPUT_ROOT = path.join("D:\\", "IPVietnam_Lookup_GUI");
const OUTPUT_DIR = path.join(OUTPUT_ROOT, "source_files");
const PROCESSED_URLS_FILE = path.join(OUTPUT_ROOT, "processed_entry_urls.json");

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function nowStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function sanitizeOutputBaseName(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}

function delimitedEscape(value, delimiter) {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(delimiter) || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toDelimited(rows, headers, delimiter) {
  const lines = [headers.map((h) => delimitedEscape(h, delimiter)).join(delimiter)];
  for (const row of rows) {
    lines.push(headers.map((h) => delimitedEscape(row[h], delimiter)).join(delimiter));
  }
  return lines.join("\n");
}

function toCsv(rows, headers) {
  return toDelimited(rows, headers, ",");
}

function toTsv(rows, headers) {
  return toDelimited(rows, headers, "\t");
}

function buildRowKey(row) {
  return `${row.source_entry_url || ""}||${row.stt || ""}||${row.so_bang || ""}||${row.so_don || ""}`;
}

function createLiveStore(headers) {
  return {
    headers,
    rows: [],
    rowKeys: new Set(),
  };
}

function appendRowsToStore(store, rows) {
  let added = 0;
  for (const row of rows || []) {
    const key = buildRowKey(row);
    if (store.rowKeys.has(key)) {
      continue;
    }
    store.rowKeys.add(key);
    store.rows.push(row);
    added += 1;
  }
  return added;
}

function flushOutputFiles({ csvPath, excelTsvPath, jsonPath }, store) {
  fs.writeFileSync(csvPath, `\uFEFF${toCsv(store.rows, store.headers)}`, "utf-8");
  fs.writeFileSync(excelTsvPath, `\uFEFF${toTsv(store.rows, store.headers)}`, "utf16le");
  fs.writeFileSync(jsonPath, JSON.stringify(store.rows, null, 2), "utf-8");
}

function parseArg(name, defaultValue) {
  const arg = process.argv.find((x) => x.startsWith(`--${name}=`));
  if (!arg) return defaultValue;
  return arg.slice(name.length + 3);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function loadState(statePath) {
  try {
    if (!fs.existsSync(statePath)) {
      return {
        processedEntryUrls: new Set(),
        lastCompletedListingPage: 0,
        entryStats: {},
      };
    }

    const raw = fs.readFileSync(statePath, "utf-8");
    const parsed = JSON.parse(raw);

    // Backward compatibility: old format was just a string[] of URLs.
    if (Array.isArray(parsed)) {
      return {
        processedEntryUrls: new Set(parsed.map((x) => String(x || "").trim()).filter(Boolean)),
        lastCompletedListingPage: 0,
        entryStats: {},
      };
    }

    const urls = Array.isArray(parsed.processedEntryUrls)
      ? parsed.processedEntryUrls.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    return {
      processedEntryUrls: new Set(urls),
      lastCompletedListingPage: Number.parseInt(String(parsed.lastCompletedListingPage || 0), 10) || 0,
      entryStats: parsed && typeof parsed.entryStats === "object" && parsed.entryStats ? parsed.entryStats : {},
    };
  } catch (_error) {
    return {
      processedEntryUrls: new Set(),
      lastCompletedListingPage: 0,
      entryStats: {},
    };
  }
}

function saveState(statePath, state) {
  const sortedUrls = Array.from(state.processedEntryUrls).sort((a, b) => a.localeCompare(b));
  const payload = {
    processedEntryUrls: sortedUrls,
    lastCompletedListingPage: state.lastCompletedListingPage || 0,
    entryStats: state.entryStats || {},
  };
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), "utf-8");
}

function shouldSkipEntry(entry, state) {
  const stats = state.entryStats && state.entryStats[entry.url] ? state.entryStats[entry.url] : null;
  if (!stats) return false;

  const lastRowCount = Number.parseInt(String(stats.lastRowCount || 0), 10) || 0;
  const tableFound = !!stats.tableFound;
  return tableFound && lastRowCount > 0;
}

function getPageNumberFromUrl(urlText) {
  try {
    const u = new URL(urlText);
    const cur = u.searchParams.get("_101_INSTANCE_dpbmUWqCBsSG_cur");
    if (!cur) return 1;
    const n = Number.parseInt(cur, 10);
    return Number.isNaN(n) ? 1 : n;
  } catch (_error) {
    return 1;
  }
}

function withListingPageCursor(urlText, pageNumber) {
  try {
    const u = new URL(urlText);
    u.searchParams.set("_101_INSTANCE_dpbmUWqCBsSG_cur", String(pageNumber));
    return u.toString();
  } catch (_error) {
    return urlText;
  }
}

function logLine(text = "") {
  console.log(text);
}

function logRunConfig({ headless, maxPages, statePath }) {
  logLine("=== IPVietnam Monthly Lookup Scraper ===");
  logLine(`Mode: ${headless ? "headless" : "visible browser"}`);
  logLine(`Max pages: ${maxPages > 0 ? maxPages : "all"}`);
  logLine(`State file: ${statePath}`);
  logLine("----------------------------------------");
}

function logHubStart(pageNumber, hubUrl, entryCount) {
  logLine(`\n[HUB] Page ${pageNumber}`);
  logLine(`[HUB] URL: ${hubUrl}`);
  logLine(`[HUB] Found entries: ${entryCount}`);
}

function logHubEntryFound(index, total, entry) {
  logLine(`  [FOUND ${index}/${total}] ${entry.title}`);
}

function logEntryOpen(index, total, entry, showUrls) {
  logLine(`  [OPEN ${index}/${total}] ${entry.title}`);
  if (showUrls) {
    logLine(`  [CLICK] ${entry.url}`);
  }
}

function logEntryResult(rowCount, tableFound) {
  if (!tableFound) {
    logLine("  [DONE ] No compatible table found on detail page (rows: 0)");
    return;
  }
  logLine(`  [DONE ] Rows extracted: ${rowCount}`);
}

function logNextPage(currentPage, nextPageUrl) {
  if (nextPageUrl) {
    logLine(`[HUB] Moving from page ${currentPage} -> next page via Tiếp theo`);
    logLine(`[HUB] Next URL: ${nextPageUrl}`);
  } else {
    logLine(`[HUB] No Tiếp theo link available after page ${currentPage}. Stopping.`);
  }
}

async function launchBrowserWithFallback({ headless, executablePath }) {
  const common = {
    headless,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };

  const attempts = [];

  if (executablePath) {
    attempts.push({ ...common, executablePath });
  }

  // Default Puppeteer-managed browser
  attempts.push({ ...common });

  // Fallbacks to locally installed browsers on Windows
  attempts.push({ ...common, channel: "chrome" });
  attempts.push({ ...common, channel: "msedge" });

  let lastError = null;
  for (const options of attempts) {
    try {
      const browser = await puppeteer.launch(options);
      return browser;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to launch a Chromium browser.");
}

async function extractListingPageData(page) {
  return page.evaluate(() => {
    function normalizeText(s) {
      return String(s || "").replace(/\s+/g, " ").trim();
    }

    function latinize(s) {
      return normalizeText(s)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    }

    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const entryLinks = [];
    const seen = new Set();

    for (const a of anchors) {
      const text = normalizeText(a.textContent);
      const href = a.getAttribute("href") || "";
      const textNorm = latinize(text);
      const hrefNorm = href.toLowerCase();

      if (!text) continue;
      const looksLikeEntryText =
        textNorm.includes("danh sach bang oc quyen") &&
        (textNorm.includes("sang che") || textNorm.includes("giai phap huu ich") || textNorm.includes("gphi"));
      const looksLikeEntryHref =
        hrefNorm.includes("/content/") &&
        (hrefNorm.includes("danh-sach-bang-oc-quyen") || hrefNorm.includes("giai-phap-huu-ich"));

      if (!looksLikeEntryText && !looksLikeEntryHref) continue;

      let abs = "";
      try {
        abs = new URL(href, location.origin).href;
      } catch (_error) {
        continue;
      }

      if (seen.has(abs)) continue;
      seen.add(abs);
      entryLinks.push({ title: text, url: abs });
    }

    let nextPageUrl = null;
    let currentPageNumber = null;

    const activePageAnchor = document.querySelector("ul.pager li.active a");
    if (activePageAnchor) {
      const pageText = normalizeText(activePageAnchor.textContent);
      const num = Number.parseInt(pageText, 10);
      if (!Number.isNaN(num)) {
        currentPageNumber = num;
      }
    }

    if (!currentPageNumber) {
      try {
        const byQuery = new URL(location.href).searchParams.get("_101_INSTANCE_dpbmUWqCBsSG_cur");
        const num = Number.parseInt(byQuery || "1", 10);
        currentPageNumber = Number.isNaN(num) ? 1 : num;
      } catch (_error) {
        currentPageNumber = 1;
      }
    }
    for (const a of anchors) {
      const text = normalizeText(a.textContent).toLowerCase();
      if (text !== "tiếp theo" && text !== "tiep theo") {
        continue;
      }

      const parentClass = (a.parentElement && a.parentElement.className) || "";
      const selfClass = a.className || "";
      const disabledLike = /disabled|unavailable/i.test(`${parentClass} ${selfClass}`);
      if (disabledLike) continue;

      try {
        nextPageUrl = new URL(a.getAttribute("href"), location.origin).href;
      } catch (_error) {
        nextPageUrl = null;
      }
      break;
    }

    return { entryLinks, nextPageUrl, currentPageNumber };
  });
}

async function scrapeEntryRows(browser, entry) {
  const detailPage = await browser.newPage();
  detailPage.setDefaultNavigationTimeout(120000);

  try {
    await detailPage.goto(entry.url, { waitUntil: "networkidle2", timeout: 120000 });
    await detailPage.waitForSelector("table", { timeout: 45000 });

    return await detailPage.evaluate((entryData) => {
    function txt(el) {
      return (el ? el.textContent : "")?.replace(/\s+/g, " ").trim() || "";
    }

    function normalizeApplicationNo(value) {
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

    const pageTitle = txt(
      document.querySelector("h1") ||
        document.querySelector(".portlet-title-text") ||
        document.querySelector(".asset-title")
    );

    const allTables = Array.from(document.querySelectorAll("table"));
    let targetTable = null;
    let detectedHeaders = [];

    const normalizeHeaderCells = (table) => {
      const firstRows = Array.from(table.querySelectorAll("tr")).slice(0, 2);
      const cells = firstRows.flatMap((tr) => Array.from(tr.querySelectorAll("th, td")));
      return cells.map((c) => txt(c).toLowerCase()).filter(Boolean);
    };

    for (const table of allTables) {
      const ths = normalizeHeaderCells(table);
      if (
        ths.some((h) => h.includes("số bằng") || h.includes("so bang")) &&
        ths.some((h) => h.includes("số đơn") || h.includes("so don"))
      ) {
        targetTable = table;
        detectedHeaders = ths;
        break;
      }
    }

    if (!targetTable) {
      return { pageTitle, rows: [], tableFound: false, headers: [] };
    }

    const headerRow = targetTable.querySelector("tr");
    let headers = headerRow
      ? Array.from(headerRow.querySelectorAll("th, td")).map((th) => txt(th).toLowerCase())
      : [];

    if (headers.length === 0 && detectedHeaders.length > 0) {
      headers = detectedHeaders;
    }

    const getIndex = (patterns) => {
      for (let i = 0; i < headers.length; i += 1) {
        const h = headers[i];
        if (patterns.some((p) => h.includes(p))) {
          return i;
        }
      }
      return -1;
    };

    const idxSTT = getIndex(["stt"]);
    const idxSoBang = getIndex(["số bằng", "so bang"]);
    const idxSoDon = getIndex(["số đơn", "so don"]);
    const idxTen = getIndex(["tên sc", "ten sc", "tên gphi", "ten gphi"]);
    const idxChuVB = getIndex(["tên chủ văn bằng", "ten chu van bang"]);

    const records = [];
    const allRows = Array.from(targetTable.querySelectorAll("tr"));
    const bodyRows = allRows.slice(1);

    for (const tr of bodyRows) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length < 3) continue;

      const soBangCell = idxSoBang >= 0 ? tds[idxSoBang] : null;
      const soBangAnchor = soBangCell ? soBangCell.querySelector("a[href]") : null;

      records.push({
        stt: idxSTT >= 0 ? txt(tds[idxSTT]) : txt(tds[0]),
        so_bang: idxSoBang >= 0 ? txt(tds[idxSoBang]) : "",
        so_don: idxSoDon >= 0 ? normalizeApplicationNo(txt(tds[idxSoDon])) : "",
        ten_sc_gphi: idxTen >= 0 ? txt(tds[idxTen]) : "",
        ten_chu_van_bang: idxChuVB >= 0 ? txt(tds[idxChuVB]) : "",
        so_bang_pdf_url: soBangAnchor ? soBangAnchor.href : "",
        source_entry_title: entryData.title || pageTitle,
        source_entry_url: entryData.url,
      });
    }

    return { pageTitle, rows: records, tableFound: true, headers };
    }, entry);
  } finally {
    await detailPage.close();
  }
}

async function getNextPageUrlFromHub(hubPage) {
  return hubPage.evaluate(() => {
    function normalizeText(s) {
      return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    const anchors = Array.from(document.querySelectorAll("ul.pager a[href], .lfr-pagination-buttons a[href], a[href]"));

    for (const a of anchors) {
      const t = normalizeText(a.textContent);
      if (t !== "tiếp theo" && t !== "tiep theo") {
        continue;
      }

      const parentClass = (a.parentElement && a.parentElement.className) || "";
      const selfClass = a.className || "";
      const disabledLike = /disabled|unavailable|inactive/i.test(`${parentClass} ${selfClass}`);
      if (disabledLike) {
        return null;
      }

      try {
        return new URL(a.getAttribute("href"), location.origin).href;
      } catch (_error) {
        return null;
      }
    }

    return null;
  });
}

async function runMonthlyLookupCrawler(options = {}) {
  const headedByFlag = hasFlag("-h") || hasFlag("--h") || hasFlag("--headed");
  const headless =
    typeof options.headless === "boolean"
      ? options.headless
      : headedByFlag
        ? false
        : String(parseArg("headless", "true")).toLowerCase() !== "false";
  const maxPages =
    typeof options.maxPages === "number"
      ? options.maxPages
      : Number.parseInt(parseArg("max-pages", "0"), 10) || 0;
  const executablePath = options.executablePath || parseArg("browser-path", "");
  const statePath = options.statePath || parseArg("state-file", PROCESSED_URLS_FILE);
  const showUrls =
    typeof options.showUrls === "boolean"
      ? options.showUrls
      : String(parseArg("show-urls", "false")).toLowerCase() === "true";
  const singleOutput =
    typeof options.singleOutput === "boolean"
      ? options.singleOutput
      : String(parseArg("single-output", "false")).toLowerCase() === "true";
  const outputBaseName =
    typeof options.outputBaseName === "string"
      ? options.outputBaseName
      : parseArg("output-base", "");

  ensureOutputDir();
  const stamp = nowStamp();
  const resolvedBaseName = singleOutput
    ? sanitizeOutputBaseName(outputBaseName) || "ipvietnam_monthly_lookup_unified"
    : `ipvietnam_monthly_lookup_${stamp}`;
  const csvPath = path.join(OUTPUT_DIR, `${resolvedBaseName}.csv`);
  const excelTsvPath = path.join(OUTPUT_DIR, `${resolvedBaseName}.excel.tsv`);
  const jsonPath = path.join(OUTPUT_DIR, `${resolvedBaseName}.json`);

  const headers = [
    "stt",
    "so_bang",
    "so_don",
    "ten_sc_gphi",
    "ten_chu_van_bang",
    "so_bang_pdf_url",
    "source_entry_title",
    "source_entry_url",
  ];

  const liveStore = createLiveStore(headers);
  flushOutputFiles({ csvPath, excelTsvPath, jsonPath }, liveStore);
  logLine("[LIVE] Output files initialized (empty schema written).");
  logLine(`[LIVE] Unified file mode: ${singleOutput ? "ON" : "OFF"}`);

  const browser = await launchBrowserWithFallback({ headless, executablePath });

  const hubPage = await browser.newPage();
  hubPage.setDefaultNavigationTimeout(120000);

  const visitedListingPages = new Set();
  const state = loadState(statePath);
  const processedEntryUrls = state.processedEntryUrls;
  const visitedEntriesThisRun = new Set();
  const allRows = [];

  logRunConfig({ headless, maxPages, statePath });
  logLine(`Loaded processed entry URLs: ${processedEntryUrls.size}`);
  logLine(`Last completed listing page: ${state.lastCompletedListingPage}`);

  try {
    let currentListingUrl = BASE_URL;
    let pageCounter = 0;

    if (state.lastCompletedListingPage > 1) {
      currentListingUrl = withListingPageCursor(BASE_URL, state.lastCompletedListingPage + 1);
      logLine(`Resuming from listing page ${state.lastCompletedListingPage + 1}`);
    }

    while (currentListingUrl) {
      if (visitedListingPages.has(currentListingUrl)) {
        break;
      }
      if (maxPages > 0 && pageCounter >= maxPages) {
        break;
      }

      visitedListingPages.add(currentListingUrl);
      pageCounter += 1;

      await hubPage.goto(currentListingUrl, { waitUntil: "domcontentloaded", timeout: 120000 });

      const { entryLinks, currentPageNumber } = await extractListingPageData(hubPage);
      const effectivePageNumber = currentPageNumber || getPageNumberFromUrl(currentListingUrl);
      logHubStart(effectivePageNumber, currentListingUrl, entryLinks.length);

      entryLinks.forEach((entry, idx) => {
        logHubEntryFound(idx + 1, entryLinks.length, entry);
      });

      const allEntriesAlreadyProcessed =
        entryLinks.length > 0 && entryLinks.every((entry) => shouldSkipEntry(entry, state));

      let pageProcessed = 0;
      let pageSkipped = 0;
      let pageFailed = 0;
      let pageZeroRows = 0;

      if (allEntriesAlreadyProcessed) {
        pageSkipped = entryLinks.length;
        logLine(`[HUB] All entries on page ${effectivePageNumber} already processed. Skipping page.`);
        logLine(`[HUB] Page ${effectivePageNumber} summary: processed=0, skipped=${pageSkipped}, zeroRows=0, failed=0`);
        if (effectivePageNumber > state.lastCompletedListingPage) {
          state.lastCompletedListingPage = effectivePageNumber;
          saveState(statePath, state);
        }
        currentListingUrl = await getNextPageUrlFromHub(hubPage);
        logNextPage(effectivePageNumber, currentListingUrl);
        continue;
      }

      for (let idx = 0; idx < entryLinks.length; idx += 1) {
        const entry = entryLinks[idx];
        if (visitedEntriesThisRun.has(entry.url)) {
          logLine(`  [SKIP ] Already processed in this run: ${entry.title}`);
          pageSkipped += 1;
          continue;
        }

        if (shouldSkipEntry(entry, state)) {
          const saved = state.entryStats[entry.url]?.lastRowCount || 0;
          logLine(`  [SKIP ] Already scraped with table rows=${saved}: ${entry.title}`);
          if (showUrls) {
            logLine(`  [URL ] ${entry.url}`);
          }
          pageSkipped += 1;
          visitedEntriesThisRun.add(entry.url);
          continue;
        }

        try {
          logEntryOpen(idx + 1, entryLinks.length, entry, showUrls);
          const result = await scrapeEntryRows(browser, entry);
          logEntryResult(result.rows.length, result.tableFound);
          allRows.push(...result.rows);

          const added = appendRowsToStore(liveStore, result.rows);
          if (added > 0) {
            flushOutputFiles({ csvPath, excelTsvPath, jsonPath }, liveStore);
            logLine(`  [LIVE ] Added ${added} rows, total ${liveStore.rows.length}`);
          } else {
            logLine(`  [LIVE ] No new rows, total ${liveStore.rows.length}`);
          }
          pageProcessed += 1;
          if (!result.tableFound || result.rows.length === 0) {
            pageZeroRows += 1;
          }
          visitedEntriesThisRun.add(entry.url);
          processedEntryUrls.add(entry.url);

          state.entryStats[entry.url] = {
            title: entry.title,
            lastRowCount: result.rows.length,
            tableFound: !!result.tableFound,
            updatedAt: new Date().toISOString(),
          };

          saveState(statePath, state);
        } catch (error) {
          console.warn(`  [FAIL ] ${entry.url} :: ${error.message}`);
          pageFailed += 1;
        }
      }

      logLine(
        `[HUB] Page ${effectivePageNumber} summary: processed=${pageProcessed}, skipped=${pageSkipped}, zeroRows=${pageZeroRows}, failed=${pageFailed}`
      );

      if (effectivePageNumber > state.lastCompletedListingPage) {
        state.lastCompletedListingPage = effectivePageNumber;
        saveState(statePath, state);
      }

      currentListingUrl = await getNextPageUrlFromHub(hubPage);
      logNextPage(effectivePageNumber, currentListingUrl);
    }
  } finally {
    await hubPage.close();
    await browser.close();
  }

  // Final flush to ensure outputs are in sync.
  flushOutputFiles({ csvPath, excelTsvPath, jsonPath }, liveStore);
  saveState(statePath, state);

  logLine("\n=== Completed ===");
  logLine(`Rows: ${liveStore.rows.length}`);
  logLine(`CSV: ${csvPath}`);
  logLine(`Excel TSV (UTF-16LE): ${excelTsvPath}`);
  logLine(`JSON: ${jsonPath}`);
  logLine(`Processed URL state: ${statePath}`);

  return {
    rows: liveStore.rows.length,
    csvPath,
    excelTsvPath,
    jsonPath,
    statePath,
  };
}

module.exports = {
  runMonthlyLookupCrawler,
};

if (require.main === module) {
  runMonthlyLookupCrawler().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
