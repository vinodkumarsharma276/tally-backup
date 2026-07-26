'use strict';

/*
 * End-to-end test of E5 pack files: real VersionedBackup engine + PackedObjectStore
 * over a LocalFsBackend. Verifies packing, restore integrity, dedup, cold-index
 * load, and pack-aware GC compaction. No network.
 *
 * Run: node test/packed.test.js   (from the repo root)
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');

const Chunker = require('../src/versioning/Chunker');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const { createObjectStore } = require('../src/versioning/createObjectStore');

const ROOT = path.join(__dirname, '..', 'temp', 'pack-e2e');
const SRC = path.join(ROOT, 'src');
const STORE = path.join(ROOT, 'store');
const RESTORE = path.join(ROOT, 'restore');
const RESTORE2 = path.join(ROOT, 'restore-cold');
const RESTORE3 = path.join(ROOT, 'restore-after-gc');

const silent = { info() {}, warn() {}, error() {} };
const PROFILE = { packed: true, targetPackBytes: 64 * 1024 };

function genBytes(seed, len) {
  const out = Buffer.alloc(len);
  let h = crypto.createHash('sha256').update(String(seed)).digest();
  let pos = 0;
  while (pos < len) {
    h = crypto.createHash('sha256').update(h).digest();
    h.copy(out, pos);
    pos += h.length;
  }
  return out.subarray(0, len);
}

async function hashDir(dir) {
  const map = {};
  const walk = async (d, base) => {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const rel = path.join(base, entry.name).split(path.sep).join('/');
      if (entry.isDirectory()) await walk(full, rel);
      else map[rel] = crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');
    }
  };
  await walk(dir, '');
  return map;
}

function sameTree(a, b) {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length || ak.join('|') !== bk.join('|')) return false;
  return ak.every((k) => a[k] === b[k]);
}

function makeEngine() {
  const backend = new LocalFsBackend(STORE);
  return new VersionedBackup({
    backend,
    chunker: new Chunker({ avg: 8192 }),
    objectStore: createObjectStore(backend, PROFILE, { gzip: true }),
    snapshotStore: new SnapshotStore(backend),
    concurrency: 4,
    logger: silent,
  });
}

async function main() {
  await fs.remove(ROOT);
  await fs.ensureDir(SRC);
  await fs.writeFile(path.join(SRC, 'a.dat'), genBytes('A', 200000));
  await fs.writeFile(path.join(SRC, 'b.dat'), genBytes('B', 200000));
  await fs.writeFile(path.join(SRC, 'c.dat'), genBytes('C', 150000));
  await fs.ensureDir(path.join(SRC, 'sub'));
  await fs.writeFile(path.join(SRC, 'sub', 'd.dat'), genBytes('A', 200000)); // duplicate of a.dat
  await fs.writeFile(path.join(SRC, 'sub', 'e.dat'), genBytes('E', 90000));

  const results = [];
  const check = (name, cond) => {
    results.push([name, !!cond]);
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  };

  const backend = new LocalFsBackend(STORE);

  // 1. First backup -> packs.
  const stats1 = await makeEngine().backup(SRC, { source: 'pack-test' });
  check('first backup stored new chunks', stats1.newChunks > 0);
  const packBlobs = (await backend.list('packs/')).filter((k) => !k.includes('/idx/'));
  const packIdx = (await backend.list('packs/idx/'));
  check('created multiple pack objects', packBlobs.length >= 2);
  check('each pack has an index', packIdx.length === packBlobs.length);
  check('no per-chunk objects/ layout used', (await backend.list('objects/')).length === 0);

  // 2. Restore -> byte-identical.
  await makeEngine().restore('latest', RESTORE);
  const srcHashes = await hashDir(SRC);
  check('restore is byte-identical to source', sameTree(srcHashes, await hashDir(RESTORE)));

  // 3. Dedup: unchanged re-backup stores nothing new.
  const stats2 = await makeEngine().backup(SRC, { source: 'pack-test' });
  check('unchanged re-backup stores 0 new chunks', stats2.newChunks === 0);

  // 4. Replace a unique file's content -> its old chunks become orphans later.
  await fs.writeFile(path.join(SRC, 'c.dat'), genBytes('C-v2', 170000));
  const stats3 = await makeEngine().backup(SRC, { source: 'pack-test' });
  check('modified backup stores some new chunks', stats3.newChunks > 0);

  // 5. Cold index load: a brand-new store instance restores the latest correctly.
  await makeEngine().restore('latest', RESTORE2);
  check('cold-loaded index restores correctly', sameTree(await hashDir(SRC), await hashDir(RESTORE2)));

  // 6. Pack-aware GC compaction, then restore still works.
  const gc = await makeEngine().gc({ keepDays: 0 });
  check('gc removed unreferenced chunks', gc.deletedChunks > 0);
  check('gc compacted packs (delete/rewrite)', !!gc.packCompaction && (gc.packCompaction.deletedPacks + gc.packCompaction.rewrittenPacks) > 0);
  await makeEngine().restore('latest', RESTORE3);
  check('restore after gc is byte-identical', sameTree(await hashDir(SRC), await hashDir(RESTORE3)));

  await fs.remove(ROOT);

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('PACK E2E ERROR', error);
  process.exit(2);
});
