const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const readline = require("readline");
const {
  normalizeMadridInput,
  isMadridId,
  parseMadridXml,
  fetchMadridXml,
} = require("./madrid_monitor");
const { inspectWipoResponse } = require("./wipo_response_validation");
const { splitStructuredColumns } = require("./wipo_structured_columns");
const { parseApplicantHistory } = require("../electron-app/wipo_applicant_history");

// Workaround for WIPO certificate-chain issues on some environments.
// Set WIPO_ALLOW_INSECURE_TLS=0 to disable this behavior.
const allowInsecureTls = process.env.WIPO_ALLOW_INSECURE_TLS !== "0";
if (allowInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

let insecureTlsDispatcher = null;
if (allowInsecureTls) {
  try {
    const { Agent } = require("undici");
    insecureTlsDispatcher = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    });
  } catch (error) {
    // Keep env-based fallback when undici import is unavailable.
  }
}

// Global script start time
const globalStartTime = Date.now();

// === PRESET MANAGEMENT SYSTEM ===
const PRESETS_FILE = path.join(__dirname, "presets.json");

// Load presets from file
function loadPresets() {
  try {
    if (fs.existsSync(PRESETS_FILE)) {
      const data = fs.readFileSync(PRESETS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading presets:", error.message);
  }
  
  // Return default presets if file doesn't exist or error occurs
  return {
    presets: [
      {
        name: "Balanced (Default)",
        THREAD_COUNT: 5,
        RETRY_LIMIT: 30,
        MAX_REATTEMPTS: 15,
        MAX_CONCURRENT_REQUESTS: 3,
        BETWEEN_REQUEST: 2000,
        RETRY_DELAY_BASE: 1000,
        REQUEST_TIMEOUT: 30000
      }
    ]
  };
}

// Save preset to file
function savePreset(preset) {
  const data = loadPresets();
  data.presets.push(preset);
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(data, null, 2), "utf-8");
  console.log(`\x1b[32m✓ Preset "${preset.name}" saved successfully!\x1b[0m\n`);
}

// Prompt user for input
function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parsePresetIndexFromArgs() {
  const eqArg = process.argv.find((arg) => String(arg).startsWith("--preset-index="));
  if (eqArg) {
    const value = Number.parseInt(eqArg.split("=")[1], 10);
    return Number.isNaN(value) ? null : value;
  }

  const keyIndex = process.argv.findIndex((arg) => String(arg) === "--preset-index");
  if (keyIndex >= 0 && keyIndex + 1 < process.argv.length) {
    const value = Number.parseInt(String(process.argv[keyIndex + 1]), 10);
    return Number.isNaN(value) ? null : value;
  }

  return null;
}

function parseRetryCountFromArgs() {
  const eqArg = process.argv.find((arg) => String(arg).startsWith("--retry-count="));
  const keyIndex = process.argv.findIndex((arg) => String(arg) === "--retry-count");
  const raw = eqArg ? eqArg.split("=")[1] : (keyIndex >= 0 ? process.argv[keyIndex + 1] : null);
  if (raw === null || raw === undefined) return null;
  const value = Number.parseInt(String(raw), 10);
  return Number.isNaN(value) ? null : Math.min(50, Math.max(0, value));
}

function getPresetByIndex(presetIndex) {
  const data = loadPresets();
  const presets = Array.isArray(data.presets) ? data.presets : [];
  if (presets.length === 0) {
    return null;
  }

  if (!Number.isInteger(presetIndex) || presetIndex < 1 || presetIndex > presets.length) {
    return null;
  }

  return presets[presetIndex - 1];
}

// Display presets and get user selection
async function promptPresetSelection() {
  const data = loadPresets();
  const presets = data.presets;
  
  console.log("\n\x1b[1m\x1b[36m=== Configuration Preset Selection ===\x1b[0m\n");
  
  // Display available presets
  presets.forEach((preset, index) => {
    console.log(`\x1b[33m${index + 1}.\x1b[0m ${preset.name}`);
    console.log(`   Threads: ${preset.THREAD_COUNT} | Max Retries: ${preset.RETRY_LIMIT} | Re-attempts: ${preset.MAX_REATTEMPTS}`);
    console.log(`   Delay: ${preset.BETWEEN_REQUEST}ms | Concurrent: ${preset.MAX_CONCURRENT_REQUESTS}`);
    console.log("");
  });
  
  console.log(`\x1b[33m${presets.length + 1}.\x1b[0m \x1b[32m[Create New Preset]\x1b[0m\n`);
  
  // Get user choice
  const choice = await promptUser(`Enter preset number (1-${presets.length + 1}): `);
  const choiceNum = parseInt(choice);
  
  if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > presets.length + 1) {
    console.log("\x1b[31mInvalid choice. Using default preset.\x1b[0m\n");
    return presets[0];
  }
  
  // If user chose to create new preset
  if (choiceNum === presets.length + 1) {
    return await promptNewPreset();
  }
  
  // Return selected preset
  const selectedPreset = presets[choiceNum - 1];
  console.log(`\x1b[32m✓ Selected: ${selectedPreset.name}\x1b[0m\n`);
  return selectedPreset;
}

// Prompt user to create new preset
async function promptNewPreset() {
  console.log("\n\x1b[1m\x1b[36m=== Create New Preset ===\x1b[0m\n");
  
  const name = await promptUser("Preset name: ");
  
  console.log("\n\x1b[90mEnter configuration values (press Enter for suggested defaults):\x1b[0m\n");
  
  const threadCount = await promptUser("Thread count [5]: ") || "5";
  const retryLimit = await promptUser("Retry limit (global passes) [30]: ") || "30";
  const maxReattempts = await promptUser("Max re-attempts per ID [15]: ") || "15";
  const maxConcurrent = await promptUser("Max concurrent requests [3]: ") || "3";
  const betweenRequest = await promptUser("Delay between requests (ms) [2000]: ") || "2000";
  const retryDelayBase = await promptUser("Retry delay base (ms) [1000]: ") || "1000";
  const requestTimeout = await promptUser("Request timeout (ms) [30000]: ") || "30000";
  
  const preset = {
    name: name || "Custom Preset",
    THREAD_COUNT: parseInt(threadCount),
    RETRY_LIMIT: parseInt(retryLimit),
    MAX_REATTEMPTS: parseInt(maxReattempts),
    MAX_CONCURRENT_REQUESTS: parseInt(maxConcurrent),
    BETWEEN_REQUEST: parseInt(betweenRequest),
    RETRY_DELAY_BASE: parseInt(retryDelayBase),
    REQUEST_TIMEOUT: parseInt(requestTimeout)
  };
  
  const saveChoice = await promptUser("\nSave this preset for future use? (y/n) [y]: ") || "y";
  
  if (saveChoice.toLowerCase() === 'y' || saveChoice.toLowerCase() === 'yes') {
    savePreset(preset);
  }
  
  console.log(`\x1b[32m✓ Using preset: ${preset.name}\x1b[0m\n`);
  return preset;
}

// Apply preset values to config object
function applyPresetToConfig(preset) {
  config.THREAD_COUNT = preset.THREAD_COUNT;
  config.RETRY_LIMIT = preset.RETRY_LIMIT;
  config.MAX_REATTEMPTS = preset.MAX_REATTEMPTS;
  config.MAX_CONCURRENT_REQUESTS = preset.MAX_CONCURRENT_REQUESTS;
  config.delay.BETWEEN_REQUEST = preset.BETWEEN_REQUEST;
  config.delay.RETRY_DELAY_BASE = preset.RETRY_DELAY_BASE;
  config.timeout.REQUEST_TIMEOUT = preset.REQUEST_TIMEOUT;
}

// Simple clean logging system
let isCleanLogging = false;
let lastLogLines = 0; // Track number of status lines to clear

function clearLastLog() {
  // Clear the last 3 lines (time, stats, config), keep the ID lines visible
  const linesToClear = 3;
  if (lastLogLines > 0) {
    // Move cursor up and clear only the last 3 lines
    process.stdout.write(`\x1b[${linesToClear}A`);
    for (let i = 0; i < linesToClear; i++) {
      process.stdout.write('\x1b[2K\x1b[1B');
    }
    process.stdout.write(`\x1b[${linesToClear}A`);
    lastLogLines = 0;
  }
}

