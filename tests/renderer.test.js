const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const appNo = "1-2022-01543";

test("one tabbed Add composer preserves each mode's draft and keyboard navigation", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    siteStatus: async () => ({ state: "up", checkedAt: new Date().toISOString() }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  const doc = dom.window.document;
  const application = doc.getElementById("applicationInput");
  const registration = doc.getElementById("registrationInput");
  const request = doc.getElementById("requestInput");
  assert.equal(doc.querySelectorAll(".input-mode-panel:not(.hidden)").length, 1);
  assert.equal(doc.getElementById("registrationInputPanel").classList.contains("hidden"), true);
  application.value = appNo;
  doc.getElementById("registrationInputTab").click();
  assert.equal(doc.getElementById("registrationInputPanel").classList.contains("hidden"), false);
  assert.equal(doc.getElementById("applicationInputPanel").classList.contains("hidden"), true);
  assert.equal(doc.getElementById("registrationInputTab").getAttribute("aria-selected"), "true");
  registration.value = "4-0123456-000";
  doc.getElementById("registrationInputTab").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(doc.getElementById("requestInputPanel").classList.contains("hidden"), false);
  request.value = "DT1-2025-06965";
  doc.getElementById("applicationInputTab").click();
  assert.equal(application.value, appNo);
  doc.getElementById("registrationInputTab").click();
  assert.equal(registration.value, "4-0123456-000");
  doc.getElementById("requestInputTab").click();
  assert.equal(request.value, "DT1-2025-06965");
  assert.equal(dom.window.localStorage.getItem("wipoTrackerInputMode"), "request");
  dom.window.close();
});

test("an older LAN host falls back to browser reachability and shows a closed WIPO connection as down", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  let checkedUrl = "";
  dom.window.fetch = async (url, options) => {
    checkedUrl = url;
    assert.equal(options.mode, "no-cors");
    throw new Error("ERR_CONNECTION_CLOSED");
  };
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    siteStatus: async () => { const error = new Error("HTTP 404"); error.status = 404; throw error; },
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(checkedUrl, "https://wipopublish.ipvietnam.gov.vn/");
  assert.equal(dom.window.document.getElementById("wipoSiteStatus").textContent, "WIPO site down");
  assert.equal(dom.window.document.querySelector(".topbar").classList.contains("wipo-site-down"), true);
  assert.match(dom.window.document.getElementById("wipoSiteStatus").title, /ERR_CONNECTION_CLOSED/);
  dom.window.close();
});

test("an older host's generic TLS failure is browser-verified and shown as unverified history, not downtime", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.fetch = async () => ({ type: "opaque", status: 0 });
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    siteStatus: async () => ({ state: "down", checkedAt: "2026-10-05T05:07:06.000Z", httpStatus: null, error: "fetch failed" }),
    siteStatusHistory: async () => ({
      selectedDay: "2026-10-05",
      days: [{ date: "2026-10-05", up: 0, down: 1, total: 1, percent: 0 }],
      checks: [{ checkedAt: "2026-10-05T05:07:06.000Z", state: "down", httpStatus: null, error: "fetch failed" }],
      totals: { up: 0, down: 1, total: 1, percent: 0 },
    }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  const document = dom.window.document;
  assert.equal(document.getElementById("wipoSiteStatus").textContent, "WIPO status unknown");
  assert.equal(document.querySelector(".topbar").classList.contains("wipo-site-down"), false);
  document.getElementById("wipoSiteStatus").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.getElementById("siteHistoryPercent").textContent, "No verified checks");
  assert.match(document.getElementById("siteHistoryTotals").textContent, /0 failed · 1 unverified/);
  assert.equal(document.querySelector("#siteHistoryDays .site-history-bar").classList.contains("unknown"), true);
  assert.match(document.getElementById("siteHistoryChecks").textContent, /Unverified/);
  assert.match(document.getElementById("siteHistoryChecks").textContent, /12:07:06/);
  assert.match(document.getElementById("siteHistoryTimeBasis").textContent, /UTC until restarted/);
  dom.window.close();
});

test("clicking the site pill opens daily and hourly uptime history with individual check stamps", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    siteStatus: async () => ({ state: "up", checkedAt: "2026-10-05T12:00:00.000Z" }),
    siteStatusHistory: async (day) => ({
      timeZone: "Asia/Ho_Chi_Minh",
      days: [{ date: "2026-10-04", up: 1, down: 1, total: 2, percent: 50 }, { date: "2026-10-05", up: 1, down: 0, total: 1, percent: 100 }],
      selectedDay: day || "2026-10-05",
      checks: day === "2026-10-04"
        ? [{ checkedAt: "2026-10-04T10:00:00.000Z", state: "up", httpStatus: 200, error: "" }, { checkedAt: "2026-10-04T11:00:00.000Z", state: "down", httpStatus: 503, error: "WIPO returned HTTP 503." }]
        : [{ checkedAt: "2026-10-05T12:00:00.000Z", state: "up", httpStatus: 200, error: "" }],
      totals: { up: 2, down: 1, total: 3, percent: 66.67 },
    }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  assert.equal(dom.window.eval("siteHistoryColor(466, 205, 15)"), "down"); // 69.45% verified success
  assert.equal(dom.window.eval("siteHistoryColor(14441, 1731, 130)"), "mixed"); // 89.3% verified success
  assert.equal(dom.window.eval("siteHistoryColor(3, 1)"), "down"); // 25% failure boundary
  assert.equal(dom.window.eval("siteHistoryColor(4, 1)"), "mixed");
  await new Promise((resolve) => setTimeout(resolve, 40));
  const document = dom.window.document;
  document.getElementById("wipoSiteStatus").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.getElementById("siteHistoryModal").classList.contains("hidden"), false);
  assert.match(document.getElementById("siteHistoryPercent").textContent, /66\.67%/);
  assert.equal(document.getElementById("siteHistoryPercent").classList.contains("down"), true);
  assert.equal(document.querySelectorAll("#siteHistoryDays .site-history-bar").length, 2);
  document.querySelector('[data-site-day="2026-10-04"]').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.querySelector('[data-site-day="2026-10-04"]').classList.contains("down"), true);
  assert.equal(document.querySelectorAll("#siteHistoryHours .site-history-bar").length, 24);
  assert.match(document.getElementById("siteHistoryChecks").textContent, /503/);
  assert.match(document.getElementById("siteHistoryTimeBasis").textContent, /Hanoi days \(GMT\+7\)/);
  document.querySelector('[data-site-hour="17"]').click();
  assert.match(document.getElementById("siteHistoryChecks").textContent, /17:00:00.*Online.*200/);
  assert.match(document.getElementById("siteHistoryChecksTitle").textContent, /17:00–17:59 GMT\+7/);
  document.getElementById("closeSiteHistoryButton").click();
  assert.equal(document.getElementById("siteHistoryModal").classList.contains("hidden"), true);
  dom.window.close();
});

test('availability bars and hourly detail show successful scrape counts and identifiers', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8').replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [{ index: 1, name: 'Fast' }] }),
    siteStatus: async () => ({ state: 'up', checkedAt: '2026-11-02T09:00:00Z' }),
    siteStatusHistory: async () => ({ timeZone: 'Asia/Ho_Chi_Minh', selectedDay: '2026-11-02',
      days: [{ date: '2026-11-02', up: 1, down: 0, unknown: 0, scraped: 2, total: 1, percent: 100 }],
      checks: [{ checkedAt: '2026-11-02T09:00:00Z', state: 'up', httpStatus: 200, error: '' }],
      scrapes: [{ scrapedAt: '2026-11-02T09:01:01Z', identifier: '4-2025-12345', source: 'live' },
        { scrapedAt: '2026-11-02T09:02:01Z', identifier: '1-2026-00001', source: 'snapshot' }],
      totals: { up: 1, down: 0, unknown: 0, scraped: 2, total: 1, percent: 100 } }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 35));
  const document = dom.window.document;
  document.getElementById('wipoSiteStatus').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(document.getElementById('siteHistoryTotals').textContent, /2 records scraped/);
  assert.match(document.querySelector('[data-site-day="2026-11-02"]').title, /2 records scraped/);
  assert.match(document.querySelector('[data-site-hour="16"]').title, /2 records scraped/);
  assert.match(document.getElementById('siteHistoryChecks').textContent, /4-2025-12345/);
  assert.match(document.getElementById('siteHistoryChecks').textContent, /1-2026-00001/);
  assert.match(document.getElementById('siteHistoryChecks').textContent, /stored snapshot/);
  assert.match(document.getElementById('siteHistoryChecks').textContent, /Scraped.*200.*4-2025-12345/);
  assert.equal(document.querySelectorAll('#siteHistoryChecks tr').length, 3);
  dom.window.close();
});

test("WIPO outage is shown in the header and failed row without marking the application not found", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  let publicationChecks = 0;
  let stored = false;
  let siteState = "down";
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    siteStatus: async () => ({ state: siteState, checkedAt: new Date().toISOString(), error: siteState === "down" ? "HTTP 503" : null }),
    list: async () => ({ applications: stored ? [{ applicationNo: appNo, lastScrapedAt: new Date().toISOString() }] : [] }), detail: async () => ({ detail: null }),
    checkPublicationA: async () => { publicationChecks += 1; return { ok: true, hasPublicationA: false }; },
    scrape: async () => stored
      ? ({ ok: true, imported: [{ applicationNo: appNo }], missing: [], notFound: [] })
      : ({ ok: false, imported: [], missing: [appNo], notFound: [], error: "Service unavailable" }),
    onProgress: () => {}, chooseList: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  const document = dom.window.document;
  assert.equal(document.getElementById("wipoSiteStatus").textContent, "WIPO site down");
  assert.equal(document.querySelector(".topbar").classList.contains("wipo-site-down"), true);
  document.querySelector(".scrape-row").click();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(document.querySelector(".case-status-cell").textContent, "WIPO site down");
  assert.equal(document.querySelector(".case-status-cell .age").classList.contains("site-down"), true);
  assert.equal(publicationChecks, 0);
  const saved = JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists"));
  assert.deepEqual(saved.lists[0].siteUnavailable, [appNo]);
  assert.deepEqual(saved.lists[0].notFound, []);
  stored = true;
  document.querySelector(".scrape-row").click();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(document.querySelector(".case-status-cell .site-down"), null);
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists")).lists[0].siteUnavailable, []);
  siteState = "up";
  await dom.window.eval("checkWipoSiteStatus(true)");
  assert.equal(document.getElementById("wipoSiteStatus").textContent, "WIPO online");
  assert.equal(document.querySelector(".topbar").classList.contains("wipo-site-down"), false);
  assert.equal(document.querySelector(".topbar").classList.contains("wipo-site-up"), true);
  dom.window.close();
});

test("case-list text selection survives background updates and does not open the record", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo, lastScrapedAt: "2026-10-01T08:00:00+07:00" }] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, chooseList: async () => ({}),
    scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  const document = dom.window.document;
  const row = document.querySelector(".case-row");
  const appCell = row.querySelector(".case-no");
  const range = document.createRange();
  range.selectNodeContents(appCell);
  const selection = dom.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  dom.window.eval("renderList()");
  assert.equal(document.querySelector(".case-row"), row);
  assert.equal(row.querySelector(".case-no"), appCell);
  assert.equal(selection.toString(), appNo);
  appCell.click();
  assert.equal(row.classList.contains("active"), false);

  selection.removeAllRanges();
  document.dispatchEvent(new dom.window.Event("selectionchange"));
  dom.window.eval("renderList()");
  assert.equal(document.querySelector(".case-row"), row);
  assert.equal(row.querySelector(".case-no"), appCell);
  appCell.click();
  assert.equal(row.classList.contains("active"), true);
  dom.window.close();
});

test("case-list headers provide persistent cumulative three-state sorting without mutating source order", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const sourceOrder = ["1-2023-00010", "1-2022-00002", "1-2024-00001"];
  const scraped = {
    "1-2023-00010": "2026-09-30T08:30:00+07:00",
    "1-2022-00002": "2026-09-28T11:15:00+07:00",
    "1-2024-00001": "2026-09-29T09:45:00+07:00",
  };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify(sourceOrder));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: sourceOrder.map((applicationNo) => ({ applicationNo, lastScrapedAt: scraped[applicationNo] })) }),
    detail: async () => ({ detail: null }), onProgress: () => {}, chooseList: async () => ({}),
    scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  const document = dom.window.document;
  const settingsRows = [...document.querySelectorAll("#columnSortTypeGrid .column-setting-row")];
  assert.ok(settingsRows.length > 0);
  assert.ok(settingsRows.every((row) => row.querySelectorAll("[data-case-sort-type]").length === 1));
  assert.equal(document.querySelector(".column-sort-settings"), null);
  const rowOrder = () => [...document.querySelectorAll(".case-row")].map((row) => row.dataset.app);
  const appSort = document.querySelector('[data-case-sort="app"]');
  const dateSort = document.querySelector('[data-case-sort="date"]');

  assert.deepEqual(rowOrder(), sourceOrder);
  assert.equal(document.querySelector('[data-case-sort-type="date"]').value, "number");
  assert.equal(document.querySelector('[data-case-sort-type="clock"]').value, "number");

  appSort.click();
  assert.deepEqual(rowOrder(), ["1-2022-00002", "1-2023-00010", "1-2024-00001"]);
  assert.equal(appSort.querySelector(".case-sort-direction").textContent, "▲");
  assert.equal(appSort.querySelector(".case-sort-priority").textContent, "1");
  appSort.click();
  assert.deepEqual(rowOrder(), ["1-2024-00001", "1-2023-00010", "1-2022-00002"]);
  assert.equal(appSort.querySelector(".case-sort-direction").textContent, "▼");
  appSort.click();
  assert.deepEqual(rowOrder(), sourceOrder);
  assert.equal(appSort.querySelector(".case-sort-direction").textContent, "");

  dateSort.click();
  appSort.click();
  assert.equal(appSort.querySelector(".case-sort-priority").textContent, "1");
  assert.equal(dateSort.querySelector(".case-sort-priority").textContent, "2");
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseSortActions")), [
    { key: "date", direction: "asc" }, { key: "app", direction: "asc" },
  ]);

  document.getElementById("resetSortButton").click();
  assert.deepEqual(rowOrder(), sourceOrder);
  assert.equal(document.getElementById("resetSortButton").disabled, true);
  const savedList = JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists"));
  assert.deepEqual(savedList.lists[0].queue, sourceOrder);

  const appType = document.querySelector('[data-case-sort-type="app"]');
  appType.value = "number";
  appType.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseSortTypes")).app, "number");
  dom.window.close();
});

test("IP/PR input resolves through shared status and keeps its label in the named list", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const applicationNo = "1-2022-03660";
  let lookedUp;
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    resolveCaseRefs: async (refs) => { lookedUp = refs; return { ok: true, matches: [{ caseRef: "IP/PR17258/CDD", applicationNos: [applicationNo] }], missing: [] }; },
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  const renderer = fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8");
  dom.window.eval(renderer);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById("applicationInput").value = "IP/PR17258/CDD";
  document.getElementById("addButton").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(Array.from(lookedUp), ["IP/PR17258/CDD"]);
  assert.equal(document.querySelector(".case-no").textContent, applicationNo);
  assert.equal(document.querySelector(".case-row .case-ref-cell").textContent.trim(), "IP/PR17258/CDD");
  assert.doesNotMatch(document.querySelector(".case-row").textContent, /\bPatent\b|\bTrademark\b/);
  const saved = JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists"));
  assert.deepEqual(saved.lists[0].refsByApplication[applicationNo], ["IP/PR17258/CDD"]);
  document.querySelector(".case-row").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(document.getElementById("detailCaseRef").textContent, "IP/PR17258/CDD");
  assert.equal(document.getElementById("detailRecordType").nextElementSibling.id, "detailCaseRef");
  dom.window.close();
});

test("IP/TR and IP/DR inputs stay attached to trademark and design rows", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    resolveCaseRefs: async () => ({ ok: true, matches: [
      { caseRef: "IP/TR25170", applicationNos: ["4-2026-09638"] },
      { caseRef: "IP/DR2626", applicationNos: ["3-2025-03528"] },
    ], missing: [] }),
    applicationMedia: async () => ({ ok: true, images: [{ url: "/design-1.png" }, { url: "/design-2.png" }] }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById("applicationInput").value = "IP/TR25170\nIP/DR2626";
  document.getElementById("addButton").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const rows = [...document.querySelectorAll(".case-row")];
  assert.deepEqual(rows.map((row) => [
    row.querySelector(".case-no").textContent.trim(),
    row.querySelector(".case-ref-cell").textContent.trim(),
  ]), [
    ["4-2026-09638", "IP/TR25170"],
    ["3-2025-03528", "IP/DR2626"],
  ]);
  rows[1].click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.getElementById("detailRecordType").textContent, "Industrial design");
  assert.equal(document.getElementById("detailCaseRef").textContent, "IP/DR2626");
  assert.equal(document.querySelectorAll("#recordMedia [data-preview-index]").length, 2);
  document.querySelector("#recordMedia [data-preview-index='0']").click();
  assert.equal(document.getElementById("imagePreviewModal").classList.contains("hidden"), false);
  assert.equal(document.getElementById("imagePreviewType").textContent, "Industrial design");
  document.getElementById("nextImageButton").click();
  assert.equal(document.getElementById("imagePreviewPosition").textContent, "Image 2 of 2");
  assert.equal(document.querySelector("#imagePreviewThumbnails button.selected").dataset.previewIndex, "1");
  dom.window.close();
});

test("patent figures render as one horizontally scrolling thumbnail row", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const applicationNo = "1-2023-01677";
  const snapshot = { id: 1, scrapedAt: new Date().toISOString(), changes: [], data: { type: "PATENTS", fields: { "Trạng thái": "SC Đã công bố B" }, split_fields: { status: "SC Đã công bố B" } } };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([applicationNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo, lastScrapedAt: snapshot.scrapedAt }] }),
    detail: async () => ({ detail: { latest: snapshot, snapshots: [snapshot] } }),
    applicationMedia: async () => ({ ok: true, images: Array.from({ length: 10 }, (_, index) => ({ url: `/patent-${index + 1}.png` })) }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    openPublicationPdf: async () => ({ ok: true, documents: [] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.querySelector(".case-row").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(document.getElementById("recordMedia").classList.contains("patent-media"), true);
  assert.equal(document.querySelectorAll(".record-media-gallery [data-preview-index]").length, 10);
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.record-media\.patent-media \.record-media-gallery \{[^}]*grid-auto-flow: column;[^}]*overflow-x: auto;[^}]*overflow-y: hidden;/);
  dom.window.close();
});

