const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wipoGui", {
  listPresets: () => ipcRenderer.invoke("presets:list"),
  startRun: (payload) => ipcRenderer.invoke("run:start", payload),
  stopRun: () => ipcRenderer.invoke("run:stop"),
  listTsvFiles: () => ipcRenderer.invoke("lists:list"),
  loadTsvFile: (payload) => ipcRenderer.invoke("lists:load", payload),
  createTsvFile: (payload) => ipcRenderer.invoke("lists:create", payload),
  renameTsvFile: (payload) => ipcRenderer.invoke("lists:rename", payload),
  listOutputDates: () => ipcRenderer.invoke("output:dates"),
  listOutputFiles: (payload) => ipcRenderer.invoke("output:files", payload),
  readOutputFile: (payload) => ipcRenderer.invoke("output:read", payload),
  listInputFiles: () => ipcRenderer.invoke("input:files"),
  readInputFile: (payload) => ipcRenderer.invoke("input:read", payload),
  writeInputFile: (payload) => ipcRenderer.invoke("input:write", payload),
  onRunLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("run:log", listener);
    return () => ipcRenderer.removeListener("run:log", listener);
  },
});
