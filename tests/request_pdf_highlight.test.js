'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const helperUrl = pathToFileURL(path.join(__dirname, '..', 'electron', 'renderer', 'publication-viewer.mjs')).href;

test('request number is found inside a longer PDF text item', async () => {
  const { findRequestTextRanges } = await import(helperUrl);
  const items = [{ str: 'u: DT1-2025-06965 Ngày n' }];
  assert.deepEqual(findRequestTextRanges(items, 'DT1-2025-06965'), [{ itemIndex: 0, start: 3, end: 17 }]);
  assert.deepEqual(findRequestTextRanges(items, 'DT1-2025-06966'), []);
});

test('request number is found when PDF text is split across items', async () => {
  const { findRequestTextRanges } = await import(helperUrl);
  const items = [{ str: 'DT1-2025-' }, { str: '06965' }];
  assert.deepEqual(findRequestTextRanges(items, 'DT1-2025-06965'), [
    { itemIndex: 0, start: 0, end: 8 },
    { itemIndex: 1, start: 0, end: 5 },
  ]);
});

test('request highlight paints the matching part of a PDF line, not the full line', async () => {
  const { paintRequestTextHighlights } = await import(helperUrl);
  const rectangles = [];
  const context = {
    save() {}, restore() {}, setTransform() {},
    fillRect(...args) { rectangles.push(args); },
  };
  const item = { str: 'u: DT1-2025-06965 Ngày n', width: 148, height: 13, transform: [13, 0, 0, 13, 158, 383] };
  const pdfjsLib = { Util: { transform: (_viewport, transform) => transform } };
  assert.equal(paintRequestTextHighlights(context, pdfjsLib, { transform: [], scale: 1 }, 1, [item], 'DT1-2025-06965'), 1);
  assert.equal(rectangles.length, 1);
  assert.ok(rectangles[0][0] > 158);
  assert.ok(rectangles[0][2] < 148);
});
