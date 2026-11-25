'use strict';

const { hasIndexedPages, publicationResourceBytes } = require('../3_Input/Pub/Publication extraction/publication_gui/publication_pdf_resource');
// Retained for source-view compatibility; default previews now use assembled entries.
const SOURCE_PREVIEW_MODES = new Set(['1', '2', '3', '5', '7', '10', '11', '12']);
function usesSourcePreview(document) { return hasIndexedPages(document); }
async function publicationPdfBytes(document) {
  return publicationResourceBytes(document, document.repositoryDatabase ? { databasePath: document.repositoryDatabase } : {});
}
module.exports = { SOURCE_PREVIEW_MODES, usesSourcePreview, publicationPdfBytes };
