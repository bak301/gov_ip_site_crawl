const $ = (id) => document.getElementById(id);
if (window.location.pathname.includes('/wipo-application-tracker/')) {
  const iconUrl = `api/brand-icon?v=${Date.now()}`;
  const brand = $('brandMark');
  if (brand) brand.src = iconUrl;
  document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach((link) => link.remove());
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.href = iconUrl;
  document.head.append(favicon);
}
const MIN_CASE_PANE_WIDTH = 400;
// The row grid has 18 tracks: 17 two-pixel gaps plus 9px/3px side padding.
const CASE_GRID_CHROME_PX = 46;
const RESCRAPE_CONFIRMATION_TIMEOUT_MS = Math.max(1, Number(window.WIPO_RESCRAPE_CONFIRMATION_TIMEOUT_MS) || 10000);
const ACTIVE_SCRAPE_STATE_KEY = "wipoTrackerActiveScrapeStates";
const CASE_COLUMNS = {
  app: { variable: "--case-app-width", defaultMinimum: 70, maximum: 260, defaultValue: 78, defaultSquishable: false },
  registration: { variable: "--case-registration-width", defaultMinimum: 90, maximum: 220, defaultValue: 100, defaultSquishable: false },
  reference: { variable: "--case-reference-width", defaultMinimum: 62, maximum: 200, defaultValue: 74, defaultSquishable: false },
  attorney: { variable: "--case-attorney-width", defaultMinimum: 72, maximum: 240, defaultValue: 88, defaultSquishable: false },
  client: { variable: "--case-client-width", defaultMinimum: 76, maximum: 260, defaultValue: 92, defaultSquishable: false },
  applicant: { variable: "--case-applicant-width", defaultMinimum: 82, maximum: 280, defaultValue: 100, defaultSquishable: false },
  applicationtype: { variable: "--case-applicationtype-width", defaultMinimum: 92, maximum: 220, defaultValue: 110, defaultSquishable: true, defaultHidden: true },
  wipostatus: { variable: "--case-wipostatus-width", defaultMinimum: 120, maximum: 360, defaultValue: 180, defaultSquishable: true, defaultHidden: true },
  grant: { variable: "--case-grant-width", defaultMinimum: 115, maximum: 240, defaultValue: 135, defaultSquishable: true, defaultHidden: true },
  expiry: { variable: "--case-expiry-width", defaultMinimum: 82, maximum: 150, defaultValue: 95, defaultSquishable: true, defaultHidden: true },
  representative: { variable: "--case-representative-width", defaultMinimum: 130, maximum: 360, defaultValue: 180, defaultSquishable: true, defaultHidden: true },
  date: { variable: "--case-date-width", defaultMinimum: 60, maximum: 130, defaultValue: 78, defaultSquishable: false },
  clock: { variable: "--case-clock-width", defaultMinimum: 58, maximum: 100, defaultValue: 58, defaultSquishable: true },
  status: { variable: "--case-status-width", defaultMinimum: 64, maximum: 180, defaultValue: 78, canHide: false, canSquish: false, defaultSquishable: false },
};
const els = {
  workspace: document.querySelector(".workspace"), casePanel: document.querySelector(".case-panel"), workspaceResizer: $("workspaceResizer"), compactList: $("compactListButton"), resetSort: $("resetSortButton"),
  connectionStatus: $("connectionStatus"), wipoSiteStatus: $("wipoSiteStatus"), preset: $("presetSelect"), retryCount: $("retryCountInput"), typographyButton: $("typographySettingsButton"), reScrape: $("rescrapeCheckbox"), stop: $("stopButton"), scrapeAll: $("scrapeAllButton"), scrapeAllCount: $("scrapeAllCount"), refreshAll: $("refreshAllButton"), refreshAllCount: $("refreshAllCount"),
  input: $("applicationInput"), add: $("addButton"), registrationInput: $("registrationInput"), registrationType: $("registrationTypeSelect"), addRegistration: $("addRegistrationButton"), registrationShell: document.querySelector(".registration-shell"),
  requestInput: $("requestInput"), addRequest: $("addRequestButton"), requestDetail: $("requestDetail"), requestDetailNo: $("requestDetailNo"), requestDetailKind: $("requestDetailKind"), requestDetailMeta: $("requestDetailMeta"), requestDocumentSelect: $("requestDocumentSelect"), requestPrintPdf: $("requestPrintPdfButton"), requestSavePdf: $("requestSavePdfButton"), requestViewerShell: $("requestViewerShell"), requestPublicationLoading: $("requestPublicationLoading"), requestPublicationPages: $("requestPublicationPages"), requestZoomOut: $("requestZoomOutButton"), requestZoomReset: $("requestZoomResetButton"), requestZoomIn: $("requestZoomInButton"),
  hagueDetail: $("hagueDetail"), hagueDetailNo: $("hagueDetailNo"), hagueDetailStatus: $("hagueDetailStatus"), hagueDetailBody: $("hagueDetailBody"), hagueRefresh: $("hagueRefreshButton"), hagueFetchAll: $("hagueFetchAllButton"), haguePrint: $("haguePrintButton"), hagueDownload: $("hagueDownloadButton"), hagueSnapshotBar: $("hagueSnapshotBar"), hagueSnapshot: $("hagueSnapshotSelect"), hagueChangeSummary: $("hagueChangeSummary"),
  namedListSelect: $("namedListSelect"), namedListName: $("namedListName"), addNamedList: $("addNamedListButton"), renameNamedList: $("renameNamedListButton"), removeNamedList: $("removeNamedListButton"),
  removeListModal: $("removeListModal"), removeListMessage: $("removeListMessage"), removeListInput: $("removeListInput"), closeRemoveList: $("closeRemoveListButton"), cancelRemoveList: $("cancelRemoveListButton"), confirmRemoveList: $("confirmRemoveListButton"),
  list: $("caseList"), emptyList: $("emptyList"), exportList: $("exportListButton"),
  clearAll: $("clearAllButton"), clearAllModal: $("clearAllModal"), clearAllInput: $("clearAllInput"), clearAllInputReset: $("clearAllInputReset"),
  closeClearAll: $("closeClearAllButton"), cancelClearAll: $("cancelClearAllButton"), confirmClearAll: $("confirmClearAllButton"),
  selectAllHead: $("selectAllHead"), selectAll: $("selectAllCheckbox"), detailEmpty: $("detailEmpty"), detailContent: $("detailContent"),
  detailNo: $("detailApplicationNo"), detailCaseRef: $("detailCaseRef"), detailType: $("detailRecordType"), detailStatus: $("detailStatus"), publicationA: $("publicationAButton"), publicationB: $("publicationBButton"), annuity: $("annuityButton"), scrapeOne: $("scrapeOneButton"), scrapeOneCount: $("scrapeOneCount"),
  exportOne: $("exportOneButton"), printPdf: $("printPdfButton"), downloadPdf: $("downloadPdfButton"), snapshot: $("snapshotSelect"), changeSummary: $("changeSummary"), fields: $("fieldGrid"),
  printReportNo: $("printReportApplicationNo"), printReportType: $("printReportType"), printReportStatus: $("printReportStatus"), printReportSnapshot: $("printReportSnapshot"),
  recordMedia: $("recordMedia"), structured: $("structuredDetails"), timelineSection: document.querySelector(".timeline-section"), timeline: $("timeline"), timelineCount: $("timelineCount"), runStatus: $("runStatus"), toggleLog: $("toggleLogButton"),
  logDrawer: $("logDrawer"), log: $("logOutput"), toast: $("toast"),
  imagePreviewModal: $("imagePreviewModal"), imagePreviewTitle: $("imagePreviewTitle"), imagePreviewMeta: $("imagePreviewMeta"),
  imagePreviewThumbnails: $("imagePreviewThumbnails"), imagePreviewMain: $("imagePreviewMain"), closeImagePreview: $("closeImagePreviewButton"),
  previousImage: $("previousImageButton"), nextImage: $("nextImageButton"), imagePreviewApplication: $("imagePreviewApplication"),
  imagePreviewType: $("imagePreviewType"), imagePreviewCaseRef: $("imagePreviewCaseRef"), imagePreviewStatus: $("imagePreviewStatus"), imagePreviewPosition: $("imagePreviewPosition"),
  publicationModal: $("publicationModal"), publicationTitle: $("publicationModalTitle"), publicationMeta: $("publicationModalMeta"),
  publicationPages: $("publicationPages"), publicationLoading: $("publicationLoading"), closePublicationModal: $("closePublicationModalButton"), publicationTabs: $("publicationTabs"), publicationDocumentSelect: $("publicationDocumentSelect"), publicationAll: $("publicationAllCheckbox"), publicationAllLabel: $("publicationAllLabel"), publicationZoomOut: $("publicationZoomOutButton"), publicationZoomReset: $("publicationZoomResetButton"), publicationZoomIn: $("publicationZoomInButton"), printPublication: $("printPublicationButton"), savePublicationPdf: $("savePublicationPdfButton"),
  exportModal: $("exportModal"), closeExportModal: $("closeExportModalButton"), cancelExport: $("cancelExportButton"), runBatchExport: $("runBatchExportButton"), exportProgress: $("exportProgress"),
  changeHistoryModal: $("changeHistoryModal"), changeHistoryTitle: $("changeHistoryTitle"), changeHistoryMeta: $("changeHistoryMeta"), closeChangeHistory: $("closeChangeHistoryButton"),
  siteHistoryModal: $("siteHistoryModal"), closeSiteHistory: $("closeSiteHistoryButton"), siteHistoryTimeBasis: $("siteHistoryTimeBasis"), siteHistoryNote: $("siteHistoryNote"), siteHistoryPercent: $("siteHistoryPercent"), siteHistoryTotals: $("siteHistoryTotals"), siteHistoryDays: $("siteHistoryDays"), siteHistoryDayTitle: $("siteHistoryDayTitle"), siteHistoryDayStats: $("siteHistoryDayStats"), siteHistoryHours: $("siteHistoryHours"), siteHistoryChecksTitle: $("siteHistoryChecksTitle"), siteHistoryChecks: $("siteHistoryChecks"), siteHistoryEmpty: $("siteHistoryEmpty"),
  changeTimelineList: $("changeTimelineList"), changeComparisonTitle: $("changeComparisonTitle"), changeComparisonMeta: $("changeComparisonMeta"), changeComparisonCount: $("changeComparisonCount"), changeComparisonBody: $("changeComparisonBody"), changeComparisonEmpty: $("changeComparisonEmpty"), changeDiffHighlight: $("changeDiffHighlightCheckbox"),
  typographyModal: $("typographyModal"), closeTypography: $("closeTypographyButton"), saveTypography: $("saveTypographyButton"), resetTypography: $("resetTypographyButton"),
  interfaceFont: $("interfaceFontSelect"), headerFont: $("headerFontSelect"), contentFont: $("contentFontSelect"),
  interfaceFontSize: $("interfaceFontSize"), headerFontSize: $("headerFontSize"), contentFontSize: $("contentFontSize"),
  appColumnMinimum: $("appColumnMinimum"), registrationColumnMinimum: $("registrationColumnMinimum"), referenceColumnMinimum: $("referenceColumnMinimum"),
  attorneyColumnMinimum: $("attorneyColumnMinimum"), clientColumnMinimum: $("clientColumnMinimum"), applicantColumnMinimum: $("applicantColumnMinimum"),
  applicationtypeColumnMinimum: $("applicationtypeColumnMinimum"), wipostatusColumnMinimum: $("wipostatusColumnMinimum"), grantColumnMinimum: $("grantColumnMinimum"), expiryColumnMinimum: $("expiryColumnMinimum"), representativeColumnMinimum: $("representativeColumnMinimum"),
  dateColumnMinimum: $("dateColumnMinimum"), clockColumnMinimum: $("clockColumnMinimum"), statusColumnMinimum: $("statusColumnMinimum"), columnSortTypeGrid: $("columnSortTypeGrid"),
  appColumnHidden: $("appColumnHidden"), registrationColumnHidden: $("registrationColumnHidden"), referenceColumnHidden: $("referenceColumnHidden"), attorneyColumnHidden: $("attorneyColumnHidden"), clientColumnHidden: $("clientColumnHidden"), applicantColumnHidden: $("applicantColumnHidden"), dateColumnHidden: $("dateColumnHidden"), clockColumnHidden: $("clockColumnHidden"), statusColumnHidden: $("statusColumnHidden"),
  applicationtypeColumnHidden: $("applicationtypeColumnHidden"), wipostatusColumnHidden: $("wipostatusColumnHidden"), grantColumnHidden: $("grantColumnHidden"), expiryColumnHidden: $("expiryColumnHidden"), representativeColumnHidden: $("representativeColumnHidden"),
  appColumnSquishable: $("appColumnSquishable"), registrationColumnSquishable: $("registrationColumnSquishable"), referenceColumnSquishable: $("referenceColumnSquishable"), attorneyColumnSquishable: $("attorneyColumnSquishable"), clientColumnSquishable: $("clientColumnSquishable"), applicantColumnSquishable: $("applicantColumnSquishable"), dateColumnSquishable: $("dateColumnSquishable"), clockColumnSquishable: $("clockColumnSquishable"), statusColumnSquishable: $("statusColumnSquishable"),
  applicationtypeColumnSquishable: $("applicationtypeColumnSquishable"), wipostatusColumnSquishable: $("wipostatusColumnSquishable"), grantColumnSquishable: $("grantColumnSquishable"), expiryColumnSquishable: $("expiryColumnSquishable"), representativeColumnSquishable: $("representativeColumnSquishable"),
};

const state = {
  queue: [], requestQueue: [], requestResults: new Map(), selectedRequest: "", hagueQueue: [], hagueResults: new Map(), hagueHistory: new Map(), haguePublicationIndex: new Map(), hagueLoading: new Set(), haguePending: [], selectedHague: "", hagueSelectedSnapshotId: "", hagueLoadError: "", hagueRenderedNumber: "", hagueRenderedView: "", hagueRenderedSignature: "", changeHistoryMode: "application", requestPublicationDocument: null, requestViewerKey: "", requestViewerPending: false, requestNativePdfFallback: false, records: new Map(), selected: "", detail: null, exportMode: false, exportSelection: new Set(), running: false,
  namedLists: [], activeListId: "default", caseRefsByApplication: {}, lookedUpCaseRefs: {}, statusMetadataByApplication: {}, registrationsByApplication: {}, lookedUpRegistrations: {}, maybeUnpublished: new Set(), notFound: new Set(), siteUnavailable: new Set(), listRequestToken: 0, lookupRestartNotified: false,
  scrapingIds: new Set(), scrapeQueuedIds: new Set(), scrapeQueue: [], scrapeRequestCounts: new Map(), rescrapeClickCounts: new Map(), remoteScrapeStates: new Map(), scrapeActiveCount: 0, duplicatePulseIds: new Set(),
  detailCache: new Map(), detailJobs: new Map(), detailGenerations: new Map(), detailRequestToken: 0,
  publicationDocuments: [], publicationDocument: null, publicationCategory: "publication_a", publicationContext: null, publicationCache: new Map(), publicationRequestToken: 0,
  mediaPreview: { images: [], name: "", kind: "", index: 0, applicationNo: "" },
  changeHistorySnapshotId: "", changeDiffHighlight: localStorage.getItem("wipoTrackerChangeDiffHighlight") === "true",
  caseSortActions: [], caseSortTypes: {},
};
let toastTimer;
const duplicatePulseTimers = new Map();
const rescrapeConfirmationTimers = new Map();
let publicationReturnFocus = null;
let changeHistoryReturnFocus = null;
let recordRefreshChain = Promise.resolve();
let removeListTargetId = "";
let headerSyncPending = false;
let scrapeDrainTimer = null;
let scrapeLastDispatchAt = 0;
let scrapePriorityLookupPending = 0;
let scrapePriorityGeneration = 0;
const httpLogBuffers = new Map();
let hagueDrainTimer = null;
let hagueLastDispatchAt = 0;
let alternatingResultTimer = null;
let alternatingFadeTimer = null;
let showingChangeResults = false;
let alternatingResultFading = false;
let caseListPointerDown = false;
let pendingCaseListRender = false;
let caseScrollbarWidth = 0;
let requestRecoveryPending = false;
let interfaceScaleValue = 1;
const caseColumnHandles = new Map();

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
  caseScrollbarWidth = width;
  els.casePanel.style.setProperty("--case-scrollbar-width", `${width}px`);
}

function resizeTextInput(input) {
  input.style.height = "38px";
  const contentHeight = input.scrollHeight || 38;
  input.style.height = `${Math.min(180, Math.max(38, contentHeight))}px`;
  input.style.overflowY = contentHeight > 180 ? "auto" : "hidden";
}

function resizeApplicationInput() { resizeTextInput(els.input); }
function resizeRegistrationInput() { resizeTextInput(els.registrationInput); }
function resizeRequestInput() { resizeTextInput(els.requestInput); }

const INPUT_MODES = ["application", "registration", "request"];
const INPUT_MODE_FIELDS = { application: "applicationInput", registration: "registrationInput", request: "requestInput" };
function setInputMode(mode, { focusInput = false, persist = true } = {}) {
  const selected = INPUT_MODES.includes(mode) ? mode : "application";
  for (const name of INPUT_MODES) {
    const active = name === selected;
    const tab = $(`${name}InputTab`);
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`${name}InputPanel`).classList.toggle("hidden", !active);
  }
  if (persist) localStorage.setItem("wipoTrackerInputMode", selected);
  const input = $(INPUT_MODE_FIELDS[selected]);
  resizeTextInput(input);
  if (focusInput) input.focus();
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
  const match = text.match(/(?:^|[^A-Z0-9])([1-5]-\d{4}-\d{4,})(?![A-Z0-9])/i);
  if (match) return match[1];
  const madrid = text.match(/(?:^|[^A-Z0-9])(5-\d{5,9}[A-Z]?)(?![A-Z0-9])/i);
  if (madrid) return madrid[1];
  const compact = text.match(/(?:^|[^A-Z0-9])(?:VN)?([1-5])(\d{4})(\d{4,})(?![A-Z0-9])/i);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : "";
}

function parseInput(value) {
  const text = String(value || "");
  const found = [...text.matchAll(/(?:^|[^A-Z0-9])([1-5]-\d{4}-\d{4,})(?![A-Z0-9])/gi)].map((match) => match[1]);
  for (const match of text.matchAll(/(?:^|[^A-Z0-9])(5-\d{5,9}[A-Z]?)(?![A-Z0-9])/gi)) found.push(match[1]);
  for (const match of text.matchAll(/(?:^|[^A-Z0-9])(?:VN)?([1-5])(\d{4})(\d{4,})(?![A-Z0-9])/gi)) found.push(`${match[1]}-${match[2]}-${match[3]}`);
  return [...new Set(found.map(normalize).filter(Boolean))];
}

function normalizeHagueNo(value) {
  const match = String(value || "").trim().toUpperCase().match(/^DM\s*\/?\s*(\d{3})\s*(\d{3})$/);
  return match ? `DM/${match[1]}${match[2]}` : "";
}

function parseHagueNos(value) {
  return [...new Set([...String(value || "").matchAll(/(?:^|[^A-Z0-9])DM\s*\/?\s*(\d{3})\s*(\d{3})(?![A-Z0-9])/gi)]
    .map(match => `DM/${match[1]}${match[2]}`))];
}

function normalizeRequestNo(value) {
  const text = String(value || "").trim().toUpperCase();
  return /^(?:DT[12]|GH[34])-\d{4}-\d{5}$/.test(text) ? text : "";
}

function parseRequestNos(value) {
  return [...new Set([...String(value || "").toUpperCase().matchAll(/(?:^|[^A-Z0-9])((?:DT[12]|GH[34])-\d{4}-\d{5})(?![A-Z0-9])/g)]
    .map((match) => normalizeRequestNo(match[1])).filter(Boolean))];
}

function requestCaseFamily(value) { return String(value).startsWith("GH4-") ? "TA" : String(value).startsWith("GH3-") ? "DA" : "PF"; }
function requestKindLabel(value) { return String(value).startsWith("GH4-") ? "Trademark renewal" : String(value).startsWith("GH3-") ? "Design renewal" : String(value).startsWith("DT2-") ? "Utility-solution annuity" : "Patent annuity"; }

function parseCaseRefs(value) {
  return [...new Set((String(value || "").match(/\bIP[\/\\-](?:PR|TR|DR)\s*\d+(?:\/[A-Z0-9-]+)*/gi) || [])
    .map((ref) => ref.toUpperCase().replace(/\s+/g, "").replace(/^IP[-\\](PR|TR|DR)/, "IP/$1")))];
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
    active.requestQueue = [...state.requestQueue];
    active.hagueQueue = [...state.hagueQueue];
    active.refsByApplication = Object.fromEntries(Object.entries(state.caseRefsByApplication)
      .filter(([appNo, refs]) => state.queue.includes(appNo) && Array.isArray(refs) && refs.length));
    active.registrationsByApplication = Object.fromEntries(Object.entries(state.registrationsByApplication)
      .filter(([appNo, registration]) => state.queue.includes(appNo) && registration?.formatted));
    active.maybeUnpublished = [...state.maybeUnpublished].filter((appNo) => state.queue.includes(appNo));
    active.notFound = [...state.notFound].filter((appNo) => state.queue.includes(appNo));
    active.siteUnavailable = [...state.siteUnavailable].filter((appNo) => state.queue.includes(appNo));
  }
  localStorage.setItem("wipoTrackerNamedLists", JSON.stringify({ activeId: state.activeListId, lists: state.namedLists }));
  localStorage.setItem("wipoTrackerQueue", JSON.stringify(state.queue));
  scheduleEmbeddedSourceState();
}

let embeddedSourceSyncTimer;
function scheduleEmbeddedSourceState() {
  if (!document.documentElement.classList.contains('embed-source') || window.parent === window) return;
  clearTimeout(embeddedSourceSyncTimer);
  embeddedSourceSyncTimer = setTimeout(() => {
    window.parent.postMessage({ type: 'softip-wipo-source-state',
      applicationNos: [...state.queue], requestNos: [...state.requestQueue] }, '*');
  }, 40);
}

window.addEventListener('message', (event) => {
  if (event.source === window.parent && event.data?.type === 'softip-wipo-source-request') scheduleEmbeddedSourceState();
  if (event.source !== window.parent || !document.documentElement.classList.contains('embed-detail')
      || event.data?.type !== 'softip-wipo-detail-open') return;
  openEmbeddedDetailRecord(event.data.kind, event.data.id);
});

function openEmbeddedDetailRecord(kind, value) {
  const id = String(value || '').trim();
  if (kind === 'application' && normalize(id)) openDetail(id);
  else if (kind === 'request' && normalizeRequestNo(id)) openRequestDetail(id);
  else if (kind === 'hague' && /^DM\/\d+/i.test(id)) openHagueDetail(id);
}

function notifyEmbeddedRecordOpen(kind, id) {
  if (!document.documentElement.classList.contains('embed-source') || window.parent === window || !id) return;
  window.parent.postMessage({ type: 'softip-wipo-record-open', kind, id }, '*');
}

function saveQueue() { saveNamedLists(); }

function loadNamedLists() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem("wipoTrackerNamedLists") || "null"); } catch { saved = null; }
  let legacyQueue = [];
  try { legacyQueue = JSON.parse(localStorage.getItem("wipoTrackerQueue") || "[]"); } catch {}
  const normalizeQueue = (queue) => [...new Set((Array.isArray(queue) ? queue : []).map(normalize).filter(Boolean))];
  const normalizeRequests = (queue) => [...new Set((Array.isArray(queue) ? queue : []).map(normalizeRequestNo).filter(Boolean))];
  const normalizeRefs = (refs, queue) => Object.fromEntries(Object.entries(refs && typeof refs === "object" ? refs : {})
    .filter(([appNo]) => queue.includes(normalize(appNo)))
    .map(([appNo, values]) => [normalize(appNo), parseCaseRefs(Array.isArray(values) ? values.join("\n") : values)]));
  const normalizeRegistrations = (registrations, queue) => Object.fromEntries(Object.entries(registrations && typeof registrations === "object" ? registrations : {})
    .filter(([appNo, registration]) => queue.includes(normalize(appNo)) && registration?.formatted)
    .map(([appNo, registration]) => [normalize(appNo), { ...registration }]));
  const lists = Array.isArray(saved?.lists) ? saved.lists
    .filter((list) => list && typeof list.id === "string" && typeof list.name === "string")
    .map((list) => { const queue = normalizeQueue(list.queue); return { id: list.id, name: list.name.trim().slice(0, 60) || "Untitled list", queue, requestQueue: normalizeRequests(list.requestQueue), hagueQueue: [...new Set((Array.isArray(list.hagueQueue) ? list.hagueQueue : []).map(normalizeHagueNo).filter(Boolean))], refsByApplication: normalizeRefs(list.refsByApplication, queue), registrationsByApplication: normalizeRegistrations(list.registrationsByApplication, queue), maybeUnpublished: (Array.isArray(list.maybeUnpublished) ? list.maybeUnpublished : []).map(normalize).filter((appNo) => queue.includes(appNo)), notFound: (Array.isArray(list.notFound) ? list.notFound : []).map(normalize).filter((appNo) => queue.includes(appNo)), siteUnavailable: (Array.isArray(list.siteUnavailable) ? list.siteUnavailable : []).map(normalize).filter((appNo) => queue.includes(appNo)) }; }) : [];
  state.namedLists = lists.length ? lists : [{ id: "default", name: "Default list", queue: normalizeQueue(legacyQueue), requestQueue: [], refsByApplication: {}, registrationsByApplication: {}, maybeUnpublished: [], notFound: [] }];
  state.activeListId = state.namedLists.some((list) => list.id === saved?.activeId) ? saved.activeId : state.namedLists[0].id;
  const activeList = state.namedLists.find((list) => list.id === state.activeListId);
  state.queue = [...activeList.queue];
  state.requestQueue = [...(activeList.requestQueue || [])];
  state.hagueQueue = [...(activeList.hagueQueue || [])];
  state.caseRefsByApplication = { ...activeList.refsByApplication };
  state.registrationsByApplication = { ...activeList.registrationsByApplication };
  state.maybeUnpublished = new Set(activeList.maybeUnpublished);
  state.notFound = new Set(activeList.notFound);
  state.siteUnavailable = new Set(activeList.siteUnavailable);
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
  state.requestQueue = [...(selectedList.requestQueue || [])];
  state.hagueQueue = [...(selectedList.hagueQueue || [])];
  state.requestResults = new Map();
  state.selectedRequest = "";
  state.hagueResults = new Map();
  state.hagueHistory = new Map();
  state.hagueSelectedSnapshotId = "";
  state.hagueLoadError = "";
  state.hagueRenderedSignature = "";
  state.haguePending = [];
  if (hagueDrainTimer) { clearTimeout(hagueDrainTimer); hagueDrainTimer = null; }
  state.hagueLoading.clear();
  state.selectedHague = "";
  els.hagueDetail.classList.add("hidden");
  clearRequestPublicationViewer();
  state.caseRefsByApplication = { ...selectedList.refsByApplication };
  state.lookedUpCaseRefs = {};
  state.statusMetadataByApplication = {};
  state.registrationsByApplication = { ...selectedList.registrationsByApplication };
  state.lookedUpRegistrations = {};
  state.maybeUnpublished = new Set(selectedList.maybeUnpublished);
  state.notFound = new Set(selectedList.notFound);
  state.siteUnavailable = new Set(selectedList.siteUnavailable);
  state.selected = "";
  state.detail = null;
  state.records = new Map();
  state.exportMode = false;
  state.exportSelection.clear();
  els.detailContent.classList.add("hidden");
  els.requestDetail.classList.add("hidden");
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
  state.namedLists.push({ id, name: `New list ${number}`, queue: [], requestQueue: [], hagueQueue: [], refsByApplication: {}, registrationsByApplication: {}, maybeUnpublished: [], notFound: [] });
  selectNamedList(id).then(beginRenameList).catch((error) => showToast(error.message, true));
}

