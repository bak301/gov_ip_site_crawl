const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wipoTracker", {
  init: () => ipcRenderer.invoke("tracker:init"),
  list: (applicationNos) => ipcRenderer.invoke("tracker:list", { applicationNos }),
  detail: (applicationNo) => ipcRenderer.invoke("tracker:detail", { applicationNo }),
  resolveCaseRefs: (caseRefs) => ipcRenderer.invoke("tracker:resolve-case-refs", { caseRefs }),
  lookupApplicationRefs: (applicationNos) => ipcRenderer.invoke("tracker:lookup-application-refs", { applicationNos }),
  scrape: (applicationNos, presetIndex = 1, retryCount = 10) => ipcRenderer.invoke("tracker:scrape", { applicationNos, presetIndex, retryCount }),
  stop: () => ipcRenderer.invoke("tracker:stop"),
  exportExcel: (applicationNos) => ipcRenderer.invoke("tracker:export", { applicationNos }),
  downloadPdf: (applicationNo) => ipcRenderer.invoke("tracker:download-pdf", { applicationNo }),
  openPublicationPdf: (applicationNo, registrationNo = '') => ipcRenderer.invoke("tracker:open-publication-pdf", { applicationNo, registrationNo }),
  checkPublicationA: (applicationNo) => ipcRenderer.invoke("tracker:check-publication-a", { applicationNo }),
  onProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("scrape:progress", listener);
    return () => ipcRenderer.removeListener("scrape:progress", listener);
  },
});
