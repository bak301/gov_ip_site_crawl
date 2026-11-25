'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const CACHE_ROOT = path.join(__dirname, 'data', 'hague');
const active = new Map();

function cachedHagueDesign(number, cacheRoot = CACHE_ROOT) {
  const canonical = normalizeHagueNo(number);
  if (!canonical) return null;
  try {
    const record = JSON.parse(fs.readFileSync(path.join(cacheRoot, canonical.slice(3), 'record.json'), 'utf8'));
    return record?.ok === true && normalizeHagueNo(record.number) === canonical ? record : null;
  } catch { return null; }
}

function normalizeHagueNo(value) {
  const match = String(value || '').trim().toUpperCase().match(/^DM\s*\/?\s*(\d{3})\s*(\d{3})$/);
  return match ? `DM/${match[1]}${match[2]}` : '';
}

function parseHagueNos(value) {
  const found = [];
  for (const match of String(value || '').matchAll(/(?:^|[^A-Z0-9])DM\s*\/?\s*(\d{3})\s*(\d{3})(?![A-Z0-9])/gi)) {
    found.push(`DM/${match[1]}${match[2]}`);
  }
  return [...new Set(found)];
}

function hagueUrl(number) {
  const canonical = normalizeHagueNo(number);
  if (!canonical) throw new Error('Enter a six-digit Hague design number, such as DM/213380.');
  return `https://designdb.wipo.int/designdb/en/showData.jsp?ID=HAGUE.D${canonical.slice(3)}`;
}

function dateText(value) {
  const match = String(value || '').match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (!match) return '';
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
    ? `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[3]}` : '';
}

function plainText(element) {
  if (!element) return '';
  const copy = element.cloneNode(true);
  copy.querySelectorAll('.inidInfo, script, style').forEach(node => node.remove());
  copy.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  copy.querySelectorAll('li').forEach(node => { node.prepend('\n'); node.append('\n'); });
  return copy.textContent.replace(/\u00a0/g, ' ').replace(/[^\S\n]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseFields(container) {
  return [...container.querySelectorAll('.inid')].map(node => {
    const value = node.nextElementSibling?.classList.contains('text') ? node.nextElementSibling : null;
    return { code: plainText(node.querySelector('.inidCode')).replace(/[()]/g, ''), label: plainText(node.querySelector('.inidText')),
      value: plainText(value), items: value ? [...value.querySelectorAll('li')].map(plainText).filter(Boolean) : [] };
  }).filter(field => field.label);
}

function safePdfUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.wipo.int' && /^\/idpub\/[\w./%-]+\.pdf$/i.test(url.pathname) ? url.href : '';
  } catch { return ''; }
}

