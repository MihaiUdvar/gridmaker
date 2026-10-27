import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, ASPECTS, presetsForCount, getPreset, computeLayout, layoutFor, scaleSettings,
  exportDimensions, imageRect, panBy, zoomAbout, hitTest, fitSize, BASE_SIDE, MAX_ZOOM,
} from '../layout.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

function overlaps(a, b) {
  return a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
}

test('presets exist for every photo count from 2 to 9', () => {
  for (let n = 2; n <= 9; n++) {
    assert.ok(presetsForCount(n).length >= 2, `count ${n} should have at least 2 presets`);
    for (const p of presetsForCount(n)) assert.equal(p.cells.length, n);
  }
  assert.ok(getPreset('4-grid'));
  assert.equal(getPreset('nope'), null);
});

test('preset ids are unique and every preset fills its track grid without overlaps', () => {
  const ids = new Set();
  for (const p of PRESETS) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    const area = p.cells.reduce((s, c) => s + c.cs * c.rs, 0);
    assert.equal(area, p.cols * p.rows, `${p.id} should cover the whole grid`);
    const rects = computeLayout({ width: p.cols * 100, height: p.rows * 100, preset: p });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i], rects[j]), `${p.id}: cells ${i} and ${j} overlap`);
      assert.ok(rects[i].x >= 0 && rects[i].y >= 0 && rects[i].x + rects[i].w <= p.cols * 100 + 1e-9 && rects[i].y + rects[i].h <= p.rows * 100 + 1e-9);
    }
  }
});

test('2 side by side: exact gap and margin math', () => {
  const rects = computeLayout({ width: 1000, height: 500, preset: getPreset('2-side'), gap: 20, margin: 30 });
  assert.equal(rects.length, 2);
  near(rects[0].x, 30);
  near(rects[0].y, 30);
  near(rects[0].w, (1000 - 60 - 20) / 2);
  near(rects[0].h, 440);
  near(rects[1].x, rects[0].x + rects[0].w + 20);
  near(rects[1].x + rects[1].w, 970);
});

test('2 stacked: gap goes between rows', () => {
  const rects = computeLayout({ width: 400, height: 1000, preset: getPreset('2-stack'), gap: 10 });
  near(rects[0].h, 495);
  near(rects[1].y, 505);
  near(rects[1].y + rects[1].h, 1000);
});

test('3 in a row: equal widths with gaps between', () => {
  const rects = computeLayout({ width: 920, height: 300, preset: getPreset('3-row'), gap: 10 });
  for (const r of rects) near(r.w, 300);
  near(rects[1].x, 310);
  near(rects[2].x, 620);
});

test('1 big + 2 small: the big cell spans both rows including the gap', () => {
  const rects = computeLayout({ width: 800, height: 600, preset: getPreset('3-big-left'), gap: 20 });
  near(rects[0].w, 390);
  near(rects[0].h, 600);
  near(rects[1].x, 410);
  near(rects[1].h, 290);
  near(rects[2].y, 310);
  near(rects[1].y + rects[1].h + 20, rects[2].y);
});

test('2×2 and 3×3 grids', () => {
  const g4 = computeLayout({ width: 410, height: 410, preset: getPreset('4-grid'), gap: 10 });
  for (const r of g4) { near(r.w, 200); near(r.h, 200); }
  near(g4[3].x, 210); near(g4[3].y, 210);

  const g9 = computeLayout({ width: 320, height: 320, preset: getPreset('9-grid'), gap: 10 });
  for (const r of g9) { near(r.w, 100); near(r.h, 100); }
  near(g9[8].x, 220); near(g9[8].y, 220);
});

test('asymmetric rows preset (2 over 3) lines up with the outer edges', () => {
  const rects = computeLayout({ width: 600, height: 400, preset: getPreset('5-2-3'), gap: 0 });
  near(rects[0].w, 300); near(rects[1].w, 300);
  near(rects[2].w, 200); near(rects[3].w, 200); near(rects[4].w, 200);
  near(rects[1].x + rects[1].w, 600);
  near(rects[4].x + rects[4].w, 600);
});

test('corner radius is clamped to half the cell size', () => {
  const rects = computeLayout({ width: 100, height: 20, preset: getPreset('2-side'), radius: 50 });
  near(rects[0].r, 10);
});

test('oversized gap/margin never produce negative sizes', () => {
  const rects = computeLayout({ width: 100, height: 100, preset: getPreset('3-row'), gap: 80, margin: 10 });
  for (const r of rects) assert.ok(r.w >= 0 && r.h >= 0);
});

