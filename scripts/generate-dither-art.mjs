// Renders the monochrome dithered artwork that sits in the side gutters.
// Output is 1-bit (opaque or transparent) PNGs used as CSS masks, so the
// colour comes from the active site theme.
//
//   node scripts/generate-dither-art.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT_DIR = new URL('../public/images/dither/', import.meta.url);

// 8x8 Bayer matrix, normalised to thresholds in (0, 1).
const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((row) => row.map((v) => (v + 0.5) / 64));

// Deterministic value noise so the output is stable between runs.
function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v));
}

function normalize([x, y, z]) {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

// Shades a sphere and returns brightness in [0, 1], or null outside it.
function sphere(px, py, { cx, cy, r, light, seed, texture = 0, craters = [] }) {
  const dx = (px - cx) / r;
  const dy = (py - cy) / r;
  const d2 = dx * dx + dy * dy;
  if (d2 > 1) return null;
  const nz = Math.sqrt(1 - d2);
  const n = [dx, dy, nz];

  let shade = clamp(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);

  if (texture) {
    // Sample noise on the sphere surface so bands wrap convincingly.
    const bands = fbm(dx * 3 + nz * 2, dy * 9, seed);
    shade *= 1 - texture + texture * (0.55 + bands * 0.9);
  }

  for (const c of craters) {
    const cd = Math.hypot(dx - c.x, dy - c.y) / c.r;
    if (cd < 1) {
      // Dark floor with a bright rim on the lit side.
      const rim = cd > 0.75 ? 0.25 : -0.35;
      shade = clamp(shade + rim * shade);
    }
  }

  // Soft limb darkening.
  return clamp(shade * (0.35 + 0.65 * Math.pow(nz, 0.35)));
}

function render(width, height, fn) {
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tone = fn(x, y);
      bits[y * width + x] = tone > BAYER[y & 7][x & 7] ? 1 : 0;
    }
  }
  return bits;
}

// Left gutter: a large banded planet lit from the rail side, with rings.
function leftPiece(x, y, w, h) {
  const planet = { cx: w * 0.66, cy: h * 0.7, r: w * 0.52, light: normalize([-0.65, -0.5, 0.6]), seed: 11, texture: 0.55 };
  const dxr = (x - planet.cx) / planet.r;
  const dyr = (y - planet.cy) / planet.r;

  // Tilted ring ellipse in planet space.
  const angle = -0.32;
  const rx = dxr * Math.cos(angle) - dyr * Math.sin(angle);
  const ry = (dxr * Math.sin(angle) + dyr * Math.cos(angle)) / 0.22;
  const ringDist = Math.hypot(rx, ry);
  const inRing = ringDist > 1.3 && ringDist < 1.8;
  const ringFront = ry > 0; // Lower half passes in front of the planet.
  const ringTone = inRing
    ? 0.35 + 0.35 * Math.sin(ringDist * 38) ** 2 * (ringDist < 1.55 ? 1 : 0.6)
    : null;

  const body = sphere(x, y, planet);
  if (ringTone !== null && (ringFront || body === null)) return ringTone;
  if (body !== null) {
    // Ring shadow cast across the planet.
    const shadow = Math.abs(ry + 0.9) < 0.35 && ringDist > 1 ? 0.45 : 1;
    return body * shadow;
  }

  // Atmospheric glow falling off from the limb.
  const edge = Math.hypot(x - planet.cx, y - planet.cy) / planet.r - 1;
  const glow = edge < 0.18 ? 0.22 * (1 - edge / 0.18) ** 2 : 0;
  return glow + star(x, y, 3);
}

// Right gutter: a cratered moon near the top with a thin crescent companion.
function rightPiece(x, y, w, h) {
  const moon = {
    cx: w * 0.42, cy: h * 0.22, r: w * 0.3,
    light: normalize([-0.8, -0.2, 0.45]), seed: 29, texture: 0.2,
    craters: [
      { x: -0.35, y: -0.25, r: 0.22 },
      { x: 0.1, y: 0.35, r: 0.16 },
      { x: -0.55, y: 0.3, r: 0.1 },
      { x: 0.3, y: -0.45, r: 0.12 },
      { x: -0.1, y: -0.02, r: 0.08 },
    ],
  };
  const m = sphere(x, y, moon);
  if (m !== null) return m;

  const small = sphere(x, y, { cx: w * 0.78, cy: h * 0.52, r: w * 0.07, light: normalize([-0.95, -0.1, 0.1]), seed: 5 });
  if (small !== null) return small;

  const edge = Math.hypot(x - moon.cx, y - moon.cy) / moon.r - 1;
  const glow = edge < 0.3 ? 0.18 * (1 - edge / 0.3) ** 2 : 0;

  // Dust haze drifting up from the bottom of the gutter.
  const haze = clamp((y / h - 0.6) / 0.4) ** 2 * (0.1 + 0.28 * fbm(x / 40, y / 25, 71));
  return glow + haze + star(x, y, 9);
}

// Sparse single-pixel stars.
function star(x, y, seed) {
  return hash(x, y, seed) > 0.9975 ? 1 : 0;
}

// Minimal 1-bit greyscale+alpha PNG encoder (colour type 4, 8-bit).
function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Each source pixel is written as a SCALE x SCALE block so the browser never
// has to resample the mask (which would blur the dither).
function encodePng(w, h, bits, scale) {
  const width = w * scale;
  const height = h * scale;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 4; // greyscale + alpha
  const raw = Buffer.alloc(height * (1 + width * 2));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 2);
    raw[row] = 0; // no filter
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 2] = 255;
      raw[row + 2 + x * 2] = bits[Math.floor(y / scale) * w + Math.floor(x / scale)] ? 255 : 0;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Each dither pixel is drawn at 2x2 CSS pixels, so these cover 640x1200.
const W = 320;
const H = 600;
const SCALE = 2;

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, piece] of [['left', leftPiece], ['right', rightPiece]]) {
  const bits = render(W, H, (x, y) => piece(x, y, W, H));
  writeFileSync(new URL(`${name}.png`, OUT_DIR), encodePng(W, H, bits, SCALE));
  console.log(`wrote public/images/dither/${name}.png`);
}
