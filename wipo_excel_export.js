'use strict';

const ExcelJS = require('exceljs');
const { Agent } = require('undici');

const wipoImageDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

// This is the exact patent column order written by index_Wipo.js. The Excel
// export below intentionally mirrors the original WIPO Application Runner's
// Output Browser exporter instead of introducing a tracker-specific layout.
const PATENT_FIELD_LABELS = [
  'Loại đơn',
  'Loại đơn PCT',
  '(10) Số bằng và ngày cấp',
  'Trạng thái',
  '(180) Ngày hết hạn',
  '(20) Số đơn và Ngày nộp đơn',
  '(40) Số công bố và ngày công bố',
  '(86) Số đơn và ngày nộp đơn PCT',
  '(87) Số công bố và ngày công bố đơn PCT',
  '(85) Ngày vào pha quốc gia',
  '(30) Chi tiết về dữ liệu ưu tiên',
  '(51) Phân loại IPC',
  'Phân loại CPC',
  '(71/73) Chủ đơn/Chủ bằng',
  '(72) Tác giả sáng chế',
  '(74) Đại diện SHCN',
  '(73) Địa chỉ nhận thư',
  '(54) Tên',
  '(57) Tóm tắt',
  '(58) Các tài liệu đối chứng',
];

const DESIGN_FIELD_LABELS = [
  'Loại đơn', '(10) Số bằng và ngày cấp', 'Trạng thái', '(180) Ngày hết hạn',
  '(20) Số đơn và Ngày nộp đơn', '(40) Số công bố và ngày công bố',
  '(30) Chi tiết về dữ liệu ưu tiên', '(51/52) Phân loại Locarno',
  '(71/73) Chủ đơn/Chủ bằng', '(72) Tác giả kiểu dáng', '(74) Đại diện SHCN',
  '(73) Địa chỉ nhận thư', '(54) Tên kiểu dáng', 'Tóm tắt', '(53) Tổng số kiểu dáng',
  '(55) Bản chất của kiểu dáng', '(56) Yêu cầu bảo hộ kiểu dáng',
];

const TRADEMARK_FIELD_LABELS = [
  'Loại đơn', '(100) Số bằng và ngày cấp', 'Trạng thái', '(180) Ngày hết hạn',
  '(200) Số đơn và Ngày nộp đơn', '(400) Số công bố và ngày công bố',
  '(541) Nhãn hiệu', '(591) Màu sắc nhãn hiệu', '(300) Chi tiết về dữ liệu ưu tiên',
  '(511) Nhóm sản phẩm/dịch vụ', '(531) Phân loại hình', '(730) Chủ đơn/Chủ bằng',
  '(740) Đại diện SHCN', '(571) Nhãn hiệu', '(566) Nhãn hiệu dịch thuật',
  '(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)', '(526) Yếu tố loại trừ',
];

function recordType(detail) {
  const data = detail?.latest?.data || {};
  const explicit = String(data.type || '').toUpperCase();
  if (explicit === 'DESIGNS') return 'DESIGNS';
  if (explicit === 'TRADEMARKS') return 'TRADEMARKS';
  const prefix = String(data.id || detail?.applicationNo || '').match(/^([1-5])-/)?.[1];
  return prefix === '3' ? 'DESIGNS' : (prefix === '4' || prefix === '5' ? 'TRADEMARKS' : 'PATENTS');
}

function labelsForType(type) {
  return type === 'DESIGNS' ? DESIGN_FIELD_LABELS : (type === 'TRADEMARKS' ? TRADEMARK_FIELD_LABELS : PATENT_FIELD_LABELS);
}

function normalizeDotDatesForExport(value) {
  return String(value || '').replace(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g, '$1/$2/$3');
}

function extractRegNoForExport(rawRegNo) {
  // Preserve the original runner's Type-RegNo-Suffix transformation.
  const text = String(rawRegNo || '').trim();
  const parts = text.split('-');
  const regNo = parts.length === 3 ? parts[1] : text;
  return regNo.replace(/^0+(?=\d)/, '');
}

function splitRegNoAndDateForExport(rawValue) {
  const text = normalizeDotDatesForExport(rawValue).trim();
  const match = text.match(/^(\S+)\s+(\d{2}\/\d{2}\/\d{4})$/);
  if (match) return { regNo: extractRegNoForExport(match[1]), regDate: match[2] };
  return { regNo: text, regDate: '' };
}

function sourceCell(value) {
  return String(value ?? '').replace(/\r?\n/g, '<lf>').replace(/\t/g, '<t>');
}

function decodeCellMarkers(value) {
  return String(value ?? '')
    .replace(/<t><lf>/gi, '\n')
    .replace(/<lf>/gi, '\n')
    .replace(/<t>/gi, ' - ');
}

