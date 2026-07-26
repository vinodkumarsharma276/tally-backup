#!/usr/bin/env node
/*
 * Phase 0 — MEASURE FIRST (standalone, no Google Drive, no app changes)
 * ---------------------------------------------------------------------
 * Goal: decide whether content-defined chunking (CDC) makes 30-day version
 * history fit inside Google Drive's free 15 GB tier for a real Tally folder.
 *
 * What it does on each run:
 *   1. FastCDC-splits EVERY file in the target folder into variable-size chunks
 *      (default average ~1 MB) and SHA-256-hashes each chunk.
 *   2. Keeps a persistent content-addressed index of every unique chunk ever
 *      seen across previous runs (data/phase0/chunk-index.json).
 *   3. Reports for this run:
 *        - total folder size & file count
 *        - total chunks, unique chunks
 *        - intra-run dedup (duplicate chunks inside today's scan)
 *        - NEW bytes that would have to be UPLOADED tonight (chunks never seen
 *          in any previous run) -> the real day-over-day delta
 *        - projected 30-day Drive STORAGE (baseline + average daily new bytes)
 *
 * Run it on 2-3 CONSECUTIVE days (after Tally's nightly update) to capture the
 * real daily delta, then decide the Phase 1 chunk size.
 *
 * Usage:
 *   node tools/measure-chunks.js "Tally Data"
 *   node tools/measure-chunks.js "Tally Data" --avg 1048576 --label day1
 *   node tools/measure-chunks.js "Tally Data" --reset        (start fresh)
 *
 * This tool NEVER writes to the source folder and NEVER touches config.json.
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// --------------------------------------------------------------------------
// CLI args
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reset') args.reset = true;
    else if (a === '--avg') args.avg = parseInt(argv[++i], 10);
    else if (a === '--label') args.label = argv[++i];
    else if (a === '--gzip') args.gzip = true;
    else if (a === '--db') args.db = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args._.length === 0) {
  console.log(`Phase 0 chunk-measurement tool

Usage:
  node tools/measure-chunks.js <folder> [--avg <bytes>] [--label <name>] [--reset] [--db <dir>]

Options:
  --avg <bytes>   Average target chunk size (default 1048576 = 1 MB).
                  Min = avg/4, Max = avg*4 (FastCDC normalized chunking).
  --label <name>  Friendly label for this run (e.g. day1, day2).
  --gzip          Also measure gzip-compressed chunk size (slower) to estimate
                  compressed Drive storage.
  --reset         Wipe the persistent chunk index and start a fresh baseline.
  --db <dir>      Where to keep the index (default: data/phase0).
`);
  process.exit(0);
}

const TARGET = path.resolve(args._[0]);
const AVG = args.avg && args.avg > 0 ? args.avg : 1024 * 1024; // 1 MB default
const MIN = Math.floor(AVG / 4);
const MAX = AVG * 4;
const DB_DIR = path.resolve(args.db || path.join('data', 'phase0'));
const INDEX_FILE = path.join(DB_DIR, 'chunk-index.json');
const RUNS_DIR = path.join(DB_DIR, 'runs');

// --------------------------------------------------------------------------
// FastCDC (32-bit gear hash, normalized chunking) — deterministic so that the
// SAME content always yields the SAME chunk boundaries across days.
// --------------------------------------------------------------------------

// Deterministic gear table (seeded PRNG) so results are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

const GEAR = (() => {
  const rnd = mulberry32(0x1f2e3d4c);
  const g = new Int32Array(256);
  for (let i = 0; i < 256; i++) g[i] = rnd() | 0;
  return g;
})();

// Normalized-chunking masks. avgBits = log2(avg). Strict mask (more 1-bits) is
// used before reaching the average size to discourage early cuts; loose mask
// (fewer 1-bits) is used after, to discourage oversized chunks.
const AVG_BITS = Math.round(Math.log2(AVG));
const MASK_S = ((0xffffffff << (32 - (AVG_BITS + 1))) | 0); // avgBits+1 high bits
const MASK_L = ((0xffffffff << (32 - (AVG_BITS - 1))) | 0); // avgBits-1 high bits

/**
 * Return the length of the next chunk starting at `start` within `buf`,
 * searching up to `end`. Guaranteed to return a value in [min(1,n), MAX].
 */
