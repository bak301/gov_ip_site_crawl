const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { fetch, ProxyAgent, Agent } = require("undici");
const ExcelJS = require("exceljs");
const { imageSize } = require("image-size");

const ROOT_DIR = path.resolve(__dirname, "..");
const PRESETS_FILE = path.join(ROOT_DIR, "presets.json");
const CONFIG_FILE = path.join(ROOT_DIR, "config.json");
const INPUT_FILE = path.join(ROOT_DIR, "ID_WIPO.txt");
const SCRIPT_FILE = path.join(ROOT_DIR, "index_Wipo.js");
const LISTS_DIR = path.join(ROOT_DIR, "lists");
const OUTPUT_DIR = path.join(ROOT_DIR, "Output");

let mainWindow = null;
let activeChild = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function loadPresets() {
  try {
    if (!fs.existsSync(PRESETS_FILE)) {
      return [];
    }

    const raw = fs.readFileSync(PRESETS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.presets)) {
      return [];
    }

    return parsed.presets;
  } catch (error) {
    return [];
  }
}

function ensureListsDirectory() {
  fs.mkdirSync(LISTS_DIR, { recursive: true });
}

function sanitizeListFileName(name) {
  const base = String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");

  if (!base) {
    throw new Error("Please provide a valid list file name.");
  }

  return base.toLowerCase().endsWith(".tsv") ? base : `${base}.tsv`;
}

function getListFilePath(fileName) {
  const safeFileName = sanitizeListFileName(fileName);
  return path.join(LISTS_DIR, safeFileName);
}

function getAvailableListFiles() {
  ensureListsDirectory();
  const files = fs
    .readdirSync(LISTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".tsv"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    const defaultFile = "default.tsv";
    fs.writeFileSync(path.join(LISTS_DIR, defaultFile), "Application No.\n", "utf-8");
    return [defaultFile];
  }

  return files;
}

function parseIdsFromTsv(fileName) {
  const filePath = getListFilePath(fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error("Selected TSV file was not found.");
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const ids = [];

  for (const line of lines) {
    const firstColumn = (line.split("\t")[0] || "").trim();
    if (!firstColumn) {
      continue;
    }

    if (firstColumn.toLowerCase() === "application no.") {
      continue;
    }

    ids.push(firstColumn);
  }

  return Array.from(new Set(ids));
}

function createListFile(fileName) {
  ensureListsDirectory();
  const filePath = getListFilePath(fileName);

  if (fs.existsSync(filePath)) {
    throw new Error("A list file with this name already exists.");
  }

  fs.writeFileSync(filePath, "Application No.\n", "utf-8");
  return path.basename(filePath);
}

function renameListFile(oldName, newName) {
  ensureListsDirectory();

  const oldPath = getListFilePath(oldName);
  if (!fs.existsSync(oldPath)) {
    throw new Error("Selected file to rename was not found.");
  }

  const newPath = getListFilePath(newName);
  if (fs.existsSync(newPath)) {
    throw new Error("A list file with the new name already exists.");
  }

  fs.renameSync(oldPath, newPath);
  return path.basename(newPath);
}

function ensureSafePathSegment(name) {
  const value = String(name || "").trim();
  if (!value) {
    throw new Error("Missing required path value.");
  }

  if (value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error("Invalid path value.");
  }

  return value;
}

function listOutputDateFolders() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    return [];
  }

  const parseFolderDate = (name) => {
    const m = String(name || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(ts) ? null : ts;
  };

  return fs
    .readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => {
      const ad = parseFolderDate(a);
      const bd = parseFolderDate(b);

      if (ad !== null && bd !== null) {
        return bd - ad;
      }
      if (ad !== null) {
        return -1;
      }
      if (bd !== null) {
        return 1;
      }
      return b.localeCompare(a);
    });
}

