const fs = require("fs");
const path = require("path");

function parseDate(value) {
  const match = String(value || "").match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (!match) return null;
  return {
    raw: match[0],
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3]),
    iso: `${match[3]}-${match[2]}-${match[1]}`,
  };
}

function repairFolder(folderPath) {
  const folderName = path.basename(folderPath);
  const txtPath = path.join(folderPath, `NH_WIPO_${folderName}.txt`);
  const jsonPath = path.join(folderPath, `NH_WIPO_${folderName}.json`);
  if (!fs.existsSync(txtPath)) return { folderName, repaired: 0 };

  const lines = fs.readFileSync(txtPath, "utf8").split(/\r?\n/);
  const headers = String(lines[0] || "").split("\t");
  const idIndex = headers.indexOf("ID");
  const regIndex = headers.findIndex((header) => /^\(100\)/.test(header));
  const appIndex = headers.findIndex((header) => /^\(200\)/.test(header));
  if (idIndex < 0 || regIndex < 0 || appIndex < 0) return { folderName, repaired: 0 };

  const repairedValues = new Map();
  for (let index = 1; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    const columns = lines[index].split("\t");
    const id = String(columns[idIndex] || "").trim();
    if (!/^5-\d{7}$/.test(id) || String(columns[appIndex] || "").trim()) continue;
    const date = String(columns[regIndex] || "").match(/\d{2}[./-]\d{2}[./-]\d{4}/)?.[0] || "";
    const value = [id, date].filter(Boolean).join(" ");
    columns[appIndex] = value;
    lines[index] = columns.join("\t");
    repairedValues.set(id, value);
  }

  if (repairedValues.size === 0) return { folderName, repaired: 0 };
  fs.writeFileSync(txtPath, lines.join("\n"), "utf8");

  if (fs.existsSync(jsonPath)) {
    const rows = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const applicationHeader = headers[appIndex];
    for (const row of rows) {
      const value = repairedValues.get(String(row?.id || "").trim());
      if (!value) continue;
      const date = parseDate(value);
      row.fields = row.fields || {};
      row.fields[applicationHeader] = value;
      row.split_fields = row.split_fields || {};
      row.split_fields.application_number_date = {
        raw: value,
        number: row.id,
        date_text: date?.raw || "",
        date,
        application_no: row.id,
      };
    }
    fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), "utf8");
  }

  return { folderName, repaired: repairedValues.size };
}

const outputRoot = path.resolve(__dirname, "..", "Output");
const results = fs.readdirSync(outputRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
  .map((entry) => repairFolder(path.join(outputRoot, entry.name)))
  .filter((result) => result.repaired > 0);

console.log(results.length ? results : "No Madrid application-number rows needed repair.");
