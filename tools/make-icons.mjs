// Generates the icon PNGs with zlib only — no image libraries, no build step.
// A rounded terracotta square with two offset chat marks (the "transfer").
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [193, 95, 60], FG = [255, 255, 255], FG2 = [255, 226, 214];

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Rounded square background with two overlapping speech bubbles. */
function draw(x, y, size) {
  const u = size / 16, r = 3 * u;
  const inCorner =
    (x < r && y < r && Math.hypot(r - x, r - y) > r) ||
    (x > size - r && y < r && Math.hypot(x - (size - r), r - y) > r) ||
    (x < r && y > size - r && Math.hypot(r - x, y - (size - r)) > r) ||
    (x > size - r && y > size - r && Math.hypot(x - (size - r), y - (size - r)) > r);
  if (inCorner) return [0, 0, 0, 0];

  const bubble = (cx, cy, w, h) =>
    x >= cx && x <= cx + w && y >= cy && y <= cy + h;

  // back bubble (lighter), then front bubble (white)
  if (bubble(3 * u, 3.2 * u, 7.5 * u, 5.2 * u)) return [...FG2, 255];
  if (bubble(5.5 * u, 6.2 * u, 7.5 * u, 5.2 * u)) return [...FG, 255];
  // little tail on the front bubble
  if (x >= 6.2 * u && x <= 8 * u && y >= 11.4 * u && y <= 12.8 * u &&
      (x - 6.2 * u) < (12.8 * u - y) * 1.4) return [...FG, 255];

  return [...BG, 255];
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [16, 48, 128]) {
  const out = new URL(`../icons/icon${size}.png`, import.meta.url);
  writeFileSync(out, png(size, draw));
  console.log('wrote', out.pathname);
}