test("Madrid records retain a Volume B lookup button and explain an absent indexed publication", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const applicationNo = "5-1024572";
  const snapshot = { id: 1, scrapedAt: new Date().toISOString(), changes: [], data: {
    type: "TRADEMARKS", fields: { "Loại đơn": "Đăng ký quốc tế Madrid" },
    split_fields: { grant_number_date: { number: "1024572" } },
  } };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([applicationNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo, lastScrapedAt: snapshot.scrapedAt }] }),
    detail: async () => ({ detail: { latest: snapshot, snapshots: [snapshot] } }),
    onProgress: () => {}, scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    openPublicationPdf: async () => ({ ok: true, documents: [] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise(resolve => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.querySelector(".case-row").click();
  await new Promise(resolve => setTimeout(resolve, 30));
  const button = document.getElementById("publicationBButton");
  assert.equal(button.disabled, false);
  assert.match(button.textContent, /Madrid B/);
  assert.equal(document.getElementById("publicationAButton").disabled, false);
  assert.match(document.getElementById("publicationAButton").textContent, /Madrid A/);
  assert.match(document.getElementById("publicationAButton").title, /Volume A/);
  assert.match(button.title, /Volume B/);
  button.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(document.getElementById("publicationLoading").textContent, /No IP Vietnam Volume B Madrid publication.*1024572/);
  assert.match(document.getElementById("publicationModalMeta").textContent, /No indexed Madrid Volume B PDF · Registration 1024572/);
  assert.doesNotMatch(document.getElementById("publicationModalMeta").textContent, /The WIPO Gazette/);
  dom.window.close();
});

test("Madrid empty publication explains absent Vietnam designation from the saved record", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const applicationNo = "5-1024572";
  const snapshot = { id: 1, scrapedAt: new Date().toISOString(), changes: [], data: {
    type: "TRADEMARKS", madrid: { international_registration_number: "1024572", designated_countries: ["SG"] },
  } };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([applicationNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo, lastScrapedAt: snapshot.scrapedAt }] }),
    detail: async () => ({ detail: { latest: snapshot, snapshots: [snapshot] } }),
    onProgress: () => {}, scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    openPublicationPdf: async () => ({ ok: true, documents: [] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise(resolve => setTimeout(resolve, 30));
  dom.window.document.querySelector(".case-row").click();
  await new Promise(resolve => setTimeout(resolve, 30));
  dom.window.document.getElementById("publicationBButton").click();
  await new Promise(resolve => setTimeout(resolve, 30));
  const message = dom.window.document.getElementById("publicationLoading").textContent;
  assert.match(message, /lists SG as designated country; VN is not listed/);
  assert.match(message, /WIPO Gazette entry is a different publication source/);
  dom.window.close();
});

test("Madrid publication buttons aggregate protection and renewal by international number", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.publicationViewer = { setContainer() {}, render: async () => {}, clear() {} };
  const applicationNo = "5-1024516";
  const snapshot = { id: 1, scrapedAt: new Date().toISOString(), changes: [], data: {
    type: "TRADEMARKS", fields: { "Loại đơn": "Đăng ký quốc tế Madrid" },
    split_fields: { grant_number_date: { number: "1024516" } },
  } };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([applicationNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo, lastScrapedAt: snapshot.scrapedAt }] }),
    detail: async () => ({ detail: { latest: snapshot, snapshots: [snapshot] } }),
    onProgress: () => {}, scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    openPublicationPdf: async () => ({ ok: true, documents: [
      { id: "b", category: "publication_b", modeId: "madrid_registration", registrationNo: "1024516", url: "/b.pdf" },
      { id: "r", category: "renewal", modeId: "madrid_renewal", registrationNo: "1024516", url: "/r.pdf" },
    ] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise(resolve => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.querySelector(".case-row").click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(document.querySelector("#publicationBButton .publication-label-full").textContent, "Madrid B");
  assert.equal(document.querySelector("#publicationBButton .publication-count").textContent, "1");
  assert.equal(document.querySelector("#annuityButton .publication-label-full").textContent, "Renewal");
  assert.equal(document.querySelector("#annuityButton .publication-count").textContent, "1");
  dom.window.close();
});

test("case-list status metadata matches the exact displayed Case Ref", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const applicationNo = "1-2022-00459";
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([applicationNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo, lastScrapedAt: new Date().toISOString() }] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, chooseList: async () => ({}),
    scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    lookupApplicationRefs: async () => ({ ok: true, matches: [{
      applicationNo, caseRefs: ["IP/PR16896/CDD"], caseMatches: [
        { caseRef: "IP/PR16896", attorney: "Wrong attorney", client: "Wrong client", applicant: "Wrong applicant" },
        { caseRef: "IP/PR16896/CDD", attorney: "Nguyễn Văn A", client: "Client Co.", applicant: "Applicant Co." },
      ]
    }] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(dom.window.document.querySelector(".case-ref-cell").textContent.trim(), "IP/PR16896/CDD");
  assert.equal(dom.window.document.querySelector(".case-attorney-cell").textContent.trim(), "Nguyễn Văn A");
  assert.equal(dom.window.document.querySelector(".case-client-cell").textContent.trim(), "Client Co.");
  assert.equal(dom.window.document.querySelector(".case-applicant-cell").textContent.trim(), "Applicant Co.");
  assert.equal(dom.window.document.querySelector(".case-source-cell"), null);
  assert.doesNotMatch(dom.window.document.querySelector(".list-head").textContent, /Export-PR source/);
  dom.window.close();
});

test("stored WIPOPublish single fields are optional configurable case-list columns", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const applicationNo = "1-2022-01543";
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([applicationNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{
      applicationNo, lastScrapedAt: "2026-09-30T10:20:00+07:00", applicationType: "non-PCT SC",
      status: "SC Đã Công bố B và cập nhật Bản mô tả lúc cấp VBBH",
      grantNumberDate: "1-0050358-000 · 17/07/2025", expiryDate: "20/08/2040",
      ipRepresentatives: "INVESTIP : Hà Nội",
    }] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, chooseList: async () => ({}),
    scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  const document = dom.window.document;
  const panel = document.querySelector(".case-panel");
  assert.equal(panel.classList.contains("hide-col-applicationtype"), true);
  assert.equal(panel.classList.contains("hide-col-wipostatus"), true);
  assert.equal(document.querySelector(".case-applicationtype-cell").textContent.trim(), "non-PCT SC");
  assert.match(document.querySelector(".case-wipostatus-cell").textContent, /SC Đã Công bố B/);
  assert.equal(document.querySelector(".case-grant-cell").textContent.trim(), "1-0050358-000 · 17/07/2025");
  assert.equal(document.querySelector(".case-expiry-cell").textContent.trim(), "20/08/2040");
  assert.equal(document.querySelector(".case-representative-cell").textContent.trim(), "INVESTIP : Hà Nội");
  assert.equal(document.querySelector('[data-case-sort-type="expiry"]').value, "number");
  const showApplicationType = document.getElementById("applicationtypeColumnHidden");
  showApplicationType.checked = false;
  showApplicationType.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(panel.classList.contains("hide-col-applicationtype"), true);
  assert.equal(JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseColumnBehavior")).applicationtype.hidden, false);
  document.getElementById("compactListButton").click();
  assert.equal(panel.classList.contains("hide-col-applicationtype"), false);
  dom.window.close();
});

test("record clicks switch immediately, reuse prefetched details, and ignore late earlier responses", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const ids = ["4-2025-10001", "4-2025-10002"];
  const pending = new Map();
  const calls = [];
  const makeDetail = (applicationNo, status) => {
    const snapshot = { id: applicationNo, scrapedAt: new Date().toISOString(), changes: [], data: { type: "TRADEMARKS", fields: { "Trạng thái": status, "(541) Nhãn hiệu": applicationNo }, split_fields: { status } } };
    return { latest: snapshot, snapshots: [snapshot] };
  };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify(ids));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: ids.map((applicationNo) => ({ applicationNo, lastScrapedAt: "2026-09-29T01:00:00.000Z" })) }),
    detail: (applicationNo) => { calls.push(applicationNo); return new Promise((resolve) => pending.set(applicationNo, resolve)); },
    onProgress: () => {}, scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(calls.sort(), [...ids].sort());
  const rows = [...dom.window.document.querySelectorAll(".case-row")];
  rows[0].click();
  rows[1].click();
  assert.equal(dom.window.document.getElementById("detailApplicationNo").textContent, ids[1]);
  assert.equal(dom.window.document.getElementById("detailStatus").textContent, "Loading…");
  pending.get(ids[1])({ detail: makeDetail(ids[1], "Second record") });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(dom.window.document.getElementById("detailApplicationNo").textContent, ids[1]);
  assert.equal(dom.window.document.getElementById("detailStatus").textContent, "Second record");
  pending.get(ids[0])({ detail: makeDetail(ids[0], "First record") });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(dom.window.document.getElementById("detailApplicationNo").textContent, ids[1]);
  assert.equal(dom.window.document.getElementById("detailStatus").textContent, "Second record");
  assert.equal(calls.length, 2);
  dom.window.close();
});

test("registration input resolves through Publication Registration and displays a saturated Reg No.", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const lookupCalls = [];
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    lookupRegistrations: async (numbers, type, applications) => {
      lookupCalls.push({ numbers, type, applications });
      return applications.length
        ? ({ ok: true, matches: [], missing: [] })
        : ({ ok: true, matches: [{ formatted: "1-0023245-000", prefix: "1", number: "0023245", type, applicationNo: "1-2012-03292" }], missing: [] });
    },
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById("registrationInput").value = "1-2023-02108\n23245";
  document.getElementById("addRegistrationButton").click();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(Array.from(lookupCalls.find((call) => call.numbers.length)?.numbers || []), ["23245"]);
  assert.equal(document.querySelector(".case-no").textContent, "1-2012-03292");
  assert.equal(document.querySelector(".case-registration").textContent, "1-0023245-000");
  assert.equal(document.querySelector(".registration-number-padding").textContent, "00");
  assert.equal(document.querySelector(".registration-number-core").textContent, "23245");
  assert.equal(document.querySelector(".case-registration").dataset.registrationType, "patent");
  const saved = JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists"));
  assert.equal(saved.lists[0].registrationsByApplication["1-2012-03292"].formatted, "1-0023245-000");
  document.getElementById("registrationInput").value = "4-0012345-000";
  document.getElementById("registrationInput").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(document.getElementById("registrationTypeSelect").value, "trademark");
  assert.equal(document.querySelector(".registration-shell").dataset.registrationType, "trademark");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /data-registration-type="patent"[^}]*\.registration-type-select \{[^}]*border-color: #df7518;[^}]*background: #fff/);
  assert.match(css, /data-registration-type="design"[^}]*\.registration-type-select \{[^}]*border-color: #2374c6;[^}]*background: #fff/);
  assert.match(css, /data-registration-type="trademark"[^}]*\.registration-type-select \{[^}]*border-color: #188653;[^}]*background: #fff/);
  assert.match(css, /\.registration-type-select option \{[^}]*background: #fff/);
  assert.match(css, /\.case-registration \{[^}]*font: 500 calc\(14px \* var\(--interface-scale\)\)[^}]*var\(--ui-font\)/);
  assert.match(css, /\.case-ref-cell \{[^}]*font: 700 calc\(13px \* var\(--interface-scale\)\)[^}]*var\(--ui-font\)/);
  assert.match(css, /\.case-panel\.compact-list \.case-ref-cell \{[^}]*font-size: calc\(12px \* var\(--interface-scale\)\)/);
  assert.match(css, /\.case-registration \.registration-number-core \{[^}]*color: var\(--ink\);[^}]*font-weight: 500/);
  assert.match(css, /\.registration-number-text \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.doesNotMatch(css, /\.case-registration\[data-registration-type=/);
  dom.window.close();
});

