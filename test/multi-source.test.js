'use strict';

/*
 * Multi-folder backup: several source folders into ONE storage location, with
 * per-folder namespaces so identically named files never collide, and a restore
 * that recreates them as sibling folders.
 *
 * Run: node test/multi-source.test.js   (from the repo root)
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');

const Chunker = require('../src/versioning/Chunker');
const ObjectStore = require('../src/versioning/ObjectStore');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');

const ROOT = path.join(__dirname, '..', 'temp', 'multi-src-e2e');
const A = path.join(ROOT, 'Accounts');
const B = path.join(ROOT, 'Payroll');
const STORE = path.join(ROOT, 'store');
const RESTORE = path.join(ROOT, 'restore');

const silent = { info() {}, warn() {}, error() {} };

function engine() {
  const backend = new LocalFsBackend(STORE);
  return new VersionedBackup({
    backend,
    chunker: new Chunker({ avg: 8192 }),
    objectStore: new ObjectStore(backend, { gzip: true }),
    snapshotStore: new SnapshotStore(backend),
    concurrency: 4,
    logger: silent,
  });
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function main() {
  await fs.remove(ROOT);
  await fs.ensureDir(A);
  await fs.ensureDir(B);

  // Same file NAME in both folders, different CONTENT -> the collision case.
  await fs.writeFile(path.join(A, 'data.txt'), 'ACCOUNTS DATA');
  await fs.writeFile(path.join(B, 'data.txt'), 'PAYROLL DATA');
  await fs.ensureDir(path.join(A, 'sub'));
  await fs.writeFile(path.join(A, 'sub', 'ledger.txt'), 'LEDGER');
  await fs.writeFile(path.join(B, 'slips.txt'), 'SLIPS');

  const results = [];
  const check = (name, cond) => {
    results.push([name, !!cond]);
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  };

  // Back up BOTH folders into ONE store.
  const stats = await engine().backup([A, B], { source: 'Multi' });
  check('all files from both folders captured', stats.fileCount === 4);

  const snap = await new SnapshotStore(new LocalFsBackend(STORE)).read(stats.snapshotId);
  const keys = Object.keys(snap.files).sort();
  check('paths are namespaced per folder', keys.includes('Accounts/data.txt') && keys.includes('Payroll/data.txt'));
  check('nested paths preserved', keys.includes('Accounts/sub/ledger.txt'));
  check('snapshot records both roots', Array.isArray(snap.roots) && snap.roots.length === 2);

  // Restore into a single destination.
  await engine().restore('latest', RESTORE);
  const accounts = await fs.readFile(path.join(RESTORE, 'Accounts', 'data.txt'), 'utf8');
  const payroll = await fs.readFile(path.join(RESTORE, 'Payroll', 'data.txt'), 'utf8');
  check('same-named files restored without collision', accounts === 'ACCOUNTS DATA' && payroll === 'PAYROLL DATA');
  check('nested file restored', (await fs.readFile(path.join(RESTORE, 'Accounts', 'sub', 'ledger.txt'), 'utf8')) === 'LEDGER');
  check('second folder file restored', (await fs.readFile(path.join(RESTORE, 'Payroll', 'slips.txt'), 'utf8')) === 'SLIPS');

  // Dedup still works across folders: identical content stored once.
  await fs.writeFile(path.join(B, 'copy-of-ledger.txt'), 'LEDGER');
  const stats2 = await engine().backup([A, B], { source: 'Multi' });
  check('identical content across folders is deduplicated', stats2.newChunks === 0);

  // Backward compatibility: a single folder keeps un-namespaced paths.
  const SINGLE = path.join(ROOT, 'single-store');
  const singleBackend = new LocalFsBackend(SINGLE);
  const singleEngine = new VersionedBackup({
    backend: singleBackend,
    chunker: new Chunker({ avg: 8192 }),
    objectStore: new ObjectStore(singleBackend, { gzip: true }),
    snapshotStore: new SnapshotStore(singleBackend),
    logger: silent,
  });
  const s3 = await singleEngine.backup(A, { source: 'Single' });
  const snapSingle = await new SnapshotStore(new LocalFsBackend(SINGLE)).read(s3.snapshotId);
  check('single-folder backup stays un-namespaced', Object.keys(snapSingle.files).includes('data.txt'));

  // Custom labels decide the stored sub-folder name.
  const LBL = path.join(ROOT, 'labelled-store');
  const lblBackend = new LocalFsBackend(LBL);
  const lblEngine = new VersionedBackup({
    backend: lblBackend,
    chunker: new Chunker({ avg: 8192 }),
    objectStore: new ObjectStore(lblBackend, { gzip: true }),
    snapshotStore: new SnapshotStore(lblBackend),
    logger: silent,
  });
  const s4 = await lblEngine.backup(
    [{ path: A, label: 'Accounts 2024' }, { path: B, label: 'Payroll 2024' }],
    { source: 'Labelled' }
  );
  const labelled = Object.keys((await new SnapshotStore(new LocalFsBackend(LBL)).read(s4.snapshotId)).files);
  check('custom labels used as namespaces', labelled.some((k) => k.startsWith('Accounts 2024/')) && labelled.some((k) => k.startsWith('Payroll 2024/')));

  await fs.remove(ROOT);

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('MULTI-SOURCE E2E ERROR', error);
  process.exit(2);
});
