const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');

const INPUT_FILE = path.join(__dirname, 'TM_ID.txt');
const BASE_URL = 'https://vietnamtrademark.net/search?q=';

// Randomization/irregularity config
const DELAY_MIN_MS = 800;
const DELAY_MAX_MS = 2500;
const LONG_PAUSE_EVERY_MIN = 5;      // after N requests (min)
const LONG_PAUSE_EVERY_MAX = 12;     // after N requests (max)
const LONG_PAUSE_MIN_MS = 5000;
const LONG_PAUSE_MAX_MS = 15000;
const RANDOM_RENDER_PROB = 0.2;      // 20% of requests render with Puppeteer first

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/124.0.0.0 Safari/537.36'
];
const ACCEPT_LANGS = [
  'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  'vi,en-US;q=0.9,en;q=0.8',
  'en-US,en;q=0.9,vi;q=0.7'
];

function randInt(min, max) { // inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomDelay(minMs = DELAY_MIN_MS, maxMs = DELAY_MAX_MS) {
  const ms = randInt(minMs, maxMs);
  return new Promise(res => setTimeout(res, ms));
}
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readIDs(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }
  return fs
    .readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function csvEscape(value) {
  if (value == null) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function tsvEscape(value) {
  if (value == null) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ').trim();
}

function buildUrl(id) { return BASE_URL + encodeURIComponent(id); }

function buildHeaders() {
  const ua = choice(USER_AGENTS);
  const al = choice(ACCEPT_LANGS);
  const referers = [
    'https://vietnamtrademark.net/',
    'https://vietnamtrademark.net/search',
    `https://vietnamtrademark.net/search?q=${encodeURIComponent(String.fromCharCode(97 + Math.floor(Math.random()*26)))}`
  ];
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': al,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': choice(referers),
    'Connection': 'keep-alive'
  };
}

async function fetchPage(url, headers) {
  const res = await fetch(url, { headers: headers || buildHeaders() });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function fetchRenderedHtml(url) {
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(choice(USER_AGENTS));
    await page.setExtraHTTPHeaders({ 'Accept-Language': choice(ACCEPT_LANGS) });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    try { await page.waitForSelector('table.list-nhanhieu tbody tr', { timeout: 5000 }); } catch {}
    return await page.content();
  } finally { await browser.close(); }
}

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function findResultRow(doc, id) {
  let row = doc.querySelector(`table.list-nhanhieu tbody tr[data-so-don="${id}"]`);
  if (row) return row;
  const rows = Array.from(doc.querySelectorAll('table.list-nhanhieu tbody tr'));
  for (const r of rows) {
    const aText = Array.from(r.querySelectorAll('a')).find(a => (a.textContent || '').trim() === id);
    if (aText) return r;
    const aHref = Array.from(r.querySelectorAll('a[href]')).find(a => (a.getAttribute('href') || '').includes(id));
    if (aHref) return r;
  }
  return null;
}

function parseRowFields(row) {
  const tds = row ? row.querySelectorAll('td') : [];
  const stt = tds[1]?.textContent.trim() || '';
  let mauNhanImage = '';
  const img = tds[2]?.querySelector('img');
  if (img) mauNhanImage = img.getAttribute('src') || (img.getAttribute('data-src') || '');
  const nhanHieu = (tds[3]?.querySelector('label')?.textContent || tds[3]?.textContent || '').trim();
  let nhom = '';
  if (tds[4]) {
    const spans = Array.from(tds[4].querySelectorAll('span')).map(s => s.textContent.trim()).filter(Boolean);
    if (spans.length) nhom = spans.join(', ');
    else nhom = tds[4].textContent.replace(/\s+/g, ' ').trim();
  }
  const trangThai = (tds[5]?.textContent || '').replace(/\s+/g, ' ').trim();
  const ngayNopDon = (tds[6]?.textContent || '').replace(/\s+/g, ' ').trim();
  let soDon = '';
  let soDonHref = '';
  if (tds[7]) {
    const a = tds[7].querySelector('a');
    soDon = (a?.textContent || tds[7].textContent || '').replace(/\s+/g, ' ').trim();
    if (a) soDonHref = a.getAttribute('href') || '';
  }
  const chuDon = (tds[8]?.textContent || '').replace(/\s+/g, ' ').trim();
  const daiDien = (tds[9]?.textContent || '').replace(/\s+/g, ' ').trim();
  const rowText = row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
  return { stt, mauNhanImage, nhanHieu, nhom, trangThai, ngayNopDon, soDon, soDonHref, chuDon, daiDien, rowText };
}

