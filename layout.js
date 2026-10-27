// layout.js — pure layout math shared by the live preview and the export.
// No DOM access here. Everything is deterministic and unit-testable.

export const MAX_PHOTOS = 9;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
export const EXPORT_PIXELS = 16_000_000;

// Gap / margin / radius settings are expressed in "preview pixels": the value
// they have when the shorter side of the canvas is BASE_SIDE px. For any other
// canvas size they scale proportionally, so the export is an exact scaled copy
// of the preview.
export const BASE_SIDE = 400;

export const ASPECTS = {
  '1:1':  { w: 1,  h: 1 },
  '4:5':  { w: 4,  h: 5 },
  '3:4':  { w: 3,  h: 4 },
  '9:16': { w: 9,  h: 16 },
  '16:9': { w: 16, h: 9 },
};

export function aspectRatio(id) {
  const a = ASPECTS[id];
  if (!a) throw new Error('Unknown aspect ratio: ' + id);
  return a.w / a.h;
}

/** Export size for an aspect ratio so that width*height ≈ targetPixels, both even. */
export function exportDimensions(aspectId, targetPixels = EXPORT_PIXELS) {
  const ratio = aspectRatio(aspectId);
  const width = Math.sqrt(targetPixels * ratio);
  const height = width / ratio;
  return { width: toEven(width), height: toEven(height) };
}

export function toEven(n) {
  return Math.max(2, 2 * Math.round(n / 2));
}

/** Largest box with `ratio` that fits inside maxW×maxH. */
export function fitSize(ratio, maxW, maxH) {
  let width = maxW;
  let height = width / ratio;
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  return { width, height };
}

// ---------------------------------------------------------------------------
// Presets. Each preset is a track grid (cols × rows) and a list of cells that
// span [c, c+cs) × [r, r+rs). Gaps are placed between tracks, so cells that
// span several tracks also absorb the gaps in between — every row/column lines
// up exactly regardless of how asymmetric the layout is.
// ---------------------------------------------------------------------------

function cell(c, r, cs = 1, rs = 1) {
  return { c, r, cs, rs };
}

function uniform(cols, rows) {
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(cell(c, r));
  return { cols, rows, cells };
}

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return (a * b) / gcd(a, b); }

/** Rows with a given number of equal cells each, e.g. [2, 3] → 2 on top, 3 below. */
function rowsOf(counts) {
  const cols = counts.reduce((acc, n) => lcm(acc, n), 1);
  const cells = [];
  counts.forEach((n, r) => {
    const span = cols / n;
    for (let j = 0; j < n; j++) cells.push(cell(j * span, r, span, 1));
  });
  return { cols, rows: counts.length, cells };
}

function preset(id, name, grid) {
  return { id, name, count: grid.cells.length, ...grid };
}

