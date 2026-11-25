'use strict';

const fs = require('fs');
const path = require('path');
const { Worker } = require('node:worker_threads');
const { importStatusJson, databasePath } = require('../general_SoftIP_Scripts/softip_status_database');

const EMAIL_REPOSITORY = path.resolve(process.env.SOFTIP_EMAIL_REPOSITORY || 'D:\\Auto_Download_Email_IPVN');
const STATUS_ROOT = path.join(EMAIL_REPOSITORY, 'Email_IPVN');
const STATUS_JSON = path.join(STATUS_ROOT, 'status_split', 'status.json');
const UPDATER_PATH = path.join(EMAIL_REPOSITORY, 'Main_Script', 'core', 'statusExcelUpdater.js');
let activeUpdate = null;
let updateWorker = null;

function updater() {
  if (!fs.existsSync(UPDATER_PATH)) throw new Error(`SoftIP email status updater was not found: ${UPDATER_PATH}`);
  return require(UPDATER_PATH);
}

async function initializeStatusDatabase() {
  if (!fs.existsSync(STATUS_JSON)) throw new Error(`SoftIP status source was not found: ${STATUS_JSON}`);
  const result = await importStatusJson(STATUS_JSON);
  return { ...result, database: databasePath(), source: STATUS_JSON };
}

function listStatusSources() {
  const sources = updater().listStatusSources(path.join(STATUS_ROOT, 'status_split'));
  return { ok: true, database: databasePath(), source: STATUS_JSON, updating: Boolean(activeUpdate), sources };
}

function updateStatusSources(codes, onProgress = () => {}, options = {}) {
  if (activeUpdate) return activeUpdate;
  const requested = [...new Set((codes || []).map((code) => String(code).toUpperCase()).filter(Boolean))];
  // The updater synchronously imports and exports the status database for each
  // workbook. Keep its ordered checkpoints off the Hub's HTTP and UI thread.
  const worker = new Worker(path.join(__dirname, 'softip_status_update_worker.js'), {
    workerData: { updaterPath: UPDATER_PATH, codes: requested, statusDirectory: STATUS_ROOT, options },
  });
  updateWorker = worker;
  activeUpdate = new Promise((resolve, reject) => {
    worker.on('message', message => {
      if (message.progress !== undefined) onProgress(message.progress);
      else if (message.error !== undefined) reject(new Error(message.error));
      else resolve(message.result);
    });
    worker.once('error', reject);
    worker.once('exit', code => reject(new Error(`SoftIP status update worker exited with code ${code}.`)));
  })
    .then(async (result) => ({ ok: true, ...result, sharedDatabase: result.aggregate?.sharedDatabase || await initializeStatusDatabase() }))
    .finally(() => { activeUpdate = null; updateWorker = null; });
  return activeUpdate;
}

function isStatusUpdating() { return Boolean(activeUpdate); }
async function cancelStatusUpdate() {
  updateWorker?.postMessage('cancel');
  await activeUpdate?.catch(() => {});
}

module.exports = { saveFallbackSettings: (code, config) => updater().saveFallbackSettings(code, config), isStatusUpdating, cancelStatusUpdate, EMAIL_REPOSITORY, STATUS_ROOT, STATUS_JSON, initializeStatusDatabase, listStatusSources, updateStatusSources };
