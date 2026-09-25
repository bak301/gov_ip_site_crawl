const local = location.protocol === 'file:';
const base = '/wipo-application-tracker';
const moduleUrl = local
  ? new URL('../../node_modules/pdfjs-dist/build/pdf.mjs', import.meta.url).href
  : `${base}/vendor/pdf.mjs`;
const pdfjsLib = await import(moduleUrl);
pdfjsLib.GlobalWorkerOptions.workerSrc = local
  ? new URL('../../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
  : `${base}/vendor/pdf.worker.mjs`;

const container = document.getElementById('publicationPages');
const documents = new Map();
let renderToken = 0;

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

async function renderPage(documentPdf, pageNumber, token, slot) {
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
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  await page.render({
    canvasContext: canvas.getContext('2d', { alpha: false }),
    viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise;
  if (token === renderToken) slot.replaceWith(canvas);
}

async function render(url) {
  const token = ++renderToken;
  container.innerHTML = '';
  const documentPdf = await cacheDocument(url);
  if (token !== renderToken) return;
  const slots = [];
  for (let pageNumber = 1; pageNumber <= documentPdf.numPages; pageNumber += 1) {
    const slot = document.createElement('div');
    slot.className = 'publication-page-placeholder';
    slot.textContent = `Preparing page ${pageNumber}…`;
    container.appendChild(slot);
    slots.push(slot);
  }
  await renderPage(documentPdf, 1, token, slots[0]);
  if (token !== renderToken) return;
  (async () => {
    for (let pageNumber = 2; pageNumber <= documentPdf.numPages; pageNumber += 1) {
      await new Promise((resolve) => {
        if ('requestIdleCallback' in window) window.requestIdleCallback(resolve, { timeout: 180 });
        else setTimeout(resolve, 0);
      });
      if (token !== renderToken) return;
      await renderPage(documentPdf, pageNumber, token, slots[pageNumber - 1]);
    }
  })().catch((error) => {
    if (token === renderToken) window.dispatchEvent(new CustomEvent('publication-viewer-error', { detail: error.message }));
  });
}

function clear() {
  renderToken += 1;
  container.innerHTML = '';
}

window.publicationViewer = { render, clear };
window.dispatchEvent(new Event('publication-viewer-ready'));