test("trademark and design registrations open indexed A, B, and Renewal publications", async () => {
  for (const [kind, registrationNo, applicationNo, renewalNo, aMode, bMode, renewalMode] of [
    ["trademark", "4-00094008-000", "4-2020-00001", "GH4-2025-09186", "10", "12", "6"],
    ["design", "3-00036139-000", "3-2020-00002", "GH3-2026-01947", "2", "11", "13"],
  ]) {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.publicationViewer = { setContainer() {}, render: async () => {} };
  const documents = [
    { id: "a", category: "publication_a", modeId: aMode, url: "/a.pdf" },
    { id: "b", category: "publication_b", modeId: bMode, url: "/b.pdf" },
    { id: "r", category: "publication_b", modeId: renewalMode, requestNo: renewalNo, url: "/r.pdf" },
  ];
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    lookupRegistrations: async () => ({ ok: true, matches: [{ formatted: registrationNo, type: kind, applicationNo }], renewalMatches: [{ formatted: registrationNo, requestNo: renewalNo }], missing: [] }),
    openPublicationPdf: async () => ({ ok: true, documents }),
    requestPublications: async () => ({ ok: true, documents: [documents[2]], caseRefs: [] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise(resolve => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById("registrationTypeSelect").value = kind;
  document.getElementById("registrationInput").value = registrationNo;
  document.getElementById("addRegistrationButton").click();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(document.getElementById("publicationModal").classList.contains("hidden"), false);
  assert.deepEqual([...document.querySelectorAll("#publicationTabs button")].map(button => [button.textContent.trim(), button.disabled]), [
    ["Publication A 1", false], ["Publication B 1", false], ["Renewal 1", false],
  ]);
  assert.equal(document.querySelector(".case-no").textContent, applicationNo);
  assert.equal(document.querySelectorAll(".request-row").length, 1);
  document.querySelector('#publicationTabs [data-publication-category="publication_a"]').click();
  assert.match(document.getElementById("publicationModalMeta").textContent, /Publication PDF/);
  dom.window.close();
  }
});

test("an older trademark registration opens Renewal without adding a fictitious GH4 request row", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.publicationViewer = { setContainer() {}, render: async () => {} };
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    lookupRegistrations: async () => ({ ok: true, matches: [], renewalMatches: [{ formatted: "4-00205569-000", requestNo: "", documentId: 1, decisionNo: "100278/QĐ-SHTT" }], missing: [] }),
    openPublicationPdf: async () => ({ ok: true, documents: [{ id: "1", category: "publication_b", modeId: "6", publicationNo: "100278/QĐ-SHTT", url: "/notice.pdf" }] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise(resolve => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById("registrationTypeSelect").value = "trademark";
  document.getElementById("registrationInput").value = "4-00205569-000";
  document.getElementById("addRegistrationButton").click();
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(document.getElementById("publicationModal").classList.contains("hidden"), false);
  assert.equal(document.querySelector('#publicationTabs [data-publication-category="renewal"] span').textContent, "1");
  assert.equal(document.querySelectorAll(".request-row").length, 0);
  assert.match(document.getElementById("publicationModalMeta").textContent, /100278\/QĐ-SHTT/);
  dom.window.close();
});

test("Reg No. falls back to the latest scraped grant number when Publication Registration has no match", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const applicationNo = "1-2023-02108";
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([applicationNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo, registrationNo: "1-0060448-000", grantNumberDate: "1-0060448-000 · 18/09/2026", lastScrapedAt: "2026-10-01T01:00:00.000Z" }] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    lookupRegistrations: async () => ({ ok: true, matches: [], missing: [] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  const registration = dom.window.document.querySelector(".case-registration");
  assert.equal(registration.textContent, "1-0060448-000");
  assert.equal(registration.dataset.registrationType, "patent");
  assert.equal(dom.window.document.querySelector(".registration-number-core").textContent, "60448");
  dom.window.close();
});

test("failed scrapes without a Publication A record show a tentative hover status", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const published = "1-2022-01097";
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo, published]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, chooseList: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    openPublicationPdf: async () => ({ ok: true, documents: [] }),
    scrape: async () => ({ ok: false, imported: [], missing: [appNo, published] }),
    checkPublicationA: async (id) => ({ ok: true, hasPublicationA: id === published }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById("scrapeAllButton").click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const rows = [...document.querySelectorAll(".case-row")];
  assert.equal(rows[0].querySelector(".age").textContent, "Not yet published?");
  assert.match(rows[0].querySelector(".age").title, /may not yet be published/);
  assert.equal(rows[1].querySelector(".age").textContent, "Not scraped");
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists")).lists[0].maybeUnpublished, [appNo]);
  rows[0].click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.getElementById("detailStatus").textContent, "Not yet published?");
  assert.match(document.getElementById("detailStatus").title, /may not yet be published/);
  dom.window.close();
});

test("two successful but invalid WIPO responses show Not found in the case row", async () => {
  const missingNo = "1-2026-99999";
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([missingNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {},
    chooseList: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    checkPublicationA: async () => ({ ok: true, hasPublicationA: true }),
    scrape: async () => ({ ok: false, imported: [], missing: [missingNo], notFound: [{ applicationNo: missingNo, attempts: 2 }] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.document.getElementById("scrapeAllButton").click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const row = dom.window.document.querySelector(".case-row");
  assert.equal(row.querySelector(".age").textContent, "Not found");
  assert.equal(row.querySelector(".age").classList.contains("not-found"), true);
  assert.match(row.querySelector(".age").title, /Application not found in WIPOPublish/);
  assert.equal(row.querySelector(".case-scraped-date").textContent, "");
  assert.equal(row.querySelector(".case-scraped-clock").textContent, "");
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists")).lists[0].notFound, [missingNo]);
  row.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(dom.window.document.getElementById("detailStatus").textContent, "Not found");
  assert.match(dom.window.document.querySelector(".field-card .field-value").textContent, /Please check the application number/);
  assert.equal(dom.window.document.querySelector(".timeline-section").classList.contains("hidden"), true);
  dom.window.close();
});

test("desktop and LAN views use the Dictionary OCR LAN blue and light-gray palette", () => {
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /--accent: #0b68d1;/);
  assert.match(css, /--soft: #eef2f5;/);
  assert.match(css, /\.topbar \{[^}]*background: #fff;[^}]*border-bottom: 1px solid #cfd8df;/);
  assert.match(css, /\.button\.scrape-primary \{[^}]*background: #126cc8;/);
});

test("header controls share height while online and down pills have equal size", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(html, /id="stopButton"[^>]*><span class="header-stop-icon" aria-hidden="true"><\/span><span>Stop<\/span>/);
  assert.match(css, /\.topbar-actions \{ --header-control-height: 38px; --header-control-icon: 16px;/);
  assert.match(css, /\.topbar-actions > :not\(\.site-pill\) \{[^}]*font: 600 calc\(12px \* var\(--interface-scale\)\)/);
  assert.doesNotMatch(html, /id="databaseStatus"/, "database readiness must not occupy header space");
  assert.match(css, /\.topbar-actions > \.retry-setting, \.topbar-actions > \.rescrape-toggle \{[^}]*height: var\(--header-control-height\)/);
  assert.match(css, /\.topbar-actions \.settings-icon, \.topbar-actions \.action-icon, \.header-stop-icon \{[^}]*width: var\(--header-control-icon\)/);
  assert.match(css, /\.site-pill\.up, \.site-pill\.down \{[^}]*min-width: 154px;[^}]*min-height: 38px;[^}]*font-size: 14px;/);
  assert.match(css, /\.topbar\.wipo-site-up \{[^}]*background: #dff3e5;/);
  assert.doesNotMatch(css, /\.topbar\.wipo-site-up \{[^}]*animation:/);
});

test("Settings and view controls use the allocated shared PNG icons", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(html, /id="typographySettingsButton"[^>]*title="Settings" aria-label="Settings"[^>]*><img class="settings-icon" src="setting\.png\?v=20260930-1720" alt=""><\/button>/);
  assert.match(html, /<img class="list-density-icon" src="eye\.png\?v=20260930-1943" alt="">/);
  assert.match(css, /\.topbar-actions > \.typography-button \{[^}]*width: var\(--header-control-height\);/);
  assert.match(css, /\.list-density-button \{[^}]*gap: 8px;/);
  assert.match(css, /\.typography-button \{[^}]*display: inline-flex;[^}]*align-items: center;/);
  assert.match(css, /\.list-density-button \{[^}]*display: inline-flex;[^}]*align-items: center;/);
  assert.equal(fs.existsSync(path.join(root, "electron", "renderer", "setting.png")), true);
  assert.equal(fs.existsSync(path.join(root, "electron", "renderer", "eye.png")), true);
  assert.deepEqual(fs.readFileSync(path.join(root, "electron", "renderer", "setting.png")), fs.readFileSync(path.join(root, "..", "general icon", "setting.png")));
  assert.deepEqual(fs.readFileSync(path.join(root, "electron", "renderer", "eye.png")), fs.readFileSync(path.join(root, "..", "general icon", "eye.png")));
});

test("WipoPublish keeps status-source maintenance out of desktop and LAN clients", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const preload = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");
  const bridge = fs.readFileSync(path.join(root, "electron", "renderer", "lan-bridge.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "lan-server.js"), "utf8");
  assert.doesNotMatch(html, /Shared SoftIP status database|updateRegistrationStatusButton|updateAllStatusButton/);
  assert.doesNotMatch(preload, /statusSources|updateStatusSources/);
  assert.doesNotMatch(bridge, /status-sources|updateStatusSources/);
  assert.doesNotMatch(server, /pathname === '\/api\/status-sources'/);
});

test("top header reports the live Electron or LAN connection state", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  let connected = true;
  dom.window.wipoTracker = {
    checkConnection: async () => {
      if (!connected) throw new Error("offline");
      return { ok: true };
    },
    init: async () => ({ database: "test.sqlite", presets: [] }), list: async () => ({ applications: [] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const badge = dom.window.document.getElementById("connectionStatus");
  assert.equal(badge.textContent, "Connected");
  assert.equal(badge.classList.contains("connected"), true);
  connected = false;
  dom.window.dispatchEvent(new dom.window.Event("online"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(badge.textContent, "Disconnected");
  assert.equal(badge.classList.contains("error"), true);
  assert.match(css, /\.connection-pill\.connected \{[^}]*#17673e;[^}]*#e7f6ed;/);
  assert.match(css, /\.connection-pill\.error \{[^}]*#9c2017;[^}]*#feeceb;/);
  dom.window.close();

  const preload = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
  const lanBridge = fs.readFileSync(path.join(root, "electron", "renderer", "lan-bridge.js"), "utf8");
  assert.match(preload, /checkConnection: \(\) => ipcRenderer\.invoke\("tracker:health"\)/);
  assert.match(main, /ipcMain\.handle\("tracker:health"/);
  assert.match(lanBridge, /checkConnection: \(\) => json\('\/api\/health'\)/);
});

test("LAN scrape job persistence survives refresh cleanup until the server reports a terminal state", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const bridge = fs.readFileSync(path.join(root, "electron", "renderer", "lan-bridge.js"), "utf8");
  assert.match(html, /lan-bridge\.js\?v=20261005-1/);
  assert.match(bridge, /rememberJobId\(jobId\)/);
  assert.match(bridge, /job\.status === 'done'\) \{ forgetJobId\(jobId\)/);
  assert.match(bridge, /job\.status === 'failed'\) \{ forgetJobId\(jobId\)/);
  assert.match(bridge, /job\.status === 'cancelled'\) \{ forgetJobId\(jobId\)/);
  const monitorFinally = bridge.slice(bridge.indexOf('} finally {', bridge.indexOf('function monitorJob')), bridge.indexOf('})();', bridge.indexOf('function monitorJob')));
  assert.doesNotMatch(monitorFinally, /forgetJobId|writeSavedJobIds/);
  assert.match(bridge, /JSON\.stringify\(\{ clientId, all: true \}\)/);
});

test("HTTP results show only aligned response rows, including split streams, and auto-scroll", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  let progress;
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: (handler) => { progress = handler; }, stop: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const drawer = dom.window.document.getElementById("logDrawer");
  Object.defineProperty(drawer, "scrollHeight", { get: () => 245 });
  dom.window.document.getElementById("toggleLogButton").click();
  progress({ type: "log", message: "Fast batch 4-2025-65702 · attempt 1/10" });
  progress({ type: "log", message: "Queued fairly by user · position 1" });
  progress({ type: "log", message: "Ignored status repeat", log: false });
  progress({ type: "log", message: "1/1: 4-2025-65702 | Status: 500 - Internal Server", stream: true, streamId: "one" });
  progress({ type: "log", message: " Error       21:56:53\n", stream: true, streamId: "one" });
  progress({ type: "log", message: "1/1: 1-2022-01543 | Status: 200 - OK       21:56:54" });
  const rows = [...dom.window.document.querySelectorAll("#logOutput .http-log-row")];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [...row.children].map((cell) => cell.textContent)), [
    ["21:56:53", "4-2025-65702", "500", "Internal Server Error"],
    ["21:56:54", "1-2022-01543", "200", "OK"],
  ]);
  assert.equal(drawer.scrollTop, 245);
  assert.doesNotMatch(dom.window.document.getElementById("logOutput").textContent, /Queued|Fast batch/);
  dom.window.close();
});

test("case input has no file-list loading control", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.getElementById("applicationInput").tagName, "TEXTAREA");
  assert.ok(dom.window.document.getElementById("addButton"));
  assert.equal(dom.window.document.getElementById("loadListButton"), null);
  assert.doesNotMatch(html, /Load input list/);
  dom.window.close();
});

test("multiline Add input accepts line breaks and submits all application numbers together", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [] }), list: async () => ({ applications: [] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const input = dom.window.document.getElementById("applicationInput");
  input.value = "1-2025-00613\nDT1-2021-13520\n4-2025-31926";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(dom.window.document.querySelectorAll(".case-row").length, 0);
  dom.window.document.getElementById("addButton").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual([...dom.window.document.querySelectorAll(".case-no")].map((node) => node.textContent), ["1-2025-00613", "4-2025-31926"]);
  assert.equal(input.value, "");
  dom.window.close();
});

test("Add buttons stretch with growing multiline input rows", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  const document = new JSDOM(html).window.document;
  assert.match(css, /\.input-shell \.button \{[^}]*align-self: stretch;[^}]*height: auto;/);
  assert.equal(document.querySelectorAll(".input-textarea-wrap .input-placeholder").length, 3);
  assert.match(css, /\.input-placeholder \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(css, /\.input-shell textarea:not\(:placeholder-shown\) \+ \.input-placeholder \{ display: none; \}/);
});

test("request numbers stay outside the scrape queue and show their extracted PDF inline", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const requests = [];
  let rendered = "";
  let highlighted = "";
  let saved = "";
  dom.window.publicationViewer = { render: async (url, options) => { rendered = url; highlighted = options?.highlightRequestNo; }, clear: () => {}, resetZoom: () => 1, setContainer: (container) => { dom.window.viewerContainer = container; }, getContainer: () => dom.window.viewerContainer };
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [] }), list: async () => ({ applications: [] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, scrape: async () => { throw new Error("Request must not scrape"); },
    stop: () => {}, exportExcel: async () => ({}),
    requestPublications: async (requestNo) => {
      requests.push(requestNo);
      return { ok: true, requestNo, kind: "Patent annuity", caseRefs: ["IP/PF42"], documents: [{ id: "7", category: "annuity", requestNo, sourceFile: "CB_457_B1.pdf", url: "/test/request.pdf#page=1" }] };
    },
    saveRequestPublicationPdf: async (requestNo, publication) => { saved = `${requestNo}|${publication.url}`; return { ok: true }; },
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const input = dom.window.document.getElementById("requestInput");
  input.value = "DT1-2026-03417\n1-2023-02108";
  dom.window.document.getElementById("addRequestButton").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const row = dom.window.document.querySelector('.case-row[data-request="DT1-2026-03417"]');
  assert.ok(row);
  assert.equal(row.querySelector(".scrape-row"), null);
  assert.equal(row.querySelector(".remove-row") !== null, true);
  assert.equal(dom.window.document.getElementById("exportListButton").disabled, false);
  assert.deepEqual(requests, ["DT1-2026-03417"]);
  row.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(dom.window.document.getElementById("requestDetailNo").textContent, "DT1-2026-03417");
  assert.match(dom.window.document.getElementById("requestDetailMeta").textContent, /IP\/PF42/);
  assert.equal(dom.window.document.getElementById("publicationModal").classList.contains("hidden"), true);
  assert.equal(dom.window.document.getElementById("requestViewerShell").classList.contains("hidden"), false);
  assert.equal(dom.window.viewerContainer?.id, "requestPublicationPages");
  assert.equal(rendered, "/test/request.pdf#page=1");
  assert.equal(highlighted, "DT1-2026-03417");
  assert.ok(dom.window.document.querySelector("#requestPrintPdfButton .icon-print"));
  assert.ok(dom.window.document.querySelector("#requestSavePdfButton .icon-pdf"));
  dom.window.document.getElementById("requestSavePdfButton").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(saved, "DT1-2026-03417|/test/request.pdf#page=1");
  let finishEnhancedRender;
  dom.window.publicationViewer.render = () => new Promise((resolve) => { finishEnhancedRender = resolve; });
  dom.window.viewerContainer = null;
  dom.window.document.querySelector('.case-row[data-request="DT1-2026-03417"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector(".request-viewer-content .native-pdf-preview")?.getAttribute("src"), "/test/request.pdf#page=1");
  assert.equal(dom.window.document.getElementById("requestPublicationPages").classList.contains("preview-pending"), true);
  finishEnhancedRender();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector(".request-viewer-content .native-pdf-preview"), null);
  dom.window.publicationViewer.render = async () => { throw new Error("PDF renderer unavailable"); };
  dom.window.viewerContainer = null;
  dom.window.document.querySelector('.case-row[data-request="DT1-2026-03417"]').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(dom.window.document.querySelector(".request-viewer-content .native-pdf-preview")?.getAttribute("src"), "/test/request.pdf#page=1");
  assert.equal(dom.window.document.getElementById("requestPublicationLoading").classList.contains("hidden"), true);
  dom.window.close();
});

test("scrape, Excel, and PDF actions have distinct labels, icons, and colors", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  for (const [id, label, className, iconClass, iconName] of [
    ["scrapeAllButton", "Scrape All", "scrape-primary", "icon-refresh", "refresh.png"],
    ["scrapeOneButton", "Scrape", "scrape-primary", "icon-refresh", "refresh.png"],
    ["exportListButton", "Export list", "excel-action", "icon-excel", "excel.png"],
    ["exportOneButton", "Export Excel", "excel-action", "icon-excel", "excel.png"],
    ["downloadPdfButton", "Download PDF", "pdf-export", "icon-pdf", "pdf.png"],
  ]) {
    const button = document.getElementById(id);
    assert.equal(button.textContent || button.getAttribute("aria-label"), label === "Download PDF" ? "Download this application as PDF" : label === "Export Excel" ? "Export this application to Excel" : label === "Scrape" ? "Scrape this application" : label);
    assert.equal(button.classList.contains(className), true);
    assert.ok(button.querySelector(`.action-icon.${iconClass}[aria-hidden='true']`));
    assert.ok(fs.existsSync(path.join(root, "electron", "renderer", iconName)));
  }
  for (const icon of ["excel", "pdf", "refresh"]) assert.ok(css.includes(`--icon-${icon}: url("data:image/png;base64,`));
  assert.match(css, /\.button\.scrape-primary \{[^}]*background: #126cc8;/);
  assert.match(css, /\.button\.excel-action \{[^}]*background: #188653;/);
  assert.match(css, /\.button\.print-pdf \{[^}]*background: #d97721;/);
  assert.ok(document.querySelector("#printPdfButton .icon-print"));
  assert.equal(document.querySelector("#printPdfButton .icon-print path").getAttribute("d"), "M7 8V4h10v4M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7zM17 12h1");
  assert.equal(document.getElementById("printPdfButton").getAttribute("aria-label"), "Print this application");
  assert.match(css, /\.record-type-tag \{[^}]*font-size: 14px/);
  assert.match(css, /\.case-ref-badge \{[^}]*14px/);
  dom.window.close();
});

test("case-list edit, add, and remove-list icons are large while remove-row uses a normal close mark", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.ok(document.querySelector("#renameNamedListButton .icon-pencil[aria-hidden='true']"));
  assert.ok(document.querySelector("#addNamedListButton .icon-plus[aria-hidden='true']"));
  assert.ok(document.querySelector("#removeNamedListButton .icon-delete[aria-hidden='true']"));
  assert.match(css, /\.named-list-icon \{[^}]*width: 31px;[^}]*height: 31px;/);
  assert.match(css, /\.remove-row \{[^}]*font: 500 calc\(20px \* var\(--interface-scale\)\)\/1 var\(--ui-font\)/);
  assert.match(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"), /class="remove-row"[^>]*><span aria-hidden="true">×<\/span><\/button>/);
  for (const icon of ["pencil", "plus", "delete"]) {
    assert.ok(css.includes(`--icon-${icon}: url("${icon}.png")`));
    assert.ok(fs.existsSync(path.join(root, "electron", "renderer", `${icon}.png`)));
  }
  dom.window.close();
});

test("record header keeps status after the case reference and clips it beneath publication actions", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.ok(document.querySelector(".detail-title-line #detailStatus"));
  assert.equal(document.getElementById("detailCaseRef").nextElementSibling.id, "detailStatus");
  assert.equal(document.querySelector(".detail-status-line"), null);
  for (const id of ["publicationAButton", "publicationBButton", "annuityButton"]) {
    const button = document.getElementById(id);
    assert.ok(button.querySelector(".publication-label-full"));
    assert.ok(button.querySelector(".publication-label-short"));
    assert.ok(button.querySelector(".publication-label-tiny"));
    assert.ok(button.querySelector(".publication-count"));
  }
  for (const id of ["scrapeOneButton", "exportOneButton", "printPdfButton", "downloadPdfButton"]) {
    const button = document.getElementById(id);
    assert.ok(button.classList.contains("icon-only"));
    assert.ok(button.getAttribute("title"));
  }
  assert.match(css, /\.record-type-tag\[data-kind="design"\] \{[^}]*#e5f0ff/);
  assert.match(css, /\.record-type-tag\[data-kind="trademark"\]/);
  assert.match(css, /\.status-tag \{[^}]*flex: none;[^}]*font-size: 14px;/);
  assert.match(css, /\.detail-title-line \{[^}]*flex-wrap: nowrap;[^}]*overflow: hidden;[^}]*mask-image: linear-gradient/);
  assert.match(css, /\.detail-heading \{[^}]*flex-wrap: nowrap;[^}]*overflow: hidden;/);
  assert.doesNotMatch(renderer, /headers\.observe\(els\.casePanel\)|headers\.observe\(els\.list\)/);
  assert.match(renderer, /pendingWidth = startWidth \+ event\.clientX - startX/);
  assert.match(renderer, /requestAnimationFrame\(applyPendingWidth\)/);
  assert.match(css, /@container detail-header \(max-width: 850px\)/);
  assert.match(css, /@container detail-header \(max-width: 620px\)/);
  dom.window.close();
});

test("renderer hides duplicate header title and mailing-address template while rendering structured tables", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const now = new Date();
  const data = {
    fields: {
      "Loại đơn": "PCT national phase SC",
      "Trạng thái": "Granted",
      "(73) Địa chỉ nhận thư": "${repeating.template.ca}",
      "(54) Tên": "Title remains in the named field only",
      "(57) Tóm tắt": "Abstract",
      "(58) Các tài liệu đối chứng": "Tài liệu được đối chứngTài liệu tham khảoDanh mụcYêu cầu bảo hộLoại tài liệu đối chứng 12021-03-09 Các tài liệu được trích dẫn trong Báo cáo thẩm định sơ bộ quốc tế cho đơn quốc tế số PCT/JP2019/033942 Notification and ReportSáng chế 22021-07-12 US 11,194,263 B2 Notification and ReportSáng chế",
    },
    split_fields: {
      status: "Granted",
      title: "Must not appear below the application number",
      grant_number_date: { number: "1-0050358-000", date: { iso: "2025-07-17" } },
      application_number_date: { number: "VN 1-2022-01543", date: { iso: "2020-08-20" } },
      publication_number_date: { number: "VN 87058 | A", date: { iso: "2022-06-27" } },
      pct_application_number_date: { number: "PCT/US2020/047224", date: { iso: "2020-08-20" } },
      pct_publication_number_date: { number: "IB WO/2021/041157", date: { iso: "2021-03-04" } },
      expiry_date: { iso: "2040-08-20" },
      priority_details: [{ priority_no: "US 62/891,693", priority_date: { iso: "2019-08-26" } }],
      ipc_classifications: [{ code: "A01N 37/06", version: "2006.01" }],
      representatives_ordered: [{ name: "INVESTIP", address: "Hà Nội" }],
    },
    applicants_ordered: [{ name: "PURINA ANIMAL NUTRITION LLC", address: "Minnesota" }],
    inventors_ordered: [
      { name: "GABRIEL, Michael J.", address: "Minnesota" },
      { name: "CASE, Sensitive", address: "minnesota" },
    ],
    diary: [{ date: { iso: "2020-08-20" }, description: "Filing" }],
  };
  const snapshot = { id: 1, scrapedAt: now.toISOString(), changes: [
    { field: "diary[0]", changeType: "changed", oldValue: '{"description":"Filed"}', newValue: '{"description":"Filing"}' },
    { field: "split_fields.priority_details[0]", changeType: "changed", oldValue: '{"priority_no":"US 62/891,693"}', newValue: '{"priority_no":"US 62/891,693"}' },
  ], data };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo, lastScrapedAt: now.toISOString(), title: "Do not show this list title" }] }),
    detail: async () => ({ detail: { latest: snapshot, snapshots: [snapshot] } }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    openPublicationPdf: async () => ({ ok: true, documents: [
      (dom.window.publicationA = { id: "pub-a-1", category: "publication_a", url: "https://example.test/publication.pdf", publicationNo: "VN 87058", pages: "394", sourceFile: "CB_411_A1.pdf" }),
      { id: "annuity-1", category: "annuity", needsPreparation: true, url: "https://example.test/annuity-1.pdf", requestNo: "DT1-2026-03417", sourceFile: "CB_457_B1_1.pdf" },
      { id: "annuity-2", category: "annuity", url: "https://example.test/annuity-2.pdf", requestNo: "DT1-2026-03418", sourceFile: "CB_457_B1_2.pdf" },
      { id: "annuity-3", category: "annuity", url: "https://example.test/annuity-3.pdf", requestNo: "DT1-2026-03419", sourceFile: "CB_457_B1_3.pdf" },
    ] }),
    savePublicationPdf: async (applicationNo, registrationNo, publication) => { dom.window.savedPublication = { applicationNo, registrationNo, publication }; return { ok: true }; },
    preparePublicationPdf: async (_app, _reg, item) => {
      dom.window.preparationCalls = (dom.window.preparationCalls || 0) + 1;
      return { ok: true, url: item.category === 'annuity' ? item.url : "https://example.test/extracted.pdf" };
    },
  };
  dom.window.publicationViewer = {
    preload: async url => { (dom.window.preloadedPublications ||= []).push(url); },
    render: async (url) => { dom.window.renderedPublicationUrl = url; },
    renderMany: async (entries) => { dom.window.renderedPublicationEntries = entries; },
    zoomBy: (delta) => { dom.window.publicationZoom = (dom.window.publicationZoom || 1) + delta; return dom.window.publicationZoom; },
    resetZoom: () => { dom.window.publicationZoom = 1; return 1; },
    clear: () => { dom.window.publicationViewerCleared = true; },
  };
  let printCalls = 0;
  dom.window.print = () => { printCalls += 1; };
  dom.window.eval(fs.readFileSync(path.join(root, "..", "electron-app", "softip_display_hash.js"), "utf8"));
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));

  const document = dom.window.document;
  document.querySelector(".case-row").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(document.getElementById("detailTitle"), null);
  assert.doesNotMatch(document.getElementById("caseList").textContent, /Do not show this list title/);
  assert.doesNotMatch(document.getElementById("fieldGrid").textContent, /Địa chỉ nhận thư|repeating\.template\.ca/);
  assert.match(document.getElementById("fieldGrid").textContent, /\(54\) Tên/);
  assert.deepEqual(
    [...document.querySelectorAll(".structured-heading h3")].map((node) => node.textContent),
    ["Numbers and dates", "Priority", "Classification", "(58) Các tài liệu đối chứng", "Applicants / Owners", "Inventors", "IP Representatives"]
  );
  assert.equal(document.querySelectorAll(".structured-table").length, 7);
  assert.equal(document.querySelectorAll(".timeline-item.changed").length, 1);
  assert.equal(document.querySelectorAll(".structured-section.changed .changed-row").length, 1);
  assert.ok([...document.querySelectorAll(".field-card, .structured-section, .changed-row, .timeline-item")].every((node) => !node.hasAttribute("title")));
  assert.equal(document.getElementById("changeSummary").title, "Open change history");
  assert.deepEqual([...document.querySelector(".structured-table tbody").querySelectorAll("tr")].map((row) => row.cells[0].textContent), ["PCT application", "WIPO publication", "Application", "Publication", "Grant", "Expiry"]);
  const citations = document.querySelector(".structured-section.citations");
  assert.deepEqual([...citations.querySelectorAll("th")].map((node) => node.textContent), ["Tài liệu được đối chứng", "Tài liệu tham khảo", "Danh mục", "Yêu cầu bảo hộ", "Loại tài liệu đối chứng"]);
  assert.equal(citations.querySelectorAll("tbody tr").length, 2);
  assert.match(citations.querySelector("tbody tr:first-child").textContent, /09\/03\/2021/);
  assert.match(citations.querySelector("tbody tr:nth-child(2)").textContent, /US 11,194,263 B2/);
  const peopleSections = [...document.querySelectorAll(".structured-section.people")];
  const hashedPeopleSections = peopleSections.filter((section) => section.classList.contains("address-hashes"));
  assert.equal(hashedPeopleSections.length, 2);
  for (const section of hashedPeopleSections) {
    assert.deepEqual([...section.querySelectorAll("th")].map((node) => node.textContent), ["Name", "Address", "Hash"]);
    assert.equal(section.querySelectorAll("tbody tr:first-child td").length, 3);
  }
  const addressHashes = hashedPeopleSections.map((section) => section.querySelector(".address-hash-badge").textContent);
  assert.equal(addressHashes[0], addressHashes[1]);
  assert.match(addressHashes[0], /^[0-9a-f]{6}$/);
  const inventorHashes = [...hashedPeopleSections[1].querySelectorAll(".address-hash-badge")].map((node) => node.textContent);
  assert.equal(inventorHashes.length, 2);
  assert.notEqual(inventorHashes[0], inventorHashes[1]);
  const matchingHashRows = [...document.querySelectorAll(`tr[data-address-hash="${addressHashes[0]}"]`)];
  assert.equal(matchingHashRows.length, 2);
  const differentHashRow = hashedPeopleSections[1].querySelector(`tr[data-address-hash="${inventorHashes[1]}"]`);
  matchingHashRows[1].dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
  assert.ok(matchingHashRows.every((row) => !row.classList.contains("address-hash-match")));
  const matchingHashBadge = matchingHashRows[1].querySelector(".address-hash-badge");
  matchingHashBadge.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true, relatedTarget: matchingHashRows[1] }));
  assert.ok(matchingHashRows.every((row) => row.classList.contains("address-hash-match")));
  assert.equal(differentHashRow.classList.contains("address-hash-match"), false);
  matchingHashBadge.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true, relatedTarget: matchingHashRows[1] }));
  assert.ok(matchingHashRows.every((row) => !row.classList.contains("address-hash-match")));
  const representativeSection = peopleSections.find((section) => section.querySelector("h3").textContent === "IP Representatives");
  assert.deepEqual([...representativeSection.querySelectorAll("th")].map((node) => node.textContent), ["Name", "Address"]);
  assert.equal(representativeSection.querySelectorAll("tbody tr:first-child td").length, 2);
  assert.match(document.querySelector(".case-scraped-date").textContent, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.match(document.querySelector(".case-scraped-clock").textContent, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(document.querySelector(".case-status-cell .age").textContent, "today");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.age \{[^}]*padding: calc\(2px \* var\(--interface-scale\)\) calc\(6px \* var\(--interface-scale\)\);[^}]*font: 500 calc\(9px \* var\(--interface-scale\)\)\/1\.2 var\(--ui-font\);/);
  assert.match(css, /\.case-panel\.compact-list \.age,[^}]*font-size: calc\(8px \* var\(--interface-scale\)\);/);
  assert.match(css, /\.detail-heading h2 \{[^}]*font-family: var\(--ui-font\)/);
  assert.match(css, /\.status-tag \{[^}]*font-family: var\(--ui-font\)/);
  assert.match(css, /\.field-grid \{[^}]*font-family: var\(--ui-font\)/);
  assert.match(css, /\.structured-heading h3 \{[^}]*font-family: var\(--ui-font\)/);
  assert.match(css, /\.structured-table \{[^}]*font-family: var\(--ui-font\)/);
  assert.match(css, /\.structured-table tbody tr\.address-hash-match td \{ background: #f0f7ff; \}/);
  assert.match(css, /\.case-column-resizer \{[^}]*cursor: col-resize;/);
  assert.doesNotMatch(css, /Georgia, serif/);
  document.getElementById("publicationAButton").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const publicationModal = document.getElementById("publicationModal");
  assert.equal(publicationModal.classList.contains("hidden"), false);
  assert.equal(dom.window.renderedPublicationUrl, "https://example.test/publication.pdf");
  assert.deepEqual(Array.from(dom.window.preloadedPublications).sort(), [
    "https://example.test/annuity-1.pdf", "https://example.test/annuity-2.pdf", "https://example.test/annuity-3.pdf"
  ]);
  assert.equal(dom.window.preparationCalls, 1);
  assert.match(document.getElementById("publicationModalMeta").textContent, /VN 87058 · Pages 394 · CB_411_A1\.pdf/);
  assert.equal(document.getElementById("printPublicationButton").disabled, false);
  assert.equal(document.getElementById("savePublicationPdfButton").disabled, false);
  document.getElementById("publicationZoomInButton").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(document.getElementById("publicationZoomResetButton").textContent, "125%");
  document.getElementById("publicationZoomOutButton").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(document.getElementById("publicationZoomResetButton").textContent, "100%");
  document.getElementById("printPublicationButton").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(printCalls, 1);
  document.getElementById("savePublicationPdfButton").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(dom.window.savedPublication.applicationNo, appNo);
  assert.equal(dom.window.savedPublication.publication.id, "pub-a-1");
  document.querySelector('[data-publication-category="annuity"]').click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(dom.window.preparationCalls, 1);
  assert.equal(document.getElementById("publicationAllLabel").classList.contains("hidden"), false);
  assert.equal(document.getElementById("publicationDocumentSelect").classList.contains("hidden"), false);
  document.getElementById("publicationAllCheckbox").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(document.getElementById("publicationDocumentSelect").classList.contains("hidden"), true);
  assert.equal(dom.window.renderedPublicationEntries.length, 3);
  assert.deepEqual(dom.window.renderedPublicationEntries.map((entry) => entry.url), ["https://example.test/annuity-1.pdf", "https://example.test/annuity-2.pdf", "https://example.test/annuity-3.pdf"]);
  assert.equal(document.getElementById("printPublicationButton").disabled, false);
  assert.equal(document.getElementById("savePublicationPdfButton").disabled, false);
  document.getElementById("printPublicationButton").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(printCalls, 2);
  document.getElementById("savePublicationPdfButton").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(dom.window.savedPublication.publication.all, true);
  assert.equal(dom.window.savedPublication.publication.documents.length, 3);
  document.getElementById("publicationAllCheckbox").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(document.getElementById("publicationDocumentSelect").classList.contains("hidden"), false);
  document.getElementById("closePublicationModalButton").click();
  assert.equal(publicationModal.classList.contains("hidden"), true);
  assert.equal(dom.window.publicationViewerCleared, true);
  dom.window.publicationA.sourcePreview = true;
  dom.window.publicationA.page = 394;
  dom.window.publicationA.url = "https://example.test/source.pdf#page=394";
  document.getElementById("publicationAButton").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(document.querySelector(".native-pdf-preview").src, /source\.pdf#page=394$/);
  assert.equal(dom.window.renderedPublicationUrl, "https://example.test/annuity-1.pdf");
  document.getElementById("printPublicationButton").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(dom.window.renderedPublicationUrl, "https://example.test/extracted.pdf");
  assert.equal(printCalls, 3);
  document.getElementById("closePublicationModalButton").click();
  dom.window.publicationA.sourcePreview = false;
  dom.window.publicationA.needsPreparation = true;
  dom.window.publicationA.url = 'about:blank';
  document.getElementById('publicationAButton').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(dom.window.renderedPublicationUrl, 'https://example.test/extracted.pdf');
  assert.equal(document.querySelector('.native-pdf-preview'), null);
  document.getElementById('closePublicationModalButton').click();
  document.getElementById("printPdfButton").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(printCalls, 4);
  assert.equal(document.getElementById("printReportApplicationNo").textContent, appNo);
  assert.match(document.getElementById("printReportSnapshot").textContent, /Snapshot: \d{2}\/\d{2}\/\d{4}/);
  let downloadedReport;
  dom.window.fetch = async () => ({ ok: true, text: async () => css });
  dom.window.wipoTracker.downloadPdf = async (id, reportHtml) => { downloadedReport = { id, reportHtml }; return { ok: true }; };
  document.getElementById("downloadPdfButton").click();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(downloadedReport.id, appNo);
  assert.match(downloadedReport.reportHtml, /printing-report/);
  assert.match(downloadedReport.reportHtml, /WipoPublish Vietnam/);
  assert.match(downloadedReport.reportHtml, /Snapshot:/);
  assert.match(css, /@media print/);
  assert.match(css, /body\.printing-report \.case-panel/);
  assert.match(css, /body\.printing-publication \.publication-document-divider \{ display: none !important; \}/);
  assert.match(css, /\.publication-pages > \.publication-page:last-of-type \{ break-after: auto; page-break-after: auto; \}/);
  assert.match(css, /--case-date-effective-width: calc\(var\(--case-date-width\) \* var\(--interface-scale\) - 6px\);[^}]*grid-template-columns: var\(--case-select-track\) var\(--case-app-track\)[^;]*var\(--case-date-effective-width\) var\(--case-clock-effective-width\)/);
  assert.deepEqual([...document.querySelectorAll(".list-head > div")].slice(1, 4).map((item) => item.textContent.trim()), ["APP NO.", "Reg No.", "Case ref"]);
  assert.deepEqual([...document.querySelectorAll(".case-time-head-cell")].map((item) => item.childNodes[0].textContent.trim()), ["Date", "Time", "Result"]);
  assert.equal(document.querySelector('[data-case-sort="wipostatus"] > span').textContent, "Status");
  assert.match(css, /\.case-column-head \{[^}]*justify-content: center;[^}]*text-align: center;/);
  assert.match(css, /\.case-time-head-cell \{[^}]*justify-content: center;[^}]*text-align: center;/);
  assert.equal(document.getElementById("caseCount"), null);
  assert.equal(document.querySelector(".case-panel").lastElementChild.className, "input-bar input-stack");
  assert.match(css, /\.snapshot-strip \{[^}]*min-height: 36px;[^}]*padding: 3px 26px;/);
  assert.match(css, /\.snapshot-strip select \{[^}]*width: clamp\(230px, 25vw, 300px\);[^}]*height: 29px/);
  assert.match(css, /\.publication-action \.publication-count \{[^}]*color: #0a57aa;[^}]*background: #e3f0ff;/);
  assert.match(css, /\.publication-action \{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*gap: 4px;/);
  assert.match(css, /\.publication-action \.publication-count \{[^}]*min-height: 16px;[^}]*margin: 0;[^}]*align-self: center;/);
  assert.doesNotMatch(css, /background: var\(--teal\)/);
  dom.window.close();
});

