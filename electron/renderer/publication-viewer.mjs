function normalizedCharacters(value) {
  return [...String(value || '').toUpperCase()].filter((character) => /[A-Z0-9]/.test(character));
}

export function findRequestTextRanges(items, requestNo) {
  const target = normalizedCharacters(requestNo).join('');
  if (!target) return [];
  const characters = [];
  const locations = [];
  (items || []).forEach((item, itemIndex) => {
    [...String(item?.str || '')].forEach((character, offset) => {
      if (!/[A-Z0-9]/.test(character.toUpperCase())) return;
      characters.push(character.toUpperCase());
      locations.push({ itemIndex, offset });
    });
  });
  const text = characters.join('');
  const ranges = [];
  let cursor = 0;
  while ((cursor = text.indexOf(target, cursor)) !== -1) {
    const segments = new Map();
    for (let index = cursor; index < cursor + target.length; index += 1) {
      const { itemIndex, offset } = locations[index];
      const segment = segments.get(itemIndex) || { itemIndex, start: offset, end: offset + 1 };
      segment.start = Math.min(segment.start, offset);
      segment.end = Math.max(segment.end, offset + 1);
      segments.set(itemIndex, segment);
    }
    ranges.push(...segments.values());
    cursor += target.length;
  }
  return ranges;
}