export const PRESETS = [
  // 1 (only used if a single photo is loaded)
  preset('1-single', 'Single', uniform(1, 1)),
  // 2
  preset('2-side', 'Side by side', uniform(2, 1)),
  preset('2-stack', 'Stacked', uniform(1, 2)),
  preset('2-wide-narrow', 'Wide + narrow', { cols: 3, rows: 1, cells: [cell(0, 0, 2, 1), cell(2, 0, 1, 1)] }),
  preset('2-narrow-wide', 'Narrow + wide', { cols: 3, rows: 1, cells: [cell(0, 0, 1, 1), cell(1, 0, 2, 1)] }),
  preset('2-tall-short', 'Tall + short', { cols: 1, rows: 3, cells: [cell(0, 0, 1, 2), cell(0, 2, 1, 1)] }),
  // 3
  preset('3-row', '3 in a row', uniform(3, 1)),
  preset('3-col', '3 stacked', uniform(1, 3)),
  preset('3-big-left', '1 big + 2 small', { cols: 2, rows: 2, cells: [cell(0, 0, 1, 2), cell(1, 0), cell(1, 1)] }),
  preset('3-big-right', '2 small + 1 big', { cols: 2, rows: 2, cells: [cell(0, 0), cell(0, 1), cell(1, 0, 1, 2)] }),
  preset('3-big-top', '1 big top + 2', { cols: 2, rows: 2, cells: [cell(0, 0, 2, 1), cell(0, 1), cell(1, 1)] }),
  preset('3-big-bottom', '2 + 1 big bottom', { cols: 2, rows: 2, cells: [cell(0, 0), cell(1, 0), cell(0, 1, 2, 1)] }),
  // 4
  preset('4-grid', '2 × 2', uniform(2, 2)),
  preset('4-row', '4 in a row', uniform(4, 1)),
  preset('4-col', '4 stacked', uniform(1, 4)),
  preset('4-big-left', '1 big + 3 small', { cols: 2, rows: 3, cells: [cell(0, 0, 1, 3), cell(1, 0), cell(1, 1), cell(1, 2)] }),
  preset('4-big-top', '1 big top + 3', { cols: 3, rows: 2, cells: [cell(0, 0, 3, 1), cell(0, 1), cell(1, 1), cell(2, 1)] }),
  preset('4-1-3', '1 over 3', rowsOf([1, 3])),
  // 5
  preset('5-2-3', '2 over 3', rowsOf([2, 3])),
  preset('5-3-2', '3 over 2', rowsOf([3, 2])),
  preset('5-big-left', '1 big + 4 small', { cols: 4, rows: 2, cells: [cell(0, 0, 2, 2), cell(2, 0), cell(3, 0), cell(2, 1), cell(3, 1)] }),
  preset('5-big-top', '1 big top + 4', rowsOf([1, 4])),
  // 6
  preset('6-grid', '3 × 2', uniform(3, 2)),
  preset('6-grid-tall', '2 × 3', uniform(2, 3)),
  preset('6-big-left', '1 big + 5 small', { cols: 3, rows: 3, cells: [cell(0, 0, 2, 2), cell(2, 0), cell(2, 1), cell(0, 2), cell(1, 2), cell(2, 2)] }),
  preset('6-1-2-3', '1 / 2 / 3', rowsOf([1, 2, 3])),
  // 7
  preset('7-3-4', '3 over 4', rowsOf([3, 4])),
  preset('7-4-3', '4 over 3', rowsOf([4, 3])),
  preset('7-2-2-3', '2 / 2 / 3', rowsOf([2, 2, 3])),
  preset('7-big-top', '1 big top + 6', { cols: 3, rows: 4, cells: [cell(0, 0, 3, 2), cell(0, 2), cell(1, 2), cell(2, 2), cell(0, 3), cell(1, 3), cell(2, 3)] }),
  // 8
  preset('8-grid', '4 × 2', uniform(4, 2)),
  preset('8-grid-tall', '2 × 4', uniform(2, 4)),
  preset('8-3-2-3', '3 / 2 / 3', rowsOf([3, 2, 3])),
  preset('8-1-3-4', '1 / 3 / 4', rowsOf([1, 3, 4])),
  // 9
  preset('9-grid', '3 × 3', uniform(3, 3)),
  preset('9-big-left', '1 big + 8 small', { cols: 4, rows: 3, cells: [cell(0, 0, 2, 2), cell(2, 0), cell(3, 0), cell(2, 1), cell(3, 1), cell(0, 2), cell(1, 2), cell(2, 2), cell(3, 2)] }),
  preset('9-1-4-4', '1 / 4 / 4', rowsOf([1, 4, 4])),
];

export function presetsForCount(count) {
  return PRESETS.filter((p) => p.count === count);
}

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

// ---------------------------------------------------------------------------
// Cell rectangles
// ---------------------------------------------------------------------------

/**
 * Compute cell rectangles for a preset on a canvas of the given size.
 * gap, margin and radius are in canvas pixels.
 * Returns [{ x, y, w, h, r }] in the same order as preset.cells.
 */
