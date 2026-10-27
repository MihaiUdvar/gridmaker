// render.js — draws a collage onto any 2D canvas context (preview or export).
// The caller sets the transform (e.g. devicePixelRatio) before calling; all
// coordinates here are in logical canvas units of `width` × `height`.

import { layoutFor, imageRect } from './layout.js';

export function roundedRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (r === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPlaceholder(ctx, cell) {
  ctx.save();
  roundedRect(ctx, cell.x, cell.y, cell.w, cell.h, cell.r);
  ctx.fillStyle = 'rgba(128,128,128,0.25)';
  ctx.fill();
  ctx.restore();
}

/**
 * Draw the collage.
 *
 * @param ctx           CanvasRenderingContext2D
 * @param opts.width    logical width of the canvas
 * @param opts.height   logical height of the canvas
 * @param opts.preset   layout preset (from layout.js)
 * @param opts.settings { gap, margin, radius, background } — gap/margin/radius in preview px
 * @param opts.photos   array of { zoom, pan, ... } aligned with preset.cells
 * @param opts.resolveImage(photo, cell, index) → { source, width, height, release? } | Promise | null
 *                      `source` is anything drawImage accepts. `release()` is
 *                      called right after the cell is drawn so the export can
 *                      free each bitmap before decoding the next one.
 * @param opts.onCell(index, total)  optional progress callback
 * @returns the cell rectangles that were used
 */
export async function drawCollage(ctx, { width, height, preset, settings, photos, resolveImage, onCell }) {
  const cells = layoutFor(width, height, preset, settings);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = settings.background || '#ffffff';
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const photo = photos[i];
    if (!photo || cell.w <= 0 || cell.h <= 0) {
      drawPlaceholder(ctx, cell);
      continue;
    }
    const img = await resolveImage(photo, cell, i);
    if (!img) {
      drawPlaceholder(ctx, cell);
      continue;
    }
    const rect = imageRect(cell, img.width, img.height, photo);
    ctx.save();
    roundedRect(ctx, cell.x, cell.y, cell.w, cell.h, cell.r);
    ctx.clip();
    ctx.drawImage(img.source, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    if (typeof img.release === 'function') img.release();
    if (onCell) onCell(i + 1, cells.length);
  }

  ctx.restore();
  return cells;
}
