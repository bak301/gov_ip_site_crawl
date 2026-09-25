const $ = (id) => document.getElementById(id);
const els = {
  workspace: document.querySelector(".workspace"), casePanel: document.querySelector(".case-panel"), workspaceResizer: $("workspaceResizer"), compactList: $("compactListButton"),
  databaseStatus: $("databaseStatus"), preset: $("presetSelect"), retryCount: $("retryCountInput"), typographyButton: $("typographySettingsButton"), reScrape: $("rescrapeCheckbox"), stop: $("stopButton"), scrapeAll: $("scrapeAllButton"), refreshAll: $("refreshAllButton"),
  input: $("applicationInput"), add: $("addButton"),
  namedListSelect: $("namedListSelect"), namedListName: $("namedListName"), addNamedList: $("addNamedListButton"), renameNamedList: $("renameNamedListButton"), removeNamedList: $("removeNamedListButton"),
  removeListModal: $("removeListModal"), removeListMessage: $("removeListMessage"), removeListInput: $("removeListInput"), closeRemoveList: $("closeRemoveListButton"), cancelRemoveList: $("cancelRemoveListButton"), confirmRemoveList: $("confirmRemoveListButton"),
  list: $("caseList"), emptyList: $("emptyList"), exportList: $("exportListButton"),
  clearAll: $("clearAllButton"), clearAllModal: $("clearAllModal"), clearAllInput: $("clearAllInput"), clearAllInputReset: $("clearAllInputReset"),
  closeClearAll: $("closeClearAllButton"), cancelClearAll: $("cancelClearAllButton"), confirmClearAll: $("confirmClearAllButton"),
  selectAllHead: $("selectAllHead"), selectAll: $("selectAllCheckbox"), detailEmpty: $("detailEmpty"), detailContent: $("detailContent"),
  detailNo: $("detailApplicationNo"), detailCaseRef: $("detailCaseRef"), detailType: $("detailRecordType"), detailStatus: $("detailStatus"), publicationA: $("publicationAButton"), publicationB: $("publicationBButton"), annuity: $("annuityButton"), scrapeOne: $("scrapeOneButton"),
  exportOne: $("exportOneButton"), printPdf: $("printPdfButton"), downloadPdf: $("downloadPdfButton"), snapshot: $("snapshotSelect"), changeSummary: $("changeSummary"), fields: $("fieldGrid"),
  printReportNo: $("printReportApplicationNo"), printReportType: $("printReportType"), printReportStatus: $("printReportStatus"), printReportSnapshot: $("printReportSnapshot"),
  recordMedia: $("recordMedia"), structured: $("structuredDetails"), timeline: $("timeline"), timelineCount: $("timelineCount"), runStatus: $("runStatus"), toggleLog: $("toggleLogButton"),
  logDrawer: $("logDrawer"), log: $("logOutput"), toast: $("toast"),
  publicationModal: $("publicationModal"), publicationTitle: $("publicationModalTitle"), publicationMeta: $("publicationModalMeta"),
  publicationPages: $("publicationPages"), publicationLoading: $("publicationLoading"), closePublicationModal: $("closePublicationModalButton"), publicationTabs: $("publicationTabs"), publicationDocumentSelect: $("publicationDocumentSelect"),
  typographyModal: $("typographyModal"), closeTypography: $("closeTypographyButton"), saveTypography: $("saveTypographyButton"), resetTypography: $("resetTypographyButton"),
  interfaceFont: $("interfaceFontSelect"), headerFont: $("headerFontSelect"), contentFont: $("contentFontSelect"),
  interfaceFontSize: $("interfaceFontSize"), headerFontSize: $("headerFontSize"), contentFontSize: $("contentFontSize"),
};

const state = {
  queue: [], records: new Map(), selected: "", detail: null, exportMode: false, exportSelection: new Set(), running: false,
  namedLists: [], activeListId: "default", caseRefsByApplication: {}, lookedUpCaseRefs: {}, maybeUnpublished: new Set(), listRequestToken: 0, lookupRestartNotified: false,
  scrapingIds: new Set(),
  publicationDocuments: [], publicationCategory: "publication_a", publicationCache: new Map(), publicationRequestToken: 0,
};
let toastTimer;
let publicationReturnFocus = null;
let recordRefreshChain = Promise.resolve();
let removeListTargetId = "";
let headerSyncPending = false;

function syncPanelHeaders() {
  const detailHeading = document.querySelector(".detail-heading");
  document.documentElement.style.setProperty("--pane-header-height", "56px");
  const height = Math.ceil(Math.max(56, els.casePanel.querySelector(".panel-header").getBoundingClientRect().height, detailHeading.getBoundingClientRect().height));
  document.documentElement.style.setProperty("--pane-header-height", `${height}px`);
}

function schedulePanelHeaderSync() {
  if (headerSyncPending) return;
  headerSyncPending = true;
  const update = () => {
    headerSyncPending = false;
    syncPanelHeaders();
  };
  if (window.requestAnimationFrame) window.requestAnimationFrame(update);
  else window.setTimeout(update, 0);
}

function syncListHeaderGutter() {
  const width = Math.max(0, els.list.offsetWidth - els.list.clientWidth);
  els.casePanel.style.setProperty("--case-scrollbar-width", `${width}px`);
}

function resizeApplicationInput() {
  els.input.style.height = "38px";
  const contentHeight = els.input.scrollHeight || 38;
  els.input.style.height = `${Math.min(180, Math.max(38, contentHeight))}px`;
  els.input.style.overflowY = contentHeight > 180 ? "auto" : "hidden";
}

const FONT_FAMILIES = {
  segoe: '"Segoe UI", Arial, sans-serif',
  arial: 'Arial, sans-serif',
  calibri: 'Calibri, "Segoe UI", sans-serif',
  times: '"Times New Roman", Times, serif',
  georgia: 'Georgia, "Times New Roman", serif',
  verdana: 'Verdana, Arial, sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
  trebuchet: '"Trebuchet MS", Arial, sans-serif',
  cambria: 'Cambria, Georgia, serif',
  garamond: 'Garamond, Georgia, serif',
  courier: '"Courier New", Consolas, monospace',
};

const FONT_LABELS = {
  segoe: "Segoe UI", arial: "Arial", calibri: "Calibri", times: "Times New Roman", georgia: "Georgia", verdana: "Verdana",
  tahoma: "Tahoma", trebuchet: "Trebuchet MS", cambria: "Cambria", garamond: "Garamond", courier: "Courier New",
};

const TYPOGRAPHY_DEFAULTS = {
  interfaceFont: "segoe", headerFont: "segoe", contentFont: "segoe",
  interfaceSize: 13, headerSize: 16, contentSize: 13,
};

function normalize(value) {
  const text = String(value || "").trim().toUpperCase();
  const match = text.match(/[1-5]-\d{4}-\d{4,}/);
  if (match) return match[0];
  const compact = text.match(/(?:^|\W)(?:VN)?([1-5])(\d{4})(\d{4,})(?:\W|$)/i);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : "";
}

function parseInput(value) {
  const text = String(value || "");
  const found = [...(text.match(/[1-5]-\d{4}-\d{4,}/g) || [])];
  for (const match of text.matchAll(/\b(?:VN)?([1-5])(\d{4})(\d{4,})\b/gi)) found.push(`${match[1]}-${match[2]}-${match[3]}`);
  return [...new Set(found.map(normalize).filter(Boolean))];
}

function parseCaseRefs(value) {
  return [...new Set((String(value || "").match(/\bIP[\/\\-]PR\s*\d+(?:\/[A-Z0-9]+)?/gi) || [])
    .map((ref) => ref.toUpperCase().replace(/\s+/g, "").replace(/^IP-PR/, "IP/PR")))];
}

function recordKind(applicationNo, data = null) {
  const prefix = String(applicationNo || data?.id || "").match(/^([1-5])-/)?.[1];
  if (prefix === "5") return "international_trademark";
  if (prefix === "3" || String(data?.type || "").toUpperCase() === "DESIGNS") return "design";
  if (prefix === "4" || String(data?.type || "").toUpperCase() === "TRADEMARKS") return "trademark";
  return "patent";
}

function recordKindLabel(kind) {
  return ({ patent: "Patent", design: "Industrial design", trademark: "Trademark", international_trademark: "International trademark" })[kind] || "Record";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function saveNamedLists() {
  const active = state.namedLists.find((list) => list.id === state.activeListId);
  if (active) {
    active.queue = [...state.queue];
    active.refsByApplication = Object.fromEntries(Object.entries(state.caseRefsByApplication)
      .filter(([appNo, refs]) => state.queue.includes(appNo) && Array.isArray(refs) && refs.length));
    active.maybeUnpublished = [...state.maybeUnpublished].filter((appNo) => state.queue.includes(appNo));
  }
  localStorage.setItem("wipoTrackerNamedLists", JSON.stringify({ activeId: state.activeListId, lists: state.namedLists }));
  localStorage.setItem("wipoTrackerQueue", JSON.stringify(state.queue));
}

function saveQueue() { saveNamedLists(); }

function loadNamedLists() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem("wipoTrackerNamedLists") || "null"); } catch { saved = null; }
  let legacyQueue = [];
  try { legacyQueue = JSON.parse(localStorage.getItem("wipoTrackerQueue") || "[]"); } catch {}
  const normalizeQueue = (queue) => [...new Set((Array.isArray(queue) ? queue : []).map(normalize).filter(Boolean))];
  const normalizeRefs = (refs, queue) => Object.fromEntries(Object.entries(refs && typeof refs === "object" ? refs : {})
    .filter(([appNo]) => queue.includes(normalize(appNo)))
    .map(([appNo, values]) => [normalize(appNo), parseCaseRefs(Array.isArray(values) ? values.join("\n") : values)]));
  const lists = Array.isArray(saved?.lists) ? saved.lists
    .filter((list) => list && typeof list.id === "string" && typeof list.name === "string")
    .map((list) => { const queue = normalizeQueue(list.queue); return { id: list.id, name: list.name.trim().slice(0, 60) || "Untitled list", queue, refsByApplication: normalizeRefs(list.refsByApplication, queue), maybeUnpublished: (Array.isArray(list.maybeUnpublished) ? list.maybeUnpublished : []).map(normalize).filter((appNo) => queue.includes(appNo)) }; }) : [];
  state.namedLists = lists.length ? lists : [{ id: "default", name: "Default list", queue: normalizeQueue(legacyQueue), refsByApplication: {}, maybeUnpublished: [] }];
  state.activeListId = state.namedLists.some((list) => list.id === saved?.activeId) ? saved.activeId : state.namedLists[0].id;
  const activeList = state.namedLists.find((list) => list.id === state.activeListId);
  state.queue = [...activeList.queue];
  state.caseRefsByApplication = { ...activeList.refsByApplication };
  state.maybeUnpublished = new Set(activeList.maybeUnpublished);
  renderNamedLists();
  saveNamedLists();
}

