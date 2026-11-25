'use strict';

const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { usesSourcePreview, publicationPdfBytes } = require('./publication_pdf_bytes');

async function mergePublicationPdfs(documents) {
  const sources = (Array.isArray(documents) ? documents : []).filter((item) => usesSourcePreview(item) || (item?.pdfPath && fs.existsSync(item.pdfPath)));
  if (!sources.length) throw new Error('No publication PDF documents were available to merge.');
  const merged = await PDFDocument.create();
  for (const source of sources) {
    const input = await PDFDocument.load(await publicationPdfBytes(source));
    const pages = await merged.copyPages(input, input.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return Buffer.from(await merged.save());
}

module.exports = { mergePublicationPdfs };
