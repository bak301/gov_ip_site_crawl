const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { createScraperLineEmitter, createScrapeQueue, createLanServer, encodeHeaderFileName } = require('../lan-server');

test('scraper output is emitted as complete lines even when chunks split a word', () => {
  const lines = [];
  const output = createScraperLineEmitter((line) => lines.push(line));
  output.push('Fast batch 4-2025-65702 · attempt 1/');
  output.push('10\r\nRequest Timeout: 15000ms\nStored 4-2025-');
  output.push('65702');
  output.flush();
  assert.deepEqual(lines, [
    'Fast batch 4-2025-65702 · attempt 1/10',
    'Request Timeout: 15000ms',
    'Stored 4-2025-65702',
  ]);
});

test('LAN job log exposes new events once through a sequence cursor', async () => {
  const queue = createScrapeQueue(async (ids, _preset, _retry, onMessage) => {
    onMessage({ type: 'log', message: 'First line' });
    onMessage({ type: 'log', message: 'Second line' });
    return { ok: true, imported: [{ applicationNo: ids[0] }], missing: [] };
  }, 1, { dispatchIntervalMs: 0 });
  const job = queue.enqueue(['4-2025-65702']);
  await waitForJob(queue, job.id);
  const events = queue.logEvents(job.id);
  assert.deepEqual(events.map((event) => event.message).slice(1, 3), ['First line', 'Second line']);
  assert.deepEqual(queue.logEvents(job.id, events[1].sequence), events.slice(2));
});

