(() => {
  if (window.wipoTracker || location.protocol === 'file:') return;
  const route = '/wipo-application-tracker';
  const progressHandlers = new Set();
  let activeJobId = '';
  const notify = (payload) => progressHandlers.forEach((handler) => handler(payload));

  async function json(path, options = {}) {
    const response = await fetch(`${route}${path}`, {
      cache: 'no-store',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  async function scrape(applicationNos, presetIndex, retryCount = 10) {
    const queued = await json('/api/scrape', { method: 'POST', body: JSON.stringify({ applicationNos, presetIndex, retryCount }) });
    activeJobId = queued.jobId || '';
    notify({ type: 'start', message: queued.message || 'Scrape queued.' });
    const seenCompleted = new Set();
    try {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const job = await json(`/api/jobs/${encodeURIComponent(queued.jobId)}`);
        for (const applicationNo of job.completedApplications || []) {
          if (seenCompleted.has(applicationNo)) continue;
          seenCompleted.add(applicationNo);
          notify({ type: 'record', applicationNo, message: `Stored ${applicationNo}` });
        }
        if (job.message) notify({ type: job.status === 'done' || job.status === 'failed' ? 'done' : 'log', level: job.status === 'failed' ? 'error' : '', message: job.message });
        if (job.status === 'done') return job.result;
        if (job.status === 'failed') return { ok: false, error: job.error || job.message };
      }
    } finally { activeJobId = ''; }
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

  function openPublicationPdf(applicationNo, registrationNo = '') {
    return json(`/api/publication-pdfs?applicationNo=${encodeURIComponent(applicationNo)}&registrationNo=${encodeURIComponent(registrationNo)}`);
  }

  const clientId = localStorage.getItem('softipLanClientId') || (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  localStorage.setItem('softipLanClientId', clientId);
  const heartbeat = () => fetch('/softip/api/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, service: 'wipo-tracker' }) }).catch(() => {});
  heartbeat(); setInterval(heartbeat, 15000);

  window.wipoTracker = {
    init: () => json('/api/init'),
    list: (applicationNos) => json('/api/list', { method: 'POST', body: JSON.stringify({ applicationNos }) }),
    detail: (applicationNo) => json(`/api/detail?applicationNo=${encodeURIComponent(applicationNo)}`),
    resolveCaseRefs: (caseRefs) => json('/api/resolve-case-refs', { method: 'POST', body: JSON.stringify({ caseRefs }) }),
    lookupApplicationRefs: (applicationNos) => json('/api/lookup-application-refs', { method: 'POST', body: JSON.stringify({ applicationNos }) }),
    scrape,
    stop: () => json('/api/stop', { method: 'POST', body: JSON.stringify({ jobId: activeJobId }) }),
    exportExcel,
    downloadPdf,
    openPublicationPdf,
    checkPublicationA: (applicationNo) => json(`/api/publication-a-status?applicationNo=${encodeURIComponent(applicationNo)}`),
    onProgress(handler) { progressHandlers.add(handler); return () => progressHandlers.delete(handler); },
  };
})();
