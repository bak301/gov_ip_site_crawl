'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseApplicationNumbers } = require('./tracker_core');

const ROOT = __dirname;
const HELPER = path.join(ROOT, 'scrape_priority_lookup.py');
const DEFAULT_TRACKER_DB = path.join(ROOT, 'data', 'WIPO_Application_History.sqlite');
const DEFAULT_WIPO_DB = path.resolve(process.env.WIPO_SCRAPER_DATABASE || path.join(ROOT, '..', 'Wipopublish_Scrape_ApplicationDetails', 'WIPO_Application_History.sqlite'));
const DEFAULT_PUBLICATION_DB = path.join(ROOT, '..', '3_Input', 'Pub', 'Output_Publication', 'GUI_Cache', 'publication_cache.sqlite');

function createScrapePriorityResolver(paths = {}) {
  const databases = [paths.tracker || DEFAULT_TRACKER_DB, paths.wipo || DEFAULT_WIPO_DB,
    paths.publication || DEFAULT_PUBLICATION_DB];
  const cache = new Map();
  let signature = '';
  let lastRefresh = 0;
  return async function resolveScrapePriorities(applicationNos) {
    const numbers = parseApplicationNumbers(applicationNos).filter((number) => /^[1-4]-\d{4}-\d{5}$/.test(number));
    const currentSignature = databases.flatMap((file) => [file, `${file}-wal`]).map((file) => {
      try { const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}`; }
      catch { return '-'; }
    }).join('|');
    if (signature !== currentSignature || Date.now() - lastRefresh > 60000) {
      signature = currentSignature;
      lastRefresh = Date.now();
      cache.clear();
    }
    const missing = numbers.filter((number) => !cache.has(number));
    if (missing.length) {
      try {
        const found = await new Promise((resolve, reject) => {
          const child = spawn(String(process.env.WIPO_PYTHON || 'python'), [HELPER, ...databases], {
            cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
          child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
          child.once('error', reject);
          child.once('close', (code) => {
            if (code !== 0) return reject(new Error(stderr.trim() || `Scrape priority lookup exited with code ${code}.`));
            try { resolve(JSON.parse(stdout || '{}')); }
            catch { reject(new Error('Scrape priority lookup returned invalid JSON.')); }
          });
          child.stdin.end(JSON.stringify(missing));
        });
        for (const number of missing) cache.set(number, found[number] || { rank: 1, trackerHistory: false, wipoHistory: false, publication: false });
      } catch (error) {
        // Lookup is advisory: an unavailable index must never prevent scraping.
        return { ok: false, error: error.message, priorities: Object.fromEntries(numbers.map((number) => [number,
          cache.get(number) || { rank: 1, trackerHistory: false, wipoHistory: false, publication: false }])) };
      }
    }
    return { ok: true, priorities: Object.fromEntries(numbers.map((number) => [number, cache.get(number)])) };
  };
}

module.exports = { createScrapePriorityResolver };
