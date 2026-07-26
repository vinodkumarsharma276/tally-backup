#!/usr/bin/env node
/*
 * Generates a branded placeholder application icon for VE Tally Backup with no
 * external dependencies: a rounded green tile with a white checkmark (matching
 * the in-app shield motif). Outputs multi-resolution build/icon.ico and a
 * build/icon.png (512px) for non-Windows targets.
 *
 * Run: node scripts/generate-icon.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- PNG encoding ----------------------------------------------------------

const crcTable = (() => {
  const table = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePNG(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Drawing ---------------------------------------------------------------

function lerp(a, b, t) { return a + (b - a) * t; }

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Rounded-rect signed distance (negative = inside), normalized coords.
function roundedRectInside(u, v, radius) {
  const dx = Math.abs(u - 0.5) - (0.5 - radius);
  const dy = Math.abs(v - 0.5) - (0.5 - radius);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  const outside = Math.hypot(ox, oy) - radius;
  return outside; // <0 inside
}

// Brand palette.
const TOP = [49, 215, 150];
const BOTTOM = [18, 80, 58];
const CHECK = [255, 255, 255];

// Checkmark control points (normalized).
const A = [0.30, 0.53];
const B = [0.45, 0.68];
const C = [0.73, 0.34];
const STROKE = 0.075; // half-width

function renderSize(size) {
  const ss = 4; // supersample
  const R = size * ss;
  const acc = Buffer.alloc(size * size * 4);

  // Per output pixel, average ss*ss samples.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const u = (x * ss + sx + 0.5) / R;
          const v = (y * ss + sy + 0.5) / R;
          const inside = roundedRectInside(u, v, 0.22);
          if (inside > 0) continue; // transparent outside tile
          // Background gradient.
          let pr = lerp(TOP[0], BOTTOM[0], v);
          let pg = lerp(TOP[1], BOTTOM[1], v);
          let pb = lerp(TOP[2], BOTTOM[2], v);
          // Checkmark overlay.
          const d = Math.min(
            distToSegment(u, v, A[0], A[1], B[0], B[1]),
            distToSegment(u, v, B[0], B[1], C[0], C[1])
          );
          if (d < STROKE) {
            pr = CHECK[0]; pg = CHECK[1]; pb = CHECK[2];
          }
          r += pr; g += pg; b += pb; a += 255;
        }
      }
      const n = ss * ss;
      const idx = (y * size + x) * 4;
      acc[idx] = Math.round(r / n);
      acc[idx + 1] = Math.round(g / n);
      acc[idx + 2] = Math.round(b / n);
      acc[idx + 3] = Math.round(a / n);
    }
  }
  return acc;
}

// ---- ICO container ---------------------------------------------------------

function buildIco(entries) {
  // entries: [{ size, png }]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(entries.length * 16);
  let offset = 6 + entries.length * 16;
  const images = [];
  entries.forEach((entry, i) => {
    const base = i * 16;
    dir[base] = entry.size >= 256 ? 0 : entry.size; // width
    dir[base + 1] = entry.size >= 256 ? 0 : entry.size; // height
    dir[base + 2] = 0; // colour count
    dir[base + 3] = 0; // reserved
    dir.writeUInt16LE(1, base + 4); // planes
    dir.writeUInt16LE(32, base + 6); // bit count
    dir.writeUInt32LE(entry.png.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
    images.push(entry.png);
  });

  return Buffer.concat([header, dir, ...images]);
}

// ---- Main ------------------------------------------------------------------

function main() {
  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });

  const icoSizes = [16, 32, 48, 64, 128, 256];
  const entries = icoSizes.map((size) => ({ size, png: encodePNG(size, renderSize(size)) }));
  fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(entries));

  fs.writeFileSync(path.join(outDir, 'icon.png'), encodePNG(512, renderSize(512)));

  console.log(`Generated build/icon.ico (${icoSizes.join(', ')} px) and build/icon.png (512 px)`);
}

main();
