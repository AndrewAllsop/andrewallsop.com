// Renders the monochrome dithered artwork that sits in the side gutters.
// Output is 1-bit (opaque or transparent) PNGs used as CSS masks, so the
// colour comes from the active site theme.
//
//   node scripts/generate-dither-art.mjs
//
// Layout constants here are mirrored in the .dither-* rules in global.css.

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT_DIR = new URL('../public/images/dither/', import.meta.url);

// Each dither pixel is drawn as a SCALE x SCALE block of CSS pixels.
const SCALE = 3;
// Gutter pieces are 642x1200 CSS px.
const W = 214;
const H = 400;
// The eye sits centred vertically, tucked against the rail.
const EYE = { cx: W * 0.64, cy: H * 0.5, r: W * 0.5 };
const IRIS_R = EYE.r * 0.44;

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

// Thin branching lines where fbm crosses its midpoint.
function ridges(x, y, seed, width) {
  const v = Math.abs(fbm(x, y, seed) - 0.5);
  return v < width ? 1 - v / width : 0;
}

function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v));
}

function star(x, y, seed, density = 0.997) {
  return hash(x, y, seed) > density ? 1 : 0;
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

// Horizontal tearing: shift a handful of bands sideways, VHS style.
function tear(bits, width, height, seed, count) {
  const out = bits.slice();
  for (let i = 0; i < count; i++) {
    const y0 = Math.floor(hash(i, 1, seed) * height);
    const bandH = 1 + Math.floor(hash(i, 2, seed) * 10);
    const shift = Math.round((hash(i, 3, seed) - 0.5) * 60);
    for (let y = y0; y < Math.min(height, y0 + bandH); y++) {
      for (let x = 0; x < width; x++) {
        const sx = x - shift;
        out[y * width + x] = sx >= 0 && sx < width ? bits[y * width + sx] : 0;
      }
    }
  }
  return out;
}

// Left gutter: a colossal bloodshot eyeball trailing its optic nerve.
// The iris is a separate layer so it can follow the cursor.
function eyeball(x, y) {
  const dx = (x - EYE.cx) / EYE.r;
  const dy = (y - EYE.cy) / EYE.r;
  const d2 = dx * dx + dy * dy;

  if (d2 <= 1) {
    const nz = Math.sqrt(1 - d2);
    // Glossy sclera lit from the upper left.
    const lambert = clamp(-0.55 * dx - 0.5 * dy + 0.67 * nz);
    let tone = 0.25 + 0.75 * lambert;
    const spec = Math.pow(clamp(-0.35 * dx - 0.45 * dy + 0.82 * nz), 220);
    tone = tone * 0.85 + spec;

    // Veins crawl in from the limb and thin out toward the centre.
    const reach = clamp((Math.sqrt(d2) - 0.25) / 0.75);
    const vein = ridges(dx * 3.2 + 7, dy * 3.2 + 3, 41, 0.035 * reach + 0.004);
    tone -= vein * reach * 1.2;

    // Terminator shadow and limb darkening.
    tone *= 0.3 + 0.7 * Math.pow(nz, 0.5);
    return clamp(tone);
  }

  // Optic nerve: a twisting tube dragging off toward the bottom-left.
  if (y > EYE.cy) {
    const along = (y - EYE.cy) / (H - EYE.cy);
    const centre = EYE.cx - EYE.r * 0.35 - along * W * 0.3 + Math.sin(along * 7) * 10;
    const half = EYE.r * (0.32 - along * 0.2);
    const off = (x - centre) / half;
    if (Math.abs(off) < 1) {
      const round = Math.sqrt(1 - off * off);
      const fibres = 0.6 + 0.4 * Math.sin(off * 9 + along * 30 + fbm(x / 6, y / 6, 13) * 4);
      return clamp((0.2 + 0.7 * round) * fibres * (1 - along * 0.4));
    }
  }

  // Halo and a few stars so the thing floats in space.
  const edge = Math.sqrt(d2) - 1;
  const halo = edge < 0.12 ? 0.3 * (1 - edge / 0.12) ** 2 : 0;
  return halo + star(x, y, 3);
}

// Iris: rendered at its own origin. Light pixels are painted in the theme
// text colour over a solid disc of the theme background.
function iris(x, y) {
  const dx = x - IRIS_R;
  const dy = y - IRIS_R;
  const r = Math.hypot(dx, dy) / IRIS_R;
  if (r > 1) return 0;
  const pupil = 0.42;
  if (r < pupil) {
    // Catchlight in the pupil.
    return Math.hypot(dx + IRIS_R * 0.2, dy + IRIS_R * 0.22) < IRIS_R * 0.1 ? 1 : 0;
  }
  const angle = Math.atan2(dy, dx);
  const fibres = 0.5 + 0.5 * Math.sin(angle * 46 + fbm(r * 4, angle * 2, 57) * 6);
  const crypts = fbm(Math.cos(angle) * 5 + r * 3, Math.sin(angle) * 5, 61);
  const ring = 1 - Math.abs(r - 0.62) * 6; // Collarette.
  let tone = 0.2 + 0.55 * fibres * crypts + clamp(ring) * 0.35;
  tone *= r > 0.88 ? 0.25 : 1; // Dark limbal ring.
  return clamp(tone);
}

// Right gutter: a black hole with a lensed accretion disk.
function blackHole(x, y) {
  const cx = W * 0.4;
  const cy = H * 0.32;
  const rh = W * 0.2;
  const dx = (x - cx) / rh;
  const dy = (y - cy) / rh;
  const dist = Math.hypot(dx, dy);

  // Disk in its own tilted plane.
  const tilt = 0.12;
  const px = dx * Math.cos(tilt) + dy * Math.sin(tilt);
  const py = (-dx * Math.sin(tilt) + dy * Math.cos(tilt)) / 0.22;
  const pr = Math.hypot(px, py);
  const pa = Math.atan2(py, px);
  let disk = 0;
  if (pr > 1.35 && pr < 4.2) {
    const heat = Math.pow(1 - (pr - 1.35) / 2.85, 1.6);
    const streaks = 0.55 + 0.45 * Math.sin(pr * 22 + fbm(pa * 3, pr * 2, 23) * 5);
    const doppler = 0.7 + 0.3 * -Math.cos(pa); // Approaching side is brighter.
    disk = clamp(heat * streaks * doppler * 1.8);
  }
  const front = py > 0;

  // Back of the disk, bent up and over the top of the horizon.
  let lensed = 0;
  if (dist > 1 && dist < 1.75 && dy < 0.35) {
    const band = 1 - Math.abs(dist - 1.3) / 0.45;
    const topness = clamp(0.35 - dy / 1.2);
    lensed = clamp(band * topness * (0.6 + 0.4 * Math.sin(dist * 30)) * 1.4);
  }
  // Bottom lensed sliver.
  if (dist > 1 && dist < 1.18 && dy > 0) lensed = Math.max(lensed, 0.55 * (1 - (dist - 1) / 0.18));
  // Photon ring.
  const photon = dist > 1 && dist < 1.07 ? 1 : 0;

  if (dist <= 1) return front ? disk : 0;
  if (front && disk) return disk;
  const base = Math.max(disk, lensed, photon);

  // Stars get smeared into arcs near the hole.
  const pull = clamp(1.8 / dist - 0.2);
  const arcX = cx + Math.cos(Math.atan2(dy, dx) + pull * 0.4) * dist * rh;
  const arcY = cy + Math.sin(Math.atan2(dy, dx) + pull * 0.4) * dist * rh;
  const stars = star(Math.round(arcX), Math.round(arcY), 9, 0.996);

  // Radiation haze pouring off the bottom of the gutter.
  const haze = clamp((y / H - 0.55) / 0.45) ** 1.5 * (0.15 + 0.5 * fbm(x / 30, y / 12, 71));
  return clamp(base + stars + haze);
}

// Minimal greyscale+alpha PNG encoder (colour type 4, 8-bit).
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

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const irisSize = Math.ceil(IRIS_R * 2);
const pieces = [
  ['eye', W, H, tear(render(W, H, eyeball), W, H, 5, 7)],
  ['iris', irisSize, irisSize, render(irisSize, irisSize, iris)],
  ['blackhole', W, H, tear(render(W, H, blackHole), W, H, 8, 12)],
];

for (const [name, w, h, bits] of pieces) {
  writeFileSync(new URL(`${name}.png`, OUT_DIR), encodePng(w, h, bits, SCALE));
  console.log(`wrote public/images/dither/${name}.png (${w * SCALE}x${h * SCALE})`);
}
console.log(`eye centre ${EYE.cx * SCALE}px, ${EYE.cy * SCALE}px; iris ${irisSize * SCALE}px`);