function listInputTxtFiles() {
  const preferred = "ID_WIPO.txt";
  const files = fs
    .readdirSync(ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => entry.name)
    .filter((name) => /^id.*\.txt$/i.test(name) || /^tm_id\.txt$/i.test(name));

  const unique = Array.from(new Set(files));
  unique.sort((a, b) => a.localeCompare(b));

  if (fs.existsSync(path.join(ROOT_DIR, preferred)) && !unique.includes(preferred)) {
    unique.unshift(preferred);
  }

  if (unique.includes(preferred)) {
    unique.splice(unique.indexOf(preferred), 1);
    unique.unshift(preferred);
  }

  return unique;
}

function readInputTxtFile(fileName) {
  const safeFileName = ensureSafePathSegment(fileName);
  const filePath = path.join(ROOT_DIR, safeFileName);

  if (!fs.existsSync(filePath)) {
    throw new Error("Selected input TXT file does not exist.");
  }

  return fs.readFileSync(filePath, "utf-8");
}

function writeInputTxtFile(fileName, content) {
  const safeFileName = ensureSafePathSegment(fileName);
  const filePath = path.join(ROOT_DIR, safeFileName);
  fs.writeFileSync(filePath, String(content || ""), "utf-8");
}

function listOutputFiles(dateFolder) {
  const safeDateFolder = ensureSafePathSegment(dateFolder);
  const folderPath = path.join(OUTPUT_DIR, safeDateFolder);

  if (!fs.existsSync(folderPath)) {
    return [];
  }

  const allowedPattern = /^(sc|nh|kd)_wipo_\d{4}-\d{2}-\d{2}\.txt$/i;

  return fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        allowedPattern.test(entry.name) &&
        entry.name.toLowerCase() !== "log.txt"
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function readOutputFile(dateFolder, fileName) {
  const safeDateFolder = ensureSafePathSegment(dateFolder);
  const safeFileName = ensureSafePathSegment(fileName);
  const filePath = path.join(OUTPUT_DIR, safeDateFolder, safeFileName);

  if (!fs.existsSync(filePath)) {
    throw new Error("Selected output file does not exist.");
  }

  return fs.readFileSync(filePath, "utf-8");
}

function parseApplicationNumbers(rawIds) {
  const unique = new Set();

  for (const item of rawIds || []) {
    if (item === null || item === undefined) {
      continue;
    }

    const value = String(item).trim();
    if (!value) {
      continue;
    }

    unique.add(value);
  }

  return Array.from(unique);
}

function writeInputFile(ids) {
  const body = ids.join("\n");
  fs.writeFileSync(INPUT_FILE, body ? `${body}\n` : "", "utf-8");
}

function removeIdsFromOutputFile(dateFolder, fileName, ids) {
  const idSet = new Set(ids.map((id) => String(id).trim()).filter(Boolean));
  const summary = { removedRows: 0, removedJsonEntries: 0 };

  if (idSet.size === 0) {
    return summary;
  }

  const safeDateFolder = ensureSafePathSegment(dateFolder);
  const safeFileName = ensureSafePathSegment(fileName);
  const txtPath = path.join(OUTPUT_DIR, safeDateFolder, safeFileName);
  const jsonPath = txtPath.replace(/\.txt$/i, ".json");

  if (fs.existsSync(txtPath)) {
    const lines = fs.readFileSync(txtPath, "utf-8").split(/\r?\n/);

    const kept = lines.filter((line) => {
      if (!line || line.startsWith("ID\t")) {
        return true;
      }
      const firstColumn = line.split("\t")[0]?.trim();
      if (firstColumn && idSet.has(firstColumn)) {
        summary.removedRows += 1;
        return false;
      }
      return true;
    });

    if (summary.removedRows > 0) {
      fs.writeFileSync(txtPath, kept.join("\n"), "utf-8");
    }
  }

  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((record) => !idSet.has(String(record?.id || "").trim()));
        if (filtered.length !== parsed.length) {
          summary.removedJsonEntries = parsed.length - filtered.length;
          fs.writeFileSync(jsonPath, JSON.stringify(filtered, null, 2), "utf-8");
        }
      }
    } catch (error) {
      // Malformed JSON output is skipped rather than corrupted further.
    }
  }

  return summary;
}

