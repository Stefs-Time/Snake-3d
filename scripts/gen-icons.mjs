#!/usr/bin/env node
/**
 * Icon generator.
 *
 * The app icons are drawn here at build time and written straight out as PNGs,
 * so no binary asset is ever committed to the repository. There is no image
 * library involved: the artwork is described with signed distance fields,
 * rasterised into an RGBA buffer with analytic antialiasing, and encoded by the
 * ~40 line PNG writer at the bottom of this file (zlib comes from Node itself).
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* ============================================================== drawing == */

/** Signed distance to a rounded box centred on the origin. */
function sdRoundBox(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - halfW + radius;
  const qy = Math.abs(py) - halfH + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

/** Coverage of a shape at a pixel, antialiased over roughly one pixel. */
const coverage = (distance, softness = 1) =>
  Math.max(0, Math.min(1, 0.5 - distance / softness));

/** Soft outward falloff, for neon bloom. */
const bloom = (distance, radius) =>
  distance <= 0 ? 1 : Math.max(0, Math.exp(-((distance / radius) ** 1.6)));

const mix = (a, b, t) => a + (b - a) * t;

function over(dst, i, r, g, b, alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  dst[i] = mix(dst[i], r, a);
  dst[i + 1] = mix(dst[i + 1], g, a);
  dst[i + 2] = mix(dst[i + 2], b, a);
  dst[i + 3] = Math.max(dst[i + 3], a * 255);
}

/**
 * Render the cabinet mark: a neon screen bezel with a coiled snake inside,
 * chasing one pellet. `padding` is the fraction of the canvas kept clear,
 * which is what makes the maskable variant safe under an aggressive crop.
 */
function renderIcon(size, { padding = 0.06, background = true } = {}) {
  const pixels = new Float64Array(size * size * 4);
  const centre = size / 2;
  const unit = size / 100; // work in a 100x100 design space
  const inset = size * padding;

  // Design-space geometry.
  const bezelHalf = (size - inset * 2) / 2;
  const bezelRadius = bezelHalf * 0.28;
  const strokeWidth = Math.max(1.5, unit * 5.2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5 - centre;
      const py = y + 0.5 - centre;

      /* --- 1. the dark plate --- */
      if (background) {
        const plate = sdRoundBox(px, py, size / 2, size / 2, size * 0.22);
        const plateAlpha = coverage(plate, 1.4);
        // A faint radial lift so the black is not flat.
        const radial = Math.max(0, 1 - Math.hypot(px, py) / (size * 0.72));
        const r = 4 + radial * 12;
        const g = 6 + radial * 18;
        const b = 11 + radial * 34;
        over(pixels, i, r, g, b, plateAlpha);
      }

      /* --- 2. the bezel: a ring with a cyan-to-magenta sweep --- */
      const bezel = sdRoundBox(px, py, bezelHalf, bezelHalf * 0.82, bezelRadius);
      const ring = Math.abs(bezel) - strokeWidth / 2;
      const ringAlpha = coverage(ring, 1.5);

      // Diagonal gradient across the mark.
      const t = Math.max(0, Math.min(1, (px / bezelHalf + py / bezelHalf + 2) / 4));
      const ringR = mix(0, 255, t);
      const ringG = mix(229, 46, t);
      const ringB = mix(255, 136, t);

      if (ringAlpha > 0) over(pixels, i, ringR, ringG, ringB, ringAlpha);
      // Outer glow.
      const ringGlow = bloom(ring, unit * 5) * 0.4;
      if (ringGlow > 0.01 && ringAlpha < 1) {
        over(pixels, i, ringR, ringG, ringB, ringGlow * (1 - ringAlpha));
      }

      /* --- 3. the snake: four segments stepping up and to the right --- */
      const seg = unit * 10.4;
      const gap = unit * 10.8;
      // The group runs from -gap to +1.85gap, so shift it left to sit centred.
      const shift = -gap * 0.42;
      const segments = [
        [shift - gap, gap * 0.5],
        [shift, gap * 0.5],
        [shift, -gap * 0.5],
        [shift + gap, -gap * 0.5],
      ];

      let snakeAlpha = 0;
      let snakeGlow = 0;
      let head = 0;
      segments.forEach(([sx, sy], index) => {
        const d = sdRoundBox(px - sx, py - sy, seg / 2, seg / 2, seg * 0.24);
        const a = coverage(d, 1.4);
        if (a > snakeAlpha) {
          snakeAlpha = a;
          head = index / (segments.length - 1);
        }
        snakeGlow = Math.max(snakeGlow, bloom(d, unit * 4) * 0.45);
      });

      if (snakeGlow > 0.01) over(pixels, i, 57, 255, 136, snakeGlow * (1 - snakeAlpha));
      if (snakeAlpha > 0) {
        // The head end is brighter than the tail.
        const shade = 0.62 + head * 0.38;
        over(pixels, i, 57 * shade + 20, 255 * shade, 136 * shade + 20, snakeAlpha);
      }

      /* --- 4. the pellet, one step ahead of the head --- */
      const pelletX = px - (shift + gap * 2);
      const pelletY = py - gap * 0.5;
      const pellet = Math.hypot(pelletX, pelletY) - unit * 3.9;
      const pelletAlpha = coverage(pellet, 1.4);
      const pelletGlow = bloom(pellet, unit * 5) * 0.5;
      if (pelletGlow > 0.01) over(pixels, i, 255, 210, 63, pelletGlow * (1 - pelletAlpha));
      if (pelletAlpha > 0) over(pixels, i, 255, 210, 63, pelletAlpha);
    }
  }

  // Float buffer -> 8-bit RGBA.
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < pixels.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(pixels[i])));
  }
  return out;
}

/* =============================================================== encoder = */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode an RGBA buffer as a PNG. Filter type 0 on every scanline. */
function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ================================================================= main == */

const TARGETS = [
  { file: 'icon-32.png', size: 32, options: { padding: 0.04 } },
  { file: 'icon-180.png', size: 180, options: { padding: 0.06 } },
  { file: 'icon-192.png', size: 192, options: { padding: 0.06 } },
  { file: 'icon-512.png', size: 512, options: { padding: 0.06 } },
  // Maskable icons get cropped to a circle on some launchers, so the artwork
  // is pulled well inside the safe zone.
  { file: 'maskable-512.png', size: 512, options: { padding: 0.19 } },
];

mkdirSync(OUT_DIR, { recursive: true });

let total = 0;
for (const { file, size, options } of TARGETS) {
  const rgba = renderIcon(size, options);
  const png = encodePng(rgba, size, size);
  writeFileSync(join(OUT_DIR, file), png);
  total += png.length;
  console.log(`  icons/${file.padEnd(18)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

console.log(`\n  ${TARGETS.length} icons generated (${(total / 1024).toFixed(1)} kB total)\n`);
