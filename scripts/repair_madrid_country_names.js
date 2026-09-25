const fs = require("fs");
const path = require("path");
const { pctCountryDisplayName } = require("../madrid_monitor");

function expandCountryCodes(value) {
  return String(value || "").replace(/,\s*([A-Z]{2})(?=\s*(?:\||<lf>|$))/g, (_match, code) => {
    const name = pctCountryDisplayName(code);
    return `, ${name || code}`;
  });
}

function repairObject(value) {
  if (typeof value === "string") return expandCountryCodes(value);
  if (Array.isArray(value)) return value.map(repairObject);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = repairObject(value[key]);
  }
  return value;
}

const outputRoot = path.resolve(__dirname, "..", "Output");
const results = [];
for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
  const txtPath = path.join(outputRoot, entry.name, `NH_WIPO_${entry.name}.txt`);
  const jsonPath = path.join(outputRoot, entry.name, `NH_WIPO_${entry.name}.json`);
  if (!fs.existsSync(txtPath)) continue;

  const lines = fs.readFileSync(txtPath, "utf8").split(/\r?\n/);
  const headers = String(lines[0] || "").split("\t");
  const addressIndexes = headers
    .map((header, index) => (/^\((730|740)\)/.test(header) ? index : -1))
    .filter((index) => index >= 0);
  let repaired = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const columns = lines[index].split("\t");
    if (!/^5-\d{7}$/.test(String(columns[0] || "").trim())) continue;
    let changed = false;
    for (const addressIndex of addressIndexes) {
      const next = expandCountryCodes(columns[addressIndex]);
      if (next !== columns[addressIndex]) {
        columns[addressIndex] = next;
        changed = true;
      }
    }
    if (changed) {
      lines[index] = columns.join("\t");
      repaired += 1;
    }
  }

  if (!repaired) continue;
  fs.writeFileSync(txtPath, lines.join("\n"), "utf8");
  if (fs.existsSync(jsonPath)) {
    const rows = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    for (const row of rows) {
      if (/^5-\d{7}$/.test(String(row?.id || ""))) repairObject(row);
    }
    fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), "utf8");
  }
  results.push({ folder: entry.name, repaired });
}

console.log(results.length ? results : "No Madrid country-code suffixes needed repair.");