function normalizeTrademarkFieldsForExport(data) {
  const fields = data?.fields || {};
  const misplacedClasses = String(fields['(531) Phân loại hình'] || '');
  const existingClasses = String(fields['(511) Nhóm sản phẩm/dịch vụ'] || '');
  if (!/(?:Class\/Nhóm|Nhóm|Class)\s*\d+\s*:/i.test(misplacedClasses) || /(?:Class\/Nhóm|Nhóm|Class)\s*\d+\s*:/i.test(existingClasses)) return fields;

  return {
    ...fields,
    'Loại đơn': [fields['Loại đơn'], fields['(100) Số bằng và ngày cấp']].filter(Boolean).join(' | '),
    '(100) Số bằng và ngày cấp': fields['Trạng thái'] || '',
    'Trạng thái': fields['(180) Ngày hết hạn'] || '',
    '(180) Ngày hết hạn': fields['(200) Số đơn và Ngày nộp đơn'] || '',
    '(200) Số đơn và Ngày nộp đơn': fields['(400) Số công bố và ngày công bố'] || '',
    '(400) Số công bố và ngày công bố': fields['(541) Nhãn hiệu'] || '',
    '(541) Nhãn hiệu': fields['(591) Màu sắc nhãn hiệu'] || '',
    '(591) Màu sắc nhãn hiệu': fields['(300) Chi tiết về dữ liệu ưu tiên'] || '',
    '(300) Chi tiết về dữ liệu ưu tiên': fields['(511) Nhóm sản phẩm/dịch vụ'] || '',
    '(511) Nhóm sản phẩm/dịch vụ': fields['(531) Phân loại hình'] || '',
    '(531) Phân loại hình': fields['(730) Chủ đơn/Chủ bằng'] || '',
    '(730) Chủ đơn/Chủ bằng': fields['(740) Đại diện SHCN'] || '',
    '(740) Đại diện SHCN': fields['(571) Nhãn hiệu'] || '',
    '(571) Nhãn hiệu': fields['(566) Nhãn hiệu dịch thuật'] || '',
    '(566) Nhãn hiệu dịch thuật': fields['(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)'] || '',
    '(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)': fields['(526) Yếu tố loại trừ'] || '',
    '(526) Yếu tố loại trừ': '',
  };
}

function diarySourceValue(diary) {
  return (Array.isArray(diary) ? diary : []).map((entry) => {
    const date = entry?.date_text || entry?.date?.raw || '';
    const description = entry?.description || entry?.event || entry?.title || '';
    const extra = Array.isArray(entry?.extra) ? entry.extra.filter(Boolean) : (entry?.status ? [entry.status] : []);
    return [date, description, ...extra].map(sourceCell).join('<t>');
  }).join('<lf>');
}

function detailsToOriginalOutput(details) {
  const labels = labelsForType(recordType((details || [])[0]));
  const headers = ['ID', 'Image', ...labels, 'Tiến trình'];
  const rows = (details || []).map((detail) => {
    const data = detail?.latest?.data || {};
    const fields = recordType(detail) === 'TRADEMARKS' ? normalizeTrademarkFieldsForExport(data) : (data.fields || {});
    return [
      data.id || detail?.applicationNo || '',
      data.image || '',
      ...labels.map((label) => sourceCell(fields[label])),
      diarySourceValue(data.diary),
    ];
  });
  return { headers, rows };
}

/**
 * Apply the same transformations as exportOutputToExcel() in the original
 * WIPO Application Runner. Input remains in its raw Output Browser column
 * layout, allowing the tracker database to act as the source file adapter.
 */
function addReferenceOutputSheet(workbook, sheetName, sourceHeaders, sourceRows) {
  const sourceProgressColIndex = sourceHeaders.indexOf('Tiến trình');
  const regNoDateColIndex = sourceHeaders.findIndex((header) => /Số bằng và ngày cấp/.test(String(header || '')));
  const columns = sourceHeaders.slice();
  if (regNoDateColIndex >= 0) {
    columns.splice(regNoDateColIndex, 1, 'Reg. No.', 'Reg. Date (dd/mm/yyyy)');
  }

  let progressColIndex = sourceProgressColIndex;
  if (regNoDateColIndex >= 0 && sourceProgressColIndex > regNoDateColIndex) {
    progressColIndex += 1;
  }

  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(columns);
  sheet.getRow(1).font = { bold: true };

  if (progressColIndex >= 0) {
    sheet.getColumn(progressColIndex + 1).alignment = { wrapText: true, vertical: 'top' };
  }

  const wrappedColumns = new Set();
  const exportedRows = sourceRows.map((sourceRow, rowIndex) => {
    const sourceCols = sourceRow.map(decodeCellMarkers);

    const rowCols = sourceCols.map((value) => normalizeDotDatesForExport(value));
    if (regNoDateColIndex >= 0) {
      const { regNo, regDate } = splitRegNoAndDateForExport(sourceCols[regNoDateColIndex]);
      rowCols.splice(regNoDateColIndex, 1, regNo, regDate);
    }
    rowCols.forEach((value, columnIndex) => { if (String(value).includes('\n')) wrappedColumns.add(columnIndex + 1); });
    const row = sheet.addRow(rowCols);
    const maxLines = Math.max(1, ...rowCols.map((value) => String(value).split('\n').length));
    if (maxLines > 1) row.height = Math.min(90, Math.max(30, maxLines * 15));
    return rowCols;
  });

  for (const columnIndex of wrappedColumns) {
    sheet.getColumn(columnIndex).alignment = { wrapText: true, vertical: 'top' };
  }

  columns.forEach((columnName, index) => {
    if (index === progressColIndex) return;
    let longest = String(columnName || '').length;
    exportedRows.forEach((row) => {
      const value = String(row[index] || '');
      longest = Math.max(longest, Math.min(value.length, 60));
    });
    sheet.getColumn(index + 1).width = Math.min(Math.max(longest + 2, 10), 60);
  });
  if (progressColIndex >= 0) sheet.getColumn(progressColIndex + 1).width = 50;

  return sheet;
}

