const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lookupGui", {
  getPathSettings: () => ipcRenderer.invoke("lookupgui:get-path-settings"),
  setPathSettings: (payload) => ipcRenderer.invoke("lookupgui:set-path-settings", payload),
  pickDirectory: (payload) => ipcRenderer.invoke("lookupgui:pick-directory", payload),
  listSourceFiles: () => ipcRenderer.invoke("lookupgui:list-source-files"),
  loadSourceSummary: (payload) => ipcRenderer.invoke("lookupgui:load-source-summary", payload),
  lookupMatches: (payload) => ipcRenderer.invoke("lookupgui:lookup-matches", payload),
  downloadMatches: (payload) => ipcRenderer.invoke("lookupgui:download-matches", payload),
  openOutputFolder: (payload) => ipcRenderer.invoke("lookupgui:open-output-folder", payload),
  abortDownload: () => ipcRenderer.invoke("lookupgui:abort-download"),
  startMonthlyScrape: () => ipcRenderer.invoke("lookupgui:start-monthly-scrape"),
  onScrapeLog: (handler) => {
    const listener = (_event, payload) => {
      handler(payload || {});
    };
    ipcRenderer.on("lookupgui:scrape-log", listener);
    return () => ipcRenderer.removeListener("lookupgui:scrape-log", listener);
  },
  onScrapeStatus: (handler) => {
    const listener = (_event, payload) => {
      handler(payload || {});
    };
    ipcRenderer.on("lookupgui:scrape-status", listener);
    return () => ipcRenderer.removeListener("lookupgui:scrape-status", listener);
  },
  onDownloadLog: (handler) => {
    const listener = (_event, payload) => {
      handler(payload || {});
    };
    ipcRenderer.on("lookupgui:download-log", listener);
    return () => ipcRenderer.removeListener("lookupgui:download-log", listener);
  },
});