function openRemoveListModal() {
  if (state.running || !els.namedListName.classList.contains("hidden")) return;
  const active = state.namedLists.find((list) => list.id === state.activeListId);
  if (!active) return;
  removeListTargetId = active.id;
  els.removeListMessage.textContent = `Remove “${active.name}” and its ${active.queue.length + (active.requestQueue?.length || 0) + (active.hagueQueue?.length || 0)} item(s) from saved lists?`;
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
  if (!state.namedLists.length) state.namedLists.push({ id: `list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: "Default list", queue: [], requestQueue: [], refsByApplication: {}, maybeUnpublished: [], notFound: [] });
  const next = state.namedLists[Math.min(index, state.namedLists.length - 1)];
  closeRemoveListModal();
  await selectNamedList(next.id);
  showToast(`Removed saved list “${removedName}”. Stored snapshots were not deleted.`);
}

function applyCompactList(compact, persist = true) {
  const enabled = Boolean(compact);
  els.casePanel.classList.toggle("compact-list", enabled);
  els.compactList.setAttribute("aria-pressed", enabled ? "true" : "false");
  const currentMode = enabled ? "Details" : "Default";
  const nextMode = enabled ? "Default" : "Details";
  els.compactList.querySelector(".list-density-label").textContent = currentMode;
  els.compactList.title = `${currentMode} view active. Switch to ${nextMode} view`;
  els.compactList.setAttribute("aria-label", `${currentMode} view active. Switch to ${nextMode} view`);
  if (persist) localStorage.setItem("wipoTrackerCompactList", enabled ? "1" : "0");
  syncCaseColumnVisibility();
  if (els.casePanel.getBoundingClientRect().width) fitProtectedColumnsToPane(els.casePanel.getBoundingClientRect().width);
}

function renderCasePaneWidth(width, minimum, maximum, persist = true, fitColumns = true, updateHandle = true) {
  const bounded = Math.min(maximum, Math.max(minimum, Math.round(Number(width) || 0)));
  document.documentElement.style.setProperty("--case-pane-width", `${bounded}px`);
  if (fitColumns) fitProtectedColumnsToPane(bounded);
  if (updateHandle) {
    els.workspaceResizer.setAttribute("aria-valuemin", String(minimum));
    els.workspaceResizer.setAttribute("aria-valuemax", String(maximum));
    els.workspaceResizer.setAttribute("aria-valuenow", String(bounded));
  }
  if (persist) localStorage.setItem("wipoTrackerCasePaneWidth", String(bounded));
  return bounded;
}

function setCasePaneWidth(width, persist = true, fitColumns = true) {
  const workspaceWidth = els.workspace.getBoundingClientRect().width || window.innerWidth;
  const minimum = protectedCasePaneWidth();
  const maximum = Math.max(minimum, workspaceWidth - 427);
  return renderCasePaneWidth(width, minimum, maximum, persist, fitColumns);
}

function resetCasePaneWidth() {
  document.documentElement.style.removeProperty("--case-pane-width");
  localStorage.removeItem("wipoTrackerCasePaneWidth");
  const width = els.casePanel.getBoundingClientRect().width;
  const minimum = protectedCasePaneWidth();
  if (width < minimum) setCasePaneWidth(minimum, false);
  else {
    els.workspaceResizer.setAttribute("aria-valuemin", String(minimum));
    els.workspaceResizer.setAttribute("aria-valuenow", String(Math.round(width)));
  }
}

function initializeWorkspaceResizer() {
  const storedWidth = Number.parseInt(localStorage.getItem("wipoTrackerCasePaneWidth") || "", 10);
  if (Number.isFinite(storedWidth)) setCasePaneWidth(storedWidth, false);
  let startX = 0;
  let startWidth = 0;
  let pendingWidth = null;
  let resizeFrame = 0;
  let dragMinimum = MIN_CASE_PANE_WIDTH;
  let dragMaximum = MIN_CASE_PANE_WIDTH;
  const applyPendingWidth = () => {
    resizeFrame = 0;
    if (pendingWidth === null) return;
    const width = pendingWidth;
    pendingWidth = null;
    renderCasePaneWidth(width, dragMinimum, dragMaximum, false, true, false);
  };
  els.workspaceResizer.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
    startWidth = els.casePanel.getBoundingClientRect().width;
    const workspaceWidth = els.workspace.getBoundingClientRect().width || window.innerWidth;
    dragMinimum = protectedCasePaneWidth();
    dragMaximum = Math.max(dragMinimum, workspaceWidth - 427);
    pendingWidth = null;
    document.body.classList.add("resizing-workspace");
    els.workspaceResizer.setPointerCapture?.(event.pointerId);
  });
  els.workspaceResizer.addEventListener("pointermove", (event) => {
    if (!document.body.classList.contains("resizing-workspace")) return;
    pendingWidth = startWidth + event.clientX - startX;
    if (resizeFrame) return;
    if (window.requestAnimationFrame) resizeFrame = window.requestAnimationFrame(applyPendingWidth);
    else applyPendingWidth();
  });
  const stopResize = (event) => {
    if (!document.body.classList.contains("resizing-workspace")) return;
    if (resizeFrame && window.cancelAnimationFrame) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    applyPendingWidth();
    const finalWidth = Number.parseFloat(document.documentElement.style.getPropertyValue("--case-pane-width")) || startWidth;
    renderCasePaneWidth(finalWidth, dragMinimum, dragMaximum, false, false, true);
    document.body.classList.remove("resizing-workspace");
    els.workspaceResizer.releasePointerCapture?.(event.pointerId);
    localStorage.setItem("wipoTrackerCasePaneWidth", els.workspaceResizer.getAttribute("aria-valuenow"));
    persistCaseColumnWidths();
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

const CASE_COLUMN_MINIMUM_INPUTS = {
  app: "appColumnMinimum",
  registration: "registrationColumnMinimum",
  reference: "referenceColumnMinimum",
  attorney: "attorneyColumnMinimum",
  client: "clientColumnMinimum",
  applicant: "applicantColumnMinimum",
  applicationtype: "applicationtypeColumnMinimum",
  wipostatus: "wipostatusColumnMinimum",
  grant: "grantColumnMinimum",
  expiry: "expiryColumnMinimum",
  representative: "representativeColumnMinimum",
  date: "dateColumnMinimum",
  clock: "clockColumnMinimum",
  status: "statusColumnMinimum",
};
const CASE_COLUMN_BEHAVIOR_INPUTS = {
  app: { hidden: "appColumnHidden", squishable: "appColumnSquishable" },
  registration: { hidden: "registrationColumnHidden", squishable: "registrationColumnSquishable" },
  reference: { hidden: "referenceColumnHidden", squishable: "referenceColumnSquishable" },
  attorney: { hidden: "attorneyColumnHidden", squishable: "attorneyColumnSquishable" },
  client: { hidden: "clientColumnHidden", squishable: "clientColumnSquishable" },
  applicant: { hidden: "applicantColumnHidden", squishable: "applicantColumnSquishable" },
  applicationtype: { hidden: "applicationtypeColumnHidden", squishable: "applicationtypeColumnSquishable" },
  wipostatus: { hidden: "wipostatusColumnHidden", squishable: "wipostatusColumnSquishable" },
  grant: { hidden: "grantColumnHidden", squishable: "grantColumnSquishable" },
  expiry: { hidden: "expiryColumnHidden", squishable: "expiryColumnSquishable" },
  representative: { hidden: "representativeColumnHidden", squishable: "representativeColumnSquishable" },
  date: { hidden: "dateColumnHidden", squishable: "dateColumnSquishable" },
  clock: { hidden: "clockColumnHidden", squishable: "clockColumnSquishable" },
  status: { hidden: "statusColumnHidden", squishable: "statusColumnSquishable" },
};
const CASE_COLUMN_ALIGNMENT_KEYS = ["app", "registration", "reference", "attorney", "client", "applicant", "applicationtype", "wipostatus", "grant", "expiry", "representative", "date", "clock", "status"];
const CASE_COLUMN_ALIGNMENT_DEFAULTS = Object.fromEntries(CASE_COLUMN_ALIGNMENT_KEYS.map((key) => [key, { header: "center", content: "left" }]));
const CASE_COLUMN_BEHAVIOR_VERSION = "3";
const DEFAULT_VIEW_COLUMNS = new Set(["app", "registration", "reference", "date", "status"]);
let caseColumnBehavior = Object.fromEntries(Object.keys(CASE_COLUMN_BEHAVIOR_INPUTS).map((key) => [key, { hidden: Boolean(CASE_COLUMNS[key]?.defaultHidden), squishable: CASE_COLUMNS[key]?.defaultSquishable !== false }]));

function isDetailsView() { return els.casePanel.classList.contains("compact-list"); }
function isColumnHidden(key) { return isDetailsView() ? Boolean(caseColumnBehavior[key]?.hidden) : !DEFAULT_VIEW_COLUMNS.has(key); }
function isColumnSquishable(key) { return caseColumnBehavior[key]?.squishable !== false; }

function syncCaseColumnVisibility() {
  for (const key of Object.keys(CASE_COLUMN_BEHAVIOR_INPUTS)) els.casePanel.classList.toggle(`hide-col-${key}`, isColumnHidden(key));
}

function applyCaseColumnBehavior(values = {}, persist = true) {
  const normalized = {};
  for (const [key, inputs] of Object.entries(CASE_COLUMN_BEHAVIOR_INPUTS)) {
    normalized[key] = {
      hidden: CASE_COLUMNS[key]?.canHide !== false && (values[key]?.hidden === undefined ? Boolean(CASE_COLUMNS[key]?.defaultHidden) : Boolean(values[key].hidden)),
      squishable: CASE_COLUMNS[key]?.canSquish !== false && (values[key]?.squishable === undefined ? CASE_COLUMNS[key]?.defaultSquishable !== false : values[key].squishable !== false),
    };
    els[inputs.hidden].checked = normalized[key].hidden;
    els[inputs.squishable].checked = normalized[key].squishable;
    els[inputs.hidden].disabled = CASE_COLUMNS[key]?.canHide === false;
    els[inputs.squishable].disabled = CASE_COLUMNS[key]?.canSquish === false;
    els.casePanel.classList.toggle(`no-squish-col-${key}`, !normalized[key].squishable);
  }
  caseColumnBehavior = normalized;
  syncCaseColumnVisibility();
  if (persist) {
    localStorage.setItem("wipoTrackerCaseColumnBehavior", JSON.stringify(normalized));
    localStorage.setItem("wipoTrackerCaseColumnBehaviorVersion", CASE_COLUMN_BEHAVIOR_VERSION);
    const currentWidth = els.casePanel.getBoundingClientRect().width;
    setCasePaneWidth(Math.max(protectedCasePaneWidth(), currentWidth), true);
  }
  return normalized;
}

function loadCaseColumnBehavior() {
  try {
    const saved = JSON.parse(localStorage.getItem("wipoTrackerCaseColumnBehavior") || "{}");
    if (localStorage.getItem("wipoTrackerCaseColumnBehaviorVersion") !== CASE_COLUMN_BEHAVIOR_VERSION) {
      const legacyKeys = Object.keys(CASE_COLUMN_BEHAVIOR_INPUTS).filter((key) => CASE_COLUMNS[key]?.canSquish !== false);
      const wasLegacyAllEnabled = legacyKeys.every((key) => saved[key]?.squishable !== false);
      if (wasLegacyAllEnabled) {
        for (const key of legacyKeys) saved[key] = { ...saved[key], squishable: CASE_COLUMNS[key]?.defaultSquishable !== false };
      }
      const normalized = applyCaseColumnBehavior(saved, false);
      localStorage.setItem("wipoTrackerCaseColumnBehavior", JSON.stringify(normalized));
      localStorage.setItem("wipoTrackerCaseColumnBehaviorVersion", CASE_COLUMN_BEHAVIOR_VERSION);
      return normalized;
    }
    return applyCaseColumnBehavior(saved, false);
  }
  catch { return applyCaseColumnBehavior({}, false); }
}

function normalizeColumnAlignment(value, fallback) {
  return ["left", "center", "right"].includes(value) ? value : fallback;
}

function applyCaseColumnAlignments(values = {}, persist = true) {
  const normalized = {};
  const justify = { left: "flex-start", center: "center", right: "flex-end" };
  for (const key of CASE_COLUMN_ALIGNMENT_KEYS) {
    const defaults = CASE_COLUMN_ALIGNMENT_DEFAULTS[key];
    const header = normalizeColumnAlignment(values[key]?.header, defaults.header);
    const content = normalizeColumnAlignment(values[key]?.content, defaults.content);
    normalized[key] = { header, content };
    els.casePanel.style.setProperty(`--case-${key}-header-justify`, justify[header]);
    els.casePanel.style.setProperty(`--case-${key}-header-text`, header);
    els.casePanel.style.setProperty(`--case-${key}-content-justify`, justify[content]);
    els.casePanel.style.setProperty(`--case-${key}-content-text`, content);
    const headerControl = document.querySelector(`[data-case-alignment-column="${key}"][data-case-alignment-target="header"]`);
    const contentControl = document.querySelector(`[data-case-alignment-column="${key}"][data-case-alignment-target="content"]`);
    if (headerControl) headerControl.value = header;
    if (contentControl) contentControl.value = content;
  }
  if (persist) localStorage.setItem("wipoTrackerCaseColumnAlignments", JSON.stringify(normalized));
  return normalized;
}

function loadCaseColumnAlignments() {
  try { return applyCaseColumnAlignments(JSON.parse(localStorage.getItem("wipoTrackerCaseColumnAlignments") || "{}"), false); }
  catch { return applyCaseColumnAlignments({}, false); }
}

const CASE_SORT_COLUMNS = {
  app: { label: "APP NO.", defaultType: "text" },
  registration: { label: "Reg No.", defaultType: "text" },
  reference: { label: "Case ref", defaultType: "text" },
  attorney: { label: "Attorney", defaultType: "text" },
  client: { label: "Client", defaultType: "text" },
  applicant: { label: "Applicant", defaultType: "text" },
  applicationtype: { label: "Application type", defaultType: "text" },
  wipostatus: { label: "Status", defaultType: "text" },
  grant: { label: "Grant no. / date", defaultType: "text" },
  expiry: { label: "Expiry date", defaultType: "number" },
  representative: { label: "IP representatives", defaultType: "text" },
  date: { label: "Date", defaultType: "number" },
  clock: { label: "Time", defaultType: "number" },
  status: { label: "Result", defaultType: "text" },
};
const CASE_SORT_TYPES_STORAGE_KEY = "wipoTrackerCaseSortTypes";
const CASE_SORT_ACTIONS_STORAGE_KEY = "wipoTrackerCaseSortActions";
const caseSortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function defaultCaseSortTypes() {
  return Object.fromEntries(Object.entries(CASE_SORT_COLUMNS).map(([key, config]) => [key, config.defaultType]));
}

function applyCaseSortTypes(values = {}, persist = true) {
  const defaults = defaultCaseSortTypes();
  state.caseSortTypes = Object.fromEntries(Object.keys(CASE_SORT_COLUMNS).map((key) => [key, values[key] === "number" ? "number" : (values[key] === "text" ? "text" : defaults[key])]));
  els.columnSortTypeGrid.querySelectorAll("[data-case-sort-type]").forEach((control) => { control.value = state.caseSortTypes[control.dataset.caseSortType]; });
  if (persist) localStorage.setItem(CASE_SORT_TYPES_STORAGE_KEY, JSON.stringify(state.caseSortTypes));
  return state.caseSortTypes;
}

function loadCaseSortTypes() {
  try { return applyCaseSortTypes(JSON.parse(localStorage.getItem(CASE_SORT_TYPES_STORAGE_KEY) || "{}"), false); }
  catch { return applyCaseSortTypes({}, false); }
}

function saveCaseSortActions() {
  localStorage.setItem(CASE_SORT_ACTIONS_STORAGE_KEY, JSON.stringify(state.caseSortActions));
}

function loadCaseSortActions() {
  try {
    const saved = JSON.parse(localStorage.getItem(CASE_SORT_ACTIONS_STORAGE_KEY) || "[]");
    state.caseSortActions = Array.isArray(saved) ? saved.filter((action) => CASE_SORT_COLUMNS[action?.key] && ["asc", "desc"].includes(action?.direction)).map((action) => ({ key: action.key, direction: action.direction })) : [];
  } catch { state.caseSortActions = []; }
}

function renderCaseSortTypeSettings() {
  for (const [key, config] of Object.entries(CASE_SORT_COLUMNS)) {
    const row = document.querySelector(`[data-case-alignment-column="${key}"]`)?.closest(".column-setting-row");
    if (!row || row.querySelector("[data-case-sort-type]")) continue;
    row.insertAdjacentHTML("beforeend", `<select class="column-sort-type-select" data-case-sort-type="${key}" aria-label="${escapeHtml(config.label)} sort interpretation"><option value="text">String</option><option value="number">Number</option></select>`);
  }
  els.columnSortTypeGrid.addEventListener("change", (event) => {
    const control = event.target.closest("[data-case-sort-type]");
    if (!control) return;
    applyCaseSortTypes({ ...state.caseSortTypes, [control.dataset.caseSortType]: control.value });
    renderList();
  });
}

function caseSortDisplayValue(appNo, key) {
  const record = state.records.get(appNo);
  const refs = caseRefsForApplication(appNo);
  const registration = registrationForApplication(appNo);
  const metadata = statusMetadataForCaseRef(appNo, refs[0]);
  if (key === "app") return appNo;
  if (key === "registration") return registration?.formatted || "";
  if (key === "reference") return refs[0] || "";
  if (key === "attorney") return metadata.attorney || "";
  if (key === "client") return metadata.client || "";
  if (key === "applicant") return metadata.applicant || "";
  if (key === "applicationtype") return record?.applicationType || "";
  if (key === "wipostatus") return record?.status || "";
  if (key === "grant") return record?.grantNumberDate || "";
  if (key === "expiry") return record?.expiryDate || "";
  if (key === "representative") return record?.ipRepresentatives || "";
  if (key === "date") return record?.lastScrapedAt ? formatDate(record.lastScrapedAt, false) : "";
  if (key === "clock") {
    if (!record?.lastScrapedAt) return "";
    const full = formatDate(record.lastScrapedAt);
    const date = formatDate(record.lastScrapedAt, false);
    return full.slice(date.length).trim();
  }
  if (key === "status") {
    if (state.siteUnavailable.has(appNo)) return "WIPO site down";
    if (state.notFound.has(appNo) && !record) return "Not found";
    if (state.maybeUnpublished.has(appNo) && !record) return "Not yet published?";
    return ageText(record?.lastScrapedAt) || "";
  }
  return "";
}

function caseSortNumericValue(raw, key) {
  if (key === "date" || key === "expiry") {
    const match = String(raw || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return match ? Number(`${match[3]}${match[2]}${match[1]}`) : null;
  }
  if (key === "clock") {
    const match = String(raw || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    return match ? (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3] || 0) : null;
  }
  const digits = String(raw || "").replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

function compareCaseSortValues(left, right, action) {
  const leftRaw = caseSortDisplayValue(left.appNo, action.key);
  const rightRaw = caseSortDisplayValue(right.appNo, action.key);
  const type = state.caseSortTypes[action.key] || CASE_SORT_COLUMNS[action.key].defaultType;
  const leftValue = type === "number" ? caseSortNumericValue(leftRaw, action.key) : String(leftRaw || "").trim();
  const rightValue = type === "number" ? caseSortNumericValue(rightRaw, action.key) : String(rightRaw || "").trim();
  const leftBlank = leftValue === null || leftValue === "" || (typeof leftValue === "number" && !Number.isFinite(leftValue));
  const rightBlank = rightValue === null || rightValue === "" || (typeof rightValue === "number" && !Number.isFinite(rightValue));
  if (leftBlank !== rightBlank) return leftBlank ? 1 : -1;
  if (leftBlank) return 0;
  const compared = type === "number" ? leftValue - rightValue : caseSortCollator.compare(leftValue, rightValue);
  return action.direction === "desc" ? -compared : compared;
}

function sortedCaseApplications() {
  const decorated = state.queue.map((appNo, sourceIndex) => ({ appNo, sourceIndex }));
  for (const action of state.caseSortActions) decorated.sort((left, right) => compareCaseSortValues(left, right, action));
  return decorated.map((entry) => entry.appNo);
}

function updateCaseSortHeaders() {
  document.querySelectorAll(".case-sort-button").forEach((button) => {
    const key = button.dataset.caseSort;
    const index = state.caseSortActions.findIndex((action) => action.key === key);
    const action = index >= 0 ? state.caseSortActions[index] : null;
    const priority = action ? state.caseSortActions.length - index : "";
    button.classList.toggle("active", Boolean(action));
    button.classList.toggle("sort-ascending", action?.direction === "asc");
    button.classList.toggle("sort-descending", action?.direction === "desc");
    button.querySelector(".case-sort-priority").textContent = priority;
    button.querySelector(".case-sort-direction").textContent = action?.direction === "asc" ? "▲" : (action?.direction === "desc" ? "▼" : "");
    button.setAttribute("aria-pressed", action ? "true" : "false");
    const nextAction = !action ? "Sort ascending" : (action.direction === "asc" ? "Sort descending" : "Clear sorting");
    button.title = `${nextAction}: ${CASE_SORT_COLUMNS[key].label}`;
    button.setAttribute("aria-label", `${CASE_SORT_COLUMNS[key].label}. ${action ? `Sort priority ${priority}, ${action.direction === "asc" ? "ascending" : "descending"}. ` : "Not sorted. "}${nextAction}.`);
  });
  els.resetSort.disabled = state.caseSortActions.length === 0;
}

function cycleCaseSort(key) {
  if (!CASE_SORT_COLUMNS[key]) return;
  const existing = state.caseSortActions.find((action) => action.key === key);
  state.caseSortActions = state.caseSortActions.filter((action) => action.key !== key);
  if (!existing) state.caseSortActions.push({ key, direction: "asc" });
  else if (existing.direction === "asc") state.caseSortActions.push({ key, direction: "desc" });
  saveCaseSortActions();
  renderList();
}

function resetCaseSort() {
  state.caseSortActions = [];
  saveCaseSortActions();
  renderList();
}

function initializeCaseSorting() {
  renderCaseSortTypeSettings();
  loadCaseSortTypes();
  loadCaseSortActions();
  document.querySelectorAll(".case-sort-button").forEach((button) => button.addEventListener("click", () => cycleCaseSort(button.dataset.caseSort)));
  els.resetSort.addEventListener("click", resetCaseSort);
  updateCaseSortHeaders();
}

function columnMinimum(key) {
  return CASE_COLUMNS[key]?.minimum ?? CASE_COLUMNS[key]?.defaultMinimum ?? 0;
}

function columnSizeLimits(key) {
  const config = CASE_COLUMNS[key];
  return { minimum: 44, maximum: Math.min(config.maximum, config.defaultMinimum + 80) };
}

function normalizeCaseColumnMinimums(values = {}) {
  const normalized = {};
  for (const [key, inputName] of Object.entries(CASE_COLUMN_MINIMUM_INPUTS)) {
    const config = CASE_COLUMNS[key];
    const limits = columnSizeLimits(key);
    normalized[key] = boundedNumber(values[key], limits.minimum, limits.maximum, config.defaultMinimum);
    if (els[inputName]) {
      els[inputName].min = String(limits.minimum);
      els[inputName].max = String(limits.maximum);
      els[inputName].value = String(normalized[key]);
    }
  }
  return normalized;
}

function applyCaseColumnMinimums(values = {}, persist = true) {
  const normalized = normalizeCaseColumnMinimums(values);
  for (const [key, minimum] of Object.entries(normalized)) {
    CASE_COLUMNS[key].minimum = minimum;
  }
  if (persist) {
    localStorage.setItem("wipoTrackerCaseColumnMinimums", JSON.stringify(normalized));
    persistCaseColumnWidths();
    fitProtectedColumnsToPane(els.casePanel.getBoundingClientRect().width);
  }
  return normalized;
}

function loadCaseColumnMinimums() {
  try {
    return applyCaseColumnMinimums(JSON.parse(localStorage.getItem("wipoTrackerCaseColumnMinimums") || "{}"), false);
  } catch {
    return applyCaseColumnMinimums({}, false);
  }
}

function loadCaseColumnWidths() {
  for (const [key, config] of Object.entries(CASE_COLUMNS)) {
    document.documentElement.style.setProperty(config.variable, `${columnMinimum(key)}px`);
  }
}

function caseColumnWidth(key) {
  const config = CASE_COLUMNS[key];
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(config.variable)) || 0;
}

function renderCaseColumnWidth(key, width, clampMaximum = true, minimum = columnMinimum(key), updateHandle = true) {
  const config = CASE_COLUMNS[key];
  const requestedValue = Math.max(minimum, Number(width) || 0);
  const boundedValue = clampMaximum ? Math.min(config.maximum, requestedValue) : requestedValue;
  const value = minimum <= 0 && boundedValue <= 1 ? 0 : boundedValue;
  document.documentElement.style.setProperty(config.variable, `${value}px`);
  const collapsed = value === 0;
  els.casePanel.classList.toggle(`squished-col-${key}`, collapsed);
  if (key === "clock") els.casePanel.classList.toggle("time-column-hidden", collapsed);
  const handle = caseColumnHandles.get(key) || document.querySelector(`[data-case-column="${key}"]`);
  if (handle) handle.tabIndex = collapsed ? -1 : 0;
  if (updateHandle) {
    const limits = columnSizeLimits(key);
    handle?.setAttribute("aria-valuemin", String(limits.minimum));
    handle?.setAttribute("aria-valuemax", String(limits.maximum));
    handle?.setAttribute("aria-valuenow", String(Math.round(columnMinimum(key))));
  }
  return value;
}

function currentInterfaceScale() {
  return interfaceScaleValue;
}

function responsiveColumnFloor(key) {
  return isColumnSquishable(key) ? 0 : columnMinimum(key);
}

function protectedCasePaneWidth() {
  const scale = currentInterfaceScale();
  const protectedColumnsWidth = CASE_LAYOUT_COLUMNS.reduce((sum, key) => {
    if (isColumnHidden(key)) return sum;
    const width = responsiveColumnFloor(key);
    return sum + (key === "date" ? Math.max(0, width - (6 / scale)) : width);
  }, 0);
  const selectionWidth = state.exportMode ? 28 : 0;
  const scrollbarWidth = caseScrollbarWidth;
  const exactWidth = ((protectedColumnsWidth + selectionWidth + 64) * scale) + CASE_GRID_CHROME_PX + scrollbarWidth;
  return Math.max(MIN_CASE_PANE_WIDTH, Math.ceil(exactWidth));
}

const CASE_LAYOUT_COLUMNS = ["app", "registration", "reference", "attorney", "client", "applicant", "applicationtype", "wipostatus", "grant", "expiry", "representative", "date", "clock", "status"];

function protectedColumnCapacity(paneWidth = els.casePanel.getBoundingClientRect().width) {
  const scale = currentInterfaceScale();
  const scrollbarWidth = caseScrollbarWidth;
  const selectionWidth = state.exportMode ? 28 : 0;
  return Math.max(0, ((paneWidth - CASE_GRID_CHROME_PX - scrollbarWidth) / scale) - selectionWidth - 64 + (6 / scale));
}

function fitProtectedColumnsToPane(paneWidth) {
  const capacity = protectedColumnCapacity(paneWidth);
  const visible = CASE_LAYOUT_COLUMNS.filter((key) => !isColumnHidden(key));
  const widths = Object.fromEntries(CASE_LAYOUT_COLUMNS.map((key) => [key, columnMinimum(key)]));
  const baseTotal = visible.reduce((sum, key) => sum + widths[key], 0);
  if (capacity >= baseTotal && visible.length) {
    const extraPerColumn = (capacity - baseTotal) / visible.length;
    for (const key of visible) widths[key] += extraPerColumn;
  } else {
    let deficit = Math.max(0, baseTotal - capacity);
    let candidates = visible.filter((key) => isColumnSquishable(key) && widths[key] > 0);
    while (deficit > .01 && candidates.length) {
      const equalReduction = deficit / candidates.length;
      let reduced = 0;
      for (const key of candidates) {
        const amount = Math.min(widths[key], equalReduction);
        widths[key] -= amount;
        reduced += amount;
      }
      if (reduced <= .01) break;
      deficit -= reduced;
      candidates = candidates.filter((key) => widths[key] > .01);
    }
  }
  for (const key of CASE_LAYOUT_COLUMNS) {
    renderCaseColumnWidth(key, isColumnHidden(key) ? columnMinimum(key) : widths[key], false, responsiveColumnFloor(key), false);
  }
}

function persistCaseColumnWidths() {
  localStorage.setItem("wipoTrackerCaseTimeColumns", JSON.stringify(Object.fromEntries(
    Object.keys(CASE_COLUMNS).map((column) => [column, Math.round(columnMinimum(column))])
  )));
}

function resizeColumnBaseWithPane(key, requestedBase, startBase, startPaneWidth, persist = false) {
  const limits = columnSizeLimits(key);
  const desiredBase = Math.min(limits.maximum, Math.max(limits.minimum, Math.round(Number(requestedBase) || 0)));
  CASE_COLUMNS[key].minimum = desiredBase;
  const input = els[CASE_COLUMN_MINIMUM_INPUTS[key]];
  if (input) input.value = String(desiredBase);
  const scale = currentInterfaceScale();
  const paneWidth = setCasePaneWidth(startPaneWidth + ((desiredBase - startBase) * scale), false, true);
  if (persist) {
    localStorage.setItem("wipoTrackerCaseColumnMinimums", JSON.stringify(Object.fromEntries(
      Object.keys(CASE_COLUMNS).map((column) => [column, Math.round(columnMinimum(column))])
    )));
    persistCaseColumnWidths();
    localStorage.setItem("wipoTrackerCasePaneWidth", String(paneWidth));
  }
  return desiredBase;
}

function initializeCaseColumnResizers() {
  loadCaseColumnMinimums();
  loadCaseColumnBehavior();
  loadCaseColumnAlignments();
  loadCaseColumnWidths();
  for (const handle of document.querySelectorAll(".case-column-resizer")) {
    const key = handle.dataset.caseColumn;
    caseColumnHandles.set(key, handle);
    const config = CASE_COLUMNS[key];
    let startX = 0;
    let startBase = 0;
    let startPaneWidth = 0;
    let pendingX = null;
    let resizeFrame = 0;
    const applyPendingResize = () => {
      resizeFrame = 0;
      if (pendingX === null) return;
      const nextX = pendingX;
      pendingX = null;
      resizeColumnBaseWithPane(key, startBase + ((nextX - startX) / currentInterfaceScale()), startBase, startPaneWidth, false);
    };
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      startX = event.clientX;
      startBase = columnMinimum(key);
      startPaneWidth = els.casePanel.getBoundingClientRect().width;
      pendingX = null;
      document.body.classList.add("resizing-case-column");
      handle.setPointerCapture?.(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (!document.body.classList.contains("resizing-case-column")) return;
      pendingX = event.clientX;
      if (resizeFrame) return;
      if (window.requestAnimationFrame) resizeFrame = window.requestAnimationFrame(applyPendingResize);
      else applyPendingResize();
    });
    const finish = (event) => {
      if (!document.body.classList.contains("resizing-case-column")) return;
      if (resizeFrame && window.cancelAnimationFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
      applyPendingResize();
      document.body.classList.remove("resizing-case-column");
      handle.releasePointerCapture?.(event.pointerId);
      resizeColumnBaseWithPane(key, columnMinimum(key), columnMinimum(key), els.casePanel.getBoundingClientRect().width, true);
      localStorage.setItem("wipoTrackerCasePaneWidth", els.workspaceResizer.getAttribute("aria-valuenow"));
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("dblclick", () => resizeColumnBaseWithPane(key, config.defaultValue, columnMinimum(key), els.casePanel.getBoundingClientRect().width, true));
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const base = columnMinimum(key);
      resizeColumnBaseWithPane(key, base + (event.key === "ArrowRight" ? 4 : -4), base, els.casePanel.getBoundingClientRect().width, true);
    });
  }
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
  const interfaceScale = value.interfaceSize / TYPOGRAPHY_DEFAULTS.interfaceSize;
  interfaceScaleValue = interfaceScale;
  root.setProperty("--interface-scale", String(interfaceScale));
  root.setProperty("--header-scale", String(value.headerSize / TYPOGRAPHY_DEFAULTS.headerSize));
  root.setProperty("--content-scale", String(value.contentSize / TYPOGRAPHY_DEFAULTS.contentSize));
  els.interfaceFont.value = value.interfaceFont;
  els.headerFont.value = value.headerFont;
  els.contentFont.value = value.contentFont;
  els.interfaceFontSize.value = String(value.interfaceSize);
  els.headerFontSize.value = String(value.headerSize);
  els.contentFontSize.value = String(value.contentSize);
  resizeApplicationInput();
  const fitColumns = () => {
    const currentWidth = els.casePanel.getBoundingClientRect().width;
    const preferredWidth = Math.round(620 * interfaceScale);
    if (currentWidth < preferredWidth) setCasePaneWidth(preferredWidth, persist);
    schedulePanelHeaderSync();
  };
  if (window.requestAnimationFrame) window.requestAnimationFrame(fitColumns); else setTimeout(fitColumns, 0);
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
  state.publicationContext = null;
  els.publicationPages.parentElement.querySelector(".native-pdf-preview")?.remove();
  els.publicationPages.classList.remove("preview-pending");
  window.publicationViewer?.resetZoom?.();
  window.publicationViewer?.clear();
  els.publicationLoading.classList.remove("hidden");
  document.body.classList.remove("modal-open");
  publicationReturnFocus?.focus?.();
  publicationReturnFocus = null;
}

function setPublicationActionsEnabled(enabled) {
  els.printPublication.disabled = !enabled;
  els.savePublicationPdf.disabled = !enabled;
}

function showPublicationModal(applicationNo) {
  state.publicationDocuments = [];
  window.publicationViewer?.setContainer?.(els.publicationPages);
  publicationReturnFocus = document.activeElement;
  els.publicationTitle.textContent = `${applicationNo} publication`;
  els.publicationMeta.textContent = "Resolving publication PDF…";
  els.publicationLoading.textContent = "Loading publication PDF…";
  els.publicationLoading.classList.remove("hidden");
  els.publicationDocumentSelect.classList.add("hidden");
  els.publicationAll.checked = false;
  els.publicationAllLabel.classList.add("hidden");
  els.publicationZoomReset.textContent = "100%";
  state.publicationDocument = null;
  setPublicationActionsEnabled(false);
  els.publicationTabs.querySelectorAll("[data-publication-category]").forEach((button) => { button.disabled = true; button.classList.remove("active"); button.querySelector("span").textContent = "0"; });
  els.publicationModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.closePublicationModal.focus();
}

async function getPublicationViewer() {
  if (window.publicationViewer) return window.publicationViewer;
  await new Promise((resolve, reject) => {
    const onReady = () => { clearTimeout(timeout); window.removeEventListener("publication-viewer-ready", onReady); resolve(); };
    const timeout = setTimeout(() => {
      window.removeEventListener("publication-viewer-ready", onReady);
      reject(new Error("The PDF viewer could not load. Refresh this page or restart the WipoPublish host."));
    }, 10000);
    window.addEventListener("publication-viewer-ready", onReady, { once: true });
    if (window.publicationViewer) onReady();
  });
  return window.publicationViewer;
}

function beginNativePdfPreview(pages, loading, url, isCurrent) {
  pages.parentElement.querySelector(".native-pdf-preview")?.remove();
  pages.classList.add("preview-pending");
  const frame = document.createElement("iframe");
  frame.className = "native-pdf-preview";
  frame.title = "Publication PDF preview";
  frame.addEventListener("load", () => {
    if (isCurrent() && frame.isConnected) loading.classList.add("hidden");
  });
  pages.parentElement.insertBefore(frame, pages);
  frame.src = url;
  return frame;
}

function finishNativePdfPreview(pages, frame) {
  pages.classList.remove("preview-pending");
  frame?.remove();
}

const preparedPublicationDocuments = new WeakMap();
function preparePublicationDocument(result, context) {
  if (!result.needsPreparation) return Promise.resolve(result);
  if (!preparedPublicationDocuments.has(result)) {
    const pending = window.wipoTracker.preparePublicationPdf(context.applicationNo, context.registrationNo, result)
      .then(prepared => {
        if (!prepared?.ok || !prepared.url) throw new Error(prepared?.error || 'Could not prepare the publication entry PDF.');
        return { ...result, url: prepared.url, needsPreparation: false, sourcePreview: false, page: 1 };
      }).catch(error => { preparedPublicationDocuments.delete(result); throw error; });
    preparedPublicationDocuments.set(result, pending);
  }
  return preparedPublicationDocuments.get(result);
}

async function preloadAnnuityDocuments() {
  const documents = state.publicationDocuments;
  const context = state.publicationContext || { applicationNo: state.selected, registrationNo: currentRegistrationNumber() };
  const pending = documents.filter(item => ['annuity', 'renewal'].includes(publicationGroup(item)));
  const current = () => state.publicationDocuments === documents && !els.publicationModal.classList.contains('hidden');
  async function worker() {
    while (pending.length && current()) {
      const item = pending.shift();
      try {
        const prepared = await preparePublicationDocument(item, context);
        if (!current()) return;
        const viewer = await getPublicationViewer();
        if (!current()) return;
        await viewer.preload?.(prepared.url);
      } catch (_) { /* Selecting this document retries and shows any error. */ }
    }
  }
  await Promise.all([worker(), worker()]);
}

async function loadPublicationInModal(result) {
  if (result.needsPreparation) {
    state.publicationDocument = result;
    els.publicationLoading.textContent = 'Preparing publication entry pages…';
    els.publicationLoading.classList.remove('hidden');
    const context = state.publicationContext || { applicationNo: state.selected, registrationNo: currentRegistrationNumber() };
    const prepared = await preparePublicationDocument(result, context);
    if (state.publicationDocument !== result || els.publicationModal.classList.contains('hidden')) return;
    result = prepared;
  }
  state.publicationDocument = result;
  setPublicationActionsEnabled(Boolean(result?.url));
  els.printPublication.disabled = true;
  [els.publicationZoomOut, els.publicationZoomReset, els.publicationZoomIn].forEach((button) => { button.disabled = true; });
  const details = [result.requestNo || result.publicationNo || result.applicationNo, result.pages ? `Pages ${result.pages}` : (result.page ? `Page ${result.page}` : ""), result.cbNumber ? `CB ${result.cbNumber} ${result.volume || ""}${result.book || ""}` : "", result.sourceFile].filter(Boolean);
  els.publicationMeta.textContent = details.join(" · ") || "Publication PDF";
  els.publicationLoading.textContent = "Rendering first page…";
  els.publicationLoading.classList.remove("hidden");
  const isCurrent = () => state.publicationDocument === result && !els.publicationModal.classList.contains("hidden");
  if (result.sourcePreview) {
    window.publicationViewer?.clear?.();
    beginNativePdfPreview(els.publicationPages, els.publicationLoading, result.url, isCurrent);
    els.printPublication.disabled = false;
    els.publicationLoading.textContent = `Opening source volume at page ${result.page || 1}…`;
    return;
  }
  const nativeFrame = beginNativePdfPreview(els.publicationPages, els.publicationLoading, result.url, isCurrent);
  try {
    const viewer = await getPublicationViewer();
    if (!isCurrent()) return;
    viewer.setContainer?.(els.publicationPages);
    await viewer.render(result.url);
    if (!isCurrent()) return;
    finishNativePdfPreview(els.publicationPages, nativeFrame);
    els.printPublication.disabled = false;
    [els.publicationZoomOut, els.publicationZoomReset, els.publicationZoomIn].forEach((button) => { button.disabled = false; });
    els.publicationLoading.classList.add("hidden");
  } catch (error) {
    if (!isCurrent()) return;
    els.publicationLoading.classList.add("hidden");
    els.printPublication.disabled = false;
    showToast(`Using browser PDF preview: ${error.message}`, true);
  }
}

async function loadAllAnnuityDocuments(documents) {
  const category = state.publicationCategory;
  const label = category === "renewal" ? "renewal" : "annuity";
  state.publicationDocument = { all: true, category, documents };
  els.printPublication.disabled = true;
  [els.publicationZoomOut, els.publicationZoomReset, els.publicationZoomIn].forEach((button) => { button.disabled = true; });
  els.savePublicationPdf.disabled = false;
  els.publicationPages.parentElement.querySelector(".native-pdf-preview")?.remove();
  els.publicationPages.classList.remove("preview-pending");
  els.savePublicationPdf.title = `Save all ${label} documents as one merged PDF`;
  els.publicationMeta.textContent = `${documents.length} ${label} PDFs · stacked in publication order`;
  els.publicationLoading.textContent = `Preparing all ${label} documents…`;
  els.publicationLoading.classList.remove("hidden");
  let entries = documents.map((item, index) => ({
    url: item.url,
    label: [item.requestNo || item.publicationNo || `${label} document ${index + 1}`, item.cbNumber ? `CB ${item.cbNumber} ${item.volume || ""}${item.book || ""}` : "", item.sourceFile].filter(Boolean).join(" · "),
  }));
  const activeDocument = state.publicationDocument;
  try {
    for (let index = 0; index < documents.length; index += 1) {
      if (!documents[index].needsPreparation) continue;
      const context = state.publicationContext || { applicationNo: state.selected, registrationNo: currentRegistrationNumber() };
      const prepared = await preparePublicationDocument(documents[index], context);
      if (state.publicationDocument !== activeDocument) return;
      entries[index].url = prepared.url;
    }
    const viewer = await getPublicationViewer();
    if (state.publicationDocument !== activeDocument) return;
    viewer.setContainer?.(els.publicationPages);
    if (viewer.renderMany) await viewer.renderMany(entries);
    else await viewer.render(entries[0].url);
    els.printPublication.disabled = false;
    [els.publicationZoomOut, els.publicationZoomReset, els.publicationZoomIn].forEach((button) => { button.disabled = false; });
    els.publicationLoading.classList.add("hidden");
  } catch (error) {
    els.publicationLoading.textContent = `Unable to render PDFs: ${error.message}`;
  }
}

async function printCurrentPublication() {
  if (!state.publicationDocument) return;
  if (els.publicationPages.classList.contains("preview-pending") && !state.publicationDocument.sourcePreview) {
    try { els.publicationPages.parentElement.querySelector(".native-pdf-preview")?.contentWindow?.print(); }
    catch (_error) { showToast("Use the browser PDF viewer's Print control.", true); }
    return;
  }
  els.printPublication.disabled = true;
  els.publicationLoading.textContent = "Preparing all pages for printing…";
  els.publicationLoading.classList.remove("hidden");
  try {
    const viewer = await getPublicationViewer();
    viewer.setContainer?.(els.publicationPages);
    if (state.publicationDocument.sourcePreview) {
      const context = state.publicationContext || { applicationNo: state.selected, registrationNo: currentRegistrationNumber() };
      const prepared = await window.wipoTracker.preparePublicationPdf(context.applicationNo, context.registrationNo, state.publicationDocument);
      if (!prepared?.ok || !prepared.url) throw new Error(prepared?.error || 'Could not extract the indexed publication pages.');
      await viewer.render(prepared.url);
      finishNativePdfPreview(els.publicationPages, els.publicationPages.parentElement.querySelector('.native-pdf-preview'));
    }
    await viewer.preparePrint?.();
    els.publicationLoading.classList.add("hidden");
    document.body.classList.add("printing-publication");
    window.print();
  } catch (error) {
    showToast(error.message || "Could not prepare the publication for printing.", true);
  } finally {
    document.body.classList.remove("printing-publication");
    els.publicationLoading.classList.add("hidden");
    els.printPublication.disabled = false;
  }
}

async function saveCurrentPublicationPdf() {
  const publication = state.publicationDocument;
  if (!publication) return;
  els.savePublicationPdf.disabled = true;
  try {
    const context = state.publicationContext || { applicationNo: state.selected, registrationNo: currentRegistrationNumber() };
    const result = await window.wipoTracker.savePublicationPdf(context.applicationNo, context.registrationNo, publication);
    if (result?.ok) showToast("Publication PDF saved.");
    else if (!result?.canceled) showToast(result?.error || "Could not save the publication PDF.", true);
  } catch (error) {
    showToast(error.message || "Could not save the publication PDF.", true);
  } finally {
    els.savePublicationPdf.disabled = !state.publicationDocument;
  }
}

async function changePublicationZoom(delta = 0, reset = false) {
  const viewer = await getPublicationViewer();
  const zoom = reset ? (viewer.resetZoom?.() ?? 1) : (viewer.zoomBy?.(delta) ?? 1);
  els.publicationZoomReset.textContent = `${Math.round(zoom * 100)}%`;
}

const publicationGroup = (item) => ['6', '13'].includes(String(item.modeId || '')) ? 'renewal' : item.category;

function setPublicationKind(kind) {
  const madrid = kind === 'international_trademark';
  const supported = ['patent', 'design', 'trademark', 'international_trademark'].includes(kind);
  els.publicationA.parentElement.classList.toggle('hidden', !supported);
  els.publicationA.classList.remove('hidden');
  els.publicationA.querySelector('.publication-label-full').textContent = madrid ? 'Madrid A' : 'Publication A';
  els.publicationA.querySelector('.publication-label-short').textContent = madrid ? 'Madrid A' : 'Pub A';
  els.publicationA.setAttribute('aria-label', madrid ? 'Madrid Volume A publication lookup' : 'Publication A');
  els.publicationTabs.querySelector('[data-publication-category="publication_a"]').firstChild.textContent = madrid ? 'Madrid A ' : 'Publication A ';
  els.publicationB.querySelector('.publication-label-full').textContent = madrid ? 'Madrid B' : 'Publication B';
  els.publicationB.querySelector('.publication-label-short').textContent = madrid ? 'Madrid B' : 'Pub B';
  els.publicationB.setAttribute('aria-label', madrid ? 'Madrid Volume B publication lookup' : 'Publication B');
  els.publicationTabs.querySelector('[data-publication-category="publication_b"]').firstChild.textContent = madrid ? 'Madrid B ' : 'Publication B ';
  const renewal = kind === 'design' || kind === 'trademark' || madrid;
  const label = renewal ? 'Renewal' : 'Annuity';
  const category = renewal ? 'renewal' : 'annuity';
  els.annuity.dataset.publicationCategory = category;
  els.annuity.setAttribute('aria-label', label);
  els.annuity.querySelector('.publication-label-full').textContent = label;
  els.annuity.querySelector('.publication-label-short').textContent = renewal ? 'Renew' : 'Ann';
  els.annuity.querySelector('.publication-label-tiny').textContent = renewal ? 'Ren' : 'Ann';
  const tab = els.publicationTabs.querySelector('[data-publication-category="annuity"], [data-publication-category="renewal"]');
  tab.dataset.publicationCategory = category;
  tab.firstChild.textContent = `${label} `;
}

function selectPublicationCategory(category) {
  const documents = state.publicationDocuments.filter((item) => publicationGroup(item) === category);
  if (!documents.length) return;
  state.publicationCategory = category;
  if (category !== "annuity" && category !== "renewal") els.publicationAll.checked = false;
  els.publicationTabs.querySelectorAll("[data-publication-category]").forEach((button) => button.classList.toggle("active", button.dataset.publicationCategory === category));
  els.publicationDocumentSelect.innerHTML = documents.map((item, index) => `<option value="${index}">${escapeHtml([item.requestNo || item.publicationNo || item.lookupKey, item.cbNumber ? `CB ${item.cbNumber}` : "", item.generatedAt ? new Date(item.generatedAt).toLocaleDateString() : ""].filter(Boolean).join(" · "))}</option>`).join("");
  const canShowAll = (category === "annuity" || category === "renewal") && documents.length > 1;
  els.publicationAllLabel.classList.toggle("hidden", !canShowAll);
  const showAll = canShowAll && els.publicationAll.checked;
  els.publicationDocumentSelect.classList.toggle("hidden", documents.length < 2 || showAll);
  if (showAll) loadAllAnnuityDocuments(documents);
  else {
    els.savePublicationPdf.title = "Save this publication PDF";
    loadPublicationInModal(documents[0]);
  }
}

function loadPublicationDocuments(result, preferredCategory = "") {
  state.publicationDocuments = Array.isArray(result.documents) ? result.documents : [];
  for (const button of els.publicationTabs.querySelectorAll("[data-publication-category]")) {
    const count = state.publicationDocuments.filter((item) => publicationGroup(item) === button.dataset.publicationCategory).length;
    button.disabled = count === 0;
    button.querySelector("span").textContent = String(count);
  }
  const first = [preferredCategory, "publication_a", "publication_b", "annuity", "renewal"].filter(Boolean).find((category) => state.publicationDocuments.some((item) => publicationGroup(item) === category));
  if (!first) throw new Error("No prepared publication PDF is available for this record.");
  selectPublicationCategory(first);
  void preloadAnnuityDocuments();
}

const publicationButtons = () => [els.publicationA, els.publicationB, els.annuity];

function updatePublicationButtons(result = null, loading = false) {
  const documents = result?.ok && Array.isArray(result.documents) ? result.documents : [];
  for (const button of publicationButtons()) {
    const count = documents.filter((item) => publicationGroup(item) === button.dataset.publicationCategory).length;
    const madridLookup = (button === els.publicationA || button === els.publicationB) && recordKind(state.selected) === 'international_trademark';
    button.disabled = loading || (count === 0 && !madridLookup);
    button.querySelector(".publication-count").textContent = loading ? "…" : (count ? String(count) : "0");
    button.title = loading ? "Checking Publication Workbench…" : (count ? `${count} prepared document${count === 1 ? "" : "s"}` : madridLookup ? `Check the IP Vietnam Volume ${button === els.publicationA ? 'A' : 'B'} Madrid index` : "No prepared document found");
  }
}

async function lookupPublications(applicationNo) {
  const cached = state.publicationCache.get(applicationNo);
  if (cached && Date.now() - cached.createdAt < 15000) return cached.promise;
  const request = window.wipoTracker.openPublicationPdf(applicationNo, currentRegistrationNumber())
    .catch((error) => { state.publicationCache.delete(applicationNo); throw error; });
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
  state.publicationContext = { applicationNo, registrationNo: currentRegistrationNumber() };
  showPublicationModal(applicationNo);
  let result;
  try { result = await lookupPublications(applicationNo); }
  catch (error) { result = { ok: false, error: error?.message || 'Publication lookup failed.' }; }
  if (state.selected !== applicationNo) return closePublicationModal();
  if (result?.ok && result.documents?.length) loadPublicationDocuments(result, category);
  else {
    const madrid = recordKind(applicationNo) === 'international_trademark';
    const number = state.detail?.latest?.data?.madrid?.international_registration_number
      || currentRegistrationNumber() || applicationNo.replace(/^5-/, '');
    const volume = category === 'publication_a' ? 'A' : category === 'publication_b' ? 'B' : 'A/B';
    const countries = state.detail?.latest?.data?.madrid?.designated_countries;
    const designated = Array.isArray(countries) ? countries.filter((country) => typeof country === 'string' && country.trim()).map((country) => country.trim().toUpperCase()) : [];
    const message = result?.error || (madrid
      ? `No IP Vietnam Volume ${volume} Madrid publication is indexed for registration ${number}. ${designated.length && !designated.includes('VN') ? `The latest saved Madrid record lists ${designated.join(', ')} as designated ${designated.length === 1 ? 'country' : 'countries'}; VN is not listed. ` : ''}The WIPO Gazette entry is a different publication source.`
      : "No prepared publication PDF is available for this record.");
    els.publicationMeta.textContent = result?.error ? 'Publication lookup failed' : madrid
      ? `No indexed Madrid Volume ${volume} PDF · Registration ${number}` : 'No prepared publication PDF';
    els.publicationLoading.textContent = message;
    if (result?.error) showToast(message, true);
  }
}

function currentRegistrationNumber() {
  const data = state.detail?.latest?.data || state.detail?.current?.data || state.detail?.data || state.detail?.current || {};
  return data?.split_fields?.grant_number_date?.number || data?.fields?.grant_number_date?.number || registrationForApplication(state.selected)?.formatted || "";
}

function scrapeAgeDays(iso) {
  if (!iso) return null;
  let date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    const local = String(iso).match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (local) date = new Date(Number(local[3]), Number(local[2]) - 1, Number(local[1]), Number(local[4] || 0), Number(local[5] || 0), Number(local[6] || 0));
  }
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
const NOT_FOUND_HINT = "Application not found in WIPOPublish. Please check the application number, record type, or typing for errors.";
const SITE_DOWN_HINT = "The WIPOPublish website was unavailable when this scrape failed. The application has not been classified as missing; retry when the site is back online.";

function updateNotFoundStatuses(notFound = [], imported = []) {
  for (const item of imported) state.notFound.delete(normalize(item.applicationNo || item));
  for (const item of notFound) {
    const appNo = normalize(item?.applicationNo || item);
    if (appNo && state.queue.includes(appNo)) state.notFound.add(appNo);
  }
  saveQueue();
}

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
  const siteDown = state.siteUnavailable.has(state.selected) && !state.detail;
  const notFound = state.notFound.has(state.selected) && !state.detail;
  const candidate = state.maybeUnpublished.has(state.selected) && !state.detail && !notFound;
  els.detailStatus.textContent = siteDown ? "WIPO site down" : (notFound ? "Not found" : (candidate ? "Not yet published?" : "Not scraped"));
  els.detailStatus.title = siteDown ? SITE_DOWN_HINT : (notFound ? NOT_FOUND_HINT : (candidate ? MAYBE_UNPUBLISHED_HINT : ""));
  els.detailStatus.classList.toggle("maybe-unpublished", candidate || notFound || siteDown);
  const statusMessage = els.fields.querySelector(".field-card.wide .field-value");
  if (statusMessage) statusMessage.textContent = siteDown ? SITE_DOWN_HINT : (notFound ? NOT_FOUND_HINT : (candidate
    ? "The scrape did not return this application, and no Publication A record was found in the local database. It may not yet be published."
    : "This application is in your list but has not been scraped into the local database."));
}

function selectedScrapeCap() {
  const parsed = Number.parseInt(els.retryCount.value, 10);
  if (window.wipoTracker?.scrapeCapMode === false)
    return Number.isFinite(parsed) ? Math.min(50, Math.max(0, parsed)) : 10;
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 25;
}

function pendingScrapeCount(appNo) {
  return state.scrapeRequestCounts.get(appNo) || 0;
}

function visibleScrapeCount(appNo) {
  return state.rescrapeClickCounts.get(appNo) || 0;
}

function persistedRemoteScrapeStates() {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVE_SCRAPE_STATE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function saveRemoteScrapeStates() {
  const active = Object.fromEntries([...state.remoteScrapeStates.entries()].filter(([, details]) => ["queued", "running"].includes(details?.status)));
  if (Object.keys(active).length) localStorage.setItem(ACTIVE_SCRAPE_STATE_KEY, JSON.stringify(active));
  else localStorage.removeItem(ACTIVE_SCRAPE_STATE_KEY);
}

function normalizedRemoteScrapeState(details = {}) {
  return {
    status: String(details.status || ""),
    attempt: Math.max(0, Number.parseInt(details.attempt, 10) || 0),
    maxAttempts: Math.max(1, Number.parseInt(details.maxAttempts, 10) || selectedScrapeCap()),
    initialAttempts: Math.max(1, Number.parseInt(details.initialAttempts, 10) || selectedScrapeCap()),
    maxRetries: Math.max(0, Number.parseInt(details.maxRetries, 10) || 0),
    scrapeCap: Math.max(0, Number.parseInt(details.scrapeCap, 10) || 0),
    burstSize: Math.max(0, Number.parseInt(details.burstSize, 10) || 0),
    position: Math.max(0, Number.parseInt(details.position, 10) || 0),
    updatedAt: new Date().toISOString(),
  };
}

function clearRescrapeConfirmation(appNo, update = true) {
  const timer = rescrapeConfirmationTimers.get(appNo);
  if (timer) window.clearTimeout(timer);
  rescrapeConfirmationTimers.delete(appNo);
  state.rescrapeClickCounts.delete(appNo);
  if (update) updateLocalQueueStatus();
}

function countRescrapeConfirmation(appNo) {
  const clicks = Math.min(3, visibleScrapeCount(appNo) + 1);
  const previous = rescrapeConfirmationTimers.get(appNo);
  if (previous) window.clearTimeout(previous);
  state.rescrapeClickCounts.set(appNo, clicks);
  if (clicks < 3) {
    rescrapeConfirmationTimers.set(appNo, window.setTimeout(() => clearRescrapeConfirmation(appNo), RESCRAPE_CONFIRMATION_TIMEOUT_MS));
  } else rescrapeConfirmationTimers.delete(appNo);
  return clicks;
}

function applyRemoteScrapeStates(applicationStates = {}) {
  for (const [rawApplicationNo, details] of Object.entries(applicationStates)) {
    const appNo = normalize(rawApplicationNo);
    if (!appNo) continue;
    const remoteState = normalizedRemoteScrapeState(details);
    const status = remoteState.status;
    if (status === "running") {
      state.remoteScrapeStates.set(appNo, remoteState);
      state.scrapeQueuedIds.delete(appNo);
      state.scrapingIds.add(appNo);
      state.scrapeRequestCounts.set(appNo, Math.max(1, pendingScrapeCount(appNo)));
    } else if (status === "queued") {
      state.remoteScrapeStates.set(appNo, remoteState);
      state.scrapingIds.delete(appNo);
      state.scrapeQueuedIds.add(appNo);
      state.scrapeRequestCounts.set(appNo, Math.max(1, pendingScrapeCount(appNo)));
    } else if (["done", "failed", "cancelled"].includes(status)) {
      state.remoteScrapeStates.delete(appNo);
      state.scrapingIds.delete(appNo);
      state.scrapeQueuedIds.delete(appNo);
      state.scrapeRequestCounts.delete(appNo);
    }
  }
  saveRemoteScrapeStates();
  state.scrapeActiveCount = state.scrapingIds.size;
  updateLocalQueueStatus();
}

function replaceRemoteScrapeStates(applicationStates = {}) {
  for (const appNo of state.remoteScrapeStates.keys()) {
    state.scrapingIds.delete(appNo);
    state.scrapeQueuedIds.delete(appNo);
    state.scrapeRequestCounts.delete(appNo);
  }
  state.remoteScrapeStates.clear();
  applyRemoteScrapeStates(applicationStates);
}

function liveScrapeResult(appNo, isScraping, isQueued, localQueuePosition = 0) {
  const details = state.remoteScrapeStates.get(appNo) || {};
  const maximum = Math.max(1, Number(details.maxAttempts) || selectedScrapeCap());
  const initialAttempts = Math.min(maximum, Math.max(1, Number(details.initialAttempts) || selectedScrapeCap()));
  const maxRetries = Math.max(0, Number(details.maxRetries) || 0);
  const completedAttempt = Math.max(0, Number(details.attempt) || 0);
  if (isScraping) {
    const attempt = Math.max(1, completedAttempt);
    if (details.scrapeCap) return `Scrape ${attempt}/${maximum}`;
    if (maxRetries && attempt > initialAttempts) return `Retry ${attempt - initialAttempts}/${maxRetries}`;
    return `Scrape ${attempt}/${initialAttempts}`;
  }
  if (isQueued) {
    const position = Math.max(0, Number(details.position) || localQueuePosition);
    const nextAttempt = Math.min(maximum, completedAttempt + 1);
    if (details.scrapeCap) return `Queue${position ? ` #${position}` : ""} ${nextAttempt}/${maximum}`;
    const count = maxRetries && nextAttempt > initialAttempts
      ? `${nextAttempt - initialAttempts}/${maxRetries}` : `${nextAttempt}/${initialAttempts}`;
    return `Queue${position ? ` #${position}` : ""} ${count}`;
  }
  return "";
}

function syncScrapeOneButton() {
  const count = state.selected ? pendingScrapeCount(state.selected) : 0;
  const visibleCount = state.selected ? visibleScrapeCount(state.selected) : 0;
  els.scrapeOne.disabled = !state.selected || count > 0 || visibleCount >= 3;
  els.scrapeOneCount.textContent = visibleCount ? String(visibleCount) : "";
  els.scrapeOneCount.classList.toggle("hidden", visibleCount === 0);
  els.scrapeOne.title = visibleCount >= 3 ? "Re-scraping after 3 confirmation clicks" : visibleCount ? `Confirm re-scrape · ${visibleCount} of 3 clicks` : count ? "Scraping application" : "Scrape this application";
  els.scrapeOne.setAttribute("aria-label", visibleCount >= 3 ? `Re-scraping ${state.selected} after 3 confirmation clicks.` : visibleCount ? `Confirm re-scrape for ${state.selected}. ${visibleCount} of 3 clicks.` : count ? `Scraping ${state.selected}.` : "Scrape this application");
}

function syncBulkScrapeButtons() {
  const today = state.queue.filter((appNo) => scrapeAgeDays(state.records.get(appNo)?.lastScrapedAt) === 0);
  const count = today.reduce((maximum, appNo) => Math.max(maximum, visibleScrapeCount(appNo)), 0);
  const canConfirmToday = els.reScrape.checked && today.some((appNo) => !state.scrapingIds.has(appNo) && !state.scrapeQueuedIds.has(appNo) && visibleScrapeCount(appNo) < 3);
  const canStartRecord = state.queue.some((appNo) => {
    if (state.scrapingIds.has(appNo) || state.scrapeQueuedIds.has(appNo)) return false;
    const scrapedAt = state.records.get(appNo)?.lastScrapedAt;
    return els.reScrape.checked ? scrapeAgeDays(scrapedAt) !== 0 : !scrapedAt;
  });
  const canStartHague = state.hagueQueue.some((number) => !state.hagueLoading.has(number) && !state.haguePending.some((job) => job.number === number) && (els.reScrape.checked || !state.hagueResults.has(number)));
  const disabled = !canConfirmToday && !canStartRecord && !canStartHague;
  for (const [button, badge] of [[els.scrapeAll, els.scrapeAllCount], [els.refreshAll, els.refreshAllCount]]) {
    button.disabled = disabled;
    badge.textContent = count ? String(count) : "";
    badge.classList.toggle("hidden", count === 0);
    button.title = count ? `Confirm today's re-scrapes · ${count} of 3 clicks` : "Scrape all eligible applications and Hague designs";
    button.setAttribute("aria-label", count ? `Confirm today's re-scrapes. ${count} of 3 clicks.` : "Scrape all eligible applications and Hague designs");
  }
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
  syncBulkScrapeButtons();
  els.stop.disabled = !running;
  els.add.disabled = running;
  els.addRegistration.disabled = running;
  els.registrationType.disabled = running;
  els.reScrape.disabled = running;
  els.retryCount.disabled = running;
  syncScrapeOneButton();
  els.namedListSelect.disabled = running;
  els.addNamedList.disabled = running;
  els.renameNamedList.disabled = running;
  els.removeNamedList.disabled = running;
}

function setRunStatus(message, kind = "ready") {
  els.runStatus.innerHTML = `<span class="status-dot ${kind === "ready" ? "ready" : ""}"></span>${escapeHtml(message)}`;
}

function appendLog(message, stream = false, sourceId = "default") {
  const cleaned = String(message || "").replace(/\r\n?/g, "\n");
  const source = stream ? String(sourceId || "default") : "";
  const combined = stream ? `${httpLogBuffers.get(source) || ""}${cleaned}` : cleaned;
  const lines = combined.split("\n");
  if (stream) {
    const pending = (lines.pop() || "").slice(-1000);
    if (pending) httpLogBuffers.set(source, pending);
    else httpLogBuffers.delete(source);
  }
  for (const rawLine of lines) {
    const line = rawLine.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    const match = line.match(/^\s*\d+\/\d+:\s*([1-5]-\d{4}-\d{4,}|5-\d{7})(?:\s+\[Retry\s+(\d+)\])?\s*\|\s*Status:\s*(\d{3})\s*-\s*(.*?)\s+(\d{1,2}:\d{2}:\d{2})(?:\s*\(Re-attempt\s+(\d+)\/\d+\))?\s*$/i);
    if (!match) continue;
    els.log.querySelector(".http-log-empty")?.remove();
    const [, applicationNo, , code, responseText, time] = match;
    const row = document.createElement("div");
    row.className = `http-log-row ${Number(code) >= 500 ? "http-error" : Number(code) >= 400 ? "http-warning" : "http-ok"}`;
    for (const [index, value] of [time, applicationNo, code, responseText.trim()].entries()) {
      const cell = document.createElement("span");
      if (index === 2) cell.className = "http-status";
      cell.textContent = value;
      cell.title = value;
      row.append(cell);
    }
    els.log.append(row);
    while (els.log.children.length > 500) els.log.firstElementChild.remove();
    els.logDrawer.scrollTop = els.logDrawer.scrollHeight;
  }
}

function pulseDuplicateRows(applicationNos) {
  const duplicates = [...new Set(applicationNos)].filter((appNo) => state.queue.includes(appNo));
  if (!duplicates.length) return;
  for (const appNo of duplicates) {
    state.duplicatePulseIds.add(appNo);
    if (duplicatePulseTimers.has(appNo)) window.clearTimeout(duplicatePulseTimers.get(appNo));
    duplicatePulseTimers.set(appNo, window.setTimeout(() => {
      state.duplicatePulseIds.delete(appNo);
      duplicatePulseTimers.delete(appNo);
      for (const row of els.list.querySelectorAll(".case-row")) {
        if (row.dataset.app === appNo) row.classList.remove("duplicate-pulse");
      }
    }, 1700));
  }
  renderList();
  const firstRow = [...els.list.querySelectorAll(".case-row")].find((row) => row.dataset.app === duplicates[0]);
  if (typeof firstRow?.scrollIntoView === "function") firstRow.scrollIntoView({ block: "nearest" });
}

function addApplications(ids, refsByApplication = {}, registrationsByApplication = {}) {
  let added = 0;
  const duplicates = [...new Set(ids.filter((id) => id && state.queue.includes(id)))];
  for (const id of ids) if (id && !state.queue.includes(id)) { state.queue.push(id); added += 1; }
  for (const [appNo, refs] of Object.entries(refsByApplication)) {
    if (!state.queue.includes(appNo)) continue;
    state.caseRefsByApplication[appNo] = [...new Set([...(state.caseRefsByApplication[appNo] || []), ...parseCaseRefs(refs.join("\n"))])];
  }
  for (const [appNo, registration] of Object.entries(registrationsByApplication)) {
    if (state.queue.includes(appNo) && registration?.formatted) state.registrationsByApplication[appNo] = { ...registration };
  }
  saveQueue();
  refreshList();
  pulseDuplicateRows(duplicates);
  if (state.selected) renderDetailCaseRef(state.selected);
  if (added) showToast(`Added ${added} application${added === 1 ? "" : "s"}.`);
  else if (Object.keys(refsByApplication).length) showToast("Case references linked to existing applications.");
  else if (duplicates.length) showToast(`${duplicates.length === 1 ? "This application is" : "These applications are"} already in the case list.`);
  return added;
}

function invalidateDetail(appNo) {
  state.detailCache.delete(appNo);
  state.detailGenerations.set(appNo, (state.detailGenerations.get(appNo) || 0) + 1);
}

function loadDetail(appNo) {
  if (state.detailCache.has(appNo)) return Promise.resolve(state.detailCache.get(appNo));
  const generation = state.detailGenerations.get(appNo) || 0;
  const existing = state.detailJobs.get(appNo);
  if (existing?.generation === generation) return existing.promise;
  const promise = window.wipoTracker.detail(appNo).then((result) => {
    const detail = result?.detail || null;
    if ((state.detailGenerations.get(appNo) || 0) === generation) {
      state.detailCache.set(appNo, detail);
      updateVisibleChangeCount(appNo, detail);
    }
    return detail;
  }).finally(() => {
    if (state.detailJobs.get(appNo)?.promise === promise) state.detailJobs.delete(appNo);
  });
  state.detailJobs.set(appNo, { generation, promise });
  return promise;
}

function visibleChangeCount(detail) {
  const snapshots = detail?.snapshots || [];
  const latest = detail?.latest || snapshots[0];
  if (!latest) return 0;
  const index = snapshots.findIndex((item) => String(item.id) === String(latest.id));
  return displayedSnapshotChanges(latest.changes, latest.data, snapshots[index + 1]?.data).length;
}

function updateVisibleChangeCount(appNo, detail) {
  const record = state.records.get(appNo);
  if (!record || (record.snapshotId && detail?.latest?.id && String(record.snapshotId) !== String(detail.latest.id))) return;
  const count = visibleChangeCount(detail);
  if (record.visibleChangeCount === count) return;
  state.records.set(appNo, { ...record, visibleChangeCount: count });
  renderList();
}

function prefetchDetails(applicationNos) {
  const pending = [...new Set(applicationNos)].filter((appNo) => !state.detailCache.has(appNo) && !state.detailJobs.has(appNo));
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const appNo = pending[cursor++];
      try { await loadDetail(appNo); } catch { /* A click can retry a failed prefetch. */ }
    }
  };
  Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker)).catch(() => {});
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

function normalizeCaseRefKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\\s+/g, "");
}

function statusMetadataForCaseRef(appNo, caseRef) {
  const metadata = state.statusMetadataByApplication[appNo] || {};
  const target = normalizeCaseRefKey(caseRef);
  if (!target) return {};
  return (metadata.caseMatches || []).find((match) => normalizeCaseRefKey(match.caseRef) === target) || {};
}

function registrationForApplication(appNo) {
  return state.registrationsByApplication[appNo] || state.lookedUpRegistrations[appNo] || scrapedRegistrationForApplication(appNo);
}

function scrapedRegistrationForApplication(appNo) {
  const record = state.records.get(appNo);
  const raw = String(record?.registrationNo || record?.grantNumberDate || "");
  const match = raw.match(/(?:^|\s)([1-4])\s*[-/]\s*0*(\d{1,7})\s*[-/]\s*0*(\d{1,3})(?!\d)/);
  if (!match) return null;
  const prefix = match[1];
  return {
    formatted: `${prefix}-${match[2].padStart(7, "0")}-${match[3].padStart(3, "0")}`,
    prefix,
    number: match[2].padStart(7, "0"),
    type: prefix === "3" ? "design" : prefix === "4" ? "trademark" : "patent",
    source: "scraped",
  };
}

function registrationMarkup(registration) {
  const match = String(registration?.formatted || "").match(/^([1-4]-)(\d{7})(-\d{3})$/);
  if (!match) return "—";
  const significant = match[2].replace(/^0+(?=\d)/, "");
  const padding = match[2].slice(0, match[2].length - significant.length);
  return `<span class="registration-number-text"><span class="registration-number-affix">${escapeHtml(match[1])}</span><span class="registration-number-padding">${escapeHtml(padding)}</span><span class="registration-number-core">${escapeHtml(significant)}</span><span class="registration-number-affix">${escapeHtml(match[3])}</span></span>`;
}

function isApplicationNumberValue(value) {
  return /^(?:(?:VN\s*)?[1-5]\s*[-/]\s*\d{4}\s*[-/]\s*\d{4,}|5-\d{5,9}[A-Z]?)$/i.test(String(value || "").trim());
}

function registrationValues(value) {
  return String(value || "").split(/[\r\n,;\t]+/).map((item) => item.trim()).filter((item) => item && !isApplicationNumberValue(item));
}

function registrationTypeFromInput(value) {
  if (parseHagueNos(value).length) return "design";
  for (const item of registrationValues(value)) {
    const prefix = item.match(/(?:^|[^A-Z0-9])([1-4])\s*[-/]/i)?.[1];
    if (prefix === "3") return "design";
    if (prefix === "4") return "trademark";
    if (prefix === "1" || prefix === "2") return "patent";
  }
  return "";
}

function applyRegistrationType(type) {
  const value = ["patent", "design", "trademark"].includes(type) ? type : "patent";
  els.registrationType.value = value;
  els.registrationShell.dataset.registrationType = value;
  localStorage.setItem("wipoTrackerRegistrationType", value);
}

async function addRegistrationInputText(value) {
  const hagueNos = parseHagueNos(value);
  const registrationNumbers = registrationValues(value).filter(item => !normalizeHagueNo(item));
  if (hagueNos.length) addHagueNumbers(hagueNos);
  if (hagueNos.length && !registrationNumbers.length) return true;
  if (!registrationNumbers.length) {
    const message = isApplicationNumberValue(value) ? "Application numbers are ignored here. Enter a registration number." : "Enter at least one registration number.";
    showToast(message, true);
    return false;
  }
  if (!window.wipoTracker.lookupRegistrations) throw new Error("Registration lookup is not available in this running host. Restart the WipoPublish host.");
  const result = await window.wipoTracker.lookupRegistrations(registrationNumbers, els.registrationType.value, []);
  if (!result?.ok) throw new Error(result?.error || "Could not read the Publication Registration database.");
  const applications = [];
  const registrations = {};
  for (const match of result.matches || []) {
    const appNo = normalize(match.applicationNo);
    if (!appNo) continue;
    applications.push(appNo);
    if (!registrations[appNo]) registrations[appNo] = match;
  }
  const renewalRequests = [...new Set((result.renewalMatches || []).map((item) => normalizeRequestNo(item.requestNo)).filter(Boolean))];
  if (!applications.length && !result.renewalMatches?.length) {
    showToast(`No matching application was found for ${result.missing?.slice(0, 3).join(", ") || "the registration number"}.`, true);
    return false;
  }
  if (applications.length) addApplications([...new Set(applications)], {}, registrations);
  const newRequests = renewalRequests.filter((requestNo) => !state.requestQueue.includes(requestNo));
  if (newRequests.length) {
    state.requestQueue.push(...newRequests);
    saveQueue();
    renderList();
    refreshRequestRows(newRequests).catch((error) => showToast(error.message, true));
  }
  if (registrationNumbers.length === 1 && result.renewalMatches?.length && window.wipoTracker.openPublicationPdf) {
    const registrationNo = result.renewalMatches[0].formatted || registrationNumbers[0];
    const kind = els.registrationType.value;
    setPublicationKind(kind);
    state.publicationContext = { applicationNo: '', registrationNo };
    showPublicationModal(registrationNo);
    try {
      const publications = await window.wipoTracker.openPublicationPdf('', registrationNo);
      if (publications?.ok && publications.documents?.length) loadPublicationDocuments(publications, 'renewal');
      else throw new Error(publications?.error || 'No prepared publication PDF was found for this registration.');
    } catch (error) {
      els.publicationMeta.textContent = error.message;
      els.publicationLoading.textContent = error.message;
      showToast(error.message, true);
    }
  }
  if (result.missing?.length) showToast(`${result.missing.length} registration number${result.missing.length === 1 ? " was" : "s were"} not found in Publication Registration.`, true);
  return true;
}

async function lookupRequestRow(requestNo) {
  if (!window.wipoTracker.requestPublications) throw new Error("Request publication lookup is unavailable. Restart the WipoPublish host.");
  const result = await window.wipoTracker.requestPublications(requestNo);
  if (result?.hostUpdateRequired || result?.hostOffline) return result;
  if (!result?.ok) throw new Error(result?.error || "Could not read the Publication Workbench PDF database.");
  return result;
}

