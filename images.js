// images.js — decoding photos into drawable bitmaps, with EXIF orientation,
// optional downscaling, and graceful fallbacks for files the browser cannot
// decode natively (HEIC/HEIF outside Safari → bundled wasm decoder).

export const PREVIEW_MAX_SIDE = 1600;

// Lazy-loaded HEIC decoder (vendor/heic2any.min.js, MIT, libheif compiled to
// wasm). Only fetched the first time a HEIC file fails native decoding.
const HEIC_DECODER_URL = './vendor/heic2any.min.js';
const HEIC_CONVERT_QUALITY = 0.95;

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not be decoded'));
    };
    img.src = url;
  });
}

/** Oriented natural width/height of an image blob (cheap: no full bitmap kept). */
export async function probeDimensions(blob) {
  const { img, url } = await loadImageElement(blob);
  const dims = { width: img.naturalWidth, height: img.naturalHeight };
  URL.revokeObjectURL(url);
  if (!dims.width || !dims.height) throw new Error('has no image data');
  return dims;
}

async function tryCreateImageBitmap(blob, opts) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image', ...opts });
  } catch (e) {
    // Older Safari throws TypeError for the 'from-image' enum value but applies
    // EXIF orientation anyway. Retry without the option.
  }
  try {
    return await createImageBitmap(blob, opts);
  } catch (e) {
    return null;
  }
}

function canvasSource(drawable, w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(drawable, 0, 0, c.width, c.height);
  return c;
}

/**
 * Decode a blob into a drawable.
 * @param blob         File/Blob (JPEG, PNG, WebP, GIF, or HEIC where the browser supports it)
 * @param opts.maxSide longest side of the resulting bitmap (default: original size)
 * @param opts.natural { width, height } if already known (skips the probe)
 * @returns { source, width, height, naturalWidth, naturalHeight, close() }
 */
export async function decodeImage(blob, { maxSide = Infinity, natural } = {}) {
  const nat = natural || (await probeDimensions(blob));
  const longest = Math.max(nat.width, nat.height);
  const ratio = Math.min(1, maxSide / longest);

  const opts = {};
  if (ratio < 1) {
    // Only one dimension so the browser keeps the aspect ratio regardless of
    // whether it applies the resize before or after EXIF rotation.
    opts.resizeWidth = Math.max(1, Math.round(nat.width * ratio));
    opts.resizeQuality = 'high';
  }

  let bitmap = await tryCreateImageBitmap(blob, opts);

  if (!bitmap) {
    // Fallback: <img> decode (applies EXIF orientation in all modern browsers).
    const { img, url } = await loadImageElement(blob);
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));
    const c = canvasSource(img, w, h);
    URL.revokeObjectURL(url);
    return wrap(c, nat, () => { c.width = 0; c.height = 0; });
  }

  // If the browser ignored resizeWidth, downscale manually to respect the cap.
  if (Math.max(bitmap.width, bitmap.height) > maxSide * 1.02) {
    const k = maxSide / Math.max(bitmap.width, bitmap.height);
    const c = canvasSource(bitmap, bitmap.width * k, bitmap.height * k);
    bitmap.close();
    return wrap(c, nat, () => { c.width = 0; c.height = 0; });
  }

  return wrap(bitmap, nat, () => { try { bitmap.close(); } catch (_) { /* noop */ } });
}

function wrap(source, nat, close) {
  return {
    source,
    width: source.width,
    height: source.height,
    naturalWidth: nat.width,
    naturalHeight: nat.height,
    close,
  };
}

// ---------------------------------------------------------------------------
// HEIC / HEIF
// ---------------------------------------------------------------------------

export function isLikelyHeic(file) {
  const name = (file.name || '').toLowerCase();
  return /\.(heic|heif|hif)$/.test(name) || /heic|heif/.test((file.type || '').toLowerCase());
}

/** Sniff the ISO-BMFF 'ftyp' box for HEIF brands (works when name/type are missing). */
export async function sniffHeic(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    if (head.length < 16) return false;
    const ascii = Array.from(head, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    if (ascii.slice(4, 8) !== 'ftyp') return false;
    return /heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1|avif/.test(ascii.slice(8, 64));
  } catch (_) {
    return false;
  }
}

let decoderPromise = null;
function loadHeicDecoder() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (decoderPromise) return decoderPromise;
  decoderPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HEIC_DECODER_URL;
    s.async = true;
    s.onload = () => (window.heic2any ? resolve(window.heic2any) : reject(new Error('HEIC decoder failed to initialise')));
    s.onerror = () => reject(new Error('HEIC decoder could not be loaded'));
    document.head.appendChild(s);
  });
  decoderPromise.catch(() => { decoderPromise = null; });
  return decoderPromise;
}

/** Convert a HEIC/HEIF blob to JPEG with the bundled wasm decoder. */
export async function convertHeicToJpeg(blob) {
  const heic2any = await loadHeicDecoder();
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: HEIC_CONVERT_QUALITY });
  const jpeg = Array.isArray(out) ? out[0] : out;
  if (!jpeg || !jpeg.size) throw new Error('HEIC conversion produced no image');
  return jpeg;
}

/**
 * Make sure a picked file is something the browser can decode.
 * JPEG/PNG/WebP (and HEIC in Safari) pass straight through. HEIC/HEIF that the
 * browser cannot decode is converted to JPEG with the bundled decoder.
 *
 * @returns { blob, type, converted: boolean, natural: { width, height } }
 */
export async function normalizeImageFile(file, { onStatus } = {}) {
  try {
    const natural = await probeDimensions(file);
    return { blob: file, type: file.type || 'image/jpeg', converted: false, natural };
  } catch (nativeError) {
    const heic = isLikelyHeic(file) || (await sniffHeic(file));
    if (!heic) throw nativeError;
    if (onStatus) onStatus('Converting HEIC…');
    const jpeg = await convertHeicToJpeg(file);
    const natural = await probeDimensions(jpeg);
    return { blob: jpeg, type: 'image/jpeg', converted: true, natural };
  }
}