function renderNamedLists() {
  els.namedListSelect.replaceChildren();
  for (const list of state.namedLists) {
    const option = document.createElement("option");
    option.value = list.id;
    option.textContent = list.name;
    els.namedListSelect.appendChild(option);
  }
  els.namedListSelect.value = state.activeListId;
}

function beginRenameList() {
  const active = state.namedLists.find((list) => list.id === state.activeListId);
  if (!active || state.running) return;
  els.namedListName.value = active.name;
  els.namedListSelect.classList.add("hidden");
  els.namedListName.classList.remove("hidden");
  els.renameNamedList.textContent = "✓";
  els.renameNamedList.setAttribute("aria-label", "Save case list name");
  els.namedListName.focus();
  els.namedListName.select();
}

function endRenameList(save) {
  if (save) {
    const name = els.namedListName.value.trim();
    if (!name) { showToast("Enter a name for this list.", true); els.namedListName.focus(); return; }
    const active = state.namedLists.find((list) => list.id === state.activeListId);
    if (active) active.name = name.slice(0, 60);
    saveNamedLists();
    renderNamedLists();
  }
  els.namedListName.classList.add("hidden");
  els.namedListSelect.classList.remove("hidden");
  els.renameNamedList.innerHTML = '<span class="named-list-icon icon-pencil" aria-hidden="true"></span>';
  els.renameNamedList.setAttribute("aria-label", "Rename selected case list");
  els.namedListSelect.focus();
}

async function selectNamedList(id) {
  if (state.running || !state.namedLists.some((list) => list.id === id)) return;
  saveNamedLists();
  state.activeListId = id;
  const selectedList = state.namedLists.find((list) => list.id === id);
  state.queue = [...selectedList.queue];
  state.caseRefsByApplication = { ...selectedList.refsByApplication };
  state.lookedUpCaseRefs = {};
  state.maybeUnpublished = new Set(selectedList.maybeUnpublished);
  state.selected = "";
  state.detail = null;
  state.records = new Map();
  state.exportMode = false;
  state.exportSelection.clear();
  els.detailContent.classList.add("hidden");
  els.detailEmpty.classList.remove("hidden");
  saveNamedLists();
  renderNamedLists();
  await refreshList();
}

function addNamedList() {
  if (state.running) return;
  const names = new Set(state.namedLists.map((list) => list.name));
  let number = state.namedLists.length + 1;
  while (names.has(`New list ${number}`)) number += 1;
  const id = `list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.namedLists.push({ id, name: `New list ${number}`, queue: [], refsByApplication: {}, maybeUnpublished: [] });
  selectNamedList(id).then(beginRenameList).catch((error) => showToast(error.message, true));
}

function openRemoveListModal() {
  if (state.running || !els.namedListName.classList.contains("hidden")) return;
  const active = state.namedLists.find((list) => list.id === state.activeListId);
  if (!active) return;
  removeListTargetId = active.id;
  els.removeListMessage.textContent = `Remove “${active.name}” and its ${active.queue.length} application${active.queue.length === 1 ? "" : "s"} from saved lists?`;
  els.removeListInput.value = "";
  els.confirmRemoveList.disabled = true;
  els.removeListModal.classList.remove("hidden");
  els.removeListInput.focus();
}

function closeRemoveListModal() {
  els.removeListModal.classList.add("hidden");
  els.removeListInput.value = "";
  els.confirmRemoveList.disabled = true;
  removeListTargetId = "";
  els.removeNamedList.focus();
}

async function confirmRemoveList() {
  if (state.running || els.removeListInput.value.trim().toLowerCase() !== "remove" || removeListTargetId !== state.activeListId) return;
  saveNamedLists();
  const index = state.namedLists.findIndex((list) => list.id === removeListTargetId);
  if (index < 0) return;
  const removedName = state.namedLists[index].name;
  state.namedLists.splice(index, 1);
  if (!state.namedLists.length) state.namedLists.push({ id: `list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: "Default list", queue: [], refsByApplication: {}, maybeUnpublished: [] });
  const next = state.namedLists[Math.min(index, state.namedLists.length - 1)];
  closeRemoveListModal();
  await selectNamedList(next.id);
  showToast(`Removed saved list “${removedName}”. Stored snapshots were not deleted.`);
}

function applyCompactList(compact, persist = true) {
  const enabled = Boolean(compact);
  els.casePanel.classList.toggle("compact-list", enabled);
  els.compactList.setAttribute("aria-pressed", enabled ? "true" : "false");
  els.compactList.querySelector(".list-density-label").textContent = enabled ? "Comfortable" : "Compact";
  const nextMode = enabled ? "comfortable" : "compact";
  els.compactList.title = `Switch to ${nextMode} rows`;
  els.compactList.setAttribute("aria-label", `Switch to ${nextMode} rows`);
  if (persist) localStorage.setItem("wipoTrackerCompactList", enabled ? "1" : "0");
}

function setCasePaneWidth(width, persist = true) {
  const workspaceWidth = els.workspace.getBoundingClientRect().width || window.innerWidth;
  const maximum = Math.max(320, workspaceWidth - 427);
  const bounded = Math.min(maximum, Math.max(320, Math.round(Number(width) || 0)));
  document.documentElement.style.setProperty("--case-pane-width", `${bounded}px`);
  els.workspaceResizer.setAttribute("aria-valuemin", "320");
  els.workspaceResizer.setAttribute("aria-valuemax", String(maximum));
  els.workspaceResizer.setAttribute("aria-valuenow", String(bounded));
  if (persist) localStorage.setItem("wipoTrackerCasePaneWidth", String(bounded));
}

function resetCasePaneWidth() {
  document.documentElement.style.removeProperty("--case-pane-width");
  localStorage.removeItem("wipoTrackerCasePaneWidth");
  const width = els.casePanel.getBoundingClientRect().width;
  els.workspaceResizer.setAttribute("aria-valuenow", String(Math.round(width)));
}

function initializeWorkspaceResizer() {
  const storedWidth = Number.parseInt(localStorage.getItem("wipoTrackerCasePaneWidth") || "", 10);
  if (Number.isFinite(storedWidth)) setCasePaneWidth(storedWidth, false);
  let startX = 0;
  let startWidth = 0;
  els.workspaceResizer.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startWidth = els.casePanel.getBoundingClientRect().width;
    document.body.classList.add("resizing-workspace");
    els.workspaceResizer.setPointerCapture?.(event.pointerId);
  });
  els.workspaceResizer.addEventListener("pointermove", (event) => {
    if (!document.body.classList.contains("resizing-workspace")) return;
    setCasePaneWidth(startWidth + event.clientX - startX);
  });
  const stopResize = (event) => {
    if (!document.body.classList.contains("resizing-workspace")) return;
    document.body.classList.remove("resizing-workspace");
    els.workspaceResizer.releasePointerCapture?.(event.pointerId);
  };
  els.workspaceResizer.addEventListener("pointerup", stopResize);
  els.workspaceResizer.addEventListener("pointercancel", stopResize);
  els.workspaceResizer.addEventListener("dblclick", resetCasePaneWidth);
  els.workspaceResizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = els.casePanel.getBoundingClientRect().width;
    setCasePaneWidth(current + (event.key === "ArrowRight" ? 20 : -20));
  });
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isNaN(number) ? fallback : Math.min(maximum, Math.max(minimum, number));
}

function normalizeTypography(settings = {}) {
  const font = (value, fallback) => Object.hasOwn(FONT_FAMILIES, value) ? value : fallback;
  return {
    interfaceFont: font(settings.interfaceFont, TYPOGRAPHY_DEFAULTS.interfaceFont),
    headerFont: font(settings.headerFont, TYPOGRAPHY_DEFAULTS.headerFont),
    contentFont: font(settings.contentFont, TYPOGRAPHY_DEFAULTS.contentFont),
    interfaceSize: boundedNumber(settings.interfaceSize, 10, 20, TYPOGRAPHY_DEFAULTS.interfaceSize),
    headerSize: boundedNumber(settings.headerSize, 12, 32, TYPOGRAPHY_DEFAULTS.headerSize),
    contentSize: boundedNumber(settings.contentSize, 9, 24, TYPOGRAPHY_DEFAULTS.contentSize),
  };
}

function typographyFromControls() {
  return normalizeTypography({
    interfaceFont: els.interfaceFont.value, headerFont: els.headerFont.value, contentFont: els.contentFont.value,
    interfaceSize: els.interfaceFontSize.value, headerSize: els.headerFontSize.value, contentSize: els.contentFontSize.value,
  });
}

function applyTypography(settings, persist = true) {
  const value = normalizeTypography(settings);
  const root = document.documentElement.style;
  root.setProperty("--ui-font", FONT_FAMILIES[value.interfaceFont]);
  root.setProperty("--header-font", FONT_FAMILIES[value.headerFont]);
  root.setProperty("--content-font", FONT_FAMILIES[value.contentFont]);
  root.setProperty("--interface-scale", String(value.interfaceSize / TYPOGRAPHY_DEFAULTS.interfaceSize));
  root.setProperty("--header-scale", String(value.headerSize / TYPOGRAPHY_DEFAULTS.headerSize));
  root.setProperty("--content-scale", String(value.contentSize / TYPOGRAPHY_DEFAULTS.contentSize));
  els.interfaceFont.value = value.interfaceFont;
  els.headerFont.value = value.headerFont;
  els.contentFont.value = value.contentFont;
  els.interfaceFontSize.value = String(value.interfaceSize);
  els.headerFontSize.value = String(value.headerSize);
  els.contentFontSize.value = String(value.contentSize);
  resizeApplicationInput();
  if (persist) localStorage.setItem("wipoTrackerTypography", JSON.stringify(value));
}

function loadTypography() {
  try {
    const saved = JSON.parse(localStorage.getItem("wipoTrackerTypography") || "null");
    if (saved) return normalizeTypography(saved);
  } catch {}
  const legacyFont = localStorage.getItem("wipoTrackerFont");
  return normalizeTypography(legacyFont ? { interfaceFont: legacyFont, headerFont: legacyFont, contentFont: legacyFont } : TYPOGRAPHY_DEFAULTS);
}

function openTypographyModal() {
  els.typographyModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.interfaceFont.focus();
}

function closeTypographyModal() {
  els.typographyModal.classList.add("hidden");
  if (els.publicationModal.classList.contains("hidden") && els.clearAllModal.classList.contains("hidden")) document.body.classList.remove("modal-open");
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.className = `toast${error ? " error" : ""}`;
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 3400);
}

