/**
 * Generate the extension icons with nothing but node:zlib.
 *
 *   node tools/generate-icons.mjs
 *
 * A rounded LinkedIn-blue tile with a white clipboard and a text "page"
 * behind it, drawn analytically and downsampled for the small sizes.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 48, 128];
const SUPERSAMPLE = 4;

const BG = [10, 102, 194];
const FG = [255, 255, 255];
const PAPER = [226, 240, 254];

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((value, i) => Math.round(value + (b[i] - value) * t));

/**
 * Coverage of a rounded rectangle, in [0,1], antialiased over ~1px.
 * `x`/`y` are in unit-square space, `size` converts the signed distance back
 * into pixels.
 */
function roundedRectCoverage(x, y, left, top, right, bottom, radius, size) {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const qx = Math.abs(x - cx) - ((right - left) / 2 - radius);
  const qy = Math.abs(y - cy) - ((bottom - top) / 2 - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  const distance = (outside + inside - radius) * size;
  return Math.min(Math.max(0.5 - distance, 0), 1);
}

/** Paint one supersampled sample, in a [0,1] unit square. */
function shade(u, v, size) {
  const tile = roundedRectCoverage(u, v, 0.02, 0.02, 0.98, 0.98, 0.18, size);
  if (tile <= 0) return null;

  // Paper sheet behind the clipboard.
  const paper = roundedRectCoverage(u, v, 0.3, 0.2, 0.78, 0.8, 0.04, size);
  // Clipboard body sitting on top of the paper.
  const board = roundedRectCoverage(u, v, 0.24, 0.28, 0.7, 0.86, 0.05, size);
  // Clip at the top of the board.
  const clip = roundedRectCoverage(u, v, 0.38, 0.19, 0.56, 0.32, 0.03, size);
  // Text lines carved out of the board.
  const line = Math.max(
    roundedRectCoverage(u, v, 0.33, 0.44, 0.61, 0.48, 0.01, size),
    roundedRectCoverage(u, v, 0.33, 0.55, 0.61, 0.59, 0.01, size),
    roundedRectCoverage(u, v, 0.33, 0.66, 0.5, 0.7, 0.01, size)
  );

  let colour = BG;
  if (paper > 0) colour = mix(colour, PAPER, paper);
  if (board > 0) colour = mix(colour, FG, board);
  if (clip > 0) colour = mix(colour, PAPER, clip);
  if (line > 0) colour = mix(colour, BG, line);
  return { colour, alpha: tile };
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const u = (x + (sx + 0.5) / SUPERSAMPLE) / size;
          const v = (y + (sy + 0.5) / SUPERSAMPLE) / size;
          const pixel = shade(u, v, size);
          if (!pixel) continue;
          r += pixel.colour[0] * pixel.alpha;
          g += pixel.colour[1] * pixel.alpha;
          b += pixel.colour[2] * pixel.alpha;
          a += pixel.alpha;
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const offset = (y * size + x) * 4;
      if (a > 0) {
        rgba[offset] = Math.round(r / a);
        rgba[offset + 1] = Math.round(g / a);
        rgba[offset + 2] = Math.round(b / a);
        rgba[offset + 3] = Math.round((a / samples) * 255);
      }
    }
  }
  return rgba;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log('wrote', file);
}