function imageExtension(contentType, url) {
  const value = String(contentType || '').toLowerCase();
  if (value.includes('png') || /\.png(?:$|\?)/i.test(url)) return 'png';
  if (value.includes('gif') || /\.gif(?:$|\?)/i.test(url)) return 'gif';
  return 'jpeg';
}

function trademarkDetailReferer(detail) {
  const data = detail?.latest?.data || {};
  const compact = String(data.id || detail?.applicationNo || '').replace(/-/g, '');
  return `https://wipopublish.ipvietnam.gov.vn/wopublish-search/public/detail/trademarks?id=VN${compact}`;
}

async function loadImageForExport(url, detail, fetchImpl = fetch) {
  const source = String(url || '').trim();
  const dataUrl = source.match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/i);
  if (dataUrl) return { buffer: Buffer.from(dataUrl[2], 'base64'), extension: dataUrl[1].toLowerCase().replace('jpg', 'jpeg') };
  if (!/^https?:\/\//i.test(source)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8,vi;q=0.6',
      Referer: trademarkDetailReferer(detail),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    };
    if (process.env.WIPO_COOKIE?.trim()) headers.Cookie = process.env.WIPO_COOKIE.trim();
    const options = { headers, signal: controller.signal };
    if (source.includes('wipopublish.ipvietnam.gov.vn')) options.dispatcher = wipoImageDispatcher;
    const response = await fetchImpl(source, options);
    if (!response.ok || !String(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) return null;
    return { buffer: Buffer.from(await response.arrayBuffer()), extension: imageExtension(response.headers.get('content-type'), source) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function embedTrademarkImages(workbook, sheet, details, options = {}) {
  const imageColumnIndex = 2;
  sheet.getColumn(imageColumnIndex).width = 18;
  const entries = details || [];
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      const detail = entries[index];
      const data = detail?.latest?.data || {};
      const image = await loadImageForExport(data.image, detail, options.fetchImpl);
      if (!image?.buffer?.length) continue;
      const rowNumber = index + 2;
      const imageId = workbook.addImage({ buffer: image.buffer, extension: image.extension });
      sheet.addImage(imageId, { tl: { col: 1.12, row: rowNumber - 0.92 }, ext: { width: 110, height: 78 }, editAs: 'oneCell' });
      sheet.getRow(rowNumber).height = Math.max(Number(sheet.getRow(rowNumber).height || 0), 62);
      sheet.getCell(rowNumber, imageColumnIndex).value = '';
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, () => worker()));
}

function createReferenceOutputWorkbook(sourceHeaders, sourceRows) {
  const workbook = new ExcelJS.Workbook();
  addReferenceOutputSheet(workbook, 'Output', sourceHeaders, sourceRows);
  return workbook;
}

async function createOriginalOutputWorkbook(details, options = {}) {
  const groups = new Map();
  for (const detail of details || []) {
    const type = recordType(detail);
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(detail);
  }
  if (groups.size <= 1) {
    const { headers, rows } = detailsToOriginalOutput(details);
    const workbook = createReferenceOutputWorkbook(headers, rows);
    if (recordType((details || [])[0]) === 'TRADEMARKS') await embedTrademarkImages(workbook, workbook.getWorksheet('Output'), details, options);
    return workbook;
  }
  const workbook = new ExcelJS.Workbook();
  const sheetNames = { PATENTS: 'Patents', DESIGNS: 'Designs', TRADEMARKS: 'Trademarks' };
  for (const [type, items] of groups) {
    const { headers, rows } = detailsToOriginalOutput(items);
    const sheet = addReferenceOutputSheet(workbook, sheetNames[type], headers, rows);
    if (type === 'TRADEMARKS') await embedTrademarkImages(workbook, sheet, items, options);
  }
  return workbook;
}

module.exports = {
  PATENT_FIELD_LABELS,
  DESIGN_FIELD_LABELS,
  TRADEMARK_FIELD_LABELS,
  normalizeDotDatesForExport,
  extractRegNoForExport,
  splitRegNoAndDateForExport,
  decodeCellMarkers,
  normalizeTrademarkFieldsForExport,
  loadImageForExport,
  detailsToOriginalOutput,
  createReferenceOutputWorkbook,
  createOriginalOutputWorkbook,
};
