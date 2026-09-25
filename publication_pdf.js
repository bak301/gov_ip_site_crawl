'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { listPatentPublicationJsonFiles, normalizeApplicationNo } = require('../23_Patent Case Check/publication_data');
const { lookupDocuments } = require('../3_Input/Pub/Publication extraction/publication_gui/publication_pdf_database');

const PUBLICATION_ROOT = path.resolve(__dirname, '..', '3_Input', 'Pub', 'Output_Publication');
const PUBLICATION_DATABASE = path.join(PUBLICATION_ROOT, 'GUI_Cache', 'publication_cache.sqlite');
const PUBLICATION_PDF_DATABASE = path.join(PUBLICATION_ROOT, 'GUI_Cache', 'publication_pdf_repository.sqlite');
const PUBLICATION_PDF_REPOSITORY = path.join(PUBLICATION_ROOT, 'GUI_Cache', 'Publication_PDF_Repository');
const LOOKUP_HELPER = path.join(__dirname, 'publication_pdf_lookup.py');
const APPLICATION_PDF_ROOT = path.resolve(process.env.SOFTIP_APPLICATION_PDF_DIR || path.join(PUBLICATION_ROOT, 'GUI_Cache', 'Application_PDFs'));
const DEFAULT_PDF_ROOTS = [
  process.env.SOFTIP_PUBLICATION_PDF_DIR,
  'D:\\WORK_HIEP\\OneDrive\\14_Vision\\7_Publication collection\\All Publication',
  'D:\\WORK_HIEP\\6_Vision\\1_Patent\\4_Publication (Pat)\\1_Monthly Pub',
].filter(Boolean);
const resolutionCache = new Map();
const resolutionJobs = new Map();
const documentListCache = new Map();
let pdfInventory;
const historicalPreparationJobs = new Map();

function firstValue(record, aliases) {
  for (const key of aliases) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function canonicalApplicationNo(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/[123]-\d{4}-\d{5}/);
  return match ? match[0] : normalizeApplicationNo(text);
}

function parsePublicationPages(value) {
  const pages = [];
  const seen = new Set();
  const add = (page) => {
    const number = Number(page);
    if (Number.isInteger(number) && number > 0 && !seen.has(number)) {
      seen.add(number);
      pages.push(number);
    }
  };
  for (const token of String(value || '').split(/[,;]+/)) {
    const range = token.trim().match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end >= start && end - start <= 100) for (let page = start; page <= end; page += 1) add(page);
      continue;
    }
    for (const match of token.matchAll(/\d+/g)) add(match[0]);
  }
  return pages;
}

function applicationPdfPaths(applicationNo, cacheRoot = APPLICATION_PDF_ROOT) {
  const canonical = canonicalApplicationNo(applicationNo).replace(/[\\/:*?"<>|]/g, '_');
  return {
    pdfPath: path.join(cacheRoot, `${canonical}.pdf`),
    manifestPath: path.join(cacheRoot, `${canonical}.json`),
  };
}

function readCachedApplicationPdf(applicationNo, cacheRoot = APPLICATION_PDF_ROOT) {
  const paths = applicationPdfPaths(applicationNo, cacheRoot);
  if (!fs.existsSync(paths.pdfPath) || !fs.existsSync(paths.manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
    if (!Array.isArray(manifest.sourcePages) || !manifest.sourcePages.length || fs.statSync(paths.pdfPath).size < 5) return null;
    return {
      applicationNo: manifest.applicationNo || canonicalApplicationNo(applicationNo),
      publicationNo: manifest.publicationNo || '',
      pages: manifest.pages || manifest.sourcePages.join(', '),
      sourcePages: manifest.sourcePages,
      page: 1,
      pdfPath: paths.pdfPath,
      sourceFile: manifest.sourceFile || path.basename(paths.pdfPath),
      cachedFile: path.basename(paths.pdfPath),
      source: 'application publication PDF cache',
      cached: true,
    };
  } catch { return null; }
}

function queryPublicationDatabase(applicationNo, registrationNo = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(String(process.env.WIPO_PYTHON || 'python'), [LOOKUP_HELPER, PUBLICATION_DATABASE, applicationNo, PUBLICATION_PDF_DATABASE, registrationNo], {
      cwd: __dirname, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Publication lookup exited with code ${code}.`));
      try { resolve(JSON.parse(stdout || '{"record":null}')); }
      catch { reject(new Error('Publication lookup returned invalid JSON.')); }
    });
  });
}

function upsertPublicationDocument(document) {
  return new Promise((resolve, reject) => {
    const child = spawn(String(process.env.WIPO_PYTHON || 'python'), [LOOKUP_HELPER, '--upsert-document', PUBLICATION_PDF_DATABASE], {
      cwd: __dirname, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Publication repository update exited with code ${code}.`));
      try { resolve(JSON.parse(stdout || '{}')); }
      catch { reject(new Error('Publication repository update returned invalid JSON.')); }
    });
    child.stdin.end(JSON.stringify(document));
  });
}