function logProgress(currentIndex, totalIDs, currentID, reattempt, status, isError = false, requestDuration = 0, elapsedTime = 0) {
  if (!isCleanLogging) return;
  
  // Clear previous status lines before adding new content
  clearLastLog();
  
  const statusColor = isError ? '\x1b[31m' : '\x1b[32m'; // Red for error, green for success
  const now = new Date();
  const currentTime = now.toLocaleString("vi-VN", {
    day: '2-digit',
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  // Calculate total elapsed time since script started
  const totalElapsedTimeSeconds = Math.floor((Date.now() - globalStartTime) / 1000);
  
  // Convert seconds to human-readable format
  const hours = Math.floor(totalElapsedTimeSeconds / 3600);
  const minutes = Math.floor((totalElapsedTimeSeconds % 3600) / 60);
  const seconds = totalElapsedTimeSeconds % 60;
  const formattedTime = hours > 0 ? 
    `${hours}h ${minutes}m ${seconds}s` : 
    minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  
  // Calculate average time per newly processed ID
  const cumulativeNewlyProcessed = scrapingState.cumulativeCompletedIDs.size;
  const avgTimePerID = cumulativeNewlyProcessed > 0 ? (totalElapsedTimeSeconds / cumulativeNewlyProcessed).toFixed(1) : '0.0';
  
  // Get actual count of scraped lines from today's output files
  const actualScrapedToday = getTodayScrapedCount();
  const totalUniqueIDsFromInput = scrapingState.totalUniqueIDs;
  const stats = scrapingState.getStats();
  
  // Add padding to current index for alignment
  const paddedIndex = String(currentIndex + 1).padStart(String(totalIDs).length, ' ');
  
  // Add current retry attempt info
  const retryInfo = scrapingState.currentAttempt > 1 ? ` \x1b[36m[Retry ${scrapingState.currentAttempt}]\x1b[0m` : '';
  
  // Create timestamp for this specific request (HH:MM:SS format)
  const requestTime = now.toLocaleTimeString("vi-VN", {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  // Create the main part of the line without re-attempt info
  const mainLine = `${paddedIndex}/${totalIDs}: \x1b[1m\x1b[33m${currentID}\x1b[0m${retryInfo} | ${statusColor}Status: ${status}\x1b[0m`;
  
  // Add timestamp and re-attempt info at the end with padding alignment
  const timestampText = ` \x1b[90m${requestTime}\x1b[0m`;
  const reattemptText = reattempt > 1 ? ` \x1b[90m(Re-attempt ${reattempt}/10)\x1b[0m` : '';
  const endInfo = timestampText + reattemptText;
  
  const targetLength = 70; // Reduced to accommodate timestamp
  const paddingNeeded = Math.max(0, targetLength - mainLine.replace(/\x1b\[[0-9;]*m/g, '').length);
  const padding = ' '.repeat(paddingNeeded);
  
  // Log ID line
  const idLine = mainLine + padding + endInfo;
  process.stdout.write(idLine + '\n');
  
  // Log status lines
  const line1 = `🕒 ${currentTime} | Total: ${formattedTime} | Avg: ${avgTimePerID}s/ID (newly processed)`;
  const line2 = `📈 Completed: ${actualScrapedToday}/${totalUniqueIDsFromInput} | ⏳ Processing: ${stats.processing}`;
  const line3 = `⚙️ Config: ${config.THREAD_COUNT} threads | ${config.MAX_REATTEMPTS} max re-attempts | ${config.RETRY_LIMIT} max retries | ${config.delay.BETWEEN_REQUEST}ms delay`;
  
  process.stdout.write(line1 + '\n');
  process.stdout.write(line2 + '\n');
  process.stdout.write(line3 + '\n');
  
  // Track that we have 3 status lines to clear next time
  lastLogLines = 3;
}

// Override console methods during clean logging
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info
};

function startCleanLogging() {
  isCleanLogging = true;
  // Clear screen
  process.stdout.write('\x1b[2J\x1b[0;0H');
  // Override console methods
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
}

function stopCleanLogging() {
  isCleanLogging = false;
  // Restore console methods
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.info = originalConsole.info;
  // Add final newline if we have status lines
  if (lastLogLines > 0) {
    process.stdout.write('\n');
  }
}

// Enhanced state management
class ScrapingState {
  constructor() {
    this.failedQueue = [];
    this.idTimers = new Map();
    this.idDurations = new Map();
    this.retryTracker = new Map(); // Tracks global retry count for each ID
    this.reattemptTracker = new Map(); // Tracks individual re-attempts for each ID
    this.idStartTimestamps = new Map();
    this.completedIDs = new Set();
    this.processingIDs = new Set();
    this.permanentlyFailedIDs = new Set();
    this.totalIDsToProcess = 0;
    this.totalUniqueIDs = 0; // Total unique IDs including already scraped
    this.activeThreads = 0;
    this.alreadyScrapedIDs = new Set(); // Track IDs already scraped in existing files
    this.cumulativeCompletedIDs = new Set(); // Track all completed IDs across retries (never reset)
    this.currentAttempt = 1; // Track current retry attempt
  }

  markIDAsProcessing(id) {
    this.processingIDs.add(id);
    this.idStartTimestamps.set(id, Date.now());
  }

  markIDAsCompleted(id) {
    this.processingIDs.delete(id);
    this.completedIDs.add(id);
    this.cumulativeCompletedIDs.add(id); // Add to cumulative counter
  }

  markIDAsFailedPermanently(id) {
    this.processingIDs.delete(id);
    this.permanentlyFailedIDs.add(id);
  }

  getElapsedTime(id) {
    const start = this.idStartTimestamps.get(id);
    return start ? ((Date.now() - start) / 1000).toFixed(2) : 'N/A';
  }

  getRetryCount(id) {
    return this.retryTracker.get(id) || 0;
  }

  incrementRetryCount(id) {
    this.retryTracker.set(id, this.getRetryCount(id) + 1);
  }

  getReattemptCount(id) {
    return this.reattemptTracker.get(id) || 0;
  }

  incrementReattemptCount(id) {
    this.reattemptTracker.set(id, this.getReattemptCount(id) + 1);
  }

  resetReattemptCount(id) {
    this.reattemptTracker.delete(id);
  }

  // Check if all IDs have been processed (either completed or permanently failed)
  isAllProcessingComplete() {
    const totalProcessed = this.completedIDs.size + this.permanentlyFailedIDs.size;
    return totalProcessed >= this.totalIDsToProcess;
  }

  // Get current processing statistics
  getStats() {
    return {
      completed: this.completedIDs.size,
      permanentlyFailed: this.permanentlyFailedIDs.size,
      processing: this.processingIDs.size,
      total: this.totalIDsToProcess,
      remaining: this.totalIDsToProcess - this.completedIDs.size - this.permanentlyFailedIDs.size
    };
  }
}

const scrapingState = new ScrapingState();
const invalidHttp200Attempts = new Map();
const confirmedNotFoundIDs = new Set();

function sendParentMessage(payload) {
  if (typeof process.send !== "function") return;
  try { process.send(payload); } catch { /* Parent may have closed while the scraper exits. */ }
}

function markConfirmedNotFound(id, attempts, reason = "HTTP 200 returned no usable WIPO record data") {
  confirmedNotFoundIDs.add(id);
  invalidHttp200Attempts.delete(id);
  scrapingState.resetReattemptCount(id);
  scrapingState.markIDAsFailedPermanently(id);
  const entry = { applicationNo: id, attempts, reason, checkedAt: new Date().toISOString() };
  fs.appendFileSync(path.join(baseOutputDir, "not_found.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
  sendParentMessage({ type: "wipo-not-found", ...entry });
  console.warn(`Not found: ${id} returned HTTP 200 without usable record data twice; no further retries will be made.`);
}

// === Helper function to get today's date in YYYY-MM-DD format ===
function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// === Set up unified output folder structure
const todayDate = getTodayDateString();
const baseOutputDir = process.env.WIPO_OUTPUT_DIR
  ? path.resolve(process.env.WIPO_OUTPUT_DIR)
  : path.join(__dirname, "Output", todayDate);
fs.mkdirSync(baseOutputDir, { recursive: true });

// === Type-specific output files ===
const outputFiles = {
  PATENTS: path.join(baseOutputDir, `SC_WIPO_${todayDate}.txt`),
  DESIGNS: path.join(baseOutputDir, `KD_WIPO_${todayDate}.txt`),
  TRADEMARKS: path.join(baseOutputDir, `NH_WIPO_${todayDate}.txt`)
};

const outputJsonFiles = {
  PATENTS: path.join(baseOutputDir, `SC_WIPO_${todayDate}.json`),
  DESIGNS: path.join(baseOutputDir, `KD_WIPO_${todayDate}.json`),
  TRADEMARKS: path.join(baseOutputDir, `NH_WIPO_${todayDate}.json`),
};

const TYPE_FIELD_LABELS = {
  DESIGNS: [
    "Loại đơn",
    "(10) Số bằng và ngày cấp",
    "Trạng thái",
    "(180) Ngày hết hạn",
    "(20) Số đơn và Ngày nộp đơn",
    "(40) Số công bố và ngày công bố",
    "(30) Chi tiết về dữ liệu ưu tiên",
    "(51/52) Phân loại Locarno",
    "(71/73) Chủ đơn/Chủ bằng",
    "(72) Tác giả kiểu dáng",
    "(74) Đại diện SHCN",
    "(73) Địa chỉ nhận thư",
    "(54) Tên kiểu dáng",
    "Tóm tắt",
    "(53) Tổng số kiểu dáng",
    "(55) Bản chất của kiểu dáng",
    "(56) Yêu cầu bảo hộ kiểu dáng",
  ],
  TRADEMARKS: [
    "Loại đơn",
    "(100) Số bằng và ngày cấp",
    "Trạng thái",
    "(180) Ngày hết hạn",
    "(200) Số đơn và Ngày nộp đơn",
    "(400) Số công bố và ngày công bố",
    "(541) Nhãn hiệu",
    "(591) Màu sắc nhãn hiệu",
    "(300) Chi tiết về dữ liệu ưu tiên",
    "(511) Nhóm sản phẩm/dịch vụ",
    "(531) Phân loại hình",
    "(730) Chủ đơn/Chủ bằng",
    "(740) Đại diện SHCN",
    "(571) Nhãn hiệu",
    "(566) Nhãn hiệu dịch thuật",
    "(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)",
    "(526) Yếu tố loại trừ",
  ],
  PATENTS: [
    "Loại đơn",
    "Loại đơn PCT",
    "(10) Số bằng và ngày cấp",
    "Trạng thái",
    "(180) Ngày hết hạn",
    "(20) Số đơn và Ngày nộp đơn",
    "(40) Số công bố và ngày công bố",
    "(86) Số đơn và ngày nộp đơn PCT",
    "(87) Số công bố và ngày công bố đơn PCT",
    "(85) Ngày vào pha quốc gia",
    "(30) Chi tiết về dữ liệu ưu tiên",
    "(51) Phân loại IPC",
    "Phân loại CPC",
    "(71/73) Chủ đơn/Chủ bằng",
    "(72) Tác giả sáng chế",
    "(74) Đại diện SHCN",
    "(73) Địa chỉ nhận thư",
    "(54) Tên",
    "(57) Tóm tắt",
    "(58) Các tài liệu đối chứng",
  ],
};

const jsonOutputStore = {
  PATENTS: [],
  DESIGNS: [],
  TRADEMARKS: [],
};

const jsonFlushCounters = {
  PATENTS: 0,
  DESIGNS: 0,
  TRADEMARKS: 0,
};

function parseDateTag(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  const m = value.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!m) return null;

  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    return null;
  }

  return {
    raw: value,
    day,
    month,
    year,
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function extractTaggedDates(label, value) {
  const text = String(value || "");
  const matches = text.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}/g) || [];
  return matches
    .map((raw) => parseDateTag(raw))
    .filter(Boolean)
    .map((entry) => ({ field: label, ...entry }));
}

function stripViPrefix(value) {
  return String(value || "")
    .replace(/\(\s*VI\s*\)\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitPipeListPreserveOrder(value) {
  return String(value || "")
    .split(" | ")
    .map((s) => stripViPrefix(s))
    .filter(Boolean);
}

function parseClassificationList(value) {
  return splitPipeListPreserveOrder(value).map((entry, index) => {
    const match = entry.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (!match) {
      return {
        order: index + 1,
        raw: entry,
        code: entry,
        version: "",
      };
    }

    return {
      order: index + 1,
      raw: entry,
      code: match[1].trim(),
      version: match[2].trim(),
    };
  });
}

function splitNumberAndDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return { raw: text, number: "", date_text: "", date: null };
  }

  // Use the last dd/mm/yyyy-like token as the field date and keep remaining text as number/code.
  const allDateMatches = text.match(/\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}/g) || [];
  const datePart = allDateMatches.length > 0 ? allDateMatches[allDateMatches.length - 1] : "";
  const taggedDate = parseDateTag(datePart);

  let numberPart = text;
  if (datePart) {
    const idx = numberPart.lastIndexOf(datePart);
    if (idx >= 0) {
      numberPart = `${numberPart.slice(0, idx)}${numberPart.slice(idx + datePart.length)}`;
    }
  }

  numberPart = numberPart
    .replace(/[|/\-:,;]+\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    raw: text,
    number: numberPart,
    date_text: datePart,
    date: taggedDate,
  };
}

function parsePriorityDetails(value) {
  const rows = String(value || "")
    .split("<lf>")
    .map((x) => x.trim())
    .filter(Boolean);

  const normalizedRows = rows.length > 0 ? rows : [String(value || "").trim()].filter(Boolean);

  return normalizedRows.map((row, index) => {
    const parsed = splitNumberAndDate(stripViPrefix(row));
    const priorityDate = parsed.date
      ? {
        raw: parsed.date.raw,
        day: parsed.date.day,
        month: parsed.date.month,
        year: parsed.date.year,
      }
      : null;

    return {
      order: index + 1,
      raw: row,
      priority_no: parsed.number,
      priority_date_text: parsed.date_text,
      priority_date: priorityDate,
    };
  });
}

function parseNamedAddressList(value, role) {
  return splitPipeListPreserveOrder(value).map((entry, index) => {
    const separatorIndex = entry.indexOf(":");
    const name = separatorIndex >= 0 ? entry.slice(0, separatorIndex).trim() : entry;
    const address = separatorIndex >= 0 ? entry.slice(separatorIndex + 1).trim() : "";

    if (role === "representative") {
      return {
        order: index + 1,
        raw: entry,
        representative_name: stripViPrefix(name),
        representative_address: stripViPrefix(address),
      };
    }

    return {
      order: index + 1,
      raw: entry,
      name: stripViPrefix(name),
      address: stripViPrefix(address),
    };
  });
}

function splitApplicantsWithOrder(rawApplicants) {
  return parseApplicantHistory(rawApplicants).entries.map((entry, index) => ({
    order: index + 1,
    raw: entry.raw,
    applicant_name: stripViPrefix(entry.name),
    applicant_address: stripViPrefix(entry.address),
    applicant_last_recorded_date: entry.lastRecordedDate,
    applicant_is_current: entry.isCurrent,
  }));
}

function splitPeopleWithOrder(rawPeople) {
  const items = splitPipeListPreserveOrder(rawPeople);

  return items.map((entry, index) => {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex < 0) {
      return {
        order: index + 1,
        raw: entry,
        inventor_name: entry,
        inventor_address: "",
      };
    }

    const name = entry.slice(0, separatorIndex).trim();
    const address = entry.slice(separatorIndex + 1).trim();
    return {
      order: index + 1,
      raw: entry,
      inventor_name: stripViPrefix(name),
      inventor_address: stripViPrefix(address),
    };
  });
}

function extractCanonicalApplicationNo(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/([1-4]-\d{4}-\d{4,}|5-\d{7})/);
  return match ? match[1] : "";
}

function parseDiaryOrdered(rawDiary) {
  const rows = String(rawDiary || "")
    .split("<lf>")
    .map((row) => row.trim())
    .filter(Boolean);

  return rows.map((row) => {
    const cols = row.split("<t>").map((x) => String(x || "").trim());
    const dateText = cols[0] || "";
    const description = cols[1] || "";
    const extras = cols.slice(2).filter(Boolean);
    return {
      date_text: dateText,
      date: parseDateTag(dateText),
      description,
      extra: extras,
    };
  });
}

function buildStructuredJsonRecord(type, id, outputData) {
  const labels = TYPE_FIELD_LABELS[type] || [];
  const columns = splitStructuredColumns(type, outputData, labels.length);
  if (!columns) return null;
  const { image, recordType, fieldValues, diaryRaw } = columns;

  const fields = {};
  const dates = [];
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    const value = fieldValues[i] || "";
    fields[label] = stripViPrefix(value);
    dates.push(...extractTaggedDates(label, value));
  }

  const applicantRaw =
    fields["(71/73) Chủ đơn/Chủ bằng"] || fields["(730) Chủ đơn/Chủ bằng"]
  ;
  const applicants_ordered = splitApplicantsWithOrder(applicantRaw);
  const applicants = applicants_ordered.map((item) => item.raw);

  const grantNumberDate = splitNumberAndDate(fields["(10) Số bằng và ngày cấp"] || fields["(100) Số bằng và ngày cấp"]);
  const applicationNumberDate = splitNumberAndDate(fields["(20) Số đơn và Ngày nộp đơn"] || fields["(200) Số đơn và Ngày nộp đơn"]);
  applicationNumberDate.application_no = extractCanonicalApplicationNo(applicationNumberDate.number || applicationNumberDate.raw);
  const publicationNumberDate = splitNumberAndDate(fields["(40) Số công bố và ngày công bố"] || fields["(400) Số công bố và ngày công bố"]);
  const pctApplicationNumberDate = splitNumberAndDate(fields["(86) Số đơn và ngày nộp đơn PCT"]);
  const pctPublicationNumberDate = splitNumberAndDate(fields["(87) Số công bố và ngày công bố đơn PCT"]);
  const nationalPhaseEntryDate = parseDateTag(fields["(85) Ngày vào pha quốc gia"] || "");
  const priorityDetails = parsePriorityDetails(fields["(30) Chi tiết về dữ liệu ưu tiên"] || fields["(300) Chi tiết về dữ liệu ưu tiên"]);
  const ipcClassifications = parseClassificationList(fields["(51) Phân loại IPC"]);
  const cpcClassifications = parseClassificationList(fields["Phân loại CPC"]);
  const representativesOrdered = parseNamedAddressList(fields["(74) Đại diện SHCN"] || fields["(740) Đại diện SHCN"], "representative");
  const title = stripViPrefix(fields["(54) Tên"] || fields["(54) Tên kiểu dáng"] || fields["(571) Nhãn hiệu"]);
  const abstract = stripViPrefix(fields["(57) Tóm tắt"] || fields["Tóm tắt"] || "");

  const splitFields = {
    grant_number_date: grantNumberDate,
    status: String(fields["Trạng thái"] || "").trim(),
    expiry_date: parseDateTag(fields["(180) Ngày hết hạn"] || ""),
    application_number_date: applicationNumberDate,
    publication_number_date: publicationNumberDate,
    pct_application_number_date: pctApplicationNumberDate,
    pct_publication_number_date: pctPublicationNumberDate,
    national_phase_entry_date: nationalPhaseEntryDate,
    priority_details: priorityDetails,
    ipc_classifications: ipcClassifications,
    cpc_classifications: cpcClassifications,
    representatives_ordered: representativesOrdered,
    title,
    abstract,
  };

  const inventorRaw =
    fields["(72) Tác giả sáng chế"] || fields["(72) Tác giả kiểu dáng"]
  ;
  const inventors = splitPipeListPreserveOrder(inventorRaw);
  const inventors_ordered = splitPeopleWithOrder(inventorRaw);

  const diary = parseDiaryOrdered(diaryRaw);
  for (const entry of diary) {
    if (entry.date) {
      dates.push({ field: "Tiến trình", ...entry.date });
    }
  }

  return {
    id,
    type,
    record_type: stripViPrefix(recordType || fields["Loáº¡i Ä‘Æ¡n"] || ""),
    image,
    fields,
    split_fields: splitFields,
    applicants,
    applicants_ordered,
    inventors,
    inventors_ordered,
    diary,
    dates,
    scraped_at: new Date().toISOString(),
  };
}