function closePublicationModal() {
  els.publicationModal.classList.add("hidden");
  window.publicationViewer?.clear();
  els.publicationLoading.classList.remove("hidden");
  document.body.classList.remove("modal-open");
  publicationReturnFocus?.focus?.();
  publicationReturnFocus = null;
}

function showPublicationModal(applicationNo) {
  publicationReturnFocus = document.activeElement;
  els.publicationTitle.textContent = `${applicationNo} publication`;
  els.publicationMeta.textContent = "Resolving publication PDF…";
  els.publicationLoading.textContent = "Loading publication PDF…";
  els.publicationLoading.classList.remove("hidden");
  els.publicationDocumentSelect.classList.add("hidden");
  els.publicationTabs.querySelectorAll("[data-publication-category]").forEach((button) => { button.disabled = true; button.classList.remove("active"); button.querySelector("span").textContent = "0"; });
  els.publicationModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.closePublicationModal.focus();
}

async function getPublicationViewer() {
  if (window.publicationViewer) return window.publicationViewer;
  await new Promise((resolve) => window.addEventListener("publication-viewer-ready", resolve, { once: true }));
  return window.publicationViewer;
}

async function loadPublicationInModal(result) {
  const details = [result.requestNo || result.publicationNo || result.applicationNo, result.pages ? `Pages ${result.pages}` : (result.page ? `Page ${result.page}` : ""), result.cbNumber ? `CB ${result.cbNumber} ${result.volume || ""}${result.book || ""}` : "", result.sourceFile].filter(Boolean);
  els.publicationMeta.textContent = details.join(" · ") || "Publication PDF";
  els.publicationLoading.textContent = "Rendering first page…";
  els.publicationLoading.classList.remove("hidden");
  try {
    await (await getPublicationViewer()).render(result.url);
    els.publicationLoading.classList.add("hidden");
  } catch (error) {
    els.publicationLoading.textContent = `Unable to render PDF: ${error.message}`;
  }
}

function selectPublicationCategory(category) {
  const documents = state.publicationDocuments.filter((item) => item.category === category);
  if (!documents.length) return;
  state.publicationCategory = category;
  els.publicationTabs.querySelectorAll("[data-publication-category]").forEach((button) => button.classList.toggle("active", button.dataset.publicationCategory === category));
  els.publicationDocumentSelect.innerHTML = documents.map((item, index) => `<option value="${index}">${escapeHtml([item.requestNo || item.publicationNo || item.lookupKey, item.cbNumber ? `CB ${item.cbNumber}` : "", item.generatedAt ? new Date(item.generatedAt).toLocaleDateString() : ""].filter(Boolean).join(" · "))}</option>`).join("");
  els.publicationDocumentSelect.classList.toggle("hidden", documents.length < 2);
  loadPublicationInModal(documents[0]);
}

function loadPublicationDocuments(result, preferredCategory = "") {
  state.publicationDocuments = Array.isArray(result.documents) ? result.documents : [];
  for (const button of els.publicationTabs.querySelectorAll("[data-publication-category]")) {
    const count = state.publicationDocuments.filter((item) => item.category === button.dataset.publicationCategory).length;
    button.disabled = count === 0;
    button.querySelector("span").textContent = String(count);
  }
  const first = [preferredCategory, "publication_a", "publication_b", "annuity"].filter(Boolean).find((category) => state.publicationDocuments.some((item) => item.category === category));
  if (!first) throw new Error("No prepared publication PDF is available for this record.");
  selectPublicationCategory(first);
}

const publicationButtons = () => [els.publicationA, els.publicationB, els.annuity];

function updatePublicationButtons(result = null, loading = false) {
  const documents = result?.ok && Array.isArray(result.documents) ? result.documents : [];
  for (const button of publicationButtons()) {
    const count = documents.filter((item) => item.category === button.dataset.publicationCategory).length;
    button.disabled = loading || count === 0;
    button.querySelector(".publication-count").textContent = loading ? "…" : (count ? String(count) : "0");
    button.title = loading ? "Checking Publication Workbench…" : (count ? `${count} prepared document${count === 1 ? "" : "s"}` : "No prepared document found");
  }
}

async function lookupPublications(applicationNo) {
  const cached = state.publicationCache.get(applicationNo);
  if (cached && Date.now() - cached.createdAt < 15000) return cached.promise;
  const request = window.wipoTracker.openPublicationPdf(applicationNo, currentRegistrationNumber());
  state.publicationCache.set(applicationNo, { createdAt: Date.now(), promise: request });
  return request;
}

async function prefetchPublications(applicationNo) {
  const token = ++state.publicationRequestToken;
  updatePublicationButtons(null, true);
  const result = await lookupPublications(applicationNo);
  if (token === state.publicationRequestToken && state.selected === applicationNo) updatePublicationButtons(result);
  return result;
}

async function openPublicationCategory(category) {
  if (!state.selected) return;
  const applicationNo = state.selected;
  showPublicationModal(applicationNo);
  const result = await lookupPublications(applicationNo);
  if (state.selected !== applicationNo) return closePublicationModal();
  if (result?.ok && result.documents?.length) loadPublicationDocuments(result, category);
  else {
    const message = result?.error || "No prepared publication PDF is available for this record.";
    els.publicationMeta.textContent = message;
    els.publicationLoading.textContent = message;
    showToast(message, true);
  }
}

function currentRegistrationNumber() {
  const data = state.detail?.latest?.data || state.detail?.current?.data || state.detail?.data || state.detail?.current || {};
  return data?.split_fields?.grant_number_date?.number || data?.fields?.grant_number_date?.number || "";
}

function scrapeAgeDays(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const scrapedDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(0, Math.floor((todayDay - scrapedDay) / 86400000));
}

function ageText(iso) {
  const days = scrapeAgeDays(iso);
  if (days === null) return "Not scraped";
  return days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
}

function scrapeAgeClass(iso) {
  const days = scrapeAgeDays(iso);
  if (days === 0) return "scrape-today";
  if (days !== null && days < 5) return "scrape-recent";
  return "scrape-stale";
}

const MAYBE_UNPUBLISHED_HINT = "The scrape did not return this application and no Publication A record was found in the local publication database. It may not yet be published; please verify with the source.";

