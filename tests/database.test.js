const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function call(db, command, payload = {}, args = []) {
  const result = spawnSync(process.env.WIPO_PYTHON || "python", [path.resolve(__dirname, "..", "wipo_history_db.py"), db, command, ...args], { input: command === "ingest" || command === "list" ? JSON.stringify(payload) : "", encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("SQLite stores every scrape and records field-level changes", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "wipo-tracker-"));
  const db = path.join(folder, "history.sqlite");
  call(db, "init");
  const first = { id: "1-2022-01097", scraped_at: "2026-09-23T01:00:00.000Z", split_fields: { application_number_date: { application_no: "1-2022-01097" }, status: "Filed", title: "Roller" }, fields: { "Trạng thái": "Filed" } };
  const second = { ...first, scraped_at: "2026-09-24T01:00:00.000Z", split_fields: { ...first.split_fields, status: "Granted" }, fields: { "Trạng thái": "Granted" } };
  call(db, "ingest", { record: first, source: "test" });
  call(db, "ingest", { record: second, source: "test" });
  const detail = call(db, "detail", {}, ["--application-no", "1-2022-01097"]).detail;
  assert.equal(detail.snapshots.length, 2);
  assert.ok(detail.latest.changes.some((change) => change.field === "split_fields.status" && change.oldValue === "Filed" && change.newValue === "Granted"));
  fs.rmSync(folder, { recursive: true, force: true });
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
