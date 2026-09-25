const assert = require("node:assert/strict");
const {
  normalizeMadridInput,
  parseMadridXml,
  extractQueryIdentifier,
  extractMarkImageUrl,
  pctCountryDisplayName,
} = require("../madrid_monitor");

assert.equal(normalizeMadridInput("736887").canonicalId, "5-0736887");
assert.equal(normalizeMadridInput("0736887").canonicalId, "5-0736887");
assert.equal(normalizeMadridInput("5-736887").romId, "ROM.0736887");
assert.equal(normalizeMadridInput("5-1035318").romId, "ROM.1035318");
assert.equal(normalizeMadridInput("0"), null);
assert.equal(normalizeMadridInput("12345678"), null);
assert.equal(normalizeMadridInput("4-2023-59243"), null);

const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<MARKGR EXPDATE="20300623" INTREGD="20000623" INTREGN="736887" OOCD="JP">
  <CURRENT>
    <HOLGR><NAME><NAMEL>SUNTORY HOLDINGS LIMITED</NAMEL></NAME><ADDRESS><ADDRL>1-40, Dojimahama 2-chome,</ADDRL><ADDRL>Kita-ku</ADDRL><COUNTRY>JP</COUNTRY></ADDRESS></HOLGR>
    <REPGR><NAME><NAMEL>SATO Shunji</NAMEL></NAME><ADDRESS><ADDRL>TMI Associates,</ADDRL><ADDRL>23rd Floor</ADDRL><COUNTRY>JP</COUNTRY></ADDRESS></REPGR>
    <IMAGE COLOUR="N" NAME="0736887" TEXT="SUNTORY" TYPE="NIL"/>
    <BASICGS><GSGR NICCLAI="31"><GSTERMEN>Animal foodstuffs; seeds and bulbs.</GSTERMEN></GSGR></BASICGS>
  </CURRENT>
  <ENN GAZNO="2000/15 Gaz" PUBDATE="20000831"/>
</MARKGR>`;

const parsed = parseMadridXml(xml, "0736887");
assert.equal(parsed.values.length, 20);
assert.equal(parsed.values[3], "0736887 23.06.2000");
assert.equal(parsed.values[6], "5-0736887 23.06.2000");
assert.equal(parsed.values[11], "Class/Nhóm 31: Animal foodstuffs; seeds and bulbs.");
assert.equal(parsed.values[13], "SUNTORY HOLDINGS LIMITED: 1-40, Dojimahama 2-chome, Kita-ku, Japan");
assert.equal(parsed.values[14], "SATO Shunji: TMI Associates, 23rd Floor, Japan");
assert.equal(parsed.metadata.classes[0].class_number, "31");
assert.equal(pctCountryDisplayName("JP"), "Japan");
assert.equal(pctCountryDisplayName("KR"), "Republic of Korea");

const page = '<img src="/madrid/monitor/jsp/data.jsp?KEY=ROM_ACT.LOGO_WIPO_FULL&amp;LOGO=1&amp;TYPE=jpg&amp;qi=abc/123+=">';
assert.equal(extractQueryIdentifier(page), "abc/123+=");
const markPage = '<table><tr><td class="mark"><img src="/madrid/monitor/jsp/data.jsp?KEY=ROM_ACT.1035318&amp;TYPE=jpg&amp;qi=abc%2F123"></td></tr></table>';
assert.equal(
  extractMarkImageUrl(markPage, "https://www3.wipo.int/madrid/monitor/en/showData.jsp"),
  "https://www3.wipo.int/madrid/monitor/jsp/data.jsp?KEY=ROM_ACT.1035318&TYPE=jpg&qi=abc%2F123"
);

console.log("Madrid Monitor parser tests passed.");
