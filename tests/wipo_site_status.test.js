'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWipoSiteMonitor, WIPO_HOME, WIPO_TRADEMARK_IMAGE, HISTORY_DAYS, inspectHomePage } = require('../wipo_site_status');
const HOME_HTML = '<html><head><title>IP Viet Nam</title></head><body><form id="queryFormGlobal"><input id="homeSearchSubmitLink" type="submit"></form></body></html>';
const page = (status = 200, html = HOME_HTML) => ({ status, text: async () => html });

test('WIPO site monitor checks the homepage and caches the latest result', async () => {
  let calls = 0;
  const monitor = createWipoSiteMonitor({ historyDir: false, fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url, WIPO_HOME);
    assert.equal(options.method, 'GET');
    return page();
  } });
  assert.equal(monitor.snapshot().state, 'unknown');
  assert.equal((await monitor.check()).state, 'up');
  assert.equal((await monitor.check()).state, 'up');
  assert.equal(calls, 1);
  assert.ok(monitor.snapshot().checkedAt);
});

test('CAPTCHA, access denial, and timeouts are unverified; HTTP 5xx is down', async () => {
  let status = 403;
  const monitor = createWipoSiteMonitor({ historyDir: false, fetchImpl: async () => {
    if (status === 0) throw new Error('Connection timed out');
    return page(status);
  } });
  assert.equal((await monitor.check()).state, 'unknown');
  status = 503;
  assert.equal((await monitor.check(true)).state, 'down');
  assert.equal(monitor.snapshot().httpStatus, 503);
  status = 0;
  assert.equal((await monitor.check(true)).state, 'unknown');
  assert.match(monitor.snapshot().error, /timed out/);
  status = 200;
  assert.equal((await monitor.check(true)).state, 'up');
});

test('WIPO checks persist across monitor instances, summarize days, and prune after 30 days', async (t) => {
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-site-history-'));
  assert.ok(historyDir.startsWith(os.tmpdir() + path.sep));
  t.after(() => fs.rmSync(historyDir, { recursive: true, force: true }));
  let now = Date.parse('2026-09-01T10:00:00.000Z');
  let status = 200;
  const options = { historyDir, now: () => now, fetchImpl: async () => page(status) };
  const monitor = createWipoSiteMonitor(options);
  await monitor.check();
  const firstLine = fs.readFileSync(path.join(historyDir, '2026-09-01.jsonl'), 'utf8');
  assert.ok(firstLine.length * 60 * 24 * HISTORY_DAYS < 5_000_000, 'a full month of normal checks should remain below about 5 MB');
  assert.equal((await monitor.check()).state, 'up');
  assert.equal((await monitor.check(true)).state, 'up');
  assert.equal(fs.readFileSync(path.join(historyDir, '2026-09-01.jsonl'), 'utf8'), firstLine, 'cached checks do not create duplicate stamps');
  now = Date.parse('2026-09-02T11:00:00.000Z');
  status = 503;
  await monitor.check();
  const restarted = createWipoSiteMonitor(options);
  const history = await restarted.history('2026-09-02');
  assert.equal(history.days.length, 30);
  assert.equal(history.timeZone, 'Asia/Ho_Chi_Minh');
  assert.deepEqual(history.totals, { up: 1, down: 1, unknown: 0, scraped: 0, total: 2, percent: 50 });
  assert.equal(history.checks[0].httpStatus, 503);
  assert.equal(history.days.at(-1).percent, 0);
  now = Date.parse('2026-10-02T11:00:00.000Z');
  status = 200;
  await monitor.check();
  assert.equal(fs.existsSync(path.join(historyDir, '2026-09-01.jsonl')), false);
  assert.equal((await restarted.history()).totals.total, 1);
});

