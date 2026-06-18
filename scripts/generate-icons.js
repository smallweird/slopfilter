// generate-icons.js — produces the Slopfilter toolbar icons as PNGs with zero
// dependencies (pure Node + built-in zlib). A filter-funnel mark on a blue→indigo
// rounded-square gradient. Run: node scripts/generate-icons.js
'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- minimal PNG encoder ----
const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- vector drawing in normalized [0,1] coords ----
const BLUE = [29, 155, 240];
const INDIGO = [108, 92, 231];
const WHITE = [255, 255, 255];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function inRoundedSquare(nx, ny) {
  const pad = 0.045;
  const r = 0.2;
  const half = (1 - 2 * pad) / 2;
  let dx = Math.abs(nx - 0.5) - (half - r);
  let dy = Math.abs(ny - 0.5) - (half - r);
  dx = Math.max(dx, 0);
  dy = Math.max(dy, 0);
  return Math.sqrt(dx * dx + dy * dy) <= r;
}

function sign(px, py, a, b) {
  return (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
}

function inTri(px, py, a, b, c) {
  const d1 = sign(px, py, a, b);
  const d2 = sign(px, py, b, c);
  const d3 = sign(px, py, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function inFunnel(nx, ny) {
  // bowl (inverted triangle) + stem
  if (inTri(nx, ny, [0.24, 0.31], [0.76, 0.31], [0.5, 0.6])) return true;
  if (nx >= 0.455 && nx <= 0.545 && ny >= 0.55 && ny <= 0.73) return true;
  return false;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // supersample for crisp anti-aliased edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let pr = 0, pg = 0, pb = 0, pa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (x + (sx + 0.5) / SS) / size;
          const ny = (y + (sy + 0.5) / SS) / size;
          let col, a;
          if (!inRoundedSquare(nx, ny)) { a = 0; col = [0, 0, 0]; }
          else if (inFunnel(nx, ny)) { a = 255; col = WHITE; }
          else { a = 255; col = mix(BLUE, INDIGO, (nx + ny) / 2); }
          const af = a / 255;
          pr += col[0] * af; pg += col[1] * af; pb += col[2] * af; pa += a;
        }
      }
      const n = SS * SS;
      const aAvg = pa / n;
      const idx = (y * size + x) * 4;
      if (pa > 0) {
        rgba[idx] = Math.round(pr / (pa / 255));
        rgba[idx + 1] = Math.round(pg / (pa / 255));
        rgba[idx + 2] = Math.round(pb / (pa / 255));
      }
      rgba[idx + 3] = Math.round(aAvg);
    }
  }
  return rgba;
}

const outDir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const buf = encodePng(size, render(size));
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), buf);
  console.log(`wrote icon-${size}.png (${buf.length} bytes)`);
}
