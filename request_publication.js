'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { databasePath: statusDatabasePath } = require('../general_SoftIP_Scripts/softip_status_database');

const REPOSITORY = require('../general_SoftIP_Scripts/publication_paths').pdfDatabase;
const HELPER = path.join(__dirname, 'publication_pdf_lookup.py');
const lookupCache = new Map();
const REQUEST_KINDS = {
  DT1: { label: 'Patent annuity', caseFamily: 'PF', category: 'annuity', modeId: '4' },
  DT2: { label: 'Utility-solution annuity', caseFamily: 'PF', category: 'annuity', modeId: '4' },
  GH3: { label: 'Design renewal', caseFamily: 'DA', category: 'publication_b', modeId: '13' },
  GH4: { label: 'Trademark renewal', caseFamily: 'TA', category: 'publication_b', modeId: '6' },
};

function normalizeRequestNo(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^(?:DT[12]|GH[34])-\d{4}-\d{5}$/.test(text) ? text : '';
}

function parseRequestNos(value) {
  const matches = String(value || '').toUpperCase().match(/(?:^|[^A-Z0-9])((?:DT[12]|GH[34])-\d{4}-\d{5})(?![A-Z0-9])/g) || [];
  return [...new Set(matches.map((item) => normalizeRequestNo(item.replace(/^[^A-Z0-9]+/, ''))).filter(Boolean))];
}

function requestKind(requestNo) {
  return REQUEST_KINDS[normalizeRequestNo(requestNo).slice(0, 3)] || null;
}

function databaseSignature(filePath) {
  return [filePath, `${filePath}-wal`].map((candidate) => {
    try {
      const stat = fs.statSync(candidate);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch { return '-'; }
  }).join('|');
}

function lookupRequestPublication(requestNo, options = {}) {
  const canonical = normalizeRequestNo(requestNo);
  if (!canonical) return Promise.reject(new Error('Enter a DT1, DT2, GH3, or GH4 request number in YYYY-NNNNN format.'));
  const repository = options.repository || REPOSITORY;
  const statusDatabase = options.statusDatabase || statusDatabasePath();
  const python = String(options.python || process.env.WIPO_PYTHON || 'python');
  const key = JSON.stringify([repository, statusDatabase, python, canonical]);
  const signature = `${databaseSignature(repository)}|${databaseSignature(statusDatabase)}`;
  const cached = lookupCache.get(key);
  if (cached?.signature === signature) {
    lookupCache.delete(key);
    lookupCache.set(key, cached);
    return cached.promise;
  }
  const promise = new Promise((resolve, reject) => {
    const child = spawn(python, [HELPER, '--lookup-request-documents', repository, statusDatabase, canonical], {
      cwd: __dirname, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Request publication lookup exited with code ${code}.`));
      try { resolve(JSON.parse(stdout || '{}')); }
      catch { reject(new Error('Request publication lookup returned invalid data.')); }
    });
  });
  lookupCache.set(key, { signature, promise });
  promise.catch(() => { if (lookupCache.get(key)?.promise === promise) lookupCache.delete(key); });
  while (lookupCache.size > 256) lookupCache.delete(lookupCache.keys().next().value);
  return promise;
}

function lookupRequestPublications(requestNos, options = {}) {
  if (!Array.isArray(requestNos) || requestNos.length > 500) return Promise.reject(new Error('Select up to 500 request numbers.'));
  const canonical = [...new Set(requestNos.map(normalizeRequestNo))];
  if (canonical.length !== requestNos.length && requestNos.some((item) => !normalizeRequestNo(item))) {
    return Promise.reject(new Error('Enter valid DT1, DT2, GH3, or GH4 request numbers.'));
  }
  if (!canonical.length) return Promise.resolve([]);
  const repository = options.repository || REPOSITORY;
  const statusDatabase = options.statusDatabase || statusDatabasePath();
  const python = String(options.python || process.env.WIPO_PYTHON || 'python');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [HELPER, '--lookup-request-documents-batch', repository, statusDatabase], {
      cwd: __dirname, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Request publication batch lookup exited with code ${code}.`));
      try {
        const results = JSON.parse(stdout || '{}').results;
        if (!Array.isArray(results)) throw new Error('Invalid batch result.');
        resolve(results);
      } catch { reject(new Error('Request publication batch lookup returned invalid data.')); }
    });
    child.stdin.end(JSON.stringify(canonical));
  });
}

function lookupRequestExportRecords(requestNos, options = {}) {
  if (!Array.isArray(requestNos) || requestNos.length > 500 || requestNos.some(item => !normalizeRequestNo(item))) {
    return Promise.reject(new Error('Select up to 500 valid DT1, DT2, GH3, or GH4 request numbers.'));
  }
  if (!requestNos.length) return Promise.resolve([]);
  const repository = options.repository || REPOSITORY;
  const python = String(options.python || process.env.WIPO_PYTHON || 'python');
  return new Promise((resolve, reject) => {
    const child = spawn(python, [HELPER, '--export-request-records', repository], {
      cwd: __dirname, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error(stderr.trim() || `Request export lookup exited with code ${code}.`));
      try {
        const records = JSON.parse(stdout || '{}').records;
        if (!Array.isArray(records)) throw new Error('Invalid request records.');
        resolve(records);
      } catch { reject(new Error('Request export lookup returned invalid data.')); }
    });
    child.stdin.end(JSON.stringify([...new Set(requestNos.map(normalizeRequestNo))]));
  });
}

module.exports = { REQUEST_KINDS, REPOSITORY, normalizeRequestNo, parseRequestNos, requestKind, lookupRequestPublication, lookupRequestPublications, lookupRequestExportRecords };
