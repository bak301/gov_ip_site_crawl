const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const displayHash = require(path.resolve(__dirname, "..", "..", "electron-app", "softip_display_hash.js"));

test("shared display hashes preserve capitalization while normalizing harmless formatting", () => {
  const base = "Gwangyang Iron & Steel Works";
  assert.equal(displayHash.shortHash(`  ${base}  `), displayHash.shortHash(base));
  assert.equal(displayHash.shortHash(`Gwangyang  Iron\n& Steel Works`), displayHash.shortHash(base));
  assert.notEqual(displayHash.shortHash(base), displayHash.shortHash("GWANGYANG IRON & STEEL WORKS"));
});

test("shared display hashes normalize equivalent Unicode and retain the six-character contract", () => {
  assert.equal(displayHash.shortHash("Café"), displayHash.shortHash("Cafe\u0301"));
  assert.match(displayHash.shortHash("POSCO CO., LTD"), /^[0-9a-f]{6}$/);
  assert.equal(displayHash.shortHash(""), "------");
});