async function refreshRequestRows(requestNos = state.requestQueue) {
  const pending = [...new Set(requestNos)].filter((requestNo) => state.requestQueue.includes(requestNo));
  if (!pending.length) return;
  if (window.wipoTracker.requestPublicationsBatch) {
    for (let offset = 0; offset < pending.length; offset += 500) {
      const chunk = pending.slice(offset, offset + 500);
      try {
        const batch = await window.wipoTracker.requestPublicationsBatch(chunk);
        if (batch?.hostUpdateRequired || batch?.hostOffline) {
          for (const requestNo of chunk) if (state.requestQueue.includes(requestNo)) state.requestResults.set(requestNo, batch);
        } else if (!batch?.ok || !Array.isArray(batch.results)) {
          throw new Error(batch?.error || 'Could not read the Publication Workbench PDF database.');
        } else {
          const byRequest = new Map(batch.results.map((result) => [result.requestNo, result]));
          for (const requestNo of chunk) if (state.requestQueue.includes(requestNo)) {
            state.requestResults.set(requestNo, byRequest.get(requestNo) || { ok: false, error: 'Request lookup returned no row.', documents: [], caseRefs: [] });
          }
        }
      } catch (error) {
        for (const requestNo of chunk) if (state.requestQueue.includes(requestNo)) {
          state.requestResults.set(requestNo, { ok: false, error: error.message, documents: [], caseRefs: [] });
        }
      }
      renderList();
      if (state.selectedRequest && chunk.includes(state.selectedRequest)) {
        renderRequestDetail(state.selectedRequest);
        if (state.requestResults.get(state.selectedRequest)?.documents?.length) showRequestPublicationDocument(state.selectedRequest).catch(() => {});
      }
    }
    return;
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const requestNo = pending[cursor++];
      try {
        const result = await lookupRequestRow(requestNo);
        if (state.requestQueue.includes(requestNo)) state.requestResults.set(requestNo, result);
      } catch (error) {
        if (state.requestQueue.includes(requestNo)) state.requestResults.set(requestNo, { ok: false, error: error.message, documents: [], caseRefs: [] });
      }
      renderList();
      if (state.selectedRequest === requestNo) {
        renderRequestDetail(requestNo);
        if (state.requestResults.get(requestNo)?.documents?.length) showRequestPublicationDocument(requestNo).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
}

async function retryUnavailableRequestRows() {
  if (requestRecoveryPending) return;
  const pending = state.requestQueue.filter((requestNo) => {
    const result = state.requestResults.get(requestNo);
    return (result?.hostUpdateRequired || result?.hostOffline) && Date.now() - Number(result.checkedAt || 0) >= 10000;
  });
  if (!pending.length) return;
  requestRecoveryPending = true;
  try {
    const first = pending[0];
    const result = await lookupRequestRow(first);
    if (!state.requestQueue.includes(first)) return;
    state.requestResults.set(first, result);
    if (!result.ok) {
      for (const requestNo of pending.slice(1)) {
        if (state.requestQueue.includes(requestNo)) state.requestResults.set(requestNo, { ...result });
      }
      renderList();
      if (state.selectedRequest) renderRequestDetail(state.selectedRequest);
      return;
    }
    renderList();
    await refreshRequestRows(pending.slice(1));
    if (state.selectedRequest === first) {
      renderRequestDetail(first);
      if (result.documents?.length) showRequestPublicationDocument(first).catch(() => {});
    }
  } catch (_error) {
    // Keep the previous status; the next connection check will retry.
  } finally {
    requestRecoveryPending = false;
  }
}

function renderRequestDetail(requestNo) {
  if (state.selectedRequest !== requestNo) return;
  const result = state.requestResults.get(requestNo);
  const documents = result?.documents || [];
  els.detailEmpty.classList.add("hidden");
  els.detailContent.classList.add("hidden");
  els.requestDetail.classList.remove("hidden");
  els.requestDetailNo.textContent = requestNo;
  els.requestDetailKind.textContent = result?.kind || requestKindLabel(requestNo);
  els.requestDetailMeta.replaceChildren();
  const lines = !result ? ["Looking up extracted publication PDFs…"]
    : !result.ok ? [result.error || "Publication lookup failed."]
    : documents.length ? [
      `${documents.length} publication PDF${documents.length === 1 ? "" : "s"} found`,
      ...(result.caseRefs?.length ? [`Case ref: ${result.caseRefs.join(" · ")}`] : []),
      ...documents.slice(0, 5).map((item) => [item.sourceFile, item.cbNumber ? `CB ${item.cbNumber}` : ""].filter(Boolean).join(" · ")),
    ] : ["No extracted publication PDF found for this request number."];
  for (const line of lines) {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    els.requestDetailMeta.appendChild(paragraph);
  }
  els.requestViewerShell.classList.toggle("hidden", !documents.length);
  if (!documents.length) {
    clearRequestPublicationViewer();
  }
  els.requestPrintPdf.disabled = !documents.length;
  els.requestSavePdf.disabled = !documents.length;
  els.requestDocumentSelect.replaceChildren();
  els.requestDocumentSelect.classList.toggle("hidden", documents.length < 2);
  documents.forEach((documentPdf, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = documentPdf.sourceFile || documentPdf.requestNo || `Document ${index + 1}`;
    els.requestDocumentSelect.appendChild(option);
  });
  const selectedIndex = documents.findIndex((item) => item.url === state.requestPublicationDocument?.url);
  els.requestDocumentSelect.value = String(Math.max(0, selectedIndex));
}

function clearRequestPublicationViewer() {
  state.requestViewerKey = "";
  state.requestPublicationDocument = null;
  state.requestViewerPending = false;
  state.requestNativePdfFallback = false;
  if (window.publicationViewer?.getContainer?.() === els.requestPublicationPages) window.publicationViewer.clear();
  els.requestPublicationPages.parentElement.querySelector(".native-pdf-preview")?.remove();
  els.requestPublicationPages.classList.remove("preview-pending");
  els.requestPublicationPages.replaceChildren();
}

async function showRequestPublicationDocument(requestNo, index = 0) {
  const documents = state.requestResults.get(requestNo)?.documents || [];
  const publication = documents[index];
  if (!publication || state.selectedRequest !== requestNo) return;
  const key = `${requestNo}|${publication.url}`;
  state.requestPublicationDocument = publication;
  els.requestDocumentSelect.value = String(index);
  if (key === state.requestViewerKey && (state.requestViewerPending || (!state.requestNativePdfFallback && window.publicationViewer?.getContainer?.() === els.requestPublicationPages))) return;
  state.requestViewerKey = key;
  state.requestViewerPending = true;
  els.requestPublicationLoading.textContent = "Loading publication PDF…";
  els.requestPublicationLoading.classList.remove("hidden");
  state.requestNativePdfFallback = true;
  [els.requestZoomOut, els.requestZoomReset, els.requestZoomIn].forEach((button) => { button.disabled = true; });
  const isCurrent = () => state.selectedRequest === requestNo && state.requestViewerKey === key;
  const nativeFrame = beginNativePdfPreview(els.requestPublicationPages, els.requestPublicationLoading, publication.url, isCurrent);
  try {
    const viewer = await getPublicationViewer();
    if (!isCurrent()) return;
    viewer.setContainer?.(els.requestPublicationPages);
    els.requestZoomReset.textContent = "100%";
    await viewer.render(publication.url, { highlightRequestNo: requestNo });
    if (isCurrent()) {
      finishNativePdfPreview(els.requestPublicationPages, nativeFrame);
      state.requestNativePdfFallback = false;
      [els.requestZoomOut, els.requestZoomReset, els.requestZoomIn].forEach((button) => { button.disabled = false; });
      els.requestPublicationLoading.classList.add("hidden");
    }
  } catch (error) {
    if (!isCurrent()) return;
    state.requestNativePdfFallback = true;
    [els.requestZoomOut, els.requestZoomReset, els.requestZoomIn].forEach((button) => { button.disabled = true; });
    els.requestPublicationLoading.classList.add("hidden");
    showToast("Using the browser PDF viewer; request highlighting is unavailable.", true);
  } finally {
    if (isCurrent()) state.requestViewerPending = false;
  }
}

async function printCurrentRequestPublication() {
  if (!state.requestPublicationDocument) return;
  if (state.requestNativePdfFallback) {
    try { els.requestPublicationPages.parentElement.querySelector(".native-pdf-preview")?.contentWindow?.print(); }
    catch (_error) { showToast("Use the browser PDF viewer's Print control.", true); }
    return;
  }
  els.requestPrintPdf.disabled = true;
  els.requestPublicationLoading.textContent = "Preparing pages for printing…";
  els.requestPublicationLoading.classList.remove("hidden");
  try {
    const viewer = await getPublicationViewer();
    viewer.setContainer?.(els.requestPublicationPages);
    await viewer.preparePrint?.();
    els.requestPublicationLoading.classList.add("hidden");
    document.body.classList.add("printing-request-publication");
    window.print();
  } catch (error) {
    showToast(error.message || "Could not prepare the PDF for printing.", true);
  } finally {
    document.body.classList.remove("printing-request-publication");
    els.requestPublicationLoading.classList.add("hidden");
    els.requestPrintPdf.disabled = !state.requestPublicationDocument;
  }
}

async function saveCurrentRequestPublicationPdf() {
  const publication = state.requestPublicationDocument;
  if (!publication || !state.selectedRequest) return;
  els.requestSavePdf.disabled = true;
  try {
    const result = await window.wipoTracker.saveRequestPublicationPdf(state.selectedRequest, publication);
    if (result?.ok) showToast("Publication PDF saved.");
    else if (!result?.canceled) showToast(result?.error || "Could not save the publication PDF.", true);
  } catch (error) {
    showToast(error.message || "Could not save the publication PDF.", true);
  } finally {
    els.requestSavePdf.disabled = !state.requestPublicationDocument;
  }
}

async function changeRequestPublicationZoom(delta = 0, reset = false) {
  const viewer = await getPublicationViewer();
  viewer.setContainer?.(els.requestPublicationPages);
  const zoom = reset ? (viewer.resetZoom?.() ?? 1) : (viewer.zoomBy?.(delta) ?? 1);
  els.requestZoomReset.textContent = `${Math.round(zoom * 100)}%`;
}

async function openRequestDetail(requestNo) {
  const canonical = normalizeRequestNo(requestNo);
  if (!canonical || !state.requestQueue.includes(canonical)) return;
  ++state.detailRequestToken;
  state.selected = "";
  state.selectedHague = "";
  els.hagueDetail.classList.add("hidden");
  state.detail = null;
  if (state.selectedRequest !== canonical) {
    clearRequestPublicationViewer();
  }
  state.selectedRequest = canonical;
  renderList();
  renderRequestDetail(canonical);
  let result = state.requestResults.get(canonical);
  if (!result || ((result.hostUpdateRequired || result.hostOffline) && Date.now() - Number(result.checkedAt || 0) > 10000)) {
    try {
      result = await lookupRequestRow(canonical);
    } catch (error) {
      result = { ok: false, error: error.message, documents: [], caseRefs: [] };
    }
    if (!state.requestQueue.includes(canonical)) return;
    state.requestResults.set(canonical, result);
    renderList();
    if (state.selectedRequest !== canonical) return;
    renderRequestDetail(canonical);
  }
  if (state.selectedRequest !== canonical) return;
  if (!result.ok || !result.documents?.length) {
    showToast(result.error || "No extracted publication PDF found for this request number.", true);
    return;
  }
  await showRequestPublicationDocument(canonical);
}

function addRequestInputText(value) {
  const requestNos = parseRequestNos(value);
  if (!requestNos.length) { showToast("Enter DT1, DT2, GH3, or GH4-YYYY-NNNNN request numbers.", true); return false; }
  const newNos = requestNos.filter((requestNo) => !state.requestQueue.includes(requestNo));
  state.requestQueue.push(...newNos);
  saveQueue();
  renderList();
  if (newNos.length) refreshRequestRows(newNos).catch((error) => showToast(error.message, true));
  else showToast("Those request numbers are already in the case list.");
  return true;
}

function addHagueNumbers(numbers) {
  const additions = numbers.filter(number => !state.hagueQueue.includes(number));
  if (!additions.length) { showToast("Those Hague registrations are already in the case list."); return false; }
  state.hagueQueue.push(...additions);
  saveQueue();
  renderList();
  openHagueDetail(additions[0]);
  loadSavedHagueRows(additions).catch(error => appendLog(`\n[Tracker] Hague history could not be loaded: ${error.message}\n`));
  return true;
}

async function loadSavedHagueRows(numbers = state.hagueQueue) {
  if (!numbers.length || typeof window.wipoTracker.hagueList !== "function") return;
  const listId = state.activeListId;
  let result;
  try {
    result = await window.wipoTracker.hagueList([...numbers]);
    if (!result?.ok) throw new Error(result?.error || "Saved Hague history could not be loaded.");
  } catch (error) {
    if (state.activeListId === listId) {
      state.hagueLoadError = /\b404\b/.test(error.message)
        ? "Restart the WipoPublish LAN host to enable saved Hague history. Refreshing this page alone is not enough."
        : `Saved Hague history is unavailable: ${error.message}`;
      renderList();
      if (state.selectedHague) renderHagueDetail(state.selectedHague);
    }
    throw error;
  }
  if (state.activeListId !== listId) return;
  state.hagueLoadError = "";
  for (const item of result.registrations || []) {
    const number = normalizeHagueNo(item.number);
    if (!number || !state.hagueQueue.includes(number)) continue;
    const current = state.hagueResults.get(number);
    if (current?.lastScrapedAt && Date.parse(current.lastScrapedAt) > Date.parse(item.lastScrapedAt)) continue;
    if (current?.snapshotId && String(current.snapshotId) !== String(item.snapshotId)) state.hagueHistory.delete(number);
    state.hagueResults.set(number, { ...item.data, checkedAt: item.lastScrapedAt, lastScrapedAt: item.lastScrapedAt,
      snapshotId: item.snapshotId, changeCount: item.changeCount, scrapeCount: item.scrapeCount });
  }
  renderList();
  if (state.selectedHague) { renderHagueDetail(state.selectedHague); loadHagueHistory(state.selectedHague).catch(() => {}); }
}

async function loadHagueHistory(number) {
  if (typeof window.wipoTracker.hagueDetail !== "function" || !state.hagueQueue.includes(number)) return;
  const listId = state.activeListId;
  const result = await window.wipoTracker.hagueDetail(number);
  if (state.activeListId !== listId || !state.hagueQueue.includes(number) || !result?.ok || !result.detail) return;
  state.hagueHistory.set(number, result.detail);
  if (state.selectedHague === number) renderHagueDetail(number);
}

async function loadHaguePublicationIndex(number, refresh = false) {
  if (typeof window.wipoTracker.internationalPublications !== "function" || !state.hagueQueue.includes(number)) return;
  if (!refresh && state.haguePublicationIndex.has(number)) return;
  const listId = state.activeListId;
  const result = await window.wipoTracker.internationalPublications(number);
  if (state.activeListId !== listId || !state.hagueQueue.includes(number)) return;
  state.haguePublicationIndex.set(number, result);
  if (state.selectedHague === number) renderHagueDetail(number);
}

function hagueFieldMarkup(fields, changedCodes = new Set()) {
  return `<div class="hague-field-grid">${(fields || []).map(field => `<div class="hague-field-label${changedCodes.has(field.code) ? " changed" : ""}">${escapeHtml(field.code ? `(${field.code}) ${field.label}` : field.label)}${field.source === "Original registration" ? `<small>Original registration</small>` : ""}</div><div class="${changedCodes.has(field.code) ? "changed" : ""}">${escapeHtml(field.value || "—")}</div>`).join("")}</div>`;
}

function hagueRenewalMarkup(record) {
  const renewals = record.renewalEvents || [];
  if (!renewals.length) return "";
  return `<section class="hague-section"><h3>International renewals · ${renewals.length}</h3>
    ${renewals.map((event, index) => `<details class="hague-disclosure" data-hague-disclosure-key="renewal-${index}">
      <summary>${escapeHtml(event.kind || "Renewal")} · ${escapeHtml(event.renewalDate || event.bulletinDate || "Date unavailable")}${event.bulletinNo ? ` · Bulletin ${escapeHtml(event.bulletinNo)}` : ""}</summary>
      ${hagueFieldMarkup([{ label: "Renewal date", value: event.renewalDate }, { label: "Expected expiration", value: event.expirationDate }, { label: "Designs concerned", value: event.scope }, { label: "Designated parties", value: event.designatedParties }, ...(event.fields || [])].filter(field => field.value))}
      ${event.url ? `<a href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer">Open renewal PDF ↗</a>` : event.pdfUrl ? `<a href="${escapeHtml(event.pdfUrl)}" target="_blank" rel="noopener noreferrer">Open WIPO PDF ↗</a>` : ""}
    </details>`).join("")}</section>`;
}

function haguePublicationIndexMarkup(lookup) {
  if (!lookup) return `<section class="hague-section"><h3>Publication database</h3><p>Checking indexed publications…</p></section>`;
  if (!lookup.ok) return `<section class="hague-section"><h3>Publication database</h3><p>${escapeHtml(lookup.error || "Lookup unavailable")}</p></section>`;
  const rows = lookup.records || [];
  const linked = [...new Set(rows.map(row => row.vn_application_no).filter(Boolean))];
  const sourceRows = rows.filter(row => row.record_kind !== "hague_registration");
  return `<section class="hague-section"><h3>Publication database · ${rows.length} record${rows.length === 1 ? "" : "s"}</h3>
    <p>International registration ${escapeHtml(lookup.identifier || "—")}${linked.length ? ` · VN application ${linked.map(escapeHtml).join(", ")}` : ""}</p>
    ${sourceRows.map((row, index) => `<details class="hague-disclosure" data-hague-disclosure-key="publication-${index}">
      <summary>${escapeHtml(row.record_kind === "hague_renewal" ? row.data?.renewal_event?.kind || "International renewal" : row.data?.event?.kind || "VN event")}${row.vn_application_no ? ` · ${escapeHtml(row.vn_application_no)}` : ""}</summary>
      ${hagueFieldMarkup([...(row.data?.event?.fields || row.data?.renewal_event?.fields || []),
        { label: "Decision number", value: row.decision_no },
        { label: "Source", value: row.data?.source_pdf || row.source_file }].filter(field => field.value))}
    </details>`).join("")}</section>`;
}

function hagueNumberedItems(field) {
  if (!field?.value) return [];
  const items = field.items?.length ? field.items : field.value.split(/\n(?=\d+\.\s*)/).filter(Boolean);
  return items.map((item, index) => {
    const match = String(item).match(/^\s*(\d+)\.\s*([\s\S]*)/);
    return { number: match?.[1] || String(index + 1), value: (match?.[2] || item).replace(/\s*\n\s*/g, " ").trim() };
  });
}

function hagueInternationalMarkup(result, changedCodes = new Set()) {
  const fields = result.fields || [];
  const byCode = new Map(fields.map(field => [field.code, field]));
  const fact = (label, value, code, emphasis = false) => `<div class="hague-fact${emphasis ? " primary" : ""}${changedCodes.has(code) ? " changed" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "—")}</strong></div>`;
  const jurisdictionLabels = { "85": "Habitual residence", "86": "Nationality", "87": "Domicile", "88": "Establishment", "89": "Applicant party" };
  const jurisdictions = Object.entries(jurisdictionLabels).filter(([code]) => byCode.get(code)?.value);
  const other = fields.filter(field => !["11", "15", "18", "22", "28", "30", "45", "51", "54", "57", "66", "72", "73", "74", "81", "82", "85", "86", "87", "88", "89"].includes(field.code));
  return `<section class="hague-section hague-international"><div class="hague-international-heading"><h3>International registration</h3><a href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer">Open WIPO Hague record ↗</a></div>
    ${result.stale ? `<p class="hague-pdf-warning">Showing cached data. Latest lookup failed: ${escapeHtml(result.lookupError || "Unknown error")}</p>` : ""}
    <div class="hague-fact-grid">${fact("(11) International no.", result.number, "11", true)}${fact("(28) Designs", result.numberOfDesigns, "28", true)}${fact("(15) Registration", result.registrationDate, "15")}${fact("(22) Filing", result.filingDate, "22")}${fact("(18) Expected expiration", result.expirationDate, "18")}${byCode.get("45")?.value ? fact("(45) Publication", String(byCode.get("45").value).replace(/\./g, "/"), "45") : ""}${result.internationalState ? fact("WIPO state", result.internationalState) : ""}</div>
    ${jurisdictions.length ? `<div class="hague-jurisdictions"><h4>Holder connections</h4><div>${jurisdictions.map(([code, label]) => `<span class="hague-jurisdiction${changedCodes.has(code) ? " changed" : ""}"><small>(${code}) ${escapeHtml(label)}</small><strong>${escapeHtml(byCode.get(code).value)}</strong></span>`).join("")}</div></div>` : ""}
    ${other.length ? `<details class="hague-disclosure" data-hague-disclosure-key="other"><summary>Other WIPO fields · ${other.length}</summary>${hagueFieldMarkup(other, changedCodes)}</details>` : ""}</section>`;
}

function hagueDesignMarkup(result, changedCodes = new Set()) {
  const byCode = new Map((result.fields || []).map(field => [field.code, field]));
  const codes = ["51", "54", "57", "30"];
  const maps = new Map(codes.map(code => [code, new Map(hagueNumberedItems(byCode.get(code)).map(item => [item.number, item.value]))]));
  const designNos = [...new Set(codes.flatMap(code => [...maps.get(code).keys()]))].sort((a, b) => Number(a) - Number(b));
  if (!designNos.length) return "";
  return `<section class="hague-section hague-designs"><div class="hague-section-heading"><h3>Designs in this registration</h3><small>${designNos.length} design${designNos.length === 1 ? "" : "s"} · descriptions expand individually</small></div>
    <div class="hague-design-list">${designNos.map(number => {
      const classification = maps.get("51").get(number) || "";
      const product = maps.get("54").get(number) || "";
      const description = maps.get("57").get(number) || "";
      const priority = maps.get("30").get(number) || "";
      const longDescription = description.length > 240;
      return `<article class="hague-design-card" data-hague-design="${escapeHtml(number)}"><div class="hague-design-index">${escapeHtml(number)}</div><div class="hague-design-content"><div class="hague-design-top"><strong>Design ${escapeHtml(number)}</strong>${classification ? `<span class="hague-design-class${changedCodes.has("51") ? " changed" : ""}" title="(51) Locarno classification">${escapeHtml(classification)}</span>` : ""}</div>
        ${product ? `<div class="hague-design-product${changedCodes.has("54") ? " changed" : ""}"><small>(54) Product</small><span>${escapeHtml(product)}</span></div>` : ""}
        ${priority ? `<div class="hague-design-priority${changedCodes.has("30") ? " changed" : ""}"><small>(30) Priority</small><span>${escapeHtml(priority)}</span></div>` : ""}
        ${description ? longDescription ? `<details class="hague-design-description${changedCodes.has("57") ? " changed" : ""}" data-hague-disclosure-key="design-${escapeHtml(number)}"><summary>(57) Description · ${escapeHtml(description.slice(0, 125))}…</summary><p>${escapeHtml(description)}</p></details>` : `<div class="hague-design-description short${changedCodes.has("57") ? " changed" : ""}"><small>(57) Description</small><p>${escapeHtml(description)}</p></div>` : ""}</div></article>`;
    }).join("")}</div></section>`;
}

function hagueAdditionalMarkup(result, changedCodes = new Set()) {
  const byCode = new Map((result.fields || []).map(field => [field.code, field]));
  const parties = String(byCode.get("81")?.value || "").match(/\b[A-Z]{2}\s+\d{4}\b/g) || [];
  const vn = parties.find(item => /^VN\s/.test(item));
  const statementField = byCode.get("82");
  const statements = statementField?.items?.length ? statementField.items : statementField?.value ? statementField.value.split(/\n(?=III\.\s*[A-Z]{2}:)/) : [];
  const principal = byCode.get("66");
  return `<section class="hague-section hague-additional"><h3>Designation and source statements</h3>
    ${byCode.has("81") ? `<div class="hague-designation${changedCodes.has("81") ? " changed" : ""}"><div class="hague-designation-overview"><strong>(81) Designated contracting parties</strong><span>${parties.length} parties${vn ? ` · <span class="hague-party vietnam"><strong>VN</strong><small>${escapeHtml(vn.split(/\s+/)[1])}</small></span>` : ""}</span></div><details class="hague-disclosure" data-hague-disclosure-key="parties"><summary>View all designated parties</summary><div class="hague-party-list">${parties.length ? parties.map(item => {
      const [country, act] = item.split(/\s+/);
      return `<span class="hague-party${country === "VN" ? " vietnam" : ""}"><strong>${escapeHtml(country)}</strong><small>${escapeHtml(act)}</small></span>`;
    }).join("") : `<p>${escapeHtml(byCode.get("81")?.value || "—")}</p>`}</div></details></div>` : ""}
    ${principal?.value ? `<details class="hague-disclosure${changedCodes.has("66") ? " changed" : ""}" data-hague-disclosure-key="principal"><summary>(66) Principal-design relationships · ${principal.items?.length || 1}</summary><div class="hague-source-list">${(principal.items?.length ? principal.items : [principal.value]).map(item => `<p>${escapeHtml(item)}</p>`).join("")}</div></details>` : ""}
    ${statements.length ? `<details class="hague-disclosure${changedCodes.has("82") ? " changed" : ""}" data-hague-disclosure-key="statements"><summary>(82) Application statements · ${statements.length}</summary><div class="hague-statement-list">${statements.map(statement => {
      const match = String(statement).match(/^\s*III\.\s*([A-Z]{2}):\s*([\s\S]*)/);
      return `<div class="hague-statement"><strong>${escapeHtml(match ? match[1] : "Statement")}</strong><p>${escapeHtml(match ? match[2] : statement)}</p></div>`;
    }).join("")}</div></details>` : ""}</section>`;
}

function hagueCreatorRows(people, fields) {
  const source = fields?.find(field => field.code === "72");
  const entries = [];
  for (const item of source?.items || []) {
    const match = String(item).match(/^\s*(\d+)\.\s*([\s\S]*)/);
    const designNo = match?.[1] || "";
    const lines = (match?.[2] || item).split("\n").map(line => line.trim()).filter(Boolean);
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const name = /^[\p{L}'’-]+$/u.test(group[0] || "") && /^[\p{L}'’-]+$/u.test(group[1] || "") ? `${group.shift()} ${group.shift()}` : group.shift();
      entries.push({ designNo, name: name || "—", address: group.join("\n") });
      group = [];
    };
    for (const line of lines) {
      group.push(line);
      if (/\([A-Z]{2}\)\s*$/.test(line)) flush();
    }
    flush();
  }
  if (!entries.length) entries.push(...(people || []));
  const grouped = new Map();
  for (const person of entries) {
    const key = `${String(person.name || "").trim().toLocaleLowerCase()}\u0000${String(person.address || "").trim().toLocaleLowerCase()}`;
    if (!grouped.has(key)) grouped.set(key, { name: person.name || "—", address: person.address || "", designNos: [] });
    if (person.designNo && !grouped.get(key).designNos.includes(person.designNo)) grouped.get(key).designNos.push(person.designNo);
  }
  return [...grouped.values()];
}

function haguePeopleTable(title, people, changed = false, fields = []) {
  if (title === "Creators of designs") people = hagueCreatorRows(people, fields);
  if (!people?.length) return "";
  const numbered = people.some(person => person.designNo || person.designNos?.length);
  return `<section class="hague-section hague-people-section${changed ? " changed" : ""}"><h3>${escapeHtml(title)} <small>· ${people.length}</small></h3><table class="hague-people-table"><thead><tr>${numbered ? "<th>Design(s)</th>" : ""}<th>Name</th><th>Address</th></tr></thead><tbody>${people.map(person => {
    const addressLines = String(person.address || "").split("\n");
    const splitSurname = title === "Creators of designs" && !/\s|,/.test(person.name || "") && /^[\p{L}'’-]+$/u.test(addressLines[0] || "") && addressLines.length > 1;
    const name = splitSurname ? `${person.name} ${addressLines.shift()}` : person.name;
    return `<tr>${numbered ? `<td>${escapeHtml(person.designNos?.join(", ") || person.designNo || "—")}</td>` : ""}<td>${escapeHtml(name)}</td><td>${escapeHtml(addressLines.join("\n") || "—")}</td></tr>`;
  }).join("")}</tbody></table></section>`;
}

function viewedHagueRecord(number) {
  const snapshots = state.hagueHistory.get(number)?.snapshots || [];
  return (snapshots.find(item => String(item.id) === String(state.hagueSelectedSnapshotId)) || snapshots[0])?.data || state.hagueResults.get(number);
}

function hagueVnApplicationNos(record) {
  return [...new Set((record?.events || []).filter(item => /refusal/i.test(item.kind || ""))
    .flatMap(item => item.pdfData?.vnApplicationNos || []))];
}

function renderHagueDetail(number) {
  if (state.selectedHague !== number) return;
  const latest = state.hagueResults.get(number);
  const snapshots = state.hagueHistory.get(number)?.snapshots || [];
  const selectedSnapshot = snapshots.find(item => String(item.id) === String(state.hagueSelectedSnapshotId)) || snapshots[0];
  const result = selectedSnapshot?.data || latest;
  const publicationIndex = state.haguePublicationIndex.get(number);
  els.haguePrint.disabled = !result?.ok;
  els.hagueDownload.disabled = !result?.ok;
  els.detailEmpty.classList.add("hidden");
  els.detailContent.classList.add("hidden");
  els.requestDetail.classList.add("hidden");
  els.hagueDetail.classList.remove("hidden");
  els.hagueDetailNo.textContent = number;
  els.hagueSnapshotBar.classList.toggle("hidden", !snapshots.length);
  if (snapshots.length) {
    const options = snapshots.map((item, index) => `<option value="${escapeHtml(item.id)}">${index === 0 ? "Latest" : `Snapshot ${snapshots.length - index} of ${snapshots.length}`} · ${escapeHtml(formatDate(item.scrapedAt))}</option>`).join("");
    if (els.hagueSnapshot.innerHTML !== options) els.hagueSnapshot.innerHTML = options;
    els.hagueSnapshot.value = String(selectedSnapshot.id);
    const count = selectedSnapshot.changes?.length || 0;
    els.hagueChangeSummary.textContent = count ? `${count} change${count === 1 ? "" : "s"} · View history` : "No changes · View history";
  }
  const queued = state.haguePending.some((job) => job.number === number);
  els.hagueDetailStatus.textContent = state.hagueLoading.has(number) ? "Loading…" : queued ? "Queued" : `${result?.status || (result?.error ? "Lookup error" : state.hagueLoadError ? "Host restart needed" : "Not scraped")}${selectedSnapshot && selectedSnapshot !== snapshots[0] ? " · historical snapshot" : ""}`;
  if (!result) { state.hagueRenderedSignature = ""; els.hagueDetailBody.textContent = state.hagueLoading.has(number) ? "Loading the WIPO Hague record and VN history…" : queued ? "Waiting in the Hague lookup queue…" : state.hagueLoadError || "Not scraped yet. Use this row’s scrape button or Load all DM."; return; }
  if (!result.ok) { state.hagueRenderedSignature = ""; els.hagueDetailBody.textContent = result.error || "Hague lookup failed."; return; }
  const changedPaths = (selectedSnapshot?.changes || []).map(change => change.field);
  const view = selectedSnapshot && selectedSnapshot !== snapshots[0] ? String(selectedSnapshot.id) : "latest";
  const signature = JSON.stringify([number, view, result, changedPaths, publicationIndex]);
  if (state.hagueRenderedSignature === signature) return;
  const preserveOpenRows = state.hagueRenderedNumber === number && state.hagueRenderedView === view;
  const openRows = preserveOpenRows ? new Map([...els.hagueDetailBody.querySelectorAll(".hague-event")].map(card => [card.dataset.hagueEvent, {
    expanded: card.querySelector("[data-hague-toggle]")?.getAttribute("aria-expanded") === "true",
    frame: card.querySelector(".hague-pdf-preview"),
  }])) : new Map();
  const openDisclosures = preserveOpenRows ? new Set([...els.hagueDetailBody.querySelectorAll("details[data-hague-disclosure-key][open]")].map(item => item.dataset.hagueDisclosureKey)) : new Set();
  const changedCodes = new Set(changedPaths.map(path => /^fields\[(\d+)\]$/.exec(path)?.[1]).filter(index => index !== undefined).map(index => result.fields?.[Number(index)]?.code).filter(Boolean));
  const changedGroup = prefix => changedPaths.some(path => path === prefix || path.startsWith(`${prefix}[`) || path.startsWith(`${prefix}.`));
  const events = (result.events || []).map((event, index) => ({ event, index })).sort((a, b) => {
    const dateKey = value => { const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? `${match[3]}${match[2]}${match[1]}` : ""; };
    return dateKey(b.event.bulletinDate).localeCompare(dateKey(a.event.bulletinDate)) || a.index - b.index;
  });
  const sections = [
    `<section class="hague-history-heading"><h3>VN decisions · ${events.length}</h3><p>Latest bulletin first. Expand a decision for its extracted PDF data and WIPO history fields.</p></section>`,
    ...events.map(({ event, index }) => {
      const tone = /^Grant/.test(event.kind) ? "granted" : /^Refusal/.test(event.kind) ? "refusal" : "other";
      const decisionHighlights = [
        ...(event.pdfData?.vnApplicationNos?.length ? [`VN application ${event.pdfData.vnApplicationNos.join(", ")}`] : []),
        ...(event.pdfData?.decisionNo ? [`Decision ${event.pdfData.decisionNo}`] : []),
        ...(event.effectiveDate ? [`Effective ${event.effectiveDate}`] : []),
        ...(event.scope && event.scope.length < 65 ? [event.scope] : []),
      ];
      const pdfFields = event.pdfData ? [
        { label: "International registration", value: event.pdfData.registrationNo }, { label: "Issuing office", value: event.pdfData.office },
        { label: "VN application no.", value: (event.pdfData.vnApplicationNos || []).join("\n") },
        { label: "Protection scope", value: event.pdfData.scope }, { label: "Decision no.", value: event.pdfData.decisionNo },
        { label: "Decision date", value: event.pdfData.decisionDate }, { label: "Amendments", value: event.pdfData.amendments },
        { label: "Grounds for refusal", value: event.pdfData.refusalGrounds },
        { label: "Effect date", value: event.pdfData.effectDate }, { label: "Statement date", value: event.pdfData.statementDate },
      ].filter(field => field.value) : [];
      return `<section class="hague-event ${tone}${changedGroup(`events[${index}]`) ? " changed" : ""}" data-hague-event="${escapeHtml(event.id)}">
        <div class="hague-event-top"><button class="hague-event-toggle" type="button" data-hague-toggle="${escapeHtml(event.id)}" aria-expanded="false" aria-controls="hague-event-body-${escapeHtml(event.id)}"><span class="hague-event-chevron" aria-hidden="true">▸</span><span class="hague-event-summary"><strong>${escapeHtml(event.kind)} · VN</strong><small>Bulletin ${escapeHtml(event.bulletinNo || "—")} · ${escapeHtml(event.bulletinDate || "—")}</small>${decisionHighlights.length ? `<span class="hague-event-highlights">${decisionHighlights.map(value => `<em>${escapeHtml(value)}</em>`).join("")}</span>` : ""}</span></button>
        <div class="hague-event-top-actions">${event.pdfAvailable && event.url ? `<button class="button outline" type="button" data-hague-preview="${escapeHtml(event.id)}" aria-expanded="false">View PDF</button>` : event.pdfUrl ? `<a class="button outline" href="${escapeHtml(event.pdfUrl)}" target="_blank" rel="noopener noreferrer">WIPO PDF ↗</a>` : ""}</div></div>
        <div class="hague-event-body hidden" id="hague-event-body-${escapeHtml(event.id)}">
          ${pdfFields.length ? `<h4>Extracted from PDF</h4>${hagueFieldMarkup(pdfFields)}` : `<p class="hague-pdf-warning">${escapeHtml(event.pdfError || "No PDF text was extracted for this decision.")}</p>`}
          ${(event.fields || []).length ? `<h4>WIPO history fields</h4>${hagueFieldMarkup(event.fields)}` : ""}
          <div class="hague-event-actions">${event.pdfUrl ? `<a href="${escapeHtml(event.pdfUrl)}" target="_blank" rel="noopener noreferrer">Open original PDF ↗</a>` : ""}${event.pdfAvailable && event.url ? `<button class="button outline" type="button" data-hague-save="${escapeHtml(event.id)}">Save PDF</button>` : ""}</div>
          <div data-hague-frame="${escapeHtml(event.id)}"></div>
        </div></section>`;
    }),
    hagueInternationalMarkup(result, changedCodes),
    hagueRenewalMarkup(result),
    haguePublicationIndexMarkup(publicationIndex),
    `<div class="hague-people-grid">${haguePeopleTable("Holders", result.holders, changedGroup("holders"))}${haguePeopleTable("Representatives", result.representatives, changedGroup("representatives"))}</div>`,
    hagueDesignMarkup(result, changedCodes),
    haguePeopleTable("Creators of designs", result.creators, changedGroup("creators"), result.fields),
    hagueAdditionalMarkup(result, changedCodes),
  ];
  els.hagueDetailBody.innerHTML = sections.join("");
  for (const item of els.hagueDetailBody.querySelectorAll("details[data-hague-disclosure-key]")) if (openDisclosures.has(item.dataset.hagueDisclosureKey)) item.open = true;
  for (const card of els.hagueDetailBody.querySelectorAll(".hague-event")) {
    const previous = openRows.get(card.dataset.hagueEvent);
    if (!previous?.expanded) continue;
    card.querySelector(".hague-event-body").classList.remove("hidden");
    card.querySelector("[data-hague-toggle]").setAttribute("aria-expanded", "true");
    if (previous.frame) {
      const holder = card.querySelector("[data-hague-frame]");
      if (holder) {
        holder.appendChild(previous.frame);
        const preview = card.querySelector("[data-hague-preview]");
        if (preview) { preview.setAttribute("aria-expanded", "true"); preview.textContent = "Hide PDF"; }
      }
    }
  }
  state.hagueRenderedNumber = number;
  state.hagueRenderedView = view;
  state.hagueRenderedSignature = signature;
}

function openHagueDetail(number) {
  const canonical = normalizeHagueNo(number);
  if (!canonical || !state.hagueQueue.includes(canonical)) return;
  if (state.selectedHague !== canonical) state.hagueSelectedSnapshotId = "";
  ++state.detailRequestToken;
  state.selected = "";
  state.selectedRequest = "";
  clearRequestPublicationViewer();
  state.selectedHague = canonical;
  renderList();
  renderHagueDetail(canonical);
  if (!state.hagueHistory.has(canonical)) loadHagueHistory(canonical).catch(error => appendLog(`\n[Tracker] Hague history could not be loaded: ${error.message}\n`));
  loadHaguePublicationIndex(canonical).catch(error => appendLog(`\n[Tracker] Hague publication index could not be loaded: ${error.message}\n`));
}

async function scrapeHague(number, refresh = false) {
  const canonical = normalizeHagueNo(number);
  if (!canonical || !state.hagueQueue.includes(canonical) || state.hagueLoading.has(canonical)) return;
  const listId = state.activeListId;
  if (!window.wipoTracker.hagueDesign) {
    state.hagueResults.set(canonical, { ok: false, error: "The LAN host needs restarting to enable Hague lookup." });
    renderList();
    if (state.selectedHague === canonical) renderHagueDetail(canonical);
    return;
  }
  state.hagueLoading.add(canonical);
  renderList();
  if (state.selectedHague === canonical) renderHagueDetail(canonical);
  let result;
  try { result = await window.wipoTracker.hagueDesign(canonical, refresh); }
  catch (error) { result = { ok: false, error: error.message, events: [] }; }
  finally { state.hagueLoading.delete(canonical); }
  if (state.activeListId !== listId || !state.hagueQueue.includes(canonical)) return;
  if (result?.ok) {
    state.hagueResults.set(canonical, result);
    state.hagueHistory.delete(canonical);
    if (state.selectedHague === canonical) state.hagueSelectedSnapshotId = "";
    loadHagueHistory(canonical).catch(error => appendLog(`\n[Tracker] Hague history could not be loaded: ${error.message}\n`));
    loadHaguePublicationIndex(canonical, true).catch(error => appendLog(`\n[Tracker] Hague publication index could not be refreshed: ${error.message}\n`));
  } else if (!state.hagueResults.has(canonical)) state.hagueResults.set(canonical, result);
  renderList();
  if (state.selectedHague === canonical) renderHagueDetail(canonical);
}

function syncHagueQueueButton() {
  const pending = state.haguePending.length;
  const active = state.hagueLoading.size;
  els.hagueFetchAll.disabled = pending + active > 0;
  els.hagueFetchAll.textContent = pending + active ? `${active} active · ${pending} queued` : "Load all DM";
}

function drainHagueQueue() {
  if (hagueDrainTimer) { clearTimeout(hagueDrainTimer); hagueDrainTimer = null; }
  const limit = Math.max(1, Math.min(5, Number(window.wipoTracker.queueConcurrency || 5)));
  const interval = Math.max(0, Number(window.wipoTracker.queueDispatchInterval ?? 1000));
  const wait = Math.max(0, interval - (Date.now() - hagueLastDispatchAt));
  if (state.haguePending.length && state.hagueLoading.size < limit) {
    if (wait) hagueDrainTimer = setTimeout(drainHagueQueue, wait);
    else {
      const job = state.haguePending.shift();
      hagueLastDispatchAt = Date.now();
      scrapeHague(job.number, job.refresh).finally(() => { syncHagueQueueButton(); drainHagueQueue(); });
      if (state.haguePending.length) hagueDrainTimer = setTimeout(drainHagueQueue, Math.max(1, interval));
    }
  }
  syncHagueQueueButton();
  renderList();
  if (state.selectedHague) renderHagueDetail(state.selectedHague);
}

function queueHagueRows(numbers, refresh = false) {
  if (/Restart the WipoPublish LAN host/.test(state.hagueLoadError)) return showToast(state.hagueLoadError, true);
  if (!window.wipoTracker.hagueDesign) return showToast("The LAN host needs restarting to enable Hague lookup.", true);
  let added = 0;
  for (const number of numbers.map(normalizeHagueNo).filter(Boolean)) {
    if (!state.hagueQueue.includes(number) || state.hagueLoading.has(number) || state.haguePending.some((job) => job.number === number) || (!refresh && state.hagueResults.has(number))) continue;
    state.haguePending.push({ number, refresh });
    added += 1;
  }
  if (added) drainHagueQueue();
  return added;
}

function loadAllHagueRows(refresh = false) {
  queueHagueRows([...state.hagueQueue], refresh);
}

async function addInputText(value) {
  const applicationNos = parseInput(value);
  const hagueNos = parseHagueNos(value);
  const caseRefs = parseCaseRefs(value);
  const refsByApplication = {};
  let missing = [];
  if (caseRefs.length) {
    if (!window.wipoTracker.resolveCaseRefs) throw new Error("Case-reference lookup is not available in this running host. Restart the WipoPublish host.");
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
  if (!uniqueApplications.length && !hagueNos.length) {
    showToast(missing.length ? `No application number found for ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}.` : "Enter an application number or IP/PR, IP/TR, or IP/DR case reference.", true);
    return false;
  }
  if (uniqueApplications.length) addApplications(uniqueApplications, refsByApplication);
  if (hagueNos.length) addHagueNumbers(hagueNos);
  if (missing.length) showToast(`${missing.length} case reference${missing.length === 1 ? " was" : "s were"} not found in the linked case indexes.`, true);
  return true;
}

async function refreshList() {
  const token = ++state.listRequestToken;
  const hagueLoad = loadSavedHagueRows().catch(error => appendLog(`\n[Tracker] Hague history could not be loaded: ${error.message}\n`));
  if (state.requestQueue.length) refreshRequestRows().catch((error) => appendLog(`\n[Tracker] Request publication lookup failed: ${error.message}\n`));
  if (!state.queue.length) {
    state.records = new Map();
    state.lookedUpCaseRefs = {};
    state.statusMetadataByApplication = {};
    state.lookedUpRegistrations = {};
    renderList();
    await hagueLoad;
    return;
  }
  const result = await window.wipoTracker.list(state.queue);
  await hagueLoad;
  if (token !== state.listRequestToken) return;
  const previousRecords = state.records;
  state.records = new Map((result.applications || []).map((row) => {
    const detail = state.detailCache.get(row.applicationNo);
    const matchesSnapshot = detail?.latest && (!row.snapshotId || String(row.snapshotId) === String(detail.latest.id));
    return [row.applicationNo, { ...row, visibleChangeCount: matchesSnapshot ? visibleChangeCount(detail) : 0 }];
  }));
  for (const [appNo, record] of state.records) {
    const previous = previousRecords.get(appNo);
    if (previous && previous.lastScrapedAt !== record.lastScrapedAt) invalidateDetail(appNo);
  }
  renderList();
  prefetchDetails(state.queue);
  if (window.wipoTracker.lookupApplicationRefs) {
    window.wipoTracker.lookupApplicationRefs([...state.queue]).then((lookup) => {
      if (token !== state.listRequestToken || !lookup?.ok) return;
      state.lookupRestartNotified = false;
      state.lookedUpCaseRefs = Object.fromEntries((lookup.matches || []).map((match) => [normalize(match.applicationNo), parseCaseRefs((match.caseRefs || []).join("\n"))]));
      state.statusMetadataByApplication = Object.fromEntries((lookup.matches || []).map((match) => [normalize(match.applicationNo), match]));
      renderList();
      if (state.selected) renderDetailCaseRef(state.selected);
    }).catch((error) => {
      appendLog(`\n[Tracker] Could not look up case references: ${error.message}\n`);
      if (!state.lookupRestartNotified && /\b404\b/.test(error.message)) {
        state.lookupRestartNotified = true;
        showToast("WipoPublish LAN host needs a restart to show case references.", true);
      }
    });
  }
  if (window.wipoTracker.lookupRegistrations) {
    window.wipoTracker.lookupRegistrations([], "patent", [...state.queue]).then((lookup) => {
      if (token !== state.listRequestToken || !lookup?.ok) return;
      const registrations = {};
      for (const match of lookup.matches || []) {
        const appNo = normalize(match.applicationNo);
        if (appNo && !registrations[appNo]) registrations[appNo] = match;
      }
      state.lookedUpRegistrations = registrations;
      renderList();
    }).catch((error) => appendLog(`\n[Tracker] Could not look up registration numbers: ${error.message}\n`));
  }
  if (state.selected && state.queue.includes(state.selected)) await openDetail(state.selected, true);
}

function refreshCompletedRecord(applicationNo, imported = null) {
  const appNo = normalize(applicationNo);
  if (!appNo || !state.queue.includes(appNo)) return recordRefreshChain;
  const previous = state.records.get(appNo) || {};
  state.records.set(appNo, {
    ...previous,
    applicationNo: appNo,
    lastScrapedAt: imported?.scrapedAt || new Date().toISOString(),
    visibleChangeCount: 0,
  });
  state.maybeUnpublished.delete(appNo);
  state.notFound.delete(appNo);
  state.siteUnavailable.delete(appNo);
  invalidateDetail(appNo);
  renderList();
  recordRefreshChain = recordRefreshChain.then(async () => {
    const result = await window.wipoTracker.list([appNo]);
    const record = (result.applications || []).find((item) => item.applicationNo === appNo);
    if (record) {
      const detail = state.detailCache.get(appNo);
      const matchesSnapshot = detail?.latest && (!record.snapshotId || String(record.snapshotId) === String(detail.latest.id));
      state.records.set(appNo, { ...record, visibleChangeCount: matchesSnapshot ? visibleChangeCount(detail) : 0 });
    }
    renderList();
    prefetchDetails([appNo]);
    if (state.selected === appNo) await openDetail(appNo, true);
  }).catch((error) => appendLog(`\n[Tracker] Could not refresh ${appNo}: ${error.message}\n`));
  return recordRefreshChain;
}

function hasCaseListTextSelection() {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.toString()) return false;
  return selection.getRangeAt(0).intersectsNode(els.list);
}

function sameAlternatingResultCell(oldCell, nextCell) {
  const oldResult = oldCell.querySelector(".alternating-result");
  const nextResult = nextCell.querySelector(".alternating-result");
  if (!oldResult || !nextResult || oldCell.className !== nextCell.className) return false;
  const stableClasses = (node) => [...node.classList].filter((name) => name !== "showing-changes" && name !== "result-fading").join(" ");
  return stableClasses(oldResult) === stableClasses(nextResult)
    && oldResult.dataset.resultPrimary === nextResult.dataset.resultPrimary
    && oldResult.dataset.resultChanges === nextResult.dataset.resultChanges;
}

function reconcileCaseRows(markup) {
  const incoming = document.createElement("div");
  incoming.innerHTML = markup;
  const oldRows = new Map([...els.list.children].map((row) => [row.dataset.app, row]));
  const nextRows = [...incoming.children];
  nextRows.forEach((nextRow, index) => {
    const oldRow = oldRows.get(nextRow.dataset.app);
    if (!oldRow) {
      els.list.insertBefore(nextRow, els.list.children[index] || null);
      return;
    }
    oldRows.delete(nextRow.dataset.app);
    if (oldRow.className !== nextRow.className) oldRow.className = nextRow.className;
    [...nextRow.children].forEach((nextCell, cellIndex) => {
      const oldCell = oldRow.children[cellIndex];
      if (oldCell && oldCell.outerHTML !== nextCell.outerHTML && !sameAlternatingResultCell(oldCell, nextCell)) oldCell.replaceWith(nextCell);
    });
    if (els.list.children[index] !== oldRow) els.list.insertBefore(oldRow, els.list.children[index] || null);
  });
  oldRows.forEach((row) => row.remove());
}

function renderList() {
  if (caseListPointerDown || hasCaseListTextSelection()) {
    pendingCaseListRender = true;
    return;
  }
  pendingCaseListRender = false;
  updateCaseSortHeaders();
  const hasRows = state.queue.length + state.requestQueue.length + state.hagueQueue.length > 0;
  els.emptyList.classList.toggle("hidden", hasRows);
  els.list.classList.toggle("hidden", !hasRows);
  els.selectAllHead.classList.toggle("hidden", !state.exportMode);
  els.selectAllHead.parentElement.classList.toggle("select-mode", state.exportMode);
  const exportLabel = state.exportMode ? `Export selected (${state.exportSelection.size})` : "Export list";
  els.exportList.querySelector(".action-label").textContent = exportLabel;
  els.exportList.title = exportLabel;
  els.exportList.setAttribute("aria-label", exportLabel);
  syncBulkScrapeButtons();
  els.clearAll.disabled = state.running || !hasRows;
  els.exportList.disabled = !hasRows;
  const applicationMarkup = sortedCaseApplications().map((appNo) => {
    const record = state.records.get(appNo);
    const checked = state.exportSelection.has(appNo);
    const ageClass = scrapeAgeClass(record?.lastScrapedAt);
    const maybeUnpublished = state.maybeUnpublished.has(appNo) && !record;
    const notFound = state.notFound.has(appNo) && !record;
    const isScraping = state.scrapingIds.has(appNo);
    const isQueued = state.scrapeQueuedIds.has(appNo);
    const queuePosition = isQueued ? state.scrapeQueue.findIndex((entry) => entry.appNo === appNo) + 1 : 0;
    const requestCount = pendingScrapeCount(appNo);
    const visibleRequestCount = visibleScrapeCount(appNo);
    const scrapeButtonLocked = requestCount > 0 || visibleRequestCount >= 3;
    const caseRefs = caseRefsForApplication(appNo);
    const registration = registrationForApplication(appNo);
    const statusMetadata = statusMetadataForCaseRef(appNo, caseRefs[0]);
    const caseRefText = caseRefs.length ? `${caseRefs[0]}${caseRefs.length > 1 ? ` +${caseRefs.length - 1}` : ""}` : "—";
    const scrapedAtFull = record ? formatDate(record.lastScrapedAt) : "";
    const scrapedAtDate = record ? formatDate(record.lastScrapedAt, false) : "";
    const scrapedAtClock = record ? scrapedAtFull.slice(scrapedAtDate.length).trim() : "";
    const siteDown = state.siteUnavailable.has(appNo);
    const scrapeStatus = siteDown ? "WIPO site down" : (notFound ? "Not found" : (maybeUnpublished ? "Not yet published?" : ageText(record?.lastScrapedAt)));
    const liveResult = liveScrapeResult(appNo, isScraping, isQueued, queuePosition);
    const displayedResult = liveResult || scrapeStatus;
    const resultClass = liveResult ? ` live-result ${isScraping ? "scraping" : "queued"}` : `${siteDown ? " site-down" : (notFound ? " not-found" : (maybeUnpublished ? " maybe-unpublished" : ""))}`;
    const resultTitle = liveResult ? liveResult : (siteDown ? SITE_DOWN_HINT : (notFound ? NOT_FOUND_HINT : (maybeUnpublished ? MAYBE_UNPUBLISHED_HINT : "")));
    const changeCount = Math.max(0, Number(record?.visibleChangeCount) || 0);
    const resultMarkup = changeCount && !liveResult && !siteDown
      ? `<span class="age alternating-result${resultClass}" data-result-primary="${escapeHtml(displayedResult)}" data-result-changes="${changeCount} changes" aria-label="${escapeHtml(`${displayedResult}; ${changeCount} changes`)}">${escapeHtml(displayedResult)}</span>`
      : `<span class="age${resultClass}"${resultTitle ? ` title="${escapeHtml(resultTitle)}"` : ""}>${escapeHtml(displayedResult)}</span>`;
    return `<div class="case-row ${ageClass} ${state.selected === appNo ? "active" : ""} ${state.exportMode ? "select-mode" : ""} ${state.duplicatePulseIds.has(appNo) ? "duplicate-pulse" : ""}" data-app="${escapeHtml(appNo)}">
      <div class="check-slot ${state.exportMode ? "" : "hidden"}"><input class="row-check" type="checkbox" ${checked ? "checked" : ""} aria-label="Select ${escapeHtml(appNo)}"></div>
      <div class="case-app"><span class="case-no">${escapeHtml(appNo)}</span></div>
      <div class="case-registration" data-registration-type="${escapeHtml(registration?.type || "")}" title="${escapeHtml(registration?.formatted || "")}">${registrationMarkup(registration)}</div>
      <div class="case-ref-cell" title="${escapeHtml(caseRefs.join(" · "))}"><span class="case-cell-text">${escapeHtml(caseRefText)}</span></div>
      <div class="case-metadata-cell case-attorney-cell" title="${escapeHtml(statusMetadata.attorney || "")}"><span class="case-cell-text">${escapeHtml(statusMetadata.attorney || "—")}</span></div>
      <div class="case-metadata-cell case-client-cell" title="${escapeHtml(statusMetadata.client || "")}"><span class="case-cell-text">${escapeHtml(statusMetadata.client || "—")}</span></div>
      <div class="case-metadata-cell case-applicant-cell" title="${escapeHtml(statusMetadata.applicant || "")}"><span class="case-cell-text">${escapeHtml(statusMetadata.applicant || "—")}</span></div>
      <div class="case-wipo-field case-applicationtype-cell" title="${escapeHtml(record?.applicationType || "")}"><span class="case-cell-text">${escapeHtml(record?.applicationType || "—")}</span></div>
      <div class="case-wipo-field case-wipostatus-cell" title="${escapeHtml(record?.status || "")}"><span class="case-cell-text">${escapeHtml(record?.status || "—")}</span></div>
      <div class="case-wipo-field case-grant-cell" title="${escapeHtml(record?.grantNumberDate || "")}"><span class="case-cell-text">${escapeHtml(record?.grantNumberDate || "—")}</span></div>
      <div class="case-wipo-field case-expiry-cell" title="${escapeHtml(record?.expiryDate || "")}"><span class="case-cell-text">${escapeHtml(record?.expiryDate || "—")}</span></div>
      <div class="case-wipo-field case-representative-cell" title="${escapeHtml(record?.ipRepresentatives || "")}"><span class="case-cell-text">${escapeHtml(record?.ipRepresentatives || "—")}</span></div>
      <div class="case-scraped-date" title="${escapeHtml(scrapedAtFull)}"><span class="case-cell-text">${escapeHtml(scrapedAtDate)}</span></div>
      <div class="case-scraped-clock" title="${escapeHtml(scrapedAtFull)}"><span class="case-cell-text">${escapeHtml(scrapedAtClock)}</span></div>
      <div class="case-status-cell">${resultMarkup}</div>
      <button class="scrape-row${isScraping ? " is-scraping" : ""}${isQueued ? " is-queued" : ""}" data-scrape="${escapeHtml(appNo)}" title="${visibleRequestCount >= 3 ? "Re-scraping after 3 confirmation clicks" : requestCount ? "Scraping application" : visibleRequestCount ? `Confirm re-scrape · ${visibleRequestCount} of 3 clicks` : "Add to scrape queue"}" aria-label="${visibleRequestCount >= 3 ? `Re-scraping ${escapeHtml(appNo)} after 3 confirmation clicks.` : requestCount ? `Scraping ${escapeHtml(appNo)}.` : visibleRequestCount ? `Confirm re-scrape for ${escapeHtml(appNo)}. ${visibleRequestCount} of 3 clicks.` : `Queue scrape for ${escapeHtml(appNo)}`}" aria-busy="${isScraping ? "true" : "false"}" ${scrapeButtonLocked ? "disabled" : ""}><span class="scrape-row-icon" aria-hidden="true"></span>${visibleRequestCount ? `<span class="scrape-request-count" aria-hidden="true">${visibleRequestCount}</span>` : ""}</button>
      <button class="remove-row" data-remove="${escapeHtml(appNo)}" title="Remove from case list" aria-label="Remove ${escapeHtml(appNo)} from case list"><span aria-hidden="true">×</span></button>
    </div>`;
  }).join("");
  const requestMarkup = state.requestQueue.map((requestNo) => {
    const result = state.requestResults.get(requestNo);
    const documents = result?.documents || [];
    const first = documents[0] || {};
    const caseRefs = result?.caseRefs || [];
    const status = !result ? "Looking up…" : result.hostOffline ? "Host offline" : result.hostUpdateRequired ? "Restart host" : !result.ok ? "Lookup error" : documents.length ? `PDF ${documents.length}` : "No PDF";
    const requestStatusClass = result?.ok ? (documents.length ? "scrape-today" : "scrape-stale") : "";
    const tooltip = result?.error || (documents.length ? `${documents.length} extracted publication PDF(s)` : "No prepared publication PDF found for this request.");
    return `<div class="case-row request-row ${requestStatusClass} ${state.selectedRequest === requestNo ? "active" : ""}" data-app="${escapeHtml(requestNo)}" data-request="${escapeHtml(requestNo)}" aria-label="Request number ${escapeHtml(requestNo)}">
      <div class="check-slot hidden"></div>
      <div class="request-identity" title="Request no. ${escapeHtml(requestNo)}"><small>REQ</small><strong>${escapeHtml(requestNo)}</strong></div>
      <div class="case-ref-cell" title="${escapeHtml(caseRefs.join(" · "))}"><span class="case-cell-text">${escapeHtml(caseRefs.join(" · ") || "—")}</span></div>
      <div class="case-metadata-cell case-attorney-cell"><span class="case-cell-text">—</span></div>
      <div class="case-metadata-cell case-client-cell"><span class="case-cell-text">—</span></div>
      <div class="case-metadata-cell case-applicant-cell"><span class="case-cell-text">—</span></div>
      <div class="case-wipo-field case-applicationtype-cell"><span class="case-cell-text">${escapeHtml(result?.kind || requestKindLabel(requestNo))}</span></div>
      <div class="case-wipo-field case-wipostatus-cell"><span class="case-cell-text">Publication request</span></div>
      <div class="case-wipo-field case-grant-cell"><span class="case-cell-text">${escapeHtml(first.registrationNo || "—")}</span></div>
      <div class="case-wipo-field case-expiry-cell"><span class="case-cell-text">—</span></div>
      <div class="case-wipo-field case-representative-cell"><span class="case-cell-text">—</span></div>
      <div class="case-scraped-date"><span class="case-cell-text">—</span></div>
      <div class="case-scraped-clock"></div>
      <div class="case-status-cell" title="${escapeHtml(tooltip)}"><span class="age">${escapeHtml(status)}</span></div>
      <span class="request-scrape-empty" aria-hidden="true"></span>
      <button class="remove-row" data-remove="${escapeHtml(requestNo)}" title="Remove request from case list" aria-label="Remove ${escapeHtml(requestNo)} from case list"><span aria-hidden="true">×</span></button>
    </div>`;
  }).join("");
  const hagueMarkup = state.hagueQueue.map(number => {
    const result = state.hagueResults.get(number);
    const vnApplicationNos = hagueVnApplicationNos(result);
    const isScraping = state.hagueLoading.has(number);
    const queued = state.haguePending.some((job) => job.number === number);
    const status = isScraping ? "Loading…" : queued ? `Queued ${state.haguePending.findIndex((job) => job.number === number) + 1}` : result?.status || (result?.error ? "Lookup error" : state.hagueLoadError ? "Host restart needed" : "Not scraped");
    const changeCount = Math.max(0, Number(result?.changeCount) || 0);
    const hagueResultMarkup = changeCount && !isScraping && !queued
      ? `<span class="age alternating-result" data-result-primary="${escapeHtml(status)}" data-result-changes="${changeCount} changes" aria-label="${escapeHtml(`${status}; ${changeCount} changes`)}">${escapeHtml(status)}</span>`
      : `<span class="age">${escapeHtml(status)}</span>`;
    const colorClass = result?.status?.startsWith("Grant") ? "scrape-today" : result?.status === "Refusal" || result?.error || (!result && state.hagueLoadError) ? "scrape-stale" : "";
    return `<div class="case-row request-row hague-row ${colorClass} ${state.selectedHague === number ? "active" : ""}" data-app="${escapeHtml(number)}" data-hague="${escapeHtml(number)}" aria-label="Hague design ${escapeHtml(number)}">
      <div class="check-slot hidden"></div><div class="request-identity"><small>DM</small><strong>${escapeHtml(number)}</strong></div>
      <div class="case-registration" title="${escapeHtml(vnApplicationNos.length ? `VN application no. from refusal PDF: ${vnApplicationNos.join(' · ')}` : 'No VN application no. extracted from a refusal PDF')}"><span class="case-cell-text">${escapeHtml(vnApplicationNos.join(' · ') || '—')}</span></div>
      <div class="case-ref-cell"><span class="case-cell-text">—</span></div>
      <div class="case-metadata-cell case-attorney-cell"><span class="case-cell-text">—</span></div>
      <div class="case-metadata-cell case-client-cell"><span class="case-cell-text">—</span></div>
      <div class="case-metadata-cell case-applicant-cell"><span class="case-cell-text">${escapeHtml(result?.holders?.map(item => item.name).join(" · ") || "—")}</span></div>
      <div class="case-wipo-field case-applicationtype-cell"><span class="case-cell-text">International design</span></div>
      <div class="case-wipo-field case-wipostatus-cell"><span class="case-cell-text">${escapeHtml(status)}</span></div>
      <div class="case-wipo-field case-grant-cell"><span class="case-cell-text">${escapeHtml(number)}</span></div>
      <div class="case-wipo-field case-expiry-cell"><span class="case-cell-text">${escapeHtml(result?.expirationDate || "—")}</span></div>
      <div class="case-wipo-field case-representative-cell"><span class="case-cell-text">${escapeHtml(result?.representatives?.map(item => item.name).join(" · ") || "—")}</span></div>
      <div class="case-scraped-date"><span class="case-cell-text">${escapeHtml(result?.checkedAt ? formatDate(result.checkedAt).split(" ")[0] : "—")}</span></div>
      <div class="case-scraped-clock"></div><div class="case-status-cell" title="${escapeHtml(result?.lookupError || result?.error || state.hagueLoadError || status)}">${hagueResultMarkup}</div>
      <button class="scrape-row${isScraping ? " is-scraping" : ""}${queued ? " is-queued" : ""}" data-hague-scrape="${escapeHtml(number)}" title="${isScraping ? "Looking up Hague design" : queued ? "Queued for Hague lookup" : "Scrape Hague design"}" aria-label="Scrape Hague design ${escapeHtml(number)}" aria-busy="${isScraping ? "true" : "false"}" ${isScraping || queued ? "disabled" : ""}><span class="scrape-row-icon" aria-hidden="true"></span></button>
      <button class="remove-row" data-remove="${escapeHtml(number)}" title="Remove Hague registration" aria-label="Remove ${escapeHtml(number)} from case list"><span aria-hidden="true">×</span></button></div>`;
  }).join("");
  const rowMarkup = applicationMarkup + requestMarkup + hagueMarkup;
  reconcileCaseRows(rowMarkup);
  syncAlternatingResults();
  syncListHeaderGutter();
  fitProtectedColumnsToPane(els.casePanel.getBoundingClientRect().width);
  els.selectAll.checked = state.queue.length > 0 && state.exportSelection.size === state.queue.length;
}

function syncAlternatingResults() {
  const nodes = els.list.querySelectorAll(".alternating-result");
  if (!nodes.length) {
    if (alternatingResultTimer) window.clearInterval(alternatingResultTimer);
    if (alternatingFadeTimer) window.clearTimeout(alternatingFadeTimer);
    alternatingResultTimer = null;
    alternatingFadeTimer = null;
    alternatingResultFading = false;
    showingChangeResults = false;
    return;
  }
  const configured = Number(window.WIPO_CHANGE_RESULT_INTERVAL_MS);
  const interval = Number.isFinite(configured) && configured > 0 ? configured : 5000;
  const configuredFade = Number(window.WIPO_CHANGE_RESULT_FADE_MS);
  const fadeDuration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0
    : Math.min(interval * 0.4, Number.isFinite(configuredFade) && configuredFade > 0 ? configuredFade : 1400);
  nodes.forEach((node) => {
    const nextText = showingChangeResults ? node.dataset.resultChanges : node.dataset.resultPrimary;
    const selection = window.getSelection?.();
    const selected = selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(node);
    if (!selected && node.textContent !== nextText) node.textContent = nextText;
    node.classList.toggle("showing-changes", showingChangeResults);
    node.classList.toggle("result-fading", alternatingResultFading);
    node.style.setProperty("--result-breathe-duration", `${fadeDuration}ms`);
  });
  if (alternatingResultTimer) return;
  alternatingResultTimer = window.setInterval(() => {
    const currentNodes = [...els.list.querySelectorAll(".alternating-result")];
    if (!currentNodes.length) { syncAlternatingResults(); return; }
    alternatingResultFading = true;
    currentNodes.forEach((node) => node.classList.add("result-fading"));
    alternatingFadeTimer = window.setTimeout(() => {
      alternatingFadeTimer = null;
      showingChangeResults = !showingChangeResults;
      syncAlternatingResults();
      alternatingResultFading = false;
      const updatedNodes = [...els.list.querySelectorAll(".alternating-result")];
      updatedNodes.forEach((node) => { void node.offsetWidth; node.classList.remove("result-fading"); });
    }, fadeDuration);
  }, interval);
}

function removeApplication(appNo) {
  const hagueNo = normalizeHagueNo(appNo);
  if (hagueNo) {
    state.hagueQueue = state.hagueQueue.filter(item => item !== hagueNo);
    state.hagueResults.delete(hagueNo);
    if (state.selectedHague === hagueNo) { state.selectedHague = ""; els.hagueDetail.classList.add("hidden"); els.detailEmpty.classList.remove("hidden"); }
    saveQueue(); renderList(); return;
  }
  const requestNo = normalizeRequestNo(appNo);
  if (requestNo) {
    state.requestQueue = state.requestQueue.filter((item) => item !== requestNo);
    state.requestResults.delete(requestNo);
    if (state.selectedRequest === requestNo) {
      state.selectedRequest = "";
      clearRequestPublicationViewer();
      els.requestDetail.classList.add("hidden");
      els.detailEmpty.classList.remove("hidden");
    }
    saveQueue();
    renderList();
    return;
  }
  state.queue = state.queue.filter((id) => id !== appNo);
  delete state.caseRefsByApplication[appNo];
  delete state.lookedUpCaseRefs[appNo];
  delete state.registrationsByApplication[appNo];
  delete state.lookedUpRegistrations[appNo];
  state.maybeUnpublished.delete(appNo);
  state.notFound.delete(appNo);
  state.siteUnavailable.delete(appNo);
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
  if (!(state.queue.length + state.requestQueue.length + state.hagueQueue.length) || state.running) return;
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
  state.requestQueue = [];
  state.hagueQueue = [];
  state.hagueResults.clear();
  state.hagueHistory.clear();
  state.hagueSelectedSnapshotId = "";
  state.hagueLoadError = "";
  state.hagueRenderedSignature = "";
  state.haguePending = [];
  if (hagueDrainTimer) { clearTimeout(hagueDrainTimer); hagueDrainTimer = null; }
  state.hagueLoading.clear();
  state.selectedHague = "";
  state.requestResults.clear();
  state.selectedRequest = "";
  clearRequestPublicationViewer();
  state.caseRefsByApplication = {};
  state.lookedUpCaseRefs = {};
  state.statusMetadataByApplication = {};
  state.registrationsByApplication = {};
  state.lookedUpRegistrations = {};
  state.maybeUnpublished.clear();
  state.notFound.clear();
  state.siteUnavailable.clear();
  state.exportSelection.clear();
  state.exportMode = false;
  state.selected = "";
  state.detail = null;
  saveQueue();
  renderList();
  els.detailContent.classList.add("hidden");
  els.requestDetail.classList.add("hidden");
  els.hagueDetail.classList.add("hidden");
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

function changeFieldLabel(path) {
  const value = String(path || "Unknown field");
  if (state.changeHistoryMode === "hague") {
    const field = value.match(/^fields\[(\d+)\]$/);
    if (field) return `International registration · field ${Number(field[1]) + 1}`;
    const event = value.match(/^events\[(\d+)\]$/);
    if (event) return `VN decision · event ${Number(event[1]) + 1}`;
    const person = value.match(/^(holders|representatives|creators)\[(\d+)\]$/);
    if (person) return `${({ holders: "Holders", representatives: "Representatives", creators: "Creators" })[person[1]]} · row ${Number(person[2]) + 1}`;
    const names = { status: "VN status", registrationDate: "International registration date", expirationDate: "Expected expiration date", filingDate: "Filing date", internationalState: "International status", currentStatus: "Current WIPO status", numberOfDesigns: "Number of designs" };
    if (names[value]) return names[value];
  }
  const displayLabels = {
    "display.grant_number_date": "Grant number and date",
    "display.expiry_date": "Expiry date",
    "display.application_number_date": "Application number and filing date",
    "display.publication_number_date": "Publication number and date",
    "display.pct_application_number_date": "PCT application number and filing date",
    "display.pct_publication_number_date": "PCT publication number and date",
    "display.national_phase_entry_date": "National phase entry date",
    "display.priority": "Priority",
    "display.cited_documents": "(58) Cited documents",
    "display.procedural_timeline": "Procedural timeline",
  };
  if (displayLabels[value]) return displayLabels[value];
  const peopleDisplay = value.match(/^display\.people\.(applicants|inventors|designers|representatives)$/i);
  if (peopleDisplay) return ({ applicants: "Applicants / Owners", inventors: "Inventors", designers: "Designers", representatives: "IP Representatives" })[peopleDisplay[1].toLowerCase()];
  if (value.startsWith("display.collection.")) return readableLabel(value.slice("display.collection.".length));
  if (/^(?:fields\.Trạng thái|split_fields\.status)$/i.test(value)) return "Status";
  if (/^diary\[\d+\]$/i.test(value)) {
    const row = Number(value.match(/\[(\d+)\]/)?.[1] || 0) + 1;
    return `Procedural timeline · event ${row}`;
  }
  if (/^dates\[\d+\]$/i.test(value)) {
    const row = Number(value.match(/\[(\d+)\]/)?.[1] || 0) + 1;
    return `Procedural timeline · date ${row}`;
  }
  const priorityRow = value.match(/^split_fields\.priority_details\[(\d+)\]$/i);
  if (priorityRow) return `Priority · row ${Number(priorityRow[1]) + 1}`;
  if (/^split_fields\.priority_details$/i.test(value)) return "Priority";
  const match = value.match(/^(.*?)(?:\[(\d+)\])(?:\.(.+))?$/);
  if (!match) return readableLabel(value);
  const base = readableLabel(match[1]);
  const detail = match[3] ? ` · ${readableLabel(match[3])}` : "";
  return `${base} · row ${Number(match[2]) + 1}${detail}`;
}

function parsedChangeValue(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

function proceduralChangeDate(value) {
  const parsed = parsedChangeValue(value);
  if (!parsed) return "";
  const date = parsed.date && typeof parsed.date === "object" ? parsed.date : parsed;
  if (!(date.raw || date.date_text || date.iso || (date.day && date.month && date.year))) return "";
  return structuredDate(date);
}

function proceduralChangeValue(value, field) {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = parsedChangeValue(value);
  if (!parsed) return changeValue(value);
  const date = proceduralChangeDate(parsed);
  if (String(field || "").startsWith("dates[")) return date || "—";
  const description = String(parsed.description || parsed.event || parsed.title || "").trim();
  const extra = Array.isArray(parsed.extra) ? parsed.extra.map((item) => displayValue(item)).filter(Boolean) : [];
  return [date, description, ...extra].filter(Boolean).join("\n") || "—";
}

function changeValue(value, field = "") {
  if (/^(?:diary|dates)\[\d+\]$/i.test(String(field))) return proceduralChangeValue(value, field);
  if (value === null || value === undefined) return "—";
  if (value === "") return String(field).startsWith("display.") ? "—" : "(empty)";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return normalizeDisplayDates(JSON.stringify(parsed, null, 2));
    } catch {}
  }
  return displayValue(value);
}

function priorityChangeRows(value) {
  const parsed = parsedChangeValue(value);
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  return items.map((item) => {
    const identity = priorityIdentity(item);
    return [identity.country, identity.number, structuredDate(item.priority_date || item.priority_date_text || "")];
  });
}

function grantNumberDateChangeRows(value) {
  const parsed = parsedChangeValue(value);
  if (parsed && typeof parsed === "object") {
    const number = parsed.number || parsed.registration_number || parsed.grant_number || "—";
    const date = structuredDate(parsed.date || parsed.grant_date || parsed.date_text || "");
    return [[number, date]];
  }
  const text = String(value || "").trim();
  const numberMatch = text.match(/\b([1-5]-\d{5,9}-\d{3})\b/);
  const dateMatch = text.match(/\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})\b/);
  return [[numberMatch?.[1] || "—", dateMatch ? structuredDate(dateMatch[0]) : "—"]];
}

