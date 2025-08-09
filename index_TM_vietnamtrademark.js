const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');

const INPUT_FILE = path.join(__dirname, 'test_ID_VNTM.txt');
const BASE_URL = 'https://vietnamtrademark.net/search?q=';
const COOKIES_FILE = path.join(__dirname, 'cookies.json');

// === Cookie Loading Function ===
function loadCookies() {
  if (!fs.existsSync(COOKIES_FILE)) {
    console.log('📋 No cookies file found');
    return null;
  }
  
  try {
    const cookiesData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
    if (cookiesData.VIETNAM_TRADEMARK && cookiesData.VIETNAM_TRADEMARK.cookies) {
      console.log(`🍪 Loaded ${cookiesData.VIETNAM_TRADEMARK.cookies.length} cookies from ${COOKIES_FILE}`);
      return cookiesData.VIETNAM_TRADEMARK.cookies;
    } else {
      console.log('📋 No Vietnam Trademark cookies found in file');
      return null;
    }
  } catch (error) {
    console.log(`⚠️ Error loading cookies: ${error.message}`);
    return null;
  }
}

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

// Helper function to get today's date in YYYY-MM-DD format
function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

// Function to extract already scraped IDs from existing output file
function extractScrapedIDsFromFile(filePath) {
  const scrapedIDs = new Set();
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (index === 0 || !line.trim()) return; // Skip header and empty lines
        const parts = line.split('\t');
        if (parts.length > 0 && parts[0].trim()) {
          scrapedIDs.add(parts[0].trim());
        }
      });
      console.log(`📋 Found ${scrapedIDs.size} already scraped IDs in ${path.basename(filePath)}`);
    } catch (error) {
      console.warn(`⚠️ Error reading ${filePath}:`, error.message);
    }
  }
  return scrapedIDs;
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

function buildHeaders(cookieData = null) {
  const ua = cookieData?.userAgent || choice(USER_AGENTS);
  const al = choice(ACCEPT_LANGS);
  const referers = [
    'https://vietnamtrademark.net/',
    'https://vietnamtrademark.net/search',
    `https://vietnamtrademark.net/search?q=${encodeURIComponent(String.fromCharCode(97 + Math.floor(Math.random()*26)))}`
  ];
  
  const headers = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': al,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': choice(referers),
    'Connection': 'keep-alive'
  };
  
  // Add cookies if available
  if (cookieData?.cookies) {
    const cookieString = cookieData.cookies
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');
    if (cookieString) {
      headers['Cookie'] = cookieString;
    }
  }
  
  return headers;
}

