// Renders the monochrome dithered clouds that sit in the side gutters.
//
//   node scripts/generate-dither-art.mjs
//
// Sources (public domain, via Wikimedia Commons), cropped and tone-mapped into
// greyscale maps in scripts/dither-sources/ (white = cloud light, black = sky):
//   clouds-left.png  - John Constable, Study of Clouds, 1821 (Whitworth Art Gallery)
//   clouds-right.png - John Constable, Cloud Study, Hampstead; Tree at Right, 1821
//                      (Royal Academy of Arts)
//
// Each map is ordered-dithered into a 1-bit PNG used as a CSS mask, so the
// colour comes from the active site theme. Sizes are mirrored in the
// .dither-* rules in global.css.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const SRC_DIR = new URL('./dither-sources/', import.meta.url);
const OUT_DIR = new URL('../public/images/dither/', import.meta.url);

// Each dither pixel is drawn as a SCALE x SCALE block of CSS pixels.
const SCALE = 2;

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

// Minimal decoder for 8-bit, non-interlaced greyscale PNGs.
function decodeGreyPng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 0 || data[12] !== 0) throw new Error('expected 8-bit greyscale PNG');
    }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    for (let x = 0; x < width; x++) {
      const a = x ? px[y * width + x - 1] : 0;
      const b = y ? px[(y - 1) * width + x] : 0;
      const c = x && y ? px[(y - 1) * width + x - 1] : 0;
      let v = raw[y * (width + 1) + 1 + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * width + x] = v & 255;
    }
  }
  return { width, height, px };
}

function dither({ width, height, px }) {
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      bits[y * width + x] = px[y * width + x] / 255 > BAYER[y & 7][x & 7] ? 1 : 0;
    }
  }
  return bits;
}

// Minimal greyscale+alpha PNG encoder (colour type 4, 8-bit).
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
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
function encodeMask(w, h, bits, scale) {
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

for (const name of ['clouds-left', 'clouds-right']) {
  const tones = decodeGreyPng(readFileSync(new URL(`${name}.png`, SRC_DIR)));
  const png = encodeMask(tones.width, tones.height, dither(tones), SCALE);
  writeFileSync(new URL(`${name}.png`, OUT_DIR), png);
  console.log(`wrote public/images/dither/${name}.png (${tones.width * SCALE}x${tones.height * SCALE})`);
}