function buildTrademarkThumbnailUrl(applicationNo) {
  if (/^5-/.test(String(applicationNo || "").trim())) return null;
  const digits = String(applicationNo || "").trim().replace(/-/g, "");
  if (!digits) {
    return null;
  }
  return `https://wipopublish.ipvietnam.gov.vn/wopublish-search/service/trademarks/application/VN${digits}/thumbnail?noLogo=true`;
}

function loadThumbnailProxyUrl() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8").trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.proxyUrl) {
          return String(parsed.proxyUrl).trim();
        }
      }
    }
  } catch (error) {
    // Malformed config.json falls through to environment variables.
  }

  return (
    process.env.WIPO_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ""
  );
}

// wipopublish.ipvietnam.gov.vn can be unreliable to reach from some networks,
// and index_Wipo.js already works around a certificate-chain issue on this
// host by disabling TLS verification. Mirror that here so thumbnail fetches
// don't fail with a generic "fetch failed" from a bad TLS handshake.
// Set WIPO_ALLOW_INSECURE_TLS=0 to disable this behavior.
const allowInsecureThumbnailTls = process.env.WIPO_ALLOW_INSECURE_TLS !== "0";

// wipopublish.ipvietnam.gov.vn can also be unreachable from some networks
// entirely. Set "proxyUrl" in config.json (or HTTPS_PROXY/HTTP_PROXY env
// vars) to an HTTP proxy endpoint (e.g. a Hong Kong/Singapore VPN client's
// local proxy port) to route thumbnail requests through it.
const thumbnailProxyUrl = loadThumbnailProxyUrl();

const thumbnailDispatcher = thumbnailProxyUrl
  ? new ProxyAgent({
      uri: thumbnailProxyUrl,
      requestTls: allowInsecureThumbnailTls ? { rejectUnauthorized: false } : undefined,
    })
  : allowInsecureThumbnailTls
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : null;

const THUMBNAIL_REQUEST_HEADERS = {
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8,vi;q=0.6",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  Referer: "https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/captcha",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
};

