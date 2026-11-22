'use strict';

/*
 * Regression test: a pack whose blob is gone but whose index survived.
 *
 * Pack compaction used to delete a pack's blob BEFORE its index. Any
 * interruption between those two calls — a dropped connection, a rate-limit
 * giving up, the machine sleeping — left `packs/idx/<id>.json` pointing at a
 * `packs/<id>` that no longer existed. That poisoned the repository for good:
 *
 *   1. every later run crashed with "Drive get: object not found packs/<id>",
 *      reported as a failed backup even though the snapshot had committed, and
 *   2. worse, the stale index made `has()` claim those chunks were stored, so
 *      `put()` skipped re-uploading them and the next snapshot referenced data
 *      that could not be read back.
 *
 * Reported from the field, 2026-11-22, on a Google Drive repository.
 *
 * Run: node test/pack-halfdeleted.test.js   (from the repo root)
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');

const Chunker = require('../src/versioning/Chunker');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const PackedObjectStore = require('../src/versioning/PackedObjectStore');
const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');

const ROOT = path.join(__dirname, '..', 'temp', 'pack-halfdeleted');
const SRC = path.join(ROOT, 'src');
const STORE = path.join(ROOT, 'store');
const RESTORE = path.join(ROOT, 'restore');

const silent = { info() {}, warn() {}, error() {} };

const results = [];
const check = (name, cond, detail) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
};

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

function makeEngine() {
  const backend = new LocalFsBackend(STORE);
  return new VersionedBackup({
    backend,
    chunker: new Chunker({ avg: 8192 }),
    objectStore: new PackedObjectStore(backend, { targetPackBytes: 64 * 1024 }),
    snapshotStore: new SnapshotStore(backend),
    logger: silent,
  });
}

async function hashDir(dir) {
  const out = {};
  const walk = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        out[path.relative(dir, full).split(path.sep).join('/')] =
          crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');
      }
    }
  };
  await walk(dir);
  return out;
}

const packDir = () => path.join(STORE, 'packs');
const idxDir = () => path.join(STORE, 'packs', 'idx');

async function listPackIds() {
  const names = await fs.readdir(packDir());
  return names.filter((n) => n !== 'idx');
}

async function listIdxIds() {
  const names = await fs.readdir(idxDir()).catch(() => []);
  return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
}

async function main() {
  await fs.remove(ROOT);
  await fs.ensureDir(SRC);

  // Enough distinct data to produce several packs at a 64 KB pack target.
  for (let i = 0; i < 6; i += 1) {
    await fs.writeFile(path.join(SRC, `file-${i}.bin`), genBytes(`v1-${i}`, 90 * 1024));
  }

  await makeEngine().backup([SRC], { source: 'halfdeleted' });
  const packsAfterBackup = await listPackIds();
  check('backup produced several packs', packsAfterBackup.length > 1, `${packsAfterBackup.length} pack(s)`);

  // --- Simulate the interrupted compaction: blob deleted, index left behind ---
  const victim = packsAfterBackup[0];
  await fs.remove(path.join(packDir(), victim));
  check('victim pack blob is gone', !(await fs.pathExists(path.join(packDir(), victim))));
  check('victim index survived', await fs.pathExists(path.join(idxDir(), `${victim}.json`)));

  const victimHashes = Object.keys(
    (await fs.readJson(path.join(idxDir(), `${victim}.json`))).entries
  );
  check('victim index claims chunks', victimHashes.length > 0, `${victimHashes.length} chunk(s)`);

  // 1. The stale index must not be believed. Before the fix `has()` returned
  //    true here, which is what let a later snapshot reference dead chunks.
  const store = new PackedObjectStore(new LocalFsBackend(STORE), { targetPackBytes: 64 * 1024 });
  const claimed = await store.has(victimHashes[0]);
  check('has() does not claim a chunk from a missing pack', claimed === false);

  // 2. GC must repair rather than throw "object not found".
  let gcError = null;
  let gc = null;
  try {
    gc = await makeEngine().gc({ keepDays: 30 });
  } catch (error) {
    gcError = error;
  }
  check('gc does not throw on a half-deleted pack', !gcError, gcError && gcError.message);
  check(
    'gc reports the repair',
    !!gc && !!gc.packCompaction && gc.packCompaction.repairedPacks > 0,
    gc && JSON.stringify(gc.packCompaction)
  );
  check('gc removed the stale index', !(await fs.pathExists(path.join(idxDir(), `${victim}.json`))));

  // 3. The next backup re-uploads what was lost, and a restore of the newest
  //    snapshot is byte-identical again.
  const stats = await makeEngine().backup([SRC], { source: 'halfdeleted' });
  check('next backup re-uploaded the lost chunks', stats.newChunks > 0, `${stats.newChunks} new chunk(s)`);

  await makeEngine().restore('latest', RESTORE);
  const same = JSON.stringify(await hashDir(SRC)) === JSON.stringify(await hashDir(RESTORE));
  check('restore after repair is byte-identical', same);

  // 4. Every index that remains must point at a pack that exists.
  const remainingIdx = await listIdxIds();
  const remainingPacks = new Set(await listPackIds());
  const dangling = remainingIdx.filter((id) => !remainingPacks.has(id));
  check('no index is left dangling', dangling.length === 0, dangling.join(', '));

  // 5. An orphan blob (the harmless residue the new delete order leaves) is
  //    swept, and never mistaken for live data.
  await fs.writeFile(path.join(packDir(), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'), Buffer.from('junk'));
  const gc2 = await makeEngine().gc({ keepDays: 30 });
  check(
    'gc sweeps a pack blob that has no index',
    !(await fs.pathExists(path.join(packDir(), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'))),
    JSON.stringify(gc2.packCompaction)
  );

  // 6. The reported crash itself: a pack that disappears between load() and
  //    gc(), with part of it still referenced, so collection takes the
  //    partial-rewrite path and reads the blob. That read is the frame in the
  //    field stack trace (PackedObjectStore._getPack via gc).
  const live = new PackedObjectStore(new LocalFsBackend(STORE), { targetPackBytes: 64 * 1024 });
  await live.load();
  const targetId = (await listIdxIds())[0];
  const targetHashes = Object.keys(
    (await fs.readJson(path.join(idxDir(), `${targetId}.json`))).entries
  );
  check('target pack holds several chunks', targetHashes.length > 1, `${targetHashes.length}`);

  // Keep all but one chunk referenced -> partial, so the pack must be rewritten.
  const referenced = new Set(await live.listHashes());
  referenced.delete(targetHashes[0]);
  await fs.remove(path.join(packDir(), targetId));

  let midRunError = null;
  let midRun = null;
  try {
    midRun = await live.gc(referenced);
  } catch (error) {
    midRunError = error;
  }
  check(
    'gc survives a pack that vanishes mid-run',
    !midRunError,
    midRunError && midRunError.message
  );
  check(
    'the vanished pack is reported as repaired',
    !!midRun && midRun.repairedPacks > 0,
    midRun && JSON.stringify(midRun)
  );
  check('its stale index is cleaned up too', !(await fs.pathExists(path.join(idxDir(), `${targetId}.json`))));

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
