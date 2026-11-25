'use strict';

const fs = require('fs');
const { usesSourcePreview, publicationPdfBytes } = require('./publication_pdf_bytes');
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');
const { createRequestWorkbook } = require('./request_excel_export');
const { createHagueWorkbook } = require('./hague_excel_export');
const { haguePdfPath } = require('./hague_design');

function dateStamp() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function mergePdfBuffers(buffers) {
  const merged = await PDFDocument.create();
  for (const buffer of buffers.filter(Boolean)) {
    const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  if (!merged.getPageCount()) throw new Error('No PDF pages were available for this export.');
  return Buffer.from(await merged.save());
}

async function createBatchExport(payload, dependencies) {
  const outputs = payload.outputs || {};
  const orders = payload.orders || {};
  const registrations = payload.registrationsByApplication || {};
  const files = [];
  const stamp = dateStamp();

  if (outputs.excel) {
    const excel = await dependencies.exportWorkbook(dependencies.callDatabase, orders.excel || payload.applicationNos || [], payload.excelColumns || {});
    files.push({ name: excel.name || `WIPO_export_${stamp}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(excel.buffer) });
  }

  if (outputs.hagueExcel) {
    const ids = [...new Set((orders.hagueExcel || payload.hagueNos || []).filter(number => /^DM\/[0-9]{6}$/.test(String(number))))];
    if (!ids.length) throw new Error('No valid Hague registrations were selected for Excel export.');
    const saved = await dependencies.callDatabase('hague-list', { registrationNos: ids });
    const byNumber = new Map((saved.registrations || []).map(item => [item.number, item]));
    const workbook = createHagueWorkbook(ids.map(number => byNumber.get(number) || { number, data: { status: 'Not scraped' } }));
    files.push({ name: `WIPO_Hague_designs_${stamp}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
  }

  if (outputs.hagueRefusals) {
    const ids = [...new Set((orders.hagueRefusals || payload.hagueNos || []).filter(number => /^DM\/[0-9]{6}$/.test(String(number))))];
    if (!ids.length) throw new Error('No valid Hague registrations were selected for refusal export.');
    const saved = await dependencies.callDatabase('hague-list', { registrationNos: ids });
    const byNumber = new Map((saved.registrations || []).map(item => [item.number, item.data || item]));
    const notices = [];
    const seen = new Set();
    for (const number of ids) {
      for (const event of byNumber.get(number)?.events || []) {
        if (!/^Refusal\b/i.test(event.kind || '') || !event.pdfAvailable || !event.id) continue;
        const key = `${number}:${event.id}`;
        if (seen.has(key)) continue;
        const file = dependencies.resolveHaguePdf ? dependencies.resolveHaguePdf(number, event.id) : haguePdfPath(number, event.id);
        if (!file || !fs.existsSync(file)) continue;
        const buffer = fs.readFileSync(file);
        if (buffer.subarray(0, 4).toString() !== '%PDF') continue;
        seen.add(key);
        notices.push({ name: `${number.replace('/', '-')}_${event.id}_refusal.pdf`, type: 'application/pdf', buffer });
      }
    }
    if (!notices.length && Object.keys(outputs).filter(key => outputs[key]).length === 1) throw new Error('No cached Hague refusal PDFs were found for the selected designs.');
    if (payload.combineHagueRefusals && notices.length) files.push({ name: `WIPO_Hague_refusals_${stamp}.pdf`, type: 'application/pdf', buffer: await mergePdfBuffers(notices.map(item => item.buffer)) });
    else files.push(...notices);
  }

  if (outputs.requestExcel || outputs.requestPdf) {
    if (typeof dependencies.lookupRequestExportRecords !== 'function') throw new Error('Request publication export is unavailable in this host.');
    const requestNos = [...new Set(payload.requestNos || [])];
    const records = await dependencies.lookupRequestExportRecords(requestNos);
    if (outputs.requestExcel) {
      const workbook = createRequestWorkbook(records);
      files.push({ name: `WIPO_request_publications_${stamp}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
    }
    if (outputs.requestPdf) {
      const unique = new Map();
      for (const item of records) if (item.pdfPath && fs.existsSync(item.pdfPath)) unique.set(String(item.documentId), item.pdfPath);
      if (unique.size) files.push({ name: `WIPO_request_publications_${stamp}.pdf`, type: 'application/pdf',
        buffer: await mergePdfBuffers([...unique.values()].map(file => fs.readFileSync(file))) });
      else if (!outputs.requestExcel && !files.length) throw new Error('No publication PDFs were found for the selected requests.');
    }
  }

  if (outputs.applicationPdf) {
    const reportMap = new Map((payload.reports || []).map((item) => [item.applicationNo, item.html]));
    const rendered = [];
    for (const applicationNo of orders.applicationPdf || []) {
      const html = reportMap.get(applicationNo);
      if (html) rendered.push(await dependencies.renderReportPdf(html));
    }
    files.push({ name: `WIPO_application_reports_${stamp}.pdf`, type: 'application/pdf', buffer: await mergePdfBuffers(rendered) });
  }

  for (const [outputKey, category, fileLabel] of [
    ['publicationA', 'publication_a', 'publication_A'],
    ['publicationB', 'publication_b', 'publication_B'],
    ['annuity', 'annuity', 'annuity'],
  ]) {
    if (!outputs[outputKey]) continue;
    const selectedDocuments = [];
    for (const applicationNo of orders[outputKey] || payload.applicationNos || []) {
      const documents = await dependencies.listPublicationPdfs(applicationNo, registrations[applicationNo] || '');
      for (const document of documents.filter((item) => item.category === category)) {
        if (usesSourcePreview(document) || (document.pdfPath && fs.existsSync(document.pdfPath))) selectedDocuments.push(document);
      }
    }
    if (payload.sorts?.[outputKey] === 'publication_order') selectedDocuments.sort((left, right) => Number(left.cbNumber || 0) - Number(right.cbNumber || 0) || String(left.volume || '').localeCompare(String(right.volume || '')) || Number(left.book || 0) - Number(right.book || 0));
    const pdfs = [];
    for (const document of selectedDocuments) pdfs.push(await publicationPdfBytes(document));
    if (pdfs.length) files.push({ name: `WIPO_${fileLabel}_${stamp}.pdf`, type: 'application/pdf', buffer: await mergePdfBuffers(pdfs) });
  }

  if (!files.length) throw new Error('None of the selected outputs contained exportable data.');
  if (files.length === 1 && !(outputs.hagueRefusals && !payload.combineHagueRefusals)) return { ...files[0], count: 1, files: [files[0].name] };
  const zip = new JSZip();
  files.forEach((file) => zip.file(file.name, file.buffer));
  return { name: `WIPO_export_bundle_${stamp}.zip`, type: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), count: files.length, files: files.map((file) => file.name) };
}

module.exports = { mergePdfBuffers, createBatchExport };