async function fetchImageBuffer(url) {
  const response = await fetch(url, {
    headers: THUMBNAIL_REQUEST_HEADERS,
    dispatcher: thumbnailDispatcher || undefined,
  });
  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function readLocalOutputImage(filePath) {
  const candidate = String(filePath || "").trim();
  if (!candidate || candidate.toLowerCase() === "no image") {
    return { ok: false, error: "No saved image path." };
  }

  const resolvedPath = path.resolve(ROOT_DIR, candidate);
  const resolvedOutputRoot = `${path.resolve(OUTPUT_DIR)}${path.sep}`.toLowerCase();
  if (!resolvedPath.toLowerCase().startsWith(resolvedOutputRoot)) {
    return { ok: false, error: "Image path is outside the WIPO output folder." };
  }
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    return { ok: false, error: "Saved image file was not found." };
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const mimeType = mimeTypes[extension];
  if (!mimeType) return { ok: false, error: "Unsupported saved image format." };

  const buffer = fs.readFileSync(resolvedPath);
  return { ok: true, dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}` };
}

const MAX_EXPORT_IMAGE_WIDTH = 140;
const MAX_EXPORT_IMAGE_HEIGHT = 140;
// Small gap between the image and the edge of its cell -- not a big
// uniform box, just breathing room sized to each image's own dimensions.
const IMAGE_CELL_PADDING_PX = 10;

function normalizeDotDatesForExport(value) {
  return String(value || "").replace(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g, "$1/$2/$3");
}

function extractRegNoForExport(rawRegNo) {
  // Raw format is Type-RegNo-Suffix, e.g. "4-0212225-000" where the leading
  // digit is the document type (1/2 patent, 3 design, 4 trademark) and the
  // trailing segment is a suffix/check code. Only the middle segment is the
  // actual registration number.
  const text = String(rawRegNo || "").trim();
  const parts = text.split("-");
  const regNo = parts.length === 3 ? parts[1] : text;
  return regNo.replace(/^0+(?=\d)/, "");
}

function splitRegNoAndDateForExport(rawValue) {
  const text = normalizeDotDatesForExport(rawValue).trim();
  const match = text.match(/^(\S+)\s+(\d{2}\/\d{2}\/\d{4})$/);
  if (match) {
    return { regNo: extractRegNoForExport(match[1]), regDate: match[2] };
  }
  return { regNo: text, regDate: "" };
}

async function exportOutputToExcel(dateFolder, fileName, savePath, providedImagesByApplicationNo) {
  const content = readOutputFile(dateFolder, fileName);
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error("No data to export.");
  }

  const isTrademarkFile = /^nh_wipo_/i.test(fileName);
  const headerColumns = lines[0].split("\t");
  const dataLines = lines.slice(1);
  const sourceImageColIndex = headerColumns.indexOf("Image");
  const sourceMarkNameColIndexes = headerColumns
    .map((header, index) => (/^\((541|571)\)/.test(String(header || "").trim()) ? index : -1))
    .filter((index) => index >= 0);
  const sourceProgressColIndex = headerColumns.indexOf("Tiến trình");
  const regNoDateColIndex = headerColumns.findIndex((h) => /Số bằng và ngày cấp/.test(String(h || "")));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Output");

  // Build the final column layout in two ordered steps, applied identically
  // to the header and to every data row so positions stay in sync:
  //   1) insert canonical image/name columns right after ID, for trademark files
  //   2) split the combined Reg No/Date column into two, at its shifted position
  const imageColIndex = isTrademarkFile ? 1 : -1;
  const trademarkColumnsInserted = isTrademarkFile ? 2 : 0;
  const regNoPositionInColumns =
    regNoDateColIndex < 0
      ? -1
      : isTrademarkFile && regNoDateColIndex >= 1
        ? regNoDateColIndex + trademarkColumnsInserted
        : regNoDateColIndex;

  let progressColIndex = sourceProgressColIndex;
  if (isTrademarkFile && sourceProgressColIndex >= 1) {
    progressColIndex += trademarkColumnsInserted;
  }
  if (regNoDateColIndex >= 0 && sourceProgressColIndex > regNoDateColIndex) {
    progressColIndex += 1;
  }

  let columns = headerColumns.slice();
  if (imageColIndex >= 0) {
    columns.splice(imageColIndex, 0, "Trademark Image", "Trademark Name");
  }
  if (regNoPositionInColumns >= 0) {
    columns.splice(regNoPositionInColumns, 1, "Reg. No.", "Reg. Date (dd/mm/yyyy)");
  }

  const imagesDir = path.join(path.dirname(savePath), `${path.basename(savePath, ".xlsx")}_images`);
  if (isTrademarkFile) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  sheet.addRow(columns);
  sheet.getRow(1).font = { bold: true };

  if (progressColIndex >= 0) {
    sheet.getColumn(progressColIndex + 1).alignment = { wrapText: true, vertical: "top" };
  }

  // Pass 1: build each row's text columns and fetch/measure its image (if
  // any) without touching the sheet yet. Column width in Excel is uniform
  // for the whole column, so we need to know the widest actual image
  // before we can size that column -- but row height can (and should)
  // vary per row, sized to that row's own image.
  const rowDescriptors = [];
  let maxRenderWidth = 0;

  for (const line of dataLines) {
    const sourceCols = line.split("\t");

    if (sourceProgressColIndex >= 0 && sourceCols[sourceProgressColIndex] !== undefined) {
      sourceCols[sourceProgressColIndex] = sourceCols[sourceProgressColIndex]
        .replace(/<t><lf>/g, "\n")
        .replace(/<lf>/g, "\n")
        .replace(/<t>/g, " - ");
    }

    const markName = isTrademarkFile
      ? sourceMarkNameColIndexes
        .map((index) => String(sourceCols[index] || "").replace(/^\(\s*VI\s*\)\s*/i, "").trim())
        .find(Boolean) || ""
      : "";

    let rowCols = sourceCols.map((value) => normalizeDotDatesForExport(value));
    if (imageColIndex >= 0) {
      rowCols.splice(imageColIndex, 0, "", markName);
    }
    if (regNoPositionInColumns >= 0) {
      const { regNo, regDate } = splitRegNoAndDateForExport(sourceCols[regNoDateColIndex]);
      rowCols.splice(regNoPositionInColumns, 1, regNo, regDate);
    }

    const descriptor = { rowCols, applicationNo: "", markName, buffer: null, extension: "", renderWidth: 0, renderHeight: 0, noImageReason: "" };

    if (isTrademarkFile) {
      const applicationNo = (sourceCols[0] || "").trim();
      descriptor.applicationNo = applicationNo;
      // Prefer the buffer the renderer already fetched via Chromium's network
      // stack (the same path the live <img> previews use successfully).
      // Falling back to a Node-side fetch is kept only as a last resort,
      // since it has been observed to fail against this host even when the
      // renderer succeeds.
      let buffer = providedImagesByApplicationNo && providedImagesByApplicationNo.get(applicationNo);

      // Madrid images are downloaded while the temporary WIPO session token is
      // valid. Reuse that saved file instead of trying the domestic VN endpoint.
      if (!buffer && /^5-/.test(applicationNo) && sourceImageColIndex >= 0) {
        const candidate = String(sourceCols[sourceImageColIndex] || "").trim();
        const resolvedCandidate = path.resolve(ROOT_DIR, candidate);
        const resolvedOutputRoot = `${path.resolve(OUTPUT_DIR)}${path.sep}`.toLowerCase();
        if (
          candidate &&
          candidate.toLowerCase() !== "no image" &&
          resolvedCandidate.toLowerCase().startsWith(resolvedOutputRoot) &&
          fs.existsSync(resolvedCandidate)
        ) {
          buffer = fs.readFileSync(resolvedCandidate);
        }
      }

      if (!buffer) {
        const url = buildTrademarkThumbnailUrl(applicationNo);
        if (url) {
          try {
            buffer = await fetchImageBuffer(url);
          } catch (error) {
            descriptor.noImageReason = `No image (${error.message || error})`;
          }
        }
      }

      if (buffer) {
        try {
          const dimensions = imageSize(buffer);
          const scale = Math.min(
            1,
            MAX_EXPORT_IMAGE_WIDTH / dimensions.width,
            MAX_EXPORT_IMAGE_HEIGHT / dimensions.height
          );
          descriptor.renderWidth = Math.max(1, Math.round(dimensions.width * scale));
          descriptor.renderHeight = Math.max(1, Math.round(dimensions.height * scale));
          descriptor.buffer = buffer;
          const rawType = String(dimensions.type || "png").toLowerCase();
          descriptor.extension = rawType === "jpg" ? "jpeg" : rawType;
          maxRenderWidth = Math.max(maxRenderWidth, descriptor.renderWidth);
        } catch (error) {
          descriptor.noImageReason = `No image (${error.message || error})`;
        }
      } else {
        descriptor.noImageReason = descriptor.markName || descriptor.noImageReason || "No image";
      }
    }

    rowDescriptors.push(descriptor);
  }

  // Pass 2: now that the widest actual image is known, set the column width
  // once and write each row sized to its own image + a small padding gap.
  const imageColumnWidthPx = maxRenderWidth > 0 ? maxRenderWidth + IMAGE_CELL_PADDING_PX : 0;
  if (isTrademarkFile && imageColIndex >= 0 && imageColumnWidthPx > 0) {
    sheet.getColumn(imageColIndex + 1).width = Math.max(8, Math.round(imageColumnWidthPx / 7));
  }

  for (const descriptor of rowDescriptors) {
    const row = sheet.addRow(descriptor.rowCols);

    if (isTrademarkFile) {
      if (descriptor.buffer) {
        const cellHeightPx = descriptor.renderHeight + IMAGE_CELL_PADDING_PX;

        // Row height must be set before addImage(), since exceljs resolves
        // the cell anchor (and its row-height-relative offset) immediately.
        row.height = Math.max(row.height || 15, cellHeightPx * 0.75);

        const colOffsetFraction =
          imageColumnWidthPx > 0 ? (imageColumnWidthPx - descriptor.renderWidth) / 2 / imageColumnWidthPx : 0;
        const rowOffsetFraction = (cellHeightPx - descriptor.renderHeight) / 2 / cellHeightPx;

        const imageId = workbook.addImage({ buffer: descriptor.buffer, extension: descriptor.extension });

        const sanitizedApplicationNo = descriptor.applicationNo.replace(/[\\/:*?"<>|]/g, "_");
        const logoFilePath = path.join(imagesDir, `${sanitizedApplicationNo}.${descriptor.extension}`);
        fs.writeFileSync(logoFilePath, descriptor.buffer);

        sheet.addImage(imageId, {
          tl: { col: imageColIndex + colOffsetFraction, row: row.number - 1 + rowOffsetFraction },
          ext: { width: descriptor.renderWidth, height: descriptor.renderHeight },
        });
      } else {
        row.getCell(imageColIndex + 1).value = descriptor.markName || descriptor.noImageReason || "No image";
      }
    }
  }

  const allRowCols = rowDescriptors.map((descriptor) => descriptor.rowCols);

  columns.forEach((columnName, idx) => {
    if (idx === imageColIndex || idx === progressColIndex) {
      return;
    }
    let longest = String(columnName || "").length;
    allRowCols.forEach((rowCols) => {
      const value = rowCols[idx] || "";
      longest = Math.max(longest, Math.min(value.length, 60));
    });
    sheet.getColumn(idx + 1).width = Math.min(Math.max(longest + 2, 10), 60);
  });

  if (progressColIndex >= 0) {
    sheet.getColumn(progressColIndex + 1).width = 50;
  }

  await workbook.xlsx.writeFile(savePath);
}

function broadcastLog(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("run:log", payload);
  }
}

function runScriptWithPreset(ids, presetIndex) {
  return new Promise((resolve, reject) => {
    if (activeChild) {
      reject(new Error("A scraper run is already in progress."));
      return;
    }

    if (!fs.existsSync(SCRIPT_FILE)) {
      reject(new Error("index_Wipo.js was not found in the workspace root."));
      return;
    }

    const cleanedIds = parseApplicationNumbers(ids);
    if (cleanedIds.length === 0) {
      reject(new Error("No valid application numbers found in the spreadsheet."));
      return;
    }

    writeInputFile(cleanedIds);

    const args = [SCRIPT_FILE];
    const indexValue = Number.parseInt(String(presetIndex), 10);
    if (!Number.isNaN(indexValue) && indexValue > 0) {
      args.push(`--preset-index=${indexValue}`);
    }

    const child = spawn(process.execPath, args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeChild = child;

    broadcastLog({
      type: "system",
      message: `Starting run with ${cleanedIds.length} IDs using preset #${indexValue || 1}`,
    });

    child.stdout.on("data", (chunk) => {
      broadcastLog({ type: "stdout", message: chunk.toString() });
    });

    child.stderr.on("data", (chunk) => {
      broadcastLog({ type: "stderr", message: chunk.toString() });
    });

    child.on("error", (error) => {
      activeChild = null;
      reject(error);
    });

    child.on("close", (code) => {
      activeChild = null;
      resolve({ code });
    });
  });
}