export function paintRequestTextHighlights(context, pdfjsLib, viewport, outputScale, items, requestNo, styles = {}) {
  const ranges = findRequestTextRanges(items, requestNo);
  if (!ranges.length) return 0;
  context.save();
  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = '#ffe34f';
  for (const range of ranges) {
    const item = items[range.itemIndex];
    const length = [...item.str].length;
    if (!length || !item.width || !item.height) continue;
    const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const width = item.width * viewport.scale;
    const height = item.height * viewport.scale;
    let startFraction = range.start / length;
    let endFraction = range.end / length;
    if (typeof context.measureText === 'function') {
      context.font = `${height}px ${styles[item.fontName]?.fontFamily || 'sans-serif'}`;
      const characters = [...item.str];
      const measuredWidth = context.measureText(item.str).width;
      if (measuredWidth > 0) {
        startFraction = context.measureText(characters.slice(0, range.start).join('')).width / measuredWidth;
        endFraction = context.measureText(characters.slice(0, range.end).join('')).width / measuredWidth;
      }
    }
    const left = transform[4] + width * startFraction;
    const top = transform[5] - height;
    context.fillRect(left, top, Math.max(2, width * (endFraction - startFraction)), height * 1.12);
  }
  context.restore();
  return ranges.length;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
const local = location.protocol === 'file:';
const base = '/wipo-application-tracker';
const moduleUrl = local
  ? new URL('../../node_modules/pdfjs-dist/build/pdf.mjs', import.meta.url).href
  : `${base}/vendor/pdf.mjs`;
const pdfjsLib = await import(moduleUrl);
pdfjsLib.GlobalWorkerOptions.workerSrc = local
  ? new URL('../../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
  : `${base}/vendor/pdf.worker.mjs`;

let container = document.getElementById('publicationPages');
const documents = new Map();
let renderToken = 0;
let pageJobs = [];
let pageObserver = null;
let zoom = 1;

function applyZoom(canvas) {
  const baseWidth = Number(canvas.dataset.baseWidth || 0);
  const baseHeight = Number(canvas.dataset.baseHeight || 0);
  if (!baseWidth || !baseHeight) return;
  canvas.style.width = `${Math.round(baseWidth * zoom)}px`;
  canvas.style.height = `${Math.round(baseHeight * zoom)}px`;
}

function setZoom(value) {
  zoom = Math.max(.5, Math.min(2.5, Math.round(Number(value) * 4) / 4));
  container.querySelectorAll('.publication-page').forEach(applyZoom);
  return zoom;
}

function zoomBy(delta) {
  return setZoom(zoom + Number(delta || 0));
}

function resetZoom() {
  return setZoom(1);
}

function cacheDocument(url) {
  const key = String(url).split('#')[0];
  if (documents.has(key)) return documents.get(key);
  const task = pdfjsLib.getDocument({ url: key, rangeChunkSize: 262144 });
  const promise = task.promise.catch((error) => { documents.delete(key); throw error; });
  documents.set(key, promise);
  while (documents.size > 12) {
    const oldest = documents.keys().next().value;
    const oldPromise = documents.get(oldest);
    documents.delete(oldest);
    oldPromise.then((documentPdf) => documentPdf.destroy()).catch(() => {});
  }
  return promise;
}

async function renderPage(documentPdf, pageNumber, token, slot, highlightRequestNo = '') {
  const page = await documentPdf.getPage(pageNumber);
  if (token !== renderToken) return;
  const natural = page.getViewport({ scale: 1 });
  const available = Math.max(320, Math.min(1200, container.clientWidth - 48));
  const viewport = page.getViewport({ scale: Math.max(.55, Math.min(2.1, available / natural.width)) });
  const outputScale = Math.min(window.devicePixelRatio || 1, 1.6);
  const canvas = document.createElement('canvas');
  canvas.className = 'publication-page';
  canvas.dataset.page = String(pageNumber);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.dataset.baseWidth = String(Math.floor(viewport.width));
  canvas.dataset.baseHeight = String(Math.floor(viewport.height));
  applyZoom(canvas);
  await page.render({
    canvasContext: canvas.getContext('2d', { alpha: false }),
    viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise;
  if (token !== renderToken) return;
  slot.replaceWith(canvas);
  if (highlightRequestNo) {
    page.getTextContent().then((text) => {
      if (token === renderToken) paintRequestTextHighlights(canvas.getContext('2d'), pdfjsLib, viewport, outputScale, text.items, highlightRequestNo, text.styles);
    }).catch(() => { /* Scanned PDFs remain viewable without text highlighting. */ });
  }
}

function startPageJob(job) {
  if (!job.promise) job.promise = renderPage(job.documentPdf, job.pageNumber, job.token, job.slot, job.highlightRequestNo);
  return job.promise;
}

async function renderMany(entries) {
  const token = ++renderToken;
  pageObserver?.disconnect();
  pageObserver = null;
  pageJobs = [];
  container.innerHTML = '';
  const requested = (Array.isArray(entries) ? entries : [entries]).map((entry) => typeof entry === 'string' ? { url: entry, label: '' } : entry).filter((entry) => entry?.url);
  const loaded = await Promise.all(requested.map(async (entry) => ({ ...entry, documentPdf: await cacheDocument(entry.url) })));
  if (token !== renderToken) return;
  const pages = [];
  for (let documentIndex = 0; documentIndex < loaded.length; documentIndex += 1) {
    const entry = loaded[documentIndex];
    if (loaded.length > 1) {
      const divider = document.createElement('div');
      divider.className = 'publication-document-divider';
      divider.textContent = entry.label || `Annuity document ${documentIndex + 1}`;
      container.appendChild(divider);
    }
    for (let pageNumber = 1; pageNumber <= entry.documentPdf.numPages; pageNumber += 1) {
      const slot = document.createElement('div');
      slot.className = 'publication-page-placeholder';
      slot.textContent = `Preparing page ${pageNumber}…`;
      container.appendChild(slot);
      pages.push({ documentPdf: entry.documentPdf, pageNumber, slot, highlightRequestNo: entry.highlightRequestNo || '', token, promise: null });
    }
  }
  if (!pages.length) return;
  pageJobs = pages;
  await startPageJob(pages[0]);
  if (token !== renderToken) return;
  if ('IntersectionObserver' in window) {
    pageObserver = new IntersectionObserver((items) => {
      for (const item of items) {
        if (!item.isIntersecting || token !== renderToken) continue;
        pageObserver?.unobserve(item.target);
        const job = pages.find((page) => page.slot === item.target);
        if (job) startPageJob(job).catch((error) => {
          if (token === renderToken) window.dispatchEvent(new CustomEvent('publication-viewer-error', { detail: error.message }));
        });
      }
    }, { root: container, rootMargin: '100% 0px' });
    pages.slice(1).forEach((page) => pageObserver.observe(page.slot));
  } else {
    Promise.resolve().then(async () => {
      for (const page of pages.slice(1)) {
        if (token !== renderToken) return;
        await startPageJob(page);
      }
    }).catch((error) => {
      if (token === renderToken) window.dispatchEvent(new CustomEvent('publication-viewer-error', { detail: error.message }));
    });
  }
}

async function render(url, options = {}) {
  return renderMany([{ url, highlightRequestNo: options.highlightRequestNo || '' }]);
}

async function preload(url) {
  if (!url) return;
  const documentPdf = await cacheDocument(url);
  const page = await documentPdf.getPage(1);
  await page.getOperatorList();
}

async function preparePrint() {
  pageObserver?.disconnect();
  for (const job of pageJobs) {
    if (job.token !== renderToken) return;
    await startPageJob(job);
  }
}

function clear() {
  renderToken += 1;
  pageObserver?.disconnect();
  pageObserver = null;
  pageJobs = [];
  container.innerHTML = '';
}

function setContainer(nextContainer) {
  if (!nextContainer || nextContainer === container) return;
  clear();
  container = nextContainer;
  zoom = 1;
}

window.publicationViewer = { render, renderMany, preload, clear, preparePrint, setZoom, zoomBy, resetZoom, setContainer, getContainer: () => container, getZoom: () => zoom };
window.dispatchEvent(new Event('publication-viewer-ready'));
}