function fastcdcCut(buf, start, end) {
  let n = end - start;
  if (n <= MIN) return n;
  if (n > MAX) n = MAX;
  let normalSize = AVG;
  if (n < normalSize) normalSize = n;

  let hash = 0;
  let i = MIN;
  for (; i < normalSize; i++) {
    hash = ((hash << 1) + GEAR[buf[start + i]]) | 0;
    if ((hash & MASK_S) === 0) return i;
  }
  for (; i < n; i++) {
    hash = ((hash << 1) + GEAR[buf[start + i]]) | 0;
    if ((hash & MASK_L) === 0) return i;
  }
  return n;
}

/**
 * Stream a file through FastCDC, invoking onChunk(hashHex, size) per chunk.
 */
async function chunkFile(filePath, onChunk) {
  const stream = fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
  let parts = [];
  let partsLen = 0;

  const drain = (final) => {
    if (partsLen === 0) return;
    let buf = parts.length === 1 ? parts[0] : Buffer.concat(parts, partsLen);
    parts = [];
    partsLen = 0;
    let off = 0;
    while (buf.length - off >= MAX || (final && buf.length - off > 0)) {
      const len = fastcdcCut(buf, off, buf.length);
      const chunk = buf.subarray(off, off + len);
      const hash = crypto.createHash('sha256').update(chunk).digest('hex');
      const gz = args.gzip ? zlib.gzipSync(chunk).length : 0;
      onChunk(hash, len, gz);
      off += len;
    }
    if (buf.length - off > 0) {
      const rem = Buffer.from(buf.subarray(off)); // copy so backing buffer is freed
      parts.push(rem);
      partsLen = rem.length;
    }
  };

  for await (const block of stream) {
    parts.push(block);
    partsLen += block.length;
    if (partsLen >= MAX) drain(false);
  }
  drain(true);
}

// --------------------------------------------------------------------------
// Directory walk
// --------------------------------------------------------------------------
async function walk(dir) {
  const out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

// --------------------------------------------------------------------------
// Index persistence
// --------------------------------------------------------------------------
function loadIndex() {
  if (args.reset || !fs.existsSync(INDEX_FILE)) {
    return {
      params: { avg: AVG, min: MIN, max: MAX },
      chunks: Object.create(null), // hash -> size
      totalUniqueBytes: 0,
      runs: [],
    };
  }
  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  if (!idx.chunks) idx.chunks = Object.create(null);
  return idx;
}

function saveIndex(idx) {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx));
}

