const presetSelect = document.getElementById("presetSelect");
const runButton = document.getElementById("runButton");
const stopButton = document.getElementById("stopButton");
const clearLogButton = document.getElementById("clearLogButton");
const logOutput = document.getElementById("logOutput");
const statusBadge = document.getElementById("statusBadge");
const inputFileSelect = document.getElementById("inputFileSelect");
const loadInputButton = document.getElementById("loadInputButton");
const saveInputButton = document.getElementById("saveInputButton");
const inputTextArea = document.getElementById("inputTextArea");
const outputDateSelect = document.getElementById("outputDateSelect");
const outputFileSelect = document.getElementById("outputFileSelect");
const refreshOutputButton = document.getElementById("refreshOutputButton");
const copyAllOutputButton = document.getElementById("copyAllOutputButton");
const outputViewport = document.getElementById("outputViewport");
const outputTableBody = document.querySelector("#outputTable tbody");

let running = false;
let outputPollTimer = null;
let lastOutputSignature = "";
let currentOutputContent = "";
let copyButtonResetTimer = null;

const ansiState = {
  color: null,
  bold: false,
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyAnsiCode(code) {
  if (code === 0) {
    ansiState.color = null;
    ansiState.bold = false;
    return;
  }

  if (code === 1) {
    ansiState.bold = true;
    return;
  }

  if (code === 22) {
    ansiState.bold = false;
    return;
  }

  if (code === 39) {
    ansiState.color = null;
    return;
  }

  if ([31, 32, 33, 34, 36, 90].includes(code)) {
    ansiState.color = code;
  }
}

function getAnsiClassNames() {
  const classes = [];
  if (ansiState.color) {
    classes.push(`ansi-${ansiState.color}`);
  }
  if (ansiState.bold) {
    classes.push("ansi-bold");
  }
  if (classes.length === 0) {
    classes.push("ansi-reset");
  }
  return classes.join(" ");
}

function ansiToHtml(text) {
  const cleanText = String(text || "")
    .replace(/\x1b\[[0-9;]*[ABCDHJKf]/g, "")
    .replace(/\r/g, "");

  const tokenRegex = /\x1b\[([0-9;]*)m/g;
  let html = "";
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(cleanText)) !== null) {
    const segment = cleanText.slice(lastIndex, match.index);
    if (segment) {
      html += `<span class="${getAnsiClassNames()}">${escapeHtml(segment)}</span>`;
    }

    const codeParts = match[1] ? match[1].split(";") : ["0"];
    for (const part of codeParts) {
      const code = Number.parseInt(part || "0", 10);
      if (!Number.isNaN(code)) {
        applyAnsiCode(code);
      }
    }

    lastIndex = tokenRegex.lastIndex;
  }

  const tail = cleanText.slice(lastIndex);
  if (tail) {
    html += `<span class="${getAnsiClassNames()}">${escapeHtml(tail)}</span>`;
  }

  return html;
}

function appendLog(text) {
  logOutput.innerHTML += ansiToHtml(text);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function setStatus(state, text) {
  statusBadge.className = `status ${state}`;
  statusBadge.textContent = text;
}

function setRunningState(isRunning) {
  running = isRunning;
  runButton.disabled = isRunning;
  presetSelect.disabled = isRunning;
  stopButton.disabled = !isRunning;
  inputFileSelect.disabled = isRunning;
  loadInputButton.disabled = isRunning;
  saveInputButton.disabled = isRunning;
}

function parseIdsFromInputText(text) {
  const ids = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return Array.from(new Set(ids));
}

function renderOutputTable(content) {
  const previousLeft = outputViewport.scrollLeft;
  const previousTop = outputViewport.scrollTop;

  const lines = String(content || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const fragment = document.createDocumentFragment();

  if (lines.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.textContent = "No data loaded";
    tr.appendChild(td);
    fragment.appendChild(tr);
  } else {
    for (const line of lines) {
      const tr = document.createElement("tr");
      const columns = line.split("\t");
      for (const col of columns) {
        const td = document.createElement("td");
        td.textContent = col;
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }
  }

  outputTableBody.replaceChildren(fragment);

  requestAnimationFrame(() => {
    outputViewport.scrollLeft = previousLeft;
    outputViewport.scrollTop = previousTop;
  });
}

async function loadPresets() {
  const presets = await window.wipoGui.listPresets();
  presetSelect.innerHTML = "";

  if (!presets || presets.length === 0) {
    const option = document.createElement("option");
    option.value = "1";
    option.textContent = "Default Preset";
    presetSelect.appendChild(option);
    return;
  }

  presets.forEach((preset) => {
    const option = document.createElement("option");
    option.value = String(preset.index);
    option.textContent = `${preset.index}. ${preset.name}`;
    presetSelect.appendChild(option);
  });
}

async function refreshInputFiles(preferred = "ID_WIPO.txt") {
  const result = await window.wipoGui.listInputFiles();
  if (!result.ok) {
    appendLog(`\n[GUI] Failed to list input files: ${result.error}\n`);
    return;
  }

  const files = result.files || [];
  inputFileSelect.innerHTML = "";

  files.forEach((fileName) => {
    const option = document.createElement("option");
    option.value = fileName;
    option.textContent = fileName;
    inputFileSelect.appendChild(option);
  });

  if (files.length === 0) {
    inputTextArea.value = "";
    return;
  }

  const target = files.includes(preferred) ? preferred : files[0];
  inputFileSelect.value = target;
}

async function loadSelectedInputFile() {
  const fileName = inputFileSelect.value;
  if (!fileName) {
    appendLog("\n[GUI] No input TXT file selected.\n");
    return;
  }

  const result = await window.wipoGui.readInputFile({ fileName });
  if (!result.ok) {
    appendLog(`\n[GUI] Failed to load ${fileName}: ${result.error}\n`);
    return;
  }

  inputTextArea.value = result.content || "";
  appendLog(`\n[GUI] Loaded ${fileName}.\n`);
}

async function saveSelectedInputFile() {
  const fileName = inputFileSelect.value;
  if (!fileName) {
    appendLog("\n[GUI] No input TXT file selected.\n");
    return;
  }

  const result = await window.wipoGui.writeInputFile({
    fileName,
    content: inputTextArea.value,
  });

  if (!result.ok) {
    appendLog(`\n[GUI] Failed to save ${fileName}: ${result.error}\n`);
    return;
  }

  appendLog(`\n[GUI] Saved ${fileName}.\n`);
}

async function refreshOutputDates(preferredDate = "", options = {}) {
  const { autoLoad = true } = options;
  const result = await window.wipoGui.listOutputDates();
  if (!result.ok) {
    appendLog(`\n[GUI] Failed to list output dates: ${result.error}\n`);
    return;
  }

  const dates = result.dates || [];
  outputDateSelect.innerHTML = "";
  dates.forEach((dateName) => {
    const option = document.createElement("option");
    option.value = dateName;
    option.textContent = dateName;
    outputDateSelect.appendChild(option);
  });

  if (dates.length === 0) {
    outputFileSelect.innerHTML = "";
    renderOutputTable("");
    lastOutputSignature = "";
    return;
  }

  outputDateSelect.value = preferredDate && dates.includes(preferredDate)
    ? preferredDate
    : dates[0];

  await refreshOutputFiles("", { autoLoad });
}

async function refreshOutputFiles(preferredFile = "", options = {}) {
  const { autoLoad = true } = options;
  const dateFolder = outputDateSelect.value;
  if (!dateFolder) {
    outputFileSelect.innerHTML = "";
    return;
  }

  const result = await window.wipoGui.listOutputFiles({ dateFolder });
  if (!result.ok) {
    appendLog(`\n[GUI] Failed to list output files: ${result.error}\n`);
    return;
  }

  const allowedOutputPattern = /^(sc|nh|kd)_wipo_\d{4}-\d{2}-\d{2}\.txt$/i;
  const visibleFiles = (result.files || []).filter((name) =>
    allowedOutputPattern.test(String(name || ""))
  );

  const pickDefaultOutputFile = (files, folder) => {
    if (!Array.isArray(files) || files.length === 0) {
      return "";
    }

    const targetSc = `sc_wipo_${String(folder || "").toLowerCase()}.txt`;
    const scFile = files.find((f) => String(f).toLowerCase() === targetSc);
    if (scFile) {
      return scFile;
    }

    const wipoTxt = files.find(
      (f) => /^nh_wipo_\d{4}-\d{2}-\d{2}\.txt$/i.test(String(f || ""))
    ) || files.find(
      (f) => /^kd_wipo_\d{4}-\d{2}-\d{2}\.txt$/i.test(String(f || ""))
    );
    if (wipoTxt) {
      return wipoTxt;
    }

    const anyTxt = files.find((f) => String(f || "").toLowerCase().endsWith(".txt"));
    if (anyTxt) {
      return anyTxt;
    }

    return files[0];
  };

  outputFileSelect.innerHTML = "";

  visibleFiles.forEach((fileName) => {
    const option = document.createElement("option");
    option.value = fileName;
    option.textContent = fileName;
    outputFileSelect.appendChild(option);
  });

  if (visibleFiles.length === 0) {
    renderOutputTable("");
    lastOutputSignature = "";
    appendLog(`\n[GUI] No output file found in ${dateFolder}.\n`);
    return;
  }

  const defaultFile = pickDefaultOutputFile(visibleFiles, dateFolder);

  outputFileSelect.value = preferredFile && visibleFiles.includes(preferredFile)
    ? preferredFile
    : defaultFile;

  if (!autoLoad) {
    currentOutputContent = "";
    lastOutputSignature = "";
    renderOutputTable("");
    return;
  }

  await loadSelectedOutputFile(false);
}

async function loadSelectedOutputFile(silent = false) {
  const dateFolder = outputDateSelect.value;
  const fileName = outputFileSelect.value;

  if (!dateFolder || !fileName) {
    return;
  }

  const result = await window.wipoGui.readOutputFile({ dateFolder, fileName });
  if (!result.ok) {
    if (!silent) {
      appendLog(`\n[GUI] Failed to read output file: ${result.error}\n`);
    }
    return;
  }

  const content = result.content || "";
  currentOutputContent = content;
  const signature = `${content.length}:${content.slice(-200)}`;
  if (signature === lastOutputSignature && silent) {
    return;
  }

  renderOutputTable(content);
  lastOutputSignature = signature;

  if (!silent) {
    appendLog(`\n[GUI] Loaded output ${dateFolder}/${fileName}.\n`);
  }
}

function copyTextWithFallback(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const tempTextArea = document.createElement("textarea");
    tempTextArea.value = text;
    tempTextArea.style.position = "fixed";
    tempTextArea.style.left = "-9999px";
    tempTextArea.style.top = "0";
    document.body.appendChild(tempTextArea);
    tempTextArea.focus();
    tempTextArea.select();

    try {
      const copied = document.execCommand("copy");
      document.body.removeChild(tempTextArea);
      if (copied) {
        resolve();
      } else {
        reject(new Error("Copy command was rejected by the browser."));
      }
    } catch (error) {
      document.body.removeChild(tempTextArea);
      reject(error);
    }
  });
}

function setCopyButtonFeedback(state, text) {
  if (!copyAllOutputButton) {
    return;
  }

  if (copyButtonResetTimer) {
    window.clearTimeout(copyButtonResetTimer);
    copyButtonResetTimer = null;
  }

  copyAllOutputButton.classList.remove("state-success", "state-error");
  if (state === "success") {
    copyAllOutputButton.classList.add("state-success");
  }
  if (state === "error") {
    copyAllOutputButton.classList.add("state-error");
  }

  copyAllOutputButton.textContent = text;

  copyButtonResetTimer = window.setTimeout(() => {
    copyAllOutputButton.classList.remove("state-success", "state-error");
    copyAllOutputButton.textContent = "Copy All";
    copyButtonResetTimer = null;
  }, 1200);
}

function startOutputPolling() {
  if (outputPollTimer) {
    window.clearInterval(outputPollTimer);
  }

  outputPollTimer = window.setInterval(() => {
    loadSelectedOutputFile(true).catch(() => {
      // Ignore polling errors to keep UI responsive.
    });
  }, 2000);
}

runButton.addEventListener("click", async () => {
  if (running) {
    return;
  }

  const ids = parseIdsFromInputText(inputTextArea.value);
  if (ids.length === 0) {
    setStatus("error", "No IDs");
    appendLog("\n[GUI] No input IDs in text area.\n");
    return;
  }

  const presetIndex = Number.parseInt(presetSelect.value, 10) || 1;

  setRunningState(true);
  setStatus("running", "Running");
  appendLog(`\n[GUI] Sending ${ids.length} IDs to ID_WIPO.txt\n`);

  const result = await window.wipoGui.startRun({ ids, presetIndex });

  if (result.ok) {
    const code = typeof result.code === "number" ? result.code : 0;
    if (code === 0) {
      setStatus("done", "Done");
      appendLog(`\n[GUI] Completed with exit code ${code}\n`);
    } else {
      setStatus("error", `Exit ${code}`);
      appendLog(`\n[GUI] Script exited with code ${code}\n`);
    }
  } else {
    setStatus("error", "Error");
    appendLog(`\n[GUI] ${result.error}\n`);
  }

  setRunningState(false);
});

stopButton.addEventListener("click", async () => {
  const result = await window.wipoGui.stopRun();
  if (result.ok) {
    setStatus("idle", "Stopped");
    appendLog("\n[GUI] Stop signal sent.\n");
    setRunningState(false);
  } else {
    appendLog(`\n[GUI] ${result.error}\n`);
  }
});

loadInputButton.addEventListener("click", async () => {
  await loadSelectedInputFile();
});

saveInputButton.addEventListener("click", async () => {
  await saveSelectedInputFile();
});

outputDateSelect.addEventListener("change", async () => {
  await refreshOutputFiles();
  startOutputPolling();
});

outputFileSelect.addEventListener("change", async () => {
  await loadSelectedOutputFile(false);
  startOutputPolling();
});

refreshOutputButton.addEventListener("click", async () => {
  const currentDate = outputDateSelect.value;
  const currentFile = outputFileSelect.value;
  await refreshOutputDates(currentDate);
  if (currentFile) {
    await refreshOutputFiles(currentFile);
  }
});

copyAllOutputButton.addEventListener("click", async () => {
  const textToCopy = String(currentOutputContent || "");
  if (!textToCopy.trim()) {
    setCopyButtonFeedback("error", "No Data");
    appendLog("\n[GUI] No output content to copy.\n");
    return;
  }

  try {
    await copyTextWithFallback(textToCopy);
    setCopyButtonFeedback("success", "Copied");
    appendLog(`\n[GUI] Copied ${textToCopy.length} characters from output.\n`);
  } catch (error) {
    setCopyButtonFeedback("error", "Copy Failed");
    appendLog(`\n[GUI] Copy failed: ${error.message}\n`);
  }
});

clearLogButton.addEventListener("click", () => {
  logOutput.innerHTML = "";
  ansiState.color = null;
  ansiState.bold = false;
});

window.wipoGui.onRunLog((payload) => {
  const text = payload && payload.message ? String(payload.message) : "";
  if (!text) {
    return;
  }

  appendLog(text);
});

renderOutputTable("");
setRunningState(false);
setStatus("idle", "Idle");

Promise.all([
  loadPresets(),
  refreshInputFiles("ID_WIPO.txt").then(() => loadSelectedInputFile()),
  refreshOutputDates("", { autoLoad: true }),
])
  .then(() => {
    startOutputPolling();
  })
  .catch((error) => {
    appendLog(`\n[GUI] Initialization error: ${error.message}\n`);
  });