ipcMain.handle("presets:list", () => {
  const presets = loadPresets();
  return presets.map((preset, index) => ({
    index: index + 1,
    name: preset.name || `Preset ${index + 1}`,
    value: preset,
  }));
});

ipcMain.handle("run:start", async (_event, payload) => {
  const ids = payload && Array.isArray(payload.ids) ? payload.ids : [];
  const presetIndex = payload ? payload.presetIndex : 1;

  try {
    const result = await runScriptWithPreset(ids, presetIndex);
    return { ok: true, code: result.code };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("run:stop", () => {
  if (!activeChild) {
    return { ok: false, error: "No running process." };
  }

  activeChild.kill("SIGINT");
  return { ok: true };
});

ipcMain.handle("lists:list", () => {
  try {
    const files = getAvailableListFiles();
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lists:load", (_event, payload) => {
  const fileName = payload ? payload.fileName : "";

  try {
    const ids = parseIdsFromTsv(fileName);
    return { ok: true, ids };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lists:create", (_event, payload) => {
  const fileName = payload ? payload.fileName : "";

  try {
    const createdName = createListFile(fileName);
    return { ok: true, fileName: createdName };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("lists:rename", (_event, payload) => {
  const oldName = payload ? payload.oldName : "";
  const newName = payload ? payload.newName : "";

  try {
    const renamedName = renameListFile(oldName, newName);
    return { ok: true, fileName: renamedName };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("output:dates", () => {
  try {
    const dates = listOutputDateFolders();
    return { ok: true, dates };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("output:files", (_event, payload) => {
  const dateFolder = payload ? payload.dateFolder : "";

  try {
    const files = listOutputFiles(dateFolder);
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("output:read", (_event, payload) => {
  const dateFolder = payload ? payload.dateFolder : "";
  const fileName = payload ? payload.fileName : "";

  try {
    const content = readOutputFile(dateFolder, fileName);
    return { ok: true, content };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("output:readLocalImage", (_event, payload) => {
  try {
    return readLocalOutputImage(payload && payload.path);
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("input:files", () => {
  try {
    const files = listInputTxtFiles();
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("input:read", (_event, payload) => {
  const fileName = payload ? payload.fileName : "";

  try {
    const content = readInputTxtFile(fileName);
    return { ok: true, content };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("input:write", (_event, payload) => {
  const fileName = payload ? payload.fileName : "";
  const content = payload ? payload.content : "";

  try {
    writeInputTxtFile(fileName, content);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("entries:delete", (_event, payload) => {
  const dateFolder = payload ? payload.dateFolder : "";
  const fileName = payload ? payload.fileName : "";
  const ids = payload && Array.isArray(payload.ids) ? payload.ids : [];

  if (ids.length === 0) {
    return { ok: false, error: "No application number was provided to delete." };
  }

  try {
    const summary = removeIdsFromOutputFile(dateFolder, fileName, ids);
    return { ok: true, ...summary };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

ipcMain.handle("output:exportExcel", async (_event, payload) => {
  const dateFolder = payload ? payload.dateFolder : "";
  const fileName = payload ? payload.fileName : "";
  const images = payload && Array.isArray(payload.images) ? payload.images : [];

  try {
    const safeDateFolder = ensureSafePathSegment(dateFolder);
    const safeFileName = ensureSafePathSegment(fileName);
    const defaultName = safeFileName.replace(/\.txt$/i, ".xlsx");
    const defaultPath = path.join(OUTPUT_DIR, safeDateFolder, defaultName);

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Export to Excel",
      defaultPath,
      filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
    });

    if (canceled || !filePath) {
      return { ok: false, canceled: true };
    }

    const providedImagesByApplicationNo = new Map();
    for (const item of images) {
      const applicationNo = item && String(item.applicationNo || "").trim();
      if (applicationNo && item.bytes) {
        providedImagesByApplicationNo.set(applicationNo, Buffer.from(item.bytes));
      }
    }

    await exportOutputToExcel(safeDateFolder, safeFileName, filePath, providedImagesByApplicationNo);
    shell.showItemInFolder(filePath);
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});

// The live thumbnail <img> previews in the renderer load directly from
// wipopublish.ipvietnam.gov.vn through Chromium's network stack, which hits
// the same certificate-chain issue worked around above for the export path.
// Only bypass the cert check for this one host, not globally.
if (allowInsecureThumbnailTls) {
  app.on("certificate-error", (event, _webContents, url, _error, _certificate, callback) => {
    if (/^https:\/\/wipopublish\.ipvietnam\.gov\.vn\//i.test(url)) {
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false);
  });
}

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
