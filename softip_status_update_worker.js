'use strict';

const { parentPort, workerData } = require('node:worker_threads');

const controller = new AbortController();
let browser;

function closeBrowser() {
  // The updater also closes its browser and releases its lock in its finally block.
  browser?.close().catch(() => {});
}

parentPort.on('message', message => {
  if (message !== 'cancel') return;
  controller.abort();
  closeBrowser();
});

async function run() {
  const { updaterPath, codes, statusDirectory, options } = workerData;
  try {
    const result = await require(updaterPath).updateStatusSources(codes, {
      ...options, statusDirectory, signal: controller.signal,
      onBrowser: opened => {
        browser = opened;
        if (controller.signal.aborted) closeBrowser();
      },
      onProgress: progress => parentPort.postMessage({ progress }),
    });
    parentPort.postMessage({ result });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  } finally {
    parentPort.close();
  }
}

void run();