function absolutize(urlOrPath) {
  try {
    if (!urlOrPath) return '';
    if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
    return new URL(urlOrPath, 'https://vietnamtrademark.net').href;
  } catch { return ''; }
}

function extractDaiDienFromDetailHtml(html) {
  try {
    const doc = new JSDOM(html).window.document;
    const targetText = 'đại diện shcn';
    const candidates = Array.from(doc.querySelectorAll('th, td, label, div, span'));
    let labelEl = candidates.find(el => (el.textContent || '').toLowerCase().includes(targetText));
    if (!labelEl) return '';
    if (labelEl.tagName === 'TH' && labelEl.parentElement) {
      const next = labelEl.nextElementSibling;
      if (next) return next.textContent.replace(/\s+/g, ' ').trim();
    }
    if (labelEl.tagName === 'TD' && labelEl.parentElement && labelEl.parentElement.children.length >= 2) {
      const idx = Array.from(labelEl.parentElement.children).indexOf(labelEl);
      const next = labelEl.parentElement.children[idx + 1];
      if (next) return next.textContent.replace(/\s+/g, ' ').trim();
    }
    if (labelEl.nextElementSibling) {
      return labelEl.nextElementSibling.textContent.replace(/\s+/g, ' ').trim();
    }
    return labelEl.textContent.replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

function parseResultFromHtml(html, id) {
  const doc = new JSDOM(html).window.document;
  const row = findResultRow(doc, id);
  if (!row) return { name: '', rowText: '', found: false, fields: null };
  const fields = parseRowFields(row);
  const name = fields.nhanHieu;
  return { name, rowText: fields.rowText, found: !!(fields.rowText || fields.nhanHieu), fields };
}

async function main() {
  console.log('Starting VietnamTrademark search scraper...');
  const ids = readIDs(INPUT_FILE);
  if (ids.length === 0) { console.log('No IDs found in TM_ID.txt'); return; }

  // Shuffle IDs to avoid predictable access patterns
  shuffleInPlace(ids);

  const ts = timestamp();
  const baseOutputDir = path.join(__dirname, 'Results', ts);
  ensureDir(baseOutputDir);

  fs.copyFileSync(INPUT_FILE, path.join(baseOutputDir, 'original_ID.csv'));

  const outCsv = path.join(baseOutputDir, 'trademark_names.csv');
  const outRowCsv = path.join(baseOutputDir, 'trademark_rows.csv');
  const outRowTsv = path.join(baseOutputDir, 'trademark_rows.tsv');
  const logPath = path.join(baseOutputDir, 'log.txt');

  fs.writeFileSync(outCsv, 'Name,ID\n', 'utf-8');
  fs.writeFileSync(outRowCsv, 'RowText,ID\n', 'utf-8');
  fs.writeFileSync(outRowTsv, [
    'ID','STT','MauNhanImage','NhanHieu','Nhom','TrangThai','NgayNopDon','SoDon','ChuDon','DaiDienSHCN','RowText'
  ].join('\t') + '\n', 'utf-8');

  let foundCount = 0; let missingOrError = 0;
  let nextLongPauseAt = randInt(LONG_PAUSE_EVERY_MIN, LONG_PAUSE_EVERY_MAX);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const url = buildUrl(id);
    const start = Date.now();
    try {
      const useRenderedFirst = Math.random() < RANDOM_RENDER_PROB;
      let html;
      if (useRenderedFirst) {
        html = await fetchRenderedHtml(url);
      } else {
        html = await fetchPage(url, buildHeaders());
      }
      let { name, rowText, found, fields } = parseResultFromHtml(html, id);

      if (!found) {
        try {
          html = useRenderedFirst ? await fetchPage(url, buildHeaders()) : await fetchRenderedHtml(url);
          ({ name, rowText, found, fields } = parseResultFromHtml(html, id));
        } catch (renderErr) {
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${id} -> SECOND_TRY_FAIL ${renderErr.message}\n`);
        }
      }

      if (fields && !fields.daiDien) {
        const detailUrl = absolutize(fields.soDonHref);
        if (detailUrl) {
          try {
            let dhtml;
            if (Math.random() < 0.5) dhtml = await fetchPage(detailUrl, buildHeaders());
            else dhtml = await fetchRenderedHtml(detailUrl);
            let rep = extractDaiDienFromDetailHtml(dhtml);
            if (!rep) {
              try {
                dhtml = (dhtml && dhtml.length) ? dhtml : await fetchRenderedHtml(detailUrl);
                rep = extractDaiDienFromDetailHtml(dhtml);
              } catch {}
            }
            if (rep) fields.daiDien = rep;
          } catch (detailErr) {
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${id} -> DETAIL_FAIL ${detailErr.message}\n`);
          }
        }
      }

      fs.appendFileSync(outCsv, `${csvEscape(name)},${csvEscape(id)}\n`, 'utf-8');
      fs.appendFileSync(outRowCsv, `${csvEscape(rowText)},${csvEscape(id)}\n`, 'utf-8');

      if (fields) {
        const tsvRow = [
          id,
          fields.stt,
          fields.mauNhanImage,
          fields.nhanHieu,
          fields.nhom,
          fields.trangThai,
          fields.ngayNopDon,
          fields.soDon,
          fields.chuDon,
          fields.daiDien,
          fields.rowText,
        ].map(tsvEscape).join('\t') + '\n';
        fs.appendFileSync(outRowTsv, tsvRow, 'utf-8');
      } else {
        fs.appendFileSync(outRowTsv, [id, '', '', '', '', '', '', '', '', '', ''].map(tsvEscape).join('\t') + '\n', 'utf-8');
      }

      foundCount += found ? 1 : 0;
      if (!found) missingOrError += 1;

      const dur = Date.now() - start;
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${id} -> ${found ? 'OK' : 'NOT_FOUND'} in ${dur}ms\n`);
      console.log(`${i + 1}/${ids.length} ${id} -> ${found ? 'OK' : 'NOT_FOUND'} (${dur}ms)`);
    } catch (err) {
      missingOrError += 1;
      const dur = Date.now() - start;
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${id} -> ERROR ${err.message} in ${dur}ms\n`);
      console.warn(`${i + 1}/${ids.length} ${id} -> ERROR ${err.message}`);
      fs.appendFileSync(outCsv, `,${csvEscape(id)}\n`, 'utf-8');
      fs.appendFileSync(outRowCsv, `,${csvEscape(id)}\n`, 'utf-8');
      fs.appendFileSync(outRowTsv, [id, '', '', '', '', '', '', '', '', '', ''].map(tsvEscape).join('\t') + '\n', 'utf-8');
    }

    // Irregular delays
    if (i + 1 < ids.length) {
      await randomDelay();
      if (i + 1 === nextLongPauseAt) {
        const pause = randInt(LONG_PAUSE_MIN_MS, LONG_PAUSE_MAX_MS);
        console.log(`⏸️ Long pause for ${(pause/1000).toFixed(1)}s to randomize timing...`);
        await sleep(pause);
        nextLongPauseAt += randInt(LONG_PAUSE_EVERY_MIN, LONG_PAUSE_EVERY_MAX);
      }
    }
  }

  console.log(`Done. Name found: ${foundCount}, missing/errors: ${missingOrError}`);
  console.log(`Output: ${outCsv}`);
  console.log(`Output: ${outRowCsv}`);
  console.log(`Output: ${outRowTsv}`);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
