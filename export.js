// export.js — renders the collage at 16 MP into an offscreen canvas and
// returns a Blob. Designed around iOS Safari's canvas limits:
//   * the export canvas is sized exactly to the export dimensions, never larger
//   * each photo is decoded at just the size its cell needs, drawn, and freed
//     before the next one is decoded
//   * if the canvas fails to allocate, or toBlob returns null, we retry once
//     at a smaller size and report the actual output resolution

import { exportDimensions, layoutFor, toEven, imageRect } from './layout.js';
import { drawCollage } from './render.js';
import { decodeImage } from './images.js';

const RETRY_SCALE = 0.9; // linear → ~81% of the pixels (~13 MP)

export const FORMATS = {
  'image/jpeg': { ext: 'jpg', label: 'JPEG', quality: 0.92 },
  'image/png': { ext: 'png', label: 'PNG' },
};

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch (e) {
      reject(e);
    }
  });
}

/** Throws if a canvas of this size cannot actually be drawn to (iOS silently fails). */
function probeCanvas(ctx, width, height) {
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(width - 1, height - 1, 1, 1);
  const px = ctx.getImageData(width - 1, height - 1, 1, 1).data;
  if (px[0] !== 255 || px[1] !== 0 || px[2] !== 0) {
    throw new Error('Canvas of ' + width + '×' + height + ' could not be allocated');
  }
}

async function renderToBlob(project, { width, height }, type, quality, onProgress) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: type !== 'image/jpeg' });
  if (!ctx) throw new Error('Could not create a 2D context');

  try {
    probeCanvas(ctx, width, height);

    const resolveImage = async (photo, cell) => {
      // Decode only as large as this cell needs at full export scale.
      const nat = { width: photo.naturalWidth, height: photo.naturalHeight };
      const rect = imageRect(cell, nat.width, nat.height, photo);
      const needed = Math.ceil(Math.max(rect.w, rect.h));
      const maxSide = Math.min(Math.max(nat.width, nat.height), needed);
      const img = await decodeImage(photo.blob, { maxSide, natural: nat });
      return { source: img.source, width: img.width, height: img.height, release: img.close };
    };

    await drawCollage(ctx, {
      width,
      height,
      preset: project.preset,
      settings: project.settings,
      photos: project.photos,
      resolveImage,
      onCell: onProgress,
    });

    const blob = await canvasToBlob(canvas, type, quality);
    return blob;
  } finally {
    // Release the backing store immediately (important on iOS).
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Export the project.
 * @param project { aspect, preset, settings, photos: [{ blob, naturalWidth, naturalHeight, zoom, pan }] }
 * @param opts    { type: 'image/jpeg' | 'image/png', quality, onProgress(done, total) }
 * @returns { blob, file, width, height, reduced, requested: { width, height } }
 */
export async function exportCollage(project, { type = 'image/jpeg', quality, onProgress } = {}) {
  const fmt = FORMATS[type] || FORMATS['image/jpeg'];
  const q = quality ?? fmt.quality;
  const requested = exportDimensions(project.aspect);
  let dims = { ...requested };
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const blob = await renderToBlob(project, dims, type, q, onProgress);
      if (blob && blob.size > 0) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = new File([blob], 'gridmaker-' + stamp + '.' + fmt.ext, { type: blob.type || type });
        return { blob, file, width: dims.width, height: dims.height, reduced: attempt > 0, requested };
      }
      lastError = new Error('toBlob returned null');
    } catch (e) {
      lastError = e;
    }
    dims = { width: toEven(dims.width * RETRY_SCALE), height: toEven(dims.height * RETRY_SCALE) };
  }
  throw lastError || new Error('Export failed');
}

/** True if navigator.share can share this file (iOS 15+, Android Chrome). */
export function canShareFile(file) {
  try {
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
  } catch (_) {
    return false;
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/** Preview export cell sizes in px (used for UI hints). */
export function exportCells(project) {
  const { width, height } = exportDimensions(project.aspect);
  return layoutFor(width, height, project.preset, project.settings);
}
