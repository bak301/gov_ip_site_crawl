'use strict';

const ExcelJS = require('exceljs');

function lines(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].join('\n');
}

function vnApplicationNos(record) {
  return [...new Set((record.events || []).filter(event => /refusal/i.test(event.kind || ''))
    .flatMap(event => event.pdfData?.vnApplicationNos || []))];
}

function dateValue(value) {
  const match = String(value || '').match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return value || '';
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return date.getUTCFullYear() === Number(match[3]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[1]) ? date : value;
}

function styleSheet(sheet, dateColumns = []) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  const header = sheet.getRow(1);
  header.height = 29;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244866' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  for (const key of dateColumns) sheet.getColumn(key).numFmt = 'dd/mm/yyyy';
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = Math.min(240, Math.max(24, 17 * Math.max(...row.values.slice(1).map(value => String(value || '').split('\n').length))));
  });
}

function createHagueWorkbook(records) {
  if (!Array.isArray(records) || !records.length) throw new Error('No Hague designs are available for Excel export.');
  const workbook = new ExcelJS.Workbook();
  const designs = workbook.addWorksheet('Hague designs');
  designs.columns = [
    { header: 'Hague registration no.', key: 'number', width: 23 },
    { header: 'VN application no. (refusal PDF)', key: 'vnApplicationNos', width: 27 },
    { header: 'VN status', key: 'status', width: 18 },
    { header: 'Last scraped', key: 'lastScrapedAt', width: 22 },
    { header: 'International registration date', key: 'registrationDate', width: 24 },
    { header: 'Filing date', key: 'filingDate', width: 18 },
    { header: 'Expected expiration', key: 'expirationDate', width: 22 },
    { header: 'Designs', key: 'numberOfDesigns', width: 12 },
    { header: 'Holder(s)', key: 'holders', width: 44 },
    { header: 'Representative(s)', key: 'representatives', width: 44 },
    { header: 'Creator(s)', key: 'creators', width: 44 },
    { header: 'Indication of products', key: 'products', width: 44 },
    { header: 'Locarno class', key: 'locarno', width: 23 },
    { header: 'Designated parties', key: 'designatedParties', width: 39 },
    { header: 'Other WIPO fields', key: 'otherFields', width: 60 },
    { header: 'WIPO record URL', key: 'url', width: 55 },
  ];
  const decisions = workbook.addWorksheet('VN decisions');
  decisions.columns = [
    { header: 'Hague registration no.', key: 'number', width: 23 },
    { header: 'Decision', key: 'kind', width: 19 },
    { header: 'Bulletin no.', key: 'bulletinNo', width: 18 },
    { header: 'Bulletin date', key: 'bulletinDate', width: 18 },
    { header: 'VN application no.', key: 'vnApplicationNos', width: 26 },
    { header: 'Decision no.', key: 'decisionNo', width: 29 },
    { header: 'Decision date', key: 'decisionDate', width: 18 },
    { header: 'Effect date', key: 'effectDate', width: 18 },
    { header: 'Recorded date', key: 'recordedDate', width: 18 },
    { header: 'Scope', key: 'scope', width: 24 },
    { header: 'Grounds for refusal', key: 'refusalGrounds', width: 65 },
    { header: 'Amendments', key: 'amendments', width: 45 },
    { header: 'WIPO history fields', key: 'fields', width: 65 },
    { header: 'PDF URL', key: 'pdfUrl', width: 65 },
  ];
  for (const item of records) {
    const record = item.data || item;
    const fields = record.fields || [];
    const fieldValue = code => lines(fields.filter(field => field.code === code).map(field => field.value));
    const people = values => lines((values || []).map(person => [person.designNo && `Design ${person.designNo}`, person.name, person.address].filter(Boolean).join(' — ')));
    designs.addRow({
      number: item.number || record.number || '', vnApplicationNos: lines(vnApplicationNos(record)),
      status: record.status || 'Not scraped', lastScrapedAt: item.lastScrapedAt ? new Date(item.lastScrapedAt) : '',
      registrationDate: dateValue(record.registrationDate), filingDate: dateValue(record.filingDate),
      expirationDate: dateValue(record.expirationDate), numberOfDesigns: record.numberOfDesigns || '',
      holders: people(record.holders), representatives: people(record.representatives), creators: people(record.creators),
      products: fieldValue('54'), locarno: fieldValue('51'), designatedParties: fieldValue('81'),
      otherFields: lines(fields.filter(field => !['11', '15', '18', '22', '51', '54', '72', '73', '74', '81'].includes(field.code))
        .map(field => `(${field.code || '—'}) ${field.label}: ${field.value}`)), url: record.url || '',
    });
    for (const event of record.events || []) decisions.addRow({
      number: item.number || record.number || '', kind: event.kind || '', bulletinNo: event.bulletinNo || '',
      bulletinDate: dateValue(event.bulletinDate), vnApplicationNos: lines(event.pdfData?.vnApplicationNos || []),
      decisionNo: event.pdfData?.decisionNo || '', decisionDate: dateValue(event.pdfData?.decisionDate),
      effectDate: dateValue(event.pdfData?.effectDate || event.effectiveDate), recordedDate: dateValue(event.recordedDate),
      scope: event.pdfData?.scope || event.scope || '', refusalGrounds: event.pdfData?.refusalGrounds || '',
      amendments: event.pdfData?.amendments || '',
      fields: lines((event.fields || []).map(field => `(${field.code || '—'}) ${field.label}: ${field.value}`)), pdfUrl: event.pdfUrl || '',
    });
  }
  styleSheet(designs, ['lastScrapedAt', 'registrationDate', 'filingDate', 'expirationDate']);
  styleSheet(decisions, ['bulletinDate', 'decisionDate', 'effectDate', 'recordedDate']);
  return workbook;
}

module.exports = { createHagueWorkbook, vnApplicationNos };
