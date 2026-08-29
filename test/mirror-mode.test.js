'use strict';

/*
 * Exact-copy (mirror) backup: a plain, browsable copy of a folder with no
 * chunking and no history. It must copy only what changed, never copy a folder
 * into itself, and never delete anything unless pruning was asked for.
 *
 * Run: node test/mirror-mode.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');

const MirrorBackup = require('../src/MirrorBackup');

const ROOT = path.join(__dirname, '..', 'temp', 'mirror-mode');
const SRC = path.join(ROOT, 'live');
const DEST = path.join(ROOT, 'copy');
const CFG = path.join(ROOT, 'config.json');
const silent = { info() {}, warn() {}, error() {} };

const results = [];
const check = (name, cond) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
};

async function main() {
  await fs.remove(ROOT);
  await fs.ensureDir(path.join(SRC, 'nested'));
  await fs.writeFile(path.join(SRC, 'ledger.txt'), 'day one');
  await fs.writeFile(path.join(SRC, 'nested', 'notes.txt'), 'notes');

  const mirror = new MirrorBackup({ logger: silent });

  const first = await mirror.run([SRC], DEST, {});
  check('files are copied as ordinary files', await fs.pathExists(path.join(DEST, 'ledger.txt')));
  check('nested folders are preserved', await fs.pathExists(path.join(DEST, 'nested', 'notes.txt')));
  check('the copy is directly readable', (await fs.readFile(path.join(DEST, 'ledger.txt'), 'utf8')) === 'day one');
  check('no chunk store is created', !(await fs.pathExists(path.join(DEST, 'objects'))) && !(await fs.pathExists(path.join(DEST, 'refs.json'))));
  check('first run copies everything', first.copiedFiles === 2 && first.skippedFiles === 0);

  const second = await mirror.run([SRC], DEST, {});
  check('unchanged files are not copied again', second.copiedFiles === 0 && second.skippedFiles === 2);

  await fs.writeFile(path.join(SRC, 'ledger.txt'), 'day two changed');
  const third = await mirror.run([SRC], DEST, {});
  check('changed files are copied', third.copiedFiles === 1 && third.skippedFiles === 1);
  check('the copy reflects the change', (await fs.readFile(path.join(DEST, 'ledger.txt'), 'utf8')) === 'day two changed');

  await fs.remove(path.join(SRC, 'nested', 'notes.txt'));
  await mirror.run([SRC], DEST, {});
  check('a deleted source file is kept in the copy by default', await fs.pathExists(path.join(DEST, 'nested', 'notes.txt')));

  const pruned = await mirror.run([SRC], DEST, { prune: true });
  check('pruning removes files no longer in the source', !(await fs.pathExists(path.join(DEST, 'nested', 'notes.txt'))));
  check('pruning is reported', pruned.deletedFiles === 1);

  let threw = null;
  try { await mirror.run([SRC], path.join(SRC, 'inside'), {}); } catch (error) { threw = error; }
  check('refuses to copy a folder into itself', threw && /inside the folder being copied/.test(threw.message));

  threw = null;
  try { await mirror.run([path.join(DEST, 'sub')], DEST, {}); } catch (error) { threw = error; }
  check('refuses a destination that contains the source', threw && /inside the destination/.test(threw.message));

  const SRC2 = path.join(ROOT, 'second');
  await fs.ensureDir(SRC2);
  await fs.writeFile(path.join(SRC2, 'ledger.txt'), 'other company');
  const DEST2 = path.join(ROOT, 'copy-multi');
  await mirror.run([SRC, SRC2], DEST2, {});
  check('multiple folders do not collide',
    (await fs.readFile(path.join(DEST2, 'live', 'ledger.txt'), 'utf8')) === 'day two changed' &&
    (await fs.readFile(path.join(DEST2, 'second', 'ledger.txt'), 'utf8')) === 'other company');

  const RUN_DEST = path.join(ROOT, 'runner-dest');
  await fs.writeJson(CFG, {
    storageProfiles: { 'e2e-mirror-local': { type: 'local', rootDir: RUN_DEST } },
    backup: {
      sources: [{
        name: 'Exact copy job',
        enabled: true,
        operation: 'backup',
        mode: 'mirror',
        sourcePath: SRC,
        storageProfiles: ['e2e-mirror-local'],
      }],
    },
    retention: { keepDailyBackups: 30 },
  });
  const run = spawnSync(process.execPath, ['bin/versioned-backup.js', '--config', CFG], { encoding: 'utf8' });
  check('the runner performs an exact copy', run.status === 0);
  if (run.status !== 0) console.log(`${run.stdout}${run.stderr}`.slice(-1200));
  check('runner output lands in a named folder',
    await fs.pathExists(path.join(RUN_DEST, 'Exact copy job', 'ledger.txt')));
  check('runner made no repository files',
    !(await fs.pathExists(path.join(RUN_DEST, 'Exact copy job', 'repo.json'))));

  await fs.writeJson(CFG, {
    storageProfiles: { 'e2e-mirror-drive': { type: 'google_drive', rootFolderName: 'X' } },
    backup: {
      sources: [{
        name: 'Exact copy job',
        enabled: true,
        operation: 'backup',
        mode: 'mirror',
        sourcePath: SRC,
        storageProfiles: ['e2e-mirror-drive'],
      }],
    },
    retention: { keepDailyBackups: 30 },
  });
  const cloud = spawnSync(process.execPath, ['bin/versioned-backup.js', '--config', CFG], { encoding: 'utf8' });
  check('a cloud destination is rejected with a clear reason',
    cloud.status !== 0 && /needs a folder on this computer/.test(`${cloud.stdout}${cloud.stderr}`));

  await fs.remove(ROOT);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('MIRROR MODE TEST ERROR', error);
  process.exit(2);
});