function parseHagueHtml(html, requestedNo) {
  const number = normalizeHagueNo(requestedNo);
  if (!number) throw new Error('Invalid Hague design number.');
  const document = new JSDOM(String(html || '')).window.document;
  const current = document.querySelector('#currentStatus');
  const history = document.querySelector('#history');
  if (!current || !history) throw new Error('WIPO did not return a Hague record page.');
  const currentFields = parseFields(current);
  const pageNo = normalizeHagueNo(currentFields.find(field => field.code === '11')?.value);
  if (pageNo !== number) throw new Error(`WIPO returned a different Hague record${pageNo ? ` (${pageNo})` : ''}.`);
  const original = [...history.querySelectorAll('.transaction')].find(node => /Original Registration/i.test(node.querySelector('h2.box')?.textContent || ''));
  const originalFields = original ? parseFields(original) : [];
  const presentCodes = new Set(currentFields.map(field => field.code));
  const fields = [...currentFields.map(field => ({ ...field, source: 'Current status' })),
    ...originalFields.filter(field => !presentCodes.has(field.code)).map(field => ({ ...field, source: 'Original registration' }))];
  const events = [...history.querySelectorAll('.transaction.VN')].map((node, index) => {
    const header = plainText(node.querySelector('h2.box'));
    const kind = /^Partial Statement of Grant/i.test(header) ? 'Granted in part'
      : /^Statement of Grant/i.test(header) ? 'Granted' : /^Refusal/i.test(header) ? 'Refusal' : 'Other VN event';
    const bulletin = header.match(/Bulletin No\.\s*([\d/]+)\s*\(([^)]+)\)/i);
    const eventFields = parseFields(node);
    const pdfUrl = safePdfUrl(node.querySelector('h2.box a.pdfLink')?.href);
    return { id: String(index + 1), kind, heading: header, bulletinNo: bulletin?.[1] || '', bulletinDate: dateText(bulletin?.[2]),
      effectiveDate: dateText(eventFields.find(field => field.code === '24')?.value),
      recordedDate: dateText(eventFields.find(field => field.code === '58')?.value),
      scope: eventFields.find(field => field.code === '53')?.value || '', fields: eventFields, pdfUrl };
  });
  // Hague renewals are international-register events, not VN refusal/grant
  // decisions. Keep them separately so they do not change the VN status pill.
  const renewalEvents = [...history.querySelectorAll('.transaction')]
    .filter(node => /^(?:Partial\s+)?Renewal\b/i.test(plainText(node.querySelector('h2.box'))))
    .map((node, index) => {
      const heading = plainText(node.querySelector('h2.box'));
      const eventFields = parseFields(node);
      const bulletin = heading.match(/Bulletin No\.\s*([\d/]+)\s*\(([^)]+)\)/i);
      return { id: `renewal-${index + 1}`, kind: /^Partial Renewal/i.test(heading) ? 'Partial renewal' : 'Renewal', heading,
        bulletinNo: bulletin?.[1] || '', bulletinDate: dateText(bulletin?.[2]),
        fields: eventFields, renewalDate: dateText(eventFields.find(field => field.code === '15')?.value),
        expirationDate: dateText(eventFields.find(field => field.code === '18')?.value),
        scope: eventFields.find(field => field.code === '53')?.value || '',
        designatedParties: eventFields.find(field => field.code === '81')?.value || '',
        pdfUrl: safePdfUrl(node.querySelector('h2.box a.pdfLink')?.href) };
    });
  const order = value => { const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? `${match[3]}${match[2]}${match[1]}` : ''; };
  events.sort((a, b) => order(b.bulletinDate).localeCompare(order(a.bulletinDate)));
  events.forEach((event, index) => {
    const fileName = event.pdfUrl ? path.basename(new URL(event.pdfUrl).pathname, '.pdf') : '';
    event.id = /^[A-Za-z0-9_-]{1,80}$/.test(fileName) ? fileName : `event-${index + 1}`;
  });
  const designated = fields.find(field => field.code === '81')?.value || '';
  const designationVN = /\bVN\b/.test(designated);
  const status = events[0]?.kind || (designationVN ? 'No VN decision recorded' : 'VN not designated');
  const people = (code) => {
    const field = fields.find(item => item.code === code);
    const values = field?.items.length ? field.items : field?.value ? [field.value] : [];
    return values.map(value => {
      const designNo = (value.match(/^(\d+)\.\s*/) || [])[1] || '';
      const lines = value.replace(/^\d+\.\s*/, '').split('\n').map(line => line.trim()).filter(Boolean);
      const name = lines.shift() || '';
      // Hague creator names sometimes have a line break between given name and surname.
      const surnameLine = code === '72' && !/\s|,/.test(name) && /^[\p{L}'’-]+$/u.test(lines[0] || '') && lines.length > 1;
      return { ...(designNo ? { designNo } : {}), name: surnameLine ? `${name} ${lines.shift()}` : name, address: lines.join('\n') };
    });
  };
  return { ok: true, number, url: hagueUrl(number), status, fields, events, renewalEvents,
    holders: people('73'), representatives: people('74'), creators: people('72'),
    numberOfDesigns: fields.find(field => field.code === '28')?.value || '',
    currentStatus: plainText(current.querySelector('.box.split')),
    internationalState: (plainText(current).match(/\b(Expired|Active|Cancelled|Terminated)\b/i) || [])[1] || '',
    registrationDate: dateText(fields.find(field => field.code === '15')?.value),
    expirationDate: dateText(fields.find(field => field.code === '18')?.value),
    filingDate: dateText(fields.find(field => field.code === '22')?.value) };
}

