// Generates icons/icon.svg and icons/icon-{180,192,512}.png with no
// dependencies (tiny PNG encoder on top of node:zlib).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

// --- PNG encoder -----------------------------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Scene (unit square) ---------------------------------------------------
// Gradient background, 2×2 grid of white rounded cells with a gap.
const A = [37, 99, 235];   // #2563eb
const B = [124, 58, 237];  // #7c3aed
const MARGIN = 0.2, GAP = 0.06, RADIUS = 0.07;
const cellSize = (1 - 2 * MARGIN - GAP) / 2;
const cellsUnit = [];
for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
  cellsUnit.push({ x: MARGIN + c * (cellSize + GAP), y: MARGIN + r * (cellSize + GAP), w: cellSize, h: cellSize });
}

function insideRounded(px, py, { x, y, w, h }, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function sample(u, v) {
  for (const c of cellsUnit) if (insideRounded(u, v, c, RADIUS)) return [255, 255, 255];
  const t = (u + v) / 2;
  return [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * t));
}

function renderPNG(size) {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const [cr, cg, cb] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        r += cr; g += cg; b += cb;
      }
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / (SS * SS));
      rgba[i + 1] = Math.round(g / (SS * SS));
      rgba[i + 2] = Math.round(b / (SS * SS));
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

for (const size of [180, 192, 512]) {
  writeFileSync(join(outDir, 'icon-' + size + '.png'), renderPNG(size));
  console.log('wrote icons/icon-' + size + '.png');
}

const svgCells = cellsUnit.map((c) =>
  '<rect x="' + (c.x * 100).toFixed(2) + '" y="' + (c.y * 100).toFixed(2) + '" width="' + (c.w * 100).toFixed(2) +
  '" height="' + (c.h * 100).toFixed(2) + '" rx="' + (RADIUS * 100).toFixed(2) + '" fill="#fff"/>').join('\n  ');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n' +
  '  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>\n' +
  '  <rect width="100" height="100" fill="url(#g)"/>\n  ' + svgCells + '\n</svg>\n';
writeFileSync(join(outDir, 'icon.svg'), svg);
console.log('wrote icons/icon.svg');
