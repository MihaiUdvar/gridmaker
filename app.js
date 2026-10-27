// app.js — UI, gestures, persistence wiring. Layout math lives in layout.js,
// drawing in render.js, export in export.js, IndexedDB in storage.js.

import {
  ASPECTS, MAX_PHOTOS, aspectRatio, fitSize, exportDimensions,
  presetsForCount, getPreset, computeLayout, imageRect, hitTest,
  panBy, zoomAbout, defaultView, clampView,
} from './layout.js';
import { drawCollage, roundedRect } from './render.js';
import { decodeImage, normalizeImageFile, PREVIEW_MAX_SIDE, isLikelyHeic } from './images.js';
import { exportCollage, canShareFile, formatBytes, FORMATS } from './export.js';
import { loadProject, saveProject, savePhoto, deletePhoto, clearAll } from './storage.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  photos: [],            // { id, blob, name, type, naturalWidth, naturalHeight, img, zoom, pan }
  aspect: '4:5',
  presetId: null,
  presetByCount: {},     // remember the chosen preset per photo count
  settings: { gap: 8, margin: 0, radius: 0, background: '#ffffff' },
  format: 'image/jpeg',
  selected: -1,
  lastExport: null,
};

const $ = (id) => document.getElementById(id);
const el = {
  stage: $('stage'),
  canvas: $('preview'),
  empty: $('empty'),
  fileInput: $('file-input'),
  thumbs: $('thumbs'),
  photoCount: $('photo-count'),
  clearBtn: $('clear-btn'),
  aspectChips: $('aspect-chips'),
  presetChips: $('preset-chips'),
  presetName: $('preset-name'),
  gap: $('gap'), gapOut: $('gap-out'),
  margin: $('margin'), marginOut: $('margin-out'),
  radius: $('radius'), radiusOut: $('radius-out'),
  bgChips: $('bg-chips'),
  bgColor: $('bg-color'),
  customDot: $('custom-dot'),
  format: $('format'),
  exportBtn: $('export-btn'),
  exportDims: $('export-dims'),
  exportStatus: $('export-status'),
  exportResult: $('export-result'),
  exportInfo: $('export-info'),
  saveBtn: $('save-btn'),
  saveHint: $('save-hint'),
  toast: $('toast'),
};

const ctx = el.canvas.getContext('2d');
const view = { width: 0, height: 0, dpr: 1 }; // preview canvas logical (CSS px) size
let cells = [];

function currentPreset() {
  return getPreset(state.presetId) || presetsForCount(state.photos.length)[0] || null;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(message, ms = 3200) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let saveTimer = 0;
function projectRecord() {
  return {
    aspect: state.aspect,
    presetId: state.presetId,
    presetByCount: state.presetByCount,
    settings: { ...state.settings },
    format: state.format,
    photos: state.photos.map((p) => ({
      id: p.id, name: p.name, type: p.type,
      naturalWidth: p.naturalWidth, naturalHeight: p.naturalHeight,
      zoom: p.zoom, pan: { ...p.pan },
    })),
    savedAt: Date.now(),
  };
}

function scheduleSave(delay = 300) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, delay);
}

function flushSave() {
  clearTimeout(saveTimer);
  saveProject(projectRecord()).catch((e) => console.warn('save failed', e));
}

async function restore() {
  let saved;
  try {
    saved = await loadProject();
  } catch (e) {
    console.warn('restore failed', e);
    return;
  }
  if (!saved) return;
  const { project, photos } = saved;
  if (project.aspect in ASPECTS) state.aspect = project.aspect;
  if (project.settings) state.settings = { ...state.settings, ...project.settings };
  if (project.format in FORMATS) state.format = project.format;
  state.presetByCount = project.presetByCount || {};
  state.presetId = project.presetId;

  const restored = [];
  for (const rec of project.photos || []) {
    const stored = photos.get(rec.id);
    if (!stored) continue;
    try {
      const img = await decodeImage(stored.blob, { maxSide: PREVIEW_MAX_SIDE, natural: {
        width: stored.naturalWidth, height: stored.naturalHeight,
      } });
      const v = clampView({ zoom: rec.zoom, pan: rec.pan });
      restored.push({ ...stored, img, zoom: v.zoom, pan: v.pan });
    } catch (e) {
      console.warn('could not restore photo', rec.name, e);
    }
  }
  state.photos = restored;
  if (restored.length) toast('Restored your previous collage');
}

