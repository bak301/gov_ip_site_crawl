const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { extractTrademarkFields } = require("../trademark_detail_parser");

test("trademark fields stay attached to their labels when optional rows are absent", () => {
  const html = `
    <div class="product-form-label">Loại đơn</div><div class="product-form-details">Nhãn hiệu</div>
    <div class="product-form-label">Trạng thái</div><div class="product-form-details">Từ chối</div>
    <div class="product-form-label">(200) Số đơn và Ngày nộp đơn</div><div class="product-form-details">VN 4-2025-31926 17.11.2023</div>
    <div class="product-form-label">(541) Nhãn hiệu</div><div class="product-form-details">S.Kidman</div>
    <div class="product-form-label">(511) Nhóm sản phẩm/dịch vụ</div>
    <div class="product-form-details">
      <div class="row"><div class="col-md-2">18</div><div class="col-md-10">Vali và túi du lịch.</div></div>
      <div class="row"><div class="col-md-2">25</div><div class="col-md-10">Quần áo; đồ đi ở chân; đồ đội đầu.</div></div>
    </div>
    <div class="product-form-label">(730) Chủ đơn/Chủ bằng</div><div class="product-form-details">S. Kidman Clothing Co Pty Ltd : Brisbane</div>
    <div class="product-form-label">(740) Đại diện SHCN</div><div class="product-form-details">Công ty TNHH Tầm nhìn và Liên danh : Hà Nội</div>`;
  const fields = extractTrademarkFields(new JSDOM(html).window.document);

  assert.equal(fields["Trạng thái"], "Từ chối");
  assert.equal(fields["(541) Nhãn hiệu"], "S.Kidman");
  assert.equal(fields["(511) Nhóm sản phẩm/dịch vụ"], "Class/Nhóm 18: Vali và túi du lịch.<lf>Class/Nhóm 25: Quần áo; đồ đi ở chân; đồ đội đầu.");
  assert.equal(fields["(730) Chủ đơn/Chủ bằng"], "S. Kidman Clothing Co Pty Ltd : Brisbane");
  assert.equal(fields["(740) Đại diện SHCN"], "Công ty TNHH Tầm nhìn và Liên danh : Hà Nội");
  assert.equal(fields["(100) Số bằng và ngày cấp"], undefined);
});
