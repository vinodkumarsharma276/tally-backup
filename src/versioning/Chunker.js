'use strict';

const fs = require('fs');
const crypto = require('crypto');

/**
 * Chunker — FastCDC content-defined chunking (32-bit gear hash, normalized).
 *
 * Splits a byte stream into variable-size chunks whose boundaries are decided
 * by the *content* (a rolling "gear" hash hitting a mask), so that inserting or
 * removing bytes only disturbs the local chunk and everything after it re-syncs
 * to the same boundaries. This is what makes cross-day deduplication work on
 * Tally's daily-rewritten binary files.
 *
 * The gear table and masks are fixed constants => identical content always
 * produces identical chunk boundaries (verified in tools/measure-chunks.js).
 */
class Chunker {
  /**
   * @param {object} [opts]
   * @param {number} [opts.avg=262144] Target average chunk size in bytes (256 KB).
   * @param {number} [opts.min]        Minimum chunk size (default avg/4).
   * @param {number} [opts.max]        Maximum chunk size (default avg*4).
   */
  constructor(opts = {}) {
    this.avg = opts.avg && opts.avg > 0 ? opts.avg : 256 * 1024;
    this.min = opts.min && opts.min > 0 ? opts.min : Math.floor(this.avg / 4);
    this.max = opts.max && opts.max > 0 ? opts.max : this.avg * 4;

    const avgBits = Math.round(Math.log2(this.avg));
    // Strict mask (more 1-bits) before the average size discourages early cuts;
    // loose mask (fewer 1-bits) after it discourages oversized chunks.
    this.maskS = (0xffffffff << (32 - (avgBits + 1))) | 0;
    this.maskL = (0xffffffff << (32 - (avgBits - 1))) | 0;
    this.gear = Chunker._buildGearTable();
    this.readBufferSize = 4 * 1024 * 1024;
  }

  // Deterministic 256-entry gear table from a fixed seed (reproducible).
  static _buildGearTable() {
    let a = 0x1f2e3d4c >>> 0;
    const next = () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
    const g = new Int32Array(256);
    for (let i = 0; i < 256; i++) g[i] = next() | 0;
    return g;
  }

  /**
   * Return the length of the next chunk starting at `start` within `buf`,
   * searching up to `end`. Always in the range [min(1,n), max].
   */
  _cut(buf, start, end) {
    const { min, max, avg, maskS, maskL, gear } = this;
    let n = end - start;
    if (n <= min) return n;
    if (n > max) n = max;
    let normalSize = avg;
    if (n < normalSize) normalSize = n;

    let hash = 0;
    let i = min;
    for (; i < normalSize; i++) {
      hash = ((hash << 1) + gear[buf[start + i]]) | 0;
      if ((hash & maskS) === 0) return i;
    }
    for (; i < n; i++) {
      hash = ((hash << 1) + gear[buf[start + i]]) | 0;
      if ((hash & maskL) === 0) return i;
    }
    return n;
  }

  /**
   * Stream a file through FastCDC, invoking `onChunk({ buffer, size, hash })`
   * for each chunk in order. `hash` is the SHA-256 hex of the chunk content.
   * @param {string} filePath
   * @param {(chunk: {buffer: Buffer, size: number, hash: string}) => (void|Promise<void>)} onChunk
   */
  async chunkFile(filePath, onChunk) {
    const stream = fs.createReadStream(filePath, { highWaterMark: this.readBufferSize });
    let parts = [];
    let partsLen = 0;

    const emit = async (buf, off, len) => {
      const chunk = Buffer.from(buf.subarray(off, off + len)); // own copy
      const hash = crypto.createHash('sha256').update(chunk).digest('hex');
      await onChunk({ buffer: chunk, size: len, hash });
    };

    const drain = async (final) => {
      if (partsLen === 0) return;
      const buf = parts.length === 1 ? parts[0] : Buffer.concat(parts, partsLen);
      parts = [];
      partsLen = 0;
      let off = 0;
      while (buf.length - off >= this.max || (final && buf.length - off > 0)) {
        const len = this._cut(buf, off, buf.length);
        await emit(buf, off, len);
        off += len;
      }
      if (buf.length - off > 0) {
        const rem = Buffer.from(buf.subarray(off));
        parts.push(rem);
        partsLen = rem.length;
      }
    };

    for await (const block of stream) {
      parts.push(block);
      partsLen += block.length;
      if (partsLen >= this.max) await drain(false);
    }
    await drain(true);
  }
}

module.exports = Chunker;
