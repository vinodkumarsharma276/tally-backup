'use strict';

/*
 * Layout selection: new Google Drive repositories must use packed mode, but an
 * existing repository must keep whatever layout it already holds — flipping it
 * would hide existing restore points and re-upload everything.
 *
 * Run: node test/object-store-layout.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');

const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const { detectLayout, resolveObjectStore } = require('../src/versioning/createObjectStore');

const ROOT = path.join(__dirname, '..', 'temp', 'layout-test');
const SRC = path.join(ROOT, 'src');
const silent = { info() {}, warn() {}, error() {} };

const results = [];
const check = (name, cond) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
};

async function backupInto(dir, profile) {
  const backend = new LocalFsBackend(dir);
  const engine = new VersionedBackup({
    backend,
    objectStore: await resolveObjectStore(backend, profile, { gzip: true }),
    snapshotStore: new SnapshotStore(backend),
    logger: silent,
  });
  return { backend, engine, stats: await engine.backup(SRC) };
}

async function main() {
  await fs.remove(ROOT);
  await fs.ensureDir(SRC);
  await fs.writeFile(path.join(SRC, 'a.txt'), 'x'.repeat(200000));
  await fs.writeFile(path.join(SRC, 'b.txt'), 'y'.repeat(200000));

  const drive = { type: 'google_drive', rootFolderName: 'f' };
  const local = { type: 'local', rootDir: 'd' };

  // A brand-new Drive repository defaults to packed.
  const fresh = path.join(ROOT, 'fresh-drive');
  await fs.ensureDir(fresh);
  check('new Google Drive repository uses packed', (await detectLayout(new LocalFsBackend(fresh), drive)) === 'packed');
  await backupInto(fresh, drive);
  check('packed repository wrote pack files', (await fs.pathExists(path.join(fresh, 'packs'))) && !(await fs.pathExists(path.join(fresh, 'objects'))));
  check('existing packed repository stays packed', (await detectLayout(new LocalFsBackend(fresh), drive)) === 'packed');

  // A local repository stays on the loose-object layout.
  const localRepo = path.join(ROOT, 'local');
  await fs.ensureDir(localRepo);
  check('new local repository uses loose objects', (await detectLayout(new LocalFsBackend(localRepo), local)) === 'objects');

  // The critical case: a Drive repository created before packed mode.
  const legacy = path.join(ROOT, 'legacy-drive');
  await fs.ensureDir(legacy);
  await backupInto(legacy, { ...drive, packed: false });
  check('legacy repository wrote loose objects', await fs.pathExists(path.join(legacy, 'objects')));
  check('legacy Drive repository is NOT switched to packed', (await detectLayout(new LocalFsBackend(legacy), drive)) === 'objects');

  // ...and a second backup of unchanged data must store nothing new, which only
  // holds if the existing chunks are still visible.
  const second = await backupInto(legacy, drive);
  check('legacy repository does not re-upload after the default changed', second.stats.newChunks === 0);

  const restored = path.join(ROOT, 'restored');
  await second.engine.restore(second.stats.snapshotId, restored);
  const original = await fs.readFile(path.join(SRC, 'a.txt'), 'utf8');
  const roundTrip = await fs.readFile(path.join(restored, 'a.txt'), 'utf8');
  check('legacy restore points remain restorable', original === roundTrip);

  // An explicit profile setting still wins.
  check('explicit packed:false is honoured', (await detectLayout(new LocalFsBackend(fresh), { ...drive, packed: false })) === 'objects');

  await fs.remove(ROOT);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('LAYOUT TEST ERROR', error);
  process.exit(2);
});
