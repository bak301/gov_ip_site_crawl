const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wipoTracker", {
  scrapeCapMode: false,
  checkConnection: () => ipcRenderer.invoke("tracker:health"),
  siteStatus: (refresh = false) => ipcRenderer.invoke("tracker:site-status", { refresh }),
  siteStatusHistory: (day) => ipcRenderer.invoke("tracker:site-status-history", { day }),
  init: () => ipcRenderer.invoke("tracker:init"),
  list: (applicationNos) => ipcRenderer.invoke("tracker:list", { applicationNos }),
  detail: (applicationNo) => ipcRenderer.invoke("tracker:detail", { applicationNo }),
  applicationMedia: (applicationNo) => ipcRenderer.invoke("tracker:application-media", { applicationNo }),
  resolveCaseRefs: (caseRefs) => ipcRenderer.invoke("tracker:resolve-case-refs", { caseRefs }),
  lookupApplicationRefs: (applicationNos) => ipcRenderer.invoke("tracker:lookup-application-refs", { applicationNos }),
  lookupRegistrations: (registrationNumbers = [], registrationType = "patent", applicationNos = []) => ipcRenderer.invoke("tracker:lookup-registrations", { registrationNumbers, registrationType, applicationNos }),
  scrape: (applicationNos, presetIndex = 1, retryCount = 10) => ipcRenderer.invoke("tracker:scrape", { applicationNos, presetIndex, retryCount }),
  scrapePriorities: (applicationNos) => ipcRenderer.invoke("tracker:scrape-priorities", { applicationNos }),
  queueConcurrency: 5,
  queueDispatchInterval: 1000,
  stop: () => ipcRenderer.invoke("tracker:stop"),
  exportExcel: (applicationNos) => ipcRenderer.invoke("tracker:export", { applicationNos }),
  exportBatch: (payload) => ipcRenderer.invoke("tracker:export-batch", payload),
  downloadPdf: (applicationNo) => ipcRenderer.invoke("tracker:download-pdf", { applicationNo }),
  downloadHaguePdf: (number) => ipcRenderer.invoke("tracker:download-hague-pdf", { number }),
  openPublicationPdf: (applicationNo, registrationNo = '') => ipcRenderer.invoke("tracker:open-publication-pdf", { applicationNo, registrationNo }),
  preparePublicationPdf: (applicationNo, registrationNo = '', document = {}) => ipcRenderer.invoke('tracker:prepare-publication-pdf', {
    applicationNo, registrationNo, requestNo: document.requestNo || '', documentId: document.id || document.lookupKey || '' }),
  requestPublications: (requestNo) => ipcRenderer.invoke('tracker:request-publications', { requestNo }),
  requestPublicationsBatch: (requestNos) => ipcRenderer.invoke('tracker:request-publications-batch', { requestNos }),
  hagueDesign: (number, refresh = false) => ipcRenderer.invoke('tracker:hague-design', { number, refresh }),
  hagueList: (registrationNos) => ipcRenderer.invoke('tracker:hague-list', { registrationNos }),
  hagueDetail: (number) => ipcRenderer.invoke('tracker:hague-detail', { number }),
  internationalPublications: (identifier) => ipcRenderer.invoke('tracker:international-publications', { identifier }),
  saveHaguePdf: (number, eventId) => ipcRenderer.invoke('tracker:save-hague-pdf', { number, eventId }),
  saveRequestPublicationPdf: (requestNo, document = {}) => ipcRenderer.invoke('tracker:save-request-publication-pdf', { requestNo,
    documentId: document.id || document.lookupKey || '', documentIds: (document.documents || []).map((item) => item.id || item.lookupKey || '').filter(Boolean), all: Boolean(document.all) }),
  savePublicationPdf: (applicationNo, registrationNo = '', document = {}) => ipcRenderer.invoke("tracker:save-publication-pdf", { applicationNo, registrationNo, requestNo: document.requestNo || '', documentId: document.id || document.lookupKey || '', documentIds: (document.documents || []).map((item) => item.id || item.lookupKey || '').filter(Boolean), category: document.category || '', all: Boolean(document.all) }),
  checkPublicationA: (applicationNo) => ipcRenderer.invoke("tracker:check-publication-a", { applicationNo }),
  onProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("scrape:progress", listener);
    return () => ipcRenderer.removeListener("scrape:progress", listener);
  },
});