export function computeLayout({ width, height, preset, gap = 0, margin = 0, radius = 0 }) {
  const innerW = Math.max(0, width - 2 * margin);
  const innerH = Math.max(0, height - 2 * margin);
  const trackW = Math.max(0, (innerW - (preset.cols - 1) * gap) / preset.cols);
  const trackH = Math.max(0, (innerH - (preset.rows - 1) * gap) / preset.rows);
  return preset.cells.map(({ c, r, cs, rs }) => {
    const x = margin + c * (trackW + gap);
    const y = margin + r * (trackH + gap);
    const w = Math.max(0, cs * trackW + (cs - 1) * gap);
    const h = Math.max(0, rs * trackH + (rs - 1) * gap);
    return { x, y, w, h, r: Math.max(0, Math.min(radius, w / 2, h / 2)) };
  });
}

/** Scale preview-pixel settings to a target canvas size. */
export function scaleSettings(settings, width, height) {
  const k = Math.min(width, height) / BASE_SIDE;
  return {
    gap: (settings.gap || 0) * k,
    margin: (settings.margin || 0) * k,
    radius: (settings.radius || 0) * k,
  };
}

/** The one layout function both preview and export call. */
export function layoutFor(width, height, preset, settings) {
  return computeLayout({ width, height, preset, ...scaleSettings(settings, width, height) });
}

// ---------------------------------------------------------------------------
// Per-cell image placement (pan/zoom are normalized, resolution independent)
//   view.zoom: 1 = cover fit, >1 zooms in
//   view.pan:  {x, y} in 0..1 — which part of the overflow is hidden on the
//              left/top. 0.5 = centered.
// ---------------------------------------------------------------------------

export function defaultView() {
  return { zoom: 1, pan: { x: 0.5, y: 0.5 } };
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function clampView(view) {
  return {
    zoom: clamp(Number.isFinite(view?.zoom) ? view.zoom : 1, MIN_ZOOM, MAX_ZOOM),
    pan: {
      x: clamp(Number.isFinite(view?.pan?.x) ? view.pan.x : 0.5, 0, 1),
      y: clamp(Number.isFinite(view?.pan?.y) ? view.pan.y : 0.5, 0, 1),
    },
  };
}

/** Rectangle (in canvas px) where an image of imgW×imgH is drawn inside a cell. */
export function imageRect(cellRect, imgW, imgH, view = defaultView()) {
  const v = clampView(view);
  const cover = Math.max(cellRect.w / imgW, cellRect.h / imgH);
  const scale = cover * v.zoom;
  const w = imgW * scale;
  const h = imgH * scale;
  const overflowX = Math.max(0, w - cellRect.w);
  const overflowY = Math.max(0, h - cellRect.h);
  return {
    x: cellRect.x - v.pan.x * overflowX,
    y: cellRect.y - v.pan.y * overflowY,
    w,
    h,
    scale,
    overflowX,
    overflowY,
  };
}

/** Pan an image by a pixel delta (drag). Returns a new view. */
export function panBy(view, cellRect, imgW, imgH, dx, dy) {
  const v = clampView(view);
  const rect = imageRect(cellRect, imgW, imgH, v);
  const x = rect.overflowX > 0 ? v.pan.x - dx / rect.overflowX : 0.5;
  const y = rect.overflowY > 0 ? v.pan.y - dy / rect.overflowY : 0.5;
  return clampView({ zoom: v.zoom, pan: { x, y } });
}

/** Multiply zoom by `factor`, keeping the image point under `point` fixed. */
export function zoomAbout(view, cellRect, imgW, imgH, factor, point) {
  const v = clampView(view);
  const before = imageRect(cellRect, imgW, imgH, v);
  const u = (point.x - before.x) / before.w;
  const t = (point.y - before.y) / before.h;
  const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const after = imageRect(cellRect, imgW, imgH, { zoom, pan: { x: 0.5, y: 0.5 } });
  const targetX = point.x - u * after.w;
  const targetY = point.y - t * after.h;
  const x = after.overflowX > 0 ? (cellRect.x - targetX) / after.overflowX : 0.5;
  const y = after.overflowY > 0 ? (cellRect.y - targetY) / after.overflowY : 0.5;
  return clampView({ zoom, pan: { x, y } });
}

/** Index of the cell containing point (x, y), or -1. */
export function hitTest(cells, x, y) {
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return i;
  }
  return -1;
}