function citedDocumentChangeRows(value) {
  const parsed = parsedChangeValue(value);
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : parseCitedDocumentsForDisplay(value);
  return items.filter((item) => item && typeof item === "object").map((item) => [
    item.reference_no || "—",
    structuredDate(item.reference_date || ""),
    item.reference_text || "—",
    item.claim_type || "—",
    item.document_type || "—",
  ]);
}

function proceduralTimelineChangeRows(value) {
  const parsed = parsedChangeValue(value);
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  return items.map((item) => {
    const date = structuredDate(item.date || item.date_text || item);
    const event = item.description || item.event || item.title || item.raw || "—";
    const details = Array.isArray(item.extra) ? item.extra.filter(Boolean).map(displayValue).join(" · ") : (item.status || "—");
    return [date, event, details || "—"];
  });
}

function personChangeRows(value) {
  const parsed = parsedChangeValue(value);
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
  if (items.length) return items.filter((item) => item && typeof item === "object").map((item) => [
    item.name || item.applicant_name || item.inventor_name || item.designer_name || item.representative_name || "—",
    item.address || item.applicant_address || item.inventor_address || item.designer_address || item.representative_address || "—",
  ]);
  const text = String(value || "").trim();
  if (!text) return [];
  const parts = text.split(/\s+:\s+/, 2);
  return [[parts[0] || "—", parts[1] || "—"]];
}

