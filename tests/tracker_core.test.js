const test = require("node:test");
const assert = require("node:assert/strict");
const { parseApplicationNumbers, normalizeRegistrationNo, parseRegistrationNumbers, getRecordApplicationNo, diffRecords, parseCitedDocuments } = require("../tracker_core");

test("application list input is normalized and deduplicated", () => {
  assert.deepEqual(parseApplicationNumbers("VN 1-2022-01097\n1-2022-01097, 1-2021-00452"), ["1-2022-01097", "1-2021-00452"]);
  assert.deepEqual(parseApplicationNumbers("DT1-2021-13520\n1-2021-13521"), ["1-2021-13521"]);
});

test("patent, design, national trademark, international trademark, and compact WIPO IDs are accepted", () => {
  assert.deepEqual(
    parseApplicationNumbers("2-2024-01234\n3-2020-4567\n4-2004-14651\n5-2025-123456\nhttps://wipopublish.ipvietnam.gov.vn/detail?id=VN4200414651"),
    ["2-2024-01234", "3-2020-4567", "4-2004-14651", "5-2025-123456"]
  );
  assert.deepEqual(parseApplicationNumbers('4-2025-31926\n5-0736887\n5-0736887'), ['4-2025-31926', '5-0736887']);
  assert.deepEqual(parseApplicationNumbers('5-158247B\n5-158999\n5-0736887'), ['5-158247B','5-158999','5-0736887']);
});

test("registration inputs are type-aware and rendered in saturated form", () => {
  assert.deepEqual(normalizeRegistrationNo("23245", "patent"), { type: "patent", prefix: "1", number: "0023245", suffix: "000", lookupKey: "23245", formatted: "1-0023245-000" });
  assert.deepEqual(normalizeRegistrationNo("2-0004321-000", "trademark"), { type: "patent", prefix: "2", number: "0004321", suffix: "000", lookupKey: "4321", formatted: "2-0004321-000" });
  assert.deepEqual(normalizeRegistrationNo("765", "design"), { type: "design", prefix: "3", number: "0000765", suffix: "000", lookupKey: "765", formatted: "3-0000765-000" });
  assert.deepEqual(normalizeRegistrationNo("4-0012345", "patent"), { type: "trademark", prefix: "4", number: "0012345", suffix: "000", lookupKey: "12345", formatted: "4-0012345-000" });
  assert.equal(normalizeRegistrationNo("4-0040985-001", "trademark").formatted, "4-0040985-001");
  assert.deepEqual(parseRegistrationNumbers("23245\n1-0023245 B\n23246", "patent").map((item) => item.formatted), ["1-0023245-000", "1-0023246-000"]);
  assert.equal(normalizeRegistrationNo("1-2023-02108", "patent"), null);
  assert.deepEqual(
    parseRegistrationNumbers("1-2023-02775\n1-0048591-000\n1-2023-01258\n1-0058965-000", "patent").map((item) => item.formatted),
    ["1-0048591-000", "1-0058965-000"]
  );
});

test("application number is taken from fully parsed split fields", () => {
  assert.equal(getRecordApplicationNo({ id: "legacy", split_fields: { application_number_date: { application_no: "1-2022-01097" } } }), "1-2022-01097");
});

test("diff ignores scrape timestamp but reports actual field changes", () => {
  const changes = diffRecords({ scraped_at: "old", fields: { Status: "Filed" } }, { scraped_at: "new", fields: { Status: "Granted" } });
  assert.deepEqual(changes, [{ field: "fields.Status", oldValue: "Filed", newValue: "Granted" }]);
});

test("diff compares diary rows by event identity instead of shifted array positions", () => {
  const event = (date, description, extra) => ({ date: { iso: date }, description, extra: [extra] });
  const old = { diary: [event("2024-01-01", "Filed", "Pending"), event("2024-02-01", "Published", "Public")] };
  const next = { diary: [event("2023-12-01", "Received", "New"), old.diary[0], event("2024-02-01", "Published", "Granted")] };
  assert.deepEqual(diffRecords(old, next).map(({ field, changeType }) => [field, changeType]), [["diary[0]", "added"], ["diary[2]", "changed"]]);
});

test("legacy cited-document text is split into five table columns", () => {
  const raw = "Tài liệu được đối chứngTài liệu tham khảoDanh mụcYêu cầu bảo hộLoại tài liệu đối chứng 12021-03-09 Các tài liệu được trích dẫn trong Báo cáo thẩm định sơ bộ quốc tế cho đơn quốc tế số PCT/JP2019/033942 Notification and ReportSáng chế 22021-07-12 US 11,194,263 B2 Notification and ReportSáng chế";
  assert.deepEqual(parseCitedDocuments(raw), [
    { reference_no: "1", reference_date: "2021-03-09", reference_text: "Các tài liệu được trích dẫn trong Báo cáo thẩm định sơ bộ quốc tế cho đơn quốc tế số PCT/JP2019/033942", claim_type: "Notification and Report", document_type: "Sáng chế" },
    { reference_no: "2", reference_date: "2021-07-12", reference_text: "US 11,194,263 B2", claim_type: "Notification and Report", document_type: "Sáng chế" },
  ]);
});

test("cell-delimited cited-document rows preserve blank columns", () => {
  assert.deepEqual(parseCitedDocuments("1<t>2021-03-09<t>WO reference<t><t>Sáng chế"), [
    { reference_no: "1", reference_date: "2021-03-09", reference_text: "WO reference", claim_type: "", document_type: "Sáng chế" },
  ]);
});
