'use strict';

/*
 * A backup covering several folders must be restorable folder by folder, so a
 * user recovering one company's data does not have to pull down everything.
 *
 * Run: node test/selective-root-restore.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');

const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const { resolveObjectStore } = require('../src/versioning/createObjectStore');

const ROOT = path.join(__dirname, '..', 'temp', 'selective-restore');
const A = path.join(ROOT, 'AcmeLtd');
const B = path.join(ROOT, 'BetaTraders');
const STORE = path.join(ROOT, 'store');
const CFG = path.join(ROOT, 'config.json');
const PROFILE = 'e2e-selective';
const REPO_STATE = path.join(__dirname, '..', 'data', 'repo-state.json');
const silent = { info() {}, warn() {}, error() {} };

const results = [];
const check = (name, cond) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
};

async function forgetProfile() {
  if (!(await fs.pathExists(REPO_STATE))) return;
  const state = await fs.readJson(REPO_STATE).catch(() => ({}));
  if (PROFILE in state) { delete state[PROFILE]; await fs.writeJson(REPO_STATE, state, { spaces: 2 }); }
}

async function main() {
  await fs.remove(ROOT);
  await forgetProfile();
  await fs.ensureDir(A);
  await fs.ensureDir(B);
  await fs.writeFile(path.join(A, 'ledger.txt'), 'acme books');
  await fs.writeFile(path.join(B, 'ledger.txt'), 'beta books');

  await fs.writeJson(CFG, {
    storageProfiles: { [PROFILE]: { type: 'local', rootDir: STORE } },
    backup: {
      sources: [{
        name: 'All companies',
        enabled: true,
        operation: 'backup',
        sourcePaths: [A, B],
        storageProfiles: [PROFILE],
      }],
    },
    retention: { keepDailyBackups: 30 },
  });

  const backup = spawnSync(process.execPath, ['bin/versioned-backup.js', '--config', CFG], { encoding: 'utf8' });
  check('multi-folder backup succeeded', backup.status === 0);

  const backend = new LocalFsBackend(STORE);
  const store = new SnapshotStore(backend);
  const refs = await store.readRefs();
  const entry = refs.snapshots[refs.snapshots.length - 1];
  check('restore points record the folders they contain', Array.isArray(entry.roots) && entry.roots.length === 2);

  const engine = new VersionedBackup({
    backend,
    objectStore: await resolveObjectStore(backend, { type: 'local' }, { gzip: true }),
    snapshotStore: store,
    logger: silent,
  });

  // Restore only one company.
  const oneDest = path.join(ROOT, 'restored-acme');
  const stats = await engine.restore(entry.id, oneDest, { roots: ['AcmeLtd'] });
  check('only the chosen folder is restored', await fs.pathExists(path.join(oneDest, 'AcmeLtd', 'ledger.txt')));
  check('the other folder is left out', !(await fs.pathExists(path.join(oneDest, 'BetaTraders'))));
  check(
    'restored content is correct',
    (await fs.readFile(path.join(oneDest, 'AcmeLtd', 'ledger.txt'), 'utf8')) === 'acme books'
  );
  check('reported file count matches the subset', stats.fileCount === 1 || stats.filesWritten === 1);

  // Restoring everything still works.
  const allDest = path.join(ROOT, 'restored-all');
  await engine.restore(entry.id, allDest, {});
  check(
    'restoring without a filter recovers every folder',
    (await fs.pathExists(path.join(allDest, 'AcmeLtd', 'ledger.txt'))) &&
      (await fs.pathExists(path.join(allDest, 'BetaTraders', 'ledger.txt')))
  );

  // A nonsense selection must fail loudly rather than silently restoring nothing.
  let threw = null;
  try {
    await engine.restore(entry.id, path.join(ROOT, 'restored-none'), { roots: ['NoSuchCompany'] });
  } catch (error) { threw = error; }
  check('an unknown folder is reported, not silently ignored', threw && /No files found/.test(threw.message));

  // The CLI exposes the same behaviour.
  const cliDest = path.join(ROOT, 'restored-cli');
  const cli = spawnSync(
    process.execPath,
    ['bin/versioned-restore.js', '--config', CFG, '--profile', PROFILE, '--dest', cliDest, '--root', 'BetaTraders'],
    { encoding: 'utf8' }
  );
  check('--root restores a single folder from the CLI',
    cli.status === 0 &&
    (await fs.pathExists(path.join(cliDest, 'BetaTraders', 'ledger.txt'))) &&
    !(await fs.pathExists(path.join(cliDest, 'AcmeLtd'))));

  await fs.remove(ROOT);
  await forgetProfile();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('SELECTIVE RESTORE TEST ERROR', error);
  process.exit(2);
});