async function updateFailedPublicationStatuses(missing, imported = []) {
  for (const item of imported) state.maybeUnpublished.delete(normalize(item.applicationNo || item));
  const failures = [...new Set((missing || []).map(normalize).filter((appNo) => state.queue.includes(appNo)))];
  let cursor = 0;
  const check = async () => {
    while (cursor < failures.length) {
      const appNo = failures[cursor++];
      state.maybeUnpublished.delete(appNo);
      if (recordKind(appNo) !== "patent") continue;
      try {
        const result = await window.wipoTracker.checkPublicationA(appNo);
        if (result?.ok && result.hasPublicationA === false) state.maybeUnpublished.add(appNo);
      } catch { /* An unavailable publication lookup must not imply unpublished. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, failures.length) }, check));
  saveQueue();
  renderList();
  if (state.selected && !state.detail) renderDetailStatus();
}

function renderDetailStatus() {
  const candidate = state.maybeUnpublished.has(state.selected) && !state.detail;
  els.detailStatus.textContent = candidate ? "Not yet published?" : "Not scraped";
  els.detailStatus.title = candidate ? MAYBE_UNPUBLISHED_HINT : "";
  els.detailStatus.classList.toggle("maybe-unpublished", candidate);
  const statusMessage = els.fields.querySelector(".field-card.wide .field-value");
  if (statusMessage) statusMessage.textContent = candidate
    ? "The scrape did not return this application, and no Publication A record was found in the local database. It may not yet be published."
    : "This application is in your list but has not been scraped into the local database.";
}

function selectedRetryCount() {
  const parsed = Number.parseInt(els.retryCount.value, 10);
  return Number.isFinite(parsed) ? Math.min(50, Math.max(0, parsed)) : 10;
}

function formatDate(iso, withTime = true) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  if (!withTime) return `${day}/${month}/${year}`;
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
}

function setRunning(running) {
  state.running = running;
  els.scrapeAll.disabled = running || !state.queue.length;
  els.refreshAll.disabled = running || !state.queue.length;
  els.stop.disabled = !running;
  els.add.disabled = running;
  els.reScrape.disabled = running;
  els.retryCount.disabled = running;
  els.scrapeOne.disabled = running;
  els.namedListSelect.disabled = running;
  els.addNamedList.disabled = running;
  els.renameNamedList.disabled = running;
  els.removeNamedList.disabled = running;
}

function setRunStatus(message, kind = "ready") {
  els.runStatus.innerHTML = `<span class="status-dot ${kind === "ready" ? "ready" : ""}"></span>${escapeHtml(message)}`;
}

function appendLog(message) {
  const cleaned = String(message || "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");
  els.log.textContent += cleaned;
  els.log.scrollTop = els.log.scrollHeight;
}

function addApplications(ids, refsByApplication = {}) {
  let added = 0;
  for (const id of ids) if (id && !state.queue.includes(id)) { state.queue.push(id); added += 1; }
  for (const [appNo, refs] of Object.entries(refsByApplication)) {
    if (!state.queue.includes(appNo)) continue;
    state.caseRefsByApplication[appNo] = [...new Set([...(state.caseRefsByApplication[appNo] || []), ...parseCaseRefs(refs.join("\n"))])];
  }
  saveQueue();
  refreshList();
  if (state.selected) renderDetailCaseRef(state.selected);
  if (added) showToast(`Added ${added} application${added === 1 ? "" : "s"}.`);
  else if (Object.keys(refsByApplication).length) showToast("Case references linked to existing applications.");
  return added;
}

function renderDetailCaseRef(appNo) {
  const refs = caseRefsForApplication(appNo);
  els.detailCaseRef.textContent = refs.length ? `${refs[0]}${refs.length > 1 ? ` +${refs.length - 1}` : ""}` : "";
  els.detailCaseRef.title = refs.join(" · ");
  els.detailCaseRef.classList.toggle("hidden", !refs.length);
}

function caseRefsForApplication(appNo) {
  return [...new Set([...(state.lookedUpCaseRefs[appNo] || []), ...(state.caseRefsByApplication[appNo] || [])])];
}

async function addInputText(value) {
  const applicationNos = parseInput(value);
  const caseRefs = parseCaseRefs(value);
  const refsByApplication = {};
  let missing = [];
  if (caseRefs.length) {
    if (!window.wipoTracker.resolveCaseRefs) throw new Error("IP/PR lookup is not available in this running host. Restart the WipoPublish host.");
    const result = await window.wipoTracker.resolveCaseRefs(caseRefs);
    if (!result?.ok) throw new Error(result?.error || "Could not read the shared Export-PR status.");
    missing = result.missing || [];
    for (const match of result.matches || []) {
      for (const appNo of match.applicationNos || []) {
        const normalized = normalize(appNo);
        if (!normalized) continue;
        applicationNos.push(normalized);
        if (!refsByApplication[normalized]) refsByApplication[normalized] = [];
        refsByApplication[normalized].push(match.caseRef);
      }
    }
  }
  const uniqueApplications = [...new Set(applicationNos)];
  if (!uniqueApplications.length) {
    showToast(missing.length ? `No application number found for ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}.` : "Enter an application number or IP/PR case reference.", true);
    return false;
  }
  addApplications(uniqueApplications, refsByApplication);
  if (missing.length) showToast(`${missing.length} IP/PR reference${missing.length === 1 ? " was" : "s were"} not found in Export-PR status.`, true);
  return true;
}

async function refreshList() {
  const token = ++state.listRequestToken;
  if (!state.queue.length) {
    state.records = new Map();
    state.lookedUpCaseRefs = {};
    renderList();
    return;
  }
  const result = await window.wipoTracker.list(state.queue);
  if (token !== state.listRequestToken) return;
  state.records = new Map((result.applications || []).map((row) => [row.applicationNo, row]));
  renderList();
  if (window.wipoTracker.lookupApplicationRefs) {
    window.wipoTracker.lookupApplicationRefs([...state.queue]).then((lookup) => {
      if (token !== state.listRequestToken || !lookup?.ok) return;
      state.lookupRestartNotified = false;
      state.lookedUpCaseRefs = Object.fromEntries((lookup.matches || []).map((match) => [normalize(match.applicationNo), parseCaseRefs((match.caseRefs || []).join("\n"))]));
      renderList();
      if (state.selected) renderDetailCaseRef(state.selected);
    }).catch((error) => {
      appendLog(`\n[Tracker] Could not look up IP/PR references: ${error.message}\n`);
      if (!state.lookupRestartNotified && /\b404\b/.test(error.message)) {
        state.lookupRestartNotified = true;
        showToast("WipoPublish LAN host needs a restart to show IP/PR references.", true);
      }
    });
  }
  if (state.selected && state.queue.includes(state.selected)) await openDetail(state.selected, true);
}

function refreshCompletedRecord(applicationNo) {
  const appNo = normalize(applicationNo);
  if (!appNo || !state.queue.includes(appNo)) return recordRefreshChain;
  recordRefreshChain = recordRefreshChain.then(async () => {
    const result = await window.wipoTracker.list([appNo]);
    const record = (result.applications || []).find((item) => item.applicationNo === appNo);
    if (record) state.records.set(appNo, record);
    renderList();
    if (state.selected === appNo) await openDetail(appNo, true);
  }).catch((error) => appendLog(`\n[Tracker] Could not refresh ${appNo}: ${error.message}\n`));
  return recordRefreshChain;
}

function renderList() {
  els.emptyList.classList.toggle("hidden", state.queue.length > 0);
  els.list.classList.toggle("hidden", state.queue.length === 0);
  els.selectAllHead.classList.toggle("hidden", !state.exportMode);
  els.selectAllHead.parentElement.classList.toggle("select-mode", state.exportMode);
  const exportLabel = state.exportMode ? `Export selected (${state.exportSelection.size})` : "Export list";
  els.exportList.querySelector(".action-label").textContent = exportLabel;
  els.exportList.title = exportLabel;
  els.exportList.setAttribute("aria-label", exportLabel);
  els.scrapeAll.disabled = state.running || !state.queue.length;
  els.refreshAll.disabled = state.running || !state.queue.length;
  els.clearAll.disabled = state.running || !state.queue.length;
  els.list.innerHTML = state.queue.map((appNo) => {
    const record = state.records.get(appNo);
    const checked = state.exportSelection.has(appNo);
    const ageClass = scrapeAgeClass(record?.lastScrapedAt);
    const maybeUnpublished = state.maybeUnpublished.has(appNo) && !record;
    const isScraping = state.scrapingIds.has(appNo);
    const caseRefs = caseRefsForApplication(appNo);
    const caseRefText = caseRefs.length ? `${caseRefs[0]}${caseRefs.length > 1 ? ` +${caseRefs.length - 1}` : ""}` : "—";
    return `<div class="case-row ${ageClass} ${state.selected === appNo ? "active" : ""} ${state.exportMode ? "select-mode" : ""}" data-app="${escapeHtml(appNo)}">
      <div class="check-slot ${state.exportMode ? "" : "hidden"}"><input class="row-check" type="checkbox" ${checked ? "checked" : ""} aria-label="Select ${escapeHtml(appNo)}"></div>
      <div class="case-app"><span class="case-no">${escapeHtml(appNo)}</span></div>
      <div class="case-ref-cell" title="${escapeHtml(caseRefs.join(" · "))}">${escapeHtml(caseRefText)}</div>
      <div class="case-time"><span class="scraped-at">${record ? formatDate(record.lastScrapedAt) : "—"}</span><span class="age${maybeUnpublished ? " maybe-unpublished" : ""}"${maybeUnpublished ? ` title="${escapeHtml(MAYBE_UNPUBLISHED_HINT)}"` : ""}>${maybeUnpublished ? "Not yet published?" : ageText(record?.lastScrapedAt)}</span>${record?.changeCount ? `<span class="changed-badge">${record.changeCount} changed</span>` : ""}</div>
      <button class="scrape-row${isScraping ? " is-scraping" : ""}" data-scrape="${escapeHtml(appNo)}" title="${isScraping ? "Scraping application" : "Scrape this application"}" aria-label="${isScraping ? "Scraping" : "Scrape"} ${escapeHtml(appNo)}" aria-busy="${isScraping ? "true" : "false"}" ${state.running ? "disabled" : ""}><span class="scrape-row-icon" aria-hidden="true"></span></button>
      <button class="remove-row" data-remove="${escapeHtml(appNo)}" title="Remove from case list" aria-label="Remove ${escapeHtml(appNo)} from case list">x</button>
    </div>`;
  }).join("");
  syncListHeaderGutter();
  els.selectAll.checked = state.queue.length > 0 && state.exportSelection.size === state.queue.length;
  els.list.querySelectorAll(".case-row").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest(".row-check") || event.target.closest(".scrape-row") || event.target.closest(".remove-row")) return;
    openDetail(row.dataset.app);
  }));
  els.list.querySelectorAll(".row-check").forEach((checkbox) => checkbox.addEventListener("change", (event) => {
    const appNo = event.target.closest(".case-row").dataset.app;
    if (event.target.checked) state.exportSelection.add(appNo); else state.exportSelection.delete(appNo);
    renderList();
  }));
  els.list.querySelectorAll(".scrape-row").forEach((button) => button.addEventListener("click", () => scrape([button.dataset.scrape])));
  els.list.querySelectorAll(".remove-row").forEach((button) => button.addEventListener("click", () => removeApplication(button.dataset.remove)));
}

function removeApplication(appNo) {
  state.queue = state.queue.filter((id) => id !== appNo);
  delete state.caseRefsByApplication[appNo];
  delete state.lookedUpCaseRefs[appNo];
  state.maybeUnpublished.delete(appNo);
  state.exportSelection.delete(appNo);
  if (state.selected === appNo) {
    state.selected = "";
    state.detail = null;
    els.detailContent.classList.add("hidden");
    els.detailEmpty.classList.remove("hidden");
  }
  saveQueue();
  renderList();
}

function openClearAllModal() {
  if (!state.queue.length || state.running) return;
  els.clearAllInput.value = "";
  els.confirmClearAll.disabled = true;
  els.clearAllInputReset.classList.add("hidden");
  els.clearAllModal.classList.remove("hidden");
  els.clearAllInput.focus();
}

function closeClearAllModal() {
  els.clearAllModal.classList.add("hidden");
  els.clearAllInput.value = "";
  els.confirmClearAll.disabled = true;
  els.clearAllInputReset.classList.add("hidden");
}

function confirmClearAll() {
  if (els.clearAllInput.value.trim().toLowerCase() !== "clear") return;
  state.queue = [];
  state.caseRefsByApplication = {};
  state.lookedUpCaseRefs = {};
  state.maybeUnpublished.clear();
  state.exportSelection.clear();
  state.exportMode = false;
  state.selected = "";
  state.detail = null;
  saveQueue();
  renderList();
  els.detailContent.classList.add("hidden");
  els.detailEmpty.classList.remove("hidden");
  closeClearAllModal();
  showToast("Case list cleared. Stored snapshots were not deleted.");
}

function flatten(value, prefix = "", output = {}) {
  if (Array.isArray(value)) { output[prefix] = JSON.stringify(value); return output; }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "scraped_at" || key === "diary" || key === "dates") continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (item && typeof item === "object" && !Array.isArray(item)) flatten(item, path, output);
      else output[path] = Array.isArray(item) ? JSON.stringify(item) : String(item ?? "");
    }
  }
  return output;
}

function readableLabel(path) {
  const field = path.replace(/^fields\./, "").replace(/^split_fields\./, "");
  const aliases = { "title": "Title", "abstract": "Abstract", "status": "Status", "expiry_date.raw": "Expiry date", "application_number_date.raw": "Application number / filing date", "publication_number_date.raw": "Publication number / date", "pct_application_number_date.raw": "PCT application", "pct_publication_number_date.raw": "PCT publication", "national_phase_entry_date.raw": "National phase entry" };
  return aliases[field] || field.replace(/_/g, " ");
}

function displayValue(value) {
  if (!value) return "—";
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => typeof item === "string" ? item : (item.raw || item.name || JSON.stringify(item))).join("\n");
  } catch {}
  return normalizeDisplayDates(String(value).replace(/<lf>/g, "\n").replace(/<t>/g, " · "));
}

function normalizeDisplayDates(value) {
  return String(value || "").replace(/\b(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})\b/g, (_match, day, month, year) => `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`);
}

function structuredDate(value) {
  if (!value) return "—";
  if (value.day && value.month && value.year) return `${String(value.day).padStart(2, "0")}/${String(value.month).padStart(2, "0")}/${value.year}`;
  if (value.iso) {
    const match = String(value.iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const plainIso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plainIso) return `${plainIso[3]}/${plainIso[2]}/${plainIso[1]}`;
  return normalizeDisplayDates(value.raw || value.date_text || value);
}

function parseCitedDocumentsForDisplay(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.includes("<t>") || text.includes("<lf>")) {
    return text.split("<lf>").map((row) => {
      const cells = row.split("<t>").map((cell) => cell.trim());
      return cells.some(Boolean) ? { reference_no: cells[0], reference_date: cells[1], reference_text: cells[2], claim_type: cells[3], document_type: cells[4] } : null;
    }).filter(Boolean);
  }
  const header = "Tài liệu được đối chứngTài liệu tham khảoDanh mụcYêu cầu bảo hộLoại tài liệu đối chứng";
  const body = text.startsWith(header) ? text.slice(header.length).trim() : text;
  const starts = [...body.matchAll(/(?:^|\s)(\d+)\s*(\d{4}-\d{2}-\d{2})\s+/g)];
  return starts.map((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : body.length;
    let remainder = body.slice(match.index + match[0].length, end).trim();
    const typeMatch = remainder.match(/(Sáng chế|Kiểu dáng công nghiệp|Nhãn hiệu)\s*$/i);
    const documentType = typeMatch ? typeMatch[1] : "";
    if (typeMatch) remainder = remainder.slice(0, typeMatch.index).trim();
    const claimMatch = remainder.match(/(Notification and Report)\s*$/i);
    const claimType = claimMatch ? claimMatch[1] : "";
    if (claimMatch) remainder = remainder.slice(0, claimMatch.index).trim();
    return { reference_no: match[1], reference_date: match[2], reference_text: remainder, claim_type: claimType, document_type: documentType };
  });
}

function priorityIdentity(item) {
  if (item.priority_country || item.priority_number) return { country: item.priority_country || "—", number: item.priority_number || item.priority_no || "—" };
  const match = String(item.priority_no || "").match(/^([A-Z]{2})\s+(.+)$/i);
  return match ? { country: match[1].toUpperCase(), number: match[2].trim() } : { country: "—", number: item.priority_no || "—" };
}

function isChangedPath(changed, path) {
  return changed.has(path) || [...changed].some((item) => item.startsWith(`${path}.`) || item.startsWith(`${path}[`) || path.startsWith(`${item}.`));
}

function rowChangesFor(changes, path) {
  const matches = new Map();
  for (const change of changes || []) {
    if (change.changeType === "removed" || !change.field.startsWith(`${path}[`)) continue;
    const match = change.field.slice(path.length).match(/^\[(\d+)\]$/);
    if (match) matches.set(Number(match[1]), change);
  }
  return matches;
}

function changeTooltip(change) {
  if (!change) return "";
  const label = change.changeType === "added" ? "Added" : change.changeType === "removed" ? "Removed" : "Changed";
  return `${label} in this snapshot${change.oldValue ? `\nBefore: ${change.oldValue}` : ""}${change.newValue ? `\nAfter: ${change.newValue}` : ""}`;
}

function fieldHistory(path) {
  return (state.detail?.snapshots || []).map((snapshot) => {
    const value = flatten(snapshot.data)[path] || "—";
    return `${formatDate(snapshot.scrapedAt)}\n${displayValue(value)}`;
  }).join("\n\n");
}

const ADDRESS_HASH_PALETTE = [
  "#4e9af1", "#52c41a", "#f97316", "#a855f7", "#ec4899",
  "#06b6d4", "#eab308", "#ef4444", "#14b8a6", "#fb923c",
];

function hashAddress(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return "------";
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 6);
}

function buildAddressHashMap(addresses) {
  const colors = new Map();
  addresses.forEach((address) => {
    const hash = hashAddress(address);
    if (!colors.has(hash)) colors.set(hash, ADDRESS_HASH_PALETTE[colors.size % ADDRESS_HASH_PALETTE.length]);
  });
  return colors;
}

function tableSection(title, headers, rows, options = {}) {
  if (!rows.length) return "";
  const changedClass = options.changed ? " changed" : "";
  const wideClass = options.wide ? " wide" : "";
  const numberedClass = options.numbered ? " numbered" : "";
  const peopleClass = options.people ? " people" : "";
  const citationsClass = options.citations ? " citations" : "";
  const goodsClass = options.goodsServices ? " goods-services" : "";
  const trademarkDetailsClass = options.trademarkDetails ? " trademark-details" : "";
  const addressHashesClass = options.addressHashColors ? " address-hashes" : "";
  const tooltip = options.tooltip ? ` title="${escapeHtml(options.tooltip)}"` : "";
  const actionHeader = options.goodsServices ? '<th class="row-action-heading"><span class="sr-only">Copy</span></th>' : "";
  const body = rows.map((row) => {
    const cells = row.map((cell, index) => `<td class="${index === 0 && options.numbered ? "row-number" : ""}">${escapeHtml(displayValue(cell))}</td>`).join("");
    const addressHash = options.addressHashColors
      ? (() => {
          const hash = hashAddress(row[1]);
          const color = options.addressHashColors.get(hash) || "#888888";
          return `<td class="address-hash-cell"><span class="address-hash-badge" style="background:${color}22;color:${color};border-color:${color}55">${escapeHtml(hash)}</span></td>`;
        })()
      : "";
    const action = options.goodsServices
      ? `<td class="row-action"><button type="button" class="copy-class-button" data-copy-text="${escapeHtml(`Class ${row[0]}: ${row[1]}`)}" title="Copy Class ${escapeHtml(row[0])} goods and services">Copy</button></td>`
      : "";
    return `<tr>${cells}${addressHash}${action}</tr>`;
  }).join("");
  const addressHashHeader = options.addressHashColors ? '<th class="address-hash-heading">Hash</th>' : "";
  return `<section class="structured-section${wideClass}${numberedClass}${peopleClass}${citationsClass}${goodsClass}${trademarkDetailsClass}${addressHashesClass}${changedClass}"${tooltip}><div class="structured-heading"><h3>${escapeHtml(title)}</h3>${options.changed ? '<span class="table-change-badge">Changed</span>' : ""}</div><div class="structured-table-wrap"><table class="structured-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}${addressHashHeader}${actionHeader}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function splitDisplayRows(value) {
  return String(value || "").split(/<lf>|\r?\n|\s+\|\s+/).map((item) => item.trim()).filter(Boolean);
}

function trademarkClassRows(value) {
  return splitDisplayRows(value).map((entry) => {
    const match = entry.match(/^(?:Class\/Nhóm|Nhóm|Class)\s*0*(\d+)\s*:\s*(.*)$/i);
    return match ? [match[1].padStart(2, "0"), match[2] || "—"] : ["—", entry];
  });
}

function splitLooseNumberDate(value) {
  const raw = String(value || "").trim();
  const matches = raw.match(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/g) || [];
  const dateText = matches.at(-1) || "";
  const number = dateText ? raw.replace(dateText, "").replace(/[|/\-:,;]+\s*$/, "").trim() : raw;
  return { raw, number, date_text: dateText, date: dateText ? { raw: dateText } : null };
}

function namedAddress(value, role) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const separator = raw.indexOf(":");
  const name = separator < 0 ? raw : raw.slice(0, separator).trim();
  const address = separator < 0 ? "" : raw.slice(separator + 1).trim();
  return role === "representative"
    ? [{ order: 1, raw, representative_name: name, representative_address: address }]
    : [{ order: 1, raw, applicant_name: name, applicant_address: address }];
}

function legacyPriority(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const parts = raw.split(/\s+\|\s+/).map((item) => item.trim()).filter(Boolean);
  const dateText = parts.find((item) => /\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/.test(item)) || "";
  const country = parts.find((item) => /^[A-Z]{2}$/i.test(item)) || parts[0]?.match(/^([A-Z]{2})\b/i)?.[1] || "";
  const number = parts.map((item) => item.replace(new RegExp(`^${country}\\s+`, "i"), "")).find((item) => item && item !== country && item !== dateText && /\d/.test(item)) || "";
  return [{ order: 1, raw, priority_no: `${country} ${number}`.trim(), priority_country: country.toUpperCase(), priority_number: number, priority_date_text: dateText, priority_date: dateText ? { raw: dateText } : null }];
}

function normalizeLegacyTrademarkData(data) {
  const kind = recordKind(data?.id, data);
  if (kind !== "trademark" && kind !== "international_trademark") return data;
  const source = data?.fields || {};
  const misplacedClasses = source["(531) Phân loại hình"];
  if (!/(?:Class\/Nhóm|Nhóm|Class)\s*\d+\s*:/i.test(String(misplacedClasses || "")) || /(?:Class\/Nhóm|Nhóm|Class)\s*\d+\s*:/i.test(String(source["(511) Nhóm sản phẩm/dịch vụ"] || ""))) return data;

  const fields = { ...source };
  fields["Loại đơn"] = [source["Loại đơn"], source["(100) Số bằng và ngày cấp"]].filter(Boolean).join(" | ");
  fields["(100) Số bằng và ngày cấp"] = source["Trạng thái"] || "";
  fields["Trạng thái"] = source["(180) Ngày hết hạn"] || "";
  fields["(180) Ngày hết hạn"] = source["(200) Số đơn và Ngày nộp đơn"] || "";
  fields["(200) Số đơn và Ngày nộp đơn"] = source["(400) Số công bố và ngày công bố"] || "";
  fields["(400) Số công bố và ngày công bố"] = source["(541) Nhãn hiệu"] || "";
  fields["(541) Nhãn hiệu"] = source["(591) Màu sắc nhãn hiệu"] || "";
  fields["(591) Màu sắc nhãn hiệu"] = source["(300) Chi tiết về dữ liệu ưu tiên"] || "";
  fields["(300) Chi tiết về dữ liệu ưu tiên"] = source["(511) Nhóm sản phẩm/dịch vụ"] || "";
  fields["(511) Nhóm sản phẩm/dịch vụ"] = source["(531) Phân loại hình"] || "";
  fields["(531) Phân loại hình"] = source["(730) Chủ đơn/Chủ bằng"] || "";
  fields["(730) Chủ đơn/Chủ bằng"] = source["(740) Đại diện SHCN"] || "";
  fields["(740) Đại diện SHCN"] = source["(571) Nhãn hiệu"] || "";
  fields["(571) Nhãn hiệu"] = source["(566) Nhãn hiệu dịch thuật"] || "";
  fields["(566) Nhãn hiệu dịch thuật"] = source["(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)"] || "";
  fields["(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)"] = source["(526) Yếu tố loại trừ"] || "";
  fields["(526) Yếu tố loại trừ"] = "";

  const application = splitLooseNumberDate(fields["(200) Số đơn và Ngày nộp đơn"]);
  application.application_no = application.number.match(/[45]-\d{4}-\d{4,}/)?.[0] || "";
  const split = {
    ...(data.split_fields || {}),
    grant_number_date: splitLooseNumberDate(fields["(100) Số bằng và ngày cấp"]),
    status: fields["Trạng thái"],
    expiry_date: fields["(180) Ngày hết hạn"] ? { raw: fields["(180) Ngày hết hạn"] } : null,
    application_number_date: application,
    publication_number_date: splitLooseNumberDate(fields["(400) Số công bố và ngày công bố"]),
    priority_details: legacyPriority(fields["(300) Chi tiết về dữ liệu ưu tiên"]),
    representatives_ordered: namedAddress(fields["(740) Đại diện SHCN"], "representative"),
    title: fields["(541) Nhãn hiệu"],
  };
  const applicants_ordered = namedAddress(fields["(730) Chủ đơn/Chủ bằng"], "applicant");
  return { ...data, fields, split_fields: split, applicants_ordered, applicants: applicants_ordered.map((item) => item.raw) };
}

function trademarkPublicationRow(fields, split) {
  const raw = String(fields["(400) Số công bố và ngày công bố"] || split.publication_number_date?.raw || "").trim();
  if (!raw) return ["Publication", split.publication_number_date?.number, structuredDate(split.publication_number_date?.date)];
  const codes = [];
  const dates = [];
  for (const entry of raw.split(/\s+\|\s+/).map((item) => item.trim()).filter(Boolean)) {
    const entryDates = entry.match(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/g) || [];
    dates.push(...entryDates.map(normalizeDisplayDates));
    const code = entry
      .replace(/\bVN\s*-?\s*[45]-\d{4}-\d{4,}\b/gi, "")
      .replace(/\b[45]-\d{4}-\d{4,}\b/gi, "")
      .replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/g, "")
      .replace(/^[\s|,;:/-]+|[\s|,;:/-]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (code) codes.push(code);
  }
  return ["Publication", [...new Set(codes)].join(" | ") || "—", [...new Set(dates)].join(" | ") || "—"];
}

function renderRecordMedia(data) {
  const kind = recordKind(state.selected, data);
  const raw = String(data.image || "").trim();
  const valid = raw && raw !== "no image" && raw !== "base64_image";
  if (!valid || kind === "patent") {
    els.recordMedia.classList.add("hidden");
    els.recordMedia.innerHTML = "";
    return;
  }
  const url = /^https?:\/\//i.test(raw) ? raw : `https://wipopublish.ipvietnam.gov.vn${raw.startsWith("/") ? "" : "/"}${raw}`;
  const fields = data.fields || {};
  const name = fields["(541) Nhãn hiệu"] || fields["(571) Nhãn hiệu"] || fields["(54) Tên kiểu dáng"] || recordKindLabel(kind);
  const isTrademark = kind === "trademark" || kind === "international_trademark";
  els.recordMedia.classList.toggle("trademark-media", isTrademark);
  els.recordMedia.innerHTML = isTrademark
    ? `<div class="record-media-copy"><strong>${escapeHtml(name)}</strong></div><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy">`
    : `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"><div class="record-media-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(recordKindLabel(kind))} image from the stored WIPO record</span></div>`;
  els.recordMedia.classList.remove("hidden");
}

function renderStructuredDetails(data, changed) {
  const split = data.split_fields || {};
  const fields = data.fields || {};
  const kind = recordKind(state.selected, data);
  const numberDateRows = [
    ["PCT application", split.pct_application_number_date?.number, structuredDate(split.pct_application_number_date?.date)],
    ["WIPO publication", split.pct_publication_number_date?.number, structuredDate(split.pct_publication_number_date?.date)],
    ["Application", split.application_number_date?.number, structuredDate(split.application_number_date?.date)],
    ["Publication", split.publication_number_date?.number, structuredDate(split.publication_number_date?.date)],
    ["Grant", split.grant_number_date?.number, structuredDate(split.grant_number_date?.date)],
    ["Expiry", "—", structuredDate(split.expiry_date)],
    ["National phase entry", "—", structuredDate(split.national_phase_entry_date)],
  ].filter((row) => (row[1] && row[1] !== "—") || (row[2] && row[2] !== "—"));
  const priorities = (split.priority_details || []).map((item) => {
    const identity = priorityIdentity(item);
    return [identity.country, identity.number, structuredDate(item.priority_date)];
  });
  const classifications = [
    ...(split.ipc_classifications || []).map((item) => ["IPC", item.code || item.raw, item.version || "—"]),
    ...(split.cpc_classifications || []).map((item) => ["CPC", item.code || item.raw, item.version || "—"]),
  ];
  const citedRawEntry = Object.entries(data.fields || {}).find(([label]) => label.startsWith("(58)"));
  const citedDocuments = (split.cited_documents?.length ? split.cited_documents : parseCitedDocumentsForDisplay(citedRawEntry?.[1] || ""))
    .map((item) => [item.reference_no || "—", structuredDate(item.reference_date), item.reference_text || "—", item.claim_type || "—", item.document_type || "—"]);
  const applicants = (data.applicants_ordered || []).map((item) => [item.applicant_name || item.name || "—", item.applicant_address || item.address || "—"]);
  const inventors = (data.inventors_ordered || []).map((item) => [item.inventor_name || item.name || "—", item.inventor_address || item.address || "—"]);
  const representatives = (split.representatives_ordered || []).map((item) => [item.representative_name || item.name || "—", item.representative_address || item.address || "—"]);
  const partyAddressHashColors = buildAddressHashMap([...applicants, ...inventors].map((row) => row[1]));
  if (kind === "trademark" || kind === "international_trademark") {
    const markDetails = [
      ["Mark", fields["(541) Nhãn hiệu"]],
      ["Description", fields["(571) Nhãn hiệu"]],
      ["Colours", fields["(591) Màu sắc nhãn hiệu"]],
      ["Translation", fields["(566) Nhãn hiệu dịch thuật"]],
      ["Mark type", fields["(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)"]],
      ["Disclaimer", fields["(526) Yếu tố loại trừ"]],
    ].filter((row) => row[1]);
    const vienna = splitDisplayRows(fields["(531) Phân loại hình"]).map((value, index) => [index + 1, value]);
    const trademarkNumberDateRows = [
      ["Application", split.application_number_date?.number, structuredDate(split.application_number_date?.date)],
      trademarkPublicationRow(fields, split),
      ["Grant", split.grant_number_date?.number, structuredDate(split.grant_number_date?.date)],
      ["Expiry", "—", structuredDate(split.expiry_date)],
    ].filter((row) => (row[1] && row[1] !== "—") || (row[2] && row[2] !== "—"));
    els.structured.innerHTML = [
      tableSection("Trademark details", ["Field", "Value"], markDetails, { wide: true, trademarkDetails: true }),
      tableSection("Numbers and dates", ["Record", "Number", "Date (dd/mm/yyyy)"], trademarkNumberDateRows, { wide: true, changed: ["grant_number_date", "application_number_date", "publication_number_date", "expiry_date"].some((key) => isChangedPath(changed, `split_fields.${key}`)) }),
      tableSection("Priority", ["Country", "Priority number", "Priority date"], priorities, { changed: isChangedPath(changed, "split_fields.priority_details"), tooltip: fieldHistory("split_fields.priority_details") }),
      tableSection("Goods and services", ["Nice class", "Goods / services"], trademarkClassRows(fields["(511) Nhóm sản phẩm/dịch vụ"]), { wide: true, goodsServices: true, changed: isChangedPath(changed, "fields.(511) Nhóm sản phẩm/dịch vụ") }),
      tableSection("Vienna classification", ["#", "Classification"], vienna, { numbered: true, changed: isChangedPath(changed, "fields.(531) Phân loại hình") }),
      tableSection("Owners / Applicants", ["Name", "Address"], applicants, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "applicants_ordered"), tooltip: fieldHistory("applicants_ordered") }),
      tableSection("IP Representatives", ["Name", "Address"], representatives, { wide: true, people: true, changed: isChangedPath(changed, "split_fields.representatives_ordered") }),
    ].join("");
    return;
  }
  if (kind === "design") {
    const locarno = splitDisplayRows(fields["(51/52) Phân loại Locarno"]).map((value, index) => [index + 1, value]);
    const designDetails = [
      ["Design name", fields["(54) Tên kiểu dáng"]], ["Summary", fields["Tóm tắt"]],
      ["Number of designs", fields["(53) Tổng số kiểu dáng"]], ["Nature", fields["(55) Bản chất của kiểu dáng"]],
      ["Protection claim", fields["(56) Yêu cầu bảo hộ kiểu dáng"]],
    ].filter((row) => row[1]);
    els.structured.innerHTML = [
      tableSection("Numbers and dates", ["Record", "Number", "Date (dd/mm/yyyy)"], numberDateRows, { wide: true }),
      tableSection("Priority", ["Country", "Priority number", "Priority date"], priorities, { changed: isChangedPath(changed, "split_fields.priority_details") }),
      tableSection("Locarno classification", ["#", "Classification"], locarno, { numbered: true }),
      tableSection("Design details", ["Field", "Value"], designDetails, { wide: true }),
      tableSection("Applicants / Owners", ["Name", "Address"], applicants, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "applicants_ordered") }),
      tableSection("Designers", ["Name", "Address"], inventors, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "inventors_ordered") }),
      tableSection("IP Representatives", ["Name", "Address"], representatives, { wide: true, people: true }),
    ].join("");
    return;
  }
  els.structured.innerHTML = [
    tableSection("Numbers and dates", ["Record", "Number", "Date (dd/mm/yyyy)"], numberDateRows, { wide: true, changed: ["grant_number_date", "application_number_date", "publication_number_date", "pct_application_number_date", "pct_publication_number_date", "expiry_date", "national_phase_entry_date"].some((key) => isChangedPath(changed, `split_fields.${key}`)) }),
    tableSection("Priority", ["Country", "Priority number", "Priority date"], priorities, { changed: isChangedPath(changed, "split_fields.priority_details"), tooltip: fieldHistory("split_fields.priority_details") }),
    tableSection("Classification", ["System", "Classification", "Version"], classifications, { changed: isChangedPath(changed, "split_fields.ipc_classifications") || isChangedPath(changed, "split_fields.cpc_classifications") }),
    tableSection("(58) Các tài liệu đối chứng", ["Tài liệu được đối chứng", "Tài liệu tham khảo", "Danh mục", "Yêu cầu bảo hộ", "Loại tài liệu đối chứng"], citedDocuments, { wide: true, citations: true, changed: isChangedPath(changed, "split_fields.cited_documents") || Boolean(citedRawEntry && isChangedPath(changed, `fields.${citedRawEntry[0]}`)) }),
    tableSection("Applicants / Owners", ["Name", "Address"], applicants, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "applicants_ordered"), tooltip: fieldHistory("applicants_ordered") }),
    tableSection("Inventors", ["Name", "Address"], inventors, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "inventors_ordered"), tooltip: fieldHistory("inventors_ordered") }),
    tableSection("IP Representatives", ["Name", "Address"], representatives, { wide: true, people: true, changed: isChangedPath(changed, "split_fields.representatives_ordered"), tooltip: fieldHistory("split_fields.representatives_ordered") }),
  ].join("");
}

function highlightStructuredRows(changes, data) {
  const sourceByTitle = {
    "Priority": "split_fields.priority_details",
    "Owners / Applicants": "applicants_ordered",
    "Applicants / Owners": "applicants_ordered",
    "Designers": "inventors_ordered",
    "Inventors": "inventors_ordered",
    "IP Representatives": "split_fields.representatives_ordered",
    "(58) Các tài liệu đối chứng": "split_fields.cited_documents",
  };
  for (const section of els.structured.querySelectorAll(".structured-section")) {
    const title = section.querySelector("h3")?.textContent || "";
    const path = sourceByTitle[title];
    const rowChanges = path ? rowChangesFor(changes, path) : new Map();
    if (title === "Classification") {
      for (const [index, change] of rowChangesFor(changes, "split_fields.ipc_classifications")) rowChanges.set(index, change);
      const offset = data.split_fields?.ipc_classifications?.length || 0;
      for (const [index, change] of rowChangesFor(changes, "split_fields.cpc_classifications")) rowChanges.set(offset + index, change);
    }
    [...section.querySelectorAll("tbody tr")].forEach((row, index) => {
      const change = rowChanges.get(index);
      if (change) { row.classList.add("changed-row"); row.title = changeTooltip(change); }
    });
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      if (!document.execCommand?.("copy")) throw new Error("Clipboard access is unavailable.");
      textarea.remove();
    }
    showToast("Nice class text copied.");
  } catch (error) {
    showToast(error.message || "Could not copy the Nice class text.", true);
  }
}

function renderSnapshot(snapshotId) {
  const snapshot = state.detail?.snapshots.find((item) => String(item.id) === String(snapshotId)) || state.detail?.latest;
  if (!snapshot) return;
  const data = normalizeLegacyTrademarkData(snapshot.data || {});
  const changed = new Set((snapshot.changes || []).map((item) => item.field));
  renderRecordMedia(data);
  const flat = flatten(data);
  const hasRawFields = Object.keys(flat).some((path) => path.startsWith("fields."));
  const structuredLabels = new Set(["(10) Số bằng và ngày cấp", "(100) Số bằng và ngày cấp", "(180) Ngày hết hạn", "(20) Số đơn và Ngày nộp đơn", "(200) Số đơn và Ngày nộp đơn", "(40) Số công bố và ngày công bố", "(400) Số công bố và ngày công bố", "(86) Số đơn và ngày nộp đơn PCT", "(87) Số công bố và ngày công bố đơn PCT", "(85) Ngày vào pha quốc gia", "(30) Chi tiết về dữ liệu ưu tiên", "(300) Chi tiết về dữ liệu ưu tiên", "(51) Phân loại IPC", "Phân loại CPC", "(51/52) Phân loại Locarno", "(511) Nhóm sản phẩm/dịch vụ", "(531) Phân loại hình", "(71/73) Chủ đơn/Chủ bằng", "(730) Chủ đơn/Chủ bằng", "(72) Tác giả sáng chế", "(72) Tác giả kiểu dáng", "(73) Địa chỉ nhận thư", "(74) Đại diện SHCN", "(740) Đại diện SHCN", "(541) Nhãn hiệu", "(591) Màu sắc nhãn hiệu", "(571) Nhãn hiệu", "(566) Nhãn hiệu dịch thuật", "(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)", "(526) Yếu tố loại trừ", "(54) Tên kiểu dáng", "Tóm tắt", "(53) Tổng số kiểu dáng", "(55) Bản chất của kiểu dáng", "(56) Yêu cầu bảo hộ kiểu dáng"]);
  const preferred = Object.entries(flat).filter(([path, value]) => value && value !== "${repeating.template.ca}" && (hasRawFields ? path.startsWith("fields.") && !structuredLabels.has(path.slice("fields.".length)) && !path.slice("fields.".length).startsWith("(58)") : path.startsWith("split_fields.") && !path.startsWith("split_fields.cited_documents") && !/(mailing|correspondence).*address/i.test(path)));
  const deduped = [];
  const seenLabels = new Set();
  for (const [path, value] of preferred) {
    const label = readableLabel(path);
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    deduped.push([path, label, value]);
  }
  els.fields.innerHTML = deduped.map(([path, label, value]) => {
    const text = displayValue(value);
    const isWide = text.length > 110 || text.includes("\n");
    const isChanged = isChangedPath(changed, path);
    return `<article class="field-card ${isWide ? "wide" : ""} ${isChanged ? "changed" : ""}" title="${escapeHtml(fieldHistory(path))}"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${escapeHtml(text)}</div></article>`;
  }).join("") || `<article class="field-card wide"><div class="field-value">No parsed fields in this snapshot.</div></article>`;
  renderStructuredDetails(data, changed);
  highlightStructuredRows(snapshot.changes || [], data);
  const diary = Array.isArray(data.diary) ? data.diary : [];
  const diaryChanges = rowChangesFor(snapshot.changes, "diary");
  els.timelineCount.textContent = `${diary.length} events`;
  els.timeline.innerHTML = diary.map((item, index) => {
    const extras = Array.isArray(item.extra) ? item.extra.filter(Boolean) : (item.status ? [item.status] : []);
    const change = diaryChanges.get(index);
    return `<div class="timeline-item${change ? " changed" : ""}"${change ? ` title="${escapeHtml(changeTooltip(change))}"` : ""}><div class="timeline-date">${escapeHtml(structuredDate(item.date || item.date_text))}</div><div class="timeline-node"></div><div class="timeline-copy"><strong>${escapeHtml(item.description || item.event || item.title || item.raw || "—")}</strong>${extras.length ? `<div class="timeline-extra">${extras.map(escapeHtml).join(" · ")}</div>` : ""}</div></div>`;
  }).join("") || `<div class="case-sub">No procedural events parsed.</div>`;
  els.changeSummary.textContent = snapshot.changes?.length ? `${snapshot.changes.length} change${snapshot.changes.length === 1 ? "" : "s"} in this snapshot · hover highlighted fields or rows for details` : "No changes from the previous snapshot";
  els.changeSummary.title = (snapshot.changes || []).map((change) => `${change.field}: ${changeTooltip(change)}`).join("\n\n");
  els.printReportNo.textContent = state.selected;
  els.printReportType.textContent = recordKindLabel(recordKind(state.selected, data));
  els.printReportStatus.textContent = data.split_fields?.status || data.fields?.["Trạng thái"] || "Stored record";
  els.printReportSnapshot.textContent = `Snapshot: ${formatDate(snapshot.scrapedAt)}`;
}

function printSelectedRecord() {
  if (!state.detail || !state.selected) return showToast("Select a scraped application before printing.", true);
  const previousTitle = document.title;
  const restore = () => {
    document.body.classList.remove("printing-report");
    document.title = previousTitle;
    window.removeEventListener("afterprint", restore);
  };
  document.title = `WIPO_${state.selected.replace(/[^A-Z0-9-]+/gi, "_")}`;
  document.body.classList.add("printing-report");
  window.addEventListener("afterprint", restore, { once: true });
  const nextFrame = window.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
  nextFrame(() => {
    window.print();
    setTimeout(restore, 1000);
  });
}

async function downloadSelectedPdf() {
  if (!state.detail || !state.selected) return showToast("Select a scraped application before downloading its PDF.", true);
  const applicationNo = state.selected;
  els.downloadPdf.disabled = true;
  document.body.classList.add("printing-report");
  try {
    let html = "";
    if (location.protocol !== "file:") {
      const response = await fetch("styles.css", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the report styling.");
      const css = await response.text();
      if (state.selected !== applicationNo) throw new Error("The selected application changed. Please retry the PDF download.");
      const copy = document.documentElement.cloneNode(true);
      copy.querySelectorAll("script, link[rel=stylesheet]").forEach((item) => item.remove());
      copy.querySelectorAll("img[loading=lazy]").forEach((item) => { item.loading = "eager"; });
      const style = document.createElement("style");
      style.textContent = css;
      copy.querySelector("head").appendChild(style);
      html = `<!doctype html>${copy.outerHTML}`;
    } else {
      await new Promise((resolve) => window.requestAnimationFrame ? window.requestAnimationFrame(resolve) : setTimeout(resolve, 0));
    }
    if (state.selected !== applicationNo) throw new Error("The selected application changed. Please retry the PDF download.");
    const result = await window.wipoTracker.downloadPdf(applicationNo, html);
    if (result?.ok) showToast("PDF report downloaded.");
    else if (!result?.canceled) showToast(result?.error || "PDF download failed.", true);
  } catch (error) { showToast(error.message || "PDF download failed.", true); }
  finally { document.body.classList.remove("printing-report"); els.downloadPdf.disabled = !state.detail; }
}

async function openDetail(appNo, quiet = false) {
  state.selected = appNo;
  renderList();
  const result = await window.wipoTracker.detail(appNo);
  state.detail = result.detail;
  const latestData = normalizeLegacyTrademarkData(state.detail?.latest?.data || {});
  const kind = recordKind(appNo, latestData);
  els.detailEmpty.classList.add("hidden");
  els.detailContent.classList.remove("hidden");
  els.detailNo.textContent = appNo;
  renderDetailCaseRef(appNo);
  els.detailType.textContent = recordKindLabel(kind);
  els.detailType.dataset.kind = kind;
  els.publicationA.parentElement.classList.toggle("hidden", kind !== "patent");
  els.exportOne.disabled = !state.detail;
  els.downloadPdf.disabled = !state.detail;
  if (kind === "patent") updatePublicationButtons(null, true);
  if (!state.detail) {
    renderDetailStatus();
    els.snapshot.innerHTML = `<option>No snapshots</option>`;
    els.snapshot.disabled = true;
    els.changeSummary.textContent = "";
    els.fields.innerHTML = `<article class="field-card wide"><div class="field-label">Data status</div><div class="field-value">${state.maybeUnpublished.has(appNo) ? "The scrape did not return this application, and no Publication A record was found in the local database. It may not yet be published." : "This application is in your list but has not been scraped into the local database."}</div></article>`;
    els.recordMedia.classList.add("hidden"); els.recordMedia.innerHTML = "";
    els.structured.innerHTML = ""; els.timeline.innerHTML = ""; els.timelineCount.textContent = "0 events";
    if (kind === "patent") prefetchPublications(appNo).catch(() => updatePublicationButtons());
    return;
  }
  els.detailStatus.textContent = latestData.split_fields?.status || latestData.fields?.["Trạng thái"] || "Stored";
  els.detailStatus.title = "";
  els.detailStatus.classList.remove("maybe-unpublished");
  els.snapshot.disabled = false;
  els.snapshot.innerHTML = state.detail.snapshots.map((snapshot, index) => `<option value="${snapshot.id}">${index === 0 ? "Latest · " : ""}${escapeHtml(formatDate(snapshot.scrapedAt))}${snapshot.changes.length ? ` · ${snapshot.changes.length} changes` : ""}</option>`).join("");
  renderSnapshot(state.detail.latest.id);
  if (kind === "patent") prefetchPublications(appNo).catch(() => updatePublicationButtons());
  if (!quiet) els.detailContent.scrollTop = 0;
}

async function scrape(ids) {
  if (state.running || !ids.length) return;
  state.scrapingIds = new Set(ids);
  setRunning(true); renderList(); setRunStatus(`Scraping ${ids.length} application${ids.length === 1 ? "" : "s"}…`, "busy");
  appendLog(`\n[Tracker] Starting ${ids.join(", ")}\n`);
  try {
    const retryCount = selectedRetryCount();
    els.retryCount.value = String(retryCount);
    localStorage.setItem("wipoTrackerRetryCount", String(retryCount));
    const result = await window.wipoTracker.scrape(ids, Number(els.preset.value || 1), retryCount);
    await recordRefreshChain;
    await refreshList();
    await updateFailedPublicationStatuses(result.missing, result.imported);
    if (result.ok) { setRunStatus(`Stored ${result.imported.length} result${result.imported.length === 1 ? "" : "s"}`, "ready"); showToast("Scrape completed and snapshot saved."); }
    else { setRunStatus("Scrape finished with issues", "busy"); showToast(result.error || `${result.missing?.length || 0} application(s) did not return data.`, true); }
  } catch (error) {
    setRunStatus("Shared scraper request ended", "busy");
    appendLog(`\n[Tracker] ${error.message}\n`);
    showToast(`${error.message} Refresh and try again.`, true);
  } finally {
    state.scrapingIds.clear();
    setRunning(false);
    renderList();
  }
}

async function exportIds(ids) {
  const result = await window.wipoTracker.exportExcel(ids);
  if (result.ok) showToast(`Exported ${result.count} application${result.count === 1 ? "" : "s"} to Excel.`);
  else if (!result.canceled) showToast(result.error || "Export failed.", true);
}

els.add.addEventListener("click", async () => {
  els.add.disabled = true;
  try { if (await addInputText(els.input.value)) { els.input.value = ""; resizeApplicationInput(); } }
  catch (error) { showToast(error.message, true); }
  finally { els.add.disabled = state.running; }
});
els.input.addEventListener("input", resizeApplicationInput);
els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); els.add.click(); }
});
els.namedListSelect.addEventListener("change", () => selectNamedList(els.namedListSelect.value).catch((error) => showToast(error.message, true)));
els.addNamedList.addEventListener("click", addNamedList);
els.removeNamedList.addEventListener("click", openRemoveListModal);
els.closeRemoveList.addEventListener("click", closeRemoveListModal);
els.cancelRemoveList.addEventListener("click", closeRemoveListModal);
els.removeListModal.addEventListener("click", (event) => { if (event.target === els.removeListModal) closeRemoveListModal(); });
els.removeListInput.addEventListener("input", () => { els.confirmRemoveList.disabled = els.removeListInput.value.trim().toLowerCase() !== "remove"; });
els.removeListInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !els.confirmRemoveList.disabled) confirmRemoveList().catch((error) => showToast(error.message, true));
  else if (event.key === "Escape") closeRemoveListModal();
});
els.confirmRemoveList.addEventListener("click", () => confirmRemoveList().catch((error) => showToast(error.message, true)));
els.renameNamedList.addEventListener("click", () => {
  if (els.namedListName.classList.contains("hidden")) beginRenameList();
  else endRenameList(true);
});
els.namedListName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") endRenameList(true);
  else if (event.key === "Escape") endRenameList(false);
});
function scrapeAllQueued() {
  const ids = els.reScrape.checked ? state.queue : state.queue.filter((id) => !state.records.get(id)?.lastScrapedAt);
  if (!ids.length) return showToast("All loaded applications already have stored data. Tick Re-scrape to scrape them again.", true);
  scrape(ids);
}
els.scrapeAll.addEventListener("click", scrapeAllQueued);
els.refreshAll.addEventListener("click", scrapeAllQueued);
els.reScrape.addEventListener("change", () => localStorage.setItem("wipoTrackerRescrape", els.reScrape.checked ? "1" : "0"));
els.compactList.addEventListener("click", () => applyCompactList(els.compactList.getAttribute("aria-pressed") !== "true"));
els.retryCount.addEventListener("change", () => {
  const retryCount = selectedRetryCount();
  els.retryCount.value = String(retryCount);
  localStorage.setItem("wipoTrackerRetryCount", String(retryCount));
});
els.typographyButton.addEventListener("click", openTypographyModal);
els.closeTypography.addEventListener("click", closeTypographyModal);
els.saveTypography.addEventListener("click", () => { applyTypography(typographyFromControls()); closeTypographyModal(); });
els.resetTypography.addEventListener("click", () => applyTypography(TYPOGRAPHY_DEFAULTS));
els.typographyModal.addEventListener("click", (event) => { if (event.target === els.typographyModal) closeTypographyModal(); });
[els.interfaceFont, els.headerFont, els.contentFont, els.interfaceFontSize, els.headerFontSize, els.contentFontSize]
  .forEach((control) => control.addEventListener("input", () => applyTypography(typographyFromControls())));
els.stop.addEventListener("click", () => window.wipoTracker.stop());
els.scrapeOne.addEventListener("click", () => state.selected && scrape([state.selected]));
publicationButtons().forEach((button) => button.addEventListener("click", () => openPublicationCategory(button.dataset.publicationCategory)));
els.closePublicationModal.addEventListener("click", closePublicationModal);
els.publicationTabs.querySelectorAll("[data-publication-category]").forEach((button) => button.addEventListener("click", () => selectPublicationCategory(button.dataset.publicationCategory)));
els.publicationDocumentSelect.addEventListener("change", () => {
  const documents = state.publicationDocuments.filter((item) => item.category === state.publicationCategory);
  const document = documents[Number(els.publicationDocumentSelect.value)];
  if (document) loadPublicationInModal(document);
});
els.publicationModal.addEventListener("click", (event) => { if (event.target === els.publicationModal) closePublicationModal(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.publicationModal.classList.contains("hidden")) closePublicationModal();
  else if (event.key === "Escape" && !els.typographyModal.classList.contains("hidden")) closeTypographyModal();
  else if (event.key === "Escape" && !els.removeListModal.classList.contains("hidden")) closeRemoveListModal();
});
els.exportOne.addEventListener("click", () => state.selected && exportIds([state.selected]));
els.printPdf.addEventListener("click", printSelectedRecord);
els.downloadPdf.addEventListener("click", downloadSelectedPdf);
els.clearAll.addEventListener("click", openClearAllModal);
els.closeClearAll.addEventListener("click", closeClearAllModal);
els.cancelClearAll.addEventListener("click", closeClearAllModal);
els.clearAllModal.addEventListener("click", (event) => { if (event.target === els.clearAllModal) closeClearAllModal(); });
els.clearAllInput.addEventListener("input", () => {
  const hasValue = Boolean(els.clearAllInput.value);
  els.clearAllInputReset.classList.toggle("hidden", !hasValue);
  els.confirmClearAll.disabled = els.clearAllInput.value.trim().toLowerCase() !== "clear";
});
els.clearAllInput.addEventListener("keydown", (event) => { if (event.key === "Enter" && !els.confirmClearAll.disabled) confirmClearAll(); else if (event.key === "Escape") closeClearAllModal(); });
els.clearAllInputReset.addEventListener("click", () => { els.clearAllInput.value = ""; els.clearAllInputReset.classList.add("hidden"); els.confirmClearAll.disabled = true; els.clearAllInput.focus(); });
els.confirmClearAll.addEventListener("click", confirmClearAll);
els.exportList.addEventListener("click", () => {
  if (!state.queue.length) return showToast("The case list is empty.", true);
  exportIds(state.queue);
});
els.selectAll.addEventListener("change", () => { state.exportSelection = els.selectAll.checked ? new Set(state.queue) : new Set(); renderList(); });
els.snapshot.addEventListener("change", () => renderSnapshot(els.snapshot.value));
els.structured.addEventListener("click", (event) => {
  const button = event.target.closest(".copy-class-button");
  if (button) copyText(button.dataset.copyText || "");
});
els.toggleLog.addEventListener("click", () => els.logDrawer.classList.toggle("hidden"));
window.wipoTracker.onProgress((payload) => {
  if (payload.type === "record" && payload.applicationNo) refreshCompletedRecord(payload.applicationNo);
  if (payload.message) {
    appendLog(payload.message);
    setRunStatus(payload.message.replace(/\s+/g, " ").trim().slice(0, 120), payload.type === "done" && payload.level !== "error" ? "ready" : "busy");
  }
});

async function initialize() {
  try {
    if (window.ResizeObserver) {
      const headers = new ResizeObserver(schedulePanelHeaderSync);
      headers.observe(els.casePanel);
      headers.observe(els.casePanel.querySelector(".panel-header"));
      headers.observe(document.querySelector(".detail-heading"));
      headers.observe(els.list);
    }
    if (window.MutationObserver) {
      const headerContent = new MutationObserver(schedulePanelHeaderSync);
      headerContent.observe(document.querySelector(".detail-heading"), { childList: true, characterData: true, subtree: true });
    }
    window.addEventListener("resize", () => { syncListHeaderGutter(); resizeApplicationInput(); schedulePanelHeaderSync(); });
    if (window.ResizeObserver) {
      let inputWidth = 0;
      new ResizeObserver(() => {
        const width = els.input.getBoundingClientRect().width;
        if (width !== inputWidth) { inputWidth = width; resizeApplicationInput(); }
      }).observe(els.input);
    }
    resizeApplicationInput();
    schedulePanelHeaderSync();
    applyCompactList(localStorage.getItem("wipoTrackerCompactList") === "1", false);
    initializeWorkspaceResizer();
    const fontOptions = Object.keys(FONT_FAMILIES).map((key) => `<option value="${key}">${FONT_LABELS[key]}</option>`).join("");
    els.interfaceFont.innerHTML = fontOptions;
    els.headerFont.innerHTML = fontOptions;
    els.contentFont.innerHTML = fontOptions;
    applyTypography(loadTypography(), false);
    els.reScrape.checked = localStorage.getItem("wipoTrackerRescrape") === "1";
    const savedRetryCount = Number.parseInt(localStorage.getItem("wipoTrackerRetryCount") ?? "10", 10);
    els.retryCount.value = String(Number.isNaN(savedRetryCount) ? 10 : Math.min(50, Math.max(0, savedRetryCount)));
    const info = await window.wipoTracker.init();
    els.databaseStatus.innerHTML = `<span class="status-dot ready"></span> SQLite ready`;
    els.databaseStatus.title = info.database;
    els.preset.innerHTML = (info.presets || []).map((preset) => `<option value="${preset.index}">${preset.index}. ${escapeHtml(preset.name)}</option>`).join("");
    loadNamedLists();
    await refreshList();
  } catch (error) {
    els.databaseStatus.textContent = "Database unavailable";
    showToast(error.message || "Could not initialize the tracker.", true);
  }
}

initialize();
