'use strict';

/*
 * Restore history is configured per storage profile, and an extra copy follows
 * the main destination rather than pruning independently.
 *
 * Run: node test/per-profile-retention.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');

const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const { resolveObjectStore } = require('../src/versioning/createObjectStore');

const ROOT = path.join(__dirname, '..', 'temp', 'retention-e2e');
const SRC = path.join(ROOT, 'src');
const SHORT = path.join(ROOT, 'short-history');
const COPY = path.join(ROOT, 'copy');
const CFG = path.join(ROOT, 'config.json');
const PROFILES = ['e2e-ret-main', 'e2e-ret-copy'];
const REPO_STATE = path.join(__dirname, '..', 'data', 'repo-state.json');
const DAY = 24 * 60 * 60 * 1000;
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
    if (name in state) { delete state[name]; changed = true; }
  }
  if (changed) await fs.writeJson(REPO_STATE, state, { spaces: 2 });
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

function runBackup() {
  const run = spawnSync(process.execPath, ['bin/versioned-backup.js', '--config', CFG], { encoding: 'utf8' });
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
}

// Backdate a snapshot so retention has something old to remove. GC reads the
// timestamp from refs.json, so that is the copy that matters.
async function ageSnapshot(dir, snapshotId, days) {
  const agedAt = new Date(Date.now() - days * DAY).toISOString();
  const refsFile = path.join(dir, 'refs.json');
  const refs = await fs.readJson(refsFile);
  for (const entry of refs.snapshots) {
    if (entry.id === snapshotId) entry.createdAt = agedAt;
  }
  await fs.writeJson(refsFile, refs);
}

async function main() {
  await fs.remove(ROOT);
  await forgetTestProfiles();
  await fs.ensureDir(SRC);
  await fs.writeFile(path.join(SRC, 'a.txt'), 'one');

  await fs.writeJson(CFG, {
    storageProfiles: {
      [PROFILES[0]]: { type: 'local', rootDir: SHORT, keepDailyBackups: 2 },
      [PROFILES[1]]: { type: 'local', rootDir: COPY, keepDailyBackups: 30 },
    },
    backup: {
      sources: [{ name: 'Books', enabled: true, operation: 'backup', sourcePath: SRC, storageProfiles: PROFILES }],
    },
    retention: { keepDailyBackups: 30 },
  });

  check('first backup succeeded', runBackup().ok);

  const first = (await (await engineFor(SHORT)).list())[0];
  await ageSnapshot(SHORT, first.id, 10);

  await fs.writeFile(path.join(SRC, 'a.txt'), 'two');
  const second = runBackup();
  check('second backup succeeded', second.ok);
  if (!second.ok) console.log(second.output.slice(-1200));

  const kept = await (await engineFor(SHORT)).list();
  check('profile retention of 2 days dropped the 10-day-old restore point', !kept.some((s) => s.id === first.id));
  check('the current restore point is kept', kept.length >= 1);

  const copyKept = await (await engineFor(COPY)).list();
  check('the extra copy follows the main destination', copyKept.map((s) => s.id).join() === kept.map((s) => s.id).join());

  // The copy must not hoard chunks the main destination has pruned.
  const chunkCount = async (dir) => (await (new LocalFsBackend(dir)).list('objects')).length
    + (await (new LocalFsBackend(dir)).list('packs')).length;
  const mainChunks = await chunkCount(SHORT);
  const copyChunks = await chunkCount(COPY);
  check('the copy does not accumulate orphaned data', copyChunks <= mainChunks);

  await fs.remove(ROOT);
  await forgetTestProfiles();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('RETENTION TEST ERROR', error);
  process.exit(2);
});
