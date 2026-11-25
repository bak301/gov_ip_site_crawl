'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { extractPatentListRecords } = require('./wipo_patent_list');

test('patent list extraction handles cards and legacy table rows', () => {
    const dom = new JSDOM(`
      <div class="thumbnail">
        <input type="checkbox" value="VN1202107441">
        <img class="rs-DRAWING" src="/application/VN1202107441/thumbnail">
        <div class="product-content">
          <span class="rs-TITL">PHƯƠNG PHÁP TRUYỀN THÔNG</span>
          <span class="rs-AFNB_ORI">1-2021-07441</span><span class="rs-AFDT">04.05.2021</span>
          <span class="rs-GZNB"><ul><li>407A</li></ul></span><span class="rs-PBNB">84346</span>
          <span class="rs-PBDT">04.11.2026</span>
          <span class="rs-IPC_ORI">H04W 52/36</span>
          <span class="rs-APNA">TELEFONAKTIEBOLAGET LM ERICSSON (PUBL)</span>
          <span class="rs-INNA">HARRISON, Robert Mark</span>
          <span class="rs-STLB_ORI">q. SC Chờ duyệt CV 251, 252</span>
          <span class="rs-PCCT"><ul><li>US</li><li>VN</li></ul></span>
          <span class="rs-PCNB"><ul><li>US62/842,131</li><li>1-2019-00001</li></ul></span>
          <span class="rs-PCDT"><ul><li></li><li>04.05.2019</li></ul></span>
          <span class="rs-ABST"><ul><li>Điều khiển mạng.</li></ul></span>
        </div>
      </div>
      <table><tr id="VN2202601070" class="odd"><td>
        <span class="rs-AFNB_ORI">2-2026-01070</span>
        <span class="rs-TITL">TỦ LẠNH</span><span class="rs-STLB">SC Chờ chia đơn ND (2)</span>
        <span class="rs-IPC_ORI"><ul><li>F25D 17/08</li><li>F25D 25/02</li></ul></span>
        <span class="rs-APPL_SUBTYP">non-PCT Utility</span>
      </td></tr></table>
    `, { runScripts: 'outside-only' });
    const extract = dom.window.eval(`(${extractPatentListRecords.toString()})`);
    const rows = JSON.parse(JSON.stringify(extract('tr.odd, .thumbnail .product-content')));
    assert.deepEqual(rows[0], [
        'VN1202107441', 'PHƯƠNG PHÁP TRUYỀN THÔNG', '1-2021-07441', '04.05.2021', '84346',
        '04.11.2026', '', '', 'H04W 52/36', 'TELEFONAKTIEBOLAGET LM ERICSSON (PUBL)', 'HARRISON, Robert Mark',
        'q. SC Chờ duyệt CV 251, 252', 'US | VN', 'US62/842,131 | 1-2019-00001', ' | 04.05.2019',
        '407A', 'Điều khiển mạng.', '/application/VN1202107441/thumbnail', ''
    ]);
    assert.equal(rows[1][0], 'VN2202601070');
    assert.equal(rows[1][8], 'F25D 17/08 | F25D 25/02');
    assert.equal(rows[1][11], 'SC Chờ chia đơn ND (2)');
    assert.equal(rows[1][18], 'non-PCT Utility');
});
