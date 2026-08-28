'use strict';

/*
 * Restoring a backup must not require a separate restore job: any storage
 * profile can be restored directly, at any restore point, into a new folder.
 *
 * Run: node test/restore-by-profile.test.js   (from the repo root)
 */

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');

const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const { resolveObjectStore } = require('../src/versioning/createObjectStore');

const ROOT = path.join(__dirname, '..', 'temp', 'restore-profile-e2e');
const SRC = path.join(ROOT, 'src');
const STORE = path.join(ROOT, 'store');
const CFG = path.join(ROOT, 'config.json');
const PROFILE = 'e2e-restore-store';
const REPO_STATE = path.join(__dirname, '..', 'data', 'repo-state.json');
const silent = { info() {}, warn() {}, error() {} };

const results = [];
const check = (name, cond) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
};

async function forgetTestProfile() {
  if (!(await fs.pathExists(REPO_STATE))) return;
  const state = await fs.readJson(REPO_STATE).catch(() => ({}));
  if (PROFILE in state) {
    delete state[PROFILE];
    await fs.writeJson(REPO_STATE, state, { spaces: 2 });
  }
}

function run(script, args) {
  const result = spawnSync(process.execPath, [script, '--config', CFG, ...args], { encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

async function main() {
  await fs.remove(ROOT);
  await forgetTestProfile();
  await fs.ensureDir(SRC);

  await fs.writeJson(CFG, {
    storageProfiles: { [PROFILE]: { type: 'local', rootDir: STORE } },
    backup: {
      sources: [{ name: 'Ledgers', enabled: true, operation: 'backup', sourcePath: SRC, storageProfiles: [PROFILE] }],
    },
    retention: { keepDailyBackups: 30 },
  });

  // Day one, then day two with changed content.
  await fs.writeFile(path.join(SRC, 'ledger.txt'), 'day one figures');
  check('first backup succeeded', run('bin/versioned-backup.js', []).ok);
  await fs.writeFile(path.join(SRC, 'ledger.txt'), 'day two figures');
  check('second backup succeeded', run('bin/versioned-backup.js', []).ok);

  const backend = new LocalFsBackend(STORE);
  const engine = new VersionedBackup({
    backend,
    objectStore: await resolveObjectStore(backend, { type: 'local' }, { gzip: true }),
    snapshotStore: new SnapshotStore(backend),
    logger: silent,
  });
  const points = await engine.list();
  check('two restore points are available', points.length === 2);

  // Restore the OLDER version straight from the storage profile.
  const oldDest = path.join(ROOT, 'restored-old');
  const older = run('bin/versioned-restore.js', ['--profile', PROFILE, '--snapshot', points[0].id, '--dest', oldDest]);
  check('restore by profile needs no restore job', older.ok);
  if (!older.ok) console.log(older.output.slice(-1200));
  check(
    'yesterday\u2019s version is recovered',
    (await fs.readFile(path.join(oldDest, 'ledger.txt'), 'utf8').catch(() => '')) === 'day one figures'
  );

  // Latest by default.
  const latestDest = path.join(ROOT, 'restored-latest');
  check('restoring the latest works', run('bin/versioned-restore.js', ['--profile', PROFILE, '--dest', latestDest]).ok);
  check(
    'latest version is recovered',
    (await fs.readFile(path.join(latestDest, 'ledger.txt'), 'utf8').catch(() => '')) === 'day two figures'
  );

  // The live source folder must not be overwritten by accident.
  const intoSource = run('bin/versioned-restore.js', ['--profile', PROFILE, '--dest', SRC]);
  check('refuses to restore over the live backup folder', !intoSource.ok && /Refusing to restore/.test(intoSource.output));

  check('unknown profile is rejected', !run('bin/versioned-restore.js', ['--profile', 'nope', '--dest', latestDest]).ok);

  // With no --dest, files land under Downloads rather than anywhere unexpected.
  const downloads = path.join(os.homedir(), 'Downloads');
  const before = new Set(await fs.readdir(downloads).catch(() => []));
  const defaulted = run('bin/versioned-restore.js', ['--profile', PROFILE]);
  const after = await fs.readdir(downloads).catch(() => []);
  const created = after.filter((name) => !before.has(name) && name.startsWith('Backup Genie restore'));
  check('default destination is the Downloads folder', defaulted.ok && created.length === 1);
  for (const name of created) await fs.remove(path.join(downloads, name));

  await fs.remove(ROOT);
  await forgetTestProfile();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('RESTORE TEST ERROR', error);
  process.exit(2);
});