test("LAN publication bridge loads repository-backed PDF tabs without opening a tab", () => {
  const bridge = fs.readFileSync(path.join(root, "electron", "renderer", "lan-bridge.js"), "utf8");
  assert.doesNotMatch(bridge, /window\.open\s*\(/);
  assert.match(bridge, /\/api\/publication-pdfs\?applicationNo=/);
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  assert.match(html, /data-publication-category="publication_a"/);
  assert.match(html, /data-publication-category="publication_b"/);
  assert.match(html, /data-publication-category="annuity"/);
  assert.match(html, /id="printPublicationButton"/);
  assert.match(html, /id="savePublicationPdfButton"/);
  assert.match(html, /id="publicationAllCheckbox"/);
  assert.match(html, /id="publicationZoomOutButton"/);
  assert.match(html, /id="publicationZoomResetButton"/);
  assert.match(html, /id="publicationZoomInButton"/);
  assert.match(bridge, /savePublicationPdf/);
});

test("old LAN host reports request-PDF restart need without retrying every row", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", url: "http://localhost/wipo-application-tracker/" });
  let requestCalls = 0;
  dom.window.fetch = async (url) => {
    if (String(url).includes("request-publication-pdfs")) {
      requestCalls += 1;
      return { ok: false, status: 404, json: async () => ({ error: "Not found." }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "lan-bridge.js"), "utf8"));
  const first = await dom.window.wipoTracker.requestPublications("DT1-2025-06965");
  const second = await dom.window.wipoTracker.requestPublications("DT1-2025-06967");
  assert.equal(first.hostUpdateRequired, true);
  assert.match(first.error, /restart.*Unified Hosting Hub/i);
  assert.equal(second.hostUpdateRequired, true);
  assert.equal(requestCalls, 1);
  dom.window.close();
});

test("offline LAN host reports request-PDF connection failure without retrying every row", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", url: "http://localhost/wipo-application-tracker/" });
  let requestCalls = 0;
  dom.window.fetch = async (url) => {
    if (String(url).includes("request-publication-pdfs")) { requestCalls += 1; throw new TypeError("Failed to fetch"); }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "lan-bridge.js"), "utf8"));
  const first = await dom.window.wipoTracker.requestPublications("DT1-2025-06965");
  const second = await dom.window.wipoTracker.requestPublications("DT1-2025-06967");
  assert.equal(first.hostOffline, true);
  assert.match(first.error, /host is offline or unreachable/i);
  assert.equal(second.hostOffline, true);
  assert.equal(requestCalls, 1);
  dom.window.close();
});

