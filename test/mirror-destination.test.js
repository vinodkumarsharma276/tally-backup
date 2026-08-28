'use strict';

/*
 * Adding a second destination must copy the existing repository across rather
 * than failing, and the copy must be restorable on its own.
 *
 * Run: node test/mirror-destination.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');

const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const { resolveObjectStore } = require('../src/versioning/createObjectStore');

const ROOT = path.join(__dirname, '..', 'temp', 'mirror-e2e');
const SRC = path.join(ROOT, 'src');
const D1 = path.join(ROOT, 'main');
const D2 = path.join(ROOT, 'copy');
const CFG = path.join(ROOT, 'config.json');
const PROFILES = ['e2e-mirror-main', 'e2e-mirror-copy'];
const REPO_STATE = path.join(__dirname, '..', 'data', 'repo-state.json');
const silent = { info() {}, warn() {}, error() {} };

const results = [];
const check = (name, cond) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
};

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

async function writeConfig(destinations) {
  await fs.writeJson(CFG, {
    storageProfiles: {
      [PROFILES[0]]: { type: 'local', rootDir: D1 },
      [PROFILES[1]]: { type: 'local', rootDir: D2 },
    },
    backup: {
      sources: [{ name: 'Books', enabled: true, operation: 'backup', sourcePath: SRC, storageProfiles: destinations }],
      concurrency: 2,
    },
    retention: { keepDailyBackups: 30 },
  });
}

function runBackup() {
  const run = spawnSync(process.execPath, ['bin/versioned-backup.js', '--config', CFG], { encoding: 'utf8' });
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
}

async function engineFor(dir) {
  const backend = new LocalFsBackend(dir);
  return new VersionedBackup({
    backend,
    objectStore: await resolveObjectStore(backend, { type: 'local' }, { gzip: true }),
    snapshotStore: new SnapshotStore(backend),
    logger: silent,
  });
}

async function main() {
  await fs.remove(ROOT);
  await forgetTestProfiles();
  await fs.ensureDir(SRC);
  await fs.writeFile(path.join(SRC, 'ledger.txt'), 'x'.repeat(150000));
  await fs.writeFile(path.join(SRC, 'notes.txt'), 'y'.repeat(90000));

  // Establish history on one destination only.
  await writeConfig([PROFILES[0]]);
  let run = runBackup();
  check('initial single-destination backup succeeded', run.ok);
  await fs.writeFile(path.join(SRC, 'ledger.txt'), 'z'.repeat(150000));
  run = runBackup();
  check('second backup succeeded', run.ok);
  const before = await (await engineFor(D1)).list();
  check('main destination has two restore points', before.length === 2);

  // Now add a second destination, exactly as the user did.
  await writeConfig(PROFILES);
  run = runBackup();
  check('adding a destination does not fail', run.ok);
  if (!run.ok) console.log(run.output.slice(-1200));

  const mainAfter = await (await engineFor(D1)).list();
  const copied = await (await engineFor(D2)).list();
  check('copy received the full history, not just the latest', copied.length === mainAfter.length && copied.length > 2);
  check('copy holds the same restore points', copied.map((s) => s.id).join() === mainAfter.map((s) => s.id).join());
  check('copy has the repository marker', await fs.pathExists(path.join(D2, 'repo.json')));

  const mainMarker = await fs.readJson(path.join(D1, 'repo.json'));
  const copyMarker = await fs.readJson(path.join(D2, 'repo.json'));
  check('copy carries the same repository identity', mainMarker.id === copyMarker.id);

  // The copy must be independently restorable — that is the point of 3-2-1.
  const restored = path.join(ROOT, 'restored');
  const copyEngine = await engineFor(D2);
  await copyEngine.restore(copied[copied.length - 1].id, restored);
  const original = await fs.readFile(path.join(SRC, 'ledger.txt'), 'utf8');
  const roundTrip = await fs.readFile(path.join(restored, 'ledger.txt'), 'utf8');
  check('files restore from the copy byte-identically', original === roundTrip);

  // Re-running must not re-copy what is already there.
  run = runBackup();
  check('re-run succeeds', run.ok);
  check('re-run reports nothing new to copy', /0 object\(s\) copied|already present/.test(run.output));

  // A destination holding an unrelated history must still be refused.
  const foreign = path.join(ROOT, 'foreign');
  await fs.ensureDir(foreign);
  const foreignEngine = await engineFor(foreign);
  await foreignEngine.backup(SRC);
  await fs.writeJson(path.join(foreign, 'repo.json'), { id: 'someone-elses-repo', version: 1 });
  await fs.writeJson(CFG, {
    storageProfiles: {
      [PROFILES[0]]: { type: 'local', rootDir: D1 },
      [PROFILES[1]]: { type: 'local', rootDir: foreign },
    },
    backup: {
      sources: [{ name: 'Books', enabled: true, operation: 'backup', sourcePath: SRC, storageProfiles: PROFILES }],
    },
    retention: { keepDailyBackups: 30 },
  });
  run = runBackup();
  check('refuses to overwrite an unrelated history', !run.ok && /already holds a different backup history/.test(run.output));

  await fs.remove(ROOT);
  await forgetTestProfiles();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('MIRROR TEST ERROR', error);
  process.exit(2);
});
