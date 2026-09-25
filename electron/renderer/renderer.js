const presetSelect = document.getElementById("presetSelect");
const runButton = document.getElementById("runButton");
const stopButton = document.getElementById("stopButton");
const toggleDeleteModeButton = document.getElementById("toggleDeleteModeButton");
const exportExcelButton = document.getElementById("exportExcelButton");
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
const outputTableEl = document.getElementById("outputTable");
const outputTableBody = document.querySelector("#outputTable tbody");
const imagePreviewPopup = document.getElementById("imagePreviewPopup");
const imagePreviewImg = document.getElementById("imagePreviewImg");

let running = false;
let outputPollTimer = null;
let lastOutputSignature = "";
let currentOutputContent = "";
let copyButtonResetTimer = null;
let deleteModeActive = false;

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

function setDeleteMode(active) {
  deleteModeActive = active;
  outputTableEl.classList.toggle("delete-mode-active", active);
  toggleDeleteModeButton.textContent = active ? "Delete Mode: On" : "Delete Mode: Off";
  toggleDeleteModeButton.classList.toggle("active", active);
}

function setRunningState(isRunning) {
  running = isRunning;
  runButton.disabled = isRunning;
  presetSelect.disabled = isRunning;
  stopButton.disabled = !isRunning;
  inputFileSelect.disabled = isRunning;
  loadInputButton.disabled = isRunning;
  saveInputButton.disabled = isRunning;
  toggleDeleteModeButton.disabled = isRunning;
  if (isRunning) {
    setDeleteMode(false);
  }
}

function parseIdsFromInputText(text) {
  const ids = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return Array.from(new Set(ids));
}

function buildTrademarkThumbnailUrl(applicationNo, savedImagePath = "") {
  if (/^5-/.test(String(applicationNo || "").trim())) {
    const localPath = String(savedImagePath || "").trim();
    if (!localPath || localPath.toLowerCase() === "no image") return null;
    return encodeURI(`file:///${localPath.replace(/\\/g, "/")}`);
  }
  const digits = String(applicationNo || "").trim().replace(/-/g, "");
  if (!digits) {
    return null;
  }
  return `https://wipopublish.ipvietnam.gov.vn/wopublish-search/service/trademarks/application/VN${digits}/thumbnail?noLogo=true`;
}

function isCurrentOutputTrademarkFile() {
  return /^nh_wipo_/i.test(String(outputFileSelect.value || ""));
}

function showImagePreview(thumbnailImg) {
  imagePreviewImg.src = thumbnailImg.src;
  const rect = thumbnailImg.getBoundingClientRect();
  const popupMaxSize = 336;

  let left = rect.right + 12;
  if (left + popupMaxSize > window.innerWidth) {
    left = rect.left - popupMaxSize - 12;
  }
  left = Math.max(8, left);

  let top = rect.top;
  if (top + popupMaxSize > window.innerHeight) {
    top = Math.max(8, window.innerHeight - popupMaxSize - 8);
  }

  imagePreviewPopup.style.left = `${left}px`;
  imagePreviewPopup.style.top = `${top}px`;
  imagePreviewPopup.style.display = "block";
}

function hideImagePreview() {
  imagePreviewPopup.style.display = "none";
}

function normalizeDotDatesForDisplay(value) {
  return String(value || "").replace(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g, "$1/$2/$3");
}

function extractRegNoForDisplay(rawRegNo) {
  // Raw format is Type-RegNo-Suffix, e.g. "4-0212225-000" where the leading
  // digit is the document type (1/2 patent, 3 design, 4 trademark) and the
  // trailing segment is a suffix/check code. Only the middle segment is the
  // actual registration number.
  const text = String(rawRegNo || "").trim();
  const parts = text.split("-");
  const regNo = parts.length === 3 ? parts[1] : text;
  return regNo.replace(/^0+(?=\d)/, "");
}

function splitRegNoAndDateForDisplay(rawValue) {
  const text = normalizeDotDatesForDisplay(rawValue).trim();
  const match = text.match(/^(\S+)\s+(\d{2}\/\d{2}\/\d{4})$/);
  if (match) {
    return { regNo: extractRegNoForDisplay(match[1]), regDate: match[2] };
  }
  return { regNo: text, regDate: "" };
}