function nestedChangeTable(headers, rows, extraClass = "") {
  if (!rows.length) return "";
  const columnClass = (header) => {
    const label = String(header || "").trim();
    if (/date|ngày/i.test(label)) return "change-column-date";
    if (/registration|grant|reg\s+no\.?/i.test(label)) return "change-column-identifier";
    if (/^(?:no\.|country|code|edition|hash)$/i.test(label)) return "change-column-compact";
    if (/number/i.test(label)) return "change-column-number";
    return "";
  };
  const columnClasses = headers.map(columnClass);
  return `<div class="change-structured-table-wrap"><table class="change-structured-table ${extraClass}"><colgroup>${columnClasses.map((className) => `<col${className ? ` class="${className}"` : ""}>`).join("")}</colgroup><thead><tr>${headers.map((header, index) => `<th class="${columnClasses[index]}">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td class="${columnClasses[index] || ""}">${escapeHtml(displayValue(cell))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function structuredChangeValue(value) {
  const parsed = parsedChangeValue(value);
  if (!parsed) return "";
  const ignored = new Set(["raw", "order"]);
  const label = (key) => ({ name: "Name", address: "Address", applicant_name: "Name", applicant_address: "Address", inventor_name: "Name", inventor_address: "Address", representative_name: "Name", representative_address: "Address" })[key]
    || readableLabel(key).replace(/\b\w/g, (character) => character.toUpperCase());
  const cell = (item) => {
    if (item === null || item === undefined || item === "") return "—";
    if (Array.isArray(item)) return item.map(cell).join(" · ");
    if (typeof item === "object") {
      if (item.raw || item.iso || (item.day && item.month && item.year)) return structuredDate(item);
      return Object.entries(item).filter(([key]) => !ignored.has(key)).map(([key, nested]) => `${label(key)}: ${cell(nested)}`).join(" · ");
    }
    return normalizeDisplayDates(item);
  };
  const items = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [parsed];
  if (Array.isArray(parsed) && items.length) {
    const keys = [...new Set(items.flatMap((item) => Object.keys(item)))].filter((key) => !ignored.has(key));
    if (keys.length) return nestedChangeTable(keys.map(label), items.map((item) => keys.map((key) => cell(item[key]))), "change-generic-table");
  }
  const rows = Object.entries(parsed).filter(([key]) => !ignored.has(key)).map(([key, item]) => [label(key), cell(item)]);
  return nestedChangeTable(["Field", "Value"], rows, "change-key-value-table");
}

function changeValueHtml(value, field = "") {
  if (/^(?:diary|dates)\[\d+\]$/i.test(String(field))) return escapeHtml(changeValue(value, field));
  if (/^display\.grant_number_date$/i.test(String(field))) {
    return nestedChangeTable(["Reg No.", "Grant date"], grantNumberDateChangeRows(value), "change-grant-table");
  }
  if (/^display\.procedural_timeline$/i.test(String(field))) {
    const rows = proceduralTimelineChangeRows(value);
    if (rows.length) return nestedChangeTable(["Date", "Event", "Details"], rows, "change-timeline-table");
  }
  if (/^display\.people\./i.test(String(field))) {
    const rows = personChangeRows(value);
    if (rows.length) return nestedChangeTable(["Name", "Address"], rows, "change-people-table");
  }
  if (/^(?:display\.priority|split_fields\.priority_details(?:\[\d+\])?)$/i.test(String(field))) {
    const rows = priorityChangeRows(value);
    if (rows.length) return nestedChangeTable(["Country", "Priority number", "Priority date"], rows, "change-priority-table");
  }
  if (/^(?:display\.cited_documents|split_fields\.cited_documents(?:\[\d+\])?|fields\.\(58\))/i.test(String(field))) {
    const rows = citedDocumentChangeRows(value);
    if (rows.length) return nestedChangeTable(["No.", "Date", "Reference", "Claim type", "Document type"], rows, "change-cited-table");
  }
  const structured = structuredChangeValue(value);
  if (structured) return structured;
  return escapeHtml(changeValue(value, field));
}

const CHANGE_FIELD_GROUPS = [
  { id: "grant_number_date", raw: /^fields\.\(10\)\s*Số bằng và ngày cấp$/i, split: /^split_fields\.grant_number_date(?:\.|$)/i },
  { id: "expiry_date", raw: /^fields\.\(180\)\s*Ngày hết hạn$/i, split: /^split_fields\.expiry_date(?:\.|$)/i },
  { id: "application_number_date", raw: /^fields\.\(20\)\s*Số đơn và Ngày nộp đơn$/i, split: /^split_fields\.application_number_date(?:\.|$)/i },
  { id: "publication_number_date", raw: /^fields\.\(40\)\s*Số công bố và ngày công bố$/i, split: /^split_fields\.publication_number_date(?:\.|$)/i },
  { id: "pct_application_number_date", raw: /^fields\.\(86\)\s*Số đơn và ngày nộp đơn PCT$/i, split: /^split_fields\.pct_application_number_date(?:\.|$)/i },
  { id: "pct_publication_number_date", raw: /^fields\.\(87\)\s*Số công bố và ngày công bố đơn PCT$/i, split: /^split_fields\.pct_publication_number_date(?:\.|$)/i },
  { id: "national_phase_entry_date", raw: /^fields\.\(85\)/i, split: /^split_fields\.national_phase_entry_date(?:\.|$)/i },
];

function changeFieldGroup(field) {
  return CHANGE_FIELD_GROUPS.find((group) => group.raw.test(field) || group.split.test(field));
}

function structuredGroupValue(group, changes, side) {
  const rawChange = changes.find((change) => group.raw.test(String(change.field || "")))
    || changes.find((change) => /\.raw$/i.test(String(change.field || "")));
  const rawValue = rawChange?.[side];
  if (rawValue !== null && rawValue !== undefined && String(rawValue).trim()) return rawValue;
  const values = new Map(changes.map((change) => [String(change.field || "").replace(group.split, "").replace(/^\./, ""), change[side]]));
  const value = (...keys) => keys.map((key) => values.get(key)).find((item) => item !== null && item !== undefined && String(item).trim()) || "";
  const dateObject = {
    raw: value("date.raw", "date_text", "raw"),
    iso: value("date.iso", "iso"),
    day: value("date.day", "day"),
    month: value("date.month", "month"),
    year: value("date.year", "year"),
  };
  const date = (dateObject.raw || dateObject.iso || (dateObject.day && dateObject.month && dateObject.year)) ? structuredDate(dateObject) : "";
  const number = value("number");
  return [number, date].filter(Boolean).join(" ");
}

function displayedChangeValueSignature(value, field) {
  const container = document.createElement("div");
  container.innerHTML = changeValueHtml(value, field);
  const table = container.querySelector(":scope > .change-structured-table-wrap > .change-structured-table");
  if (!table) return `text:${container.textContent || ""}`;
  const headers = [...table.querySelectorAll(":scope > thead > tr > th")].map((cell) => cell.textContent || "");
  const rows = [...table.querySelectorAll(":scope > tbody > tr")].map((row) => [...row.cells].map((cell) => cell.textContent || ""));
  return `table:${JSON.stringify({ headers, rows })}`;
}

function hasVisibleSnapshotChange(change) {
  return displayedChangeValueSignature(change?.oldValue, change?.field) !== displayedChangeValueSignature(change?.newValue, change?.field);
}

function snapshotValueAtPath(data, path) {
  return String(path || "").split(".").filter(Boolean).reduce((value, key) => value?.[key], data);
}

function changedCollectionRows(source, indexes, side) {
  return indexes.map((index) => parsedChangeValue(source[index]?.[side]))
    .filter((value) => value !== null && value !== undefined)
    .flatMap((value) => Array.isArray(value) ? value : [value]);
}

function fullCollectionValue(data, path, source, indexes, side) {
  const snapshotValue = snapshotValueAtPath(data, path);
  const rows = Array.isArray(snapshotValue) ? snapshotValue : changedCollectionRows(source, indexes, side);
  return JSON.stringify(rows || []);
}

function displayedSnapshotChanges(changes = [], currentData = null, previousData = null) {
  const source = Array.isArray(changes) ? changes : [];
  const timelineIndexes = source.map((change, index) => /^(?:diary|dates)\[\d+\]$/i.test(String(change.field || "")) ? index : -1).filter((index) => index >= 0);
  const timelineIndex = timelineIndexes[0];
  const timelineRowsForSide = (data, side) => {
    if (Array.isArray(data?.diary)) return data.diary;
    const rows = timelineIndexes.map((index) => source[index]).filter((change) => /^diary\[\d+\]$/i.test(String(change.field || "")))
      .map((change) => parsedChangeValue(change[side])).filter(Boolean);
    if (rows.length) return rows;
    return timelineIndexes.map((index) => source[index]).map((change) => parsedChangeValue(change[side])).filter(Boolean);
  };
  const timelineDisplayChange = timelineIndex >= 0 ? {
    ...(source[timelineIndex] || {}), field: "display.procedural_timeline", changeType: "changed",
    oldValue: JSON.stringify(timelineRowsForSide(previousData, "oldValue")),
    newValue: JSON.stringify(timelineRowsForSide(currentData, "newValue")),
  } : null;
  const peopleGroups = new Map();
  source.forEach((change, index) => {
    const match = String(change.field || "").match(/^(?:(split_fields\.)?)(applicants|inventors|designers|representatives)(?:_ordered)?\[(\d+)\]$/i);
    if (!match) return;
    const key = match[2].toLowerCase();
    if (!peopleGroups.has(key)) peopleGroups.set(key, { kind: key, indexes: [] });
    peopleGroups.get(key).indexes.push(index);
  });
  const peopleByIndex = new Map();
  const personValue = (group, data, side) => {
    const candidates = [
      `${group.kind}_ordered`,
      group.kind,
      `split_fields.${group.kind}_ordered`,
      `split_fields.${group.kind}`,
    ];
    const snapshotRows = candidates.map((path) => snapshotValueAtPath(data, path)).find((value) => Array.isArray(value) && value.length);
    if (snapshotRows) return JSON.stringify(snapshotRows);
    const groupChanges = group.indexes.map((index) => source[index]);
    const preferred = groupChanges.filter((change) => /_ordered\[\d+\]$/i.test(String(change.field || "")) && parsedChangeValue(change[side]));
    const selected = preferred.length ? preferred : groupChanges.filter((change) => change[side] !== null && change[side] !== undefined && String(change[side]).trim());
    return JSON.stringify(selected.flatMap((change) => personChangeRows(change[side])).map((row) => ({ name: row[0], address: row[1] })));
  };
  for (const group of peopleGroups.values()) {
    const firstIndex = group.indexes[0];
    peopleByIndex.set(firstIndex, {
      ...(source[firstIndex] || {}), field: `display.people.${group.kind}`,
      oldValue: personValue(group, previousData, "oldValue"), newValue: personValue(group, currentData, "newValue"),
    });
    group.indexes.slice(1).forEach((index) => peopleByIndex.set(index, null));
  }
  const priorityIndexes = source.map((change, index) => /^split_fields\.priority_details(?:\[\d+\])?$/i.test(String(change.field || "")) ? index : -1).filter((index) => index >= 0);
  const priorityIndex = priorityIndexes[0];
  const priorityDisplayChange = priorityIndex >= 0 ? {
    ...(source[priorityIndex] || {}), field: "display.priority", changeType: "changed",
    oldValue: fullCollectionValue(previousData, "split_fields.priority_details", source, priorityIndexes, "oldValue"),
    newValue: fullCollectionValue(currentData, "split_fields.priority_details", source, priorityIndexes, "newValue"),
  } : null;
  const citedIndexes = source.map((change, index) => /^(?:fields\.\(58\)|split_fields\.cited_documents(?:\[\d+\])?)/i.test(String(change.field || "")) ? index : -1).filter((index) => index >= 0);
  const citedIndex = citedIndexes[0];
  const citedChanges = citedIndexes.map((index) => source[index]);
  const citedRowsForSide = (side) => {
    const raw = citedChanges.find((change) => /^fields\.\(58\)/i.test(String(change.field || "")));
    const rawRows = raw ? citedDocumentChangeRows(raw[side]) : [];
    if (rawRows.length) return rawRows;
    return citedChanges.filter((change) => /^split_fields\.cited_documents\[\d+\]$/i.test(String(change.field || "")))
      .flatMap((change) => citedDocumentChangeRows(change[side]));
  };
  const citedDisplayChange = citedIndex >= 0 ? {
    ...(source[citedIndex] || {}), field: "display.cited_documents", changeType: "changed",
    oldValue: JSON.stringify(citedRowsForSide("oldValue").map((row) => ({ reference_no: row[0], reference_date: row[1], reference_text: row[2], claim_type: row[3], document_type: row[4] }))),
    newValue: JSON.stringify(citedRowsForSide("newValue").map((row) => ({ reference_no: row[0], reference_date: row[1], reference_text: row[2], claim_type: row[3], document_type: row[4] }))),
  } : null;
  const reservedCollectionIndexes = new Set(timelineIndexes);
  for (const group of peopleGroups.values()) group.indexes.forEach((index) => reservedCollectionIndexes.add(index));
  priorityIndexes.forEach((index) => reservedCollectionIndexes.add(index));
  citedIndexes.forEach((index) => reservedCollectionIndexes.add(index));
  const collectionGroups = new Map();
  source.forEach((change, index) => {
    if (reservedCollectionIndexes.has(index)) return;
    const match = String(change.field || "").match(/^(.*)\[(\d+)\]$/);
    if (!match) return;
    const path = match[1];
    if (!collectionGroups.has(path)) collectionGroups.set(path, { path, indexes: [] });
    collectionGroups.get(path).indexes.push(index);
  });
  const collectionsByIndex = new Map();
  for (const group of collectionGroups.values()) {
    const firstIndex = group.indexes[0];
    collectionsByIndex.set(firstIndex, {
      ...(source[firstIndex] || {}), field: `display.collection.${group.path}`, changeType: "changed",
      oldValue: fullCollectionValue(previousData, group.path, source, group.indexes, "oldValue"),
      newValue: fullCollectionValue(currentData, group.path, source, group.indexes, "newValue"),
    });
    group.indexes.slice(1).forEach((index) => collectionsByIndex.set(index, null));
  }
  const grouped = new Map();
  source.forEach((change, index) => {
    const group = changeFieldGroup(String(change.field || ""));
    if (!group) return;
    if (!grouped.has(group.id)) grouped.set(group.id, { group, firstIndex: index, changes: [] });
    grouped.get(group.id).changes.push(change);
  });
  const groupedChanges = new Map([...grouped.values()].map(({ group, firstIndex, changes: groupChanges }) => {
    const preferred = groupChanges.find((change) => group.raw.test(String(change.field || ""))) || groupChanges[0];
    return [firstIndex, {
      ...preferred,
      field: `display.${group.id}`,
      oldValue: structuredGroupValue(group, groupChanges, "oldValue"),
      newValue: structuredGroupValue(group, groupChanges, "newValue"),
    }];
  }));
  const shown = [];
  const canonicalIndexes = new Map();
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    let change = source[sourceIndex];
    const field = String(change.field || "");
    if (timelineIndexes.includes(sourceIndex)) {
      if (sourceIndex !== timelineIndex) continue;
      change = timelineDisplayChange;
    }
    if (peopleByIndex.has(sourceIndex)) {
      if (!peopleByIndex.get(sourceIndex)) continue;
      change = peopleByIndex.get(sourceIndex);
    }
    if (priorityIndexes.includes(sourceIndex)) {
      if (sourceIndex !== priorityIndex) continue;
      change = priorityDisplayChange;
    }
    if (citedIndexes.includes(sourceIndex)) {
      if (sourceIndex !== citedIndex) continue;
      change = citedDisplayChange;
    }
    if (collectionsByIndex.has(sourceIndex)) {
      if (!collectionsByIndex.get(sourceIndex)) continue;
      change = collectionsByIndex.get(sourceIndex);
    }
    const group = changeFieldGroup(field);
    if (group) {
      if (!groupedChanges.has(sourceIndex)) continue;
      change = groupedChanges.get(sourceIndex);
    }
    const isStatus = /^(?:fields\.Trạng thái|split_fields\.status)$/i.test(field);
    const key = isStatus
      ? `status\u0000${String(change.oldValue ?? "")}\u0000${String(change.newValue ?? "")}\u0000${String(change.changeType || "changed")}`
      : "";
    if (key && canonicalIndexes.has(key)) {
      const existingIndex = canonicalIndexes.get(key);
      if (/^fields\.Trạng thái$/i.test(field)) shown[existingIndex] = change;
      continue;
    }
    if (key) canonicalIndexes.set(key, shown.length);
    shown.push(change);
  }
  return shown.filter(hasVisibleSnapshotChange);
}

function changeTypeLabel(type) {
  if (type === "added") return "Added";
  if (type === "removed") return "Removed";
  return "Changed";
}

let textDiffLoadPromise = null;
function ensureTextDiffLoaded() {
  if (window.TextDiff) return Promise.resolve(window.TextDiff);
  if (textDiffLoadPromise) return textDiffLoadPromise;
  textDiffLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = window.location.protocol === "file:" ? "../../../electron-app/text_diff.js" : "text_diff.js?v=20261001-1";
    script.onload = () => window.TextDiff ? resolve(window.TextDiff) : reject(new Error("Shared text diff did not initialize."));
    script.onerror = () => reject(new Error("Shared text diff could not be loaded."));
    document.head.append(script);
  }).catch((error) => { textDiffLoadPromise = null; throw error; });
  return textDiffLoadPromise;
}

function renderChangeTextDiff(leftTarget, rightTarget) {
  if (!leftTarget || !rightTarget || !window.TextDiff) return false;
  const left = leftTarget.textContent || "";
  const right = rightTarget.textContent || "";
  const diff = window.TextDiff.compare(left, right);
  window.TextDiff.render(leftTarget, left, diff.leftRanges, diff.leftMarkers, "left", { classPrefix: "snapshot-text-diff" });
  window.TextDiff.render(rightTarget, right, diff.rightRanges, diff.rightMarkers, "right", { classPrefix: "snapshot-text-diff" });
  return Boolean(diff.leftRanges.length || diff.rightRanges.length || diff.leftMarkers.length || diff.rightMarkers.length);
}

function normalizedDiffLabel(value) {
  return String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function changeTableModel(table) {
  const headers = [...table.querySelectorAll(":scope > thead > tr > th")].map((cell, index) => ({
    cell, index, label: normalizedDiffLabel(cell.textContent),
  }));
  const rows = [...table.querySelectorAll(":scope > tbody > tr")].map((row, index) => ({
    row, index, cells: [...row.children],
  }));
  return { table, headers, rows, headerByLabel: new Map(headers.map((header) => [header.label, header])) };
}

function changeRowValue(model, row, label) {
  const column = model.headerByLabel.get(label);
  return column && row.cells[column.index] ? normalizedDiffLabel(row.cells[column.index].textContent) : "";
}

function pairChangeTableRows(leftModel, rightModel) {
  const commonLabels = leftModel.headers.map((header) => header.label).filter((label) => rightModel.headerByLabel.has(label));
  const identityPatterns = [/^no\.?$/, /^field$/, /priority number/, /application number/, /^name$/, /^code$/, /^hash$/, /registration number/, /^number$/, /^date$/];
  const identityLabels = identityPatterns.flatMap((pattern) => commonLabels.filter((label) => pattern.test(label)));
  const pairs = [];
  const usedLeft = new Set();
  const usedRight = new Set();
  const matchRows = (keyFor) => {
    leftModel.rows.forEach((leftRow) => {
      if (usedLeft.has(leftRow.index)) return;
      const key = keyFor(leftModel, leftRow);
      if (!key) return;
      const rightRow = rightModel.rows.find((candidate) => !usedRight.has(candidate.index) && keyFor(rightModel, candidate) === key);
      if (!rightRow) return;
      pairs.push([leftRow, rightRow]);
      usedLeft.add(leftRow.index);
      usedRight.add(rightRow.index);
    });
  };
  for (const label of identityLabels) matchRows((model, row) => changeRowValue(model, row, label));
  matchRows((model, row) => {
    const values = commonLabels.map((label) => changeRowValue(model, row, label));
    return values.some(Boolean) ? values.join("\u0001") : "";
  });
  const remainingLeft = leftModel.rows.filter((row) => !usedLeft.has(row.index));
  const remainingRight = rightModel.rows.filter((row) => !usedRight.has(row.index));
  const pairedRemainder = Math.min(remainingLeft.length, remainingRight.length);
  for (let index = 0; index < pairedRemainder; index += 1) pairs.push([remainingLeft[index], remainingRight[index]]);
  return {
    pairs,
    leftOnly: remainingLeft.slice(pairedRemainder),
    rightOnly: remainingRight.slice(pairedRemainder),
    commonLabels,
  };
}

function highlightStructuredChange(left, right) {
  const leftTable = left.querySelector(":scope > .change-structured-table-wrap > .change-structured-table");
  const rightTable = right.querySelector(":scope > .change-structured-table-wrap > .change-structured-table");
  if (!leftTable || !rightTable) {
    const populated = leftTable || rightTable;
    if (populated) populated.querySelectorAll("tbody td").forEach((cell) => cell.classList.add(leftTable ? "change-diff-unmatched-left" : "change-diff-unmatched-right"));
    return Boolean(populated);
  }
  const leftModel = changeTableModel(leftTable);
  const rightModel = changeTableModel(rightTable);
  const { pairs, leftOnly, rightOnly, commonLabels } = pairChangeTableRows(leftModel, rightModel);
  let differs = false;
  pairs.forEach(([leftRow, rightRow]) => {
    commonLabels.forEach((label) => {
      const leftColumn = leftModel.headerByLabel.get(label);
      const rightColumn = rightModel.headerByLabel.get(label);
      differs = renderChangeTextDiff(leftRow.cells[leftColumn.index], rightRow.cells[rightColumn.index]) || differs;
    });
  });
  const leftOnlyLabels = leftModel.headers.filter((header) => !rightModel.headerByLabel.has(header.label));
  const rightOnlyLabels = rightModel.headers.filter((header) => !leftModel.headerByLabel.has(header.label));
  leftOnlyLabels.forEach((header) => {
    header.cell.classList.add("change-diff-unmatched-left");
    leftModel.rows.forEach((row) => row.cells[header.index]?.classList.add("change-diff-unmatched-left"));
    differs = true;
  });
  rightOnlyLabels.forEach((header) => {
    header.cell.classList.add("change-diff-unmatched-right");
    rightModel.rows.forEach((row) => row.cells[header.index]?.classList.add("change-diff-unmatched-right"));
    differs = true;
  });
  leftOnly.forEach((row) => { row.cells.forEach((cell) => cell.classList.add("change-diff-unmatched-left")); differs = true; });
  rightOnly.forEach((row) => { row.cells.forEach((cell) => cell.classList.add("change-diff-unmatched-right")); differs = true; });
  return differs;
}

function applyChangeDiffHighlights() {
  if (!state.changeDiffHighlight) return;
  if (!window.TextDiff) {
    const requestedSnapshot = state.changeHistorySnapshotId;
    ensureTextDiffLoaded().then(() => {
      if (state.changeDiffHighlight && state.changeHistorySnapshotId === requestedSnapshot) applyChangeDiffHighlights();
    }).catch((error) => showToast(error.message));
    return;
  }
  els.changeComparisonBody.querySelectorAll(":scope > tr").forEach((row) => {
    const left = row.querySelector(":scope > .change-value-before");
    const right = row.querySelector(":scope > .change-value-after");
    if (!left || !right) return;
    const leftTable = left.querySelector(".change-structured-table");
    const rightTable = right.querySelector(".change-structured-table");
    let differs = false;
    if (!leftTable && !rightTable) {
      differs = renderChangeTextDiff(left, right);
      row.classList.toggle("change-diff-active", differs);
      if (!differs) {
        row.classList.add("change-diff-no-visible");
        const badge = row.querySelector(".change-kind");
        if (badge) { badge.textContent = "No visible diff"; badge.title = "The stored structure changed, but the displayed values are identical."; }
      }
      return;
    }
    differs = highlightStructuredChange(left, right);
    row.classList.toggle("change-diff-active", differs);
    if (!differs) {
      row.classList.add("change-diff-no-visible");
      const badge = row.querySelector(".change-kind");
      if (badge) { badge.textContent = "No visible diff"; badge.title = "The stored structure changed, but the displayed values are identical."; }
    }
  });
}

function renderChangeComparison(snapshotId) {
  const snapshots = activeChangeSnapshots();
  const snapshotIndex = snapshots.findIndex((item) => String(item.id) === String(snapshotId));
  const index = snapshotIndex >= 0 ? snapshotIndex : 0;
  const snapshot = snapshots[index];
  if (!snapshot) return;
  state.changeHistorySnapshotId = String(snapshot.id);
  const prior = snapshots[index + 1];
  const changes = displayedSnapshotChanges(snapshot.changes, snapshot.data, prior?.data);
  els.changeTimelineList.querySelectorAll("[data-change-snapshot]").forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.changeSnapshot) === String(snapshot.id) ? "true" : "false");
  });
  els.changeComparisonTitle.textContent = index === 0 ? "Changes in latest snapshot" : "Changes in selected snapshot";
  els.changeComparisonMeta.textContent = prior
    ? `${formatDate(snapshot.scrapedAt)} compared with ${formatDate(prior.scrapedAt)}`
    : `${formatDate(snapshot.scrapedAt)} · first stored snapshot`;
  els.changeComparisonCount.textContent = `${changes.length} change${changes.length === 1 ? "" : "s"}`;
  els.changeComparisonCount.classList.toggle("hidden", changes.length === 0);
  els.changeComparisonBody.innerHTML = changes.map((change) => {
    const type = ["added", "removed"].includes(change.changeType) ? change.changeType : "changed";
    return `<tr><td><span class="change-field-name">${escapeHtml(changeFieldLabel(change.field))}</span></td><td class="change-value-before">${changeValueHtml(change.oldValue, change.field)}</td><td class="change-value-after">${changeValueHtml(change.newValue, change.field)}</td><td><span class="change-kind ${type}">${changeTypeLabel(type)}</span></td></tr>`;
  }).join("");
  applyChangeDiffHighlights();
  els.changeComparisonEmpty.classList.toggle("hidden", changes.length > 0);
}

function renderChangeTimeline(snapshotId) {
  const snapshots = activeChangeSnapshots();
  els.changeTimelineList.innerHTML = snapshots.map((snapshot, index) => {
    const count = displayedSnapshotChanges(snapshot.changes, snapshot.data, snapshots[index + 1]?.data).length;
    const selected = String(snapshot.id) === String(snapshotId);
    return `<button class="change-timeline-button" type="button" data-change-snapshot="${escapeHtml(snapshot.id)}" aria-current="${selected ? "true" : "false"}"><span class="change-timeline-date"><strong>${escapeHtml(formatDate(snapshot.scrapedAt))}</strong><small>${index === 0 ? "Latest snapshot" : `Snapshot ${snapshots.length - index} of ${snapshots.length}`}</small></span><span class="change-timeline-badge${count ? "" : " no-change"}">${count}</span></button>`;
  }).join("");
}

function activeChangeSnapshots() {
  return state.changeHistoryMode === "hague" ? state.hagueHistory.get(state.selectedHague)?.snapshots || [] : state.detail?.snapshots || [];
}

function openChangeHistoryModal(mode = "application") {
  state.changeHistoryMode = mode === "hague" ? "hague" : "application";
  const snapshots = activeChangeSnapshots();
  if (!snapshots.length) return;
  changeHistoryReturnFocus = document.activeElement;
  const chosenId = state.changeHistoryMode === "hague" ? state.hagueSelectedSnapshotId : els.snapshot.value;
  const selectedId = snapshots.some((item) => String(item.id) === String(chosenId)) ? chosenId : snapshots[0].id;
  els.changeHistoryTitle.textContent = `${state.changeHistoryMode === "hague" ? state.selectedHague : state.selected} change history`;
  const total = snapshots.reduce((sum, item, index) => sum + displayedSnapshotChanges(item.changes, item.data, snapshots[index + 1]?.data).length, 0);
  els.changeHistoryMeta.textContent = `${snapshots.length} stored snapshot${snapshots.length === 1 ? "" : "s"} · ${total} recorded field change${total === 1 ? "" : "s"}`;
  renderChangeTimeline(selectedId);
  renderChangeComparison(selectedId);
  els.changeHistoryModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.closeChangeHistory.focus();
}

function closeChangeHistoryModal() {
  els.changeHistoryModal.classList.add("hidden");
  state.changeHistoryMode = "application";
  state.changeHistorySnapshotId = "";
  document.body.classList.remove("modal-open");
  changeHistoryReturnFocus?.focus?.();
  changeHistoryReturnFocus = null;
}

const ADDRESS_HASH_PALETTE = [
  "#4e9af1", "#52c41a", "#f97316", "#a855f7", "#ec4899",
  "#06b6d4", "#eab308", "#ef4444", "#14b8a6", "#fb923c",
];

function hashAddress(value) {
  return globalThis.SoftIPDisplayHash?.shortHash(value) || "------";
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
    const addressHashAttribute = options.addressHashColors ? ` data-address-hash="${escapeHtml(hashAddress(row[1]))}"` : "";
    return `<tr${addressHashAttribute}>${cells}${addressHash}${action}</tr>`;
  }).join("");
  const addressHashHeader = options.addressHashColors ? '<th class="address-hash-heading">Hash</th>' : "";
  return `<section class="structured-section${wideClass}${numberedClass}${peopleClass}${citationsClass}${goodsClass}${trademarkDetailsClass}${addressHashesClass}${changedClass}"><div class="structured-heading"><h3>${escapeHtml(title)}</h3>${options.changed ? '<span class="table-change-badge">Changed</span>' : ""}</div><div class="structured-table-wrap"><table class="structured-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}${addressHashHeader}${actionHeader}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function highlightMatchingAddressHash(hash = "") {
  for (const row of els.structured.querySelectorAll("tr[data-address-hash]")) {
    row.classList.toggle("address-hash-match", Boolean(hash) && row.dataset.addressHash === hash);
  }
}

function addressHashBadgeFromEvent(event) {
  const badge = event.target.closest?.(".address-hash-badge");
  return badge && els.structured.contains(badge) ? badge : null;
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
  if (role === "applicant" && window.WipoApplicantHistory?.parseApplicantHistory) {
    return window.WipoApplicantHistory.parseApplicantHistory(raw).entries.map((item, index) => ({
      order: index + 1, raw: item.raw, applicant_name: item.name,
      applicant_address: item.address, applicant_last_recorded_date: item.lastRecordedDate,
      applicant_is_current: item.isCurrent,
    }));
  }
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

function mediaGalleryHtml(name, kind, images) {
  const label = recordKindLabel(kind);
  return `<div class="record-media-gallery">${images.map((image, index) => `<button type="button" data-preview-index="${index}" title="Preview image ${index + 1}"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(`${name} — image ${index + 1}`)}" loading="lazy"><span>${index + 1}</span></button>`).join("")}</div><div class="record-media-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(label)} images · ${images.length}</span></div>`;
}

function setMediaPreview(images, name, kind, applicationNo) {
  state.mediaPreview = { images: images.map((image) => ({ url: image.url })), name, kind, index: 0, applicationNo };
}

function renderImagePreview(index) {
  const preview = state.mediaPreview;
  if (!preview.images.length) return;
  preview.index = (index + preview.images.length) % preview.images.length;
  const image = preview.images[preview.index];
  const position = `${preview.index + 1} of ${preview.images.length}`;
  els.imagePreviewMain.src = image.url;
  els.imagePreviewMain.alt = `${preview.name} — image ${preview.index + 1}`;
  els.imagePreviewTitle.textContent = preview.name || recordKindLabel(preview.kind);
  els.imagePreviewMeta.textContent = `${preview.applicationNo} · ${recordKindLabel(preview.kind)} · Image ${position}`;
  els.imagePreviewApplication.textContent = preview.applicationNo;
  els.imagePreviewType.textContent = recordKindLabel(preview.kind);
  els.imagePreviewCaseRef.textContent = caseRefsForApplication(preview.applicationNo).join(" · ") || "—";
  els.imagePreviewStatus.textContent = els.detailStatus.textContent || "—";
  els.imagePreviewPosition.textContent = `Image ${position}`;
  els.imagePreviewThumbnails.innerHTML = preview.images.map((item, itemIndex) => `<button type="button" data-preview-index="${itemIndex}" class="${itemIndex === preview.index ? "selected" : ""}" aria-label="View image ${itemIndex + 1}" aria-current="${itemIndex === preview.index ? "true" : "false"}"><img src="${escapeHtml(item.url)}" alt=""><span>${itemIndex + 1}</span></button>`).join("");
  const hasSeveral = preview.images.length > 1;
  els.previousImage.classList.toggle("hidden", !hasSeveral);
  els.nextImage.classList.toggle("hidden", !hasSeveral);
}

function openImagePreview(index) {
  if (!state.mediaPreview.images.length) return;
  renderImagePreview(index);
  els.imagePreviewModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.closeImagePreview.focus();
}

function closeImagePreview() {
  els.imagePreviewModal.classList.add("hidden");
  els.imagePreviewMain.removeAttribute("src");
  if (els.publicationModal.classList.contains("hidden") && els.clearAllModal.classList.contains("hidden") && els.typographyModal.classList.contains("hidden") && els.removeListModal.classList.contains("hidden")) document.body.classList.remove("modal-open");
}

function renderRecordMedia(data) {
  const kind = recordKind(state.selected, data);
  const applicationNo = state.selected;
  const raw = String(data.image || "").trim();
  const valid = raw && raw !== "no image" && raw !== "base64_image";
  state.mediaPreview = { images: [], name: "", kind, index: 0, applicationNo };
  els.recordMedia.classList.remove("patent-media", "trademark-media");
  if (!valid || kind === "patent") {
    els.recordMedia.classList.add("hidden");
    els.recordMedia.innerHTML = "";
  } else {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://wipopublish.ipvietnam.gov.vn${raw.startsWith("/") ? "" : "/"}${raw}`;
    const fields = data.fields || {};
    const name = fields["(541) Nhãn hiệu"] || fields["(571) Nhãn hiệu"] || fields["(54) Tên kiểu dáng"] || recordKindLabel(kind);
    const isTrademark = kind === "trademark" || kind === "international_trademark";
    setMediaPreview([{ url }], name, kind, applicationNo);
    els.recordMedia.classList.toggle("trademark-media", isTrademark);
    els.recordMedia.innerHTML = isTrademark
      ? `<div class="record-media-copy"><strong>${escapeHtml(name)}</strong></div><button class="record-media-single" type="button" data-preview-index="0" title="Preview image"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></button>`
      : `<button class="record-media-single" type="button" data-preview-index="0" title="Preview image"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></button><div class="record-media-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(recordKindLabel(kind))} image from the stored WIPO record</span></div>`;
    els.recordMedia.classList.remove("hidden");
  }
  if (!window.wipoTracker.applicationMedia || !/^[1-3]-\d{4}-\d{4,}$/.test(applicationNo)) return;
  const fields = data.fields || {};
  const name = fields["(541) Nhãn hiệu"] || fields["(571) Nhãn hiệu"] || fields["(54) Tên kiểu dáng"] || recordKindLabel(kind);
  window.wipoTracker.applicationMedia(applicationNo).then((result) => {
    if (state.selected !== applicationNo || !Array.isArray(result?.images) || !result.images.length) return;
    setMediaPreview(result.images, name, kind, applicationNo);
    els.recordMedia.classList.remove("trademark-media", "hidden");
    els.recordMedia.classList.toggle("patent-media", kind === "patent");
    els.recordMedia.innerHTML = mediaGalleryHtml(name, kind, result.images);
  }).catch(() => { /* Keep the stored representative image when the gallery service is unavailable. */ });
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
  const applicantRaw = fields["(71/73) Chủ đơn/Chủ bằng"] || fields["(730) Chủ đơn/Chủ bằng"] || "";
  const reparsedApplicants = window.WipoApplicantHistory?.parseApplicantHistory?.(applicantRaw).entries || [];
  const applicantEntries = reparsedApplicants.length ? reparsedApplicants : (data.applicants_ordered || []).map((item) => ({
    name: item.applicant_name || item.name || "", address: item.applicant_address || item.address || "",
    lastRecordedDate: item.applicant_last_recorded_date || "",
    isCurrent: item.applicant_is_current !== false && !item.applicant_last_recorded_date,
  }));
  const applicants = applicantEntries.filter((item) => item.isCurrent).map((item) => [item.name || "—", item.address || "—"]);
  const previousApplicants = applicantEntries.filter((item) => !item.isCurrent)
    .map((item) => [item.name || "—", item.address || "—", item.lastRecordedDate || "—"]);
  const inventors = (data.inventors_ordered || []).map((item) => [item.inventor_name || item.name || "—", item.inventor_address || item.address || "—"]);
  const representatives = (split.representatives_ordered || []).map((item) => [item.representative_name || item.name || "—", item.representative_address || item.address || "—"]);
  const partyAddressHashColors = buildAddressHashMap([...applicants, ...previousApplicants, ...inventors].map((row) => row[1]));
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
      tableSection("Priority", ["Country", "Priority number", "Priority date"], priorities, { changed: isChangedPath(changed, "split_fields.priority_details") }),
      tableSection("Goods and services", ["Nice class", "Goods / services"], trademarkClassRows(fields["(511) Nhóm sản phẩm/dịch vụ"]), { wide: true, goodsServices: true, changed: isChangedPath(changed, "fields.(511) Nhóm sản phẩm/dịch vụ") }),
      tableSection("Vienna classification", ["#", "Classification"], vienna, { numbered: true, changed: isChangedPath(changed, "fields.(531) Phân loại hình") }),
      tableSection("Owners / Applicants", ["Name", "Address"], applicants, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "applicants_ordered") }),
      tableSection("Earlier owners / applicants", ["Name", "Address", "Last recorded"], previousApplicants, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "applicants_ordered") }),
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
      tableSection("Earlier applicants / owners", ["Name", "Address", "Last recorded"], previousApplicants, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "applicants_ordered") }),
      tableSection("Designers", ["Name", "Address"], inventors, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "inventors_ordered") }),
      tableSection("IP Representatives", ["Name", "Address"], representatives, { wide: true, people: true }),
    ].join("");
    return;
  }
  els.structured.innerHTML = [
    tableSection("Numbers and dates", ["Record", "Number", "Date (dd/mm/yyyy)"], numberDateRows, { wide: true, changed: ["grant_number_date", "application_number_date", "publication_number_date", "pct_application_number_date", "pct_publication_number_date", "expiry_date", "national_phase_entry_date"].some((key) => isChangedPath(changed, `split_fields.${key}`)) }),
    tableSection("Priority", ["Country", "Priority number", "Priority date"], priorities, { changed: isChangedPath(changed, "split_fields.priority_details") }),
    tableSection("Classification", ["System", "Classification", "Version"], classifications, { changed: isChangedPath(changed, "split_fields.ipc_classifications") || isChangedPath(changed, "split_fields.cpc_classifications") }),
    tableSection("(58) Các tài liệu đối chứng", ["Tài liệu được đối chứng", "Tài liệu tham khảo", "Danh mục", "Yêu cầu bảo hộ", "Loại tài liệu đối chứng"], citedDocuments, { wide: true, citations: true, changed: isChangedPath(changed, "split_fields.cited_documents") || Boolean(citedRawEntry && isChangedPath(changed, `fields.${citedRawEntry[0]}`)) }),
    tableSection("Applicants / Owners", ["Name", "Address"], applicants, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "applicants_ordered") }),
    tableSection("Earlier applicants / owners", ["Name", "Address", "Last recorded"], previousApplicants, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "applicants_ordered") }),
    tableSection("Inventors", ["Name", "Address"], inventors, { wide: true, people: true, addressHashColors: partyAddressHashColors, changed: isChangedPath(changed, "inventors_ordered") }),
    tableSection("IP Representatives", ["Name", "Address"], representatives, { wide: true, people: true, changed: isChangedPath(changed, "split_fields.representatives_ordered") }),
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
      if (change) row.classList.add("changed-row");
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
    return `<article class="field-card ${isWide ? "wide" : ""} ${isChanged ? "changed" : ""}"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${escapeHtml(text)}</div></article>`;
  }).join("") || `<article class="field-card wide"><div class="field-value">No parsed fields in this snapshot.</div></article>`;
  renderStructuredDetails(data, changed);
  highlightStructuredRows(snapshot.changes || [], data);
  const diary = Array.isArray(data.diary) ? data.diary : [];
  els.timelineSection.classList.toggle("hidden", diary.length === 0);
  const diaryChanges = rowChangesFor(snapshot.changes, "diary");
  els.timelineCount.textContent = `${diary.length} events`;
  els.timeline.innerHTML = diary.map((item, index) => {
    const extras = Array.isArray(item.extra) ? item.extra.filter(Boolean) : (item.status ? [item.status] : []);
    const change = diaryChanges.get(index);
    return `<div class="timeline-item${change ? " changed" : ""}"><div class="timeline-date">${escapeHtml(structuredDate(item.date || item.date_text))}</div><div class="timeline-node"></div><div class="timeline-copy"><strong>${escapeHtml(item.description || item.event || item.title || item.raw || "—")}</strong>${extras.length ? `<div class="timeline-extra">${extras.map(escapeHtml).join(" · ")}</div>` : ""}</div></div>`;
  }).join("") || `<div class="case-sub">No procedural events parsed.</div>`;
  const snapshots = state.detail?.snapshots || [];
  const snapshotIndex = snapshots.findIndex((item) => String(item.id) === String(snapshot.id));
  const displayedChangeCount = displayedSnapshotChanges(snapshot.changes, snapshot.data, snapshots[snapshotIndex + 1]?.data).length;
  els.changeSummary.textContent = displayedChangeCount ? `${displayedChangeCount} change${displayedChangeCount === 1 ? "" : "s"} in this snapshot` : "No changes from the previous snapshot";
  els.changeSummary.title = "Open change history";
  els.changeSummary.disabled = !(state.detail?.snapshots?.length);
  els.changeSummary.setAttribute("aria-label", `${els.changeSummary.textContent}. Open change history.`);
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

