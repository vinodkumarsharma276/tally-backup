'use strict';

/*
 * The app data folder was renamed from TallyBackupApp to BackupGenie. An
 * existing install must keep its settings, history and repository state, and a
 * locked file must never stop the app from starting.
 *
 * Run: node test/config-path-migration.test.js   (from the repo root)
 */

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const Module = require('module');

const results = [];
const check = (name, cond) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
};

const SANDBOX = path.join(__dirname, '..', 'temp', 'path-migration');
const HOME = path.join(SANDBOX, 'home');
const DOCS = path.join(HOME, 'Documents');
const LEGACY = path.join(DOCS, 'TallyBackupApp');
const CURRENT = path.join(DOCS, 'BackupGenie');

// Force the "installed" branch and a sandboxed home directory.
function loadManager() {
  delete require.cache[require.resolve('../src/utils/ConfigPathManager')];
  const realHomedir = os.homedir;
  const realResolve = Module._resolveFilename;
  os.homedir = () => HOME;
  // The manager treats the presence of config/config.json as "development".
  const realExists = fs.pathExistsSync;
  fs.pathExistsSync = (target) =>
    String(target).endsWith(path.join('config', 'config.json')) ? false : realExists(target);
  try {
    return require('../src/utils/ConfigPathManager');
  } finally {
    os.homedir = realHomedir;
    fs.pathExistsSync = realExists;
    Module._resolveFilename = realResolve;
  }
}

async function main() {
  // A pre-rename install with real content.
  await fs.remove(SANDBOX);
  await fs.ensureDir(path.join(LEGACY, 'config'));
  await fs.ensureDir(path.join(LEGACY, 'data'));
  await fs.writeJson(path.join(LEGACY, 'config', 'config.json'), { marker: 'existing install' });
  await fs.writeJson(path.join(LEGACY, 'data', 'repo-state.json'), { 'My Drive': 'repo-uuid-1' });

  let manager = loadManager();
  check('uses the new BackupGenie folder', manager.baseConfigDir === CURRENT);
  check('the old folder no longer lingers', !(await fs.pathExists(LEGACY)));
  check(
    'settings survived the rename',
    (await fs.readJson(path.join(CURRENT, 'config', 'config.json')).catch(() => ({}))).marker === 'existing install'
  );
  check(
    'repository state survived the rename',
    (await fs.readJson(path.join(CURRENT, 'data', 'repo-state.json')).catch(() => ({})))['My Drive'] === 'repo-uuid-1'
  );

  // Running again must be a no-op.
  manager = loadManager();
  check('a second start does not disturb anything', manager.baseConfigDir === CURRENT);

  // If both folders somehow exist, the current one wins and nothing is clobbered.
  await fs.ensureDir(path.join(LEGACY, 'config'));
  await fs.writeJson(path.join(LEGACY, 'config', 'config.json'), { marker: 'stale' });
  loadManager();
  check(
    'an existing new folder is never overwritten',
    (await fs.readJson(path.join(CURRENT, 'config', 'config.json'))).marker === 'existing install'
  );

  // A fresh machine simply gets the new folder.
  await fs.remove(SANDBOX);
  manager = loadManager();
  check('a fresh install uses BackupGenie', manager.baseConfigDir === CURRENT);

  await fs.remove(SANDBOX);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('PATH MIGRATION TEST ERROR', error);
  process.exit(2);
});