function renderOutputTable(content) {
  hideImagePreview();
  const previousLeft = outputViewport.scrollLeft;
  const previousTop = outputViewport.scrollTop;

  const lines = String(content || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const headerLine = lines.find((line) => line.startsWith("ID\t"));
  const headerColumnsRaw = headerLine ? headerLine.split("\t") : [];
  const primaryMarkNameColIndex = headerColumnsRaw.findIndex((h) => /^\(541\)/.test(String(h || "").trim()));
  const fallbackMarkNameColIndex = headerColumnsRaw.findIndex((h) => /^\(571\)/.test(String(h || "").trim()));
  const regNoDateColIndex = headerColumnsRaw.findIndex((h) => /Số bằng và ngày cấp/.test(String(h || "")));

  const showThumbnails = isCurrentOutputTrademarkFile();
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
      const isHeaderRow = line.startsWith("ID\t");
      const columns = line.split("\t");

      const deleteTd = document.createElement("td");
      deleteTd.className = "delete-cell";
      if (isHeaderRow) {
        deleteTd.textContent = "";
      } else {
        const applicationNo = (columns[0] || "").trim();
        tr.dataset.id = applicationNo;
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "row-delete-btn";
        deleteBtn.type = "button";
        deleteBtn.title = "Delete this entry so the next run re-scrapes it";
        deleteBtn.textContent = "\u{1F5D1}️";
        deleteTd.appendChild(deleteBtn);
      }
      tr.appendChild(deleteTd);

      if (showThumbnails) {
        const thumbTd = document.createElement("td");
        thumbTd.className = "thumbnail-cell";

        if (isHeaderRow) {
          thumbTd.textContent = "Thumbnail";
        } else {
          const applicationNo = columns[0] || "";
          const savedImagePath = columns[1] || "";
          const markName = [primaryMarkNameColIndex, fallbackMarkNameColIndex]
            .filter((index) => index >= 0)
            .map((index) => String(columns[index] || "").replace(/^\(\s*VI\s*\)\s*/i, "").trim())
            .find(Boolean) || "";
          const emptyImageText = markName || "No image";
          const isMadridImage = /^5-/.test(String(applicationNo).trim()) && savedImagePath.trim() && savedImagePath.trim().toLowerCase() !== "no image";
          const thumbnailUrl = buildTrademarkThumbnailUrl(applicationNo, savedImagePath);

          if (isMadridImage) {
            const img = document.createElement("img");
            img.className = "thumbnail-img";
            img.loading = "lazy";
            img.alt = applicationNo;
            img.addEventListener("error", () => {
              img.replaceWith(
                Object.assign(document.createElement("span"), {
                  className: "thumbnail-placeholder",
                  textContent: emptyImageText,
                })
              );
            });
            thumbTd.appendChild(img);
            window.wipoGui.readLocalImage({ path: savedImagePath }).then((result) => {
              if (result && result.ok && result.dataUrl) {
                img.src = result.dataUrl;
              } else if (img.isConnected) {
                img.dispatchEvent(new Event("error"));
              }
            }).catch(() => {
              if (img.isConnected) img.dispatchEvent(new Event("error"));
            });
          } else if (thumbnailUrl) {
            const img = document.createElement("img");
            img.className = "thumbnail-img";
            img.loading = "lazy";
            img.src = thumbnailUrl;
            img.alt = applicationNo;
            img.addEventListener("error", () => {
              img.replaceWith(
                Object.assign(document.createElement("span"), {
                  className: "thumbnail-placeholder",
                  textContent: emptyImageText,
                })
              );
            });
            thumbTd.appendChild(img);
          } else {
            const placeholder = document.createElement("span");
            placeholder.className = "thumbnail-placeholder";
            placeholder.textContent = emptyImageText;
            thumbTd.appendChild(placeholder);
          }
        }

        tr.appendChild(thumbTd);
      }

      let displayColumns;
      if (isHeaderRow) {
        displayColumns = columns.slice();
        if (regNoDateColIndex >= 0) {
          displayColumns.splice(regNoDateColIndex, 1, "Reg. No.", "Reg. Date (dd/mm/yyyy)");
        }
      } else {
        displayColumns = columns.map((value) => normalizeDotDatesForDisplay(value));
        if (regNoDateColIndex >= 0) {
          const { regNo, regDate } = splitRegNoAndDateForDisplay(columns[regNoDateColIndex]);
          displayColumns.splice(regNoDateColIndex, 1, regNo, regDate);
        }
      }

      for (const col of displayColumns) {
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

toggleDeleteModeButton.addEventListener("click", () => {
  setDeleteMode(!deleteModeActive);
});

async function deleteOutputRow(applicationNo, trElement) {
  const dateFolder = outputDateSelect.value;
  const fileName = outputFileSelect.value;

  if (!dateFolder || !fileName || !applicationNo) {
    return;
  }

  trElement.classList.add("row-deleting");

  try {
    const result = await window.wipoGui.deleteEntries({
      dateFolder,
      fileName,
      ids: [applicationNo],
    });

    if (!result.ok) {
      appendLog(`\n[GUI] Failed to delete ${applicationNo}: ${result.error}\n`);
      trElement.classList.remove("row-deleting");
      return;
    }

    appendLog(
      `\n[GUI] Deleted ${applicationNo} from ${dateFolder}/${fileName} ` +
        `(${result.removedRows} row, ${result.removedJsonEntries} JSON record).\n`
    );
    trElement.remove();
  } catch (error) {
    appendLog(`\n[GUI] Failed to delete ${applicationNo}: ${error.message}\n`);
    trElement.classList.remove("row-deleting");
  }
}

outputTableBody.addEventListener("click", (event) => {
  if (!deleteModeActive) {
    return;
  }

  const deleteBtn = event.target.closest(".row-delete-btn");
  if (!deleteBtn) {
    return;
  }

  const tr = deleteBtn.closest("tr");
  const applicationNo = tr ? tr.dataset.id : "";
  if (!applicationNo) {
    return;
  }

  deleteOutputRow(applicationNo, tr);
});

outputTableBody.addEventListener("mouseover", (event) => {
  const thumbnailImg = event.target.closest(".thumbnail-img");
  if (thumbnailImg) {
    showImagePreview(thumbnailImg);
  }
});

outputTableBody.addEventListener("mouseout", (event) => {
  const thumbnailImg = event.target.closest(".thumbnail-img");
  if (thumbnailImg) {
    hideImagePreview();
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

async function fetchTrademarkImageBytes(applicationNo) {
  const url = buildTrademarkThumbnailUrl(applicationNo);
  if (!url) {
    return null;
  }

  try {
    // Uses the renderer's own (Chromium) network stack, the same path the
    // live thumbnail <img> previews already use successfully -- unlike the
    // main process's Node/undici fetch, which fails against this host.
    const response = await fetch(url, { headers: { Accept: "image/*" } });
    if (!response.ok) {
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return { applicationNo, bytes: new Uint8Array(arrayBuffer) };
  } catch (error) {
    return null;
  }
}

function collectApplicationNosFromOutput(content) {
  return String(content || "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("ID\t"))
    .map((line) => (line.split("\t")[0] || "").trim())
    .filter(Boolean);
}

exportExcelButton.addEventListener("click", async () => {
  const dateFolder = outputDateSelect.value;
  const fileName = outputFileSelect.value;

  if (!dateFolder || !fileName) {
    appendLog("\n[GUI] No output file selected to export.\n");
    return;
  }

  exportExcelButton.disabled = true;
  const originalLabel = exportExcelButton.textContent;

  try {
    const images = [];

    if (/^nh_wipo_/i.test(fileName)) {
      const applicationNos = collectApplicationNosFromOutput(currentOutputContent);
      let fetched = 0;

      for (const applicationNo of applicationNos) {
        exportExcelButton.textContent = `Fetching images ${fetched + 1}/${applicationNos.length}...`;
        const image = await fetchTrademarkImageBytes(applicationNo);
        if (image) {
          images.push(image);
        }
        fetched += 1;
      }

      appendLog(`\n[GUI] Fetched ${images.length}/${applicationNos.length} trademark images for export.\n`);
    }

    exportExcelButton.textContent = "Exporting...";

    const result = await window.wipoGui.exportExcel({ dateFolder, fileName, images });
    if (result.canceled) {
      appendLog("\n[GUI] Excel export canceled.\n");
    } else if (!result.ok) {
      appendLog(`\n[GUI] Excel export failed: ${result.error}\n`);
    } else {
      appendLog(`\n[GUI] Exported ${dateFolder}/${fileName} to ${result.path}\n`);
    }
  } catch (error) {
    appendLog(`\n[GUI] Excel export failed: ${error.message}\n`);
  } finally {
    exportExcelButton.disabled = false;
    exportExcelButton.textContent = originalLabel;
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
setDeleteMode(false);
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