test("request rows recover automatically when the LAN host returns", async (t) => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  t.after(() => dom.window.close());
  dom.window.localStorage.setItem("wipoTrackerNamedLists", JSON.stringify({ activeId: "default", lists: [{ id: "default", name: "Default list", queue: [], requestQueue: ["DT1-2025-06965"] }] }));
  let available = false;
  dom.window.wipoTracker = {
    checkConnection: async () => ({ ok: true }), siteStatus: async () => ({ state: "up", checkedAt: new Date().toISOString() }),
    init: async () => ({ database: "test.sqlite", presets: [] }), list: async () => ({ applications: [] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
    requestPublications: async (requestNo) => available
      ? { ok: true, requestNo, documents: [{ id: "1", category: "annuity", url: "/request.pdf#page=1" }], caseRefs: [] }
      : { ok: false, hostOffline: true, checkedAt: Date.now(), documents: [], error: "Host offline" },
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  for (let attempt = 0; attempt < 20 && !dom.window.document.querySelector(".request-row .case-status-cell"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(dom.window.document.querySelector(".request-row .case-status-cell").textContent, /Host offline/);
  available = true;
  const originalNow = dom.window.Date.now;
  dom.window.Date.now = () => originalNow() + 11000;
  await dom.window.eval("checkConnection()");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(dom.window.document.querySelector(".request-row .case-status-cell").textContent, /PDF 1/);
});

test("request list loads many PDF statuses with one batch lookup", async (t) => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  t.after(() => dom.window.close());
  const requestNos = ["DT1-2025-06965", "DT1-2025-06967", "GH4-2025-09186"];
  dom.window.localStorage.setItem("wipoTrackerNamedLists", JSON.stringify({ activeId: "default", lists: [{ id: "default", name: "Default list", queue: [], requestQueue: requestNos }] }));
  let batchCalls = 0;
  let singleCalls = 0;
  dom.window.wipoTracker = {
    checkConnection: async () => ({ ok: true }), siteStatus: async () => ({ state: "up", checkedAt: new Date().toISOString() }),
    init: async () => ({ database: "test.sqlite", presets: [] }), list: async () => ({ applications: [] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
    requestPublicationsBatch: async (numbers) => { batchCalls += 1; return { ok: true, results: numbers.map((requestNo) => ({
      ok: true, requestNo, kind: "Publication request", caseRefs: [], documents: [{ id: requestNo, url: "/request.pdf#page=1" }],
    })) }; },
    requestPublications: async () => { singleCalls += 1; return { ok: false, documents: [] }; },
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  for (let attempt = 0; attempt < 20 && dom.window.document.querySelectorAll(".request-row .case-status-cell").length < requestNos.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(batchCalls, 1);
  assert.equal(singleCalls, 0);
  assert.equal([...dom.window.document.querySelectorAll(".request-row .case-status-cell")].filter((item) => /PDF 1/.test(item.textContent)).length, 3);
});

test("request PDF results reuse green found and red not-found row states", async (t) => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  t.after(() => dom.window.close());
  const foundNo = "GH4-2025-09282";
  const missingNo = "GH4-2025-09311";
  dom.window.localStorage.setItem("wipoTrackerNamedLists", JSON.stringify({ activeId: "default", lists: [{ id: "default", name: "Default list", queue: [], requestQueue: [foundNo, missingNo] }] }));
  dom.window.wipoTracker = {
    checkConnection: async () => ({ ok: true }), siteStatus: async () => ({ state: "up", checkedAt: new Date().toISOString() }),
    init: async () => ({ database: "test.sqlite", presets: [] }), list: async () => ({ applications: [] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
    requestPublicationsBatch: async () => ({ ok: true, results: [
      { ok: true, requestNo: foundNo, documents: [{ id: "found", url: "/request.pdf" }], caseRefs: [] },
      { ok: true, requestNo: missingNo, documents: [], caseRefs: [] },
    ] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = dom.window.document.querySelector(`[data-request="${foundNo}"]`);
    const missing = dom.window.document.querySelector(`[data-request="${missingNo}"]`);
    if (found?.classList.contains("scrape-today") && missing?.classList.contains("scrape-stale")) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const found = dom.window.document.querySelector(`[data-request="${foundNo}"]`);
  const missing = dom.window.document.querySelector(`[data-request="${missingNo}"]`);
  assert.equal(found.querySelector(".age").textContent, "PDF 1");
  assert.equal(found.classList.contains("scrape-today"), true);
  assert.equal(missing.querySelector(".age").textContent, "No PDF");
  assert.equal(missing.classList.contains("scrape-stale"), true);
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.case-row\.scrape-today \.age/);
  assert.match(css, /\.case-row\.scrape-stale \.age/);
});

test("named case lists migrate the existing queue, switch locally, and rename inline", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const document = dom.window.document;
  assert.equal(document.getElementById("loadTrademarkSampleButton"), null);
  assert.equal(document.querySelectorAll(".case-row").length, 1);
  const dropdown = document.getElementById("namedListSelect");
  assert.equal(dropdown.options[0].textContent, "Default list");
  document.getElementById("addNamedListButton").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.querySelectorAll(".case-row").length, 0);
  const nameInput = document.getElementById("namedListName");
  assert.equal(nameInput.classList.contains("hidden"), false);
  nameInput.value = "Vietnam watchlist";
  nameInput.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(dropdown.selectedOptions[0].textContent, "Vietnam watchlist");
  document.getElementById("applicationInput").value = "4-2004-14651";
  document.getElementById("addButton").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.querySelectorAll(".case-row").length, 1);
  dropdown.value = "default";
  dropdown.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.querySelector(".case-no").textContent, appNo);
  const saved = JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists"));
  assert.equal(saved.lists.length, 2);
  assert.deepEqual(saved.lists.find((list) => list.name === "Vietnam watchlist").queue, ["4-2004-14651"]);
  assert.deepEqual(saved.lists.find((list) => list.name === "Default list").queue, [appNo]);
  dom.window.close();
});

test("removing a saved list requires typing remove and preserves stored snapshots", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.localStorage.setItem("wipoTrackerNamedLists", JSON.stringify({
    activeId: "watch", lists: [
      { id: "default", name: "Default list", queue: [appNo], refsByApplication: {}, maybeUnpublished: [] },
      { id: "watch", name: "Vietnam watchlist", queue: ["4-2004-14651"], refsByApplication: {}, maybeUnpublished: [] },
    ],
  }));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const document = dom.window.document;
  assert.equal(document.querySelector(".case-panel .input-bar #addButton") !== null, true);
  document.getElementById("removeNamedListButton").click();
  assert.equal(document.getElementById("removeListModal").classList.contains("hidden"), false);
  assert.match(document.getElementById("removeListMessage").textContent, /Vietnam watchlist/);
  const input = document.getElementById("removeListInput");
  input.value = "wrong";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(document.getElementById("confirmRemoveListButton").disabled, true);
  input.value = "remove";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  document.getElementById("confirmRemoveListButton").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const saved = JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists"));
  assert.equal(saved.lists.length, 1);
  assert.equal(saved.lists[0].name, "Default list");
  assert.deepEqual(saved.lists[0].queue, [appNo]);
  assert.equal(document.querySelector(".case-no").textContent, appNo);
  document.getElementById("removeNamedListButton").click();
  const lastInput = document.getElementById("removeListInput");
  lastInput.value = "remove";
  lastInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  document.getElementById("confirmRemoveListButton").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const reset = JSON.parse(dom.window.localStorage.getItem("wipoTrackerNamedLists"));
  assert.equal(reset.lists.length, 1);
  assert.equal(reset.lists[0].name, "Default list");
  assert.deepEqual(reset.lists[0].queue, []);
  assert.equal(document.querySelectorAll(".case-row").length, 0);
  dom.window.close();
});

test("trademark records prioritize mark details, clean publication data, and provide copyable Nice classes", async () => {
  const trademarkNo = "4-2004-14651";
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const snapshot = { id: 2, scrapedAt: new Date().toISOString(), changes: [], data: {
    id: trademarkNo, type: "TRADEMARKS", image: "/sample-mark.png",
    fields: {
      "Trạng thái": "Registered", "(100) Số bằng và ngày cấp": "123456 01.02.2020",
      "(200) Số đơn và Ngày nộp đơn": "VN 4-2004-14651 03.04.2004", "(541) Nhãn hiệu": "SAMPLE MARK",
      "(400) Số công bố và ngày công bố": "VN-4-2021-04414 26/04/2021 397A | VN-4-2021-04414 397A 26/01/2026",
      "(511) Nhóm sản phẩm/dịch vụ": "Class/Nhóm 09: Scientific apparatus<lf>Class/Nhóm 35: Advertising",
      "(531) Phân loại hình": "26.01.01 | 27.05.01", "(730) Chủ đơn/Chủ bằng": "OWNER LLC : Hanoi",
      "(740) Đại diện SHCN": "AGENT CO : Ho Chi Minh City", "(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)": "Combined",
    },
    split_fields: {
      status: "Registered", title: "SAMPLE MARK",
      grant_number_date: { number: "123456", date: { iso: "2020-02-01" } },
      application_number_date: { number: "VN 4-2004-14651", date: { iso: "2004-04-03" } },
      publication_number_date: { raw: "VN-4-2021-04414 26/04/2021 397A | VN-4-2021-04414 397A 26/01/2026", number: "VN-4-2021-04414 26/04/2021 397A | VN-4-2021-04414 397A", date: { iso: "2026-01-26" } },
      pct_application_number_date: { number: "PCT/XX2020/000001", date: { iso: "2020-01-01" } },
      pct_publication_number_date: { number: "WO/2020/000001", date: { iso: "2020-06-01" } },
      priority_details: [], representatives_ordered: [{ name: "AGENT CO", address: "Ho Chi Minh City" }],
    },
    applicants_ordered: [{ name: "OWNER LLC", address: "Hanoi" }], diary: [],
  } };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([trademarkNo]));
  let publicationCalls = 0;
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: trademarkNo, lastScrapedAt: snapshot.scrapedAt }] }),
    detail: async () => ({ detail: { latest: snapshot, snapshots: [snapshot] } }), onProgress: () => {},
    chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    openPublicationPdf: async () => { publicationCalls += 1; return { ok: true, documents: [] }; },
  };
  let copiedText = "";
  Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async (value) => { copiedText = value; } }, configurable: true });
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 25));
  dom.window.document.querySelector(".case-row").click();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const document = dom.window.document;
  assert.equal(document.getElementById("detailRecordType").textContent, "Trademark");
  assert.equal(document.querySelector(".publication-quick-actions").classList.contains("hidden"), false);
  assert.equal(document.getElementById("annuityButton").textContent.includes("Renewal"), true);
  assert.equal(publicationCalls > 0, true);
  assert.deepEqual([...document.querySelectorAll(".structured-heading h3")].map((node) => node.textContent), ["Trademark details", "Numbers and dates", "Goods and services", "Vienna classification", "Owners / Applicants", "IP Representatives"]);
  assert.equal(document.querySelector(".trademark-details tbody tr:first-child td:last-child").textContent, "SAMPLE MARK");
  const numberRows = [...document.querySelectorAll(".structured-section:nth-of-type(2) tbody tr")];
  assert.deepEqual(numberRows.map((row) => row.cells[0].textContent), ["Application", "Publication", "Grant"]);
  assert.equal(numberRows[1].cells[1].textContent, "397A");
  assert.equal(numberRows[1].cells[2].textContent, "26/04/2021 | 26/01/2026");
  const goodsRows = [...document.querySelectorAll(".goods-services tbody tr")];
  assert.deepEqual(goodsRows.map((row) => row.cells[0].textContent), ["09", "35"]);
  assert.equal(document.querySelectorAll(".copy-class-button").length, 2);
  document.querySelector(".copy-class-button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(copiedText, "Class 09: Scientific apparatus");
  assert.equal(document.getElementById("recordMedia").classList.contains("hidden"), false);
  assert.doesNotMatch(document.getElementById("recordMedia").textContent, /image from the stored WIPO record/i);
  document.querySelector(".record-media-single").click();
  assert.equal(document.getElementById("imagePreviewModal").classList.contains("hidden"), false);
  assert.equal(document.getElementById("imagePreviewApplication").textContent, trademarkNo);
  assert.equal(document.getElementById("imagePreviewType").textContent, "Trademark");
  assert.equal(document.getElementById("imagePreviewPosition").textContent, "Image 1 of 1");
  assert.equal(document.querySelectorAll("#imagePreviewThumbnails button.selected").length, 1);
  dom.window.close();
});

test("legacy shifted trademark snapshots are repaired when displayed", async () => {
  const trademarkNo = "4-2025-31926";
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const snapshot = { id: 25, scrapedAt: new Date().toISOString(), changes: [], data: {
    id: trademarkNo, type: "TRADEMARKS", image: "/sample-mark.png",
    fields: {
      "Loại đơn": "Nhãn hiệu", "(100) Số bằng và ngày cấp": "Thông thường", "Trạng thái": "", "(180) Ngày hết hạn": "Từ chối",
      "(200) Số đơn và Ngày nộp đơn": "", "(400) Số công bố và ngày công bố": "VN -4-2025-31926 17.11.2023",
      "(541) Nhãn hiệu": "190004 25.12.2025", "(591) Màu sắc nhãn hiệu": "S.Kidman", "(300) Chi tiết về dữ liệu ưu tiên": "Nâu, trắng.",
      "(511) Nhóm sản phẩm/dịch vụ": "AU 2375463 | AU | 2375463 | 27.07.2023",
      "(531) Phân loại hình": "Class/Nhóm 18: Vali và túi du lịch.<lf>Class/Nhóm 25: Quần áo; đồ đi ở chân; đồ đội đầu.",
      "(730) Chủ đơn/Chủ bằng": "", "(740) Đại diện SHCN": "S. Kidman Clothing Co Pty Ltd : Brisbane, Australia",
      "(571) Nhãn hiệu": "Công ty TNHH Tầm nhìn và Liên danh : Hà Nội", "(566) Nhãn hiệu dịch thuật": "",
      "(550) Kiểu của mẫu nhãn(hình/chữ/kết hợp)": "", "(526) Yếu tố loại trừ": "Combined",
    },
    split_fields: { status: "", priority_details: [], representatives_ordered: [], title: "190004 25.12.2025" },
    applicants_ordered: [], diary: [],
  } };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([trademarkNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: trademarkNo, lastScrapedAt: snapshot.scrapedAt }] }),
    detail: async () => ({ detail: { latest: snapshot, snapshots: [snapshot] } }), onProgress: () => {}, chooseList: async () => ({}),
    scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}), openPublicationPdf: async () => ({ ok: true, documents: [] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 25));
  dom.window.document.querySelector(".case-row").click();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const document = dom.window.document;
  const detailRows = [...document.querySelectorAll(".trademark-details tbody tr")];
  assert.deepEqual(detailRows.map((row) => [row.cells[0].textContent, row.cells[1].textContent]), [["Mark", "S.Kidman"], ["Colours", "Nâu, trắng."], ["Mark type", "Combined"]]);
  const numberRows = [...document.querySelectorAll(".structured-section:nth-of-type(2) tbody tr")];
  assert.deepEqual(numberRows.map((row) => row.cells[0].textContent), ["Application", "Publication"]);
  assert.match(numberRows[0].cells[1].textContent, /4-2025-31926/);
  assert.equal(numberRows[1].cells[1].textContent, "190004");
  assert.equal(numberRows[1].cells[2].textContent, "25/12/2025");
  const priority = [...document.querySelectorAll(".structured-heading h3")].find((node) => node.textContent === "Priority").closest("section").querySelector("tbody tr");
  assert.deepEqual([...priority.cells].map((cell) => cell.textContent), ["AU", "2375463", "27/07/2023"]);
  assert.deepEqual([...document.querySelectorAll(".goods-services tbody tr")].map((row) => [row.cells[0].textContent, row.cells[1].textContent]), [["18", "Vali và túi du lịch."], ["25", "Quần áo; đồ đi ở chân; đồ đội đầu."]]);
  assert.equal([...document.querySelectorAll(".structured-heading h3")].some((node) => node.textContent === "Vienna classification"), false);
  assert.match(document.getElementById("recordMedia").textContent, /S\.Kidman/);
  assert.doesNotMatch(document.getElementById("recordMedia").textContent, /image from the stored WIPO record/i);
  dom.window.close();
});

test("clear-all modal requires clear and each row has an individual remove action", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo, lastScrapedAt: new Date().toISOString() }] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  assert.equal(document.getElementById("removeButton"), null);
  assert.equal(document.querySelectorAll(".remove-row").length, 1);
  assert.equal(document.querySelector(".list-head > #clearAllButton"), document.getElementById("clearAllButton"));
  assert.ok(document.querySelector(".list-head > #refreshAllButton .icon-refresh"));
  assert.ok(document.querySelector(".list-head > #clearAllButton svg"));
  document.getElementById("clearAllButton").click();
  assert.equal(document.getElementById("clearAllModal").classList.contains("hidden"), false);
  assert.equal(document.getElementById("confirmClearAllButton").disabled, true);
  const input = document.getElementById("clearAllInput");
  input.value = "clear";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(document.getElementById("confirmClearAllButton").disabled, false);
  document.getElementById("confirmClearAllButton").click();
  assert.equal(document.querySelectorAll(".case-row").length, 0);
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("wipoTrackerQueue")), []);
  dom.window.close();
});

test("case list stays browser-local and typography preferences are saved client-side", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  let listCalls = 0;
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => { listCalls += 1; return { applications: [{ applicationNo: appNo }] }; },
    detail: async () => ({ detail: null }), onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  assert.equal(listCalls, 0);
  assert.equal(document.querySelectorAll(".case-row").length, 0);
  document.getElementById("typographySettingsButton").click();
  assert.equal(document.getElementById("typographyModal").classList.contains("hidden"), false);
  const interfaceFont = document.getElementById("interfaceFontSelect");
  const headerFont = document.getElementById("headerFontSelect");
  const contentFont = document.getElementById("contentFontSelect");
  interfaceFont.value = "arial";
  headerFont.value = "times";
  contentFont.value = "calibri";
  document.getElementById("interfaceFontSize").value = "15";
  document.getElementById("headerFontSize").value = "22";
  document.getElementById("contentFontSize").value = "14";
  contentFont.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const typography = JSON.parse(dom.window.localStorage.getItem("wipoTrackerTypography"));
  assert.deepEqual(typography, { interfaceFont: "arial", headerFont: "times", contentFont: "calibri", interfaceSize: 15, headerSize: 22, contentSize: 14 });
  assert.match(document.documentElement.style.getPropertyValue("--header-font"), /Times New Roman/);
  assert.match(document.documentElement.style.getPropertyValue("--content-font"), /Calibri/);
  assert.equal(document.getElementById("typographySettingsButton").getAttribute("aria-label"), "Settings");
  document.getElementById("registrationColumnMinimum").value = "100";
  document.getElementById("registrationColumnMinimum").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseColumnMinimums")).registration, 100);
  document.getElementById("clockColumnMinimum").value = "64";
  document.getElementById("clockColumnMinimum").dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseColumnMinimums")).clock, 64);
  document.getElementById("clockColumnHidden").checked = true;
  document.getElementById("clockColumnHidden").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  document.getElementById("appColumnSquishable").checked = false;
  document.getElementById("appColumnSquishable").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  const columnBehavior = JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseColumnBehavior"));
  assert.equal(columnBehavior.clock.hidden, true);
  assert.equal(columnBehavior.app.squishable, false);
  assert.equal(document.querySelector(".case-panel").classList.contains("hide-col-clock"), true);
  assert.equal(document.querySelector(".case-panel").classList.contains("no-squish-col-app"), true);
  assert.equal(document.querySelectorAll(".column-alignment-select").length, 28);
  const appHeaderAlignment = document.querySelector('[data-case-alignment-column="app"][data-case-alignment-target="header"]');
  const statusContentAlignment = document.querySelector('[data-case-alignment-column="status"][data-case-alignment-target="content"]');
  appHeaderAlignment.value = "right";
  appHeaderAlignment.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  statusContentAlignment.value = "center";
  statusContentAlignment.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  const columnAlignments = JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseColumnAlignments"));
  assert.equal(columnAlignments.app.header, "right");
  assert.equal(columnAlignments.status.content, "center");
  assert.equal(document.querySelector(".case-panel").style.getPropertyValue("--case-app-header-justify"), "flex-end");
  assert.equal(document.querySelector(".case-panel").style.getPropertyValue("--case-status-content-justify"), "center");
  document.getElementById("saveTypographyButton").click();
  assert.equal(document.getElementById("typographyModal").classList.contains("hidden"), true);
  dom.window.close();
});

test("case list supports persistent compact rows and a keyboard-accessible pane resizer", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo }] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  assert.equal(document.querySelector(".case-panel").classList.contains("compact-list"), false);
  assert.equal(document.getElementById("compactListButton").getAttribute("aria-pressed"), "false");
  assert.equal(document.querySelector("#compactListButton .list-density-label").textContent, "Default");
  for (const key of ["app", "registration", "reference", "date", "status"]) assert.equal(document.querySelector(".case-panel").classList.contains(`hide-col-${key}`), false);
  for (const key of ["attorney", "client", "applicant", "applicationtype", "wipostatus", "grant", "expiry", "representative", "clock"]) assert.equal(document.querySelector(".case-panel").classList.contains(`hide-col-${key}`), true);
  assert.match(document.querySelector("#compactListButton .list-density-icon").getAttribute("src"), /^eye\.png/);
  document.getElementById("compactListButton").click();
  assert.equal(document.querySelector(".case-panel").classList.contains("compact-list"), true);
  assert.equal(document.getElementById("compactListButton").getAttribute("aria-pressed"), "true");
  assert.equal(document.querySelector("#compactListButton .list-density-label").textContent, "Details");
  assert.match(document.getElementById("compactListButton").getAttribute("aria-label"), /Details view active/);
  for (const key of ["app", "registration", "reference", "attorney", "client", "applicant", "date", "clock", "status"]) assert.equal(document.querySelector(".case-panel").classList.contains(`hide-col-${key}`), false);
  assert.equal(dom.window.localStorage.getItem("wipoTrackerCompactList"), "1");
  const resizer = document.getElementById("workspaceResizer");
  resizer.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(dom.window.localStorage.getItem("wipoTrackerCasePaneWidth"), "680");
  assert.equal(document.documentElement.style.getPropertyValue("--case-pane-width"), "680px");
  assert.equal(resizer.getAttribute("aria-valuemin"), "680");
  assert.equal(document.getElementById("appColumnSquishable").checked, false);
  assert.equal(document.getElementById("clockColumnSquishable").checked, true);
  assert.equal(document.documentElement.style.getPropertyValue("--case-app-width"), "70px");
  assert.equal(document.documentElement.style.getPropertyValue("--case-registration-width"), "90px");
  assert.equal(document.documentElement.style.getPropertyValue("--case-clock-width"), "0px");
  assert.equal(document.querySelector(".case-panel").classList.contains("squished-col-clock"), true);
  assert.equal(document.querySelector('[data-case-column="clock"]').tabIndex, -1);
  const clockResizer = document.querySelector('[data-case-column="clock"]');
  for (let index = 0; index < 20; index += 1) clockResizer.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  assert.equal(document.getElementById("clockColumnMinimum").value, "44");
  assert.equal(JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseColumnMinimums")).clock, 44);
  const appResizer = document.querySelector('[data-case-column="app"]');
  for (let index = 0; index < 20; index += 1) appResizer.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  assert.equal(document.getElementById("appColumnMinimum").value, "44");
  assert.equal(JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseColumnMinimums")).app, 44);
  const casePanel = document.querySelector(".case-panel");
  const workspace = document.querySelector(".workspace");
  casePanel.getBoundingClientRect = () => ({ width: Number.parseFloat(document.documentElement.style.getPropertyValue("--case-pane-width")) || 400 });
  workspace.getBoundingClientRect = () => ({ width: 1200 });
  appResizer.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
  appResizer.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 110 }));
  appResizer.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true, clientX: 110 }));
  assert.equal(document.getElementById("appColumnMinimum").value, "54");
  assert.equal(JSON.parse(dom.window.localStorage.getItem("wipoTrackerCaseColumnMinimums")).app, 54);
  assert.equal(document.documentElement.style.getPropertyValue("--case-pane-width"), "664px");
  const configuredSizes = Object.fromEntries(["app", "registration", "reference", "attorney", "client", "applicant", "applicationtype", "wipostatus", "grant", "expiry", "representative", "date", "clock", "status"].map((key) => [key, document.getElementById(`${key}ColumnMinimum`)?.value]));
  resizer.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(document.documentElement.style.getPropertyValue("--case-pane-width"), "684px");
  assert.deepEqual(Object.fromEntries(Object.keys(configuredSizes).map((key) => [key, document.getElementById(`${key}ColumnMinimum`)?.value])), configuredSizes);
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.list-head, \.case-row \{[^}]*--case-select-track: 0px;[^}]*--case-clock-effective-width: calc\(var\(--case-clock-width\) \* var\(--interface-scale\)\);[^}]*grid-template-columns: var\(--case-select-track\) var\(--case-app-track\)[^}]*var\(--case-status-track\) calc\(28px \* var\(--interface-scale\)\) calc\(28px \* var\(--interface-scale\)\) calc\(8px \* var\(--interface-scale\)\);[^}]*column-gap: 2px;/);
  assert.match(css, /\.list-head\.select-mode, \.case-row\.select-mode \{ --case-select-track: calc\(28px \* var\(--interface-scale\)\); \}/);
  const rendererSource = fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8");
  assert.doesNotMatch(rendererSource, /caseColumnPreferredWidths/);
  assert.match(rendererSource, /const visible = CASE_LAYOUT_COLUMNS\.filter\(\(key\) => !isColumnHidden\(key\)\);/);
  assert.match(rendererSource, /const extraPerColumn = \(capacity - baseTotal\) \/ visible\.length;/);
  assert.match(rendererSource, /return isColumnSquishable\(key\) \? 0 : columnMinimum\(key\);/);
  assert.match(rendererSource, /boundedValue <= 1 \? 0 : boundedValue/);
  assert.match(css, /\.case-panel\.squished-col-app \.case-app/);
  assert.match(css, /\.case-panel\.squished-col-clock \.case-scraped-clock/);
  assert.match(rendererSource, /Object\.keys\(CASE_COLUMNS\)\.map\(\(column\) => \[column, Math\.round\(columnMinimum\(column\)\)\]\)/);
  assert.match(css, /\.workspace \{[^}]*grid-template-columns: minmax\(400px, var\(--case-pane-width\)\)/);
  assert.doesNotMatch(css, /\.list-head \.case-time-head \{ display: none; \}/);
  assert.equal(document.querySelector(".case-actions-spacer"), null);
  assert.match(document.getElementById("columnSettingsTitle").nextElementSibling.textContent, /fixed column size/);
  document.getElementById("resetTypographyButton").click();
  assert.equal(document.querySelector(".case-panel").classList.contains("compact-list"), false);
  assert.equal(document.getElementById("compactListButton").getAttribute("aria-pressed"), "false");
  assert.equal(document.querySelector("#compactListButton .list-density-label").textContent, "Default");
  assert.equal(dom.window.localStorage.getItem("wipoTrackerCompactList"), "0");
  dom.window.close();
});

