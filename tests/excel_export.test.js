const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createOriginalOutputWorkbook } = require('../wipo_excel_export');

test('Excel export retains the original Execution Hub output layout and transformations', async () => {
  const detail = {
    applicationNo: '1-2022-01543',
    latest: {
      data: {
        image: 'https://example.test/drawing',
        fields: {
          'Loại đơn': 'PCT national phase SC',
          '(10) Số bằng và ngày cấp': '1-0050358-000 17.07.2025',
          '(180) Ngày hết hạn': '20.08.2040',
          '(54) Tên': 'Patent title',
        },
        diary: [{ date_text: '20.08.2020', description: 'Filing', extra: ['Filed'] }],
      },
    },
  };
  const generated = await createOriginalOutputWorkbook([detail]);
  const buffer = await generated.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  assert.deepEqual(loaded.worksheets.map((sheet) => sheet.name), ['Output']);
  const sheet = loaded.getWorksheet('Output');
  const headers = sheet.getRow(1).values.slice(1);
  assert.deepEqual(headers.slice(0, 7), ['ID', 'Image', 'Loại đơn', 'Loại đơn PCT', 'Reg. No.', 'Reg. Date (dd/mm/yyyy)', 'Trạng thái']);
  const row = sheet.getRow(2).values.slice(1);
  assert.equal(row[0], '1-2022-01543');
  assert.equal(row[2], 'PCT national phase SC');
  assert.equal(row[4], '50358');
  assert.equal(row[5], '17/07/2025');
  assert.equal(row[7], '20/08/2040');
  assert.equal(row.at(-1), '20/08/2020 - Filing - Filed');
  assert.equal(sheet.views, null);
  const progressColumn = sheet.getColumn(headers.indexOf('Tiến trình') + 1);
  assert.equal(progressColumn.width, 50);
  assert.equal(progressColumn.alignment.wrapText, true);
});

test('mixed exports create type-specific patent, design, and trademark worksheets', async () => {
  const detail = (id, type, fields) => ({ applicationNo: id, latest: { data: { id, type, fields, diary: [] } } });
  const workbook = await createOriginalOutputWorkbook([
    detail('1-2022-01543', 'PATENTS', { '(54) Tên': 'Patent' }),
    detail('3-2020-04567', 'DESIGNS', { '(54) Tên kiểu dáng': 'Design' }),
    detail('4-2004-14651', 'TRADEMARKS', { '(541) Nhãn hiệu': 'Mark', '(511) Nhóm sản phẩm/dịch vụ': 'Class/Nhóm 09: Software' }),
  ]);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Patents', 'Designs', 'Trademarks']);
  assert.ok(workbook.getWorksheet('Designs').getRow(1).values.includes('(51/52) Phân loại Locarno'));
  assert.ok(workbook.getWorksheet('Trademarks').getRow(1).values.includes('(511) Nhóm sản phẩm/dịch vụ'));
});

test('trademark export converts lf markers and embeds the logo image', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const detail = {
    applicationNo: '4-2025-31926',
    latest: { data: {
      id: '4-2025-31926', type: 'TRADEMARKS', image: `data:image/png;base64,${png}`,
      fields: {
        'Loại đơn': 'Nhãn hiệu', '(100) Số bằng và ngày cấp': 'Thông thường', '(180) Ngày hết hạn': 'Từ chối',
        '(400) Số công bố và ngày công bố': 'VN -4-2025-31926 17.11.2023', '(541) Nhãn hiệu': '190004 25.12.2025',
        '(591) Màu sắc nhãn hiệu': 'S.Kidman', '(300) Chi tiết về dữ liệu ưu tiên': 'Nâu, trắng.',
        '(511) Nhóm sản phẩm/dịch vụ': 'AU 2375463 | AU | 2375463 | 27.07.2023',
        '(531) Phân loại hình': 'Class/Nhóm 18: Vali và túi du lịch.<lf>Class/Nhóm 25: Quần áo; đồ đi ở chân; đồ đội đầu.',
        '(740) Đại diện SHCN': 'S. Kidman Clothing Co Pty Ltd : Brisbane', '(571) Nhãn hiệu': 'Vision & Associates : Hà Nội',
        '(526) Yếu tố loại trừ': 'Combined',
      }, diary: [],
    } },
  };
  const generated = await createOriginalOutputWorkbook([detail]);
  const buffer = await generated.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  const sheet = loaded.getWorksheet('Output');
  const headers = sheet.getRow(1).values.slice(1);
  const goodsColumn = headers.indexOf('(511) Nhóm sản phẩm/dịch vụ') + 1;
  assert.equal(sheet.getCell(2, goodsColumn).value, 'Class/Nhóm 18: Vali và túi du lịch.\nClass/Nhóm 25: Quần áo; đồ đi ở chân; đồ đội đầu.');
  assert.equal(sheet.getColumn(goodsColumn).alignment.wrapText, true);
  assert.equal(sheet.getCell('B2').value, '');
  assert.equal(sheet.getImages().length, 1);
  assert.ok(sheet.getRow(2).height >= 62);
});