test('export dimensions are ≈16 MP, even, and under the iOS 16.78 MP canvas limit', () => {
  for (const id of Object.keys(ASPECTS)) {
    const { width, height } = exportDimensions(id);
    assert.equal(width % 2, 0);
    assert.equal(height % 2, 0);
    const px = width * height;
    assert.ok(Math.abs(px - 16e6) / 16e6 < 0.002, `${id}: ${width}×${height} = ${px}`);
    assert.ok(px <= 16777216, `${id} exceeds the iOS canvas pixel limit`);
    near(width / height, ASPECTS[id].w / ASPECTS[id].h, 0.002);
  }
  assert.deepEqual(exportDimensions('1:1'), { width: 4000, height: 4000 });
  assert.deepEqual(exportDimensions('4:5'), { width: 3578, height: 4472 });
  assert.deepEqual(exportDimensions('9:16'), { width: 3000, height: 5334 });
});

test('layoutFor scales settings so the export is an exact scaled copy of the preview', () => {
  const preset = getPreset('6-big-left');
  const settings = { gap: 12, margin: 6, radius: 9 };
  const preview = layoutFor(400, 500, preset, settings);
  const { width, height } = exportDimensions('4:5');
  const exported = layoutFor(width, height, preset, settings);
  const k = width / 400;
  preview.forEach((p, i) => {
    near(exported[i].x, p.x * k, 0.5);
    near(exported[i].y, p.y * k, 0.5);
    near(exported[i].w, p.w * k, 0.5);
    near(exported[i].h, p.h * k, 0.5);
    near(exported[i].r, p.r * k, 0.5);
  });
  const s = scaleSettings(settings, BASE_SIDE, 2000);
  assert.deepEqual(s, { gap: 12, margin: 6, radius: 9 });
});

test('fitSize keeps the aspect ratio inside the box', () => {
  const a = fitSize(4 / 5, 400, 1000);
  near(a.width, 400); near(a.height, 500);
  const b = fitSize(16 / 9, 400, 100);
  near(b.height, 100); near(b.width, 1600 / 9);
});

test('imageRect cover-fits and centers by default', () => {
  const cell = { x: 10, y: 10, w: 200, h: 100 };
  const r = imageRect(cell, 400, 400); // square image into a wide cell
  near(r.w, 200); near(r.h, 200);
  near(r.x, 10); near(r.y, 10 - 50);
  near(r.overflowX, 0); near(r.overflowY, 100);
});

test('zoom enlarges about the cell center and pan is clamped', () => {
  const cell = { x: 0, y: 0, w: 100, h: 100 };
  const z = imageRect(cell, 100, 100, { zoom: 2, pan: { x: 0.5, y: 0.5 } });
  near(z.w, 200); near(z.x, -50); near(z.y, -50);
  const edge = imageRect(cell, 100, 100, { zoom: 2, pan: { x: 5, y: -5 } });
  near(edge.x, -100); near(edge.y, 0);
  const over = imageRect(cell, 100, 100, { zoom: 100, pan: { x: 0.5, y: 0.5 } });
  near(over.w, 100 * MAX_ZOOM);
});

test('panBy moves the image with the finger and stops at the edges', () => {
  const cell = { x: 0, y: 0, w: 100, h: 100 };
  const start = { zoom: 2, pan: { x: 0.5, y: 0.5 } };
  const v = panBy(start, cell, 100, 100, 25, 0); // drag right by 25px
  near(v.pan.x, 0.25);
  near(imageRect(cell, 100, 100, v).x, -25);
  const far = panBy(start, cell, 100, 100, 1000, 0);
  near(far.pan.x, 0);
  // no overflow → pan stays centered
  const none = panBy({ zoom: 1, pan: { x: 0.5, y: 0.5 } }, cell, 100, 100, 30, 30);
  near(none.pan.x, 0.5); near(none.pan.y, 0.5);
});

test('zoomAbout keeps the image point under the finger fixed', () => {
  const cell = { x: 0, y: 0, w: 100, h: 100 };
  const start = { zoom: 2, pan: { x: 0.5, y: 0.5 } };
  const point = { x: 30, y: 70 };
  const before = imageRect(cell, 100, 100, start);
  const u = (point.x - before.x) / before.w;
  const t = (point.y - before.y) / before.h;
  const v = zoomAbout(start, cell, 100, 100, 1.5, point);
  near(v.zoom, 3);
  const after = imageRect(cell, 100, 100, v);
  near((point.x - after.x) / after.w, u);
  near((point.y - after.y) / after.h, t);
});

test('hitTest finds the cell under a point', () => {
  const rects = computeLayout({ width: 200, height: 100, preset: getPreset('2-side'), gap: 10 });
  assert.equal(hitTest(rects, 10, 50), 0);
  assert.equal(hitTest(rects, 150, 50), 1);
  assert.equal(hitTest(rects, 100, 50), -1); // in the gap
  assert.equal(hitTest(rects, -5, 50), -1);
});
