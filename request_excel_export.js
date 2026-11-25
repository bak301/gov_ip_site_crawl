'use strict';

const ExcelJS = require('exceljs');

const FIELD_NAMES = {
  Request_Number: 'Request no.', Application_Number: 'Application / request no.',
  'Request No': 'Request no.', 'Request Date': 'Request date', Request_Date: 'Request date',
  Filing_Date: 'Filing date', Decision_Number: 'Decision no.', Decision_Date: 'Decision date',
  'Notice No': 'Notice no.', 'Notice Date': 'Notice date',
  Registration_Number: 'Registration no.', Registration_Date: 'Grant date', Grant_Date: 'Grant date',
  Renewal_To: 'Renewed until', Renewal_Until: 'Renewed until', Renewed_Until: 'Renewed until',
  'Patent No': 'Registration no.', 'Grant Date': 'Grant date', 'Valid Until': 'Valid until',
  'Annuity Year': 'Annuity year', Product_Groups: 'Product groups', Classes: 'Classes',
  Owner_Address: 'Owner address', Source_File: 'Source volume', 'Source File': 'Source volume', Page: 'Source page',
};
const PREFERRED = [
  'Request_Number', 'Application_Number', 'Decision_Number', 'Decision_Date', 'Notice No', 'Notice Date',
  'Request_Date', 'Request Date', 'Filing_Date', 'Registration_Number', 'Patent No',
  'Registration_Date', 'Grant_Date', 'Grant Date', 'Renewal_To', 'Renewal_Until', 'Renewed_Until',
  'Valid Until', 'Annuity Year', 'Owner', 'Owner_Address', 'Applicant', 'Classes', 'Product_Groups',
  'Source_File', 'Page',
];
const auditFields = new Set(['Raw_Text', 'Registration_Table_Text']);
const heading = key => FIELD_NAMES[key] || String(key).replace(/_/g, ' ');
const text = value => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).join('\n');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${heading(key)}: ${text(item)}`).join('\n');
  return String(value).replace(/<lf>/gi, '\n').slice(0, 32767);
};

function createRequestWorkbook(records) {
  if (!Array.isArray(records) || !records.length) throw new Error('No extracted request publications are available for Excel export.');
  const fields = new Set();
  const registrationFields = new Set();
  for (const item of records) {
    const record = item.record || {};
    Object.keys(record).filter(key => key !== 'Registrations' && !auditFields.has(key)).forEach(key => fields.add(key));
    for (const registration of Array.isArray(record.Registrations) ? record.Registrations : []) {
      Object.keys(registration || {}).forEach(key => registrationFields.add(key));
    }
  }
  const registrationKeys = [...['Position', 'Registration_Number', 'Registration_Date', 'Grant_Date', 'Renewal_To', 'Renewal_Until', 'Renewed_Until', 'Classes', 'Product_Groups']
    .filter(key => registrationFields.delete(key)), ...registrationFields];
  const uniqueByHeading = keys => {
    const seen = new Set();
    return keys.filter(key => { const label = heading(key); if (seen.has(label)) return false; seen.add(label); return true; });
  };
  const orderedRegistrations = uniqueByHeading(registrationKeys);
  const registrationHeadings = new Set(orderedRegistrations.map(heading));
  const reservedHeadings = new Set(['Request no.', 'Source volume', 'PDF status', 'Record type', 'Bulletin no.']);
  const orderedFields = uniqueByHeading([...PREFERRED.filter(key => fields.delete(key)), ...fields]
    .filter(key => !registrationHeadings.has(heading(key)) && !reservedHeadings.has(heading(key))));
  const columns = [
    { header: 'Request no.', key: '__request', width: 21 },
    { header: 'Record type', key: '__kind', width: 25 },
    { header: 'PDF status', key: '__status', width: 14 },
    { header: 'Source volume', key: '__source', width: 43 },
    { header: 'Bulletin no.', key: '__bulletin', width: 13 },
    ...orderedFields.map(key => ({ header: heading(key), key: `field:${key}`, width: /Address|Owner|Applicant|Goods/i.test(key) ? 38 : 22 })),
    ...orderedRegistrations.map(key => ({ header: heading(key), key: `registration:${key}`, width: /Classes|Groups/i.test(key) ? 32 : 21 })),
  ];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Publication requests', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  sheet.getRow(1).height = 27;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244866' } };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  for (const item of records) {
    const record = item.record || {};
    const registrations = Array.isArray(record.Registrations) ? record.Registrations : [];
    const values = {
      __request: item.requestNo || '', __kind: item.modeId === '4' ? 'Patent annuity' : item.modeId === '13' ? 'Design renewal' : 'Trademark renewal',
      __status: item.status || 'Found',
      __source: item.sourceFile || '', __bulletin: item.cbNumber || '',
    };
    orderedFields.forEach(key => {
      const candidate = Object.keys(record).find(field => heading(field) === heading(key) && text(record[field]));
      values[`field:${key}`] = text(candidate ? record[candidate] : '');
    });
    orderedRegistrations.forEach(key => {
      const matchingKeys = registrationKeys.filter(candidate => heading(candidate) === heading(key));
      const nested = registrations.map(registration => text(matchingKeys.map(candidate => registration?.[candidate]).find(Boolean))).join('\n');
      const topLevel = Object.keys(record).find(candidate => heading(candidate) === heading(key) && text(record[candidate]));
      values[`registration:${key}`] = nested.trim() ? nested : text(topLevel ? record[topLevel] : '');
    });
    const row = sheet.addRow(values);
    row.alignment = { vertical: 'top', wrapText: true };
    const visibleLines = Math.max(1, ...Object.values(values).map(value => String(value || '').split('\n').length));
    row.height = Math.min(400, Math.max(25, 17 * visibleLines));
  }
  return workbook;
}

module.exports = { createRequestWorkbook };
