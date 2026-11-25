const APPLICATION_PATTERN = /(?:^|[^A-Z0-9])([1-5]-\d{4}-\d{4,})(?![A-Z0-9])/gi;
const COMPACT_APPLICATION_PATTERN = /(?:^|[^A-Z0-9])(?:VN)?([1-5])(\d{4})(\d{4,})(?![A-Z0-9])/gi;
const MADRID_PATTERN = /(?:^|[^A-Z0-9])(5-\d{5,9}[A-Z]?)(?![A-Z0-9])/gi;
const REGISTRATION_TYPES = Object.freeze({
  patent: { prefixes: ["1", "2"], defaultPrefix: "1" },
  design: { prefixes: ["3"], defaultPrefix: "3" },
  trademark: { prefixes: ["4"], defaultPrefix: "4" },
});

function normalizeApplicationNo(value) {
  const text = String(value || "").trim().toUpperCase();
  const match = text.match(/(?:^|[^A-Z0-9])([1-5]-\d{4}-\d{4,})(?![A-Z0-9])/i);
  if (match) return match[1];
  const madrid = text.match(/(?:^|[^A-Z0-9])(5-\d{5,9}[A-Z]?)(?![A-Z0-9])/i);
  if (madrid) return madrid[1];
  const compact = text.match(/(?:^|[^A-Z0-9])(?:VN)?([1-5])(\d{4})(\d{4,})(?![A-Z0-9])/i);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : "";
}

function parseApplicationNumbers(input) {
  const values = Array.isArray(input) ? input : String(input || "").split(/[\r\n,;\t]+/);
  const found = [];
  const seen = new Set();

  for (const value of values) {
    const text = String(value || "").trim();
    const matches = [...text.matchAll(APPLICATION_PATTERN)].map((match) => match[1]);
    for (const match of text.matchAll(MADRID_PATTERN)) matches.push(match[1]);
    for (const match of text.matchAll(COMPACT_APPLICATION_PATTERN)) matches.push(`${match[1]}-${match[2]}-${match[3]}`);
    if (!matches.length && text) matches.push(text);
    for (const candidate of matches) {
      const normalized = normalizeApplicationNo(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      found.push(normalized);
    }
  }
  return found;
}

function registrationTypeForPrefix(prefix) {
  if (prefix === "1" || prefix === "2") return "patent";
  if (prefix === "3") return "design";
  if (prefix === "4") return "trademark";
  return "";
}

function normalizeRegistrationNo(value, selectedType = "patent") {
  const text = String(value || "").trim().toUpperCase().replace(/\s+B\s*$/, "");
  if (!text) return null;
  // A WIPO application number can otherwise be mistaken for a registration
  // number by treating its year as the registration's significant digits.
  if (normalizeApplicationNo(text)) return null;
  const explicit = text.match(/(?:^|[^A-Z0-9])([1-4])\s*[-/]\s*0*(\d{1,7})(?:\s*[-/]\s*(\d{1,3}))?(?!\d)/);
  const digitsOnly = !explicit && text.match(/^0*(\d{1,7})(?:\s*[-/]\s*(\d{1,3}))?$/);
  if (!explicit && !digitsOnly) return null;
  const requestedType = Object.hasOwn(REGISTRATION_TYPES, selectedType) ? selectedType : "patent";
  const prefix = explicit ? explicit[1] : REGISTRATION_TYPES[requestedType].defaultPrefix;
  const type = registrationTypeForPrefix(prefix);
  const numberValue = String(explicit ? explicit[2] : digitsOnly[1]).replace(/^0+(?=\d)/, "");
  if (!numberValue || numberValue.length > 7) return null;
  const number = numberValue.padStart(7, "0");
  const suffix = String((explicit ? explicit[3] : digitsOnly[2]) || "000").padStart(3, "0");
  return { type, prefix, number, suffix, lookupKey: numberValue, formatted: `${prefix}-${number}-${suffix}` };
}

function parseRegistrationNumbers(input, selectedType = "patent") {
  const values = Array.isArray(input) ? input : String(input || "").split(/[\r\n,;\t]+/);
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const parsed = normalizeRegistrationNo(value, selectedType);
    if (!parsed || seen.has(parsed.formatted)) continue;
    seen.add(parsed.formatted);
    result.push(parsed);
  }
  return result;
}

function getRecordApplicationNo(record) {
  return normalizeApplicationNo(
    record?.split_fields?.application_number_date?.application_no ||
    record?.split_fields?.application_number_date?.number ||
    record?.fields?.["(20) Số đơn và Ngày nộp đơn"] ||
    record?.fields?.["(200) Số đơn và Ngày nộp đơn"] ||
    record?.id ||
    ""
  );
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (key !== "scraped_at") result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value == null ? "" : value;
}

function flattenRecord(record, prefix = "", output = {}) {
  if (Array.isArray(record)) {
    output[prefix] = JSON.stringify(stableValue(record));
    return output;
  }
  if (record && typeof record === "object") {
    for (const [key, value] of Object.entries(record)) {
      if (key === "scraped_at") continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) flattenRecord(value, path, output);
      else output[path] = Array.isArray(value) ? JSON.stringify(stableValue(value)) : String(value ?? "");
    }
    return output;
  }
  output[prefix] = String(record ?? "");
  return output;
}