test("case columns use tight persisted widths and expose header dividers", () => {
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8");
  assert.match(css, /\.case-list \{[^}]*scrollbar-gutter: auto;/, "short lists must not reserve an empty scrollbar strip beside the row background");
  assert.match(renderer, /function syncListHeaderGutter\(\) \{[\s\S]*?els\.list\.offsetWidth - els\.list\.clientWidth/, "a real scrollbar must still be measured for header alignment");
  assert.match(css, /--case-registration-width: 100px;/);
  assert.match(css, /--case-reference-width: 74px;/);
  assert.match(css, /\.list-head, \.case-row \{[^}]*grid-template-columns: var\(--case-select-track\) var\(--case-app-track\) var\(--case-registration-track\) var\(--case-reference-track\)/);
  assert.match(css, /\.list-head\.select-mode, \.case-row\.select-mode \{ --case-select-track: calc\(28px \* var\(--interface-scale\)\); \}/);
  assert.equal((html.match(/class="case-column-resizer"/g) || []).length, 14);
  assert.match(html, /data-case-column="app"/);
  assert.match(html, /data-case-column="registration"/);
  assert.match(html, /data-case-column="reference"/);
  assert.match(html, /id="clockColumnHidden"/);
  assert.match(html, /id="clockColumnSquishable"[^>]*checked/);
  assert.match(css, /\.case-panel\.hide-col-clock \.list-head/);
  assert.match(css, /\.case-panel\.hide-col-clock \.case-scraped-clock[^}]*padding-left: 0;/);
  assert.match(renderer, /const CASE_GRID_CHROME_PX = 46;/, "the width budget must include all grid gaps and side padding");
  assert.match(renderer, /paneWidth - CASE_GRID_CHROME_PX - scrollbarWidth/, "row columns must fit within the visible case-list width");
  assert.match(css, /\.case-app-head \{[^}]*--case-app-header-justify/);
  assert.match(css, /\.case-status-cell \{[^}]*--case-status-content-justify/);
  assert.match(css, /calc\(8px \* var\(--interface-scale\)\); align-items: center;/);
  assert.match(css, /\.remove-row \{[^}]*display: grid;[^}]*place-items: center;/);
  assert.match(css, /\.remove-row > span \{[^}]*text-align: center;/);
});

test('older stored trademark snapshots display dated former and undated current owners separately', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8').replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const number = '4-2010-11279';
  const raw = 'Ca Da(VN) : Đắk Lắk 27/03/2018 Nutifood : Hồ Chí Minh';
  const snapshot = { id: 1, scrapedAt: '2026-10-16T11:21:58.210Z', changes: [], data: {
    id: number, type: 'TRADEMARKS', fields: { '(730) Chủ đơn/Chủ bằng': raw },
    applicants_ordered: [{ applicant_name: 'Ca Da(VN)', applicant_address: 'Đắk Lắk 27/03/2018 Nutifood : Hồ Chí Minh' }],
    split_fields: {}, diary: [],
  } };
  dom.window.localStorage.setItem('wipoTrackerQueue', JSON.stringify([number]));
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [{ index: 1, name: 'Fast' }] }),
    list: async () => ({ applications: [{ applicationNo: number, lastScrapedAt: snapshot.scrapedAt }] }),
    detail: async () => ({ detail: { applicationNo: number, latest: snapshot, snapshots: [snapshot] } }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, '..', 'electron-app', 'wipo_applicant_history.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 25));
  dom.window.document.querySelector('.case-row').click();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const sections = [...dom.window.document.querySelectorAll('.structured-section')];
  const current = sections.find((section) => section.querySelector('h3')?.textContent === 'Owners / Applicants');
  const earlier = sections.find((section) => section.querySelector('h3')?.textContent === 'Earlier owners / applicants');
  assert.deepEqual([...current.querySelector('tbody tr').cells].slice(0, 2).map((cell) => cell.textContent), ['Nutifood', 'Hồ Chí Minh']);
  assert.deepEqual([...earlier.querySelector('tbody tr').cells].slice(0, 3).map((cell) => cell.textContent), ['Ca Da(VN)', 'Đắk Lắk', '27/03/2018']);
  dom.window.close();
});

test("Export list opens saved output choices and exports the complete browser-local case list", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const secondApp = "1-2022-01097";
  const exportCalls = [];
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo, secondApp]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {},
    exportExcel: async () => ({}), exportBatch: async (payload) => { exportCalls.push(payload); return { ok: true, count: 1 }; },
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.document.getElementById("exportListButton").click();
  assert.equal(dom.window.document.getElementById("exportModal").classList.contains("hidden"), false);
  assert.equal(dom.window.document.querySelector('[data-export-toggle="excel"]').getAttribute("aria-pressed"), "true");
  const columnChoices = dom.window.document.querySelectorAll('[data-excel-column]');
  assert.ok(columnChoices.length > 30);
  const currentOnly = dom.window.document.getElementById('excelCurrentApplicantsOnly');
  assert.equal(currentOnly.checked, true);
  assert.equal(dom.window.document.querySelector('[data-excel-column="previousApplicantName"]').disabled, true);
  currentOnly.checked = false;
  currentOnly.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const imageColumn = dom.window.document.querySelector('[data-excel-column="image"]');
  imageColumn.checked = false;
  imageColumn.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.getElementById("runBatchExportButton").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(Array.from(exportCalls[0].applicationNos), [appNo, secondApp]);
  assert.equal(exportCalls[0].outputs.excel, true);
  assert.equal(exportCalls[0].sorts.excel, "application");
  assert.equal(exportCalls[0].excelColumns.currentApplicantsOnly, false);
  assert.equal(exportCalls[0].excelColumns.columns.includes('image'), false);
  assert.equal(exportCalls[0].excelColumns.columns.includes('previousApplicantName'), true);
  assert.equal(dom.window.document.getElementById("exportListButton").textContent, "Export list");
  dom.window.close();
});

test('Export list remains available for request-only lists and sends request-specific outputs', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8').replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const requestNo = 'GH4-2025-09186';
  const calls = [];
  dom.window.localStorage.setItem('wipoTrackerNamedLists', JSON.stringify({ activeId: 'default', lists: [
    { id: 'default', name: 'Requests', queue: [], requestQueue: [requestNo] },
  ] }));
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [{ index: 1, name: 'Fast' }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {},
    lookupRequestPublications: async () => ({ results: [] }),
    exportBatch: async payload => { calls.push(payload); return { ok: true, count: 2 }; },
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 30));
  const document = dom.window.document;
  const button = document.getElementById('exportListButton');
  assert.equal(button.disabled, false);
  button.click();
  assert.equal(document.querySelector('.request-export-option').classList.contains('hidden'), false);
  assert.equal(document.querySelector('.application-export-option').classList.contains('hidden'), true);
  document.getElementById('runBatchExportButton').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.length, 1);
  assert.deepEqual(Array.from(calls[0].requestNos), [requestNo]);
  assert.deepEqual(Array.from(calls[0].applicationNos), []);
  assert.equal(calls[0].outputs.requestExcel, true);
  assert.equal(calls[0].outputs.requestPdf, true);
  assert.equal(calls[0].outputs.excel, false);
  dom.window.close();
});

test('Hague DM numbers from either input remain separate from the Vietnam scrape queue', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8').replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const calls = [];
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [] }), list: async ids => { calls.push(['list', ids]); return { applications: [] }; },
    queueDispatchInterval: 15,
    detail: async () => ({ detail: null }), onProgress: () => {}, scrape: async () => { throw new Error('DM must not scrape'); },
    stop: () => {}, hagueDesign: async number => { calls.push(['hague', number]); return { ok: true, number, status: 'Granted', url: 'https://designdb.wipo.int/designdb/en/showData.jsp?ID=HAGUE.D213380',
      fields: [{ code: '11', label: 'International Registration Number', value: number }], events: [{ id: '970272755_STATEMENT', kind: 'Granted', bulletinNo: '03/2025', bulletinDate: '17/01/2025', fields: [], pdfUrl: 'https://www.wipo.int/idpub/example.pdf', pdfAvailable: true, url: '/test/hague.pdf' }] }; },
    saveHaguePdf: async (number, eventId) => { calls.push(['save', number, eventId]); return { ok: true }; },
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById('applicationInput').value = 'DM/213 380\nDM213380';
  document.getElementById('addButton').click();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(document.querySelectorAll('.case-row[data-hague]').length, 1);
  assert.equal(calls.some(([kind]) => kind === 'hague'), false);
  assert.match(document.getElementById('hagueDetailBody').textContent, /Not scraped yet/);
  document.querySelector('.case-row[data-hague]').click();
  assert.equal(calls.some(([kind]) => kind === 'hague'), false);
  document.querySelector('.case-row[data-hague] .scrape-row').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(calls.find(([kind]) => kind === 'hague'), ['hague', 'DM/213380']);
  assert.match(document.getElementById('hagueDetailBody').textContent, /Granted/);
  document.querySelector('[data-hague-preview]').click();
  assert.equal(document.querySelector('.hague-pdf-preview').getAttribute('src'), '/test/hague.pdf');
  document.querySelector('[data-hague-save]').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(calls.find(([kind]) => kind === 'save'), ['save', 'DM/213380', '970272755_STATEMENT']);
  document.getElementById('registrationInput').value = 'DM/ 252407';
  document.getElementById('registrationInput').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  document.getElementById('addRegistrationButton').click();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(document.querySelectorAll('.case-row[data-hague]').length, 2);
  assert.equal(calls.filter(([kind]) => kind === 'hague').length, 1);
  document.getElementById('scrapeAllButton').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(calls.filter(([kind]) => kind === 'hague'), [['hague', 'DM/213380'], ['hague', 'DM/252407']]);
  assert.equal(document.getElementById('registrationTypeSelect').value, 'design');
  assert.equal(calls.some(([kind]) => kind === 'list'), false);
  const saved = JSON.parse(dom.window.localStorage.getItem('wipoTrackerNamedLists'));
  assert.deepEqual(Array.from(saved.lists[0].hagueQueue), ['DM/213380', 'DM/252407']);
  dom.window.close();
});

test('Hague VN decisions appear first as colored expandable PDF records', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8').replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  let resolveHistory;
  let lookupCount = 0;
  const delayedHistory = new Promise(resolve => { resolveHistory = resolve; });
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [] }), list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
    hagueDetail: async () => delayedHistory,
    hagueDesign: async number => ({ ok: true, number, status: 'Granted', url: 'https://designdb.wipo.int/', fields: [{ code: '15', label: 'Registration date', value: '01/01/2021' }], holders: [], representatives: [], creators: [], lookupCount: ++lookupCount, events: [
      { id: 'refusal', kind: 'Refusal', bulletinNo: '41/2021', bulletinDate: '15/10/2021', fields: [{ code: '24', label: 'Effect date', value: '01/10/2021' }], pdfData: { refusalGrounds: 'Original refusal grounds' }, pdfAvailable: true, url: '/test/refusal.pdf' },
      { id: 'grant', kind: 'Granted', bulletinNo: '03/2025', bulletinDate: '17/01/2025', fields: [], pdfData: { decisionNo: '45905/QĐ-SHTT.IP', decisionDate: '19/04/2024' }, pdfAvailable: true, url: '/test/grant.pdf' },
    ] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById('applicationInput').value = 'DM/213380';
  document.getElementById('addButton').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  document.querySelector('[data-hague-scrape]').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  const body = document.getElementById('hagueDetailBody');
  const cards = [...body.querySelectorAll('.hague-event')];
  assert.equal(cards.length, 2);
  assert.equal(cards[0].classList.contains('granted'), true);
  assert.equal(cards[1].classList.contains('refusal'), true);
  assert.ok(body.innerHTML.indexOf('hague-event granted') < body.innerHTML.indexOf('International registration</h3>'));
  assert.equal(cards[0].querySelector('.hague-event-body').classList.contains('hidden'), true);
  cards[0].querySelector('[data-hague-toggle]').click();
  assert.equal(cards[0].querySelector('.hague-event-body').classList.contains('hidden'), false);
  assert.match(cards[0].textContent, /45905\/QĐ-SHTT\.IP/);
  cards[1].querySelector('[data-hague-preview]').click();
  assert.equal(cards[1].querySelector('.hague-event-body').classList.contains('hidden'), false);
  const previewFrame = cards[1].querySelector('.hague-pdf-preview');
  assert.equal(previewFrame.getAttribute('src'), '/test/refusal.pdf');
  resolveHistory({ ok: true, detail: { snapshots: [{ id: 1, scrapedAt: '2026-10-07T02:00:00.000Z', data: {
    ok: true, number: 'DM/213380', status: 'Granted', url: 'https://designdb.wipo.int/', fields: [{ code: '15', label: 'Registration date', value: '01/01/2021' }], holders: [], representatives: [], creators: [], events: [
      { id: 'refusal', kind: 'Refusal', bulletinNo: '41/2021', bulletinDate: '15/10/2021', fields: [{ code: '24', label: 'Effect date', value: '01/10/2021' }], pdfData: { refusalGrounds: 'Original refusal grounds' }, pdfAvailable: true, url: '/test/refusal.pdf' },
      { id: 'grant', kind: 'Granted', bulletinNo: '03/2025', bulletinDate: '17/01/2025', fields: [], pdfData: { decisionNo: '45905/QĐ-SHTT.IP', decisionDate: '19/04/2024' }, pdfAvailable: true, url: '/test/grant.pdf' },
    ] }, changes: [{ field: 'status', oldValue: 'Refusal', newValue: 'Granted' }] }] } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(body.querySelector('[data-hague-event="refusal"] .hague-pdf-preview'), previewFrame);
  assert.equal(body.querySelector('[data-hague-event="refusal"] .hague-event-body').classList.contains('hidden'), false);
  document.getElementById('hagueRefreshButton').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(body.querySelector('[data-hague-event="refusal"] .hague-pdf-preview'), previewFrame);
  assert.equal(body.querySelector('[data-hague-event="refusal"] [data-hague-preview]').textContent, 'Hide PDF');
  body.querySelector('[data-hague-event="refusal"] [data-hague-preview]').click();
  assert.equal(body.querySelector('[data-hague-event="refusal"] .hague-pdf-preview'), null);
  dom.window.close();
});

test('an outdated LAN host explains why Hague rows cannot restore instead of calling them not scraped', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8').replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.localStorage.setItem('wipoTrackerNamedLists', JSON.stringify({ activeId: 'default', lists: [
    { id: 'default', name: 'Saved Hague', queue: [], hagueQueue: ['DM/213380'] },
  ] }));
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [] }), list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
    hagueList: async () => { throw new Error('HTTP 404: Not Found'); }, hagueDesign: async () => { throw new Error('An outdated host must not start another lookup'); },
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 30));
  const document = dom.window.document;
  assert.match(document.querySelector('.case-row[data-hague] .case-status-cell').textContent, /Host restart needed/);
  assert.doesNotMatch(document.querySelector('.case-row[data-hague] .case-status-cell').textContent, /Not scraped/);
  document.querySelector('.case-row[data-hague]').click();
  assert.match(document.getElementById('hagueDetailBody').textContent, /Refreshing this page alone is not enough/);
  dom.window.close();
});

