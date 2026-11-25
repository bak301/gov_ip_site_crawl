'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('status updates keep the host responsive and still support cancellation', async t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'softip-status-worker-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const updater = path.join(repo, 'Main_Script', 'core', 'statusExcelUpdater.js');
  fs.mkdirSync(path.dirname(updater), { recursive: true });
  fs.writeFileSync(updater, `
    exports.updateStatusSources = async (codes, options) => {
      if (codes[0] === 'CANCEL') {
        return new Promise((resolve, reject) => {
          options.onBrowser({ close: async () => reject(new Error(
            options.signal.aborted ? 'Status update stopped.' : 'Browser closed before abort.'
          )) });
          options.onProgress('Browser ready');
        });
      }
      options.onProgress('Importing workbook');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      return { updated: codes, aggregate: { sharedDatabase: { synced: true } } };
    };
  `);
  const originalRepo = process.env.SOFTIP_EMAIL_REPOSITORY;
  process.env.SOFTIP_EMAIL_REPOSITORY = repo;
  const service = require('./softip_status_service');
  if (originalRepo === undefined) delete process.env.SOFTIP_EMAIL_REPOSITORY;
  else process.env.SOFTIP_EMAIL_REPOSITORY = originalRepo;

  let hostResponsive = false;
  const update = service.updateStatusSources(['pr', 'PR'], () => {
    setImmediate(() => { hostResponsive = true; });
  });
  assert.equal(service.updateStatusSources(['DR']), update);
  assert.deepEqual(await update, {
    ok: true, updated: ['PR'], aggregate: { sharedDatabase: { synced: true } },
    sharedDatabase: { synced: true },
  });
  assert.equal(hostResponsive, true);

  let cancelled;
  const next = service.updateStatusSources(['CANCEL'], () => { cancelled = service.cancelStatusUpdate(); });
  await assert.rejects(next, /Status update stopped/);
  await cancelled;
  assert.equal(service.isStatusUpdating(), false);
});