async function waitForJob(queue, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = queue.get(id);
    if (job?.status === 'done' || job?.status === 'failed' || job?.status === 'cancelled') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job ${id} did not finish.`);
}

test('shared queue runs indexed records first and prior not-found records last within a user', async () => {
  const calls = [];
  const queue = createScrapeQueue(async (ids) => {
    calls.push(ids[0]);
    return { ok: true, imported: [{ applicationNo: ids[0] }], missing: [] };
  }, 1, { dispatchIntervalMs: 0 });
  const unknown = '1-2026-00001';
  const notFound = '3-2026-00002';
  const indexed = '4-2026-00003';
  const job = queue.enqueue([unknown, notFound, indexed], 1, 1, 'browser-a', '', {
    [unknown]: { rank: 1 }, [notFound]: { rank: 2 }, [indexed]: { rank: 0 },
  });
  await waitForJob(queue, job.id);
  assert.deepEqual(calls, [indexed, unknown, notFound]);
});

test('an indexed retry waits until other records have had their first turn', async () => {
  const calls = [];
  const indexed = '1-2026-00001';
  const unknown = '3-2026-00002';
  const queue = createScrapeQueue(async (ids) => {
    calls.push(ids[0]);
    if (ids[0] === indexed && calls.filter((id) => id === indexed).length === 1) {
      return { ok: false, imported: [], missing: ids };
    }
    return { ok: true, imported: [{ applicationNo: ids[0] }], missing: [] };
  }, 1, { dispatchIntervalMs: 0 });
  const job = queue.enqueue([unknown, indexed], 1, 2, 'browser-a', '', {
    [unknown]: { rank: 1 }, [indexed]: { rank: 0 },
  });
  await waitForJob(queue, job.id);
  assert.deepEqual(calls, [indexed, unknown, indexed]);
});

test('shared scrape queue coalesces overlapping application requests', async () => {
  const calls = [];
  const queue = createScrapeQueue(async (ids) => {
    calls.push(ids);
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  }, 15, { dispatchIntervalMs: 0 });
  const first = queue.enqueue(['1-2022-01097', '1-2021-00452']);
  const second = queue.enqueue(['1-2021-00452', '1-2021-03185']);
  const [firstResult, secondResult] = await Promise.all([waitForJob(queue, first.id), waitForJob(queue, second.id)]);
  assert.equal(firstResult.status, 'done');
  assert.equal(secondResult.status, 'done');
  assert.deepEqual(calls, [['1-2022-01097'], ['1-2021-00452'], ['1-2021-03185']]);
  assert.deepEqual(secondResult.result.imported.map((item) => item.applicationNo), ['1-2021-03185', '1-2021-00452']);
});

test('shared scrape queue runs three isolated user jobs concurrently', async () => {
  let active = 0;
  let maximum = 0;
  const releases = [];
  const queue = createScrapeQueue(async (ids) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  }, 3, { dispatchIntervalMs: 0 });
  const jobs = ['1-2022-00001', '1-2022-00002', '1-2022-00003', '1-2022-00004'].map((id, index) => queue.enqueue([id], 1, 2, `user-${index + 1}`));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queue.snapshot().activeJobs, 3);
  assert.equal(queue.snapshot().queuedJobs, 1);
  releases.shift()();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queue.snapshot().activeJobs, 3);
  while (releases.length) releases.shift()();
  await Promise.all(jobs.map((job) => waitForJob(queue, job.id)));
  assert.equal(maximum, 3);
});

test('20 first-user slots and five burst slots keep 15 light users active beside five heavy users', async () => {
  const releases = [];
  const queue = createScrapeQueue(async (ids) => {
    await new Promise((resolve) => releases.push(resolve));
    return { ok: true, imported: [{ applicationNo: ids[0] }], missing: [] };
  }, 25, { perClientConcurrent: 5, firstSlotReserve: 20, dispatchIntervalMs: 0 });
  const heavy = Array.from({ length: 5 }, (_, user) => queue.enqueue(
    Array.from({ length: 5 }, (_, item) => `1-2026-${String(user * 5 + item + 1).padStart(5, '0')}`),
    1, 1, `heavy-${user + 1}`));
  assert.equal(queue.snapshot().activeJobs, 10);
  assert.equal(queue.snapshot().activeBurst, 5);
  const light = Array.from({ length: 15 }, (_, user) => queue.enqueue(
    [`3-2026-${String(user + 1).padStart(5, '0')}`], 1, 1, `light-${user + 1}`));
  const snapshot = queue.snapshot();
  assert.equal(snapshot.capacity, 25);
  assert.equal(snapshot.firstSlotReserve, 20);
  assert.equal(snapshot.burstCapacity, 5);
  assert.equal(snapshot.activeJobs, 25);
  assert.equal(snapshot.queuedJobs, 15);
  for (let user = 1; user <= 15; user += 1) assert.equal(snapshot.activeByClient[`light-${user}`], 1);
  for (let iteration = 0; iteration < 25; iteration += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    while (releases.length) releases.shift()();
    if ([...heavy, ...light].every((job) => ['done', 'failed'].includes(queue.get(job.id).status))) break;
  }
  await Promise.all([...heavy, ...light].map((job) => waitForJob(queue, job.id)));
});

test('shared scrape queue manages retries as fair single-attempt turns', async () => {
  const calls = [];
  const queue = createScrapeQueue(async (ids, presetIndex, retryCount) => {
    calls.push({ ids, presetIndex, retryCount });
    if (calls.length === 1) return { ok: false, imported: [], missing: ids };
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  }, 15, { dispatchIntervalMs: 0 });
  const job = queue.enqueue(['4-2025-31926'], 2, 2);
  await waitForJob(queue, job.id);
  assert.deepEqual(calls, [
    { ids: ['4-2025-31926'], presetIndex: 2, retryCount: 0 },
    { ids: ['4-2025-31926'], presetIndex: 2, retryCount: 0 },
  ]);
});

test('LAN adds ten retry turns after initial attempts and succeeds on a late response', async () => {
  const calls = [];
  const queue = createScrapeQueue(async (ids) => {
    calls.push(ids[0]);
    return calls.length === 13
      ? { ok: true, imported: [{ applicationNo: ids[0] }], missing: [] }
      : { ok: false, imported: [], missing: ids };
  }, 1, { dispatchIntervalMs: 0, retryPasses: 10 });
  const job = queue.enqueue(['4-2023-54053'], 1, 10, 'browser-a');
  const finished = await waitForJob(queue, job.id);
  assert.equal(finished.result.ok, true);
  assert.equal(calls.length, 13);
  assert.deepEqual(finished.applicationStates['4-2023-54053'], {
    status: 'done', attempt: 13, maxAttempts: 20, initialAttempts: 10, maxRetries: 10,
  });
  assert.ok(queue.logEvents(job.id).some((event) => event.message.includes('retry 1/10')));
});

test('LAN stops after ten additional retries and does not retry confirmed not-found records', async () => {
  let calls = 0;
  const queue = createScrapeQueue(async (ids) => {
    calls += 1;
    return { ok: false, imported: [], missing: ids };
  }, 1, { dispatchIntervalMs: 0, retryPasses: 10 });
  const failed = await waitForJob(queue, queue.enqueue(['4-2023-54053'], 1, 2, 'browser-a').id);
  assert.equal(calls, 12);
  assert.equal(failed.applicationStates['4-2023-54053'].status, 'failed');
  const notFoundQueue = createScrapeQueue(async (ids) => ({
    ok: false, imported: [], missing: ids, notFound: [{ applicationNo: ids[0], attempts: 2 }],
  }), 1, { dispatchIntervalMs: 0, retryPasses: 10 });
  const notFound = await waitForJob(notFoundQueue, notFoundQueue.enqueue(['4-2023-54053'], 1, 2, 'browser-a').id);
  assert.equal(notFound.applicationStates['4-2023-54053'].attempt, 1);
});

test('consecutive retry mode finishes five retries before starting the next row', async () => {
  const first = '4-2023-54053';
  const second = '4-2024-54876';
  const calls = [];
  const queue = createScrapeQueue(async (ids) => {
    const id = ids[0];
    calls.push(id);
    if (id === first && calls.filter((item) => item === first).length < 6)
      return { ok: false, imported: [], missing: ids };
    return { ok: true, imported: [{ applicationNo: id }], missing: [] };
  }, 1, { dispatchIntervalMs: 0, retryMode: 'consecutive' });
  const job = queue.enqueue([second, first], 1, 5, 'browser-a', '', {
    [first]: { rank: 0 }, [second]: { rank: 1 },
  });
  const finished = await waitForJob(queue, job.id);
  assert.deepEqual(calls, [first, first, first, first, first, first, second]);
  assert.equal(finished.result.ok, true);
  assert.deepEqual(finished.applicationStates[first], {
    status: 'done', attempt: 6, maxAttempts: 6, initialAttempts: 1, maxRetries: 5,
  });
  assert.ok(queue.logEvents(job.id).some((event) => event.message.includes('retry 5/5')));
});

test('consecutive retries stop after five and do not repeat confirmed not-found rows', async () => {
  let attempts = 0;
  const queue = createScrapeQueue(async (ids) => {
    attempts += 1;
    return { ok: false, imported: [], missing: ids };
  }, 1, { dispatchIntervalMs: 0, retryMode: 'consecutive' });
  const failed = await waitForJob(queue, queue.enqueue(['4-2023-54053'], 1, 10).id);
  assert.equal(attempts, 6);
  assert.equal(failed.applicationStates['4-2023-54053'].status, 'failed');
  const notFoundQueue = createScrapeQueue(async (ids) => ({
    ok: false, imported: [], missing: ids, notFound: [{ applicationNo: ids[0], attempts: 2 }],
  }), 1, { dispatchIntervalMs: 0, retryMode: 'consecutive' });
  const notFound = await waitForJob(notFoundQueue, notFoundQueue.enqueue(['4-2023-54053'], 1, 5).id);
  assert.equal(notFound.applicationStates['4-2023-54053'].attempt, 1);
});

test('the LAN server scrapes in five-attempt bursts and caps each row at 25', async () => {
  const calls = [];
  const server = createLanServer({
    dispatchIntervalMs: 0,
    perClientConcurrent: 1,
    runTask: async (ids) => {
      calls.push(ids[0]);
      return { ok: false, imported: [], missing: ids };
    },
  });
  const job = server.queue.enqueue(['4-2023-54053', '4-2024-54876'], 1, 25, 'browser-a');
  const finished = await waitForJob(server.queue, job.id);
  assert.deepEqual(calls, [
    ...Array(5).fill('4-2023-54053'),
    ...Array(5).fill('4-2024-54876'),
    ...Array(5).fill('4-2023-54053'),
    ...Array(5).fill('4-2024-54876'),
    ...Array(5).fill('4-2023-54053'),
    ...Array(5).fill('4-2024-54876'),
    ...Array(5).fill('4-2023-54053'),
    ...Array(5).fill('4-2024-54876'),
    ...Array(5).fill('4-2023-54053'),
    ...Array(5).fill('4-2024-54876'),
  ]);
  assert.equal(finished.applicationStates['4-2023-54053'].scrapeCap, 25);
  assert.equal(finished.applicationStates['4-2024-54876'].attempt, 25);
  assert.equal(finished.applicationStates['4-2024-54876'].status, 'failed');
});

test('burst mode requeues after five and stops early on success or confirmed not-found', async () => {
  const first = '4-2023-54053';
  const second = '4-2024-54876';
  const calls = [];
  const queue = createScrapeQueue(async (ids) => {
    const applicationNo = ids[0];
    calls.push(applicationNo);
    if (applicationNo === second) return { ok: true, imported: [{ applicationNo }], missing: [] };
    if (calls.filter((id) => id === first).length === 12) return { ok: true, imported: [{ applicationNo }], missing: [] };
    return { ok: false, imported: [], missing: ids };
  }, 1, { dispatchIntervalMs: 0, retryMode: 'burst', burstSize: 5 });
  const finished = await waitForJob(queue, queue.enqueue([first, second], 1, 25, 'browser-a').id);
  assert.deepEqual(calls, [...Array(5).fill(first), second, ...Array(7).fill(first)]);
  assert.equal(finished.applicationStates[first].attempt, 12);
  assert.equal(finished.applicationStates[first].status, 'done');

  let notFoundCalls = 0;
  const notFoundQueue = createScrapeQueue(async (ids) => {
    notFoundCalls += 1;
    return { ok: false, imported: [], missing: ids, notFound: [{ applicationNo: ids[0], attempts: 2 }] };
  }, 1, { dispatchIntervalMs: 0, retryMode: 'burst', burstSize: 5 });
  const notFound = await waitForJob(notFoundQueue, notFoundQueue.enqueue([first], 1, 25, 'browser-a').id);
  assert.equal(notFoundCalls, 1);
  assert.equal(notFound.applicationStates[first].attempt, 1);
});

test('shared scrape queue logs one completed success after retries and never logs not-found as success', async () => {
  const successes = [];
  let attempts = 0;
  const queue = createScrapeQueue(async (ids) => {
    attempts += 1;
    if (ids[0] === '1-2026-99999') return { ok: false, imported: [], missing: ids, notFound: [{ applicationNo: ids[0], attempts: 2 }] };
    if (attempts === 1) return { ok: false, imported: [], missing: ids };
    return { ok: true, imported: [{ applicationNo: ids[0], snapshotId: 42 }], missing: [] };
  }, 1, { dispatchIntervalMs: 0, onSuccess: (event) => successes.push(event) });
  const completed = queue.enqueue(['1-2026-00001'], 1, 2, 'browser-a', '192.168.1.20');
  await waitForJob(queue, completed.id);
  assert.equal(successes.length, 1);
  assert.deepEqual(successes[0], {
    applicationNo: '1-2026-00001',
    imported: [{ applicationNo: '1-2026-00001', snapshotId: 42 }],
    jobId: completed.id,
    clientId: 'browser-a',
    clientAddress: '192.168.1.20',
    attempt: 2,
  });
  const notFound = queue.enqueue(['1-2026-99999'], 1, 2, 'browser-a', '192.168.1.20');
  await waitForJob(queue, notFound.id);
  assert.equal(successes.length, 1);
});

test('shared scrape queue exposes each stored application before the batch finishes', async () => {
  const finishes = [];
  const queue = createScrapeQueue(async (ids, _presetIndex, _retryCount, onMessage) => {
    onMessage({ type: 'record', applicationNo: ids[0] });
    await new Promise((resolve) => { finishes.push(resolve); });
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  }, 1, { dispatchIntervalMs: 0 });
  const job = queue.enqueue(['1-2025-00613', '4-2025-31926']);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(queue.get(job.id).status, 'running');
  assert.deepEqual(queue.get(job.id).completedApplications, ['1-2025-00613']);
  finishes.shift()();
  await new Promise((resolve) => setTimeout(resolve, 10));
  finishes.shift()();
  await waitForJob(queue, job.id);
});

test('shared scrape queue rotates between users instead of draining one user first', async () => {
  const order = [];
  const releases = [];
  const queue = createScrapeQueue(async (ids) => {
    order.push(ids[0]);
    await new Promise((resolve) => releases.push(resolve));
    return { ok: true, imported: [{ applicationNo: ids[0] }], missing: [] };
  }, 1, { dispatchIntervalMs: 0 });
  const first = queue.enqueue(['1-2022-00001', '1-2022-00002', '1-2022-00003'], 1, 2, 'user-a');
  const second = queue.enqueue(['1-2022-00011', '1-2022-00012'], 1, 2, 'user-b');
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    releases.shift()();
  }
  await Promise.all([waitForJob(queue, first.id), waitForJob(queue, second.id)]);
  assert.deepEqual(order, ['1-2022-00001', '1-2022-00002', '1-2022-00011', '1-2022-00003', '1-2022-00012']);
});

test('consecutive single-record jobs fill five per-user slots at the configured interval', async () => {
  const starts = [];
  const batches = [];
  const releases = [];
  const queue = createScrapeQueue(async (ids) => {
    starts.push(Date.now());
    batches.push([...ids]);
    await new Promise((resolve) => releases.push(resolve));
    return { ok: true, imported: [{ applicationNo: ids[0] }], missing: [] };
  }, 15, { perClientConcurrent: 5, dispatchIntervalMs: 40 });
  const ids = Array.from({ length: 6 }, (_, index) => `1-2022-${String(index + 1).padStart(5, '0')}`);
  const jobs = ids.map((id) => queue.enqueue([id], 1, 2, 'paced-user'));
  await new Promise((resolve) => setTimeout(resolve, 230));
  assert.equal(queue.snapshot().activeJobs, 5);
  assert.equal(queue.snapshot().activeByClient['paced-user'], 5);
  assert.equal(queue.snapshot().queuedJobs, 1);
  assert.equal(starts.length, 5);
  assert.ok(batches.every((batch) => batch.length === 1));
  for (let index = 1; index < starts.length; index += 1) assert.ok(starts[index] - starts[index - 1] >= 30);
  while (releases.length) releases.shift()();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(starts.length, 6);
  assert.ok(starts[5] - starts[4] >= 30);
  releases.shift()();
  await Promise.all(jobs.map((job) => waitForJob(queue, job.id)));
});

test('shared scrape queue preserves confirmed not-found results', async () => {
  const applicationNo = '1-2026-99999';
  const queue = createScrapeQueue(async () => ({
    ok: false, imported: [], missing: [applicationNo],
    notFound: [{ applicationNo, attempts: 2, reason: 'HTTP 200 returned no usable WIPO record data' }],
  }), 15, { dispatchIntervalMs: 0 });
  const completed = await waitForJob(queue, queue.enqueue([applicationNo]).id);
  assert.equal(completed.status, 'done');
  assert.deepEqual(completed.result.notFound, [{ applicationNo, attempts: 2, reason: 'HTTP 200 returned no usable WIPO record data' }]);
});

test('stop cancels one users queued and active work without retrying or stopping another user', async () => {
  const calls = [];
  const releases = [];
  const queue = createScrapeQueue(async (ids) => {
    calls.push([...ids]);
    await new Promise((resolve, reject) => releases.push({ resolve, reject }));
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  }, 2, { perClientConcurrent: 1, dispatchIntervalMs: 0 });
  const stopped = queue.enqueue(['1-2026-00001', '1-2026-00002'], 1, 3, 'user-a');
  const untouched = queue.enqueue(['1-2026-00011'], 1, 2, 'user-b');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(queue.cancel(stopped.id, 'user-b').statusCode, 403);
  const result = queue.cancel(stopped.id, 'user-a');
  assert.equal(result.ok, true);
  assert.equal(result.queuedCancelled, 1);
  assert.equal(result.activeTaskIds.length, 1);
  releases[0].reject(new Error('stopped'));
  releases[1].resolve();
  await waitForJob(queue, untouched.id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queue.get(stopped.id).status, 'cancelled');
  assert.equal(queue.get(untouched.id).status, 'done');
  assert.deepEqual(calls, [['1-2026-00001'], ['1-2026-00011']]);
});

test('stop all atomically cancels every queued and active job owned by one browser user', async () => {
  const releases = [];
  const queue = createScrapeQueue(async (ids) => {
    await new Promise((resolve, reject) => releases.push({ ids, resolve, reject }));
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  }, 3, { perClientConcurrent: 2, dispatchIntervalMs: 0 });
  const first = queue.enqueue(['1-2026-00101', '1-2026-00102'], 1, 3, 'browser-a');
  const second = queue.enqueue(['1-2026-00103', '1-2026-00104'], 1, 3, 'browser-a');
  const other = queue.enqueue(['1-2026-00201'], 1, 2, 'browser-b');
  await new Promise((resolve) => setTimeout(resolve, 15));
  const result = queue.cancelAll('browser-a');
  assert.equal(result.ok, true);
  assert.equal(result.jobsStopped, 2);
  assert.equal(result.activeTaskIds.length, 2);
  assert.equal(result.queuedCancelled, 2);
  assert.deepEqual(queue.listByClient('browser-a'), []);
  assert.equal(queue.get(first.id).status, 'cancelled');
  assert.equal(queue.get(second.id).status, 'cancelled');
  assert.notEqual(queue.get(other.id).status, 'cancelled');
  releases.filter((item) => item.ids[0].startsWith('1-2026-001')).forEach((item) => item.reject(new Error('stopped')));
  const otherRun = releases.find((item) => item.ids[0] === '1-2026-00201');
  otherRun.resolve();
  await waitForJob(queue, other.id);
  assert.equal(queue.get(other.id).status, 'done');
});

test('active jobs can be recovered by the same browser user after refresh', async () => {
  let release;
  const queue = createScrapeQueue(async (ids) => {
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] };
  }, 1, { dispatchIntervalMs: 0 });
  const job = queue.enqueue(['1-2026-00123'], 1, 2, 'persistent-browser');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(queue.listByClient('persistent-browser').map((item) => item.id), [job.id]);
  assert.deepEqual(queue.listByClient('another-browser'), []);
  release();
  await waitForJob(queue, job.id);
  assert.deepEqual(queue.listByClient('persistent-browser'), []);
});

test('LAN runner is configured to use the migrated central WIPO scraper', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lan-server.js'), 'utf8');
  assert.match(source, /Wipopublish_Scrape_ApplicationDetails/);
  assert.match(source, /spawn\(process\.execPath, \[SCRAPER_SCRIPT/);
  const scraper = fs.readFileSync(path.join(__dirname, '..', '..', 'Wipopublish_Scrape_ApplicationDetails', 'index_Wipo.js'), 'utf8');
  assert.match(scraper, /attempts >= 2/);
  assert.match(scraper, /type: "wipo-not-found"/);
  assert.match(scraper, /process\.env\.WIPO_INPUT_FILE/);
  assert.match(scraper, /process\.env\.WIPO_OUTPUT_DIR/);
  assert.match(scraper, /WIPO_BETWEEN_REQUEST_MS/);
  assert.match(source, /WIPO_BETWEEN_REQUEST_MS: '1000'/);
});

test('publication Content-Disposition safely preserves Vietnamese filenames', () => {
  const header = encodeHeaderFileName('CB_411_A1_Sáng chế_06_2022.pdf');
  assert.match(header, /^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.match(header, /S%C3%A1ng%20ch%E1%BA%BF/);
  assert.doesNotThrow(() => new Headers({ 'Content-Disposition': header }));
});

test('LAN server exposes the tracker page and shared database APIs', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-lan-'));
  const pdfPath = path.join(folder, 'CB_399_A1_Sáng chế.pdf');
  fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\ntracker-test'));
  const server = createLanServer({
    host: '127.0.0.1', port: 0, databaseFile: path.join(folder, 'history.sqlite'),
    siteMonitor: { start() {}, stop() {}, check: async () => ({ state: 'down', checkedAt: '2026-10-05T00:00:00.000Z', httpStatus: 503 }), history: async (day) => ({ selectedDay: day, days: [], checks: [], totals: { up: 1, down: 1, total: 2, percent: 50 } }) },
    caseRefResolver: {
      resolve: async (refs) => ({ ok: true, matches: [{ caseRef: refs[0], applicationNos: ['1-2022-03660'] }], missing: [] }),
      lookupApplications: async () => ({ ok: true, matches: [{ applicationNo: '1-2022-03660', caseRefs: ['IP/PR17258/CDD'] }] }),
    },
    checkPublicationA: async () => ({ ok: true, hasPublicationA: false }),
    lookupPublicationRegistrations: async (registrationNumbers, registrationType, applicationNos) => ({
      ok: true,
      matches: registrationNumbers.length
        ? [{ formatted: '1-0023245-000', type: registrationType, applicationNo: '1-2012-03292' }]
        : [{ formatted: '1-0023245-000', type: 'patent', applicationNo: applicationNos[0] }],
      missing: [],
    }),
    lookupInternationalPublications: async (identifier) => ({ ok: true, identifier, records: [
      { record_kind: 'hague_vn_event', international_registration_no: 'DM/213380', vn_application_no: identifier, data: { kind: 'Granted' } },
    ] }),
    renderReportPdf: async () => Buffer.from('%PDF-1.4\nreport-test'),
    resolvePublicationPdf: async () => ({ pdfPath, page: 588 }),
    listPublicationPdfs: async () => ([
      { id: 1, category: 'publication_a', applicationNo: '1-2021-00451', pdfPath, page: 1 },
      { id: 2, category: 'publication_b', applicationNo: '1-2021-00451', pdfPath, page: 1 },
      { id: 3, category: 'annuity', requestNo: 'DT1-2026-00100', pdfPath, page: 1 },
    ]),
    lookupRequestPublication: async (requestNo) => ({ ok: true, requestNo, kind: 'Patent annuity', caseRefs: ['IP/PF42'], documents: [
      { id: '42', category: 'annuity', requestNo, pdfPath, sourceFile: 'CB_399_A1_Sáng chế.pdf' },
    ] }),
    lookupRequestPublications: async (requestNos) => requestNos.map((requestNo) => ({ ok: true, requestNo, kind: 'Patent annuity', caseRefs: [], documents: [
      { id: '42', category: 'annuity', requestNo, pdfPath, sourceFile: 'CB_399_A1_Sáng chế.pdf' },
    ] })),
    lookupHagueDesign: async (number) => ({ ok: true, number, checkedAt: '2026-10-07T01:00:00.000Z', status: 'Granted', events: [
      { id: '970272755_STATEMENT', kind: 'Granted', pdfAvailable: true, pdfUrl: 'https://www.wipo.int/idpub/example.pdf' },
    ] }),
    cachedHagueDesign: (number) => number === 'DM/999999' ? { ok: true, number, checkedAt: '2026-10-06T01:00:00.000Z', status: 'Refusal', events: [] } : null,
    haguePdfPath: (number, eventId) => number === 'DM/213380' && eventId === '970272755_STATEMENT' ? pdfPath : '',
  });
  const info = await server.start();
  const base = `http://127.0.0.1:${info.port}/wipo-application-tracker`;
  try {
    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.capacity, 25);
    assert.equal(health.firstSlotReserve, 20);
    assert.equal(health.burstCapacity, 5);
    const page = await fetch(`${base}/`).then((response) => response.text());
    const publicationIndex = await fetch(`${base}/api/international-publications?identifier=8-2021-00065`).then(response => response.json());
    assert.equal(publicationIndex.records[0].international_registration_no, 'DM/213380');
    assert.equal(publicationIndex.records[0].vn_application_no, '8-2021-00065');
    const hague = await fetch(`${base}/api/hague-design?number=${encodeURIComponent('DM/213 380')}`).then(response => response.json());
    assert.equal(hague.status, 'Granted');
    assert.ok(hague.snapshotId);
    assert.match(hague.events[0].url, /api\/hague-pdf.*970272755_STATEMENT/);
    const savedHague = await fetch(`${base}/api/hague-list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationNos: ['DM/213380'] }) }).then(response => response.json());
    assert.equal(savedHague.registrations[0].data.status, 'Granted');
    assert.match(savedHague.registrations[0].data.events[0].url, /api\/hague-pdf/);
    const hagueHistory = await fetch(`${base}/api/hague-detail?number=DM%2F213380`).then(response => response.json());
    assert.equal(hagueHistory.detail.snapshots.length, 1);
    const migratedHague = await fetch(`${base}/api/hague-list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationNos: ['DM/999999'] }) }).then(response => response.json());
    assert.equal(migratedHague.registrations[0].data.status, 'Refusal');
    const haguePdf = await fetch(`${base}/api/hague-pdf?number=DM%2F213380&eventId=970272755_STATEMENT`);
    assert.equal(haguePdf.status, 200);
    assert.equal(haguePdf.headers.get('content-type'), 'application/pdf');
    assert.equal((await haguePdf.arrayBuffer()).byteLength, fs.statSync(pdfPath).size);
    const hagueReport = await fetch(`${base}/api/hague-report-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 'DM/213380', html: '<html><body class="printing-hague-report">DM/213380</body></html>' }) });
    assert.equal(hagueReport.status, 200);
    assert.equal(hagueReport.headers.get('content-type'), 'application/pdf');
    assert.match(await hagueReport.text(), /report-test/);
    const invalidHagueReport = await fetch(`${base}/api/hague-report-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 'DM/213380', html: '<html>DM/999999</html>' }) });
    assert.equal(invalidHagueReport.status, 400);
    assert.match(page, /WipoPublish Vietnam Search/);
    const siteStatus = await fetch(`${base}/api/site-status`).then((response) => response.json());
    assert.equal(siteStatus.state, 'down');
    assert.equal(siteStatus.httpStatus, 503);
    const siteHistory = await fetch(`${base}/api/site-status-history?day=2026-10-05`).then((response) => response.json());
    assert.equal(siteHistory.selectedDay, '2026-10-05');
    assert.equal(siteHistory.totals.percent, 50);
    assert.match(page, /softip_display_hash\.js\?v=20260930-2/);
    assert.match(page, /text_diff\.js\?v=20261001-1/);
    assert.match(page, /<link rel="icon" type="image\/x-icon" href="favicon\.ico\?v=2">/);
    assert.match(page, /<link rel="icon" type="image\/png" sizes="512x512" href="data-searching\.png\?v=2">/);
    assert.match(page, /<img class="brand-mark" src="data-searching\.png" alt="WipoPublish Vietnam Search" id="brandMark">/);
    const brandIcon = await fetch(`${base}/api/brand-icon`);
    assert.equal(brandIcon.status, 200);
    assert.match(brandIcon.headers.get('content-type'), /^image\//);
    assert.equal(brandIcon.headers.get('cache-control'), 'no-store');
    assert.ok((await brandIcon.arrayBuffer()).byteLength > 100);
    const icon = await fetch(`${base}/data-searching.png`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()), fs.readFileSync(path.join(__dirname, '..', 'data-searching.png')));
    const favicon = await fetch(`${base}/favicon.ico?v=2`);
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get('content-type'), 'image/x-icon');
    assert.deepEqual(Buffer.from(await favicon.arrayBuffer()), fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer', 'favicon.ico')));
    for (const iconName of ['setting.png', 'eye.png', 'pencil.png', 'plus.png', 'delete.png']) {
      const response = await fetch(`${base}/${iconName}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(__dirname, '..', 'electron', 'renderer', iconName)));
    }
    const displayHashAsset = await fetch(`${base}/softip_display_hash.js?v=20260930-2`);
    assert.equal(displayHashAsset.status, 200);
    assert.match(displayHashAsset.headers.get('content-type'), /text\/javascript/);
    assert.match(await displayHashAsset.text(), /caseSensitive = true/);
    const textDiffAsset = await fetch(`${base}/text_diff.js?v=20261001-1`);
    assert.equal(textDiffAsset.status, 200);
    assert.match(textDiffAsset.headers.get('content-type'), /text\/javascript/);
    assert.match(await textDiffAsset.text(), /root\.TextDiff = api/);
    const init = await fetch(`${base}/api/init`).then((response) => response.json());
    assert.equal(init.ok, true);
    assert.equal(init.database, 'Shared LAN SQLite history');
    const list = await fetch(`${base}/api/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationNos: ['1-2022-01097'] }) }).then((response) => response.json());
    assert.deepEqual(list.applications, []);
    const references = await fetch(`${base}/api/resolve-case-refs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseRefs: ['IP/PR17258/CDD'] }) }).then((response) => response.json());
    assert.deepEqual(references.matches, [{ caseRef: 'IP/PR17258/CDD', applicationNos: ['1-2022-03660'] }]);
    const inverse = await fetch(`${base}/api/lookup-application-refs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationNos: ['1-2022-03660'] }) }).then((response) => response.json());
    assert.deepEqual(inverse.matches, [{ applicationNo: '1-2022-03660', caseRefs: ['IP/PR17258/CDD'] }]);
    const registrations = await fetch(`${base}/api/lookup-registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationNumbers: ['23245'], registrationType: 'patent' }) }).then((response) => response.json());
    assert.deepEqual(registrations.matches, [{ formatted: '1-0023245-000', type: 'patent', applicationNo: '1-2012-03292' }]);
    const applicationRegistrations = await fetch(`${base}/api/lookup-registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationNos: ['1-2022-03660'] }) }).then((response) => response.json());
    assert.deepEqual(applicationRegistrations.matches, [{ formatted: '1-0023245-000', type: 'patent', applicationNo: '1-2022-03660' }]);
    const publicationAStatus = await fetch(`${base}/api/publication-a-status?applicationNo=1-2022-03660`).then((response) => response.json());
    assert.deepEqual(publicationAStatus, { ok: true, hasPublicationA: false });
    const report = await fetch(`${base}/api/export-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationNo: '1-2022-03660', html: '<html class="printing-report">1-2022-03660</html>' }) });
    assert.equal(report.status, 200);
    assert.equal(report.headers.get('content-type'), 'application/pdf');
    assert.match(report.headers.get('content-disposition'), /WIPO_1-2022-03660\.pdf/);
    assert.equal(await report.text(), '%PDF-1.4\nreport-test');
    const documents = await fetch(`${base}/api/publication-pdfs?applicationNo=1-2021-00451`).then((response) => response.json());
    assert.deepEqual(documents.documents.map(item => item.category), ['publication_a', 'publication_b', 'annuity']);
    const redirect = await fetch(`${base}/api/publication-pdf-open?applicationNo=1-2021-00451`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.match(redirect.headers.get('location'), /api\/publication-pdf\?applicationNo=1-2021-00451#page=1$/);
    const pdf = await fetch(`${base}/api/publication-pdf?applicationNo=1-2021-00451`, { headers: { Range: 'bytes=0-7' } });
    assert.equal(pdf.status, 206);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition'), /filename\*=UTF-8''CB_399_A1_S%C3%A1ng%20ch%E1%BA%BF\.pdf/);
    assert.equal(await pdf.text(), '%PDF-1.4');
    const requestDocuments = await fetch(`${base}/api/request-publication-pdfs?requestNo=DT1-2026-03417`).then((response) => response.json());
    assert.equal(requestDocuments.documents.length, 1);
    assert.deepEqual(requestDocuments.caseRefs, ['IP/PF42']);
    assert.equal(requestDocuments.documents[0].pdfPath, undefined);
    assert.match(requestDocuments.documents[0].url, /requestNo=DT1-2026-03417&documentId=42/);
    const requestBatch = await fetch(`${base}/api/request-publication-pdfs/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestNos: ['DT1-2026-03417', 'DT1-2026-03418'] }) }).then((response) => response.json());
    assert.deepEqual(requestBatch.results.map((item) => item.requestNo), ['DT1-2026-03417', 'DT1-2026-03418']);
    assert.equal(requestBatch.results[0].documents[0].pdfPath, undefined);
    assert.match(requestBatch.results[1].documents[0].url, /requestNo=DT1-2026-03418&documentId=42/);
    const requestPdf = await fetch(`${base}/api/request-publication-pdf?requestNo=DT1-2026-03417&documentId=42`, { headers: { Range: 'bytes=0-7' } });
    assert.equal(requestPdf.status, 206);
    assert.equal(await requestPdf.text(), '%PDF-1.4');
    assert.equal((await fetch(`${base}/api/request-publication-pdf?requestNo=DT1-2026-03417&documentId=99`)).status, 404);
    assert.equal((await fetch(`${base}/api/request-publication-pdfs?requestNo=1-2023-02108`)).status, 400);
  } finally {
    await server.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('indexed A/B preview returns an assembled entry; full source is an explicit option', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-source-preview-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const sourcePath = path.join(folder, 'CB_500_A3.pdf');
  const source = await PDFDocument.create();
  source.addPage([100, 100]);
  source.addPage([200, 200]);
  source.addPage([300, 300]);
  fs.writeFileSync(sourcePath, await source.save());
  const missingSplit = path.join(folder, 'split.pdf');
  const document = { id: '7', modeId: '10', category: 'publication_a', sourcePath,
    sourcePages: [2, 3], pages: '2, 3', page: 2, pdfPath: missingSplit };
  const server = createLanServer({ host: '127.0.0.1', port: 0, databaseFile: path.join(folder, 'history.sqlite'),
    siteMonitor: { start() {}, stop() {} }, listPublicationPdfs: async () => [document] });
  const { port } = await server.start();
  try {
    const base = `http://127.0.0.1:${port}/wipo-application-tracker`;
    const listing = await fetch(`${base}/api/publication-pdfs?applicationNo=4-2026-00001`).then(response => response.json());
    assert.equal(listing.documents[0].sourcePreview, false);
    assert.match(listing.documents[0].url, /publication-pdf\?.*#page=1$/);
    assert.equal(listing.documents[0].sourcePath, undefined);
    const range = await fetch(`${base}/api/publication-pdf-source?applicationNo=4-2026-00001&documentId=7`, { headers: { Range: 'bytes=0-7' } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 8);
    const extract = await fetch(`${base}/api/publication-pdf?applicationNo=4-2026-00001&documentId=7`);
    assert.equal(extract.status, 200);
    const pdf = await PDFDocument.load(await extract.arrayBuffer());
    assert.deepEqual(pdf.getPages().map(page => page.getWidth()), [200, 300]);
    assert.equal(fs.existsSync(missingSplit), false);
  } finally { await server.close(); }
});

test('rapid failing publication PDF requests return errors and keep the service alive', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wipo-pdf-failure-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const sourcePath = path.join(folder, 'broken.pdf');
  fs.writeFileSync(sourcePath, 'invalid PDF');
  const document = { id: '7', sourcePath, sourcePages: [1], pdfPath: path.join(folder, 'missing.pdf') };
  const server = createLanServer({ host: '127.0.0.1', port: 0, databaseFile: path.join(folder, 'history.sqlite'),
    siteMonitor: { start() {}, stop() {} }, listPublicationPdfs: async () => [document],
    lookupRequestPublication: async () => ({ documents: [document] }) });
  const { port } = await server.start();
  try {
    const base = `http://127.0.0.1:${port}/wipo-application-tracker`;
    const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => fetch(index % 2
      ? `${base}/api/request-publication-pdf?requestNo=DT1-2026-03417&documentId=7`
      : `${base}/api/publication-pdf?applicationNo=4-2026-00001&documentId=7`)));
    for (const response of responses) {
      assert.equal(response.status, 500);
      assert.ok((await response.json()).error);
    }
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally { await server.close(); }
});