function openHaguePrintDetails() {
  const details = [...els.hagueDetailBody.querySelectorAll("details")];
  const closed = details.filter(item => !item.open);
  const closedKeys = new Set(closed.map(item => item.dataset.hagueDisclosureKey).filter(Boolean));
  closed.forEach(item => { item.open = true; });
  return () => {
    closed.forEach(item => { item.open = false; });
    for (const item of els.hagueDetailBody.querySelectorAll("details[data-hague-disclosure-key]")) {
      if (closedKeys.has(item.dataset.hagueDisclosureKey)) item.open = false;
    }
  };
}

function printHagueRecord() {
  const number = state.selectedHague;
  if (!number || !viewedHagueRecord(number)?.ok) return showToast("Select a saved Hague design before printing.", true);
  const previousTitle = document.title;
  const restoreDetails = openHaguePrintDetails();
  const restore = () => {
    document.body.classList.remove("printing-hague-report");
    restoreDetails();
    document.title = previousTitle;
    window.removeEventListener("afterprint", restore);
  };
  document.title = `WIPO_Hague_${number.replace(/[^A-Z0-9-]+/gi, "_")}`;
  document.body.classList.add("printing-hague-report");
  window.addEventListener("afterprint", restore, { once: true });
  const nextFrame = window.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
  nextFrame(() => { window.print(); setTimeout(restore, 1000); });
}

async function downloadHagueRecordPdf() {
  const number = state.selectedHague;
  if (!number || !viewedHagueRecord(number)?.ok) return showToast("Select a saved Hague design before saving its PDF.", true);
  els.hagueDownload.disabled = true;
  const restoreDetails = openHaguePrintDetails();
  document.body.classList.add("printing-hague-report");
  try {
    const html = location.protocol === "file:" ? "" : await printableReportHtml();
    if (state.selectedHague !== number) throw new Error("The selected Hague design changed. Please retry the PDF export.");
    const result = await window.wipoTracker.downloadHaguePdf(number, html);
    if (result?.ok) showToast("Hague record PDF saved.");
    else if (!result?.canceled) throw new Error(result?.error || "Could not save the Hague record PDF.");
  } catch (error) { showToast(error.message || "Could not save the Hague record PDF.", true); }
  finally { document.body.classList.remove("printing-hague-report"); restoreDetails(); els.hagueDownload.disabled = !viewedHagueRecord(state.selectedHague)?.ok; }
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

function renderDetailLoading(appNo, error = "") {
  state.detail = null;
  const kind = recordKind(appNo);
  els.detailEmpty.classList.add("hidden");
  els.detailContent.classList.remove("hidden");
  els.detailNo.textContent = appNo;
  renderDetailCaseRef(appNo);
  els.detailType.textContent = recordKindLabel(kind);
  els.detailType.dataset.kind = kind;
  els.detailStatus.textContent = error ? "Load failed" : "Loading…";
  els.detailStatus.title = error;
  els.detailStatus.classList.remove("maybe-unpublished");
  setPublicationKind(kind);
  els.exportOne.disabled = true;
  els.downloadPdf.disabled = true;
  els.snapshot.innerHTML = `<option>${error ? "Unavailable" : "Loading…"}</option>`;
  els.snapshot.disabled = true;
  els.changeSummary.textContent = "";
  els.changeSummary.disabled = true;
  els.recordMedia.classList.add("hidden");
  els.recordMedia.innerHTML = "";
  els.fields.innerHTML = `<article class="field-card wide"><div class="field-label">Data status</div><div class="field-value">${escapeHtml(error || "Loading stored application data…")}</div></article>`;
  els.structured.innerHTML = "";
  els.timeline.innerHTML = "";
  els.timelineCount.textContent = "";
  els.timelineSection.classList.add("hidden");
  updatePublicationButtons(null, true);
}

function renderLoadedDetail(appNo, detail, quiet = false) {
  state.detail = detail;
  const latestData = normalizeLegacyTrademarkData(state.detail?.latest?.data || {});
  const kind = recordKind(appNo, latestData);
  els.detailEmpty.classList.add("hidden");
  els.detailContent.classList.remove("hidden");
  els.detailNo.textContent = appNo;
  renderDetailCaseRef(appNo);
  els.detailType.textContent = recordKindLabel(kind);
  els.detailType.dataset.kind = kind;
  setPublicationKind(kind);
  els.exportOne.disabled = !state.detail;
  els.downloadPdf.disabled = !state.detail;
  updatePublicationButtons(null, true);
  if (!state.detail) {
    renderDetailStatus();
    els.snapshot.innerHTML = `<option>No snapshots</option>`;
    els.snapshot.disabled = true;
    els.changeSummary.textContent = "";
    els.changeSummary.disabled = true;
    els.fields.innerHTML = `<article class="field-card wide"><div class="field-label">Data status</div><div class="field-value">${state.notFound.has(appNo) ? NOT_FOUND_HINT : (state.maybeUnpublished.has(appNo) ? "The scrape did not return this application, and no Publication A record was found in the local database. It may not yet be published." : "This application is in your list but has not been scraped into the local database.")}</div></article>`;
    // Media is indexed independently from WipoPublish snapshots. Show any
    // locally available patent/design figures even before the first scrape.
    renderRecordMedia({ fields: {} });
    els.structured.innerHTML = ""; els.timeline.innerHTML = ""; els.timelineCount.textContent = ""; els.timelineSection.classList.add("hidden");
    prefetchPublications(appNo).catch(() => updatePublicationButtons());
    return;
  }
  els.detailStatus.textContent = latestData.split_fields?.status || latestData.fields?.["Trạng thái"] || "Stored";
  els.detailStatus.title = "";
  els.detailStatus.classList.remove("maybe-unpublished");
  els.snapshot.disabled = false;
  els.snapshot.innerHTML = state.detail.snapshots.map((snapshot, index) => {
    const count = displayedSnapshotChanges(snapshot.changes, snapshot.data, state.detail.snapshots[index + 1]?.data).length;
    return `<option value="${snapshot.id}">${index === 0 ? "Latest · " : ""}${escapeHtml(formatDate(snapshot.scrapedAt))}${count ? ` · ${count} changes` : ""}</option>`;
  }).join("");
  renderSnapshot(state.detail.latest.id);
  prefetchPublications(appNo).catch(() => updatePublicationButtons());
  if (!quiet) els.detailContent.scrollTop = 0;
}

async function openDetail(appNo, quiet = false) {
  const normalized = normalize(appNo);
  if (!normalized) return;
  const requestToken = ++state.detailRequestToken;
  state.selectedRequest = "";
  state.selectedHague = "";
  els.hagueDetail.classList.add("hidden");
  clearRequestPublicationViewer();
  els.requestDetail.classList.add("hidden");
  state.selected = normalized;
  syncScrapeOneButton();
  renderList();
  if (state.detailCache.has(normalized)) {
    renderLoadedDetail(normalized, state.detailCache.get(normalized), quiet);
    return;
  }
  renderDetailLoading(normalized);
  if (!quiet) els.detailContent.scrollTop = 0;
  try {
    const detail = await loadDetail(normalized);
    if (requestToken !== state.detailRequestToken || state.selected !== normalized) return;
    renderLoadedDetail(normalized, detail, quiet);
  } catch (error) {
    if (requestToken !== state.detailRequestToken || state.selected !== normalized) return;
    renderDetailLoading(normalized, error.message || "Could not load the stored application data.");
  }
}

function updateLocalQueueStatus() {
  const total = state.scrapeActiveCount + state.scrapeQueue.length;
  setRunning(total > 0);
  if (total) setRunStatus(`${state.scrapeActiveCount} scraping · ${state.scrapeQueue.length} queued`, "busy");
  else setRunStatus("Ready", "ready");
  renderList();
}

function requestIndividualScrape(appNo) {
  const normalized = normalize(appNo);
  if (!normalized || state.scrapingIds.has(normalized) || state.scrapeQueuedIds.has(normalized)) return;
  if (scrapeAgeDays(state.records.get(normalized)?.lastScrapedAt) !== 0) return enqueueScrapes([normalized]);
  const clicks = countRescrapeConfirmation(normalized);
  if (clicks === 3) return enqueueScrapes([normalized], { resetConfirmations: new Set([normalized]) });
  updateLocalQueueStatus();
}

function enqueueScrapes(ids, { resetConfirmations = new Set() } = {}) {
  const added = [];
  const addedEntries = [];
  for (const appNo of ids.map(normalize).filter(Boolean)) {
    if (state.scrapingIds.has(appNo) || state.scrapeQueuedIds.has(appNo)) continue;
    state.siteUnavailable.delete(appNo);
    const entry = { appNo, resetConfirmation: resetConfirmations.has(appNo), rank: state.notFound.has(appNo) ? 2 : 1 };
    state.scrapeQueue.push(entry);
    addedEntries.push(entry);
    state.scrapeQueuedIds.add(appNo);
    state.scrapeRequestCounts.set(appNo, pendingScrapeCount(appNo) + 1);
    added.push(appNo);
  }
  if (!added.length) return showToast("Those applications are already scraping or queued.");
  saveQueue();
  const queuedLines = [];
  for (let index = 0; index < added.length; index += 6) queuedLines.push(`  ${added.slice(index, index + 6).join(", ")}`);
  appendLog(`[Tracker] Queued ${added.length} application${added.length === 1 ? "" : "s"}:\n${queuedLines.join("\n")}`);
  updateLocalQueueStatus();
  if (!window.wipoTracker.scrapePriorities) return drainScrapeQueue();
  const generation = scrapePriorityGeneration;
  scrapePriorityLookupPending += 1;
  Promise.resolve().then(() => window.wipoTracker.scrapePriorities(added)).then((result) => {
    if (generation !== scrapePriorityGeneration) return;
    for (const entry of addedEntries) {
      if (!state.scrapeQueue.includes(entry)) continue;
      if (Number(result?.priorities?.[entry.appNo]?.rank) === 0) entry.rank = 0;
    }
    state.scrapeQueue.sort((left, right) => left.rank - right.rank);
    const known = addedEntries.filter((entry) => entry.rank === 0).length;
    const unverified = addedEntries.filter((entry) => entry.rank === 1).length;
    const notFound = addedEntries.filter((entry) => entry.rank === 2).length;
    appendLog(`[Tracker] Index check: ${known} in WIPO history or Publication, ${unverified} unverified, ${notFound} previously not found. Known records run first; all remain queued.`);
  }).catch((error) => {
    if (generation === scrapePriorityGeneration) appendLog(`[Tracker] Index check unavailable; keeping every record queued: ${error.message}`);
  }).finally(() => {
    if (generation !== scrapePriorityGeneration) return;
    scrapePriorityLookupPending = Math.max(0, scrapePriorityLookupPending - 1);
    drainScrapeQueue();
  });
}

function drainScrapeQueue() {
  if (scrapePriorityLookupPending) return updateLocalQueueStatus();
  const limit = Math.max(1, Number(window.wipoTracker.queueConcurrency || 1));
  const available = Math.max(0, limit - state.scrapeActiveCount);
  const dispatchInterval = Math.max(0, Number(window.wipoTracker.queueDispatchInterval || 0));
  const wait = Math.max(0, dispatchInterval - (Date.now() - scrapeLastDispatchAt));
  state.scrapeQueuedIds = new Set([
    ...state.scrapeQueue.map((entry) => entry.appNo),
    ...[...state.remoteScrapeStates.entries()].filter(([, details]) => details?.status === "queued").map(([appNo]) => appNo),
  ]);
  if (!available || !state.scrapeQueue.length) return updateLocalQueueStatus();
  if (wait) {
    if (!scrapeDrainTimer) scrapeDrainTimer = setTimeout(() => { scrapeDrainTimer = null; drainScrapeQueue(); }, wait);
    return updateLocalQueueStatus();
  }
  const index = state.scrapeQueue.findIndex((entry) => !state.scrapingIds.has(entry.appNo));
  if (index < 0) return updateLocalQueueStatus();
  const entry = state.scrapeQueue.splice(index, 1)[0];
  state.scrapeQueuedIds = new Set([
    ...state.scrapeQueue.map((item) => item.appNo),
    ...[...state.remoteScrapeStates.entries()].filter(([, details]) => details?.status === "queued").map(([appNo]) => appNo),
  ]);
  scrapeLastDispatchAt = Date.now();
  runQueuedScrapeBatch([entry]);
  if (available > 1 && state.scrapeQueue.length) {
    const delay = Math.max(1, dispatchInterval);
    scrapeDrainTimer = setTimeout(() => { scrapeDrainTimer = null; drainScrapeQueue(); }, delay);
  }
  updateLocalQueueStatus();
}

async function runQueuedScrapeBatch(entries) {
  const applicationNos = entries.map((entry) => entry.appNo);
  applicationNos.forEach((appNo) => state.scrapingIds.add(appNo));
  state.scrapeActiveCount = state.scrapingIds.size;
  updateLocalQueueStatus();
  appendLog(`\n[Tracker] Starting original fast batch: ${applicationNos.join(", ")}\n`);
  try {
    const scrapeCap = selectedScrapeCap();
    const legacyDesktop = window.wipoTracker.scrapeCapMode === false;
    els.retryCount.value = String(scrapeCap);
    localStorage.setItem(legacyDesktop ? "wipoTrackerRetryCount" : "wipoTrackerScrapeCap", String(scrapeCap));
    applyRemoteScrapeStates(Object.fromEntries(applicationNos.map((appNo) => [appNo, legacyDesktop
      ? { status: "running", attempt: 1, maxAttempts: scrapeCap + 1, initialAttempts: 1, maxRetries: scrapeCap }
      : { status: "running", attempt: 1, maxAttempts: scrapeCap, scrapeCap, burstSize: 5 }])));
    const result = await window.wipoTracker.scrape(applicationNos, Number(els.preset.value || 1), scrapeCap,
      applicationNos.filter((appNo) => state.notFound.has(appNo)));
    await recordRefreshChain;
    await refreshList();
    updateNotFoundStatuses(result.notFound, result.imported);
    const confirmedMissing = new Set((result.notFound || []).map((item) => normalize(item.applicationNo || item)));
    const failedIds = (result.missing?.length ? result.missing : (!result.ok && !result.cancelled ? applicationNos : []))
      .map(normalize).filter((appNo) => appNo && !confirmedMissing.has(appNo));
    const site = failedIds.length ? await checkWipoSiteStatus(true) : null;
    if (site?.state === "down") failedIds.forEach((appNo) => state.siteUnavailable.add(appNo));
    await updateFailedPublicationStatuses(site?.state === "down" ? [] : result.missing, result.imported);
    saveQueue();
    renderList();
    if (state.selected && !state.detail) renderDetailStatus();
    if (result.ok) showToast(`Stored ${result.imported?.length || applicationNos.length} queued application${applicationNos.length === 1 ? "" : "s"}.`);
    else if (!result.cancelled) showToast(result.error || `${result.missing?.length || applicationNos.length} queued application(s) did not return data.`, true);
  } catch (error) {
    const site = await checkWipoSiteStatus(true);
    if (site?.state === "down") {
      applicationNos.forEach((appNo) => state.siteUnavailable.add(appNo));
      saveQueue();
      renderList();
      if (state.selected && !state.detail) renderDetailStatus();
    }
    appendLog(`\n[Tracker] ${error.message}\n`);
    showToast(`${applicationNos.join(", ")}: ${error.message}`, true);
  } finally {
    entries.forEach(({ appNo, resetConfirmation }) => {
      state.remoteScrapeStates.delete(appNo);
      state.scrapingIds.delete(appNo);
      const remaining = Math.max(0, pendingScrapeCount(appNo) - 1);
      if (remaining) state.scrapeRequestCounts.set(appNo, remaining);
      else state.scrapeRequestCounts.delete(appNo);
      if (resetConfirmation) clearRescrapeConfirmation(appNo, false);
    });
    saveRemoteScrapeStates();
    state.scrapeActiveCount = state.scrapingIds.size;
    drainScrapeQueue();
  }
}

async function exportIds(ids) {
  const result = await window.wipoTracker.exportExcel(ids);
  if (result.ok) showToast(`Exported ${result.count} application${result.count === 1 ? "" : "s"} to Excel.`);
  else if (!result.canceled) showToast(result.error || "Export failed.", true);
}

const EXPORT_CONFIG_KEY = "wipoTrackerExportConfig";
const EXCEL_EXPORT_BASE_COLUMNS = [
  ["applicationNo", "Application no."], ["filingDate", "Filing date (dd/mm/yyyy)"],
  ["registrationNo", "Registration no."], ["grantDate", "Grant date (dd/mm/yyyy)"],
  ["image", "Image"], ["currentApplicantName", "Current applicant name"],
  ["currentApplicantAddress", "Current applicant address"],
  ["previousApplicantName", "Previous applicant name"],
  ["previousApplicantAddress", "Previous applicant address"],
  ["previousApplicantLastRecorded", "Previous applicant last recorded (dd/mm/yyyy)"],
];
const EXCEL_EXPORT_FIELD_LABELS = [
  "Loại đơn", "Loại đơn PCT", "Trạng thái", "(180) Ngày hết hạn",
  "(40) Số công bố và ngày công bố", "(86) Số đơn và ngày nộp đơn PCT",
  "(87) Số công bố và ngày công bố đơn PCT", "(85) Ngày vào pha quốc gia",
  "(30) Chi tiết về dữ liệu ưu tiên", "(51) Phân loại IPC", "Phân loại CPC",
  "(72) Tác giả sáng chế", "(74) Đại diện SHCN", "(73) Địa chỉ nhận thư",
  "(54) Tên", "(57) Tóm tắt", "(58) Các tài liệu đối chứng",
  "(51/52) Phân loại Locarno", "(72) Tác giả kiểu dáng", "(54) Tên kiểu dáng",
  "Tóm tắt", "(53) Tổng số kiểu dáng", "(55) Bản chất của kiểu dáng",
  "(56) Yêu cầu bảo hộ kiểu dáng", "(400) Số công bố và ngày công bố",
  "(541) Nhãn hiệu", "(591) Màu sắc nhãn hiệu", "(300) Chi tiết về dữ liệu ưu tiên",
  "(511) Nhóm sản phẩm/dịch vụ", "(531) Phân loại hình", "(740) Đại diện SHCN",
  "(571) Nhãn hiệu", "(566) Nhãn hiệu dịch thuật",
  "(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)", "(526) Yếu tố loại trừ",
  "Tiến trình",
];
const EXCEL_EXPORT_COLUMNS = [...EXCEL_EXPORT_BASE_COLUMNS, ...EXCEL_EXPORT_FIELD_LABELS.map((label) => [`field:${label}`, label])];
const EXCEL_EXPORT_COLUMN_KEYS = new Set(EXCEL_EXPORT_COLUMNS.map(([key]) => key));
const defaultExportConfig = { outputs: { excel: true, applicationPdf: false, publicationA: false, publicationB: false, annuity: false, requestExcel: true, requestPdf: true, hagueExcel: true, hagueRefusals: false }, sorts: { excel: "application", applicationPdf: "application", publicationA: "application", publicationB: "registration", annuity: "registration", hagueExcel: "registration", hagueRefusals: "registration" }, combineHagueRefusals: false, excelColumns: { columns: EXCEL_EXPORT_COLUMNS.map(([key]) => key), currentApplicantsOnly: true } };

function readExportConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPORT_CONFIG_KEY) || "{}");
    const savedColumns = saved.excelColumns?.columns;
    return { outputs: { ...defaultExportConfig.outputs, ...(saved.outputs || {}) }, sorts: { ...defaultExportConfig.sorts, ...(saved.sorts || {}) }, combineHagueRefusals: saved.combineHagueRefusals === true,
      excelColumns: { columns: Array.isArray(savedColumns) ? [...new Set(savedColumns)].filter((key) => EXCEL_EXPORT_COLUMN_KEYS.has(key)) : [...defaultExportConfig.excelColumns.columns],
        currentApplicantsOnly: saved.excelColumns?.currentApplicantsOnly !== false } };
  } catch { return structuredClone(defaultExportConfig); }
}

function syncExportModal(config = readExportConfig()) {
  const choices = document.getElementById("excelColumnChoices");
  if (choices && !choices.children.length) EXCEL_EXPORT_COLUMNS.forEach(([key, label]) => {
    const choice = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.excelColumn = key;
    choice.append(input, document.createTextNode(label));
    choices.append(choice);
  });
  document.querySelectorAll("[data-excel-column]").forEach((input) => {
    input.checked = config.excelColumns.columns.includes(input.dataset.excelColumn);
    input.disabled = config.excelColumns.currentApplicantsOnly && input.dataset.excelColumn.startsWith("previousApplicant");
  });
  document.getElementById("excelCurrentApplicantsOnly").checked = config.excelColumns.currentApplicantsOnly;
  document.querySelectorAll(".application-export-option").forEach((section) => section.classList.toggle("hidden", !state.queue.length));
  document.querySelectorAll(".request-export-option").forEach((section) => section.classList.toggle("hidden", !state.requestQueue.length));
  document.querySelectorAll(".hague-export-option").forEach((section) => section.classList.toggle("hidden", !state.hagueQueue.length));
  document.querySelectorAll("[data-export-toggle]").forEach((button) => {
    const key = button.dataset.exportToggle;
    const selected = key === "publication" ? ["publicationA", "publicationB", "annuity"].some((item) => config.outputs[item]) : Boolean(config.outputs[key]);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  document.querySelectorAll("[data-export-sort]").forEach((select) => { select.value = config.sorts[select.dataset.exportSort] || "application"; });
  document.getElementById("combineHagueRefusals").checked = config.combineHagueRefusals;
  els.runBatchExport.disabled = !Object.entries(config.outputs).some(([key, enabled]) => enabled && (key.startsWith("request") ? state.requestQueue.length : key.startsWith("hague") ? state.hagueQueue.length : state.queue.length))
    || (config.outputs.excel && state.queue.length && !config.excelColumns.columns.some((key) => !config.excelColumns.currentApplicantsOnly || !key.startsWith("previousApplicant")));
  return config;
}

function saveExportConfig(config) {
  localStorage.setItem(EXPORT_CONFIG_KEY, JSON.stringify(config));
  syncExportModal(config);
}

function openExportModal() {
  if (!state.queue.length && !state.requestQueue.length && !state.hagueQueue.length) return showToast("The case list is empty.", true);
  syncExportModal();
  els.exportProgress.textContent = `${state.queue.length} application(s), ${state.requestQueue.length} request(s), ${state.hagueQueue.length} Hague design(s) in this export.`;
  els.exportModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.closeExportModal.focus();
}

function closeExportModal(force = false) {
  if (!force && els.exportProgress.dataset.running === "true") return;
  els.exportModal.classList.add("hidden");
  els.exportProgress.dataset.running = "false";
  document.body.classList.remove("modal-open");
  els.exportList.focus();
}

function sortedExportIds(sortKey) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const value = (id) => {
    if (sortKey === "case_ref") return caseRefsForApplication(id)[0] || "\uffff";
    if (sortKey === "registration") return registrationForApplication(id)?.formatted || "\uffff";
    return id;
  };
  return [...state.queue].sort((a, b) => collator.compare(value(a), value(b)) || collator.compare(a, b));
}

function sortedHagueExportIds(sortKey) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const value = number => {
    const record = state.hagueResults.get(number);
    if (sortKey === "vn_application") return hagueVnApplicationNos(record)[0] || "\uffff";
    if (sortKey === "status") return record?.status || "\uffff";
    if (sortKey === "holder") return record?.holders?.[0]?.name || "\uffff";
    return number;
  };
  return [...state.hagueQueue].sort((a, b) => collator.compare(value(a), value(b)) || collator.compare(a, b));
}

let reportCssPromise;
async function printableReportHtml() {
  if (!reportCssPromise) reportCssPromise = location.protocol === "file:"
    ? Promise.resolve([...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules].map((rule) => rule.cssText); } catch { return []; } }).join("\n"))
    : fetch("styles.css", { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error("Could not load the report styling."); return response.text(); });
  const css = await reportCssPromise;
  const copy = document.documentElement.cloneNode(true);
  copy.querySelectorAll("script, link[rel=stylesheet]").forEach((item) => item.remove());
  copy.querySelectorAll("img[loading=lazy]").forEach((item) => { item.loading = "eager"; });
  const style = document.createElement("style");
  style.textContent = css;
  copy.querySelector("head").appendChild(style);
  return `<!doctype html>${copy.outerHTML}`;
}

async function runBatchExport() {
  const config = readExportConfig();
  const outputs = Object.fromEntries(Object.entries(config.outputs).map(([key, enabled]) => [key, Boolean(enabled && (key.startsWith("request") ? state.requestQueue.length : key.startsWith("hague") ? state.hagueQueue.length : state.queue.length))]));
  if (!Object.values(outputs).some(Boolean)) return;
  els.exportProgress.dataset.running = "true";
  els.runBatchExport.disabled = true;
  els.closeExportModal.disabled = true;
  els.cancelExport.disabled = true;
  const previous = state.selected;
  try {
    const orders = {};
    Object.keys(outputs).forEach((key) => { orders[key] = key.startsWith("hague") ? sortedHagueExportIds(config.sorts[key]) : sortedExportIds(config.sorts[key]); });
    const reports = [];
    if (outputs.applicationPdf) {
      document.body.classList.add("printing-report");
      for (let index = 0; index < orders.applicationPdf.length; index += 1) {
        const applicationNo = orders.applicationPdf[index];
        els.exportProgress.textContent = `Preparing application PDF ${index + 1} of ${orders.applicationPdf.length}…`;
        await openDetail(applicationNo, true);
        if (state.detail) reports.push({ applicationNo, html: await printableReportHtml() });
      }
    }
    els.exportProgress.textContent = "Merging selected outputs…";
    const registrationsByApplication = Object.fromEntries(state.queue.map((id) => [id, registrationForApplication(id)?.formatted || ""]));
    const result = await window.wipoTracker.exportBatch({ applicationNos: state.queue, requestNos: state.requestQueue, hagueNos: state.hagueQueue, outputs, sorts: config.sorts, orders, reports, registrationsByApplication, combineHagueRefusals: config.combineHagueRefusals, excelColumns: config.excelColumns });
    if (result?.ok) { showToast(result.count > 1 ? `Exported ${result.count} files in one ZIP.` : "Export completed."); closeExportModal(true); }
    else if (!result?.canceled) throw new Error(result?.error || "Batch export failed.");
  } catch (error) { els.exportProgress.textContent = error.message || "Batch export failed."; showToast(els.exportProgress.textContent, true); }
  finally {
    document.body.classList.remove("printing-report");
    els.exportProgress.dataset.running = "false";
    els.closeExportModal.disabled = false;
    els.cancelExport.disabled = false;
    els.runBatchExport.disabled = false;
    if (previous && state.selected !== previous) await openDetail(previous, true);
  }
}

document.querySelectorAll(".input-mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => setInputMode(tab.dataset.inputMode, { focusInput: true }));
  tab.addEventListener("keydown", (event) => {
    const current = INPUT_MODES.indexOf(tab.dataset.inputMode);
    const next = event.key === "ArrowRight" ? (current + 1) % INPUT_MODES.length
      : event.key === "ArrowLeft" ? (current + INPUT_MODES.length - 1) % INPUT_MODES.length
      : event.key === "Home" ? 0 : event.key === "End" ? INPUT_MODES.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setInputMode(INPUT_MODES[next]);
    $(`${INPUT_MODES[next]}InputTab`).focus();
  });
});

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
els.addRegistration.addEventListener("click", async () => {
  els.addRegistration.disabled = true;
  try { if (await addRegistrationInputText(els.registrationInput.value)) { els.registrationInput.value = ""; resizeRegistrationInput(); } }
  catch (error) { showToast(error.message, true); }
  finally { els.addRegistration.disabled = state.running; }
});
els.registrationInput.addEventListener("input", () => {
  resizeRegistrationInput();
  const detected = registrationTypeFromInput(els.registrationInput.value);
  if (detected) applyRegistrationType(detected);
});
els.registrationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); els.addRegistration.click(); }
});
els.addRequest.addEventListener("click", () => {
  if (addRequestInputText(els.requestInput.value)) {
    els.requestInput.value = "";
    resizeRequestInput();
  }
});
els.requestInput.addEventListener("input", resizeRequestInput);
els.requestInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); els.addRequest.click(); }
});
els.requestDocumentSelect.addEventListener("change", () => showRequestPublicationDocument(state.selectedRequest, Number(els.requestDocumentSelect.value)));
els.requestPrintPdf.addEventListener("click", printCurrentRequestPublication);
els.requestSavePdf.addEventListener("click", saveCurrentRequestPublicationPdf);
els.requestZoomOut.addEventListener("click", () => changeRequestPublicationZoom(-.25));
els.requestZoomReset.addEventListener("click", () => changeRequestPublicationZoom(0, true));
els.requestZoomIn.addEventListener("click", () => changeRequestPublicationZoom(.25));
els.registrationType.addEventListener("change", () => applyRegistrationType(els.registrationType.value));
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
  const idle = (id) => !state.scrapingIds.has(id) && !state.scrapeQueuedIds.has(id);
  const hagueEligible = state.hagueQueue.some((number) => !state.hagueLoading.has(number) && !state.haguePending.some((job) => job.number === number) && (els.reScrape.checked || !state.hagueResults.has(number)));
  if (hagueEligible) loadAllHagueRows(els.reScrape.checked);
  if (!els.reScrape.checked) {
    const ids = state.queue.filter((id) => !state.records.get(id)?.lastScrapedAt && idle(id));
    if (!ids.length) {
      if (!hagueEligible) showToast("All unscraped applications are already scraping or have stored data. Tick Re-scrape to update older records.", true);
      return;
    }
    return enqueueScrapes(ids);
  }
  const immediate = state.queue.filter((id) => scrapeAgeDays(state.records.get(id)?.lastScrapedAt) !== 0 && idle(id));
  const confirmed = [];
  for (const id of state.queue.filter((appNo) => scrapeAgeDays(state.records.get(appNo)?.lastScrapedAt) === 0 && idle(appNo))) {
    const clicks = countRescrapeConfirmation(id);
    if (clicks === 3) confirmed.push(id);
  }
  const ids = [...immediate, ...confirmed];
  if (ids.length) return enqueueScrapes(ids, { resetConfirmations: new Set(confirmed) });
  if ([...state.rescrapeClickCounts.values()].some((count) => count > 0 && count < 3)) {
    updateLocalQueueStatus();
    return;
  }
  if (!hagueEligible) showToast("No records are currently eligible for bulk scraping.", true);
}
els.scrapeAll.addEventListener("click", scrapeAllQueued);
els.refreshAll.addEventListener("click", scrapeAllQueued);
els.reScrape.addEventListener("change", () => {
  localStorage.setItem("wipoTrackerRescrape", els.reScrape.checked ? "1" : "0");
  if (!els.reScrape.checked) [...state.rescrapeClickCounts.keys()].forEach((appNo) => clearRescrapeConfirmation(appNo, false));
  updateLocalQueueStatus();
});
els.compactList.addEventListener("click", () => applyCompactList(els.compactList.getAttribute("aria-pressed") !== "true"));
els.retryCount.addEventListener("change", () => {
  const scrapeCap = selectedScrapeCap();
  els.retryCount.value = String(scrapeCap);
  localStorage.setItem(window.wipoTracker?.scrapeCapMode === false ? "wipoTrackerRetryCount" : "wipoTrackerScrapeCap", String(scrapeCap));
});
els.preset.addEventListener("change", () => localStorage.setItem("wipoTrackerPresetIndex", els.preset.value));
els.typographyButton.addEventListener("click", openTypographyModal);
els.closeTypography.addEventListener("click", closeTypographyModal);
els.saveTypography.addEventListener("click", () => { applyTypography(typographyFromControls()); closeTypographyModal(); });
els.resetTypography.addEventListener("click", () => {
  applyTypography(TYPOGRAPHY_DEFAULTS);
  applyCompactList(false, true);
  applyCaseColumnBehavior({}, true);
  applyCaseColumnAlignments({}, true);
  applyCaseColumnMinimums({}, true);
  applyCaseSortTypes({}, true);
  renderList();
});
els.typographyModal.addEventListener("click", (event) => { if (event.target === els.typographyModal) closeTypographyModal(); });
[els.interfaceFont, els.headerFont, els.contentFont, els.interfaceFontSize, els.headerFontSize, els.contentFontSize]
  .forEach((control) => control.addEventListener("input", () => applyTypography(typographyFromControls())));
