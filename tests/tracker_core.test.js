const test = require("node:test");
const assert = require("node:assert/strict");
const { parseApplicationNumbers, getRecordApplicationNo, diffRecords, parseCitedDocuments } = require("../tracker_core");

test("application list input is normalized and deduplicated", () => {
  assert.deepEqual(parseApplicationNumbers("VN 1-2022-01097\n1-2022-01097, 1-2021-00452"), ["1-2022-01097", "1-2021-00452"]);
});

test("patent, design, national trademark, international trademark, and compact WIPO IDs are accepted", () => {
  assert.deepEqual(
    parseApplicationNumbers("2-2024-01234\n3-2020-4567\n4-2004-14651\n5-2025-123456\nhttps://wipopublish.ipvietnam.gov.vn/detail?id=VN4200414651"),
    ["2-2024-01234", "3-2020-4567", "4-2004-14651", "5-2025-123456"]
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