test('saved Hague refusals show VN application numbers and export through Hague-only Excel', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8').replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const exports = [];
  const pdfReports = [];
  dom.window.fetch = async () => ({ ok: true, text: async () => 'body.printing-hague-report .hague-event-body{display:block!important}' });
  dom.window.localStorage.setItem('wipoTrackerNamedLists', JSON.stringify({ activeId: 'default', lists: [
    { id: 'default', name: 'Hague', queue: [], hagueQueue: ['DM/225862'] },
  ] }));
  const record = { ok: true, number: 'DM/225862', status: 'Refusal', url: 'https://designdb.wipo.int/', registrationDate: '29/08/2022', filingDate: '29/08/2022', expirationDate: '29/08/2027', numberOfDesigns: '2', fields: [
    { code: '51', label: 'Locarno classification', value: '1. Cl. 27-07\n2. Cl. 27-07', items: ['1. Cl. 27-07', '2. Cl. 27-07'] },
    { code: '54', label: 'Products', value: '1. Electronic device\n2. Electronic device', items: ['1. Electronic device', '2. Electronic device'] },
    { code: '57', label: 'Description', value: `1. ${'Detailed design description. '.repeat(14)}\n2. Short description`, items: [`1. ${'Detailed design description. '.repeat(14)}`, '2. Short description'] },
    { code: '82', label: 'Statements', value: 'III. US: US statement\nIII. VN: VN statement', items: ['III. US: US statement', 'III. VN: VN statement'] },
    { code: '81', label: 'Designated parties', value: 'US\n1999\nVN\n1999', items: [] },
    { code: '72', label: 'Creators', value: '1. Michael\nBest\n12 Deerhunt Close (GB)\nJane\nDoe\n45 Brook Street (GB)\n2. Michael\nBest\n12 Deerhunt Close (GB)\nJane\nDoe\n45 Brook Street (GB)', items: ['1. Michael\nBest\n12 Deerhunt Close (GB)\nJane\nDoe\n45 Brook Street (GB)', '2. Michael\nBest\n12 Deerhunt Close (GB)\nJane\nDoe\n45 Brook Street (GB)'] },
  ], holders: [], representatives: [], creators: [{ designNo: '1', name: 'Michael', address: 'Best\n12 Deerhunt Close' }], events: [
    { id: 'refusal', kind: 'Refusal', bulletinNo: '29/2023', bulletinDate: '21/07/2023', pdfData: { vnApplicationNos: ['8-2023-00004'] }, pdfAvailable: true, url: '/test/refusal.pdf' },
  ] };
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [] }), list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
    hagueList: async () => ({ ok: true, registrations: [{ number: record.number, snapshotId: 1, lastScrapedAt: '2026-10-08T01:00:00Z', data: record }] }),
    hagueDetail: async () => ({ ok: true, detail: { snapshots: [{ id: 1, scrapedAt: '2026-10-08T01:00:00Z', data: record, changes: [] }] } }),
    internationalPublications: async identifier => ({ ok: true, identifier, records: [
      { record_kind: 'hague_registration', international_registration_no: identifier, data: {} },
      { record_kind: 'hague_renewal', international_registration_no: identifier,
        data: { renewal_event: { kind: 'Partial renewal', fields: [{ code: '15', label: 'Renewal date', value: '29/08/2027' }] } } },
    ] }),
    exportBatch: async payload => { exports.push(payload); return { ok: true, count: 1 }; },
    downloadHaguePdf: async (number, html) => { pdfReports.push({ number, html }); return { ok: true }; },
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 60));
  const document = dom.window.document;
  const row = document.querySelector('.case-row[data-hague="DM/225862"]');
  assert.equal(row.querySelector('.case-registration').textContent, '8-2023-00004');
  assert.match(row.querySelector('.case-registration').title, /VN application no. from refusal PDF/);
  assert.equal(document.getElementById('exportListButton').disabled, false);
  row.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(document.getElementById('haguePrintButton').disabled, false);
  assert.equal(document.getElementById('hagueDownloadButton').disabled, false);
  assert.match(document.getElementById('hagueDetailBody').textContent, /8-2023-00004/);
  assert.match(document.getElementById('hagueDetailBody').textContent, /Publication database · 2 records/);
  assert.match(document.getElementById('hagueDetailBody').textContent, /Partial renewal/);
  const detailBody = document.getElementById('hagueDetailBody');
  assert.equal(detailBody.querySelectorAll('.hague-design-card').length, 2);
  assert.equal(detailBody.querySelectorAll('.hague-design-product').length, 2);
  assert.equal(detailBody.querySelectorAll('.hague-design-description').length, 2);
  assert.equal(detailBody.querySelector('details.hague-design-description').open, false);
  assert.equal(detailBody.querySelectorAll('.hague-statement').length, 2);
  assert.equal(detailBody.querySelectorAll('.hague-party').length, 3);
  assert.match(detailBody.querySelector('.hague-people-table tbody td:nth-child(2)').textContent, /Michael Best/);
  assert.equal(detailBody.querySelectorAll('.hague-people-table tbody tr').length, 2);
  assert.equal(detailBody.querySelector('.hague-people-table tbody td:first-child').textContent, '1, 2');
  assert.match(detailBody.querySelector('.hague-people-table').textContent, /Jane Doe/);
  document.getElementById('hagueDownloadButton').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(pdfReports[0].number, 'DM/225862');
  assert.match(pdfReports[0].html, /printing-hague-report/);
  assert.match(pdfReports[0].html, /8-2023-00004/);
  assert.equal(new JSDOM(pdfReports[0].html).window.document.querySelector('details.hague-design-description').open, true);
  assert.equal(detailBody.querySelector('details.hague-design-description').open, false);
  document.getElementById('exportListButton').click();
  assert.equal(document.querySelector('.hague-export-option').classList.contains('hidden'), false);
  document.getElementById('runBatchExportButton').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(exports.length, 1);
  assert.equal(exports[0].outputs.hagueExcel, true);
  assert.deepEqual(Array.from(exports[0].hagueNos), ['DM/225862']);
  document.getElementById('exportListButton').click();
  document.querySelector('[data-export-toggle="hagueExcel"]').click();
  document.querySelector('[data-export-toggle="hagueRefusals"]').click();
  document.getElementById('combineHagueRefusals').click();
  document.getElementById('runBatchExportButton').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(exports[1].outputs.hagueExcel, false);
  assert.equal(exports[1].outputs.hagueRefusals, true);
  assert.equal(exports[1].combineHagueRefusals, true);
  assert.deepEqual(Array.from(exports[1].orders.hagueRefusals), ['DM/225862']);
  dom.window.close();
});

test('Hague rows restore saved SQL snapshots after browser refresh and show change history', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8').replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const calls = [];
  const older = { ok: true, number: 'DM/213380', status: 'Refusal', url: 'https://designdb.wipo.int/', fields: [], holders: [], representatives: [], creators: [], events: [] };
  const latest = { ...older, status: 'Granted' };
  const snapshots = [
    { id: 2, scrapedAt: '2026-10-07T02:00:00.000Z', data: latest, changes: [{ field: 'status', oldValue: 'Refusal', newValue: 'Granted' }], previousSnapshotId: 1 },
    { id: 1, scrapedAt: '2026-10-06T02:00:00.000Z', data: older, changes: [], previousSnapshotId: null },
  ];
  dom.window.localStorage.setItem('wipoTrackerNamedLists', JSON.stringify({ activeId: 'default', lists: [{ id: 'default', name: 'Saved Hague', queue: [], hagueQueue: ['DM/213380'] }] }));
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [] }), list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
    hagueDesign: async () => { calls.push('wipo'); throw new Error('Reload must use SQL'); },
    hagueList: async numbers => { calls.push(['list', numbers]); return { ok: true, registrations: [{ number: 'DM/213380', snapshotId: 2, lastScrapedAt: snapshots[0].scrapedAt, changeCount: 1, scrapeCount: 2, data: latest }] }; },
    hagueDetail: async number => { calls.push(['detail', number]); return { ok: true, detail: { registrationNo: number, latest: snapshots[0], snapshots } }; },
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 80));
  const document = dom.window.document;
  const row = document.querySelector('[data-hague="DM/213380"]');
  assert.match(row.textContent, /Granted/);
  assert.match(row.textContent, /07\/10\/2026/);
  assert.equal(calls.includes('wipo'), false);
  row.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(document.querySelectorAll('#hagueSnapshotSelect option').length, 2);
  assert.match(document.getElementById('hagueChangeSummary').textContent, /1 change/);
  document.getElementById('hagueSnapshotSelect').value = '1';
  document.getElementById('hagueSnapshotSelect').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.match(document.getElementById('hagueDetailStatus').textContent, /Refusal · historical snapshot/);
  document.getElementById('hagueChangeSummary').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(document.getElementById('changeHistoryTitle').textContent, /DM\/213380 change history/);
  assert.equal(document.querySelectorAll('#changeTimelineList button').length, 2);
  document.querySelector('#changeTimelineList button').click();
  assert.match(document.getElementById('changeComparisonBody').textContent, /Refusal/);
  assert.match(document.getElementById('changeComparisonBody').textContent, /Granted/);
  dom.window.close();
});

test('Load all DM starts five Hague lookups with paced dispatch and leaves the rest queued', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8').replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const started = [];
  const finish = [];
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [] }), list: async () => ({ applications: [] }), detail: async () => ({ detail: null }),
    onProgress: () => {}, stop: () => {}, queueConcurrency: 5, queueDispatchInterval: 15,
    hagueDesign: number => { started.push(number); return new Promise(resolve => finish.push(() => resolve({ ok: true, number, status: 'Granted', fields: [], events: [] }))); },
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById('applicationInput').value = 'DM/213380\nDM/213381\nDM/213382\nDM/213383\nDM/213384\nDM/213385';
  document.getElementById('addButton').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(started.length, 0);
  document.getElementById('hagueFetchAllButton').click();
  try {
    for (let i = 0; i < 40 && started.length < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(started.length, 5);
    assert.match(document.querySelector('[data-hague="DM/213385"] .case-status-cell').textContent, /Queued 1/);
    assert.equal(document.querySelectorAll('.scrape-row.is-scraping').length, 5);
    finish[0]();
    for (let i = 0; i < 40 && started.length < 6; i += 1) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(started.length, 6);
    finish.forEach(done => done());
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(document.getElementById('hagueFetchAllButton').disabled, false);
  } finally {
    finish.forEach(done => done());
    dom.window.close();
  }
});

test("Scrape all and Re-scrape both skip records already scraped today", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const secondApp = "1-2022-01097";
  const scrapeCalls = [];
  const retryCalls = [];
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo, secondApp]));
  dom.window.localStorage.setItem("wipoTrackerScrapeCap", "7");
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo, lastScrapedAt: new Date().toISOString() }] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, chooseList: async () => ({}),
    scrape: async (ids, _presetIndex, retryCount) => { scrapeCalls.push([...ids]); retryCalls.push(retryCount); return { ok: true, imported: [], missing: [] }; },
    stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.getElementById("scrapeAllButton").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(scrapeCalls[0], [secondApp]);
  const checkbox = document.getElementById("rescrapeCheckbox");
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  document.getElementById("refreshAllButton").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(scrapeCalls.slice(1), [[secondApp]]);
  assert.deepEqual(retryCalls, [7, 7]);
  assert.equal(document.getElementById("retryCountInput").value, "7");
  assert.equal(dom.window.localStorage.getItem("wipoTrackerRescrape"), "1");
  dom.window.close();
});

test('scrape preset and per-record cap live in Settings with 25 attempts by default', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8')
    .replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { document } = dom.window;
  assert.equal(document.querySelector('.topbar-actions #presetSelect'), null);
  assert.equal(document.querySelector('.topbar-actions #retryCountInput'), null);
  assert.ok(document.querySelector('#typographyModal #presetSelect'));
  assert.ok(document.querySelector('#typographyModal #retryCountInput'));
  dom.window.wipoTracker = {
    init: async () => ({ database: 'test.sqlite', presets: [{ index: 1, name: 'Fast' }, { index: 2, name: 'Balanced' }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(document.getElementById('retryCountInput').value, '25');
  document.getElementById('typographySettingsButton').click();
  assert.equal(document.getElementById('typographyModal').classList.contains('hidden'), false);
  const preset = document.getElementById('presetSelect');
  preset.value = '2';
  preset.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(dom.window.localStorage.getItem('wipoTrackerPresetIndex'), '2');
  dom.window.close();
});

test('standalone desktop keeps its legacy retry setting separate from the LAN scrape cap', async () => {
  const html = fs.readFileSync(path.join(root, 'electron', 'renderer', 'index.html'), 'utf8')
    .replace(/<script[^>]+><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
  dom.window.localStorage.setItem('wipoTrackerScrapeCap', '25');
  dom.window.localStorage.setItem('wipoTrackerRetryCount', '7');
  dom.window.wipoTracker = {
    scrapeCapMode: false,
    init: async () => ({ database: 'test.sqlite', presets: [{ index: 1, name: 'Fast' }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {}, stop: () => {},
  };
  dom.window.eval(fs.readFileSync(path.join(root, 'electron', 'renderer', 'renderer.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 30));
  const input = dom.window.document.getElementById('retryCountInput');
  assert.equal(input.value, '7');
  assert.equal(input.max, '50');
  assert.equal(input.closest('label').querySelector('span').textContent, 'Legacy retries per record');
  assert.equal(dom.window.localStorage.getItem('wipoTrackerScrapeCap'), '25');
  dom.window.close();
});

test("bulk Re-scrape starts non-today records immediately and confirms today records on click three", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const calls = [];
  const finishes = [];
  const oldApp = appNo;
  const todayApp = "1-2022-01097";
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([oldApp, todayApp]));
  dom.window.localStorage.setItem("wipoTrackerRescrape", "1");
  dom.window.wipoTracker = {
    queueConcurrency: 1,
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [
      { applicationNo: oldApp, lastScrapedAt: yesterday.toISOString() },
      { applicationNo: todayApp, lastScrapedAt: new Date().toISOString() },
    ] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, chooseList: async () => ({}),
    scrape: async (ids) => { calls.push([...ids]); return new Promise((resolve) => finishes.push(() => resolve({ ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] }))); },
    stop: async () => ({ ok: true }), exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  const bulkButton = document.getElementById("scrapeAllButton");
  bulkButton.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, [[oldApp]]);
  assert.equal(document.querySelector(`[data-app="${oldApp}"] .scrape-request-count`), null);
  assert.equal(document.querySelector(`[data-app="${todayApp}"] .scrape-request-count`).textContent, "1");
  bulkButton.click();
  assert.equal(document.querySelector(`[data-app="${todayApp}"] .scrape-request-count`).textContent, "2");
  bulkButton.click();
  assert.equal(document.querySelector(`[data-app="${todayApp}"] .scrape-request-count`).textContent, "3");
  assert.equal(document.getElementById("scrapeAllCount").textContent, "3");
  assert.deepEqual(calls, [[oldApp]]);

  finishes.shift()();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(calls, [[oldApp], [todayApp]]);
  finishes.shift()();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(document.getElementById("scrapeAllCount").classList.contains("hidden"), true);
  assert.equal(document.getElementById("refreshAllCount").classList.contains("hidden"), true);
  dom.window.close();
});

test("a completed scrape record refreshes its case row before the batch finishes", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  let progressHandler;
  let stored = false;
  let finishScrape;
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: stored ? [{ applicationNo: appNo, lastScrapedAt: new Date().toISOString() }] : [] }),
    detail: async () => ({ detail: null }),
    onProgress: (handler) => { progressHandler = handler; }, chooseList: async () => ({}),
    scrape: async () => new Promise((resolve) => { finishScrape = () => resolve({ ok: true, imported: [{ applicationNo: appNo }], missing: [] }); }),
    stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.document.getElementById("scrapeAllButton").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  let retryButton = dom.window.document.querySelector(".scrape-row");
  assert.equal(retryButton.classList.contains("is-scraping"), true);
  assert.equal(retryButton.getAttribute("aria-busy"), "true");
  assert.ok(retryButton.querySelector(".scrape-row-icon"));
  assert.equal(dom.window.document.querySelector(".case-status-cell .age").textContent, "Scrape 1/25");
  const completedAt = new Date().toISOString();
  progressHandler({ type: "record", applicationNo: appNo, imported: { applicationNo: appNo, scrapedAt: completedAt, changes: [] }, message: `Stored ${appNo}` });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const row = dom.window.document.querySelector(".case-row");
  assert.equal(row.classList.contains("scrape-today"), true);
  assert.equal(row.querySelector(".scrape-row").classList.contains("is-scraping"), true);
  stored = true;
  assert.match(row.querySelector(".case-scraped-date").textContent, /^\d{2}\/\d{2}\/\d{4}$/);
  finishScrape();
  await new Promise((resolve) => setTimeout(resolve, 30));
  retryButton = dom.window.document.querySelector(".scrape-row");
  assert.equal(retryButton.classList.contains("is-scraping"), false);
  assert.equal(retryButton.getAttribute("aria-busy"), "false");
  assert.equal(dom.window.document.querySelector(".case-status-cell .age").textContent, "today");
  dom.window.close();
});

test("row scrape buttons accept consecutive clicks and show later records as queued", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const secondApp = "1-2022-01097";
  const calls = [];
  const finishes = [];
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo, secondApp]));
  dom.window.wipoTracker = {
    queueConcurrency: 1,
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrape: async (ids) => { calls.push([...ids]); return new Promise((resolve) => finishes.push(() => resolve({ ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] }))); },
    stop: async () => ({ ok: true }), exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const buttons = dom.window.document.querySelectorAll(".scrape-row");
  buttons[0].click();
  buttons[1].click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, [[appNo]]);
  assert.equal(dom.window.document.querySelector(`[data-app="${secondApp}"] .scrape-row`).classList.contains("is-queued"), true);
  assert.equal(dom.window.document.querySelector(`[data-app="${secondApp}"] .case-status-cell .age`).textContent, "Queue #1 1/25");
  assert.equal(dom.window.document.querySelector(`[data-app="${appNo}"] .case-status-cell .age`).textContent, "Scrape 1/25");
  finishes.shift()();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(calls, [[appNo], [secondApp]]);
  finishes.shift()();
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.close();
});

test("bulk scraping waits for index evidence and sends known records before unverified ones", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const unknown = "1-2026-00001";
  const known = "3-2026-00002";
  const calls = [];
  let finishLookup;
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([unknown, known]));
  dom.window.wipoTracker = {
    queueConcurrency: 1,
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrapePriorities: async () => new Promise((resolve) => { finishLookup = resolve; }),
    scrape: async (ids) => { calls.push(ids[0]); return { ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] }; },
    stop: async () => ({ ok: true }), exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.document.getElementById("scrapeAllButton").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, []);
  finishLookup({ ok: true, priorities: { [unknown]: { rank: 1 }, [known]: { rank: 0 } } });
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.deepEqual(calls, [known, unknown]);
  dom.window.close();
});

test("consecutive row clicks fill a five-record client pool without batching records together", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const ids = Array.from({ length: 6 }, (_, index) => `1-2026-${String(index + 1).padStart(5, "0")}`);
  const calls = [];
  const finishes = [];
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify(ids));
  dom.window.wipoTracker = {
    queueConcurrency: 5,
    queueDispatchInterval: 15,
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrape: async (applicationNos) => {
      calls.push([...applicationNos]);
      return new Promise((resolve) => finishes.push(() => resolve({ ok: true, imported: applicationNos.map((applicationNo) => ({ applicationNo })), missing: [] })));
    },
    stop: async () => ({ ok: true }), exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.document.querySelectorAll(".scrape-row").forEach((button) => button.click());
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.equal(calls.length, 5);
  assert.ok(calls.every((batch) => batch.length === 1));
  assert.equal(dom.window.document.querySelectorAll(".scrape-row.is-scraping").length, 5);
  assert.equal(dom.window.document.querySelectorAll(".scrape-row.is-queued").length, 1);
  finishes.shift()();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(calls.length, 6);
  while (finishes.length) finishes.shift()();
  await new Promise((resolve) => setTimeout(resolve, 35));
  dom.window.close();
});

test("today records require three individual confirmation clicks before scraping", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const calls = [];
  const finishes = [];
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    queueConcurrency: 5,
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo, lastScrapedAt: new Date().toISOString() }] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrape: async (ids) => { calls.push([...ids]); return new Promise((resolve) => finishes.push(() => resolve({ ok: true, imported: ids.map((applicationNo) => ({ applicationNo })), missing: [] }))); },
    stop: async () => ({ ok: true }), exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.querySelector(".scrape-row").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.length, 0);
  assert.equal(document.querySelector(".scrape-row .scrape-request-count").textContent, "1");
  for (let click = 1; click < 3; click += 1) document.querySelector(".scrape-row").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, [[appNo]]);
  assert.equal(document.querySelector(".scrape-row").disabled, true);
  assert.equal(document.querySelector(".scrape-row .scrape-request-count").textContent, "3");
  document.querySelector(".scrape-row").click();
  assert.equal(document.querySelector(".scrape-row .scrape-request-count").textContent, "3");

  finishes.shift()();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(document.querySelector(".scrape-row .scrape-request-count"), null);
  assert.equal(document.querySelector(".scrape-row").classList.contains("is-scraping"), false);
  dom.window.close();
});

test("today re-scrape confirmation resets ten seconds after the most recent click", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.WIPO_RESCRAPE_CONFIRMATION_TIMEOUT_MS = 1000;
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  let scrapeCalls = 0;
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo, lastScrapedAt: new Date().toISOString() }] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrape: async () => { scrapeCalls += 1; return { ok: true, imported: [{ applicationNo: appNo }], missing: [] }; }, stop: async () => ({ ok: true }), exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 25));
  dom.window.document.querySelector(".scrape-row").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  dom.window.document.querySelector(".scrape-row").click();
  assert.equal(dom.window.document.querySelector(".scrape-row .scrape-request-count").textContent, "2");
  await new Promise((resolve) => setTimeout(resolve, 1050));
  assert.equal(dom.window.document.querySelector(".scrape-row .scrape-request-count"), null);
  dom.window.document.querySelector(".scrape-row").click();
  assert.equal(dom.window.document.querySelector(".scrape-row .scrape-request-count").textContent, "1");
  assert.equal(scrapeCalls, 0);
  dom.window.close();
});

test("refresh restores the server scrape cap for this browser user's active scrape rows", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8").replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo }] }), detail: async () => ({ detail: null }), onProgress: () => {},
    resumeScrapes: async () => [{ id: "active-job", status: "running", applicationStates: { [appNo]: { status: "running", attempt: 2, maxAttempts: 25, initialAttempts: 25, maxRetries: 0, scrapeCap: 25, burstSize: 5 } } }],
    scrape: async () => ({}), stop: async () => ({ ok: true }), exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(dom.window.document.querySelector(".scrape-row").classList.contains("is-scraping"), true);
  assert.equal(dom.window.document.querySelector(".case-status-cell .age").textContent, "Scrape 2/25");
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("wipoTrackerActiveScrapeStates")), {
    [appNo]: { status: "running", attempt: 2, maxAttempts: 25, initialAttempts: 25, maxRetries: 0, scrapeCap: 25, burstSize: 5, position: 0, updatedAt: JSON.parse(dom.window.localStorage.getItem("wipoTrackerActiveScrapeStates"))[appNo].updatedAt },
  });
  assert.equal(dom.window.document.getElementById("stopButton").disabled, false);
  dom.window.close();
});

