'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Agent } = require('undici');
const { JSDOM } = require('jsdom');

const WIPO_HOME = 'https://wipopublish.ipvietnam.gov.vn/';
const WIPO_TRADEMARK_IMAGE = 'https://wipopublish.ipvietnam.gov.vn/wopublish-search/service/trademarks/application/VN4202531926/logo?noLogo=true';
const HISTORY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HANOI_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_CHECK_HTML_BYTES = 128 * 1024;

function isUnverifiedTransportError(reason) {
  return /timeout|timed out|abort|CERT_|UNABLE_TO_VERIFY|SELF_SIGNED|ERR_TLS_CERT|fetch failed/i.test(String(reason || ''));
}

async function hasImageContent(response) {
  if (response.status !== 200 || !/^image\/(?:jpeg|png|gif|webp)(?:;|$)/i.test(response.headers?.get?.('content-type') || '')) {
    await response.body?.cancel?.().catch(() => {});
    return false;
  }
  const reader = response.body?.getReader?.();
  if (!reader) return false;
  try {
    const { value } = await reader.read();
    if (!value?.length) return false;
    const bytes = Buffer.from(value);
    return (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.subarray(0, 4).toString('ascii') === 'GIF8'
      || (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP');
  } finally { await reader.cancel().catch(() => {}); }
}

function inspectHomePage(html) {
  const source = String(html || '');
  if (/under maintenance|site maintenance|temporarily unavailable|đang bảo trì|bảo trì hệ thống/i.test(source))
    return { state: 'down', error: 'WIPOPublish is under maintenance.' };
  if (/g-recaptcha|captcha-container|access denied|too many requests/i.test(source))
    return { state: 'unknown', error: 'WIPOPublish returned a CAPTCHA or access restriction.' };
  const dom = new JSDOM(source);
  const document = dom.window.document;
  const valid = document.title.trim() === 'IP Viet Nam'
    && Boolean(document.querySelector('form#queryFormGlobal'))
    && Boolean(document.querySelector('input#homeSearchSubmitLink'));
  dom.window.close();
  return valid ? { state: 'up', error: '' } : { state: 'unknown', error: 'The WIPOPublish home page did not contain its search form and button.' };
}

async function readLimitedHtml(response) {
  if (!response.body?.getReader) return String(await response.text?.() || '').slice(0, MAX_CHECK_HTML_BYTES);
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (size < MAX_CHECK_HTML_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value.subarray(0, MAX_CHECK_HTML_BYTES - size));
      size += Math.min(value.length, MAX_CHECK_HTML_BYTES - size);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function hanoiDay(timestamp) {
  return new Date(timestamp + HANOI_OFFSET_MS).toISOString().slice(0, 10);
}

function dayKeys(now) {
  const today = Math.floor((now + HANOI_OFFSET_MS) / DAY_MS) * DAY_MS;
  return Array.from({ length: HISTORY_DAYS }, (_, index) => new Date(today - (HISTORY_DAYS - 1 - index) * DAY_MS).toISOString().slice(0, 10));
}

function createWipoSiteMonitor(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const url = options.url || WIPO_HOME;
  const intervalMs = Math.max(1000, Number(options.intervalMs) || 60000);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);
  const now = options.now || Date.now;
  const snapshotEvents = typeof options.snapshotEvents === 'function' ? options.snapshotEvents : null;
  const historyDir = options.historyDir === false ? null : path.resolve(options.historyDir || path.join(__dirname, 'data', 'wipo-site-checks'));
  // Match the scraper's WIPO-only TLS workaround; never disable TLS checks
  // process-wide. WIPO_ALLOW_INSECURE_TLS=0 restores strict validation.
  const insecureTls = options.allowInsecureTls ?? process.env.WIPO_ALLOW_INSECURE_TLS !== '0';
  const dispatcher = options.dispatcher || (!options.fetchImpl && insecureTls && new URL(url).hostname === new URL(WIPO_HOME).hostname ? new Agent({ connect: { rejectUnauthorized: false } }) : null);
  let current = { state: 'unknown', checkedAt: null, httpStatus: null, error: '' };
  let pending = null;
  let timer = null;
  let lastPrunedDay = '';
  let lastStored = null;
  let confirmationVersion = 0;
  let lastConfirmedResult = null;
  let backfillPromise = null;
  let backfillDone = false;

  function confirmScrapeSuccess(applicationNo, snapshot = {}) {
    if (!applicationNo) return;
    const identifier = String(applicationNo).trim();
    if (!identifier) return;
    confirmationVersion += 1;
    current = { state: 'up', checkedAt: new Date(now()).toISOString(), httpStatus: 200,
      error: '', source: 'scrape', confirmedApplicationNo: identifier };
    lastConfirmedResult = current;
    storeCheck(current);
    storeScrape({ scrapedAt: Number.isFinite(Date.parse(snapshot.scrapedAt)) ? snapshot.scrapedAt : current.checkedAt, identifier,
      snapshotId: snapshot.snapshotId, source: 'live' });
  }

  function storeScrape(result) {
    if (!historyDir) return;
    const timestamp = Date.parse(result.scrapedAt);
    if (!Number.isFinite(timestamp)) return;
    try {
      fs.mkdirSync(historyDir, { recursive: true });
      const stamp = { t: new Date(timestamp).toISOString(), id: result.identifier,
        ...(result.snapshotId ? { sid: result.snapshotId } : {}), src: result.source || 'live' };
      fs.appendFileSync(path.join(historyDir, `${stamp.t.slice(0, 10)}.scrapes.jsonl`), `${JSON.stringify(stamp)}\n`, 'utf8');
      pruneHistory(dayKeys(now()));
    } catch (error) {
      console.warn(`WIPO successful scrape history could not be saved: ${error.message}`);
    }
  }

  async function backfillSnapshots() {
    if (!historyDir || !snapshotEvents || backfillDone) return;
    if (backfillPromise) return backfillPromise;
    backfillPromise = (async () => {
      const validDays = dayKeys(now());
      const firstUtcFile = new Date(Date.parse(`${validDays[0]}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
      const existing = [];
      for (let fileDay = Date.parse(`${firstUtcFile}T00:00:00Z`); fileDay <= Date.parse(`${validDays.at(-1)}T00:00:00Z`); fileDay += DAY_MS) {
        const utcDate = new Date(fileDay).toISOString().slice(0, 10);
        let raw = '';
        try { raw = await fs.promises.readFile(path.join(historyDir, `${utcDate}.scrapes.jsonl`), 'utf8'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        for (const line of raw.split('\n')) {
          if (!line) continue;
          try {
            const item = JSON.parse(line);
            if (item.id && Number.isFinite(Date.parse(item.t))) existing.push(item);
          } catch { /* Ignore an incomplete concurrent write. */ }
        }
      }
      const response = await snapshotEvents(firstUtcFile);
      const snapshots = Array.isArray(response) ? response : response?.snapshots || [];
      const matched = new Set();
      for (const row of snapshots) {
        const timestamp = Date.parse(row.scrapedAt);
        const identifier = String(row.applicationNo || '').trim();
        const snapshotId = Number(row.snapshotId);
        if (!identifier || !Number.isFinite(timestamp) || !Number.isInteger(snapshotId) || snapshotId < 1
          || !validDays.includes(hanoiDay(timestamp))) continue;
        // Older live events lack a snapshot ID. Pair each with at most one
        // nearby snapshot of the same application before writing the rest.
        const index = existing.findIndex((item, position) => !matched.has(position)
          && ((Number(item.sid) === snapshotId)
            || (!item.sid && item.id === identifier && Math.abs(Date.parse(item.t) - timestamp) <= 120_000)));
        if (index >= 0) { matched.add(index); continue; }
        storeScrape({ scrapedAt: new Date(timestamp).toISOString(), identifier, snapshotId, source: 'snapshot' });
      }
      backfillDone = true;
    })().finally(() => { backfillPromise = null; });
    return backfillPromise;
  }

  function pruneHistory(validDays) {
    if (!historyDir || lastPrunedDay === validDays.at(-1)) return;
    // The first hours of a Hanoi day reside in the preceding UTC file.
    const firstUtcFile = new Date(Date.parse(`${validDays[0]}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    for (const name of fs.readdirSync(historyDir)) {
      const match = /^(\d{4}-\d{2}-\d{2})(?:\.scrapes)?\.jsonl$/.exec(name);
      if (match && match[1] < firstUtcFile) fs.unlinkSync(path.join(historyDir, name));
    }
    lastPrunedDay = validDays.at(-1);
  }

  function storeCheck(result) {
    if (!historyDir) return;
    const elapsed = lastStored ? Date.parse(result.checkedAt) - Date.parse(lastStored.checkedAt) : Infinity;
    // Forced checks may be frequent during a scrape outage. Keep at most one
    // stable-state sample per interval, but always retain an up/down change.
    if (lastStored?.state === result.state && elapsed >= 0 && elapsed < intervalMs) return;
    try {
      fs.mkdirSync(historyDir, { recursive: true });
      const stamp = { t: result.checkedAt, s: result.state, h: result.httpStatus, e: String(result.error || '').slice(0, 200) };
      fs.appendFileSync(path.join(historyDir, `${stamp.t.slice(0, 10)}.jsonl`), `${JSON.stringify(stamp)}\n`, 'utf8');
      lastStored = result;
      pruneHistory(dayKeys(now()));
    } catch (error) {
      console.warn(`WIPO site check history could not be saved: ${error.message}`);
    }
  }

  async function history(day) {
    await backfillSnapshots();
    const validDays = dayKeys(now());
    const selectedDay = validDays.includes(day) ? day : validDays.at(-1);
    const days = [];
    let up = 0; let down = 0; let unknown = 0; let selectedChecks = []; let selectedScrapes = []; let scraped = 0;
    const checksByDay = new Map(validDays.map((date) => [date, []]));
    const scrapesByDay = new Map(validDays.map((date) => [date, []]));
    if (historyDir) {
      const firstUtcFile = Date.parse(`${validDays[0]}T00:00:00Z`) - DAY_MS;
      const lastUtcFile = Date.parse(`${validDays.at(-1)}T00:00:00Z`);
      for (let fileDay = firstUtcFile; fileDay <= lastUtcFile; fileDay += DAY_MS) {
        const utcDate = new Date(fileDay).toISOString().slice(0, 10);
        let raw;
        try { raw = await fs.promises.readFile(path.join(historyDir, `${utcDate}.jsonl`), 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') raw = ''; else throw error; }
        for (const line of raw.split('\n')) {
          if (!line) continue;
          try {
            const item = JSON.parse(line);
            const timestamp = Date.parse(item.t);
            const localDay = Number.isFinite(timestamp) ? hanoiDay(timestamp) : null;
            if (!checksByDay.has(localDay) || !['up', 'down', 'unknown'].includes(item.s)) continue;
            // Old generic failures did not record the TLS cause, so they
            // cannot reliably establish that the WIPO site was down.
            const state = item.s === 'down' && item.h == null && isUnverifiedTransportError(item.e) ? 'unknown' : item.s;
            checksByDay.get(localDay).push({ checkedAt: item.t, state, httpStatus: item.h ?? null, error: item.e || '' });
          } catch { /* Skip an incomplete line written during a concurrent read. */ }
        }
        let scrapeRaw;
        try { scrapeRaw = await fs.promises.readFile(path.join(historyDir, `${utcDate}.scrapes.jsonl`), 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') scrapeRaw = ''; else throw error; }
        for (const line of scrapeRaw.split('\n')) {
          if (!line) continue;
          try {
            const item = JSON.parse(line);
            const timestamp = Date.parse(item.t);
            const localDay = Number.isFinite(timestamp) ? hanoiDay(timestamp) : null;
            if (!scrapesByDay.has(localDay) || !item.id) continue;
            scrapesByDay.get(localDay).push({ scrapedAt: item.t, identifier: String(item.id), source: item.src || 'live' });
          } catch { /* Skip an incomplete concurrent write. */ }
        }
      }
    }
    for (const date of validDays) {
      const checks = checksByDay.get(date);
      const dailyUp = checks.filter((item) => item.state === 'up').length;
      const dailyDown = checks.filter((item) => item.state === 'down').length;
      const dailyUnknown = checks.length - dailyUp - dailyDown;
      const dailyScraped = scrapesByDay.get(date).length;
      up += dailyUp; down += dailyDown; unknown += dailyUnknown;
      scraped += dailyScraped;
      days.push({ date, up: dailyUp, down: dailyDown, unknown: dailyUnknown, scraped: dailyScraped, total: checks.length, percent: dailyUp + dailyDown ? Math.round(dailyUp / (dailyUp + dailyDown) * 10000) / 100 : null });
      if (date === selectedDay) { selectedChecks = checks; selectedScrapes = scrapesByDay.get(date); }
    }
    return { days, selectedDay, checks: selectedChecks, scrapes: selectedScrapes,
      totals: { up, down, unknown, scraped, total: up + down + unknown, percent: up + down ? Math.round(up / (up + down) * 10000) / 100 : null },
      intervalMs, retentionDays: HISTORY_DAYS, timeZone: 'Asia/Ho_Chi_Minh', utcOffsetMinutes: 420 };
  }

  async function check(force = false) {
    if (pending) return pending;
    if (!force && current.checkedAt && now() - Date.parse(current.checkedAt) < intervalMs) return current;
    const versionAtStart = confirmationVersion;
    pending = (async () => {
      try {
        const requestOptions = { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'SoftIP-WipoPublish-availability-check/1.0' }, ...(dispatcher ? { dispatcher } : {}) };
        let requestUrl = url;
        let response;
        for (let redirects = 0; redirects <= 4; redirects += 1) {
          response = await fetchImpl(requestUrl, requestOptions);
          const location = response.headers?.get?.('location');
          if (redirects === 4 || ![301, 302, 303, 307, 308].includes(response.status) || !location) break;
          const nextUrl = new URL(location, requestUrl);
          if (nextUrl.origin !== new URL(url).origin) break;
          await response.body?.cancel?.().catch(() => {});
          requestUrl = nextUrl.href;
        }
        const result = response.status === 200 ? inspectHomePage(await readLimitedHtml(response))
          : { state: response.status >= 500 ? 'down' : 'unknown', error: `WIPO returned HTTP ${response.status}.` };
        if (response.status !== 200) await response.body?.cancel?.().catch(() => {});
        current = { ...result, checkedAt: new Date(now()).toISOString(), httpStatus: response.status, source: 'homepage' };
      } catch (error) {
        const reason = error?.cause?.code || error?.cause?.message || error?.message || 'WIPO could not be reached.';
        current = { state: isUnverifiedTransportError(reason) ? 'unknown' : 'down', checkedAt: new Date(now()).toISOString(), httpStatus: null, error: reason, source: 'homepage' };
        // A transport failure is ambiguous. Try one small public image, never
        // an application-detail AJAX request, before reporting availability.
        try {
          const imageUrl = new URL(WIPO_TRADEMARK_IMAGE, url);
          if (imageUrl.origin === new URL(url).origin) {
            const imageResponse = await fetchImpl(imageUrl.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
              headers: { 'User-Agent': 'SoftIP-WipoPublish-availability-check/1.0' }, ...(dispatcher ? { dispatcher } : {}) });
            if (await hasImageContent(imageResponse)) current = { state: 'up', checkedAt: new Date(now()).toISOString(), httpStatus: 200,
              error: 'Home page check failed; trademark image loaded.', source: 'trademark-image' };
          }
        } catch { /* The original homepage failure remains the diagnostic detail. */ }
      }
      if (confirmationVersion !== versionAtStart) {
        current = lastConfirmedResult;
        return current;
      }
      storeCheck(current);
      return current;
    })().finally(() => { pending = null; });
    return pending;
  }

  function start() {
    if (timer) return;
    check().catch(() => {});
    timer = setInterval(() => check(true).catch(() => {}), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { check, history, start, stop, confirmScrapeSuccess, snapshot: () => ({ ...current }) };
}

module.exports = { WIPO_HOME, WIPO_TRADEMARK_IMAGE, HISTORY_DAYS, inspectHomePage, createWipoSiteMonitor };
