const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const PRESETS_FILE = path.join(ROOT_DIR, "presets.json");
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
