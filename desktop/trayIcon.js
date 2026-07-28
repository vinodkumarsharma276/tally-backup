'use strict';

/*
 * Tray status icons as real PNGs.
 *
 * Electron's nativeImage does NOT decode SVG data URLs on Windows, so an SVG
 * tray icon renders as an empty (invisible) image. These icons are therefore
 * drawn pixel-by-pixel and encoded as PNG with zlib, matching the app's brand
 * colours: a rounded tile with a status glyph.
 */

const zlib = require('zlib');

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
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const value = parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Glyph strokes in normalized tile coordinates.
const GLYPHS = {
  idle: [[0.30, 0.52, 0.45, 0.67], [0.45, 0.67, 0.72, 0.34]], // check
  success: [[0.30, 0.52, 0.45, 0.67], [0.45, 0.67, 0.72, 0.34]],
  running: [[0.5, 0.28, 0.5, 0.52], [0.5, 0.52, 0.68, 0.62]], // clock hands
  failed: [[0.5, 0.26, 0.5, 0.58], [0.5, 0.70, 0.5, 0.74]], // exclamation
  paused: [[0.41, 0.32, 0.41, 0.68], [0.59, 0.32, 0.59, 0.68]], // pause bars
};

const COLORS = {
  idle: '#2fcf91',
  success: '#2fcf91',
  running: '#4d9fff',
  failed: '#ff6675',
  paused: '#f0b956',
};

function renderState(state, size) {
  const color = hexToRgb(COLORS[state] || COLORS.idle);
  const strokes = GLYPHS[state] || GLYPHS.idle;
  const ss = 4; // supersample for smooth edges
  const out = Buffer.alloc(size * size * 4);
  const radius = 0.22;
  const half = 0.5 - radius;
  const strokeWidth = state === 'paused' ? 0.075 : 0.085;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const u = (x * ss + sx + 0.5) / (size * ss);
          const v = (y * ss + sy + 0.5) / (size * ss);
          // Rounded-square coverage.
          const dx = Math.max(Math.abs(u - 0.5) - half, 0);
          const dy = Math.max(Math.abs(v - 0.5) - half, 0);
          if (Math.hypot(dx, dy) > radius) continue;
          let pr = color[0];
          let pg = color[1];
          let pb = color[2];
          let hit = false;
          for (const [ax, ay, bx, by] of strokes) {
            if (distToSegment(u, v, ax, ay, bx, by) < strokeWidth) { hit = true; break; }
          }
          if (hit) { pr = 7; pg = 16; pb = 24; } // dark glyph on the coloured tile
          r += pr; g += pg; b += pb; a += 255;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = Math.round(a / n);
    }
  }
  return encodePNG(size, out);
}

const cache = new Map();

/** PNG buffer for a tray/notification status icon. */
function statusIconBuffer(state = 'idle', size = 32) {
  const key = `${state}:${size}`;
  if (!cache.has(key)) cache.set(key, renderState(state, size));
  return cache.get(key);
}

module.exports = { statusIconBuffer };