Object.values(CASE_COLUMN_MINIMUM_INPUTS).map((name) => els[name]).filter(Boolean)
  .forEach((control) => control.addEventListener("input", () => applyCaseColumnMinimums(Object.fromEntries(
    Object.entries(CASE_COLUMN_MINIMUM_INPUTS).map(([key, name]) => [key, els[name].value])
  ))));
Object.values(CASE_COLUMN_BEHAVIOR_INPUTS).flatMap((inputs) => [els[inputs.hidden], els[inputs.squishable]])
  .forEach((control) => control.addEventListener("change", () => applyCaseColumnBehavior(Object.fromEntries(
    Object.entries(CASE_COLUMN_BEHAVIOR_INPUTS).map(([key, inputs]) => [key, { hidden: els[inputs.hidden].checked, squishable: els[inputs.squishable].checked }])
  ))));
document.querySelectorAll(".column-alignment-select").forEach((control) => control.addEventListener("change", () => applyCaseColumnAlignments(Object.fromEntries(
  CASE_COLUMN_ALIGNMENT_KEYS.map((key) => [key, {
    header: document.querySelector(`[data-case-alignment-column="${key}"][data-case-alignment-target="header"]`)?.value,
    content: document.querySelector(`[data-case-alignment-column="${key}"][data-case-alignment-target="content"]`)?.value,
  }])
))));
els.stop.addEventListener("click", async () => {
  const activeIds = [...state.scrapingIds];
  const activeRemoteStates = new Map(state.remoteScrapeStates);
  if (scrapeDrainTimer) { clearTimeout(scrapeDrainTimer); scrapeDrainTimer = null; }
  scrapeLastDispatchAt = 0;
  scrapePriorityGeneration += 1;
  scrapePriorityLookupPending = 0;
  state.scrapeQueue = [];
  state.scrapeQueuedIds.clear();
  state.scrapingIds.clear();
  state.remoteScrapeStates.clear();
  saveRemoteScrapeStates();
  state.scrapeActiveCount = 0;
  state.scrapeRequestCounts.clear();
  [...state.rescrapeClickCounts.keys()].forEach((appNo) => clearRescrapeConfirmation(appNo, false));
  els.stop.disabled = true;
  renderList();
  setRunStatus("Stopping scraper…", "busy");
  try {
    const result = await window.wipoTracker.stop();
    if (result?.ok === false) throw new Error(result.error || "Could not stop the scraper.");
    setRunStatus(result?.message || "All of your scrape tasks were stopped.", "ready");
    showToast(result?.message || "All of your scrape tasks were stopped.");
  } catch (error) {
    state.scrapingIds = new Set(activeIds);
    state.remoteScrapeStates = activeRemoteStates;
    saveRemoteScrapeStates();
    state.scrapeActiveCount = state.scrapingIds.size;
    els.stop.disabled = false;
    renderList();
    showToast(error.message || "Could not stop the scraper.", true);
  }
});
els.scrapeOne.addEventListener("click", () => state.selected && requestIndividualScrape(state.selected));
publicationButtons().forEach((button) => button.addEventListener("click", () => openPublicationCategory(button.dataset.publicationCategory)));
els.closePublicationModal.addEventListener("click", closePublicationModal);
els.publicationTabs.querySelectorAll("[data-publication-category]").forEach((button) => button.addEventListener("click", () => selectPublicationCategory(button.dataset.publicationCategory)));
els.publicationDocumentSelect.addEventListener("change", () => {
  const documents = state.publicationDocuments.filter((item) => publicationGroup(item) === state.publicationCategory);
  const document = documents[Number(els.publicationDocumentSelect.value)];
  if (document) loadPublicationInModal(document);
});
els.publicationAll.addEventListener("change", () => selectPublicationCategory(state.publicationCategory));
els.publicationZoomOut.addEventListener("click", () => changePublicationZoom(-.25));
els.publicationZoomReset.addEventListener("click", () => changePublicationZoom(0, true));
els.publicationZoomIn.addEventListener("click", () => changePublicationZoom(.25));
els.printPublication.addEventListener("click", printCurrentPublication);
els.savePublicationPdf.addEventListener("click", saveCurrentPublicationPdf);
els.publicationModal.addEventListener("click", (event) => { if (event.target === els.publicationModal) closePublicationModal(); });
els.structured.addEventListener("mouseover", (event) => {
  const badge = addressHashBadgeFromEvent(event);
  if (!badge || badge.contains(event.relatedTarget)) return;
  const row = badge.closest("tr[data-address-hash]");
  highlightMatchingAddressHash(row.dataset.addressHash);
});
els.structured.addEventListener("mouseout", (event) => {
  const badge = addressHashBadgeFromEvent(event);
  if (!badge || badge.contains(event.relatedTarget)) return;
  const row = badge.closest("tr[data-address-hash]");
  const nextBadge = event.relatedTarget?.closest?.(".address-hash-badge");
  const nextRow = nextBadge?.closest?.("tr[data-address-hash]");
  if (nextRow?.dataset.addressHash === row.dataset.addressHash) return;
  highlightMatchingAddressHash();
});
els.recordMedia.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-preview-index]");
  if (trigger) openImagePreview(Number(trigger.dataset.previewIndex));
});
els.imagePreviewThumbnails.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-preview-index]");
  if (trigger) renderImagePreview(Number(trigger.dataset.previewIndex));
});
els.previousImage.addEventListener("click", () => renderImagePreview(state.mediaPreview.index - 1));
els.nextImage.addEventListener("click", () => renderImagePreview(state.mediaPreview.index + 1));
els.closeImagePreview.addEventListener("click", closeImagePreview);
els.imagePreviewModal.addEventListener("click", (event) => { if (event.target === els.imagePreviewModal) closeImagePreview(); });
els.wipoSiteStatus.addEventListener("click", openSiteHistoryModal);
els.closeSiteHistory.addEventListener("click", closeSiteHistoryModal);
els.siteHistoryModal.addEventListener("click", (event) => { if (event.target === els.siteHistoryModal) closeSiteHistoryModal(); });
els.siteHistoryDays.addEventListener("click", (event) => {
  const bar = event.target.closest("[data-site-day]");
  if (bar && bar.dataset.siteDay !== siteHistoryData?.selectedDay) loadSiteHistory(bar.dataset.siteDay);
});
els.siteHistoryHours.addEventListener("click", (event) => {
  const bar = event.target.closest("[data-site-hour]");
  if (!bar) return;
  siteHistoryHour = Number(bar.dataset.siteHour);
  renderSiteHistoryChecks();
});
document.addEventListener("keydown", (event) => {
  if (!els.imagePreviewModal.classList.contains("hidden") && event.key === "ArrowLeft") renderImagePreview(state.mediaPreview.index - 1);
  else if (!els.imagePreviewModal.classList.contains("hidden") && event.key === "ArrowRight") renderImagePreview(state.mediaPreview.index + 1);
  else if (event.key === "Escape" && !els.imagePreviewModal.classList.contains("hidden")) closeImagePreview();
  else if (event.key === "Escape" && !els.changeHistoryModal.classList.contains("hidden")) closeChangeHistoryModal();
  else if (event.key === "Escape" && !els.siteHistoryModal.classList.contains("hidden")) closeSiteHistoryModal();
  else if (event.key === "Escape" && !els.publicationModal.classList.contains("hidden")) closePublicationModal();
  else if (event.key === "Escape" && !els.exportModal.classList.contains("hidden")) closeExportModal();
  else if (event.key === "Escape" && !els.typographyModal.classList.contains("hidden")) closeTypographyModal();
  else if (event.key === "Escape" && !els.removeListModal.classList.contains("hidden")) closeRemoveListModal();
});
els.exportOne.addEventListener("click", () => state.selected && exportIds([state.selected]));
els.printPdf.addEventListener("click", printSelectedRecord);
els.downloadPdf.addEventListener("click", downloadSelectedPdf);
els.changeSummary.addEventListener("click", openChangeHistoryModal);
els.closeChangeHistory.addEventListener("click", closeChangeHistoryModal);
els.changeHistoryModal.addEventListener("click", (event) => { if (event.target === els.changeHistoryModal) closeChangeHistoryModal(); });
els.changeDiffHighlight.checked = state.changeDiffHighlight;
els.changeDiffHighlight.addEventListener("change", async () => {
  state.changeDiffHighlight = els.changeDiffHighlight.checked;
  localStorage.setItem("wipoTrackerChangeDiffHighlight", String(state.changeDiffHighlight));
  if (state.changeDiffHighlight) {
    try { await ensureTextDiffLoaded(); }
    catch (error) { showToast(error.message); }
  }
  if (state.changeHistorySnapshotId) renderChangeComparison(state.changeHistorySnapshotId);
});
els.changeTimelineList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-change-snapshot]");
  if (button) renderChangeComparison(button.dataset.changeSnapshot);
});
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
  openExportModal();
});
els.closeExportModal.addEventListener("click", closeExportModal);
els.cancelExport.addEventListener("click", closeExportModal);
els.exportModal.addEventListener("click", (event) => { if (event.target === els.exportModal) closeExportModal(); });
els.exportModal.addEventListener("click", (event) => {
  if (event.target.id === "excelSelectAllColumns" || event.target.id === "excelResetColumns") {
    const config = readExportConfig();
    config.excelColumns.columns = EXCEL_EXPORT_COLUMNS.map(([key]) => key);
    if (event.target.id === "excelResetColumns") config.excelColumns.currentApplicantsOnly = true;
    saveExportConfig(config);
    return;
  }
  const button = event.target.closest("[data-export-toggle]");
  if (!button || button.disabled) return;
  const config = readExportConfig();
  const key = button.dataset.exportToggle;
  if (key === "publication") {
    const next = !["publicationA", "publicationB", "annuity"].every((item) => config.outputs[item]);
    ["publicationA", "publicationB", "annuity"].forEach((item) => { config.outputs[item] = next; });
  } else config.outputs[key] = !config.outputs[key];
  saveExportConfig(config);
});
els.exportModal.addEventListener("change", (event) => {
  if (event.target.id === "excelCurrentApplicantsOnly") {
    const config = readExportConfig();
    config.excelColumns.currentApplicantsOnly = event.target.checked;
    saveExportConfig(config);
    return;
  }
  if (event.target.dataset.excelColumn) {
    const config = readExportConfig();
    const selected = new Set(config.excelColumns.columns);
    if (event.target.checked) selected.add(event.target.dataset.excelColumn);
    else selected.delete(event.target.dataset.excelColumn);
    config.excelColumns.columns = EXCEL_EXPORT_COLUMNS.map(([key]) => key).filter((key) => selected.has(key));
    saveExportConfig(config);
    return;
  }
  if (event.target.id === "combineHagueRefusals") {
    const config = readExportConfig();
    config.combineHagueRefusals = event.target.checked;
    saveExportConfig(config);
    return;
  }
  const select = event.target.closest("[data-export-sort]");
  if (!select) return;
  const config = readExportConfig();
  config.sorts[select.dataset.exportSort] = select.value;
  saveExportConfig(config);
});
els.runBatchExport.addEventListener("click", runBatchExport);
els.selectAll.addEventListener("change", () => { state.exportSelection = els.selectAll.checked ? new Set(state.queue) : new Set(); renderList(); });
els.list.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("button, input")) caseListPointerDown = true;
});
const finishCaseListPointer = () => {
  caseListPointerDown = false;
  if (pendingCaseListRender && !hasCaseListTextSelection()) renderList();
};
document.addEventListener("pointerup", finishCaseListPointer);
document.addEventListener("pointercancel", finishCaseListPointer);
document.addEventListener("selectionchange", () => {
  if (hasCaseListTextSelection()) return;
  if (pendingCaseListRender && !caseListPointerDown) renderList();
  else syncAlternatingResults();
});
els.list.addEventListener("click", (event) => {
  const row = event.target.closest(".case-row");
  if (!row) return;
  const scrape = event.target.closest(".scrape-row");
  if (scrape) {
    if (scrape.dataset.hagueScrape) queueHagueRows([scrape.dataset.hagueScrape], true);
    else requestIndividualScrape(scrape.dataset.scrape);
    return;
  }
  const remove = event.target.closest(".remove-row");
  if (remove) { removeApplication(remove.dataset.remove); return; }
  if (event.target.closest(".row-check") || hasCaseListTextSelection()) return;
  if (row.dataset.hague) { notifyEmbeddedRecordOpen('hague', row.dataset.hague); openHagueDetail(row.dataset.hague); }
  else if (row.dataset.request) { notifyEmbeddedRecordOpen('request', row.dataset.request); openRequestDetail(row.dataset.request); }
  else { notifyEmbeddedRecordOpen('application', row.dataset.app); openDetail(row.dataset.app); }
});
els.hagueRefresh.addEventListener("click", () => {
  if (state.selectedHague) queueHagueRows([state.selectedHague], true);
});
els.hagueFetchAll.addEventListener("click", () => loadAllHagueRows());
els.haguePrint.addEventListener("click", printHagueRecord);
els.hagueDownload.addEventListener("click", downloadHagueRecordPdf);
els.hagueSnapshot.addEventListener("change", () => { state.hagueSelectedSnapshotId = els.hagueSnapshot.value; renderHagueDetail(state.selectedHague); });
els.hagueChangeSummary.addEventListener("click", async () => {
  if (!state.selectedHague) return;
  if (!state.hagueHistory.has(state.selectedHague)) await loadHagueHistory(state.selectedHague);
  openChangeHistoryModal("hague");
});
els.hagueDetailBody.addEventListener("click", async event => {
  const toggle = event.target.closest("[data-hague-toggle]");
  if (toggle) {
    const card = toggle.closest(".hague-event");
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(expanded));
    card.querySelector(".hague-event-body").classList.toggle("hidden", !expanded);
    if (!expanded) {
      const previewButton = card.querySelector("[data-hague-preview]");
      const frame = card.querySelector(".hague-pdf-preview");
      if (frame) frame.remove();
      if (previewButton) { previewButton.setAttribute("aria-expanded", "false"); previewButton.textContent = "View PDF"; }
    }
    return;
  }
  const preview = event.target.closest("[data-hague-preview]");
  if (preview) {
    const item = viewedHagueRecord(state.selectedHague)?.events?.find(entry => entry.id === preview.dataset.haguePreview);
    if (!item?.url) return;
    const holder = els.hagueDetailBody.querySelector(`[data-hague-frame="${item.id}"]`);
    if (!holder) return;
    const card = holder.closest(".hague-event");
    const existing = holder.querySelector(".hague-pdf-preview");
    if (existing) {
      existing.remove();
      preview.setAttribute("aria-expanded", "false");
      preview.textContent = "View PDF";
      return;
    }
    card.querySelector(".hague-event-body").classList.remove("hidden");
    card.querySelector(".hague-event-toggle").setAttribute("aria-expanded", "true");
    els.hagueDetailBody.querySelectorAll(".hague-pdf-preview").forEach(frame => frame.remove());
    els.hagueDetailBody.querySelectorAll("[data-hague-preview]").forEach(button => { button.setAttribute("aria-expanded", "false"); button.textContent = "View PDF"; });
    const frame = document.createElement("iframe");
    frame.className = "hague-pdf-preview"; frame.title = `${state.selectedHague} ${item.kind} PDF`; frame.src = item.url;
    holder.appendChild(frame);
    preview.setAttribute("aria-expanded", "true");
    preview.textContent = "Hide PDF";
    holder.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    return;
  }
  const save = event.target.closest("[data-hague-save]");
  if (save) {
    const result = await window.wipoTracker.saveHaguePdf(state.selectedHague, save.dataset.hagueSave);
    if (result?.ok) showToast("Hague PDF saved.");
    else if (!result?.canceled) showToast(result?.error || "Could not save the Hague PDF.", true);
  }
});
els.list.addEventListener("change", (event) => {
  if (!event.target.matches(".row-check")) return;
  const appNo = event.target.closest(".case-row").dataset.app;
  if (event.target.checked) state.exportSelection.add(appNo); else state.exportSelection.delete(appNo);
  renderList();
});
els.snapshot.addEventListener("change", () => renderSnapshot(els.snapshot.value));
els.structured.addEventListener("click", (event) => {
  const button = event.target.closest(".copy-class-button");
  if (button) copyText(button.dataset.copyText || "");
});
els.toggleLog.addEventListener("click", () => {
  els.logDrawer.classList.toggle("hidden");
  if (!els.logDrawer.classList.contains("hidden")) els.logDrawer.scrollTop = els.logDrawer.scrollHeight;
});
window.wipoTracker.onProgress((payload) => {
  if (payload.applicationStates) applyRemoteScrapeStates(payload.applicationStates);
  if (payload.type === "record" && payload.applicationNo) refreshCompletedRecord(payload.applicationNo, payload.imported);
  if (payload.type === "done" && payload.applicationStates) refreshList().catch(() => {});
  if (payload.message) {
    if (payload.log !== false) appendLog(payload.message, payload.stream === true, payload.streamId);
    setRunStatus(payload.message.replace(/\s+/g, " ").trim().slice(0, 120), payload.type === "done" && payload.level !== "error" ? "ready" : "busy");
  }
});

let connectionCheckPending = false;
let siteCheckPending = null;
let siteHistoryData = null;
let siteHistoryHour = 0;
let siteHistoryRequest = 0;
const HANOI_TIME_OFFSET_MS = 7 * 60 * 60 * 1000;
const WIPO_SITE_URL = "https://wipopublish.ipvietnam.gov.vn/";

function hanoiStamp(iso) {
  return new Date(Date.parse(iso) + HANOI_TIME_OFFSET_MS);
}

function hanoiDayKey(iso) {
  return hanoiStamp(iso).toISOString().slice(0, 10);
}

function hanoiHour(iso) {
  return hanoiStamp(iso).getUTCHours();
}

function hanoiClock(iso) {
  return hanoiStamp(iso).toISOString().slice(11, 19);
}

function formatHanoiTimestamp(iso) {
  const stamp = hanoiStamp(iso);
  return `${String(stamp.getUTCDate()).padStart(2, "0")}/${String(stamp.getUTCMonth() + 1).padStart(2, "0")}/${stamp.getUTCFullYear()} ${hanoiClock(iso)} GMT+7`;
}

async function checkWipoFromBrowser() {
  if (typeof window.fetch !== "function") return null;
  const controller = typeof window.AbortController === "function" ? new window.AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), 8000) : null;
  try {
    // An opaque no-cors response cannot prove the search UI loaded. Keep it
    // unverified; only the host's HTML check may label the site online.
    const response = await window.fetch(WIPO_SITE_URL, { mode: "no-cors", cache: "no-store", redirect: "follow", credentials: "omit", ...(controller ? { signal: controller.signal } : {}) });
    return { state: response.status >= 500 ? "down" : "unknown", checkedAt: new Date().toISOString(), source: "browser", error: response.type === "opaque" ? "Browser cannot inspect the WIPO page contents; use the host check." : `HTTP ${response.status}` };
  } catch (error) {
    return { state: "down", checkedAt: new Date().toISOString(), source: "browser", error: error?.message || "Connection closed or timed out." };
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}

function setWipoSiteIndicator(stateName, title) {
  const state = ["up", "down"].includes(stateName) ? stateName : "unknown";
  els.wipoSiteStatus.className = `site-pill ${state}`;
  els.wipoSiteStatus.textContent = state === "up" ? "WIPO online" : (state === "down" ? (/under maintenance/i.test(title) ? "WIPO maintenance" : "WIPO site down") : "WIPO status unknown");
  els.wipoSiteStatus.title = `${title} · Click for 30-day availability history.`;
  els.wipoSiteStatus.closest(".topbar")?.classList.toggle("wipo-site-down", state === "down");
  els.wipoSiteStatus.closest(".topbar")?.classList.toggle("wipo-site-up", state === "up");
}

async function checkWipoSiteStatus(refresh = false) {
  if (typeof window.wipoTracker?.siteStatus !== "function") {
    const browserResult = await checkWipoFromBrowser();
    if (browserResult) {
      setWipoSiteIndicator(browserResult.state, `Checked from this browser ${formatHanoiTimestamp(browserResult.checkedAt)}${browserResult.error ? ` · ${browserResult.error}` : ""}`);
    }
    return browserResult;
  }
  if (siteCheckPending) return siteCheckPending;
  siteCheckPending = (async () => {
    try {
      const result = await window.wipoTracker.siteStatus(refresh);
      // An older LAN host may report only Node's generic TLS "fetch failed".
      // Confirm that specific indeterminate result through Chromium before
      // painting the whole header as an outage.
      if (result?.state === "down" && result?.httpStatus == null && /^(fetch failed|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/i.test(result?.error || "")) {
        const browserResult = await checkWipoFromBrowser();
        setWipoSiteIndicator("unknown", `Host check was inconclusive: ${result.error}${browserResult?.error ? ` · Browser: ${browserResult.error}` : ""}`);
        return { ...result, state: "unknown" };
      }
      const stateName = ["up", "down"].includes(result?.state) ? result.state : "unknown";
      setWipoSiteIndicator(stateName, result?.checkedAt
        ? `Checked ${formatHanoiTimestamp(result.checkedAt)}${result.error ? ` · ${result.error}` : ""}`
        : "The WIPOPublish website has not been checked yet.");
      return result;
    } catch (error) {
      const browserResult = await checkWipoFromBrowser();
      if (browserResult) {
        setWipoSiteIndicator(browserResult.state, `Checked from this browser ${formatHanoiTimestamp(browserResult.checkedAt)}${browserResult.error ? ` · ${browserResult.error}` : ""}`);
        return browserResult;
      }
      setWipoSiteIndicator("unknown", `Could not check WIPOPublish: ${error.message}`);
      return null;
    }
  })().finally(() => { siteCheckPending = null; });
  return siteCheckPending;
}

const SITE_HISTORY_HIGH_FAILURE_PERCENT = 25;

function siteHistoryColor(up, down, unknown = 0) {
  if (!up && !down) return unknown ? "unknown" : "none";
  if (!up) return "down";
  if (down / (up + down) * 100 >= SITE_HISTORY_HIGH_FAILURE_PERCENT) return "down";
  if (!down && !unknown) return "up";
  return "mixed";
}

function hanoiDayLabel(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function makeSiteHistoryBar(label, up, down, unknown, selected) {
  const bar = document.createElement("button");
  bar.type = "button";
  bar.className = `site-history-bar ${siteHistoryColor(up, down, unknown)}`;
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-pressed", String(selected));
  bar.title = label;
  return bar;
}

function renderSiteHistoryChecks() {
  const hour = String(siteHistoryHour).padStart(2, "0");
  els.siteHistoryChecksTitle.textContent = `Checks and successful scrapes · ${hour}:00–${hour}:59 GMT+7`;
  const checks = [
    ...(siteHistoryData?.checks || []).filter((item) => hanoiHour(item.checkedAt) === siteHistoryHour),
    ...(siteHistoryData?.scrapes || []).filter((item) => hanoiHour(item.scrapedAt) === siteHistoryHour)
      .map((item) => ({ checkedAt: item.scrapedAt, state: "scraped", httpStatus: item.source === "snapshot" ? "—" : 200,
        error: item.source === "snapshot" ? `${item.identifier} · stored snapshot` : item.identifier })),
  ].sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
  els.siteHistoryChecks.replaceChildren();
  els.siteHistoryEmpty.classList.toggle("hidden", checks.length > 0);
  for (const item of checks) {
    const row = document.createElement("tr");
    for (const [value, className] of [[hanoiClock(item.checkedAt), ""], [item.state === "scraped" ? "Scraped" : (item.state === "up" ? "Online" : (item.state === "down" ? "Down" : "Unverified")), item.state], [item.httpStatus ?? "—", ""], [item.error || "—", ""]]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      if (className) cell.className = className;
      row.append(cell);
    }
    els.siteHistoryChecks.append(row);
  }
  els.siteHistoryHours.querySelectorAll("[data-site-hour]").forEach((bar) => bar.setAttribute("aria-pressed", String(Number(bar.dataset.siteHour) === siteHistoryHour)));
}

function renderSiteHistory() {
  if (!siteHistoryData) return;
  const { days, totals, selectedDay, checks } = siteHistoryData;
  const hanoiBuckets = siteHistoryData.timeZone === "Asia/Ho_Chi_Minh";
  els.siteHistoryTimeBasis.textContent = hanoiBuckets
    ? "Last 30 Hanoi days (GMT+7) · about one sample per minute, plus status changes"
    : "Last 30 days · host still groups daily bars by UTC until restarted";
  els.siteHistoryNote.textContent = hanoiBuckets
    ? `Bars summarize recorded checks in Hanoi time; red means at least ${SITE_HISTORY_HIGH_FAILURE_PERCENT}% of verified checks failed. Gaps mean the monitor was not running, not that the site was available.`
    : "Individual check times are Hanoi time (GMT+7). Daily bars still use UTC boundaries until the LAN host is restarted.";
  els.siteHistoryPercent.textContent = totals.percent === null ? (totals.unknown ? "No verified checks" : "No checks yet") : `${totals.percent}% verified checks successful`;
  els.siteHistoryPercent.className = siteHistoryColor(totals.up, totals.down, totals.unknown || 0);
  els.siteHistoryTotals.textContent = `${totals.up.toLocaleString()} passed · ${totals.down.toLocaleString()} failed · ${(totals.unknown || 0).toLocaleString()} unverified · ${totals.total.toLocaleString()} checks · ${(totals.scraped || 0).toLocaleString()} records scraped`;
  els.siteHistoryDays.replaceChildren();
  for (const day of days) {
    const label = `${hanoiDayLabel(day.date)}: ${day.total ? `${day.percent === null ? "no verified result" : `${day.percent}% verified checks passed`}, ${day.up} online, ${day.down} down, ${day.unknown || 0} unverified` : "no checks"}; ${day.scraped || 0} records scraped`;
    const bar = makeSiteHistoryBar(label, day.up, day.down, day.unknown || 0, day.date === selectedDay);
    bar.dataset.siteDay = day.date;
    els.siteHistoryDays.append(bar);
  }
  const selected = days.find((day) => day.date === selectedDay);
  els.siteHistoryDayTitle.textContent = `${hanoiDayLabel(selectedDay)}${hanoiBuckets ? "" : " · UTC day bucket"}`;
  els.siteHistoryDayStats.textContent = selected?.total ? `${selected.percent === null ? "No verified result" : `${selected.percent}% verified checks passed`} · ${selected.total.toLocaleString()} checks${selected.unknown ? ` · ${selected.unknown} unverified` : ""} · ${(selected.scraped || 0).toLocaleString()} scraped` : `No checks recorded · ${(selected?.scraped || 0).toLocaleString()} scraped`;
  els.siteHistoryHours.replaceChildren();
  for (let hour = 0; hour < 24; hour += 1) {
    const hourChecks = checks.filter((item) => hanoiHour(item.checkedAt) === hour);
    const up = hourChecks.filter((item) => item.state === "up").length;
    const down = hourChecks.filter((item) => item.state === "down").length;
    const unknown = hourChecks.length - up - down;
    const scraped = (siteHistoryData.scrapes || []).filter((item) => hanoiHour(item.scrapedAt) === hour).length;
    const label = `${String(hour).padStart(2, "0")}:00 GMT+7: ${up} online, ${down} down, ${unknown} unverified checks; ${scraped} records scraped`;
    const bar = makeSiteHistoryBar(label, up, down, unknown, hour === siteHistoryHour);
    bar.dataset.siteHour = String(hour);
    els.siteHistoryHours.append(bar);
  }
  renderSiteHistoryChecks();
}

async function loadSiteHistory(day) {
  const request = ++siteHistoryRequest;
  if (typeof window.wipoTracker?.siteStatusHistory !== "function") {
    els.siteHistoryPercent.textContent = "History unavailable";
    els.siteHistoryTotals.textContent = "Restart the LAN host to enable 30-day history.";
    return;
  }
  try {
    const result = await window.wipoTracker.siteStatusHistory(day);
    if (request !== siteHistoryRequest || els.siteHistoryModal.classList.contains("hidden")) return;
    // While an older LAN host is still running, reclassify its generic TLS
    // failures in the selected day. The updated host performs this itself.
    const legacy = (result.checks || []).filter((item) => item.state === "down" && item.httpStatus == null && item.error === "fetch failed");
    if (legacy.length) {
      result.checks = result.checks.map((item) => legacy.includes(item) ? { ...item, state: "unknown" } : item);
      const selected = result.days.find((item) => item.date === result.selectedDay);
      for (const target of [selected, result.totals]) {
        if (!target) continue;
        target.down = Math.max(0, target.down - legacy.length);
        target.unknown = (target.unknown || 0) + legacy.length;
        target.percent = target.up + target.down ? Math.round(target.up / (target.up + target.down) * 10000) / 100 : null;
      }
    }
    siteHistoryData = result;
    const latest = result.checks.at(-1);
    siteHistoryHour = latest ? hanoiHour(latest.checkedAt) : (result.selectedDay === hanoiDayKey(new Date().toISOString()) ? hanoiHour(new Date().toISOString()) : 0);
    renderSiteHistory();
  } catch (error) {
    if (request !== siteHistoryRequest) return;
    els.siteHistoryPercent.textContent = "History unavailable";
    els.siteHistoryTotals.textContent = /\b404\b/.test(error?.message || "")
      ? "Restart the LAN host to enable 30-day history."
      : (error?.message || "Could not load recorded checks.");
  }
}

function openSiteHistoryModal() {
  els.siteHistoryModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.siteHistoryPercent.textContent = "Loading history…";
  els.siteHistoryTotals.textContent = "";
  els.siteHistoryDays.replaceChildren();
  els.siteHistoryHours.replaceChildren();
  els.siteHistoryChecks.replaceChildren();
  els.closeSiteHistory.focus();
  loadSiteHistory();
}

function closeSiteHistoryModal() {
  siteHistoryRequest += 1;
  els.siteHistoryModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  els.wipoSiteStatus.focus();
}

function setConnectionStatus(text, kind = "") {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = `connection-pill${kind ? ` ${kind}` : ""}`;
}

async function checkConnection() {
  if (connectionCheckPending || typeof window.wipoTracker?.checkConnection !== "function") return;
  connectionCheckPending = true;
  try {
    const result = await window.wipoTracker.checkConnection();
    if (result?.ok === false) throw new Error(result.error || "Connection check failed");
    setConnectionStatus("Connected", "connected");
    retryUnavailableRequestRows().catch(() => {});
  } catch (_error) {
    setConnectionStatus("Disconnected", "error");
  } finally {
    connectionCheckPending = false;
  }
}

function startConnectionMonitor() {
  checkWipoSiteStatus();
  window.setInterval(() => checkWipoSiteStatus(), 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkWipoSiteStatus(); });
  if (typeof window.wipoTracker?.checkConnection !== "function") return;
  checkConnection();
  window.setInterval(checkConnection, 10000);
  window.addEventListener("online", checkConnection);
  window.addEventListener("offline", () => setConnectionStatus("Disconnected", "error"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkConnection(); });
}

async function initialize() {
  startConnectionMonitor();
  try {
    if (window.ResizeObserver) {
      const panelHeader = els.casePanel.querySelector(".panel-header");
      const detailHeading = document.querySelector(".detail-heading");
      let observedHeaderHeights = "";
      const headers = new ResizeObserver(() => {
        const heights = `${Math.ceil(panelHeader.getBoundingClientRect().height)}:${Math.ceil(detailHeading.getBoundingClientRect().height)}`;
        if (heights === observedHeaderHeights) return;
        observedHeaderHeights = heights;
        schedulePanelHeaderSync();
      });
      headers.observe(panelHeader);
      headers.observe(detailHeading);
    }
    if (window.MutationObserver) {
      const headerContent = new MutationObserver(schedulePanelHeaderSync);
      headerContent.observe(document.querySelector(".detail-heading"), { childList: true, characterData: true, subtree: true });
    }
    window.addEventListener("resize", () => { syncListHeaderGutter(); resizeApplicationInput(); resizeRegistrationInput(); resizeRequestInput(); schedulePanelHeaderSync(); });
    if (window.ResizeObserver) {
      let inputWidth = 0;
      new ResizeObserver(() => {
        const width = els.input.getBoundingClientRect().width;
        if (width !== inputWidth) { inputWidth = width; resizeApplicationInput(); }
      }).observe(els.input);
      new ResizeObserver(resizeRegistrationInput).observe(els.registrationInput);
      new ResizeObserver(resizeRequestInput).observe(els.requestInput);
    }
    resizeApplicationInput();
    resizeRegistrationInput();
    resizeRequestInput();
    applyRegistrationType(localStorage.getItem("wipoTrackerRegistrationType") || "patent");
    setInputMode(localStorage.getItem("wipoTrackerInputMode"), { persist: false });
    schedulePanelHeaderSync();
    applyCompactList(localStorage.getItem("wipoTrackerCompactList") === "1", false);
    initializeCaseColumnResizers();
    initializeCaseSorting();
    initializeWorkspaceResizer();
    const fontOptions = Object.keys(FONT_FAMILIES).map((key) => `<option value="${key}">${FONT_LABELS[key]}</option>`).join("");
    els.interfaceFont.innerHTML = fontOptions;
    els.headerFont.innerHTML = fontOptions;
    els.contentFont.innerHTML = fontOptions;
    applyTypography(loadTypography(), false);
    els.reScrape.checked = localStorage.getItem("wipoTrackerRescrape") === "1";
    const legacyDesktop = window.wipoTracker?.scrapeCapMode === false;
    const settingKey = legacyDesktop ? "wipoTrackerRetryCount" : "wipoTrackerScrapeCap";
    const savedScrapeCap = Number.parseInt(localStorage.getItem(settingKey) ?? (legacyDesktop ? "10" : "25"), 10);
    els.retryCount.value = String(Number.isNaN(savedScrapeCap) ? (legacyDesktop ? 10 : 25)
      : (legacyDesktop ? Math.min(50, Math.max(0, savedScrapeCap)) : Math.min(100, Math.max(1, savedScrapeCap))));
    els.retryCount.min = legacyDesktop ? "0" : "1";
    els.retryCount.max = legacyDesktop ? "50" : "100";
    els.retryCount.closest("label").querySelector("span").textContent = legacyDesktop ? "Legacy retries per record" : "Scrape cap per record";
    document.querySelector("#scrapeSettingsTitle + p").textContent = legacyDesktop
      ? "These choices apply to this desktop runner's next scrape run."
      : "Up to five consecutive requests per record, then it returns to the queue until the cap is reached.";
    localStorage.setItem(settingKey, els.retryCount.value);
    const info = await window.wipoTracker.init();
    setConnectionStatus("Connected", "connected");
    els.preset.innerHTML = (info.presets || []).map((preset) => `<option value="${preset.index}">${preset.index}. ${escapeHtml(preset.name)}</option>`).join("");
    const savedPreset = localStorage.getItem("wipoTrackerPresetIndex");
    if (savedPreset && [...els.preset.options].some(option => option.value === savedPreset)) els.preset.value = savedPreset;
    loadNamedLists();
    await refreshList();
    if (document.documentElement.classList.contains('embed-detail')) {
      const params = new URLSearchParams(location.search);
      if (params.has('record')) openEmbeddedDetailRecord(params.get('kind') || 'application', params.get('record'));
    }
    if (document.documentElement.classList.contains('embed-detail') && window.parent !== window)
      window.parent.postMessage({ type: 'softip-wipo-detail-ready' }, '*');
    applyRemoteScrapeStates(persistedRemoteScrapeStates());
    if (typeof window.wipoTracker.resumeScrapes === "function") {
      const activeJobs = await window.wipoTracker.resumeScrapes();
      const liveStates = Object.assign({}, ...activeJobs.map((job) => job.applicationStates || {}));
      replaceRemoteScrapeStates(liveStates);
    }
  } catch (error) {
    setConnectionStatus("Disconnected", "error");
    showToast(error.message || "Could not initialize the tracker.", true);
  }
}

initialize();