test("Stop clears active row spinners immediately while the scraper shuts down", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  let finishScrape;
  let stopCalls = 0;
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [] }), detail: async () => ({ detail: null }), onProgress: () => {},
    scrape: async () => new Promise((resolve) => { finishScrape = resolve; }),
    stop: async () => { stopCalls += 1; return { ok: true }; }, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.document.getElementById("scrapeAllButton").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(dom.window.document.querySelector(".scrape-row").classList.contains("is-scraping"), true);
  dom.window.document.getElementById("stopButton").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stopCalls, 1);
  assert.equal(dom.window.document.querySelector(".scrape-row").classList.contains("is-scraping"), false);
  finishScrape({ ok: false, imported: [], missing: [appNo], error: "Stopped" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.close();
});

test("case rows are green today, orange for one to four days, and red when stale or not scraped", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.WIPO_CHANGE_RESULT_INTERVAL_MS = 100;
  dom.window.WIPO_CHANGE_RESULT_FADE_MS = 10;
  const ids = ["1-2025-00613", "4-2025-31926", "4-2021-04414", "3-2020-01234"];
  const atDaysAgo = (days) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - days);
    return date.toISOString();
  };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify(ids));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [
      { applicationNo: ids[0], lastScrapedAt: atDaysAgo(0), snapshotId: 2, changeCount: 20 },
      { applicationNo: ids[1], lastScrapedAt: atDaysAgo(2) },
      { applicationNo: ids[2], lastScrapedAt: atDaysAgo(5) },
    ] }),
    detail: async (applicationNo) => ({ detail: applicationNo === ids[0] ? {
      latest: { id: 2, changes: ["one", "two", "three", "four"].map((name) => ({ field: `fields.${name}`, changeType: "changed", oldValue: "before", newValue: "after" })), data: {} },
      snapshots: [
        { id: 2, changes: ["one", "two", "three", "four"].map((name) => ({ field: `fields.${name}`, changeType: "changed", oldValue: "before", newValue: "after" })), data: {} },
        { id: 1, changes: [], data: {} },
      ],
    } : null }), onProgress: () => {}, chooseList: async () => ({}),
    scrape: async () => ({ ok: true, imported: [], missing: [] }), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const rows = [...dom.window.document.querySelectorAll(".case-row")];
  assert.equal(dom.window.document.querySelector(".case-row").dataset.app, ids[0]);
  assert.equal(rows[0].classList.contains("scrape-today"), true);
  assert.equal(rows[0].querySelectorAll(".case-status-cell > .age").length, 1);
  assert.equal(rows[0].querySelector(".alternating-result").textContent, "today");
  const waitForAlternatingText = async (expected) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (rows[0].querySelector(".alternating-result").textContent === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(rows[0].querySelector(".alternating-result").textContent, expected);
  };
  await waitForAlternatingText("4 changes");
  assert.equal(rows[0].querySelector(".alternating-result").textContent, "4 changes");
  assert.equal(rows[0].querySelector(".alternating-result").classList.contains("showing-changes"), true);
  await waitForAlternatingText("today");
  assert.equal(rows[0].querySelector(".alternating-result").textContent, "today");
  assert.equal(rows[0].querySelector(".changed-badge"), null);
  assert.equal(rows[0].querySelector(".alternating-result").getAttribute("aria-label"), "today; 4 changes");
  assert.equal(rows[1].classList.contains("scrape-recent"), true);
  assert.equal(rows[2].classList.contains("scrape-stale"), true);
  assert.equal(rows[3].classList.contains("scrape-stale"), true);
  dom.window.document.getElementById("applicationInput").value = ids[1];
  dom.window.document.getElementById("addButton").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const duplicateRows = [...dom.window.document.querySelectorAll(".case-row")];
  assert.equal(duplicateRows.length, ids.length);
  assert.equal(duplicateRows[1].classList.contains("scrape-recent"), true);
  assert.equal(duplicateRows[1].classList.contains("duplicate-pulse"), true);
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.case-row\.scrape-today\.duplicate-pulse[^}]*duplicate-pulse-today/);
  assert.match(css, /\.case-row\.scrape-recent\.duplicate-pulse[^}]*duplicate-pulse-recent/);
  assert.match(css, /\.case-row\.scrape-stale\.duplicate-pulse[^}]*duplicate-pulse-stale/);
  assert.match(css, /\.age\.alternating-result\.showing-changes/);
  assert.match(css, /\.age\.alternating-result[^}]*--result-breathe-duration: 1400ms/);
  assert.match(css, /\.age\.alternating-result\.result-fading[^}]*opacity: 0;/);
  assert.match(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"), /configured\s*:\s*5000/);
  dom.window.close();
});

test("Result column ignores raw parser-only changes after prefetched detail loads", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const citedChange = {
    field: "fields.(58) Các tài liệu đối chứng", changeType: "changed",
    oldValue: "1<t>2023-03-29<t>SG 11202102169 X<t>Notification and Report<t>Sáng chế",
    newValue: "Tài liệu được đối chứngTài liệu tham khảoDanh mụcYêu cầu bảo hộLoại tài liệu đối chứng 12023-03-29 SG 11202102169 X Notification and ReportSáng chế",
  };
  const latest = { id: 2, scrapedAt: new Date().toISOString(), data: {}, changes: [citedChange] };
  const previous = { id: 1, scrapedAt: "2026-09-26T02:17:44.000Z", data: {}, changes: [] };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo, snapshotId: 2, lastScrapedAt: latest.scrapedAt, changeCount: 3 }] }),
    detail: async () => ({ detail: { latest, snapshots: [latest, previous] } }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(dom.window.document.querySelector(".case-status-cell .age").textContent, "today");
  assert.equal(dom.window.document.querySelector(".alternating-result"), null);
  dom.window.document.querySelector(".case-row").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(dom.window.document.getElementById("changeSummary").textContent, "No changes from the previous snapshot");
  dom.window.close();
});

test("clicking the snapshot change summary opens a timeline and exact before-after table", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  dom.window.eval(fs.readFileSync(path.join(root, "..", "electron-app", "text_diff.js"), "utf8"));
  const latest = {
    id: 2,
    scrapedAt: "2026-09-29T14:35:53.000Z",
    changes: [
      { field: "dates[15]", changeType: "added", oldValue: "", newValue: '{"raw":"14/05/2026","iso":"2026-05-14"}' },
      { field: "diary[10]", changeType: "added", oldValue: "", newValue: '{"date":{"raw":"14/05/2026","iso":"2026-05-14"},"date_text":"14/05/2026","description":"Biên lai điện tử XLQ","extra":[]}' },
      { field: "fields.Trạng thái", changeType: "changed", oldValue: "SC Chờ công bố A", newValue: "SC Chờ công bố B" },
      { field: "split_fields.status", changeType: "changed", oldValue: "SC Chờ công bố A", newValue: "SC Chờ công bố B" },
      { field: "dates[16]", changeType: "added", oldValue: "", newValue: '{"raw":"18/09/2026","iso":"2026-09-18"}' },
      { field: "fields.(10) Số bằng và ngày cấp", changeType: "changed", oldValue: "", newValue: "1-0061646-000 18/09/2026" },
      { field: "split_fields.grant_number_date.date.day", changeType: "changed", oldValue: "", newValue: "18" },
      { field: "split_fields.grant_number_date.date.iso", changeType: "changed", oldValue: "", newValue: "2026-09-18" },
      { field: "split_fields.grant_number_date.date.month", changeType: "changed", oldValue: "", newValue: "9" },
      { field: "split_fields.grant_number_date.date.year", changeType: "changed", oldValue: "", newValue: "2026" },
      { field: "split_fields.grant_number_date.number", changeType: "changed", oldValue: "", newValue: "1-0061646-000" },
      { field: "dates[17]", changeType: "added", oldValue: "", newValue: '{"raw":"10/11/2040","iso":"2040-11-10"}' },
      { field: "fields.(180) Ngày hết hạn", changeType: "changed", oldValue: "", newValue: "10/11/2040" },
      { field: "split_fields.expiry_date.day", changeType: "changed", oldValue: "", newValue: "10" },
      { field: "split_fields.expiry_date.iso", changeType: "changed", oldValue: "", newValue: "2040-11-10" },
      { field: "split_fields.expiry_date.month", changeType: "changed", oldValue: "", newValue: "11" },
      { field: "split_fields.expiry_date.year", changeType: "changed", oldValue: "", newValue: "2040" },
      { field: "split_fields.priority_details[0]", changeType: "changed",
        oldValue: '{"order":1,"priority_country":"CN","priority_number":"202010852529.1","priority_date":{"raw":"21/08/2020"},"priority_no":"CN 202010852529.1"}',
        newValue: '{"order":1,"priority_date":{"raw":"21/08/2020"},"priority_no":"CN 202010852529.1"}' },
      { field: "split_fields.priority_details[1]", changeType: "changed",
        oldValue: '{"order":2,"priority_country":"CN","priority_number":"202010781257.0","priority_date":{"raw":"06/08/2020"},"priority_no":"CN 202010781257.0"}',
        newValue: '{"order":2,"priority_date":{"raw":"07/08/2020"},"priority_no":"CN 202010781257.0"}' },
      { field: "split_fields.ipc_classifications[0]", changeType: "changed", oldValue: '{"code":"A01N 37/06","edition":"2006.01"}', newValue: '{"code":"A01N 37/06","edition":"2026.01"}' },
      { field: "split_fields.ipc_classifications[1]", changeType: "added", oldValue: "", newValue: '{"code":"A23K 10/00","edition":"2006.01"}' },
      { field: "fields.(58) Các tài liệu đối chứng", changeType: "changed",
        oldValue: "1<t>2023-03-29<t>SG 11202102169 X<t>Notification and Report<t>Sáng chế<lf>2<t>2021-09-21<t>Các tài liệu được trích dẫn trong Báo cáo thẩm định sơ bộ quốc tế cho đơn quốc tế số PCT/SG2019/050153<t>Notification and Report<t>Sáng chế",
        newValue: "Tài liệu được đối chứngTài liệu tham khảoDanh mụcYêu cầu bảo hộLoại tài liệu đối chứng 12023-03-29 SG 11202102169 X Notification and ReportSáng chế 22021-09-21 Các tài liệu được trích dẫn trong Báo cáo thẩm định sơ bộ quốc tế cho đơn quốc tế số PCT/SG2019/050153 Notification and ReportSáng chế" },
      { field: "split_fields.cited_documents[0]", changeType: "removed", oldValue: '{"claim_type":"Notification and Report","document_type":"Sáng chế","reference_date":"2023-03-29","reference_no":"1","reference_text":"SG 11202102169 X"}', newValue: "" },
      { field: "split_fields.cited_documents[1]", changeType: "removed", oldValue: '{"claim_type":"Notification and Report","document_type":"Sáng chế","reference_date":"2021-09-21","reference_no":"2","reference_text":"Các tài liệu được trích dẫn trong Báo cáo thẩm định sơ bộ quốc tế cho đơn quốc tế số PCT/SG2019/050153"}', newValue: "" },
      { field: "applicants[0]", changeType: "changed", oldValue: "Old owner : Old address", newValue: "New owner : New address" },
      { field: "applicants_ordered[0]", changeType: "changed", oldValue: '{"name":"Old owner","address":"Old address"}', newValue: '{"name":"New owner","address":"New address"}' },
    ],
    data: { fields: { "Trạng thái": "SC Chờ công bố B" }, split_fields: { status: "SC Chờ công bố B", priority_details: [
      { order: 1, priority_date: { raw: "21/08/2020" }, priority_no: "CN 202010852529.1" },
      { order: 2, priority_date: { raw: "07/08/2020" }, priority_no: "CN 202010781257.0" },
    ], ipc_classifications: [
      { code: "A23K 10/00", edition: "2006.01" },
      { code: "A01N 37/06", edition: "2026.01" },
    ] }, diary: [
      { date: { raw: "01/01/2026" }, description: "Filed", extra: [] },
      { date: { raw: "14/05/2026" }, description: "Biên lai điện tử XLQ", extra: ["Completed"] },
    ] },
  };
  const earlier = {
    id: 1,
    scrapedAt: "2026-09-27T00:54:06.000Z",
    changes: [],
    data: { fields: { "Trạng thái": "SC Chờ công bố A" }, split_fields: { status: "SC Chờ công bố A", priority_details: [
      { order: 1, priority_country: "CN", priority_number: "202010852529.1", priority_date: { raw: "21/08/2020" }, priority_no: "CN 202010852529.1" },
      { order: 2, priority_country: "CN", priority_number: "202010781257.0", priority_date: { raw: "06/08/2020" }, priority_no: "CN 202010781257.0" },
    ], ipc_classifications: [
      { code: "A01N 37/06", edition: "2006.01" },
    ] }, diary: [
      { date: { raw: "01/01/2026" }, description: "Filed", extra: [] },
    ] },
  };
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo]));
  dom.window.wipoTracker = {
    init: async () => ({ database: "test.sqlite", presets: [{ index: 1, name: "Fast" }] }),
    list: async () => ({ applications: [{ applicationNo: appNo, lastScrapedAt: latest.scrapedAt }] }),
    detail: async () => ({ detail: { latest, snapshots: [latest, earlier] } }),
    onProgress: () => {}, chooseList: async () => ({}), scrape: async () => ({}), stop: () => {}, exportExcel: async () => ({}),
    openPublicationPdf: async () => ({ ok: true, documents: [] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const document = dom.window.document;
  document.querySelector(".case-row").click();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(document.getElementById("changeSummary").textContent, "7 changes in this snapshot");
  assert.match(document.getElementById("snapshotSelect").selectedOptions[0].textContent, /7 changes/);
  document.getElementById("changeSummary").click();

  assert.equal(document.getElementById("changeHistoryModal").classList.contains("hidden"), false);
  assert.equal(document.getElementById("changeDiffHighlightCheckbox").checked, false);
  assert.equal(document.querySelectorAll(".change-timeline-button").length, 2);
  assert.equal(document.querySelectorAll("#changeComparisonBody > tr").length, 7);
  assert.match(document.getElementById("changeComparisonBody").textContent, /SC Chờ công bố A/);
  assert.match(document.getElementById("changeComparisonBody").textContent, /SC Chờ công bố B/);
  assert.match(document.getElementById("changeComparisonBody").textContent, /Procedural timeline/);
  assert.doesNotMatch(document.getElementById("changeComparisonBody").textContent, /Procedural timeline · (?:event|date)/);
  assert.match(document.getElementById("changeComparisonBody").textContent, /14\/05\/2026/);
  assert.match(document.getElementById("changeComparisonBody").textContent, /Biên lai điện tử XLQ/);
  assert.match(document.getElementById("changeComparisonBody").textContent, /Grant number and date/);
  assert.match(document.getElementById("changeComparisonBody").textContent, /1-0061646-000/);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-grant-table").length, 2);
  assert.deepEqual([...document.querySelector("#changeComparisonBody .change-grant-table thead tr").cells].map((cell) => cell.textContent), ["Reg No.", "Grant date"]);
  assert.deepEqual([...document.querySelectorAll("#changeComparisonBody .change-grant-table")[0].tBodies[0].rows[0].cells].map((cell) => cell.textContent), ["—", "—"]);
  assert.deepEqual([...document.querySelectorAll("#changeComparisonBody .change-grant-table")[1].tBodies[0].rows[0].cells].map((cell) => cell.textContent), ["1-0061646-000", "18/09/2026"]);
  assert.match(document.getElementById("changeComparisonBody").textContent, /Expiry date/);
  assert.match(document.getElementById("changeComparisonBody").textContent, /10\/11\/2040/);
  assert.match(document.getElementById("changeComparisonBody").textContent, /Priority/);
  assert.doesNotMatch(document.getElementById("changeComparisonBody").textContent, /Priority · row/);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-priority-table").length, 2);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-priority-table")[0].tBodies[0].rows.length, 2);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-priority-table")[1].tBodies[0].rows.length, 2);
  assert.deepEqual([...document.querySelector("#changeComparisonBody .change-priority-table thead tr").cells].map((cell) => cell.textContent), ["Country", "Priority number", "Priority date"]);
  assert.deepEqual([...document.querySelector("#changeComparisonBody .change-priority-table tbody tr").cells].map((cell) => cell.textContent), ["CN", "202010852529.1", "21/08/2020"]);
  assert.match(document.getElementById("changeComparisonBody").textContent, /ipc classifications/i);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-generic-table").length, 2);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-generic-table")[0].tBodies[0].rows.length, 1);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-generic-table")[1].tBodies[0].rows.length, 2);
  assert.doesNotMatch(document.getElementById("changeComparisonBody").textContent, /ipc classifications · row/i);
  document.getElementById("changeDiffHighlightCheckbox").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.getElementById("changeDiffHighlightCheckbox").checked, true);
  assert.equal(dom.window.localStorage.getItem("wipoTrackerChangeDiffHighlight"), "true");
  assert.ok(document.querySelectorAll("#changeComparisonBody .snapshot-text-diff-diff").length > 0);
  assert.ok(document.querySelectorAll("#changeComparisonBody .change-generic-table .snapshot-text-diff-diff").length > 0);
  const currentGenericTable = document.querySelectorAll("#changeComparisonBody .change-generic-table")[1];
  assert.equal(currentGenericTable.tBodies[0].rows[0].querySelectorAll(".change-diff-unmatched-right").length, 2);
  assert.ok(currentGenericTable.tBodies[0].rows[1].querySelector(".snapshot-text-diff-diff-right"));
  assert.ok(document.querySelector("#changeComparisonBody .change-column-date"));
  assert.doesNotMatch(document.getElementById("changeComparisonBody").textContent, /\(58\) Cited documents/);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-cited-table").length, 0);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-people-table").length, 2);
  assert.deepEqual([...document.querySelector("#changeComparisonBody .change-people-table thead tr").cells].map((cell) => cell.textContent), ["Name", "Address"]);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-timeline-table").length, 2);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-timeline-table")[0].tBodies[0].rows.length, 1);
  assert.equal(document.querySelectorAll("#changeComparisonBody .change-timeline-table")[1].tBodies[0].rows.length, 2);
  assert.deepEqual([...document.querySelector("#changeComparisonBody .change-timeline-table thead tr").cells].map((cell) => cell.textContent), ["Date", "Event", "Details"]);
  assert.doesNotMatch(document.getElementById("changeComparisonBody").textContent, /dates\[|split_fields|grant number date\.|expiry date\.|\{\s*"/i);
  assert.equal(document.getElementById("changeComparisonCount").textContent, "7 changes");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.change-history-modal[^}]*1800px[^}]*100vw - 8px[^}]*100vh - 8px/);
  assert.match(css, /\.change-table-scroll[^}]*overflow-x: hidden/);
  assert.match(css, /\.change-structured-table-wrap[^}]*overflow: visible/);
  assert.match(css, /\.change-structured-table col\.change-column-date[^}]*112px/);
  assert.match(css, /td\.change-column-date[^}]*white-space: nowrap/);
  assert.doesNotMatch(css, /\.change-cited-table\s*\{[^}]*min-width:\s*680px/);

  document.querySelector('[data-change-snapshot="1"]').click();
  assert.equal(document.querySelector('[data-change-snapshot="1"]').getAttribute("aria-current"), "true");
  assert.equal(document.getElementById("changeComparisonEmpty").classList.contains("hidden"), false);
  dom.window.close();
});
