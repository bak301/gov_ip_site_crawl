const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const appNo = "1-2022-01543";

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

test("saved application numbers automatically show Export-PR references after Patent", async () => {
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
    lookupApplicationRefs: async () => ({ ok: true, matches: [{ applicationNo, caseRefs: ["IP/PR16896/CDD"] }] }),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(dom.window.document.querySelector(".case-ref-cell").textContent.trim(), "IP/PR16896/CDD");
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

test("desktop and LAN views use the Dictionary OCR LAN blue and light-gray palette", () => {
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /--accent: #0b68d1;/);
  assert.match(css, /--soft: #eef2f5;/);
  assert.match(css, /\.topbar \{[^}]*background: #fff;[^}]*border-bottom: 1px solid #cfd8df;/);
  assert.match(css, /\.button\.scrape-primary \{[^}]*background: #126cc8;/);
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
  input.value = "1-2025-00613\n4-2025-31926";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(dom.window.document.querySelectorAll(".case-row").length, 0);
  dom.window.document.getElementById("addButton").click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual([...dom.window.document.querySelectorAll(".case-no")].map((node) => node.textContent), ["1-2025-00613", "4-2025-31926"]);
  assert.equal(input.value, "");
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

test("case-list edit, add, remove-list, and remove-row controls use the downloaded icons", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.ok(document.querySelector("#renameNamedListButton .icon-pencil[aria-hidden='true']"));
  assert.ok(document.querySelector("#addNamedListButton .icon-plus[aria-hidden='true']"));
  assert.ok(document.querySelector("#removeNamedListButton .icon-delete[aria-hidden='true']"));
  assert.match(css, /\.named-list-icon \{[^}]*width: 22px;[^}]*height: 22px;/);
  assert.match(css, /\.remove-row-icon \{[^}]*width: 22px;[^}]*height: 22px;/);
  for (const icon of ["pencil", "plus", "delete"]) {
    assert.ok(css.includes(`--icon-${icon}: url("${icon}.png")`));
    assert.ok(fs.existsSync(path.join(root, "electron", "renderer", `${icon}.png`)));
  }
  dom.window.close();
});

test("record header separates status, colors record types, and compresses actions", () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.ok(document.querySelector(".detail-status-line #detailStatus"));
  assert.equal(document.querySelector(".detail-title-line #detailStatus"), null);
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
    inventors_ordered: [{ name: "GABRIEL, Michael J.", address: "Minnesota" }],
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
    openPublicationPdf: async () => ({ ok: true, documents: [{ category: "publication_a", url: "https://example.test/publication.pdf", publicationNo: "VN 87058", pages: "394", sourceFile: "CB_411_A1.pdf" }] }),
  };
  dom.window.publicationViewer = {
    render: async (url) => { dom.window.renderedPublicationUrl = url; },
    clear: () => { dom.window.publicationViewerCleared = true; },
  };
  let printCalls = 0;
  dom.window.print = () => { printCalls += 1; };
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
  const representativeSection = peopleSections.find((section) => section.querySelector("h3").textContent === "IP Representatives");
  assert.deepEqual([...representativeSection.querySelectorAll("th")].map((node) => node.textContent), ["Name", "Address"]);
  assert.equal(representativeSection.querySelectorAll("tbody tr:first-child td").length, 2);
  assert.match(document.querySelector(".case-time").textContent, /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}today/);
  const css = fs.readFileSync(path.join(root, "electron", "renderer", "styles.css"), "utf8");
  assert.match(css, /\.detail-heading h2 \{[^}]*font-family: var\(--ui-font\)/);
  assert.match(css, /\.status-tag \{[^}]*font-family: var\(--ui-font\)/);
  assert.match(css, /\.field-grid \{[^}]*font-family: var\(--ui-font\)/);
  assert.match(css, /\.structured-heading h3 \{[^}]*font-family: var\(--ui-font\)/);
  assert.match(css, /\.structured-table \{[^}]*font-family: var\(--ui-font\)/);
  assert.doesNotMatch(css, /Georgia, serif/);
  document.getElementById("publicationAButton").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const publicationModal = document.getElementById("publicationModal");
  assert.equal(publicationModal.classList.contains("hidden"), false);
  assert.equal(dom.window.renderedPublicationUrl, "https://example.test/publication.pdf");
  assert.match(document.getElementById("publicationModalMeta").textContent, /VN 87058 · Pages 394 · CB_411_A1\.pdf/);
  document.getElementById("closePublicationModalButton").click();
  assert.equal(publicationModal.classList.contains("hidden"), true);
  assert.equal(dom.window.publicationViewerCleared, true);
  document.getElementById("printPdfButton").click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(printCalls, 1);
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
  assert.match(css, /grid-template-columns: 0 minmax\(100px, 1fr\) minmax\(118px, 1\.1fr\) minmax\(155px, 1\.25fr\) 28px 28px/);
  assert.deepEqual([...document.querySelectorAll(".list-head > div")].slice(1).map((item) => item.textContent.trim()), ["Application no.", "Case ref", "Last scraped"]);
  assert.equal(document.getElementById("caseCount"), null);
  assert.equal(document.querySelector(".case-panel").lastElementChild.className, "input-bar");
  assert.match(css, /\.snapshot-strip \{[^}]*min-height: 36px;[^}]*padding: 3px 26px;/);
  assert.match(css, /\.snapshot-strip select \{[^}]*width: clamp\(230px, 25vw, 300px\);[^}]*height: 29px/);
  assert.match(css, /\.publication-action \.publication-count \{[^}]*color: #0a57aa;[^}]*background: #e3f0ff;/);
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
  assert.equal(document.querySelector(".publication-quick-actions").classList.contains("hidden"), true);
  assert.equal(publicationCalls, 0);
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
  document.getElementById("compactListButton").click();
  assert.equal(document.querySelector(".case-panel").classList.contains("compact-list"), true);
  assert.equal(document.getElementById("compactListButton").getAttribute("aria-pressed"), "true");
  assert.equal(dom.window.localStorage.getItem("wipoTrackerCompactList"), "1");
  const resizer = document.getElementById("workspaceResizer");
  resizer.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(dom.window.localStorage.getItem("wipoTrackerCasePaneWidth"), "320");
  assert.equal(document.documentElement.style.getPropertyValue("--case-pane-width"), "320px");
  dom.window.close();
});