function initializeJsonOutputs() {
  for (const type of Object.keys(outputJsonFiles)) {
    const filePath = outputJsonFiles[type];
    if (!fs.existsSync(filePath)) {
      jsonOutputStore[type] = [];
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      jsonOutputStore[type] = Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      jsonOutputStore[type] = [];
    }
  }
}

function flushJsonOutput(type) {
  const filePath = outputJsonFiles[type];
  fs.writeFileSync(filePath, JSON.stringify(jsonOutputStore[type], null, 2), "utf-8");
}

function flushAllJsonOutputs() {
  for (const type of Object.keys(outputJsonFiles)) {
    flushJsonOutput(type);
  }
}

// === Global tracking file for all scraped data with run date ===
const globalTrackingFile = path.join(__dirname, "WIPO_Global_Tracking.txt");

// === Function to write to global tracking file with run date ===
function writeToGlobalTracking(id, type, data) {
  const runDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  const globalEntry = `${runDate}\t${id}\t${type}\t${data}`;
  
  // Add header if file doesn't exist
  if (!fs.existsSync(globalTrackingFile)) {
    const header = "Run_Date\tID\tType\tData\n";
    fs.writeFileSync(globalTrackingFile, header);
  }
  
  fs.appendFileSync(globalTrackingFile, globalEntry);
}

// === Function to count actual scraped IDs from today's output files that match input IDs ===
function getTodayScrapedCount() {
  // Get all input IDs (original list before filtering)
  const inputIDs = new Set();
  try {
    const allInputIDs = fs
      .readFileSync(config.path.data, "utf-8")
      .split("\n")
      .map(id => normalizeMadridInput(id)?.canonicalId || id.trim())
      .filter(Boolean);
    allInputIDs.forEach(id => inputIDs.add(id));
  } catch (error) {
    return 0;
  }
  
  // Use a Set to deduplicate scraped IDs before counting
  const uniqueScrapedIDs = new Set();
  
  Object.values(outputFiles).forEach(filePath => {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        
        for (const line of lines) {
          if (line.trim() && !line.startsWith('ID\t')) {
            const id = line.split('\t')[0]?.trim();
            // Only add if this ID was in our input file
            if (id && inputIDs.has(id)) {
              uniqueScrapedIDs.add(id);
            }
          }
        }
      } catch (error) {
        // Silently handle file read errors
      }
    }
  });
  
  return uniqueScrapedIDs.size;
}

// === Function to extract already scraped IDs from existing output files ===
function extractScrapedIDsFromFile(filePath) {
  const scrapedIDs = new Set();
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        // Look for ID patterns in the content (format: 1-YYYY-XXXXX, 2-YYYY-XXXXX, etc.)
        const idMatch = line.match(/(?:^|\W)([1-4]-\d{4}-\d{5}|5-\d{7})(?:\W|$)/);
        if (idMatch) {
          scrapedIDs.add(idMatch[1]);
        }
      }
      
    } catch (error) {
      // Silently handle error during clean logging mode
    }
  }
  return scrapedIDs;
}

// === Function to check all existing output files for scraped IDs ===
function loadAlreadyScrapedIDs() {
  // Check all type-specific output files for already scraped IDs
  Object.values(outputFiles).forEach(filePath => {
    if (fs.existsSync(filePath)) {
      const scrapedIDs = extractScrapedIDsFromFile(filePath);
      scrapedIDs.forEach(id => scrapingState.alreadyScrapedIDs.add(id));
    }
  });

  return outputFiles;
}
function extractHeadersFromDoc(doc) {
  const labelNodes = doc.querySelectorAll(".product-form-label");
  const headers = Array.from(labelNodes).map((el) => el.textContent.trim());
  const uniqueHeaders = [...new Set(headers)];
  return uniqueHeaders;
}