// ---------------------------------------------------------------------------
// Canvas sizing + rendering
// ---------------------------------------------------------------------------

function fitCanvas() {
  const rect = el.stage.getBoundingClientRect();
  const cs = getComputedStyle(el.stage);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const maxW = Math.max(50, rect.width - padX);
  const maxH = Math.max(50, rect.height - padY);
  const { width, height } = fitSize(aspectRatio(state.aspect), maxW, maxH);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  view.width = Math.round(width);
  view.height = Math.round(height);
  view.dpr = dpr;
  el.canvas.style.width = view.width + 'px';
  el.canvas.style.height = view.height + 'px';
  el.canvas.width = Math.round(view.width * dpr);
  el.canvas.height = Math.round(view.height * dpr);
}

let frame = 0;
function render() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw().catch((e) => console.error(e));
  });
}

async function draw() {
  const preset = currentPreset();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  if (!preset || !state.photos.length) {
    cells = [];
    ctx.fillStyle = state.settings.background;
    ctx.fillRect(0, 0, view.width, view.height);
    return;
  }

  cells = await drawCollage(ctx, {
    width: view.width,
    height: view.height,
    preset,
    settings: state.settings,
    photos: state.photos,
    resolveImage: (photo) => (photo.img ? { source: photo.img.source, width: photo.img.width, height: photo.img.height } : null),
  });

  // Selection + swap overlays (preview only).
  const sel = cells[state.selected];
  if (sel) {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3b82f6';
    roundedRect(ctx, sel.x + 1.5, sel.y + 1.5, sel.w - 3, sel.h - 3, Math.max(0, sel.r - 1.5));
    ctx.stroke();
    ctx.restore();
  }

  if (gesture && gesture.kind === 'swap') {
    const src = cells[gesture.cell];
    const photo = state.photos[gesture.cell];
    if (src && photo && photo.img) {
      ctx.save();
      roundedRect(ctx, src.x, src.y, src.w, src.h, src.r);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      const target = cells[gesture.target];
      if (target && gesture.target !== gesture.cell) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#22c55e';
        roundedRect(ctx, target.x + 2, target.y + 2, target.w - 4, target.h - 4, Math.max(0, target.r - 2));
        ctx.stroke();
      }
      // Floating ghost of the picked-up photo.
      const gw = Math.min(140, src.w * 0.6);
      const gh = gw * (src.h / src.w);
      const ghost = { x: gesture.ghost.x - gw / 2, y: gesture.ghost.y - gh / 2, w: gw, h: gh };
      const r = imageRect(ghost, photo.img.width, photo.img.height, photo);
      ctx.globalAlpha = 0.9;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 16;
      roundedRect(ctx, ghost.x, ghost.y, ghost.w, ghost.h, 8);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.clip();
      ctx.drawImage(photo.img.source, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Gestures (Pointer Events). Single finger: tap to select, drag to pan.
// Two fingers: pinch to zoom about the midpoint. Long-press then drag: pick
// up the photo and drop it on another cell to swap. Double-tap: reset.
// ---------------------------------------------------------------------------

const pointers = new Map();
let gesture = null;
let lastTap = { time: 0, cell: -1 };
const LONG_PRESS_MS = 380;
const MOVE_SLOP = 8;

function canvasPoint(e) {
  const r = el.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function midpoint() {
  const pts = [...pointers.values()];
  return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
}

function distance() {
  const pts = [...pointers.values()];
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

function onPointerDown(e) {
  if (!cells.length) return;
  e.preventDefault();
  try { el.canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events have no active pointer */ }
  const p = canvasPoint(e);
  pointers.set(e.pointerId, p);

  if (pointers.size === 1) {
    const idx = hitTest(cells, p.x, p.y);
    if (idx < 0) {
      gesture = null;
      return;
    }
    if (idx !== state.selected) {
      state.selected = idx;
      updateThumbSelection();
      render();
    }
    gesture = {
      kind: 'pan',
      cell: idx,
      start: p,
      last: p,
      moved: false,
      startTime: performance.now(),
      timer: setTimeout(() => {
        if (gesture && !gesture.moved && pointers.size === 1) {
          gesture.kind = 'swap';
          gesture.ghost = gesture.last;
          gesture.target = -1;
          if (navigator.vibrate) navigator.vibrate(10);
          render();
        }
      }, LONG_PRESS_MS),
    };
  } else if (pointers.size === 2 && gesture) {
    clearTimeout(gesture.timer);
    gesture.kind = 'pinch';
    gesture.moved = true;
    gesture.lastDist = distance();
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId) || !gesture) return;
  e.preventDefault();
  const p = canvasPoint(e);
  pointers.set(e.pointerId, p);
  const photo = state.photos[gesture.cell];
  const cell = cells[gesture.cell];
  if (!photo || !cell) return;

  if (gesture.kind === 'pan' && pointers.size === 1) {
    const dx = p.x - gesture.last.x;
    const dy = p.y - gesture.last.y;
    gesture.last = p;
    if (!gesture.moved && Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > MOVE_SLOP) {
      gesture.moved = true;
      clearTimeout(gesture.timer);
    }
    if (gesture.moved && photo.img) {
      const v = panBy(photo, cell, photo.img.width, photo.img.height, dx, dy);
      photo.zoom = v.zoom;
      photo.pan = v.pan;
      render();
    }
  } else if (gesture.kind === 'pinch' && pointers.size === 2) {
    const d = distance();
    if (gesture.lastDist > 0 && photo.img) {
      const v = zoomAbout(photo, cell, photo.img.width, photo.img.height, d / gesture.lastDist, midpoint());
      photo.zoom = v.zoom;
      photo.pan = v.pan;
      render();
    }
    gesture.lastDist = d;
  } else if (gesture.kind === 'swap') {
    gesture.ghost = p;
    gesture.target = hitTest(cells, p.x, p.y);
    render();
  }
}

function onPointerUp(e) {
  if (!pointers.has(e.pointerId)) return;
  e.preventDefault();
  const p = canvasPoint(e);
  pointers.delete(e.pointerId);
  if (!gesture) return;

  if (gesture.kind === 'swap') {
    const target = hitTest(cells, p.x, p.y);
    if (target >= 0 && target !== gesture.cell) {
      const a = state.photos[gesture.cell];
      state.photos[gesture.cell] = state.photos[target];
      state.photos[target] = a;
      state.selected = target;
      rebuildThumbs();
      scheduleSave();
    }
    clearTimeout(gesture.timer);
    gesture = null;
    render();
    return;
  }

  if (gesture.kind === 'pinch') {
    if (pointers.size === 1) {
      // One finger lifted: continue as a pan with the remaining finger.
      gesture.kind = 'pan';
      gesture.last = [...pointers.values()][0];
    } else {
      gesture = null;
      scheduleSave();
    }
    return;
  }

  // Pan or tap.
  clearTimeout(gesture.timer);
  if (gesture.moved) {
    scheduleSave();
  } else {
    const now = performance.now();
    if (now - lastTap.time < 320 && lastTap.cell === gesture.cell) {
      const photo = state.photos[gesture.cell];
      if (photo) Object.assign(photo, defaultView());
      lastTap = { time: 0, cell: -1 };
      scheduleSave();
      render();
    } else {
      lastTap = { time: now, cell: gesture.cell };
    }
  }
  if (pointers.size === 0) gesture = null;
}

function onPointerCancel(e) {
  pointers.delete(e.pointerId);
  if (gesture) clearTimeout(gesture.timer);
  if (pointers.size === 0) {
    gesture = null;
    render();
  }
}

function bindGestures() {
  const c = el.canvas;
  c.addEventListener('pointerdown', onPointerDown);
  c.addEventListener('pointermove', onPointerMove);
  c.addEventListener('pointerup', onPointerUp);
  c.addEventListener('pointercancel', onPointerCancel);
  c.addEventListener('lostpointercapture', onPointerCancel);
  // Belt and braces: stop Safari's own scroll / pinch zoom on the canvas.
  const block = (e) => e.preventDefault();
  c.addEventListener('touchstart', block, { passive: false });
  c.addEventListener('touchmove', block, { passive: false });
  c.addEventListener('gesturestart', block);
  c.addEventListener('gesturechange', block);
  c.addEventListener('contextmenu', block);
  c.addEventListener('wheel', (e) => {
    // Desktop convenience: wheel zooms the cell under the cursor.
    if (!cells.length) return;
    e.preventDefault();
    const p = canvasPoint(e);
    const idx = hitTest(cells, p.x, p.y);
    const photo = state.photos[idx];
    if (!photo || !photo.img) return;
    state.selected = idx;
    const v = zoomAbout(photo, cells[idx], photo.img.width, photo.img.height, e.deltaY < 0 ? 1.08 : 1 / 1.08, p);
    photo.zoom = v.zoom;
    photo.pan = v.pan;
    updateThumbSelection();
    render();
    scheduleSave();
  }, { passive: false });
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}

async function addFiles(files) {
  const room = MAX_PHOTOS - state.photos.length;
  if (room <= 0) {
    toast('Maximum of ' + MAX_PHOTOS + ' photos reached');
    return;
  }
  const list = [...files].filter((f) => f && f.size > 0).slice(0, room);
  if (files.length > room) toast('Only the first ' + room + ' photos were added (max ' + MAX_PHOTOS + ')');

  const failed = [];
  let converted = 0;
  el.exportStatus.textContent = 'Loading ' + list.length + ' photo' + (list.length === 1 ? '' : 's') + '…';
  for (const file of list) {
    try {
      // JPEG/PNG/WebP (and HEIC in Safari) decode natively; other HEIC/HEIF is
      // converted to JPEG with the bundled wasm decoder.
      const norm = await normalizeImageFile(file, {
        onStatus: (s) => { el.exportStatus.textContent = s + ' ' + (file.name || ''); },
      });
      const img = await decodeImage(norm.blob, { maxSide: PREVIEW_MAX_SIDE, natural: norm.natural });
      if (norm.converted) converted++;
      const photo = {
        id: uid(),
        blob: norm.blob,
        name: norm.converted ? (file.name || 'photo').replace(/\.(heic|heif|hif)$/i, '') + '.jpg' : file.name,
        type: norm.type,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        img,
        ...defaultView(),
      };
      state.photos.push(photo);
      savePhoto(photo).catch((e) => console.warn('photo save failed', e));
      ensurePreset();
      refreshUI();
      render();
    } catch (e) {
      console.warn('could not load', file.name, e);
      failed.push((file.name || 'photo') + (isLikelyHeic(file) ? ' (HEIC)' : ''));
    }
  }
  el.exportStatus.textContent = '';
  if (converted) toast('Converted ' + converted + ' HEIC photo' + (converted === 1 ? '' : 's') + ' to JPEG');
  if (failed.length) {
    toast("Couldn't decode: " + failed.join(', ') + '. Try exporting the photo as JPEG first.', 6000);
  }
  if (state.photos.length === 1) toast('Add at least one more photo for a grid');
  scheduleSave();
}

function removePhoto(index) {
  const [photo] = state.photos.splice(index, 1);
  if (!photo) return;
  if (photo.img) photo.img.close();
  deletePhoto(photo.id).catch(() => {});
  if (state.selected >= state.photos.length) state.selected = state.photos.length - 1;
  ensurePreset();
  refreshUI();
  render();
  scheduleSave();
}

function clearPhotos() {
  if (!state.photos.length) return;
  if (!confirm('Remove all photos from this collage?')) return;
  state.photos.forEach((p) => p.img && p.img.close());
  state.photos = [];
  state.selected = -1;
  state.lastExport = null;
  el.exportResult.classList.add('hidden');
  clearAll().catch(() => {});
  ensurePreset();
  refreshUI();
  render();
  scheduleSave();
}

function ensurePreset() {
  const n = state.photos.length;
  const options = presetsForCount(n);
  if (!options.length) {
    state.presetId = null;
    return;
  }
  const current = getPreset(state.presetId);
  if (!current || current.count !== n) {
    const remembered = getPreset(state.presetByCount[n]);
    state.presetId = remembered && remembered.count === n ? remembered.id : options[0].id;
  }
  state.presetByCount[n] = state.presetId;
}

// ---------------------------------------------------------------------------
// UI building
// ---------------------------------------------------------------------------

function presetIcon(preset) {
  const ratio = aspectRatio(state.aspect);
  const { width, height } = fitSize(ratio, 36, 36);
  const rects = computeLayout({ width, height, preset, gap: 2.5, margin: 0, radius: 1.5 });
  const ox = (36 - width) / 2;
  const oy = (36 - height) / 2;
  const body = rects.map((r) =>
    '<rect x="' + (ox + r.x).toFixed(2) + '" y="' + (oy + r.y).toFixed(2) + '" width="' + r.w.toFixed(2) +
    '" height="' + r.h.toFixed(2) + '" rx="' + r.r.toFixed(2) + '"/>').join('');
  return '<svg viewBox="0 0 36 36" aria-hidden="true">' + body + '</svg>';
}

function buildAspectChips() {
  el.aspectChips.innerHTML = '';
  for (const id of Object.keys(ASPECTS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.textContent = id;
    b.dataset.aspect = id;
    b.addEventListener('click', () => {
      state.aspect = id;
      updateAspectChips();
      buildPresetChips();
      fitCanvas();
      render();
      updateExportDims();
      scheduleSave();
    });
    el.aspectChips.appendChild(b);
  }
  updateAspectChips();
}

function updateAspectChips() {
  for (const b of el.aspectChips.children) b.setAttribute('aria-checked', String(b.dataset.aspect === state.aspect));
}

function buildPresetChips() {
  el.presetChips.innerHTML = '';
  const n = state.photos.length;
  const options = presetsForCount(n || 2);
  for (const p of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip preset';
    b.setAttribute('role', 'radio');
    b.dataset.preset = p.id;
    b.innerHTML = presetIcon(p) + '<span>' + p.name + '</span>';
    b.disabled = n === 0;
    b.addEventListener('click', () => {
      state.presetId = p.id;
      state.presetByCount[n] = p.id;
      updatePresetChips();
      render();
      scheduleSave();
    });
    el.presetChips.appendChild(b);
  }
  updatePresetChips();
}

function updatePresetChips() {
  const current = currentPreset();
  for (const b of el.presetChips.children) b.setAttribute('aria-checked', String(current && b.dataset.preset === current.id));
  el.presetName.textContent = current && state.photos.length ? current.name : '';
}

function rebuildThumbs() {
  el.thumbs.innerHTML = '';
  state.photos.forEach((photo, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb';
    b.title = photo.name || 'Photo ' + (i + 1);
    const c = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = 56 * dpr;
    c.height = 56 * dpr;
    if (photo.img) {
      const tctx = c.getContext('2d');
      const r = imageRect({ x: 0, y: 0, w: c.width, h: c.height }, photo.img.width, photo.img.height, defaultView());
      tctx.drawImage(photo.img.source, r.x, r.y, r.w, r.h);
    }
    b.appendChild(c);
    const x = document.createElement('span');
    x.className = 'x';
    x.setAttribute('role', 'button');
    x.setAttribute('aria-label', 'Remove photo');
    x.textContent = '×';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      removePhoto(i);
    });
    b.appendChild(x);
    b.addEventListener('click', () => {
      state.selected = i;
      updateThumbSelection();
      render();
    });
    el.thumbs.appendChild(b);
  });
  el.photoCount.textContent = state.photos.length ? state.photos.length + '/' + MAX_PHOTOS : '';
  updateThumbSelection();
}

function updateThumbSelection() {
  [...el.thumbs.children].forEach((b, i) => b.classList.toggle('active', i === state.selected));
}

function updateStyleControls() {
  el.gap.value = state.settings.gap;
  el.gapOut.textContent = state.settings.gap + ' px';
  el.margin.value = state.settings.margin;
  el.marginOut.textContent = state.settings.margin + ' px';
  el.radius.value = state.settings.radius;
  el.radiusOut.textContent = state.settings.radius + ' px';
  const bg = state.settings.background;
  for (const chip of el.bgChips.querySelectorAll('.chip')) {
    const isCustom = chip.id === 'custom-bg-chip';
    const active = isCustom ? bg !== '#ffffff' && bg !== '#000000' : chip.dataset.bg === bg;
    chip.classList.toggle('active', active);
  }
  if (bg !== '#ffffff' && bg !== '#000000') {
    el.bgColor.value = bg;
    el.customDot.style.background = bg;
  } else {
    el.customDot.style.background = el.bgColor.value;
  }
}

function updateExportDims() {
  const { width, height } = exportDimensions(state.aspect);
  el.exportDims.textContent = width + ' × ' + height;
}

function refreshUI() {
  el.empty.classList.toggle('hidden', state.photos.length > 0);
  el.exportBtn.disabled = state.photos.length === 0;
  rebuildThumbs();
  buildPresetChips();
  updateStyleControls();
  updateExportDims();
  el.format.value = state.format;
}

function bindControls() {
  el.fileInput.addEventListener('change', () => {
    const files = el.fileInput.files;
    if (files && files.length) addFiles(files);
    el.fileInput.value = '';
  });
  el.clearBtn.addEventListener('click', clearPhotos);

  const slider = (input, key, out) => {
    input.addEventListener('input', () => {
      state.settings[key] = Number(input.value);
      out.textContent = input.value + ' px';
      render();
      scheduleSave();
    });
  };
  slider(el.gap, 'gap', el.gapOut);
  slider(el.margin, 'margin', el.marginOut);
  slider(el.radius, 'radius', el.radiusOut);

  for (const chip of el.bgChips.querySelectorAll('button.chip')) {
    chip.addEventListener('click', () => {
      state.settings.background = chip.dataset.bg;
      updateStyleControls();
      render();
      scheduleSave();
    });
  }
  el.bgColor.addEventListener('input', () => {
    state.settings.background = el.bgColor.value;
    updateStyleControls();
    render();
    scheduleSave();
  });

  el.format.addEventListener('change', () => {
    state.format = el.format.value;
    scheduleSave();
  });

  el.exportBtn.addEventListener('click', runExport);
  el.saveBtn.addEventListener('click', saveExport);

  // Keep the canvas fitted to the stage.
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => { fitCanvas(); render(); }).observe(el.stage);
  } else {
    window.addEventListener('resize', () => { fitCanvas(); render(); });
  }

  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

  // Drag & drop on desktop.
  el.stage.addEventListener('dragover', (e) => e.preventDefault());
  el.stage.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}

// ---------------------------------------------------------------------------
// Export + save
// ---------------------------------------------------------------------------

let exporting = false;

async function runExport() {
  const preset = currentPreset();
  if (!preset || !state.photos.length || exporting) return;
  exporting = true;
  el.exportBtn.disabled = true;
  el.exportResult.classList.add('hidden');
  state.lastExport = null;
  const type = state.format;
  const total = state.photos.length;
  el.exportStatus.textContent = 'Rendering 0/' + total + '…';

  const project = {
    aspect: state.aspect,
    preset,
    settings: state.settings,
    photos: state.photos.map((p) => ({
      blob: p.blob, naturalWidth: p.naturalWidth, naturalHeight: p.naturalHeight, zoom: p.zoom, pan: p.pan,
    })),
  };

  try {
    const result = await exportCollage(project, {
      type,
      onProgress: (done, n) => { el.exportStatus.textContent = 'Rendering ' + done + '/' + n + '…'; },
    });
    state.lastExport = result;
    const mp = ((result.width * result.height) / 1e6).toFixed(1);
    el.exportInfo.innerHTML =
      '<strong>' + result.width + ' × ' + result.height + ' px</strong> (' + mp + ' MP) · ' +
      formatBytes(result.blob.size) + ' · ' + (FORMATS[type] ? FORMATS[type].label : type);
    el.exportStatus.textContent = result.reduced
      ? 'The full 16 MP canvas could not be allocated on this device, so the export was rendered at ' +
        result.width + ' × ' + result.height + ' instead of ' + result.requested.width + ' × ' + result.requested.height + '.'
      : 'Export ready.';
    const shareable = canShareFile(result.file);
    el.saveBtn.textContent = shareable ? 'Save to Photos…' : 'Open image';
    el.saveHint.textContent = shareable
      ? 'Opens the share sheet. Choose "Save Image" to add it to your photo library.'
      : 'Opens the image in a new tab. Long-press it and choose "Save to Photos".';
    el.exportResult.classList.remove('hidden');
  } catch (e) {
    console.error(e);
    el.exportStatus.textContent = 'Export failed: ' + (e && e.message ? e.message : e);
    toast('Export failed. Try fewer photos or the JPEG format.');
  } finally {
    exporting = false;
    el.exportBtn.disabled = state.photos.length === 0;
  }
}

function saveExport() {
  const result = state.lastExport;
  if (!result) return;
  if (canShareFile(result.file)) {
    navigator.share({ files: [result.file], title: 'GridMaker collage' }).catch((err) => {
      if (err && err.name === 'AbortError') return; // user dismissed the sheet
      console.warn('share failed', err);
      openFallback(result.blob);
    });
  } else {
    openFallback(result.blob);
  }
}

function openFallback(blob) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    // Popup blocked: show it inline instead.
    location.href = url;
  }
  el.saveHint.textContent = 'Long-press the image and choose "Save to Photos" (or right-click → Save on desktop).';
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  buildAspectChips();
  bindControls();
  bindGestures();
  fitCanvas();
  refreshUI();
  render();

  await restore();
  ensurePreset();
  state.selected = state.photos.length ? 0 : -1;
  updateAspectChips();
  fitCanvas();
  refreshUI();
  render();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}

init();