test('legacy generic fetch failures are unverified rather than counted as outages', async (t) => {
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-site-legacy-'));
  t.after(() => fs.rmSync(historyDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(historyDir, '2026-10-05.jsonl'), [
    JSON.stringify({ t: '2026-10-05T05:07:06.000Z', s: 'down', h: null, e: 'fetch failed' }),
    JSON.stringify({ t: '2026-10-05T05:08:06.000Z', s: 'up', h: 302, e: '' }),
    '',
  ].join('\n'));
  const monitor = createWipoSiteMonitor({ historyDir, now: () => Date.parse('2026-10-05T05:09:00Z'), fetchImpl: async () => ({ status: 302 }) });
  const history = await monitor.history();
  assert.deepEqual(history.totals, { up: 1, down: 0, unknown: 1, scraped: 0, total: 2, percent: 100 });
  assert.equal(history.checks[0].state, 'unknown');
  assert.equal(history.days.at(-1).unknown, 1);
});

test('TLS validation failures are unverified; network failures remain down', async () => {
  let cause = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
  const monitor = createWipoSiteMonitor({ historyDir: false, fetchImpl: async () => {
    const error = new Error('fetch failed');
    error.cause = { code: cause };
    throw error;
  } });
  assert.equal((await monitor.check()).state, 'unknown');
  assert.equal(monitor.snapshot().error, cause);
  cause = 'ECONNREFUSED';
  assert.equal((await monitor.check(true)).state, 'down');
  assert.equal(monitor.snapshot().error, cause);
});

test('the monitor follows WIPO redirects but never sends its scoped connection to another origin', async () => {
  const visited = [];
  const monitor = createWipoSiteMonitor({ historyDir: false, fetchImpl: async (url, options) => {
    visited.push(url);
    assert.equal(options.redirect, 'manual');
    if (visited.length === 1) return { status: 302, headers: { get: () => '/wopublish-search/public/home' } };
    if (visited.length === 2) return { status: 302, headers: { get: () => 'https://elsewhere.example/landing' } };
    throw new Error('A cross-origin request must not be sent');
  } });
  assert.equal((await monitor.check()).state, 'unknown');
  assert.deepEqual(visited, [WIPO_HOME, `${new URL(WIPO_HOME).origin}/wopublish-search/public/home`]);
});

test('Hanoi day buckets include the preceding UTC evening and move midnight checks to the next day', async (t) => {
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-site-hanoi-'));
  t.after(() => fs.rmSync(historyDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(historyDir, '2026-10-04.jsonl'), [
    JSON.stringify({ t: '2026-10-04T16:59:00.000Z', s: 'up', h: 200, e: '' }),
    JSON.stringify({ t: '2026-10-04T17:01:00.000Z', s: 'down', h: 503, e: 'HTTP 503' }),
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(historyDir, '2026-10-05.jsonl'), `${JSON.stringify({ t: '2026-10-05T05:08:50.000Z', s: 'up', h: 200, e: '' })}\n`);
  const monitor = createWipoSiteMonitor({ historyDir, now: () => Date.parse('2026-10-05T05:09:00.000Z'), fetchImpl: async () => ({ status: 200 }) });
  const today = await monitor.history();
  assert.equal(today.selectedDay, '2026-10-05');
  assert.deepEqual(today.checks.map((item) => item.checkedAt), ['2026-10-04T17:01:00.000Z', '2026-10-05T05:08:50.000Z']);
  assert.deepEqual(today.days.at(-1), { date: '2026-10-05', up: 1, down: 1, unknown: 0, scraped: 0, total: 2, percent: 50 });
  const yesterday = await monitor.history('2026-10-04');
  assert.deepEqual(yesterday.checks.map((item) => item.checkedAt), ['2026-10-04T16:59:00.000Z']);
});

test('30 Hanoi days retain the preceding UTC file needed for the earliest local day', async (t) => {
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-site-retention-'));
  t.after(() => fs.rmSync(historyDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(historyDir, '2026-09-04.jsonl'), `${JSON.stringify({ t: '2026-09-04T18:00:00.000Z', s: 'up', h: 200, e: '' })}\n`);
  fs.writeFileSync(path.join(historyDir, '2026-09-05.jsonl'), `${JSON.stringify({ t: '2026-09-05T18:00:00.000Z', s: 'up', h: 200, e: '' })}\n`);
  const monitor = createWipoSiteMonitor({ historyDir, now: () => Date.parse('2026-10-05T05:09:00.000Z'), fetchImpl: async () => ({ status: 200 }) });
  await monitor.check();
  assert.equal(fs.existsSync(path.join(historyDir, '2026-09-04.jsonl')), false);
  assert.equal(fs.existsSync(path.join(historyDir, '2026-09-05.jsonl')), true);
  const history = await monitor.history('2026-09-06');
  assert.equal(history.days[0].date, '2026-09-06');
  assert.equal(history.checks[0].checkedAt, '2026-09-05T18:00:00.000Z');
});

test('home page requires the actual search UI and rejects a 200 maintenance page', () => {
  assert.equal(inspectHomePage(HOME_HTML).state, 'up');
  assert.equal(inspectHomePage('<html><title>IP Viet Nam</title><body>Site under maintenance</body></html>').state, 'down');
  assert.equal(inspectHomePage('<html><title>IP Viet Nam</title><body>Welcome</body></html>').state, 'unknown');
  assert.equal(inspectHomePage('<html><body>g-recaptcha</body></html>').state, 'unknown');
});

test('a valid homepage immediately restores Online without an application AJAX probe', async () => {
  let now = 0; let healthy = false; const visited = [];
  const monitor = createWipoSiteMonitor({ historyDir: false, now: () => now, fetchImpl: async (requestUrl) => {
    visited.push(requestUrl);
    return healthy ? page() : page(503);
  } });
  for (let index = 0; index < 15; index += 1) { assert.equal((await monitor.check(true)).state, 'down'); now += 60_000; }
  healthy = true;
  assert.equal((await monitor.check(true)).state, 'up');
  assert.equal(monitor.snapshot().source, 'homepage');
  assert.equal(visited.length, 16);
  assert.ok(visited.every((requestUrl) => requestUrl === WIPO_HOME));
});

test('a timeout checks one trademark image; a real image restores Online', async () => {
  const visited = [];
  const monitor = createWipoSiteMonitor({ historyDir: false, fetchImpl: async (requestUrl) => {
    visited.push(requestUrl);
    if (requestUrl === WIPO_HOME) throw new Error('The operation was aborted due to timeout');
    assert.equal(requestUrl, WIPO_TRADEMARK_IMAGE);
    return { status: 200, headers: { get: () => 'image/jpeg;charset=UTF-8' }, body: {
      getReader: () => ({ read: async () => ({ value: Uint8Array.of(0xff, 0xd8, 0xff, 0xe0), done: false }), cancel: async () => {} }),
    } };
  } });
  assert.equal((await monitor.check()).state, 'up');
  assert.equal(monitor.snapshot().source, 'trademark-image');
  assert.deepEqual(visited, [WIPO_HOME, WIPO_TRADEMARK_IMAGE]);
});

test('a non-image fallback cannot turn a homepage timeout into Online', async () => {
  const monitor = createWipoSiteMonitor({ historyDir: false, fetchImpl: async (requestUrl) => {
    if (requestUrl === WIPO_HOME) throw new Error('The operation was aborted due to timeout');
    return { status: 200, headers: { get: () => 'text/html' } };
  } });
  assert.equal((await monitor.check()).state, 'unknown');
  assert.match(monitor.snapshot().error, /timeout/);
});

test('previously recorded timeout failures display as unverified in history', async (t) => {
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-site-timeout-history-'));
  t.after(() => fs.rmSync(historyDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(historyDir, '2026-10-26.jsonl'), `${JSON.stringify({ t: '2026-10-26T03:52:29.000Z', s: 'down', h: null, e: 'The operation was aborted due to timeout' })}\n`);
  const monitor = createWipoSiteMonitor({ historyDir, now: () => Date.parse('2026-10-26T04:00:00Z'), fetchImpl: async () => page() });
  const history = await monitor.history();
  assert.equal(history.checks[0].state, 'unknown');
  assert.deepEqual(history.totals, { up: 0, down: 0, unknown: 1, scraped: 0, total: 1, percent: null });
});

test('every successful scrape is timestamped separately while availability checks remain sampled', async (t) => {
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-site-scrapes-'));
  t.after(() => fs.rmSync(historyDir, { recursive: true, force: true }));
  let now = Date.parse('2026-11-02T09:01:00Z');
  const monitor = createWipoSiteMonitor({ historyDir, now: () => now, fetchImpl: async () => page() });
  await monitor.check();
  now += 1000;
  monitor.confirmScrapeSuccess('4-2025-12345');
  now += 1000;
  monitor.confirmScrapeSuccess('1-2026-00001');
  monitor.confirmScrapeSuccess('  ');
  const restarted = createWipoSiteMonitor({ historyDir, now: () => now, fetchImpl: async () => page() });
  const history = await restarted.history('2026-11-02');
  assert.equal(history.totals.scraped, 2);
  assert.equal(history.days.at(-1).scraped, 2);
  assert.equal(history.totals.total, 1, 'scrape events must not inflate sampled availability checks');
  assert.deepEqual(history.scrapes.map((item) => item.identifier), ['4-2025-12345', '1-2026-00001']);
  assert.deepEqual(history.scrapes.map((item) => item.scrapedAt), ['2026-11-02T09:01:01.000Z', '2026-11-02T09:01:02.000Z']);
});

test('snapshot backfill imports historical successes once and matches prior live events', async (t) => {
  const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-snapshot-backfill-'));
  t.after(() => fs.rmSync(historyDir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T10:00:00Z');
  let queries = 0;
  const snapshotEvents = async (since) => {
    queries += 1;
    assert.ok(since <= '2026-10-04');
    return [
      { snapshotId: 11, applicationNo: '4-2025-12345', scrapedAt: '2026-11-02T09:01:00Z' },
      { snapshotId: 12, applicationNo: '1-2026-00001', scrapedAt: '2026-11-02T09:02:00Z' },
      { snapshotId: 13, applicationNo: '3-2025-00123', scrapedAt: '2026-09-01T09:02:00Z' },
    ];
  };
  fs.writeFileSync(path.join(historyDir, '2026-11-02.scrapes.jsonl'),
    `${JSON.stringify({ t: '2026-11-02T09:01:03Z', id: '4-2025-12345', src: 'live' })}\n`);
  const options = { historyDir, now: () => now, snapshotEvents, fetchImpl: async () => page() };
  const monitor = createWipoSiteMonitor(options);
  const first = await monitor.history();
  assert.equal(first.totals.scraped, 2);
  assert.deepEqual(first.scrapes.map((item) => [item.identifier, item.source]),
    [['4-2025-12345', 'live'], ['1-2026-00001', 'snapshot']]);
  assert.equal((await monitor.history()).totals.scraped, 2);
  assert.equal(queries, 1);
  assert.equal((await createWipoSiteMonitor(options).history()).totals.scraped, 2);
});