test("Export list sends the complete browser-local case list in one click", async () => {
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
    exportExcel: async (ids) => { exportCalls.push([...ids]); return { ok: true, count: ids.length }; },
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  dom.window.document.getElementById("exportListButton").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(exportCalls, [[appNo, secondApp]]);
  assert.equal(dom.window.document.getElementById("exportListButton").textContent, "Export list");
  dom.window.close();
});

test("Scrape all skips stored cases unless Re-scrape is checked", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const secondApp = "1-2022-01097";
  const scrapeCalls = [];
  const retryCalls = [];
  dom.window.localStorage.setItem("wipoTrackerQueue", JSON.stringify([appNo, secondApp]));
  dom.window.localStorage.setItem("wipoTrackerRetryCount", "7");
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
  assert.deepEqual(scrapeCalls[1], [appNo, secondApp]);
  assert.deepEqual(retryCalls, [7, 7]);
  assert.equal(document.getElementById("retryCountInput").value, "7");
  assert.equal(dom.window.localStorage.getItem("wipoTrackerRescrape"), "1");
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
  stored = true;
  progressHandler({ type: "record", applicationNo: appNo, message: `Stored ${appNo}` });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const row = dom.window.document.querySelector(".case-row");
  assert.equal(row.classList.contains("scrape-today"), true);
  assert.doesNotMatch(row.querySelector(".scraped-at").textContent, /^â€”$/);
  finishScrape();
  await new Promise((resolve) => setTimeout(resolve, 30));
  retryButton = dom.window.document.querySelector(".scrape-row");
  assert.equal(retryButton.classList.contains("is-scraping"), false);
  assert.equal(retryButton.getAttribute("aria-busy"), "false");
  dom.window.close();
});

test("case rows are green today, orange for one to four days, and red when stale or not scraped", async () => {
  const html = fs.readFileSync(path.join(root, "electron", "renderer", "index.html"), "utf8")
    .replace(/<script[^>]+><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
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
      { applicationNo: ids[0], lastScrapedAt: atDaysAgo(0) },
      { applicationNo: ids[1], lastScrapedAt: atDaysAgo(2) },
      { applicationNo: ids[2], lastScrapedAt: atDaysAgo(5) },
    ] }),
    detail: async () => ({ detail: null }), onProgress: () => {}, chooseList: async () => ({}),
    scrape: async () => ({ ok: true, imported: [], missing: [] }), stop: () => {}, exportExcel: async () => ({}),
  };
  dom.window.eval(fs.readFileSync(path.join(root, "electron", "renderer", "renderer.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const rows = [...dom.window.document.querySelectorAll(".case-row")];
  assert.equal(rows[0].classList.contains("scrape-today"), true);
  assert.equal(rows[1].classList.contains("scrape-recent"), true);
  assert.equal(rows[2].classList.contains("scrape-stale"), true);
  assert.equal(rows[3].classList.contains("scrape-stale"), true);
  dom.window.close();
});
