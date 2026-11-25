const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { parseApplicationNumbers } = require('./tracker_core');
const {
  callStatusDatabase,
  databasePath: sharedStatusDatabasePath,
} = require('../general_SoftIP_Scripts/softip_status_database');

const DEFAULT_STATUS_ROOT = process.env.WIPO_STATUS_ROOT || 'D:\\Auto_Download_Email_IPVN\\Email_IPVN';
const DEFAULT_CASE_RECORD_PATHS = [
  path.resolve(__dirname, '..', '28_Case_Table_Database', 'data', 'case_table_records.jsonl'),
  path.resolve(__dirname, '..', '28_Case_Table_Database', 'data', 'design-cases', 'case_table_records.jsonl'),
];

function normalizeCaseRef(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(/^IP[-\\](PR|TR|DR)/, 'IP/$1');
}

function parseCaseRefs(value) {
  const text = Array.isArray(value) ? value.join('\n') : String(value || '');
  return [...new Set((text.match(/\bIP[\/\\-](?:PR|TR|DR)\s*\d+(?:\/[A-Z0-9-]+)*/gi) || [])
    .map(normalizeCaseRef)
    .filter((ref) => /^IP\/(?:PR|TR|DR)\d+(?:\/[A-Z0-9-]+)*$/.test(ref)))];
}

function createCaseRefResolver(options = {}) {
  const statusRoot = options.statusRoot || DEFAULT_STATUS_ROOT;
  const statusJsonPath = options.statusJsonPath || path.join(statusRoot, 'status_split', 'status.json');
  const caseRecordPaths = options.caseRecordPaths || DEFAULT_CASE_RECORD_PATHS;
  let cachedSignature = '';
  let byExact = new Map();
  let byBase = new Map();
  let byApplication = new Map();
  let loadPromise = null;

  async function refreshSharedStatusIfNeeded() {
    if (options.statusJsonPath) return;
    const statusStorePath = path.join(path.dirname(path.resolve(statusRoot)), 'Main_Script', 'utils', 'statusStore.js');
    if (!fs.existsSync(statusStorePath)) throw new Error(`Shared status converter is missing: ${statusStorePath}`);
    // The email GUI owns the authenticated workbook updater. Its converter also
    // synchronizes the generalized SQLite database when a workbook changes.
    require(statusStorePath).convertStatusExcelToJson(statusRoot);
  }

  async function loadIndex() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      await refreshSharedStatusIfNeeded();
      const sources = [statusJsonPath, ...caseRecordPaths];
      const stats = await Promise.all(sources.map(async (source) => {
        const stat = await fs.promises.stat(source).catch(() => null);
        return stat ? `${source}:${stat.mtimeMs}:${stat.size}` : `${source}:missing`;
      }));
      const signature = stats.join('|');
      if (signature === cachedSignature) return;
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
        const applicationNos = parseApplicationNumbers(canonical.appNo || row['App No'] || row['App No.'] || '');
        if (!applicationNos.length) continue;
        const sourceCode = sourceFile.match(/^export-([A-Z]{2})(?:[-_]|\.)/i)?.[1]?.toUpperCase() || '';
        for (const ref of parseCaseRefs(canonical.caseRef || row['Case Ref'] || '').filter((value) => !sourceCode || value.startsWith(`IP/${sourceCode}`))) {
          const baseRef = ref.match(/^IP\/PR\d+/)?.[0];
          for (const appNo of applicationNos) {
            add(exact, ref, appNo);
            if (baseRef) add(base, baseRef, appNo);
            add(applications, appNo, ref);
          }
        }
      }
      for (const source of caseRecordPaths) {
        if (!fs.existsSync(source)) continue;
        const lines = readline.createInterface({ input: fs.createReadStream(source, { encoding: 'utf8' }), crlfDelay: Infinity });
        for await (const line of lines) {
          let row;
          try { row = JSON.parse(line); } catch { continue; }
          const refs = parseCaseRefs(row.case_ref || row.caseRef || '')
            .filter((ref) => /^IP\/(?:TR|DR)\d+/.test(ref));
          if (!refs.length) continue;
          const applicationNos = parseApplicationNumbers(row.dictionary_app_no || row.app_no || row.application_number || '');
          for (const ref of refs) {
            const baseRef = ref.match(/^IP\/(?:TR|DR)\d+/)?.[0];
            for (const appNo of applicationNos) {
              add(exact, ref, appNo);
              if (baseRef) add(base, baseRef, appNo);
              add(applications, appNo, ref);
            }
          }
        }
      }
      byExact = exact;
      byBase = base;
      byApplication = applications;
      cachedSignature = signature;
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
    if (options.statusJsonPath) {
      return {
        ok: true,
        matches: applicationNos.map((applicationNo) => ({ applicationNo, caseRefs: [...(byApplication.get(applicationNo) || [])] })),
        source: statusJsonPath,
      };
    }
    const shared = await callStatusDatabase('lookup-applications', { applicationNos });
    const sharedByApplication = new Map((shared.matches || []).map((match) => [match.applicationNo, match]));
    return {
      ok: true,
      matches: applicationNos.map((applicationNo) => {
        const metadata = sharedByApplication.get(applicationNo) || {};
        return {
          ...metadata,
          applicationNo,
          caseRefs: [...new Set([...(metadata.caseRefs || []), ...(byApplication.get(applicationNo) || [])])],
        };
      }),
      source: sharedStatusDatabasePath(),
    };
  }

  async function initialize() {
    await loadIndex();
    const database = await callStatusDatabase('init');
    return { ok: true, database: database.database, source: statusJsonPath };
  }

  return { resolve, lookupApplications, initialize };
}

module.exports = { createCaseRefResolver, normalizeCaseRef, parseCaseRefs, DEFAULT_STATUS_ROOT, DEFAULT_CASE_RECORD_PATHS };
