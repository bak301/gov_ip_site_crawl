const fs = require('fs');
const path = require('path');
const { parseApplicationNumbers } = require('./tracker_core');

const DEFAULT_STATUS_ROOT = process.env.WIPO_STATUS_ROOT || 'D:\\Auto_Download_Email_IPVN\\Email_IPVN';

function normalizeCaseRef(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(/^IP[-\\]PR/, 'IP/PR');
}

function parseCaseRefs(value) {
  const text = Array.isArray(value) ? value.join('\n') : String(value || '');
  return [...new Set((text.match(/\bIP[\/\\-]PR\s*\d+(?:\/[A-Z0-9]+)?/gi) || [])
    .map(normalizeCaseRef)
    .filter((ref) => /^IP\/PR\d+(?:\/[A-Z0-9]+)?$/.test(ref)))];
}

function createCaseRefResolver(options = {}) {
  const statusRoot = options.statusRoot || DEFAULT_STATUS_ROOT;
  const statusJsonPath = options.statusJsonPath || path.join(statusRoot, 'status_split', 'status.json');
  let cachedMtime = -1;
  let cachedSize = -1;
  let byExact = new Map();
  let byBase = new Map();
  let byApplication = new Map();
  let loadPromise = null;

  async function refreshSharedStatusIfNeeded() {
    if (options.statusJsonPath) return;
    const folder = path.dirname(statusJsonPath);
    const files = await fs.promises.readdir(folder, { withFileTypes: true });
    const spreadsheets = files.filter((entry) => entry.isFile() && /^export-PR-.*\.xlsx$/i.test(entry.name));
    if (!spreadsheets.length) return;
    const latestSourceMtime = Math.max(...await Promise.all(spreadsheets.map(async (entry) =>
      (await fs.promises.stat(path.join(folder, entry.name))).mtimeMs)));
    const jsonMtime = (await fs.promises.stat(statusJsonPath).catch(() => null))?.mtimeMs || 0;
    if (jsonMtime >= latestSourceMtime) return;
    const statusStorePath = path.join(path.dirname(path.resolve(statusRoot)), 'Main_Script', 'utils', 'statusStore.js');
    if (!fs.existsSync(statusStorePath)) throw new Error(`Shared status export is stale and its converter is missing: ${statusStorePath}`);
    require(statusStorePath).convertStatusExcelToJson(statusRoot);
  }

  async function loadIndex() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      await refreshSharedStatusIfNeeded();
      const stat = await fs.promises.stat(statusJsonPath);
      if (stat.mtimeMs === cachedMtime && stat.size === cachedSize) return;
      const data = JSON.parse(await fs.promises.readFile(statusJsonPath, 'utf8'));
      const exact = new Map();
      const base = new Map();
      const applications = new Map();
      const add = (index, key, appNo) => {
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(appNo);
      };
      for (const row of data.rows || []) {
        const canonical = row._canonical || {};
        const sourceFile = canonical.sourceFile || row._source?.file || '';
        if (!/^export-PR-/i.test(sourceFile)) continue;
        const applicationNos = parseApplicationNumbers(canonical.appNo || row['App No'] || row['App No.'] || '');
        if (!applicationNos.length) continue;
        for (const ref of parseCaseRefs(canonical.caseRef || row['Case Ref'] || '')) {
          const baseRef = ref.match(/^IP\/PR\d+/)?.[0];
          for (const appNo of applicationNos) {
            add(exact, ref, appNo);
            if (baseRef) add(base, baseRef, appNo);
            add(applications, appNo, ref);
          }
        }
      }
      byExact = exact;
      byBase = base;
      byApplication = applications;
      cachedMtime = stat.mtimeMs;
      cachedSize = stat.size;
    })();
    try { await loadPromise; } finally { loadPromise = null; }
  }

  async function resolve(value) {
    const refs = parseCaseRefs(value);
    await loadIndex();
    const matches = [];
    const missing = [];
    for (const caseRef of refs) {
      // A suffixed reference is specific; never silently resolve it to a different suffix.
      const applicationNos = byExact.get(caseRef) || (!caseRef.includes('/', 3) ? byBase.get(caseRef) : undefined);
      if (!applicationNos?.size) missing.push(caseRef);
      else matches.push({ caseRef, applicationNos: [...applicationNos] });
    }
    return { ok: true, matches, missing, source: statusJsonPath };
  }

  async function lookupApplications(value) {
    const applicationNos = parseApplicationNumbers(value);
    await loadIndex();
    return {
      ok: true,
      matches: applicationNos.map((applicationNo) => ({ applicationNo, caseRefs: [...(byApplication.get(applicationNo) || [])] })),
      source: statusJsonPath,
    };
  }

  return { resolve, lookupApplications };
}

module.exports = { createCaseRefResolver, normalizeCaseRef, parseCaseRefs, DEFAULT_STATUS_ROOT };
