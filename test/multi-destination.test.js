'use strict';

/*
 * Multi-destination backup (3-2-1) and repository verification, exercised through
 * the real runner and engine against two local destinations.
 *
 * Run: node test/multi-destination.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');

const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const ObjectStore = require('../src/versioning/ObjectStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');

const ROOT = path.join(__dirname, '..', 'temp', 'multi-dest-e2e');
const SRC = path.join(ROOT, 'src');
const D1 = path.join(ROOT, 'dest-primary');
const D2 = path.join(ROOT, 'dest-offsite');
const CFG = path.join(ROOT, 'config.json');
const PROFILES = ['e2e-test-primary', 'e2e-test-offsite'];
// The runner records repository identity globally, so a rerun would otherwise
// see the deleted temp destinations as "repository missing" and refuse to run.
const REPO_STATE = path.join(__dirname, '..', 'data', 'repo-state.json');
const silent = { info() {}, warn() {}, error() {} };

async function forgetTestProfiles() {
  if (!(await fs.pathExists(REPO_STATE))) return;
  const state = await fs.readJson(REPO_STATE).catch(() => ({}));
  let changed = false;
  for (const name of PROFILES) {
    if (name in state) {
      delete state[name];
      changed = true;
    }
  }
  if (changed) await fs.writeJson(REPO_STATE, state, { spaces: 2 });
}

function engineFor(dir) {
  const backend = new LocalFsBackend(dir);
  return new VersionedBackup({
    backend,
    objectStore: new ObjectStore(backend, { gzip: true }),
    snapshotStore: new SnapshotStore(backend),
    logger: silent,
  });
}

async function main() {
  await fs.remove(ROOT);
  await forgetTestProfiles();
  await fs.ensureDir(SRC);
  await fs.writeFile(path.join(SRC, 'ledger.txt'), 'accounts data');
  await fs.writeFile(path.join(SRC, 'notes.txt'), 'more data');

  await fs.writeJson(CFG, {
    storageProfiles: {
      [PROFILES[0]]: { type: 'local', rootDir: D1 },
      [PROFILES[1]]: { type: 'local', rootDir: D2 },
    },
    backup: {
      sources: [{
        name: 'Books',
        enabled: true,
        operation: 'backup',
        sourcePath: SRC,
        storageProfiles: PROFILES,
      }],
      concurrency: 2,
    },
    retention: { keepDailyBackups: 30 },
  });

  const results = [];
  const check = (name, cond) => {
    results.push([name, !!cond]);
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  };

  const run = spawnSync(process.execPath, ['bin/versioned-backup.js', '--config', CFG], { encoding: 'utf8' });
  const output = `${run.stdout}${run.stderr}`;

  check('backup run succeeded', run.status === 0);
  check('primary destination written', await fs.pathExists(path.join(D1, 'refs.json')));
  check('second destination written', await fs.pathExists(path.join(D2, 'refs.json')));
  check('both destinations got a repository marker',
    (await fs.pathExists(path.join(D1, 'repo.json'))) && (await fs.pathExists(path.join(D2, 'repo.json'))));

  const s1 = await engineFor(D1).list();
  const s2 = await engineFor(D2).list();
  check('each destination has its own restore point', s1.length === 1 && s2.length === 1);

  // Verify: healthy repository reports OK.
  const clean = await engineFor(D1).verify();
  check('verify passes on a healthy repository', clean.ok && clean.referencedChunks > 0);

  // Verify: detect partial deletion (the silent-corruption case).
  const objectsDir = path.join(D2, 'objects');
  const shards = await fs.readdir(objectsDir);
  const shardDir = path.join(objectsDir, shards[0]);
  const [victim] = await fs.readdir(shardDir);
  await fs.remove(path.join(shardDir, victim));

  const damaged = await engineFor(D2).verify();
  check('verify detects a missing chunk', !damaged.ok && damaged.missingChunks === 1);
  check('verify names the affected restore point', damaged.damagedSnapshots.length === 1);

  await fs.remove(ROOT);
  await forgetTestProfiles();
  const failed = results.filter(([, ok]) => !ok);
  if (failed.length) console.log('\n--- runner output ---\n', output.slice(-1500));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('MULTI-DEST ERROR', error);
  process.exit(2);
});
