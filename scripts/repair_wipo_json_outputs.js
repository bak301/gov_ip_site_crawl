const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const outputRoot = path.join(ROOT, "Output");

function parseDateTag(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const m = value.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
  return {
    raw: value,
    day,
    month,
    year,
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function splitPipeListPreserveOrder(value) {
  return String(value || "")
    .split(" | ")
    .map((s) => stripViPrefix(s))
    .filter(Boolean);
}

function stripViPrefix(value) {
  return String(value || "")
    .replace(/\(\s*VI\s*\)\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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

function splitPeopleWithOrder(rawPeople) {
  const items = splitPipeListPreserveOrder(rawPeople);
  return items.map((entry, index) => {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex < 0) {
      return {
        order: index + 1,
        raw: entry,
        applicant_name: entry,
        applicant_address: "",
        inventor_name: entry,
        inventor_address: "",
      };
    }

    const name = entry.slice(0, separatorIndex).trim();
    const address = entry.slice(separatorIndex + 1).trim();
    return {
      order: index + 1,
      raw: entry,
      applicant_name: name,
      applicant_address: address,
      inventor_name: name,
      inventor_address: address,
    };
  });
}

function splitNumberAndDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return { raw: text, number: "", date_text: "", date: null };
  }

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

function extractCanonicalApplicationNo(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/([1-4]-\d{4}-\d{4,})/);
  return match ? match[1] : "";
}

function rewriteFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) return { filePath, updated: 0, total: 0 };

  let updated = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const fields = row.fields || {};
    const normalizedFields = {};
    for (const [k, v] of Object.entries(fields)) {
      normalizedFields[k] = stripViPrefix(v);
    }
    row.fields = normalizedFields;

    const grantNumberDate = splitNumberAndDate(normalizedFields["(10) Số bằng và ngày cấp"] || normalizedFields["(100) Số bằng và ngày cấp"]);
    const applicationNumberDate = splitNumberAndDate(normalizedFields["(20) Số đơn và Ngày nộp đơn"] || normalizedFields["(200) Số đơn và Ngày nộp đơn"]);
    applicationNumberDate.application_no = extractCanonicalApplicationNo(applicationNumberDate.number || applicationNumberDate.raw);
    const publicationNumberDate = splitNumberAndDate(normalizedFields["(40) Số công bố và ngày công bố"] || normalizedFields["(400) Số công bố và ngày công bố"]);
    const pctApplicationNumberDate = splitNumberAndDate(normalizedFields["(86) Số đơn và ngày nộp đơn PCT"] || "");
    const pctPublicationNumberDate = splitNumberAndDate(normalizedFields["(87) Số công bố và ngày công bố đơn PCT"] || "");
    const nationalPhaseEntryDate = parseDateTag(normalizedFields["(85) Ngày vào pha quốc gia"] || "");
    const priorityDetails = parsePriorityDetails(normalizedFields["(30) Chi tiết về dữ liệu ưu tiên"] || normalizedFields["(300) Chi tiết về dữ liệu ưu tiên"] || "");
    const ipcClassifications = parseClassificationList(normalizedFields["(51) Phân loại IPC"] || "");
    const cpcClassifications = parseClassificationList(normalizedFields["Phân loại CPC"] || "");
    const representativesOrdered = parseNamedAddressList(normalizedFields["(74) Đại diện SHCN"] || normalizedFields["(740) Đại diện SHCN"] || "", "representative");
    const title = stripViPrefix(normalizedFields["(54) Tên"] || normalizedFields["(54) Tên kiểu dáng"] || normalizedFields["(571) Nhãn hiệu"] || "");
    const abstract = stripViPrefix(normalizedFields["(57) Tóm tắt"] || normalizedFields["Tóm tắt"] || "");

    const splitFields = {
      grant_number_date: grantNumberDate,
      status: String(normalizedFields["Trạng thái"] || "").trim(),
      expiry_date: parseDateTag(normalizedFields["(180) Ngày hết hạn"] || ""),
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

    const applicantRaw = normalizedFields["(71/73) Chủ đơn/Chủ bằng"] || normalizedFields["(730) Chủ đơn/Chủ bằng"] || "";
    const inventorRaw = normalizedFields["(72) Tác giả sáng chế"] || normalizedFields["(72) Tác giả kiểu dáng"] || "";

    row.applicants = splitPipeListPreserveOrder(applicantRaw);
    row.inventors = splitPipeListPreserveOrder(inventorRaw);

    row.applicants_ordered = splitPeopleWithOrder(applicantRaw).map((x) => ({
      order: x.order,
      raw: x.raw,
      applicant_name: x.applicant_name,
      applicant_address: x.applicant_address,
    }));

    row.inventors_ordered = splitPeopleWithOrder(inventorRaw).map((x) => ({
      order: x.order,
      raw: x.raw,
      inventor_name: x.inventor_name,
      inventor_address: x.inventor_address,
    }));
    row.split_fields = splitFields;
    updated += 1;
  }

  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf8");
  return { filePath, updated, total: rows.length };
}

function main() {
  if (!fs.existsSync(outputRoot)) {
    console.error("Output folder not found.");
    process.exit(1);
  }

  const reports = [];
  const dateDirs = fs.readdirSync(outputRoot, { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const d of dateDirs) {
    const folder = path.join(outputRoot, d.name);
    const files = fs.readdirSync(folder, { withFileTypes: true })
      .filter((f) => f.isFile() && /^((SC|KD|NH)_WIPO_\d{4}-\d{2}-\d{2})\.json$/i.test(f.name))
      .map((f) => path.join(folder, f.name));

    for (const filePath of files) {
      reports.push(rewriteFile(filePath));
    }
  }

  for (const r of reports) {
    console.log(`${path.relative(ROOT, r.filePath)} | total=${r.total} | updated=${r.updated}`);
  }
}

main();