async function fetchBounded(url, fetcher = fetch, maxBytes = 5_000_000) {
  const pdf = /\.pdf(?:$|\?)/i.test(url);
  const response = await fetcher(url, { signal: AbortSignal.timeout(20000), headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    Accept: pdf ? 'application/pdf,*/*' : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    ...(pdf ? { Referer: 'https://designdb.wipo.int/' } : {}),
  } });
  if (!response.ok || response.status === 202) throw new Error(`WIPO returned HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length'));
  if (length > maxBytes) throw new Error('WIPO response exceeds the size limit.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('WIPO response exceeds the size limit.');
  return bytes;
}

function parseHaguePdfText(text) {
  const source = String(text || '').replace(/\s+/g, ' ');
  const section = (start, end) => {
    const match = source.match(new RegExp(`(?:^|\\s)${start}\\.\\s*([\\s\\S]*?)(?=\\s+${end}\\.|$)`, 'i'));
    return match?.[1]?.trim() || '';
  };
  const officeSection = section('I', 'II');
  const registrationSection = section('II', 'III');
  const sectionV = section('V', 'VI');
  const effectSection = section('VI', 'VII');
  const statementSection = section('VII', 'VIII');
  const decision = source.match(/(?:Decision\s*No\.?|Decision\s*Number)\s*:?\s*(.*?)\s+of\s+(\d{1,2}[./]\d{1,2}[./]\d{4})/i);
  const decisionFallback = source.match(/(?:Decision\s*No\.?|Decision\s*Number)\s*:?\s*(\S+)/i);
  const vnApplicationNos = [...new Set([...source.matchAll(/\b8\s*-\s*(\d{4})\s*-\s*(\d{5})\b/g)]
    .map((match) => `8-${match[1]}-${match[2]}`))];
  const scope = /protection is granted for all the industrial designs/i.test(source) ? 'All designs'
    : /protection is granted for the following industrial designs/i.test(source) ? 'Some designs' : '';
  return { registrationNo: normalizeHagueNo((registrationSection.match(/DM\s*\/?\s*\d{3}\s*\d{3}/i) || [])[0]), vnApplicationNos,
    decisionNo: (decision?.[1] || decisionFallback?.[1] || '').replace(/\.\s+([A-Z]{1,3})\b/g, '.$1').trim(), decisionDate: dateText(decision?.[2]), scope,
    office: officeSection.replace(/^Office sending the (?:statement|notification)\s*:?\s*/i, '').trim(),
    amendments: /^Information concerning amendments/i.test(sectionV) ? sectionV.replace(/^Information concerning amendments\s*(?:\(where applicable\))?\s*:?\s*/i, '').trim() : '',
    refusalGrounds: /^Grounds for refusal/i.test(sectionV) ? sectionV.replace(/^Grounds for refusal\s*:?\s*/i, '').trim() : '',
    effectDate: dateText(effectSection), statementDate: dateText(statementSection) };
}

async function extractPdfData(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true }).promise;
  const parts = [];
  for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, 20); pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    parts.push((await page.getTextContent()).items.map(item => item.str || '').join(' '));
  }
  return parseHaguePdfText(parts.join(' '));
}

async function enrichCachedRefusalNumbers(record, cacheRoot) {
  let changed = false;
  for (const event of record.events || []) {
    if (!/refusal/i.test(event.kind || '') || !event.pdfAvailable || Array.isArray(event.pdfData?.vnApplicationNos)) continue;
    const pdfPath = haguePdfPath(record.number, event.id, cacheRoot);
    if (!pdfPath) continue;
    try {
      const parsed = await extractPdfData(fs.readFileSync(pdfPath));
      event.pdfData = { ...(event.pdfData || {}), vnApplicationNos: parsed.vnApplicationNos };
      changed = true;
    } catch { /* Keep the original cached PDF data if text extraction fails. */ }
  }
  return changed;
}

async function lookupHagueDesign(number, options = {}) {
  const canonical = normalizeHagueNo(number);
  if (!canonical) throw new Error('Invalid Hague design number.');
  const cacheRoot = options.cacheRoot || CACHE_ROOT;
  const cacheFile = path.join(cacheRoot, canonical.slice(3), 'record.json');
  const ttlMs = options.ttlMs ?? 6 * 60 * 60 * 1000;
  if (!options.refresh && fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < ttlMs) {
    const record = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (await enrichCachedRefusalNumbers(record, cacheRoot)) fs.writeFileSync(cacheFile, JSON.stringify(record, null, 2), 'utf8');
    return record;
  }
  if (active.has(canonical)) return active.get(canonical);
  const job = (async () => {
    try {
      const html = (await fetchBounded(hagueUrl(canonical), options.fetcher)).toString('utf8');
      const record = parseHagueHtml(html, canonical);
      record.checkedAt = new Date().toISOString();
      for (const event of [...record.events, ...record.renewalEvents].filter(item => item.pdfUrl)) {
        const pdfPath = path.join(cacheRoot, canonical.slice(3), `VN-${event.id}.pdf`);
        try {
          let bytes;
          if (fs.existsSync(pdfPath) && fs.readFileSync(pdfPath).subarray(0, 4).toString() === '%PDF') bytes = fs.readFileSync(pdfPath);
          else {
            bytes = await fetchBounded(event.pdfUrl, options.fetcher, 30_000_000);
            if (bytes.subarray(0, 4).toString() !== '%PDF') throw new Error('WIPO did not return a PDF.');
            fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
            fs.writeFileSync(pdfPath, bytes);
          }
          event.pdfAvailable = true;
          try { event.pdfData = await extractPdfData(bytes); }
          catch (error) { event.pdfError = `PDF text could not be read: ${error.message}`; }
        } catch (error) { event.pdfAvailable = false; event.pdfError = error.message; }
      }
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(record, null, 2), 'utf8');
      return record;
    } catch (error) {
      if (fs.existsSync(cacheFile)) return { ...JSON.parse(fs.readFileSync(cacheFile, 'utf8')), stale: true, lookupError: error.message };
      throw error;
    }
  })();
  active.set(canonical, job);
  try { return await job; } finally { active.delete(canonical); }
}

function haguePdfPath(number, eventId, cacheRoot = CACHE_ROOT) {
  const canonical = normalizeHagueNo(number);
  if (!canonical || !/^[A-Za-z0-9_-]{1,80}$/.test(String(eventId))) return '';
  const file = path.join(cacheRoot, canonical.slice(3), `VN-${eventId}.pdf`);
  if (!fs.existsSync(file)) return '';
  const handle = fs.openSync(file, 'r');
  try { const header = Buffer.alloc(4); return fs.readSync(handle, header, 0, 4, 0) === 4 && header.toString() === '%PDF' ? file : ''; }
  finally { fs.closeSync(handle); }
}

module.exports = { normalizeHagueNo, parseHagueNos, hagueUrl, parseHagueHtml, parseHaguePdfText, lookupHagueDesign, haguePdfPath, cachedHagueDesign };