// --------------------------------------------------------------------------
// Formatting helpers
// --------------------------------------------------------------------------
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;
const fmtMB = (b) => (b / MB).toFixed(2) + ' MB';
const fmtGB = (b) => (b / GB).toFixed(2) + ' GB';
const fmtBytes = (b) => (b >= GB ? fmtGB(b) : fmtMB(b));

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(TARGET)) {
    console.error(`Target folder not found: ${TARGET}`);
    process.exit(1);
  }

  const idx = loadIndex();
  if (idx.params && idx.params.avg !== AVG && idx.runs.length > 0 && !args.reset) {
    console.error(
      `\n  Chunk size changed (index was built with avg=${idx.params.avg}, now avg=${AVG}).\n` +
      `   Past runs are NOT comparable. Re-run with --reset to start a fresh baseline.\n`
    );
    process.exit(1);
  }
  idx.params = { avg: AVG, min: MIN, max: MAX };

  const startTs = Date.now();
  const label = args.label || `run-${idx.runs.length + 1}`;
  console.log(`\n=== Phase 0 chunk measurement ===`);
  console.log(`Target : ${TARGET}`);
  console.log(`Chunk  : avg ${fmtBytes(AVG)} (min ${fmtBytes(MIN)}, max ${fmtBytes(MAX)})`);
  console.log(`Index  : ${INDEX_FILE}`);
  console.log(`Run    : #${idx.runs.length + 1} "${label}"  (previous runs: ${idx.runs.length})`);
  console.log(`Scanning files...`);

  const files = await walk(TARGET);

  // Per-run accumulators
  let totalBytes = 0;
  let totalChunks = 0;
  const runChunkSeen = new Set();   // unique-within-this-run
  let intraDupBytes = 0;            // bytes saved by dedup WITHIN this run
  let newBytes = 0;                 // bytes never seen in ANY previous run
  let newChunks = 0;
  let newGzBytes = 0;               // gzip bytes of the new (delta) chunks
  let uniqueRawInScan = 0;          // raw bytes of chunks unique within this run
  let uniqueGzInScan = 0;           // gzip bytes of chunks unique within this run
  const perFile = [];

  // Snapshot of which chunks existed BEFORE this run (for true day-delta)
  const knownBefore = idx.chunks;

  for (const file of files) {
    const rel = path.relative(TARGET, file);
    let fBytes = 0;
    let fChunks = 0;
    const fileNew = { chunks: 0, bytes: 0 };

    await chunkFile(file, (hash, size, gz) => {
      fBytes += size;
      fChunks += 1;
      totalBytes += size;
      totalChunks += 1;

      // intra-run dedup
      if (runChunkSeen.has(hash)) {
        intraDupBytes += size;
      } else {
        runChunkSeen.add(hash);
        uniqueRawInScan += size;
        uniqueGzInScan += gz;
      }

      // cross-run novelty (would need uploading tonight)
      if (knownBefore[hash] === undefined) {
        newBytes += size;
        newChunks += 1;
        newGzBytes += gz;
        fileNew.chunks += 1;
        fileNew.bytes += size;
        // add to index now so duplicates later in the same run aren't double-counted
        knownBefore[hash] = size;
        idx.totalUniqueBytes += size;
      }
    });

    perFile.push({ rel, bytes: fBytes, chunks: fChunks, newBytes: fileNew.bytes, newChunks: fileNew.chunks });
  }

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
  const avgChunk = totalChunks > 0 ? totalBytes / totalChunks : 0;
  const uniqueBytesThisRun = totalBytes - intraDupBytes;

  // Record run
  const runRecord = {
    ts: new Date().toISOString(),
    label,
    files: files.length,
    totalBytes,
    totalChunks,
    uniqueBytesThisRun,
    intraDupBytes,
    newBytes,
    newChunks,
    newGzBytes,
    totalUniqueBytesAfter: idx.totalUniqueBytes,
    avgChunk,
    elapsedSec: Number(elapsed),
  };
  idx.runs.push(runRecord);
  saveIndex(idx);
  fs.writeFileSync(
    path.join(RUNS_DIR, `${runRecord.ts.replace(/[:.]/g, '-')}.json`),
    JSON.stringify({ run: runRecord, perFile }, null, 2)
  );

  // ----------------------------------------------------------------------
  // Report
  // ----------------------------------------------------------------------
  console.log(`\n--- This run (${elapsed}s) ---`);
  console.log(`Files scanned        : ${files.length}`);
  console.log(`Total size           : ${fmtBytes(totalBytes)}`);
  console.log(`Total chunks         : ${totalChunks}  (avg ${fmtBytes(avgChunk)})`);
  console.log(`Unique chunks in run : ${runChunkSeen.size}  -> intra-run dedup saves ${fmtBytes(intraDupBytes)}`);
  if (args.gzip) {
    const ratio = uniqueRawInScan > 0 ? (uniqueGzInScan / uniqueRawInScan) * 100 : 0;
    console.log(`Gzip of unique data  : ${fmtBytes(uniqueGzInScan)}  (${ratio.toFixed(1)}% of raw -> ${(100 - ratio).toFixed(1)}% smaller)`);
  }

  if (idx.runs.length === 1) {
    console.log(`\n--- Baseline (first run) ---`);
    console.log(`This is the BASELINE upload (first full backup): ${fmtBytes(newBytes)}`);
    console.log(`Drive storage after baseline                   : ${fmtBytes(idx.totalUniqueBytes)}`);
    if (args.gzip) {
      console.log(`  ...gzipped baseline storage                  : ${fmtBytes(newGzBytes)}`);
    }
    console.log(`\n  Run this tool AGAIN tomorrow (after Tally's nightly update) to`);
    console.log(`   measure the real day-over-day delta and project 30-day storage.`);
  } else {
    console.log(`\n--- Day-over-day delta (vs all previous runs) ---`);
    console.log(`NEW chunks tonight   : ${newChunks}`);
    console.log(`NEW bytes to upload  : ${fmtBytes(newBytes)}   <-- nightly upload with CDC`);
    if (args.gzip) {
      console.log(`  ...gzipped          : ${fmtBytes(newGzBytes)}`);
    }
    console.log(`Whole-file approach  : would re-upload ~${fmtBytes(totalBytes)} (entire changed files)`);
    if (totalBytes > 0) {
      const saving = (1 - newBytes / totalBytes) * 100;
      console.log(`CDC upload saving    : ${saving.toFixed(1)}% vs whole-file`);
    }

    // Projection: baseline unique bytes + average daily-new * 30 days
    const baseline = idx.runs[0].newBytes;
    const dailyNew = idx.runs.slice(1).map((r) => r.newBytes);
    const avgDaily = dailyNew.reduce((a, b) => a + b, 0) / dailyNew.length;
    const proj30 = baseline + avgDaily * 30;
    console.log(`\n--- Projected 30-day Drive STORAGE ---`);
    console.log(`Baseline (day 1)     : ${fmtBytes(baseline)}`);
    console.log(`Avg new bytes/day    : ${fmtBytes(avgDaily)}  (from ${dailyNew.length} delta run(s))`);
    console.log(`Projected @ 30 days  : ${fmtBytes(proj30)}`);
    const fits = proj30 <= 15 * GB;
    console.log(`Fits free 15 GB?     : ${fits ? 'YES ' : 'NO  -> revisit retention / chunk size / paid Drive'}`);
    if (args.gzip) {
      const baseGz = idx.runs[0].newGzBytes || 0;
      const dailyGz = idx.runs.slice(1).map((r) => r.newGzBytes || 0);
      const avgGz = dailyGz.reduce((a, b) => a + b, 0) / dailyGz.length;
      const projGz30 = baseGz + avgGz * 30;
      console.log(`Projected @ 30d (gz) : ${fmtBytes(projGz30)}  -> fits 15 GB? ${projGz30 <= 15 * GB ? 'YES' : 'NO'}`);
    }
  }

  // Top changed files this run (most new bytes)
  const topNew = perFile
    .filter((f) => f.newBytes > 0)
    .sort((a, b) => b.newBytes - a.newBytes)
    .slice(0, 12);
  if (topNew.length > 0) {
    console.log(`\n--- Top files by NEW bytes this run ---`);
    for (const f of topNew) {
      console.log(`  ${fmtBytes(f.newBytes).padStart(10)}  (${f.newChunks} new / ${f.chunks} chunks)  ${f.rel}`);
    }
  }

  console.log(`\nIndex updated: ${INDEX_FILE}`);
  console.log(`Run detail   : ${path.join(RUNS_DIR, runRecord.ts.replace(/[:.]/g, '-') + '.json')}\n`);
}

main().catch((err) => {
  console.error('measure-chunks failed:', err);
  process.exit(1);
});