// Enhanced configuration with better organization
const config = {
  BASE_URLS: {
    PATENTS:
      "https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/patents?id=VN",
    DESIGNS:
      "https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/designs?id=VN",
    TRADEMARKS:
      "https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=VN",
  },
  DATA_TYPE: "TRADEMARK", // default fallback for extract logic
  path: {
    data: path.resolve(process.env.WIPO_INPUT_FILE || path.join(__dirname, "ID_WIPO.txt")),
    log: path.join(baseOutputDir, "log.txt"),
    failedIDs: "failed_ids.txt",
  },
  THREAD_COUNT: 10, // Number of concurrent threads
  RETRY_LIMIT: 20, // Reduced from 30 for faster processing (global retry passes)
  MAX_REATTEMPTS: 10, // Individual ID re-attempts before marking as failed
  MAX_CONCURRENT_REQUESTS: 4, // New: limit concurrent requests
  delay: {
    BETWEEN_REQUEST: 1000, // Reduced delay
    RETRY_DELAY_BASE: 500, // Base delay for retries (fixed, no multiplier)
  },
  string: {
    INTERNAL_SERVER_ERROR: "An unexpected server error has occurred",
    TEMPLATE_ERROR: "${appltype}", // Another error indicator
  },
  timeout: {
    REQUEST_TIMEOUT: 30000, // 30 seconds timeout per request
    TOTAL_TIMEOUT: 7200000, // 2 hours total timeout
  },
};

// === Initialize output structure and check for existing data ===
const forceRescrape = process.argv.includes("--force-rescrape");
const outputFileStructure = forceRescrape ? outputFiles : loadAlreadyScrapedIDs();
initializeJsonOutputs();

// === Load IDs with deduplication and filter out already scraped ones ===
let allIDs = fs
  .readFileSync(config.path.data, "utf-8")
  .split("\n")
  .map(id => normalizeMadridInput(id)?.canonicalId || id.trim())
  .filter(Boolean);

// Deduplicate input IDs first
const uniqueInputIDs = [...new Set(allIDs)];
const duplicatesRemoved = allIDs.length - uniqueInputIDs.length;
// Keep the normal daily-cache behaviour unless the caller explicitly asks to
// refresh these IDs. Removing only the current input IDs preserves the rest of
// today's processed set and lets the existing duplicate guard work normally.
if (forceRescrape) {
  uniqueInputIDs.forEach(id => scrapingState.alreadyScrapedIDs.delete(id));
  originalConsole.log(`   Force rescrape: \x1b[33m${uniqueInputIDs.length}\x1b[0m input ID(s)`);
}

function emitStructuredRecord(record) {
  sendParentMessage({ type: "wipo-record", record });
}

// Filter out already scraped IDs
let IDs = uniqueInputIDs.filter(id => !scrapingState.alreadyScrapedIDs.has(id));

// Store total unique IDs for proper progress tracking
scrapingState.totalUniqueIDs = uniqueInputIDs.length;

// Display compact summary (before starting clean logging)
originalConsole.log(`\n   Total: \x1b[1m${allIDs.length}\x1b[0m`);
originalConsole.log(`   Already scraped: \x1b[33m${scrapingState.alreadyScrapedIDs.size}\x1b[0m`);
originalConsole.log(`   Duplicate: \x1b[34m${duplicatesRemoved}\x1b[0m`);
originalConsole.log(`   Valid: \x1b[32m${IDs.length}\x1b[0m\n`);

config.TOTAL_REQUEST = IDs.length;

// === Copy original ID list
fs.copyFileSync(config.path.data, path.join(baseOutputDir, "original_ID.csv"));

function getTypeById(id) {
  const prefix = id.split("-")[0];
  switch (prefix) {
    case "1":
    case "2":
      return "PATENTS";
    case "3":
      return "DESIGNS";
    case "4":
      return "TRADEMARKS";
    default:
      return "TRADEMARKS";
  }
}

function getUrlById(id) {
  if (isMadridId(id)) {
    const madrid = normalizeMadridInput(id);
    return `https://www3.wipo.int/madrid/monitor/en/showData.jsp?ID=${madrid.romId}&DES=1`;
  }
  const type = getTypeById(id);
  return config.BASE_URLS[type] + id.replace(/-/g, "");
}

function getRequestHeaders() {
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8,vi;q=0.6",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: "https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/captcha",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  };

  // Optional cookie support when user provides WIPO_COOKIE env var.
  if (process.env.WIPO_COOKIE && process.env.WIPO_COOKIE.trim()) {
    headers.Cookie = process.env.WIPO_COOKIE.trim();
  }

  return headers;
}

function getFetchOptions(signal) {
  const options = {
    headers: getRequestHeaders(),
  };

  if (signal) {
    options.signal = signal;
  }

  if (allowInsecureTls && insecureTlsDispatcher) {
    options.dispatcher = insecureTlsDispatcher;
  }

  return options;
}

function formatFetchError(error) {
  if (!error) return "Unknown error";
  const message = error.message || String(error);
  const causeCode = error.cause && error.cause.code ? error.cause.code : "";
  const causeMessage = error.cause && error.cause.message ? error.cause.message : "";

  if (causeCode && causeMessage) {
    return `${message} | cause: ${causeCode} ${causeMessage}`;
  }
  if (causeCode) {
    return `${message} | cause: ${causeCode}`;
  }
  if (causeMessage) {
    return `${message} | cause: ${causeMessage}`;
  }
  return message;
}

function isTlsCertificateError(errorMsg) {
  if (!errorMsg) return false;
  return (
    errorMsg.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") ||
    errorMsg.includes("unable to verify the first certificate") ||
    errorMsg.includes("SELF_SIGNED_CERT") ||
    errorMsg.includes("CERT_")
  );
}

function logTlsModeOnce() {
  if (allowInsecureTls) {
    console.warn("⚠️ Insecure TLS mode enabled for WIPO requests (certificate verification bypassed).");
  }
}

// === Get output file path for specific type ===
function getOutputFileForType(type) {
  return outputFiles[type];
}

// Function to check if all processing is complete
function checkProcessingComplete() {
  const stats = scrapingState.getStats();
  
  if (scrapingState.isAllProcessingComplete()) {
    // Processing complete - will be handled in main function
    generateFinalReport();
  }
}

// Enhanced main start function with better retry logic
async function start() {
  // Initialize state
  scrapingState.totalIDsToProcess = IDs.length;
  scrapingState.activeThreads = config.THREAD_COUNT;

  // Start clean logging mode
  startCleanLogging();

  const startTime = Date.now();
  
  // Create thread promises
  const promises = [];
  for (let index = 0; index < config.THREAD_COUNT; index++) {
    promises.push(recurse_request(index));
  }
  
  // Wait for all initial threads to complete
  try {
    await Promise.all(promises);
    
    // Additional wait to ensure all re-attempts are completed
    while (scrapingState.processingIDs.size > 0) {
      await utils.delay(5000); // Wait 5 seconds before checking again
    }
    
    // Now all processing is truly complete
  } catch (error) {
    // Error will be handled after clean logging stops
  }

  // Handle failed IDs with retry
  if (scrapingState.failedQueue.length > 0) {
    // Handle retries silently during clean logging
    
    const retryStartTime = Date.now();
    const retryIDs = [...scrapingState.failedQueue];
    scrapingState.failedQueue = [];
    IDs = retryIDs;

    // Reset processing state for retries
    retryIDs.forEach(id => {
      scrapingState.processingIDs.delete(id);
      scrapingState.markIDAsProcessing(id);
      // Re-attempt counter will be reset when processing starts in recurse_request
    });

    const retryPromises = [];
    for (let index = 0; index < Math.min(config.THREAD_COUNT, retryIDs.length); index++) {
      retryPromises.push(recurse_request(index, 0));
    }
    
    try {
      await Promise.all(retryPromises);
      // Final completion handled after clean logging
    } catch (error) {
      // Error will be handled after clean logging stops
    }

    // Final failed IDs handling
    await handleFinalFailedIDs();
  }

  // Stop clean logging and restore console
  stopCleanLogging();

  // Print initial processing statistics
  printFinalStatistics(startTime);
}
// Helper function to handle final failed IDs
async function handleFinalFailedIDs() {
  const failIdPath = path.join(baseOutputDir, "fail_id.txt");
  
  if (scrapingState.failedQueue.length > 0) {
    // Use original console after clean logging is done
    originalConsole.log(`\n❌ Final failed IDs (${scrapingState.failedQueue.length}) after all retries:`);
    
    // Log each failed ID with details
    for (const id of scrapingState.failedQueue) {
      const type = getTypeById(id);
      const retryCount = scrapingState.getRetryCount(id);
      const elapsedTime = scrapingState.getElapsedTime(id);
      
      originalConsole.log(`   • ${id} (${type}) - ${retryCount} retries, ${elapsedTime}s elapsed`);
      
      const noDataEntry = `${id}\tNo data available after ${retryCount} retries\n`;
      const typeSpecificFile = outputFiles[getTypeById(id)];
      fs.appendFileSync(typeSpecificFile, noDataEntry);
      fs.appendFileSync(config.path.failedIDs, `${id}\n`);
      fs.appendFileSync(failIdPath, `${id}\n`);
    }
  } else {
    originalConsole.log(`\n✅ All previously failed IDs succeeded on retry!`);
  }
}