async function prepareHistoricalPublicationDocument(applicationNo) {
  const historical = lookupHistoricalRecord(applicationNo);
  if (!historical?.record) return [];
  const sourcePath = resolvePdfPath(historical);
  if (!sourcePath) throw new Error(`The source bulletin ${historical.sourceFile || ''} was not found.`);
  const pages = parsePublicationPages(firstValue(historical.record, ['Pages', 'Page', 'Page Numbers', 'Trang']));
  if (!pages.length) throw new Error(`No source pages were recorded for ${canonicalApplicationNo(applicationNo)}.`);

  const { PDFDocument } = require('pdf-lib');
  const sourceBytes = await fs.promises.readFile(sourcePath);
  const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const validPages = pages.filter(page => page >= 1 && page <= sourcePdf.getPageCount());
  if (validPages.length !== pages.length) throw new Error(`Page designation ${pages.join(', ')} exceeds the ${sourcePdf.getPageCount()}-page source PDF.`);
  const identity = classifyPdf(sourcePath) || { cb: 0, volume: 'A', book: '1' };
  const outputFolder = path.join(PUBLICATION_PDF_REPOSITORY, `CB_${identity.cb || 'Unknown'}_${identity.volume || 'A'}${identity.book || ''}`, 'Publication_A');
  const canonical = canonicalApplicationNo(applicationNo);
  const pdfPath = path.join(outputFolder, `${canonical}.pdf`);
  await fs.promises.mkdir(outputFolder, { recursive: true });
  const output = await PDFDocument.create();
  const copiedPages = await output.copyPages(sourcePdf, validPages.map(page => page - 1));
  copiedPages.forEach(page => output.addPage(page));
  const temporaryPath = `${pdfPath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryPath, await output.save());
  await fs.promises.rm(pdfPath, { force: true });
  await fs.promises.rename(temporaryPath, pdfPath);
  const stat = await fs.promises.stat(sourcePath);
  await upsertPublicationDocument({
    category: 'publication_a', lookupKey: canonical, modeId: '1', applicationNumber: canonical,
    registrationNumber: '', requestNumber: '', publicationNumber: firstValue(historical.record, ['Publication_Number', 'Publication Number']),
    sourcePath, sourceFile: path.basename(sourcePath), cbNumber: identity.cb || 0, volume: identity.volume || 'A', book: identity.book || '1',
    sourcePages: validPages.join(', '), sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, pdfPath,
    pageCount: validPages.length, record: historical.record, generatedAt: new Date().toISOString(),
  });
  const metadata = await queryPublicationDatabase(canonical);
  return (metadata?.documents || []).filter(item => item?.pdfPath && fs.existsSync(item.pdfPath));
}

async function listPublicationPdfs(applicationNo, registrationNo = '') {
  const cacheKey = `${canonicalApplicationNo(applicationNo)}|${String(registrationNo || '').trim()}`;
  let signature = '';
  try {
    const stat = fs.statSync(PUBLICATION_PDF_DATABASE);
    signature = `${stat.size}:${stat.mtimeMs}`;
    const cachedList = documentListCache.get(cacheKey);
    if (cachedList?.signature === signature) return cachedList.documents;
  } catch { /* The legacy application-PDF cache is still a valid fallback. */ }

  let directRows = [];
  let historicalPreparationError = null;
  if (signature) {
    try {
      directRows = lookupDocuments(PUBLICATION_PDF_DATABASE, {
        applicationNumber: canonicalApplicationNo(applicationNo),
        registrationNumber: registrationNo,
      });
    } catch { directRows = []; }
  }
  const repositoryDocuments = rows => rows.map((item) => ({
    id: String(item.id),
    category: item.category,
    lookupKey: item.lookup_key,
    modeId: item.mode_id,
    applicationNo: item.application_number,
    registrationNo: item.registration_number,
    requestNo: item.request_number,
    publicationNo: item.publication_number,
    sourcePath: item.source_path,
    sourceFile: item.source_file,
    cbNumber: item.cb_number,
    volume: item.volume,
    book: item.book,
    pages: item.source_pages,
    sourcePages: parsePublicationPages(item.source_pages),
    pdfPath: item.pdf_path,
    page: 1,
    pageCount: item.page_count,
    generatedAt: item.generated_at,
    source: 'Publication Workbench PDF repository',
  })).filter(item => item.pdfPath && fs.existsSync(item.pdfPath));
  let directDocuments = repositoryDocuments(directRows);
  let metadata = null;

  // The Hosting Hub runs under regular Node, where the Workbench's native
  // SQLite driver may not be available. Query through the Python helper before
  // falling back to the much more expensive historical PDF extraction.
  if (!directDocuments.length) {
    metadata = await queryPublicationDatabase(applicationNo, registrationNo).catch(() => null);
    directDocuments = (metadata?.documents || [])
      .filter(item => item?.pdfPath && fs.existsSync(item.pdfPath));
  }

  if (!directDocuments.length) {
    const canonical = canonicalApplicationNo(applicationNo);
    let preparation = historicalPreparationJobs.get(canonical);
    if (!preparation) {
      preparation = prepareHistoricalPublicationDocument(canonical)
        .finally(() => historicalPreparationJobs.delete(canonical));
      historicalPreparationJobs.set(canonical, preparation);
    }
    directDocuments = await preparation.catch((error) => {
      historicalPreparationError = error;
      return [];
    });
  }

  const documents = directDocuments;
  if (documents.length) {
    const sorted = documents.sort((left, right) => {
      const order = { publication_a: 0, publication_b: 1, annuity: 2 };
      return (order[left.category] ?? 9) - (order[right.category] ?? 9) || Number(right.cbNumber || 0) - Number(left.cbNumber || 0);
    });
    // Historical preparation updates the repository, so cache against its
    // post-write signature rather than the signature observed at entry.
    try {
      const finalStat = fs.statSync(PUBLICATION_PDF_DATABASE);
      signature = `${finalStat.size}:${finalStat.mtimeMs}`;
    } catch { /* Returning the prepared document does not require caching. */ }
    if (signature) documentListCache.set(cacheKey, { signature, documents: sorted });
    return sorted;
  }
  const cached = metadata?.cachedPdf?.pdfPath && fs.existsSync(metadata.cachedPdf.pdfPath)
    ? metadata.cachedPdf
    : readCachedApplicationPdf(applicationNo);
  if (cached) {
    return [{ ...cached, id: 'legacy-publication-a', category: 'publication_a', lookupKey: canonicalApplicationNo(applicationNo), pageCount: cached.pageCount || cached.sourcePages?.length || 0 }];
  }
  const detail = historicalPreparationError ? ` Historical page preparation failed: ${historicalPreparationError.message}` : '';
  throw new Error(`Publication pages for ${canonicalApplicationNo(applicationNo)} have not been prepared in the Publication Workbench PDF repository.${detail}`);
}

async function checkPublicationA(applicationNo) {
  if (!fs.existsSync(PUBLICATION_DATABASE)) return { ok: false, error: 'Publication database is unavailable.' };
  const metadata = await queryPublicationDatabase(canonicalApplicationNo(applicationNo));
  const found = metadata?.modeId === '1' || Boolean(metadata?.cachedPdf) ||
    (metadata?.documents || []).some((item) => item.category === 'publication_a');
  return { ok: true, hasPublicationA: found };
}

function lookupHistoricalRecord(applicationNo) {
  const wanted = normalizeApplicationNo(applicationNo);
  for (const source of listPatentPublicationJsonFiles(PUBLICATION_ROOT)) {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(source.filePath, 'utf8')); }
    catch { continue; }
    const record = (Array.isArray(rows) ? rows : []).find((item) => normalizeApplicationNo(item?.Application_Number || item?.applicationNumber || item?.['(21)']) === wanted);
    if (record) return { record, sourceFile: firstValue(record, ['Source_File', 'Source File', 'sourceFile']), sourcePath: '', sourceJson: source.filePath, source: 'publication extraction JSON' };
  }
  return null;
}

function bulletinIdentity(record, sourceFile = '', sourceJson = '') {
  const direct = `${sourceFile} ${sourceJson}`.match(/CB[_\s-]*(\d+).*?[_\s-]([AB])\s*([123])(?:[_\s-]|\.)/i);
  if (direct) return { cb: Number(direct[1]), volume: direct[2].toUpperCase(), book: direct[3] };
  const text = Object.values(record || {}).filter((value) => typeof value === 'string').join(' ');
  const embedded = text.match(/C[ÔO]NG\s+B[ÁA]O[^.]{0,80}?S[ỐO]\s*(\d+)[^A-Z0-9]{0,20}T[ẬA]P\s*([AB])[^A-Z0-9]{0,20}(?:QUY[ỂE]N\s*)?([123])/i);
  return embedded ? { cb: Number(embedded[1]), volume: embedded[2].toUpperCase(), book: embedded[3] } : null;
}

function classifyPdf(filePath) {
  const match = path.basename(String(filePath || '')).match(/CB[_\s-]*(\d+).*?[_\s-]([AB])\s*([123])(?:[_\s-]|\.)/i);
  return match ? { cb: Number(match[1]), volume: match[2].toUpperCase(), book: match[3] } : null;
}

function listPdfs() {
  if (pdfInventory) return pdfInventory;
  const files = [];
  const visit = (folder) => {
    let entries = [];
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.pdf') files.push(fullPath);
    }
  };
  DEFAULT_PDF_ROOTS.forEach(visit);
  pdfInventory = files;
  return files;
}

function resolvePdfPath(metadata) {
  if (metadata.sourcePath && fs.existsSync(metadata.sourcePath)) return metadata.sourcePath;
  const files = listPdfs();
  const sourceName = path.basename(metadata.sourceFile || '');
  if (sourceName) {
    const exact = files.find((file) => path.basename(file).localeCompare(sourceName, undefined, { sensitivity: 'accent' }) === 0);
    if (exact) return exact;
  }
  const identity = bulletinIdentity(metadata.record, metadata.sourceFile, metadata.sourceJson);
  if (!identity) return '';
  return files.find((file) => {
    const current = classifyPdf(file);
    return current && current.cb === identity.cb && current.volume === identity.volume && current.book === identity.book;
  }) || '';
}

async function buildPublicationPdf(applicationNo) {
  const normalized = normalizeApplicationNo(applicationNo);
  if (!normalized) throw new Error('A valid application number is required.');
  let metadata = await queryPublicationDatabase(applicationNo).catch(() => null);
  if (metadata?.cachedPdf?.pdfPath && fs.existsSync(metadata.cachedPdf.pdfPath)) {
    return { ...metadata.cachedPdf, cachedFile: path.basename(metadata.cachedPdf.pdfPath), source: metadata.source, cached: true };
  }
  const legacyCache = readCachedApplicationPdf(applicationNo);
  if (legacyCache) return legacyCache;
  throw new Error(`Publication pages for ${canonicalApplicationNo(applicationNo)} have not been prepared in the Publication Workbench PDF repository.`);
}

async function resolvePublicationPdf(applicationNo) {
  const normalized = normalizeApplicationNo(applicationNo);
  if (!normalized) throw new Error('A valid application number is required.');
  if (resolutionCache.has(normalized)) return resolutionCache.get(normalized);
  if (resolutionJobs.has(normalized)) return resolutionJobs.get(normalized);
  const job = buildPublicationPdf(applicationNo);
  resolutionJobs.set(normalized, job);
  try {
    const result = await job;
    resolutionCache.set(normalized, result);
    return result;
  } finally {
    resolutionJobs.delete(normalized);
  }
}

module.exports = {
  resolvePublicationPdf,
  listPublicationPdfs,
  checkPublicationA,
  parsePublicationPages,
  applicationPdfPaths,
  readCachedApplicationPdf,
  bulletinIdentity,
  classifyPdf,
  PUBLICATION_DATABASE,
  PUBLICATION_PDF_DATABASE,
  APPLICATION_PDF_ROOT,
};
