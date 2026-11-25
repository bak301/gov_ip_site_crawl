const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function call(db, command, payload = {}, args = []) {
  const result = spawnSync(process.env.WIPO_PYTHON || "python", [path.resolve(__dirname, "..", "wipo_history_db.py"), db, command, ...args], { input: ["ingest", "list", "hague-ingest", "hague-list"].includes(command) ? JSON.stringify(payload) : "", encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("SQLite stores every scrape and records field-level changes", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "wipo-tracker-"));
  const db = path.join(folder, "history.sqlite");
  call(db, "init");
  const first = { id: "1-2022-01097", scraped_at: "2026-09-23T01:00:00.000Z", split_fields: { application_number_date: { application_no: "1-2022-01097" }, status: "Filed", title: "Roller", grant_number_date: { number: "1-0050358-000", date: { day: 17, month: 7, year: 2025 } }, expiry_date: { day: 20, month: 8, year: 2040 }, representatives_ordered: [{ representative_name: "INVESTIP", representative_address: "Hà Nội" }] }, fields: { "Loại đơn": "non-PCT SC", "Trạng thái": "Filed" } };
  const second = { ...first, scraped_at: "2026-09-24T01:00:00.000Z", split_fields: { ...first.split_fields, status: "Granted" }, fields: { ...first.fields, "Trạng thái": "Granted" } };
  call(db, "ingest", { record: first, source: "test" });
  call(db, "ingest", { record: second, source: "test" });
  const detail = call(db, "detail", {}, ["--application-no", "1-2022-01097"]).detail;
  assert.equal(detail.snapshots.length, 2);
  assert.ok(detail.latest.changes.some((change) => change.field === "split_fields.status" && change.oldValue === "Filed" && change.newValue === "Granted"));
  const summary = call(db, "list", { applicationNos: ["1-2022-01097"] }).applications[0];
  assert.equal(summary.applicationType, "non-PCT SC");
  assert.equal(summary.status, "Granted");
  assert.equal(summary.registrationNo, "1-0050358-000");
  assert.equal(summary.grantNumberDate, "1-0050358-000 · 17/07/2025");
  assert.equal(summary.expiryDate, "20/08/2040");
  assert.equal(summary.ipRepresentatives, "INVESTIP : Hà Nội");
  fs.rmSync(folder, { recursive: true, force: true });
});

test("Hague registrations survive reload and preserve meaningful snapshot changes", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "wipo-hague-history-"));
  const db = path.join(folder, "history.sqlite");
  try {
    call(db, "init");
    const first = { ok: true, number: "DM/213380", checkedAt: "2026-10-07T01:00:00.000Z", status: "Refusal", holders: [{ name: "Holder", address: "Address" }], events: [
      { id: "refusal", kind: "Refusal", bulletinDate: "15/10/2021", pdfAvailable: true, pdfData: { refusalGrounds: "Ground A" }, url: "http://localhost/old" },
    ] };
    const second = { ...first, checkedAt: "2026-10-08T01:00:00.000Z", status: "Granted", events: [first.events[0],
      { id: "grant", kind: "Granted", bulletinDate: "17/01/2025", pdfAvailable: true, pdfData: { decisionNo: "45905/QĐ-SHTT.IP" } }] };
    assert.equal(call(db, "hague-ingest", { record: first }).stored.reused, false);
    assert.equal(call(db, "hague-ingest", { record: first }).stored.reused, true);
    const stored = call(db, "hague-ingest", { record: second }).stored;
    assert.ok(stored.changes.some((change) => change.field === "status" && change.newValue === "Granted"));
    assert.ok(stored.changes.some((change) => change.field.startsWith("events[") && change.changeType === "added"));
    const latest = call(db, "hague-list", { registrationNos: ["DM/213380"] }).registrations[0];
    assert.equal(latest.scrapeCount, 2);
    assert.equal(latest.data.status, "Granted");
    assert.equal(latest.data.events[0].url, undefined);
    assert.equal(latest.changeCount, stored.changes.length);
    const detail = call(db, "hague-detail", {}, ["--application-no", "DM/213380"]).detail;
    assert.equal(detail.snapshots.length, 2);
    assert.equal(detail.snapshots[1].data.status, "Refusal");
    assert.equal(call(db, "list", { applicationNos: ["DM/213380"] }).applications.length, 0);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("snapshot changes compare individual diary and structured rows without shift noise", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "wipo-row-diff-"));
  const db = path.join(folder, "history.sqlite");
  try {
    call(db, "init");
    const event = (date, description, status) => ({ date: { iso: date }, description, extra: [status] });
    const first = {
      id: "1-2022-03660", scraped_at: "2026-09-23T01:00:00.000Z",
      diary: [event("2024-01-01", "Filed", "Pending"), event("2024-02-01", "Published", "Public")],
      split_fields: { priority_details: [{ priority_no: "CN 123", priority_date_text: "01.01.2023" }] },
      applicants_ordered: [{ applicant_name: "ABC", applicant_address: "Old address" }],
    };
    const second = {
      ...first, scraped_at: "2026-09-24T01:00:00.000Z",
      diary: [event("2023-12-01", "Received", "New"), first.diary[0], event("2024-02-01", "Published", "Granted")],
      split_fields: { priority_details: [{ priority_no: "CN 123", priority_date_text: "02.01.2023" }] },
      applicants_ordered: [{ applicant_name: "ABC", applicant_address: "New address" }],
    };
    call(db, "ingest", { record: first });
    call(db, "ingest", { record: second });
    const detail = call(db, "detail", {}, ["--application-no", first.id]).detail;
    const changes = detail.latest.changes;
    assert.deepEqual(changes.filter((item) => item.field.startsWith("diary[")).map((item) => [item.field, item.changeType]), [["diary[0]", "added"], ["diary[2]", "changed"]]);
    assert.ok(changes.some((item) => item.field === "split_fields.priority_details[0]" && item.changeType === "changed"));
    assert.ok(changes.some((item) => item.field === "applicants_ordered[0]" && item.changeType === "changed"));
    assert.equal(changes.length, 4);
    assert.equal(call(db, "list", { applicationNos: [first.id] }).applications[0].changeCount, 4);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