async function fetchPage(url, headers, cookieData = null) {
  const finalHeaders = headers || buildHeaders(cookieData);
  const res = await fetch(url, { headers: finalHeaders });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function fetchRenderedHtml(url, cookieData = null) {
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    
    // Set user agent from cookies or random
    const userAgent = cookieData?.userAgent || choice(USER_AGENTS);
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': choice(ACCEPT_LANGS) });
    
    // Set cookies if available
    if (cookieData?.cookies) {
      await page.setCookie(...cookieData.cookies);
    }
    
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
  
  // Load cookies
  const cookieData = loadCookies();
  
  // Load all IDs
  let allIDs = readIDs(INPUT_FILE);
  if (allIDs.length === 0) { 
    console.log(`No IDs found in ${INPUT_FILE}`); 
    return; 
  }
  
  console.log(`📋 Total IDs in file: ${allIDs.length}`);

  // Deduplicate input IDs first
  const uniqueInputIDs = [...new Set(allIDs)];
  const duplicatesRemoved = allIDs.length - uniqueInputIDs.length;
  if (duplicatesRemoved > 0) {
    console.log(`🔄 Removed ${duplicatesRemoved} duplicate IDs from input`);
  }

  // Set up unified output structure
  const todayDate = getTodayDateString();
  const baseOutputDir = path.join(__dirname, 'Output', todayDate);
  ensureDir(baseOutputDir);

  // Single unified output file
  const outputFile = path.join(baseOutputDir, `VNTM_${todayDate}.txt`);
  const logPath = path.join(baseOutputDir, 'log.txt');

  // === Global tracking file for all scraped data with run date ===
  const globalTrackingFile = path.join(__dirname, "VNTM_Global_Tracking.txt");

  // === Function to write to global tracking file with run date ===
  function writeToGlobalTracking(id, data) {
    const runDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const globalEntry = `${runDate}\t${data}\n`;
    
    // Add header if file doesn't exist
    if (!fs.existsSync(globalTrackingFile)) {
      const header = "Run_Date\tID\tSTT\tMauNhanImage\tNhanHieu\tNhom\tTrangThai\tNgayNopDon\tSoDon\tChuDon\tDaiDienSHCN\n";
      fs.writeFileSync(globalTrackingFile, header);
    }
    
    fs.appendFileSync(globalTrackingFile, globalEntry);
  }

  // Check for already scraped IDs
  console.log(`🔍 Checking for existing output files in ${baseOutputDir}...`);
  const alreadyScrapedIDs = extractScrapedIDsFromFile(outputFile);
  console.log(`✅ Total already scraped IDs found: ${alreadyScrapedIDs.size}`);

  // Filter out already scraped IDs
  const idsToProcess = uniqueInputIDs.filter(id => !alreadyScrapedIDs.has(id));
  
  console.log(`✅ IDs to process (excluding already scraped): ${idsToProcess.length}`);
  console.log(`⏭️ Skipped IDs (already scraped): ${uniqueInputIDs.length - idsToProcess.length}`);

  if (idsToProcess.length === 0) {
    console.log('🎉 All IDs have already been processed!');
    return;
  }

  // Shuffle remaining IDs to avoid predictable access patterns
  shuffleInPlace(idsToProcess);

  // Copy original ID list
  fs.copyFileSync(INPUT_FILE, path.join(baseOutputDir, 'original_ID.txt'));

  // Initialize output file with header if it doesn't exist
  if (!fs.existsSync(outputFile)) {
    const header = [
      'ID','STT','MauNhanImage','NhanHieu','Nhom','TrangThai','NgayNopDon','SoDon','ChuDon','DaiDienSHCN'
    ].join('\t') + '\n';
    fs.writeFileSync(outputFile, header, 'utf-8');
  }

  let foundCount = 0; let missingOrError = 0;
  let nextLongPauseAt = randInt(LONG_PAUSE_EVERY_MIN, LONG_PAUSE_EVERY_MAX);

  for (let i = 0; i < idsToProcess.length; i++) {
    const id = idsToProcess[i];
    const url = buildUrl(id);
    const start = Date.now();
    try {
      const useRenderedFirst = Math.random() < RANDOM_RENDER_PROB;
      let html;
      if (useRenderedFirst) {
        html = await fetchRenderedHtml(url, cookieData);
      } else {
        html = await fetchPage(url, buildHeaders(cookieData), cookieData);
      }
      let { name, rowText, found, fields } = parseResultFromHtml(html, id);

      if (!found) {
        try {
          html = useRenderedFirst ? await fetchPage(url, buildHeaders(cookieData), cookieData) : await fetchRenderedHtml(url, cookieData);
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
            if (Math.random() < 0.5) dhtml = await fetchPage(detailUrl, buildHeaders(cookieData), cookieData);
            else dhtml = await fetchRenderedHtml(detailUrl, cookieData);
            let rep = extractDaiDienFromDetailHtml(dhtml);
            if (!rep) {
              try {
                dhtml = (dhtml && dhtml.length) ? dhtml : await fetchRenderedHtml(detailUrl, cookieData);
                rep = extractDaiDienFromDetailHtml(dhtml);
              } catch {}
            }
            if (rep) fields.daiDien = rep;
          } catch (detailErr) {
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${id} -> DETAIL_FAIL ${detailErr.message}\n`);
          }
        }
      }

      // Check for duplicates before writing (additional safety check)
      if (alreadyScrapedIDs.has(id)) {
        console.log(`⚠️ Skipping duplicate ID: ${id}`);
        continue;
      }

      // Write to unified output file
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
        ].map(tsvEscape).join('\t') + '\n';
        fs.appendFileSync(outputFile, tsvRow, 'utf-8');
        
        // Write to global tracking file with run date (only for successful entries)
        writeToGlobalTracking(id, tsvRow.trim());
      } else {
        const emptyRow = [id, '', '', '', '', '', '', '', '', ''].map(tsvEscape).join('\t') + '\n';
        fs.appendFileSync(outputFile, emptyRow, 'utf-8');
        
        // Do not write failed/empty entries to global tracking
      }

      // Add to already scraped set to prevent future duplicates
      alreadyScrapedIDs.add(id);

      foundCount += found ? 1 : 0;
      if (!found) missingOrError += 1;

      const dur = Date.now() - start;
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${id} -> ${found ? 'OK' : 'NOT_FOUND'} in ${dur}ms\n`);
      console.log(`${i + 1}/${idsToProcess.length} ${id} -> ${found ? 'OK' : 'NOT_FOUND'} (${dur}ms)`);
    } catch (err) {
      missingOrError += 1;
      const dur = Date.now() - start;
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${id} -> ERROR ${err.message} in ${dur}ms\n`);
      console.warn(`${i + 1}/${idsToProcess.length} ${id} -> ERROR ${err.message}`);
      const errorRow = [id, '', '', '', '', '', '', '', '', ''].map(tsvEscape).join('\t') + '\n';
      fs.appendFileSync(outputFile, errorRow, 'utf-8');
      
      // Do not write error entries to global tracking
    }

    // Irregular delays
    if (i + 1 < idsToProcess.length) {
      await randomDelay();
      if (i + 1 === nextLongPauseAt) {
        const pause = randInt(LONG_PAUSE_MIN_MS, LONG_PAUSE_MAX_MS);
        console.log(`⏸️ Long pause for ${(pause/1000).toFixed(1)}s to randomize timing...`);
        await sleep(pause);
        nextLongPauseAt += randInt(LONG_PAUSE_EVERY_MIN, LONG_PAUSE_EVERY_MAX);
      }
    }
  }

  console.log(`\n🎉 Processing completed!`);
  console.log(`✅ Name found: ${foundCount}`);
  console.log(`❌ Missing/errors: ${missingOrError}`);
  console.log(`📁 Output file: ${outputFile}`);
  console.log(`📋 Log file: ${logPath}`);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