// Function to generate final report
function generateFinalReport() {
  const stats = scrapingState.getStats();
  
  originalConsole.log(`\n✅ Final: ${stats.completed} processed, ${stats.permanentlyFailed} failed (${((stats.completed / stats.total) * 100).toFixed(1)}% success)`);
  
  // Write final report to file
  const reportPath = path.join(baseOutputDir, "processing_report.txt");
  const reportContent = [
    `WIPO Scraping Final Report`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Statistics:`,
    `- Successfully processed: ${stats.completed} IDs`,
    `- Permanently failed: ${stats.permanentlyFailed} IDs`,
    `- Total IDs: ${stats.total}`,
    `- Success rate: ${((stats.completed / stats.total) * 100).toFixed(1)}%`,
    ``,
    `Configuration:`,
    `- Threads used: ${config.THREAD_COUNT}`,
    `- Max re-attempts per ID: ${config.MAX_REATTEMPTS}`,
    `- Max retry passes: ${config.RETRY_LIMIT}`,
    `- Base delay: ${config.delay.BETWEEN_REQUEST}ms`,
    ``,
    ...(stats.permanentlyFailed > 0 ? [
      `Permanently Failed IDs:`,
      ...Array.from(scrapingState.permanentlyFailedIDs).map(id => 
        `- ${id} (${scrapingState.getRetryCount(id)} retries)`
      )
    ] : [])
  ].join('\n');
  
  fs.writeFileSync(reportPath, reportContent);

  // Persist JSON outputs at end of run.
  flushAllJsonOutputs();
}

// Function to print final statistics (legacy function for compatibility)
function printFinalStatistics(startTime) {
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  const stats = scrapingState.getStats();
  const successRate = stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(1) : 0;
  
  // Initial processing: ${totalTime}s, ${stats.completed} processed, ${successRate}% success
}

function moveOldOutputs(outputDir, keep = 5) {
  try {
    const oldDir = path.join(outputDir, "Old");
    
    // Create Old directory if it doesn't exist
    if (!fs.existsSync(oldDir)) {
      fs.mkdirSync(oldDir, { recursive: true });
    }

    const entries = fs
      .readdirSync(outputDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "Old")
      .sort((a, b) => {
        try {
          const aTime = fs.statSync(path.join(outputDir, a.name)).mtimeMs;
          const bTime = fs.statSync(path.join(outputDir, b.name)).mtimeMs;
          return bTime - aTime;
        } catch (err) {
          // Silently handle stats reading errors
          return 0;
        }
      });

    const toMove = entries.slice(keep);
    let movedCount = 0;
    
    for (const dir of toMove) {
      const src = path.join(outputDir, dir.name);
      const dest = path.join(oldDir, dir.name);
      try {
        // Check if destination already exists
        if (fs.existsSync(dest)) {
          continue;
        }
        
        fs.renameSync(src, dest);
        // Silently move files during clean logging mode
        movedCount++;
      } catch (err) {
        if (err.code === 'EPERM') {
          console.warn(`⚠️ Permission denied moving ${dir.name} - skipping (files may be in use)`);
        } else {
          console.warn(`⚠️ Failed to move ${dir.name}: ${err.message}`);
        }
      }
    }
    
    if (movedCount > 0) {
      console.log(`✅ Successfully moved ${movedCount} old output directories`);
    }
  } catch (error) {
    console.warn(`⚠️ Error during cleanup of old outputs: ${error.message}`);
    console.log(`ℹ️ Continuing with script execution...`);
  }
}

// Enhanced main processing function with better error handling
async function recurse_request(i, reattemptCount = 0) {
  // Safety check to prevent runaway recursion
  if (reattemptCount > config.MAX_REATTEMPTS * 2) {
    console.warn(`⚠️ Excessive re-attempts detected for index ${i}, aborting...`);
    return;
  }
  
  if (i >= IDs.length) {
    scrapingState.activeThreads--;
    
    // Check if all processing is complete - but only if no IDs are still being processed
    if (scrapingState.activeThreads === 0 && scrapingState.processingIDs.size === 0) {
      // All threads completed AND no IDs are currently being processed
      checkProcessingComplete();
    }
    return;
  }

  const currentID = IDs[i].trim();
  
  // Validate ID format
  if (!utils.isValidID(currentID)) {
    console.warn(`⚠️ Invalid ID format: ${currentID}, skipping...`);
    // Use setImmediate to prevent stack overflow
    setImmediate(() => recurse_request(i + config.THREAD_COUNT, 0));
    return;
  }

  // Check if already processing or completed (skip for re-attempts)
  if (reattemptCount === 0 && (scrapingState.processingIDs.has(currentID) || scrapingState.completedIDs.has(currentID) || scrapingState.permanentlyFailedIDs.has(currentID))) {
    setImmediate(() => recurse_request(i + config.THREAD_COUNT, 0));
    return;
  }

  // Mark as processing and apply rate limiting (only on first attempt)
  if (reattemptCount === 0) {
    scrapingState.markIDAsProcessing(currentID);
    // Reset re-attempt counter only when starting this ID for the first time in this retry pass
    if (scrapingState.currentAttempt > 1) {
      scrapingState.resetReattemptCount(currentID);
    }
  }
  await utils.rateLimiter();

  const url = getUrlById(currentID);
  const startTime = performance.now();

  try {
    // Create robust fetch with timeout and abort controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, config.timeout.REQUEST_TIMEOUT);
    
    try {
      if (isMadridId(currentID)) {
        const madridResult = await fetchMadridXml(currentID, {
          headers: getRequestHeaders(),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        logJobDetails(i, madridResult.xmlResponse, IDs, startTime, reattemptCount);
        scrapingState.resetReattemptCount(currentID);
        extractDataThenContinue(i, madridResult.xml, madridResult);
        return;
      }

      // Fetch with abort signal and Node-safe browser-like headers
      const response = await fetch(url, getFetchOptions(controller.signal));
      // Keep the request's abort signal active until the response body is read.
      // A separate controller cannot interrupt response.text().
      const text = await response.text();
      clearTimeout(timeoutId);

      logJobDetails(i, response, IDs, startTime, reattemptCount);
      
      const responseInspection = inspectWipoResponse(text);
      // Check if we got usable data regardless of HTTP status.
      if (responseInspection.usable) {
        // Success! We got usable data even if server returned error status
        invalidHttp200Attempts.delete(currentID);
        scrapingState.resetReattemptCount(currentID);
        extractDataThenContinue(i, text);
      } else if (response.status === 200 && responseInspection.classification === "empty") {
        const attempts = (invalidHttp200Attempts.get(currentID) || 0) + 1;
        invalidHttp200Attempts.set(currentID, attempts);
        if (attempts >= 2) {
          markConfirmedNotFound(currentID, attempts);
          setImmediate(() => recurse_request(i + config.THREAD_COUNT, 0));
        } else {
          const retryDelay = config.delay.RETRY_DELAY_BASE + (Math.random() * 1000);
          await utils.delay(retryDelay);
          setImmediate(() => recurse_request(i, attempts));
        }
      } else {
        // No usable data found, treat as error
        await handleServerError(i, reattemptCount, currentID);
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    const errorMsg = formatFetchError(error);

    if (isTlsCertificateError(errorMsg)) {
      console.warn("⚠️ TLS certificate verification failed for WIPO endpoint.");
      if (!allowInsecureTls) {
        console.warn("   Hint: set WIPO_ALLOW_INSECURE_TLS=1 for this site.");
      }
    }
    
    // Don't log timeout errors as they're expected during heavy load
    if (!errorMsg.includes('timeout') && !errorMsg.includes('aborted')) {
      console.error(`❌ Error processing ID ${currentID}:`, errorMsg);
    }
    
    // Log error details
    const errorLog = `Error for ID ${currentID}: ${errorMsg} at ${new Date().toISOString()}\n`;
    fs.appendFileSync(config.path.log, errorLog);
    
    await handleServerError(i, reattemptCount, currentID);
  }
}

// Legacy function kept for compatibility but not used in main flow
function isTextError(text) {
  if (!text || typeof text !== 'string') return true;
  
  // Check for specific error patterns, not generic words
  const errorIndicators = [
    config.string.INTERNAL_SERVER_ERROR,
    config.string.TEMPLATE_ERROR,
    'An unexpected server error has occurred',
    '${appltype}',
    'HTTP ERROR 404',
    'HTTP ERROR 500',
    'HTTP ERROR 502',
    'HTTP ERROR 503',
    'Gateway Timeout',
    'Service Temporarily Unavailable'
  ];
  
  return errorIndicators.some(indicator => text.includes(indicator));
}

// Enhanced error handling with individual re-attempts vs global retries
async function handleServerError(i, reattemptCount, currentID) {
  const currentReattempts = scrapingState.getReattemptCount(currentID);
  
  if (currentReattempts < config.MAX_REATTEMPTS) {
    // Individual ID re-attempt - increment re-attempt counter
    scrapingState.incrementReattemptCount(currentID);
    const newReattemptCount = scrapingState.getReattemptCount(currentID);
    
    // Use fixed retry delay (no exponential backoff)
    const baseDelay = config.delay.RETRY_DELAY_BASE;
    const jitteredDelay = baseDelay + (Math.random() * 1000); // Add jitter only
    
    // Wait before re-attempt with fixed delay
    await utils.delay(jitteredDelay);
    
    // Re-attempt the same ID (same index i, don't advance) - use setImmediate to prevent stack overflow
    setImmediate(() => recurse_request(i, newReattemptCount));
  } else {
    // Silently add to failed queue for next retry pass (no console log needed)

    // Reset re-attempt counter for this ID
    scrapingState.resetReattemptCount(currentID);
    
    // Mark as processing complete for this round (but not permanently failed yet)
    scrapingState.processingIDs.delete(currentID);

    // Add to failed queue for next retry pass if not already present
    if (!scrapingState.failedQueue.includes(currentID)) {
      scrapingState.failedQueue.push(currentID);
    }

    // Continue with next ID (advance index) - use setImmediate to prevent stack overflow
    setImmediate(() => recurse_request(i + config.THREAD_COUNT, 0));
  }
}

// Enhanced data extraction with better error handling
function extractDataThenContinue(i, text, sourceDetails = null) {
  const currentID = IDs[i].trim();
  
  try {
    // Check if this ID was already processed to prevent duplicates
    if (scrapingState.alreadyScrapedIDs.has(currentID)) {
      console.log(`⏭️ Skipping ${currentID} - already processed`);
      scrapingState.markIDAsCompleted(currentID);
      return;
    }
    
    let madridParsed = null;
    let outputData;
    if (isMadridId(currentID)) {
      ensureTrademarkOutputHeader();
      madridParsed = parseMadridXml(text, normalizeMadridInput(currentID).madridNumber);

      const xmlDir = path.join(baseOutputDir, "Madrid_XML");
      fs.mkdirSync(xmlDir, { recursive: true });
      const xmlPath = path.join(xmlDir, `ROM.${madridParsed.intRegNumber}.xml`);
      const utf8Xml = String(text).replace(/encoding=["']ISO-8859-1["']/i, 'encoding="UTF-8"');
      fs.writeFileSync(xmlPath, utf8Xml, "utf-8");
      madridParsed.metadata.raw_xml_path = path.relative(__dirname, xmlPath);
      madridParsed.metadata.record_url = sourceDetails?.pageUrl || getUrlById(currentID);
      madridParsed.metadata.xml_url = sourceDetails?.xmlUrl || "";
      madridParsed.metadata.image_url = sourceDetails?.imageUrl || "";
      madridParsed.metadata.image_error = sourceDetails?.imageError || "";

      if (sourceDetails?.imageBuffer?.length) {
        const imageDir = path.join(baseOutputDir, "Madrid_Images");
        fs.mkdirSync(imageDir, { recursive: true });
        const extension = sourceDetails.imageFileExtension || "jpg";
        const imagePath = path.join(imageDir, `${currentID}.${extension}`);
        fs.writeFileSync(imagePath, sourceDetails.imageBuffer);
        madridParsed.values[0] = imagePath;
        madridParsed.metadata.local_image_path = imagePath;
      } else {
        madridParsed.metadata.local_image_path = "";
      }

      outputData = `${madridParsed.values.join("\t")}\n`;
    } else {
      outputData = extractFromHTML(text, currentID);
    }
    const type = getTypeById(currentID);
    const formattedData = `${currentID}\t${outputData}`;
    
    // Check for duplicates before writing
    if (scrapingState.alreadyScrapedIDs.has(currentID)) {
      scrapingState.markIDAsCompleted(currentID);
      recurse_request(i + config.THREAD_COUNT, 0);
      return;
    }
    
    // Add to already scraped set to prevent future duplicates
    scrapingState.alreadyScrapedIDs.add(currentID);
    
    // Write to type-specific file
    const typeSpecificFile = outputFiles[type];
    fs.appendFileSync(typeSpecificFile, formattedData);

    // Write structured JSON output for GUI/data post-processing.
    const structured = buildStructuredJsonRecord(type, currentID, outputData);
    if (structured) {
      if (madridParsed) structured.madrid = madridParsed.metadata;
      jsonOutputStore[type].push(structured);
      jsonFlushCounters[type] += 1;
      emitStructuredRecord(structured);
      if (process.argv.includes("--live-json") || jsonFlushCounters[type] % 200 === 0) {
        flushJsonOutput(type);
      }
    }
    
    // Write to global tracking file with run date
    writeToGlobalTracking(currentID, type, outputData);
    
    // Log completion time
    const elapsedTime = scrapingState.getElapsedTime(currentID);
    // Mark as completed
    scrapingState.markIDAsCompleted(currentID);

    // Check if all processing is complete
    if (scrapingState.isAllProcessingComplete()) {
      clearLastLog();
      console.log(`🎉 All processing complete! Generating final report...`);
      generateFinalReport();
    }

  } catch (error) {
    console.error(`❌ Error extracting data for ID ${currentID}:`, error.message);
    scrapingState.markIDAsFailedPermanently(currentID);
    scrapingState.failedQueue.push(currentID);
  }

  // Continue with next ID - use setImmediate to prevent stack overflow
  setImmediate(() => recurse_request(i + config.THREAD_COUNT, 0));
}

// Enhanced logging with better formatting and performance tracking
function logJobDetails(i, response, IDs, startTime, reattemptCount = 0) {
  const endTime = performance.now();
  const requestDuration = (endTime - startTime).toFixed(2);

  const ID = IDs[i].trim();
  const currentIndex = IDs.indexOf(ID);
  const currentReattempts = scrapingState.getReattemptCount(ID);
  const isError = response.status >= 400;
  const status = `${response.status} - ${response.statusText}`;
  const elapsedTime = scrapingState.getElapsedTime(ID);
  
  // Use minimized dynamic logging with re-attempt count
  logProgress(currentIndex, IDs.length, ID, currentReattempts + 1, status, isError, requestDuration, elapsedTime);
  
  // Enhanced file logging with re-attempt info
  const reattemptInfo = currentReattempts > 0 ? ` | Re-attempt ${currentReattempts}/${config.MAX_REATTEMPTS}` : '';
  const retryInfo = scrapingState.currentAttempt > 1 ? ` | Retry ${scrapingState.currentAttempt}` : '';
  const logEntry = `${new Date().toISOString()} | ${ID} | ${response.status} | ${requestDuration}ms${reattemptInfo}${retryInfo}\n`;
  fs.appendFileSync(config.path.log, logEntry);
}

// Enhanced utility functions
const utils = {
  /**
   * Creates a delay with optional jitter to prevent thundering herd
   */
  delay: (ms, jitter = 0.1) => {
    const jitterAmount = ms * jitter * Math.random();
    return new Promise(resolve => setTimeout(resolve, ms + jitterAmount));
  },

  /**
   * Returns fixed retry delay (no exponential backoff)
   */
  getRetryDelay: (attempt) => {
    return config.delay.RETRY_DELAY_BASE;
  },

  /**
   * Validates if an ID has the correct format (supports both formats: 1-2021-04006 or 1-04006)
   */
  isValidID: (id) => {
    if (!id || typeof id !== 'string') return false;
    const trimmedId = id.trim();
    if (trimmedId.length === 0) return false;
    
    // Support both formats: 1-2021-04006 (with year) or 1-04006 (without year)
    return /^\d+-(\d{4}-)?(\d{4,})$/.test(trimmedId);
  },

  /**
   * Safely parses JSON with error handling
   */
  safeJSONParse: (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },

  /**
   * Creates a timeout promise that rejects after specified time
   */
  createTimeoutPromise: (ms) => {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
  },

  /**
   * Rate limiter using a simple queue
   */
  rateLimiter: (() => {
    let queue = [];
    let processing = false;

    const processQueue = async () => {
      if (processing || queue.length === 0) return;
      
      processing = true;
      try {
        while (queue.length > 0) {
          const { resolve } = queue.shift();
          resolve();
          if (queue.length > 0) { // Only delay if there are more items
            await utils.delay(config.delay.BETWEEN_REQUEST);
          }
        }
      } catch (error) {
        console.error('Rate limiter error:', error);
      } finally {
        processing = false;
      }
    };

    return () => {
      return new Promise(resolve => {
        queue.push({ resolve });
        // Use setImmediate to avoid blocking
        setImmediate(() => processQueue());
      });
    };
  })(),
};

function delay(ms) {
  return utils.delay(ms);
}

function cleanHtml(text) {
  const accordions = new JSDOM(text).window.document.querySelectorAll(
    "#accordion-1a, #accordion-2a, #accordion-3a"
  );
  let cleanedHtml = "";
  accordions.forEach((accordion) => {
    const id = accordion.id;
    const i = parseInt(id.substring(id.lastIndexOf("-") + 1, id.length - 1));
    cleanedHtml += `<div class='accordion-${i}a'>${accordion.innerHTML}</div>`;
  });
  cleanedHtml += "\n---------------\n";
  return cleanedHtml;
}
// Add here any new label you want custom logic for
const DESIGN_LABEL_HANDLERS = {
  "(40) Số công bố và ngày công bố": (row) => {
    const rows = row.querySelectorAll(".row");
    if (rows.length) {
      return Array.from(rows)
        .map((r) =>
          Array.from(r.querySelectorAll(".col-md-4"))
            .map((col) => col.textContent.trim())
            .filter(Boolean)
            .join(" ")
        )
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(30) Chi tiết về dữ liệu ưu tiên": (row) => {
    const blocks = row.querySelectorAll(".priority-table");
    if (blocks.length) {
      return Array.from(blocks)
        .map((block) => {
          const parts = Array.from(block.querySelectorAll(".col-md-6"))
            .map((el) => el.textContent.trim())
            .filter(Boolean);
          return parts.join(" | ");
        })
        .join("<lf>");
    }
    // fallback for rare case
    const parts = Array.from(row.querySelectorAll(".col-md-6, .col-md-4, span"))
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    return parts.join(" | ");
  },

  "(51/52) Phân loại Locarno": (row) => {
    const allRows = row.querySelectorAll(".row");
    if (allRows.length) {
      return Array.from(allRows)
        .map((r) => r.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(71/73) Chủ đơn/Chủ bằng": (row) => {
    const applicants = row.querySelectorAll(".row");
    if (applicants.length) {
      return Array.from(applicants)
        .map((app) => app.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(72) Tác giả kiểu dáng": (row) => {
    const authors = row.querySelectorAll(".row");
    if (authors.length) {
      return Array.from(authors)
        .map((r) => r.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },

  "(74) Đại diện SHCN": (row) => {
    const reps = row.querySelectorAll(".row");
    if (reps.length) {
      return Array.from(reps)
        .map((r) => r.textContent.trim())
        .filter(Boolean)
        .join(" | ");
    }
    return row.textContent.trim();
  },
  // Add more handlers as needed...
};

function extractFromHTML(text, id) {
  const doc = new JSDOM(text).window.document;
  const type = getTypeById(id);

  if (type === "DESIGNS") {
    return extractDesignData(doc, id);
  } else if (type === "PATENTS") {
    return extractPatentData(doc);
  } else {
    return extractTrademarkData(doc);
  }
}

function extractDesignData(doc) {
  const outputPath = outputFiles["DESIGNS"];
  let designData = Array.from(
    doc.querySelectorAll(".product-form-details")
  ).map((row, index) => {
    // Match label node to the left
    const labelEl = row.previousElementSibling;
    const labelText =
      labelEl && labelEl.classList.contains("product-form-label")
        ? labelEl.textContent.trim()
        : "";

    // If a custom handler exists for this label, use it
    if (DESIGN_LABEL_HANDLERS[labelText]) {
      return DESIGN_LABEL_HANDLERS[labelText](row);
    }

    // All others: plain text
    return row.textContent.trim();
  });

  // Get design image
  let imgURL = "no image";
  let imgTag = doc.querySelector("img");
  if (imgTag) {
    imgURL = imgTag.getAttribute("src");
    if (imgURL.startsWith("data:image/")) imgURL = "base64_image";
  }
  designData.unshift(imgURL);

  // Table data (Tiến trình)
  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = table
    ? Array.from(table.querySelectorAll("tr"))
        .map((row) => {
          let columns = Array.from(row.querySelectorAll("td")).map((cell) =>
            cell.textContent.trim()
          );
          if (columns.length >= 3) {
            let temp = columns[0];
            columns[0] = columns[1];
            columns[1] = temp;
          }
          return columns.join("<t>");
        })
        .join("<lf>")
    : "no table data";

  // === Hardcoded header for DESIGN (edit as needed) ===
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    const headerLine =
      [
        "ID",
        "Image",
        "Type",
        "Loại đơn",
        "(10) Số bằng và ngày cấp",
        "Trạng thái",
        "(180) Ngày hết hạn",
        "(20) Số đơn và Ngày nộp đơn",
        "(40) Số công bố và ngày công bố",
        "(30) Chi tiết về dữ liệu ưu tiên",
        "(51/52) Phân loại Locarno",
        "(71/73) Chủ đơn/Chủ bằng",
        "(72) Tác giả kiểu dáng",
        "(74) Đại diện SHCN",
        "(73) Địa chỉ nhận thư",
        "(54) Tên kiểu dáng",
        "Tóm tắt",
        "(53) Tổng số kiểu dáng",
        "(55) Bản chất của kiểu dáng",
        "(56) Yêu cầu bảo hộ kiểu dáng",
        "Tiến trình",
      ].join("\t") + "\n";
    fs.appendFileSync(outputPath, headerLine);
  }

  let csvContent = designData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}

function ensureTrademarkOutputHeader() {
  const outputPath = outputFiles["TRADEMARKS"];
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return;
  const headerLine = ["ID", "Image", "Type", ...TYPE_FIELD_LABELS.TRADEMARKS, "Tiáº¿n trÃ¬nh"].join("\t") + "\n";
  fs.appendFileSync(outputPath, headerLine);
}

function extractTrademarkData(doc) {
  const outputPath = outputFiles["TRADEMARKS"];
  let accordion1aData = Array.from(
    doc.querySelectorAll(".product-form-details")
  ).map((row, index) => {
    // Get the matching label (to the left of the details)
    const labelEl = row.previousElementSibling;
    const labelText =
      labelEl && labelEl.classList.contains("product-form-label")
        ? labelEl.textContent.trim()
        : "";

    // Special handling for (400)
    if (labelText === "(400) Số công bố và ngày công bố") {
      // Each .row inside this cell
      const rows = row.querySelectorAll(".row");
      if (rows.length) {
        return Array.from(rows)
          .map((r) =>
            Array.from(r.querySelectorAll(".col-md-4"))
              .map((col) => col.textContent.trim())
              .filter(Boolean)
              .join(" ")
          )
          .filter(Boolean)
          .join(" | ");
      }
      // fallback: just plain text
      return row.textContent.trim();
    }

    // (300) Priority data, as before
    if (labelText === "(300) Chi tiết về dữ liệu ưu tiên") {
      const parts = Array.from(
        row.querySelectorAll(".col-md-6, .col-md-4, span")
      )
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      return parts.join(" | ");
    }

    // (531) Phân loại hình - as before
    if (labelText === "(531) Phân loại hình") {
      const allRows = row.querySelectorAll(".row");
      if (allRows.length) {
        return Array.from(allRows)
          .map((r) => r.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    }

    // Group/class (Nhóm) at index 10 (old code)
    if (index === 10) {
      let combinedText = Array.from(row.querySelectorAll(".row"))
        .map((childRow) => {
          let col2 = childRow.querySelector(".col-md-2");
          let col10 = childRow.querySelector(".col-md-10");
          let col2Text = col2 ? col2.textContent.trim() : "";
          let col10Text = col10 ? col10.textContent.trim() : "";
          // Add zero padding
          let classNum = col2Text.replace(/\D/g, "");
          let classNumPadded = classNum ? classNum.padStart(2, "0") : col2Text;
          return `Class/Nhóm ${classNumPadded}: ${col10Text}`;
        })
        .join("<lf>");
      return combinedText;
    } else {
      return row.textContent.trim();
    }
  });

  // [rest of your function as before...]
  let imgURL = "no image";
  let imgTag = doc.querySelector(".product-form-detail img");
  if (imgTag) {
    imgURL = imgTag.getAttribute("src");
    if (imgURL.startsWith("data:image/")) imgURL = "base64_image";
  }
  accordion1aData.unshift(imgURL);

  // Table data (Tiến trình)
  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = table
    ? Array.from(table.querySelectorAll("tr"))
        .map((row) => {
          let columns = Array.from(row.querySelectorAll("td")).map((cell) =>
            cell.textContent.trim()
          );
          if (columns.length >= 3) {
            let temp = columns[0];
            columns[0] = columns[1];
            columns[1] = temp;
          }
          return columns.join("<t>");
        })
        .join("<lf>")
    : "no table data";

  // Write header if new or empty
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    const headerLine =
      [
        "ID",
        "Image",
        "Type",
        "Loại đơn",
        "(100) Số bằng và ngày cấp",
        "Trạng thái",
        "(180) Ngày hết hạn",
        "(200) Số đơn và Ngày nộp đơn",
        "(400) Số công bố và ngày công bố",
        "(541) Nhãn hiệu",
        "(591) Màu sắc nhãn hiệu",
        "(300) Chi tiết về dữ liệu ưu tiên",
        "(511) Nhóm sản phẩm/dịch vụ",
        "(531) Phân loại hình",
        "(730) Chủ đơn/Chủ bằng",
        "(740) Đại diện SHCN",
        "(571) Nhãn hiệu",
        "(566) Nhãn hiệu dịch thuật",
        "(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)",
        "(526) Yếu tố loại trừ",
        "Tiến trình",
      ].join("\t") + "\n";
    fs.appendFileSync(outputPath, headerLine);
  }

  let csvContent = accordion1aData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}

function extractPatentData(doc) {
  const outputPath = outputFiles["PATENTS"];

  // 1. Handler logic defined inside function for scoping
  const PATENT_LABEL_HANDLERS = {
    "(40) Số công bố và ngày công bố": (row) => {
      const rows = row.querySelectorAll(".row");
      if (rows.length) {
        return Array.from(rows)
          .map((r) =>
            Array.from(r.querySelectorAll("div[class^='col-md-']"))
              .map((col) => col.textContent.trim())
              .filter(Boolean)
              .join(" | ")
          )
          .filter(Boolean)
          .join("<lf>");
      }
      return row.textContent.trim();
    },
    "(30) Chi tiết về dữ liệu ưu tiên": (row) => {
      const priorities = row.querySelectorAll(".priority-table");
      if (priorities.length) {
        return Array.from(priorities)
          .map((pt) => {
            const codeDate = Array.from(pt.querySelectorAll(".col-md-6 span"))
              .map((span) => span.textContent.trim())
              .filter(Boolean)
              .join(" ");
            const date =
              pt.querySelectorAll(".col-md-6")[1]?.textContent.trim() || "";
            return [codeDate, date].filter(Boolean).join(" | ");
          })
          .filter(Boolean)
          .join("<lf>");
      }
      return row.textContent.trim();
    },
    "(51) Phân loại IPC": (row) => {
      const ipcList = row.querySelectorAll("ul.classification-ul li");
      if (ipcList.length) {
        return Array.from(ipcList)
          .map((li) => li.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    "(71/73) Chủ đơn/Chủ bằng": (row) => {
      const applicants = row.querySelectorAll(".row");
      if (applicants.length) {
        return Array.from(applicants)
          .map((app) => app.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    "(72) Tác giả sáng chế": (row) => {
      const inventors = row.querySelectorAll(".row");
      if (inventors.length) {
        return Array.from(inventors)
          .map((r) => r.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    "(74) Đại diện SHCN": (row) => {
      const reps = row.querySelectorAll(".row");
      if (reps.length) {
        return Array.from(reps)
          .map((r) => r.textContent.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return row.textContent.trim();
    },
    // Add more handlers if needed...
  };

  // 2. Field order: must match header
  const FIELD_LABELS = [
    "Loại đơn",
    "Loại đơn PCT",
    "(10) Số bằng và ngày cấp",
    "Trạng thái",
    "(180) Ngày hết hạn",
    "(20) Số đơn và Ngày nộp đơn",
    "(40) Số công bố và ngày công bố",
    "(86) Số đơn và ngày nộp đơn PCT",
    "(87) Số công bố và ngày công bố đơn PCT",
    "(85) Ngày vào pha quốc gia",
    "(30) Chi tiết về dữ liệu ưu tiên",
    "(51) Phân loại IPC",
    "Phân loại CPC",
    "(71/73) Chủ đơn/Chủ bằng",
    "(72) Tác giả sáng chế",
    "(74) Đại diện SHCN",
    "(73) Địa chỉ nhận thư",
    "(54) Tên",
    "(57) Tóm tắt",
    "(58) Các tài liệu đối chứng",
  ];

  // 3. Build label->row map for fast lookup
  const allDetailRows = Array.from(
    doc.querySelectorAll(".product-form-details")
  );
  const labelsByText = {};
  allDetailRows.forEach((row) => {
    const labelEl = row.previousElementSibling;
    if (labelEl && labelEl.classList.contains("product-form-label")) {
      labelsByText[labelEl.textContent.trim()] = row;
    }
  });

  // 4. Collect and order data as per header, using handlers where defined
  let patentData = FIELD_LABELS.map((label) => {
    const row = labelsByText[label];
    if (!row) return ""; // always preserve field order, blanks if missing
    if (PATENT_LABEL_HANDLERS[label]) {
      return PATENT_LABEL_HANDLERS[label](row);
    }
    return row.textContent.trim();
  });

  // 5. Add image URL as second column (after ID)
  let imgURL = "no image";
  let imgTag = doc.querySelector("img");
  if (imgTag) {
    imgURL = imgTag.getAttribute("src");
    if (imgURL.startsWith("data:image/")) imgURL = "base64_image";
  }
  patentData.unshift(imgURL);

  // 6. Table data (Tiến trình)
  let table = doc.querySelector("#accordion-3a table tbody");
  let tableData = table
    ? Array.from(table.querySelectorAll("tr"))
        .map((row) => {
          let columns = Array.from(row.querySelectorAll("td")).map((cell) =>
            cell.textContent.trim()
          );
          if (columns.length >= 3) {
            let temp = columns[0];
            columns[0] = columns[1];
            columns[1] = temp;
          }
          return columns.join("<t>");
        })
        .join("<lf>")
    : "no table data";

  // 7. Write header if needed (ID + Image + all fields + Tiến trình)
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    const headerLine =
      ["ID", "Image", ...FIELD_LABELS, "Tiến trình"].join("\t") + "\n";
    fs.appendFileSync(outputPath, headerLine);
  }

  // 8. Return the row
  let csvContent = patentData.join("\t") + "\t" + tableData + "\n";
  return csvContent;
}
moveOldOutputs(path.join(__dirname, "Results"), 5);
// Enhanced post-check with better error handling and progress tracking
async function postCheckAndRetry(maxRetries = 3) {
  // Starting post-processing validation...
  
  const originalIDs = fs
    .readFileSync(config.path.data, "utf-8")
    .split("\n")
    .map((s) => normalizeMadridInput(s)?.canonicalId || s.trim())
    .filter(Boolean)
    .filter(utils.isValidID); // Only include valid IDs

  const outputIDs = new Set();

  // Read all existing output files with error handling
  try {
    Object.values(outputFiles).forEach(filePath => {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            const id = line.split("\t")[0]?.trim();
            if (id && utils.isValidID(id)) {
              outputIDs.add(id);
            }
          }
        }
      }
    });
  } catch (error) {
    console.warn(`⚠️ Error reading output files:`, error.message);
  }

  // Compute missing IDs
  const missingIDs = originalIDs.filter((id) => !outputIDs.has(id));

  if (missingIDs.length === 0) {
    console.log("✅ All IDs successfully processed - no post-check retries needed.");
    return;
  }

  console.log(`🔁 Found ${missingIDs.length} missing IDs, starting targeted retry...`);

  // Retry missing IDs with controlled concurrency
  for (let pass = 1; pass <= maxRetries; pass++) {
    console.log(`\n� Post-check retry pass ${pass}/${maxRetries}`);
    const remaining = [];
    const batchSize = Math.min(config.THREAD_COUNT, missingIDs.length);
    
    // Process in batches to control concurrency
    for (let i = 0; i < missingIDs.length; i += batchSize) {
      const batch = missingIDs.slice(i, i + batchSize);
      const batchPromises = batch.map(async (id) => {
        const url = getUrlById(id);
        
        try {
          await utils.rateLimiter(); // Apply rate limiting
          
          const response = await Promise.race([
            fetch(url, getFetchOptions()),
            utils.createTimeoutPromise(config.timeout.REQUEST_TIMEOUT)
          ]);
          
          if (response.status === 200) {
            const text = await response.text();
            if (!isTextError(text)) {
              // Extract and save data directly without calling extractDataThenContinue
              try {
                // Check if this ID was already processed to prevent duplicates
                if (scrapingState.alreadyScrapedIDs.has(id)) {
                  console.log(`⏭️ Skipping ${id} in post-check - already processed`);
                  scrapingState.markIDAsCompleted(id);
                  return { id, success: true };
                }
                
                const outputData = extractFromHTML(text, id);
                const type = getTypeById(id);
                const formattedData = `${id}\t${outputData}`;
                
                // Add to already scraped set to prevent future duplicates
                scrapingState.alreadyScrapedIDs.add(id);
                
                // Thread-safe file writing to type-specific file
                const typeSpecificFile = outputFiles[type];
                fs.appendFileSync(typeSpecificFile, formattedData);
                
                // Write to global tracking
                writeToGlobalTracking(id, type, outputData);
                
                // Mark as completed in state
                scrapingState.markIDAsCompleted(id);
                
                console.log(`✅ Recovered ID ${id} in post-check`);
                return { id, success: true };
              } catch (extractError) {
                console.warn(`⚠️ Failed to extract data for ${id}: ${extractError.message}`);
              }
            }
          }
        } catch (err) {
          console.warn(`⚠️ Post-check error for ${id}: ${err.message}`);
        }

        return { id, success: false };
      });
      
      const results = await Promise.allSettled(batchPromises);
      results.forEach(result => {
        if (result.status === 'fulfilled' && !result.value.success) {
          remaining.push(result.value.id);
        }
      });
      
      // Small delay between batches
      if (i + batchSize < missingIDs.length) {
        await utils.delay(1000);
      }
    }

    if (remaining.length === 0) {
      console.log("✅ All missing IDs recovered in post-check!");
      return;
    }

    console.log(`⏳ ${remaining.length} IDs still missing after pass ${pass}`);
    missingIDs.length = 0;
    missingIDs.push(...remaining);
    
    // Fixed delay between retry passes (no exponential backoff)
    if (pass < maxRetries) {
      const delay = 5000; // Fixed 5 second delay
      console.log(`⏸️ Waiting ${delay/1000}s before next retry pass...`);
      await utils.delay(delay);
    }
  }

  // Log final missing IDs
  if (missingIDs.length > 0) {
    // Mark remaining missing IDs as permanently failed
    missingIDs.forEach(id => {
      scrapingState.markIDAsFailedPermanently(id);
      if (!scrapingState.failedQueue.includes(id)) {
        scrapingState.failedQueue.push(id);
      }
    });
    
    const finalFailLogPath = path.join(baseOutputDir, "post_check_failed_ids.txt");
    fs.writeFileSync(finalFailLogPath, missingIDs.join("\n"), "utf-8");
    console.log(`❌ ${missingIDs.length} IDs still missing after all post-check retries`);
    console.log(`📄 Final missing IDs logged to: ${finalFailLogPath}`);
  }
}

// Simple retry loop: just rerun with failed IDs until done
async function simpleRetryLoop() {
  // Starting simple retry process...
  
  let retryAttempt = 1;
  const maxRetryAttempts = 10; // Increased from 5 to allow more retry passes
  
  while (retryAttempt <= maxRetryAttempts) {
    // Get list of missing IDs by comparing original list with output
    const originalIDs = fs
      .readFileSync(config.path.data, "utf-8")
      .split("\n")
      .map((s) => normalizeMadridInput(s)?.canonicalId || s.trim())
      .filter(Boolean)
      .filter(utils.isValidID);

    const processedIDs = new Set();

    // Read all existing output files to get processed IDs
    Object.values(outputFiles).forEach(filePath => {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        for (const line of lines) {
          const id = line.split("\t")[0]?.trim();
          if (id && id !== 'No data available after') {
            processedIDs.add(id);
          }
        }
      }
    });

    const missingIDs = originalIDs.filter(id => !processedIDs.has(id) && !confirmedNotFoundIDs.has(id));
    
    if (missingIDs.length === 0) {
      console.log(`🎉 All IDs processed successfully!`);
      break;
    }
    
    // Add line separation before retry attempt
    console.log(`\n🔄 \x1b[33mRetry attempt ${retryAttempt}/${maxRetryAttempts} - Reprocessing \x1b[1m${missingIDs.length}\x1b[0m\x1b[33m missing IDs...\x1b[0m\n`);
    
    // Update IDs array with missing IDs for retry
    IDs = missingIDs;
    scrapingState.totalIDsToProcess = missingIDs.length;
    scrapingState.currentAttempt = retryAttempt + 1; // Update attempt counter
    
    // Reset state for retry (but keep cumulative counts)
    scrapingState.completedIDs.clear();
    scrapingState.permanentlyFailedIDs.clear();
    scrapingState.processingIDs.clear();
    scrapingState.retryTracker.clear();
    // Re-attempt counters will be reset per ID when processing starts
    scrapingState.activeThreads = config.THREAD_COUNT;
    
    // Rerun the main processing function
    await start();
    
    retryAttempt++;
    
    // Small delay between retry attempts (only if there are still missing IDs)
    const updatedProcessedIDs = new Set();
    Object.values(outputFiles).forEach(filePath => {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        for (const line of lines) {
          const id = line.split("\t")[0]?.trim();
          if (id && id !== 'No data available after') {
            updatedProcessedIDs.add(id);
          }
        }
      }
    });
    
    const stillMissing = originalIDs.filter(id => !updatedProcessedIDs.has(id));
    if (retryAttempt <= maxRetryAttempts && stillMissing.length > 0) {
      // Waiting 10 seconds before next retry attempt...
      await utils.delay(10000);
    }
  }
  
  // Final check and report
  const finalOriginalIDs = fs
    .readFileSync(config.path.data, "utf-8")
    .split("\n")
    .map((s) => normalizeMadridInput(s)?.canonicalId || s.trim())
    .filter(Boolean)
    .filter(utils.isValidID);

  const finalProcessedIDs = new Set();
  Object.values(outputFiles).forEach(filePath => {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const id = line.split("\t")[0]?.trim();
        if (id && id !== 'No data available after') {
          finalProcessedIDs.add(id);
        }
      }
    }
  });
  
  const finalMissingIDs = finalOriginalIDs.filter(id => !finalProcessedIDs.has(id));
  if (finalMissingIDs.length > 0) {
    const failedIdsPath = path.join(baseOutputDir, "final_failed_ids.txt");
    fs.writeFileSync(failedIdsPath, finalMissingIDs.join("\n"), "utf-8");
    console.log(`❌ ${finalMissingIDs.length} IDs could not be processed after all attempts`);
    console.log(`📄 Failed IDs saved to: ${failedIdsPath}`);
    
    // Mark as permanently failed
    finalMissingIDs.forEach(id => {
      scrapingState.markIDAsFailedPermanently(id);
    });
  }
}

// Enhanced main function with comprehensive error handling
async function main() {
  try {
    // Step 1: Select preset from CLI when provided (GUI mode), otherwise use interactive prompt.
    const cliPresetIndex = parsePresetIndexFromArgs();
    let selectedPreset = null;

    if (cliPresetIndex !== null) {
      selectedPreset = getPresetByIndex(cliPresetIndex);
      if (!selectedPreset) {
        console.warn(`⚠️ Invalid --preset-index=${cliPresetIndex}. Falling back to preset #1.`);
        selectedPreset = getPresetByIndex(1);
      }
      if (!selectedPreset) {
        throw new Error("No presets available in presets.json");
      }
      console.log(`\x1b[32m✓ Selected preset from CLI: ${selectedPreset.name}\x1b[0m\n`);
    } else {
      selectedPreset = await promptPresetSelection();
    }
    
    // Step 2: Apply preset to config
    applyPresetToConfig(selectedPreset);
    const retryCount = parseRetryCountFromArgs();
    if (retryCount !== null) {
      config.RETRY_LIMIT = retryCount;
      config.MAX_REATTEMPTS = retryCount;
    }
    const requestedLanInterval = Number.parseInt(process.env.WIPO_BETWEEN_REQUEST_MS || "", 10);
    if (Number.isFinite(requestedLanInterval) && requestedLanInterval >= 0) {
      config.delay.BETWEEN_REQUEST = requestedLanInterval;
    }
    if (process.env.WIPO_LAN_FAIL_FAST === "1") {
      config.timeout.REQUEST_TIMEOUT = Math.min(config.timeout.REQUEST_TIMEOUT, 15000);
    }
    
    // Display applied configuration
    console.log("\x1b[1m\x1b[36m=== Applied Configuration ===\x1b[0m");
    console.log(`Threads: ${config.THREAD_COUNT} | Retry Limit: ${config.RETRY_LIMIT} | Re-attempts: ${config.MAX_REATTEMPTS}`);
    console.log(`Concurrent Requests: ${config.MAX_CONCURRENT_REQUESTS} | Delay: ${config.delay.BETWEEN_REQUEST}ms`);
    console.log(`Request Timeout: ${config.timeout.REQUEST_TIMEOUT}ms\n`);
    
    // Validate input file
    if (!fs.existsSync(config.path.data)) {
      throw new Error(`Input file not found: ${config.path.data}`);
    }
    
    // Validate IDs
    const validIDs = IDs.filter(utils.isValidID);
    const invalidIDs = IDs.filter(id => !utils.isValidID(id));
    
    if (invalidIDs.length > 0) {
      console.warn(`⚠️ Found ${invalidIDs.length} invalid IDs, skipping them`);
      IDs = validIDs;
    }
    
    if (IDs.length === 0) {
      console.log(`\n🎉 \x1b[32m\x1b[1mALL IDs ALREADY PROCESSED!\x1b[0m`);
      console.log(`📊 Total unique IDs: \x1b[1m${uniqueInputIDs.length}\x1b[0m`);
      console.log(`✅ \x1b[32mAlready scraped today: \x1b[1m${uniqueInputIDs.length - IDs.length}\x1b[0m`);
      process.exit(0);
    }
    
    config.TOTAL_REQUEST = IDs.length;
    // Processing ${IDs.length} valid IDs
    
    // Start main processing
    await start();
    
    // Simple retry loop instead of complex post-processing
    if (process.env.WIPO_SKIP_POST_RETRY !== "1") await simpleRetryLoop();
    
    // Generate final comprehensive report
    generateFinalReport();
    
    console.log(`🎉 Application completed successfully!`);
    console.log(`📅 Finished at: ${new Date().toLocaleString("vi-VN")}`);
    
    // Explicitly exit the process to prevent hanging
    process.exit(0);
    
  } catch (error) {
    console.error(`💥 Fatal error:`, error.message);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n⏹️ Graceful shutdown initiated...');
  // Progress at shutdown: ${scrapingState.completedIDs.size}/${config.TOTAL_REQUEST} completed
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

main();
