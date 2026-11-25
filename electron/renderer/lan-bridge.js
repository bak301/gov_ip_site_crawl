(() => {
  if (window.wipoTracker || location.protocol === 'file:') return;
  const route = '/wipo-application-tracker';
  const progressHandlers = new Set();
  const activeJobIds = new Set();
  const monitoredJobs = new Map();
  const activeJobsStorageKey = 'softipWipoActiveJobIds';
  let requestLookupUnavailableUntil = 0;
  let requestLookupUnavailableReason = '';
  let stopEpoch = 0;
  const notify = (payload) => progressHandlers.forEach((handler) => handler(payload));

  function savedJobIds() {
    try { return JSON.parse(localStorage.getItem(activeJobsStorageKey) || '[]').filter(Boolean); } catch { return []; }
  }

  function writeSavedJobIds(jobIds) {
    localStorage.setItem(activeJobsStorageKey, JSON.stringify([...new Set(jobIds)].filter(Boolean)));
  }

  function rememberJobId(jobId) {
    writeSavedJobIds([...savedJobIds(), jobId]);
  }

  function forgetJobId(jobId) {
    writeSavedJobIds(savedJobIds().filter((savedId) => savedId !== jobId));
  }

  async function json(path, options = {}) {
    const response = await fetch(`${route}${path}`, {
      cache: 'no-store',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function monitorJob(jobId, initialJob = null) {
    if (monitoredJobs.has(jobId)) return monitoredJobs.get(jobId);
    const monitor = (async () => {
      activeJobIds.add(jobId);
      rememberJobId(jobId);
    const seenCompleted = new Set();
    let lastLogSequence = 0;
    let lastLegacyMessage = '';
    let isInitialSnapshot = Boolean(initialJob);
    try {
      let job = initialJob;
      while (true) {
        if (!job) {
          await new Promise((resolve) => setTimeout(resolve, 900));
          try { job = await json(`/api/jobs/${encodeURIComponent(jobId)}?afterLog=${lastLogSequence}`); }
          catch (error) {
            if (error.status === 404) {
              forgetJobId(jobId);
              return { ok: false, error: 'The scrape job is no longer available on the LAN host.' };
            }
            notify({ type: 'log', message: 'Connection interrupted; keeping the active scrape and reconnecting…' });
            continue;
          }
        }
        for (const applicationNo of job.completedApplications || []) {
          if (seenCompleted.has(applicationNo)) continue;
          seenCompleted.add(applicationNo);
          notify({ type: 'record', applicationNo, message: `Stored ${applicationNo}` });
        }
        if (Array.isArray(job.logEvents)) {
          for (const event of job.logEvents) {
            if (Number(event.sequence) <= lastLogSequence) continue;
            lastLogSequence = Number(event.sequence);
            notify({ type: 'log', message: event.message, jobId });
          }
        } else if (!isInitialSnapshot && job.message && job.message !== lastLegacyMessage) {
          lastLegacyMessage = job.message;
          notify({ type: 'log', message: job.message, jobId });
        }
        isInitialSnapshot = false;
        notify({ type: job.status === 'done' || job.status === 'failed' || job.status === 'cancelled' ? 'done' : 'log',
          level: job.status === 'failed' ? 'error' : '', message: job.message, log: false,
          jobId, jobStatus: job.status, applicationNos: job.applicationNos || [], applicationStates: job.applicationStates || {} });
        if (job.status === 'done') { forgetJobId(jobId); return job.result; }
        if (job.status === 'failed') { forgetJobId(jobId); return { ok: false, error: job.error || job.message }; }
        if (job.status === 'cancelled') { forgetJobId(jobId); return job.result || { ok: false, cancelled: true, imported: [], missing: [], notFound: [], error: 'Stopped by user.' }; }
        job = null;
      }
    } finally {
      activeJobIds.delete(jobId);
      monitoredJobs.delete(jobId);
    }
    })();
    monitoredJobs.set(jobId, monitor);
    return monitor;
  }

  async function scrape(applicationNos, presetIndex, scrapeCap = 25, knownNotFound = []) {
    const startedInEpoch = stopEpoch;
    const queued = await json('/api/scrape', { method: 'POST', body: JSON.stringify({ applicationNos, presetIndex, scrapeCap, knownNotFound, clientId }) });
    if (startedInEpoch !== stopEpoch) {
      await json('/api/stop', { method: 'POST', body: JSON.stringify({ jobId: queued.jobId, clientId }) }).catch(() => null);
      return { ok: false, cancelled: true, imported: [], missing: [], notFound: [], error: 'Stopped by user.' };
    }
    notify({ type: 'start', message: queued.message || 'Scrape queued.' });
    return monitorJob(queued.jobId);
  }

  async function resumeScrapes() {
    let jobs = [];
    try { jobs = (await json(`/api/jobs?clientId=${encodeURIComponent(clientId)}`)).jobs || []; } catch { /* Older live host: recover the browser's saved job IDs individually. */ }
    const knownIds = new Set(jobs.map((job) => job.id));
    const recovered = await Promise.all(savedJobIds().filter((jobId) => !knownIds.has(jobId)).map((jobId) => json(`/api/jobs/${encodeURIComponent(jobId)}`).catch(() => null)));
    jobs.push(...recovered.filter((job) => job && job.clientId === clientId && (job.status === 'queued' || job.status === 'running')));
    activeJobIds.clear();
    jobs.forEach((job) => activeJobIds.add(job.id));
    writeSavedJobIds(jobs.map((job) => job.id));
    jobs.forEach((job) => { monitorJob(job.id, job).catch((error) => notify({ type: 'done', level: 'error', message: error.message || 'Could not resume scrape monitoring.' })); });
    return jobs;
  }

  async function stopActiveJobs() {
    stopEpoch += 1;
    const jobIds = [...activeJobIds];
    let result;
    try {
      result = await json('/api/stop', { method: 'POST', body: JSON.stringify({ clientId, all: true }) });
    } catch (error) {
      if (![400, 404].includes(error.status)) throw error;
      if (!jobIds.length) return { ok: true, stopped: 0, message: 'No scrape jobs are active for this user.' };
      const legacyResults = await Promise.all(jobIds.map((jobId) => json('/api/stop', { method: 'POST', body: JSON.stringify({ jobId, clientId }) }).catch((legacyError) => ({ ok: false, error: legacyError.message }))));
      const successes = legacyResults.filter((item) => item?.ok);
      if (!successes.length) return legacyResults.find((item) => item?.ok === false) || { ok: false, error: 'Could not stop the scraper.' };
      result = { ok: true, jobsStopped: successes.length, message: `Stopped ${successes.length} scrape job${successes.length === 1 ? '' : 's'} for this user.` };
    }
    if (result?.ok) {
      jobIds.forEach(forgetJobId);
      activeJobIds.clear();
    }
    return result;
  }

  async function exportExcel(applicationNos) {
    const response = await fetch(`${route}/api/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationNos }) });
    if (!response.ok) {
      let data = {};
      try { data = await response.json(); } catch {}
      return { ok: false, error: data.error || `Export failed (HTTP ${response.status}).` };
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || 'WIPO_export.xlsx';
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = fileName; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, count: Number(response.headers.get('X-Export-Count') || applicationNos.length) };
  }

  async function exportBatch(payload) {
    const response = await fetch(`${route}/api/export-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) {
      let data = {};
      try { data = await response.json(); } catch {}
      return { ok: false, error: data.error || `Batch export failed (HTTP ${response.status}).` };
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || 'WIPO_export.zip';
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = fileName; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, count: Number(response.headers.get('X-Export-Count') || 1), fileName };
  }

  async function downloadPdf(applicationNo, html) {
    const response = await fetch(`${route}/api/export-pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationNo, html }),
    });
    if (!response.ok) {
      let data = {};
      try { data = await response.json(); } catch {}
      return { ok: false, error: data.error || `PDF export failed (HTTP ${response.status}).` };
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `WIPO_${applicationNo.replace(/[^A-Z0-9-]/gi, '_')}.pdf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  }

  async function downloadHaguePdf(number, html) {
    const response = await fetch(`${route}/api/hague-report-pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number, html }),
    });
    if (!response.ok) {
      let data = {};
      try { data = await response.json(); } catch {}
      return { ok: false, error: data.error || `Hague PDF export failed (HTTP ${response.status}).` };
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `WIPO_Hague_${String(number).replace(/[^A-Z0-9-]/gi, '_')}.pdf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  }

  function openPublicationPdf(applicationNo, registrationNo = '') {
    return json(`/api/publication-pdfs?applicationNo=${encodeURIComponent(applicationNo)}&registrationNo=${encodeURIComponent(registrationNo)}`);
  }

  function requestPublications(requestNo) {
    const unavailable = (reason) => ({ ok: false, hostUpdateRequired: reason === 'old-host', hostOffline: reason === 'offline',
      checkedAt: Date.now(), documents: [], error: reason === 'old-host'
        ? 'The WipoPublish host needs to be restarted in Unified Hosting Hub to enable request PDF lookup.'
        : 'The WipoPublish LAN host is offline or unreachable. Start it in Unified Hosting Hub, then retry.' });
    if (Date.now() < requestLookupUnavailableUntil) return Promise.resolve(unavailable(requestLookupUnavailableReason));
    return json(`/api/request-publication-pdfs?requestNo=${encodeURIComponent(requestNo)}`).then((result) => {
      requestLookupUnavailableUntil = 0;
      requestLookupUnavailableReason = '';
      return result;
    }).catch((error) => {
      const reason = error.status === 404 ? 'old-host' : (!error.status ? 'offline' : '');
      if (!reason) throw error;
      requestLookupUnavailableReason = reason;
      requestLookupUnavailableUntil = Date.now() + 10000;
      return unavailable(reason);
    });
  }

  function requestPublicationsBatch(requestNos) {
    const unavailable = (reason) => ({ ok: false, hostUpdateRequired: reason === 'old-host', hostOffline: reason === 'offline',
      checkedAt: Date.now(), error: reason === 'old-host'
        ? 'The WipoPublish host needs to be restarted in Unified Hosting Hub to enable request PDF lookup.'
        : 'The WipoPublish LAN host is offline or unreachable. Start it in Unified Hosting Hub, then retry.' });
    if (Date.now() < requestLookupUnavailableUntil) return Promise.resolve(unavailable(requestLookupUnavailableReason));
    return json('/api/request-publication-pdfs/batch', { method: 'POST', body: JSON.stringify({ requestNos }) }).then((result) => {
      requestLookupUnavailableUntil = 0;
      requestLookupUnavailableReason = '';
      return result;
    }).catch((error) => {
      const reason = error.status === 404 ? 'old-host' : (!error.status ? 'offline' : '');
      if (!reason) throw error;
      requestLookupUnavailableReason = reason;
      requestLookupUnavailableUntil = Date.now() + 10000;
      return unavailable(reason);
    });
  }

  async function saveRequestPublicationPdf(requestNo, document = {}) {
    const ids = (document.documents || []).map((item) => item.id).filter(Boolean).map((id) => `&documentId=${encodeURIComponent(id)}`).join('');
    const url = document.all
      ? `${route}/api/request-publication-pdf-merged?requestNo=${encodeURIComponent(requestNo)}${ids}`
      : String(document.url || '').split('#')[0];
    if (!url) return { ok: false, error: 'Request publication PDF link is unavailable.' };
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = document.all ? `${requestNo}_publications.pdf` : String(document.sourceFile || `${requestNo}_publication.pdf`).replace(/[<>:"/\\|?*]/g, '_');
    anchor.style.display = 'none'; window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
    return { ok: true };
  }

  async function savePublicationPdf(applicationNo, registrationNo = '', document = {}) {
    const ids = (document.documents || []).map((item) => item.id || item.lookupKey || '').filter(Boolean).map((id) => `&documentId=${encodeURIComponent(id)}`).join('');
    const url = document.all
      ? `${route}/api/publication-pdf-merged?applicationNo=${encodeURIComponent(applicationNo)}&registrationNo=${encodeURIComponent(registrationNo)}&category=${encodeURIComponent(document.category || 'annuity')}${ids}`
      : String(document.extractUrl || document.url || '').split('#')[0];
    if (!url) return { ok: false, error: 'Publication PDF download link is unavailable.' };
    const fallback = document.all ? `WIPO_${applicationNo}_${document.category || 'annuity'}_all.pdf` : `WIPO_${applicationNo}_publication.pdf`;
    const fileName = String(document.sourcePreview ? fallback : (document.sourceFile || fallback)).replace(/[<>:"/\\|?*]/g, '_');
    const anchor = document.ownerDocument ? document.ownerDocument.createElement('a') : window.document.createElement('a');
    anchor.href = url;
    anchor.download = /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`;
    anchor.style.display = 'none';
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { ok: true };
  }

  async function preparePublicationPdf(_applicationNo, _registrationNo = '', document = {}) {
    return { ok: Boolean(document.extractUrl || document.url), url: String(document.extractUrl || document.url || '').split('#')[0] };
  }

  const clientId = localStorage.getItem('softipLanClientId') || (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  localStorage.setItem('softipLanClientId', clientId);
  const heartbeat = () => fetch('/softip/api/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, service: 'wipo-tracker' }) }).catch(() => {});
  heartbeat(); setInterval(heartbeat, 15000);

  window.wipoTracker = {
    scrapeCapMode: true,
    checkConnection: () => json('/api/health'),
    siteStatus: (refresh = false) => json(`/api/site-status${refresh ? '?refresh=1' : ''}`),
    siteStatusHistory: (day) => json(`/api/site-status-history${day ? `?day=${encodeURIComponent(day)}` : ''}`),
    init: () => json('/api/init'),
    list: (applicationNos) => json('/api/list', { method: 'POST', body: JSON.stringify({ applicationNos }) }),
    detail: (applicationNo) => json(`/api/detail?applicationNo=${encodeURIComponent(applicationNo)}`),
    applicationMedia: (applicationNo) => json(`/api/application-media?applicationNo=${encodeURIComponent(applicationNo)}`),
    resolveCaseRefs: (caseRefs) => json('/api/resolve-case-refs', { method: 'POST', body: JSON.stringify({ caseRefs }) }),
    lookupApplicationRefs: (applicationNos) => json('/api/lookup-application-refs', { method: 'POST', body: JSON.stringify({ applicationNos }) }),
    lookupRegistrations: (registrationNumbers = [], registrationType = 'patent', applicationNos = []) => json('/api/lookup-registrations', { method: 'POST', body: JSON.stringify({ registrationNumbers, registrationType, applicationNos }) }),
    scrape,
    resumeScrapes,
    stop: stopActiveJobs,
    queueConcurrency: 5,
    queueDispatchInterval: 1000,
    exportExcel,
    exportBatch,
    downloadPdf,
    downloadHaguePdf,
    openPublicationPdf,
    requestPublications,
    requestPublicationsBatch,
    hagueDesign: (number, refresh = false) => json(`/api/hague-design?number=${encodeURIComponent(number)}${refresh ? '&refresh=1' : ''}`),
    hagueList: (registrationNos) => json('/api/hague-list', { method: 'POST', body: JSON.stringify({ registrationNos }) }),
    hagueDetail: (number) => json(`/api/hague-detail?number=${encodeURIComponent(number)}`),
    internationalPublications: (identifier) => json(`/api/international-publications?identifier=${encodeURIComponent(identifier)}`),
    saveHaguePdf: async (number, eventId) => {
      const url = `${route}/api/hague-pdf?number=${encodeURIComponent(number)}&eventId=${encodeURIComponent(eventId)}`;
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${String(number).replace('/', '-')}_VN_${eventId}.pdf`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      return { ok: true };
    },
    saveRequestPublicationPdf,
    savePublicationPdf,
    preparePublicationPdf,
    checkPublicationA: (applicationNo) => json(`/api/publication-a-status?applicationNo=${encodeURIComponent(applicationNo)}`),
    onProgress(handler) { progressHandlers.add(handler); return () => progressHandlers.delete(handler); },
    scrapePriorities(applicationNos) { return json('/api/scrape-priorities', {
      method: 'POST', body: JSON.stringify({ applicationNos }),
    }); },
  };
})();