function diffRecords(previous, current) {
  const changes = [];
  const display = (value) => value == null ? "" : (typeof value === "object" ? JSON.stringify(stableValue(value)) : String(value));
  const rowIdentity = (path, row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return `value:${display(row)}`;
    if (path === "diary") {
      const date = row.date && typeof row.date === "object" ? (row.date.iso || row.date.raw) : row.date;
      const dateText = date || row.date_text || "";
      const event = row.description || row.event || row.title || row.raw || "";
      if (dateText || event) return `event:${dateText}|${event}`;
    }
    for (const key of ["application_no", "priority_no", "reference_no", "applicant_name", "inventor_name", "representative_name", "name", "code", "number", "id"])
      if (row[key] != null && row[key] !== "") return `${key}:${row[key]}`;
    if (row.order != null && row.order !== "") return `order:${row.order}`;
    return `value:${display(row)}`;
  };
  const indexedRows = (path, rows) => {
    const result = new Map();
    const seen = new Map();
    rows.forEach((row, index) => {
      const identity = rowIdentity(path, row);
      const occurrence = (seen.get(identity) || 0) + 1;
      seen.set(identity, occurrence);
      result.set(`${identity}#${occurrence}`, { index, row });
    });
    return result;
  };
  const compare = (path, oldValue, newValue) => {
    if ((oldValue && typeof oldValue === "object" && !Array.isArray(oldValue)) || (newValue && typeof newValue === "object" && !Array.isArray(newValue))) {
      const oldObject = oldValue && typeof oldValue === "object" && !Array.isArray(oldValue) ? oldValue : {};
      const newObject = newValue && typeof newValue === "object" && !Array.isArray(newValue) ? newValue : {};
      for (const key of new Set([...Object.keys(oldObject), ...Object.keys(newObject)]))
        if (key !== "scraped_at") compare(path ? `${path}.${key}` : key, oldObject[key], newObject[key]);
      return;
    }
    if (Array.isArray(oldValue) || Array.isArray(newValue)) {
      const oldRows = indexedRows(path, Array.isArray(oldValue) ? oldValue : []);
      const newRows = indexedRows(path, Array.isArray(newValue) ? newValue : []);
      for (const identity of new Set([...oldRows.keys(), ...newRows.keys()])) {
        const oldEntry = oldRows.get(identity), newEntry = newRows.get(identity);
        if (JSON.stringify(stableValue(oldEntry?.row)) === JSON.stringify(stableValue(newEntry?.row))) continue;
        changes.push({ field: `${path}[${newEntry?.index ?? oldEntry.index}]`, oldValue: display(oldEntry?.row), newValue: display(newEntry?.row), changeType: oldEntry && newEntry ? "changed" : newEntry ? "added" : "removed" });
      }
      return;
    }
    if (display(oldValue) !== display(newValue)) changes.push({ field: path, oldValue: display(oldValue), newValue: display(newValue) });
  };
  compare("", previous || {}, current);
  return changes.sort((a, b) => a.field.localeCompare(b.field));
}

const CITED_DOCUMENT_HEADER = "Tài liệu được đối chứngTài liệu tham khảoDanh mụcYêu cầu bảo hộLoại tài liệu đối chứng";

function parseCitedDocuments(value) {
  const text = String(value || "").trim();
  if (!text) return [];

  if (text.includes("<t>") || text.includes("<lf>")) {
    return text.split("<lf>").map((row) => {
      const cells = row.split("<t>").map((cell) => cell.trim());
      if (cells.length < 2 || !cells.some(Boolean)) return null;
      return {
        reference_no: cells[0] || "",
        reference_date: cells[1] || "",
        reference_text: cells[2] || "",
        claim_type: cells[3] || "",
        document_type: cells[4] || "",
      };
    }).filter(Boolean);
  }

  const body = text.startsWith(CITED_DOCUMENT_HEADER) ? text.slice(CITED_DOCUMENT_HEADER.length).trim() : text;
  const starts = [...body.matchAll(/(?:^|\s)(\d+)\s*(\d{4}-\d{2}-\d{2})\s+/g)];
  return starts.map((match, index) => {
    const chunkEnd = index + 1 < starts.length ? starts[index + 1].index : body.length;
    let remainder = body.slice(match.index + match[0].length, chunkEnd).trim();
    let documentType = "";
    const typeMatch = remainder.match(/(Sáng chế|Kiểu dáng công nghiệp|Nhãn hiệu)\s*$/i);
    if (typeMatch) {
      documentType = typeMatch[1];
      remainder = remainder.slice(0, typeMatch.index).trim();
    }
    let claimType = "";
    const claimMatch = remainder.match(/(Notification and Report)\s*$/i);
    if (claimMatch) {
      claimType = claimMatch[1];
      remainder = remainder.slice(0, claimMatch.index).trim();
    }
    return {
      reference_no: match[1],
      reference_date: match[2],
      reference_text: remainder,
      claim_type: claimType,
      document_type: documentType,
    };
  });
}

module.exports = {
  APPLICATION_PATTERN,
  COMPACT_APPLICATION_PATTERN,
  normalizeApplicationNo,
  parseApplicationNumbers,
  REGISTRATION_TYPES,
  registrationTypeForPrefix,
  normalizeRegistrationNo,
  parseRegistrationNumbers,
  getRecordApplicationNo,
  flattenRecord,
  diffRecords,
  parseCitedDocuments,
};
