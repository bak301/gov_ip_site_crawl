const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "Output", "IPVietnam_Monthly_Lookup");

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

function getEncodingInfo(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { encoding: "utf16le", hadBom: true };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: "utf8", hadBom: true };
  }
  return { encoding: "utf8", hadBom: false };
}

function readText(filePath) {
  const info = getEncodingInfo(filePath);
  const raw = fs.readFileSync(filePath);
  const text = info.encoding === "utf16le"
    ? raw.toString("utf16le").replace(/^\uFEFF/, "")
    : raw.toString("utf8").replace(/^\uFEFF/, "");
  return { text, info };
}

function writeText(filePath, text, info) {
  if (info.encoding === "utf16le") {
    const prefix = info.hadBom ? "\uFEFF" : "";
    fs.writeFileSync(filePath, `${prefix}${text}`, "utf16le");
    return;
  }

  const prefix = info.hadBom ? "\uFEFF" : "";
  fs.writeFileSync(filePath, `${prefix}${text}`, "utf8");
}

function processJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    return { filePath, type: "json", updated: 0, rows: 0 };
  }

  let updated = 0;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const before = String(row.so_don || "");
    const after = normalizeAppNo(before);
    if (before !== after) {
      row.so_don = after;
      updated += 1;
    }
  }

  if (updated > 0) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  return { filePath, type: "json", updated, rows: data.length };
}

function processTsv(filePath) {
  const { text, info } = readText(filePath);
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) {
    return { filePath, type: "tsv", updated: 0, rows: 0 };
  }

  const header = lines[0].split("\t");
  const soDonIndex = header.findIndex((h) => String(h || "").trim().toLowerCase() === "so_don");
  if (soDonIndex < 0) {
    return { filePath, type: "tsv", updated: 0, rows: Math.max(0, lines.length - 1) };
  }

  let updated = 0;
  let rows = 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const cols = lines[i].split("\t");
    if (cols.length <= soDonIndex) continue;

    rows += 1;
    const before = cols[soDonIndex];
    const after = normalizeAppNo(before);
    if (before !== after) {
      cols[soDonIndex] = after;
      lines[i] = cols.join("\t");
      updated += 1;
    }
  }

  if (updated > 0) {
    writeText(filePath, lines.join("\n"), info);
  }

  return { filePath, type: "tsv", updated, rows };
}

function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`Source folder missing: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(SOURCE_DIR)
    .filter((name) => /^ipvietnam_monthly_lookup_.*\.(json|excel\.tsv)$/i.test(name))
    .map((name) => path.join(SOURCE_DIR, name));

  const reports = [];
  for (const filePath of files) {
    if (filePath.toLowerCase().endsWith(".json")) {
      reports.push(processJson(filePath));
      continue;
    }
    reports.push(processTsv(filePath));
  }

  let totalUpdated = 0;
  for (const item of reports) {
    totalUpdated += item.updated;
    const rel = path.relative(ROOT, item.filePath);
    console.log(`${rel} | ${item.type} | rows=${item.rows} | updated=${item.updated}`);
  }

  console.log(`TOTAL_UPDATED=${totalUpdated}`);
}

main();
