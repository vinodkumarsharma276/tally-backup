'use strict';

/*
 * Email reports are a convenience, never a dependency: a missing or broken mail
 * setup must warn clearly and leave the backup successful.
 *
 * Run: node test/email-reporting.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'temp', 'email-reporting');
const SRC = path.join(ROOT, 'src');
const STORE = path.join(ROOT, 'store');
const CFG = path.join(ROOT, 'config.json');
const PROFILE = 'e2e-email-store';
const REPO_STATE = path.join(__dirname, '..', 'data', 'repo-state.json');

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

async function runWith(email) {
  await fs.writeJson(CFG, {
    storageProfiles: { [PROFILE]: { type: 'local', rootDir: STORE } },
    backup: {
      sources: [{ name: 'Books', enabled: true, operation: 'backup', sourcePath: SRC, storageProfiles: [PROFILE] }],
    },
    retention: { keepDailyBackups: 30 },
    email,
  });
  const run = spawnSync(process.execPath, ['bin/versioned-backup.js', '--config', CFG], { encoding: 'utf8' });
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
}

async function main() {
  await fs.remove(ROOT);
  await forgetProfile();
  await fs.ensureDir(SRC);
  await fs.writeFile(path.join(SRC, 'ledger.txt'), 'figures');

  // Reports on, but no mail server configured — the wizard's old behaviour.
  const noServer = await runWith({ enabled: true, mode: 'smtp', to: 'owner@example.com' });
  check('backup still succeeds without a mail server', noServer.ok);
  check('the missing mail server is explained', /Open Settings > Email reports/.test(noServer.output));

  // Reports on, mail server points nowhere — a wrong host or a dead network.
  await fs.remove(STORE);
  await forgetProfile();
  const badServer = await runWith({
    enabled: true,
    mode: 'smtp',
    to: 'owner@example.com',
    smtp: { host: 'smtp.invalid.example', port: 587, secure: false, auth: { user: 'x', pass: 'y' } },
  });
  check('backup still succeeds when the mail server fails', badServer.ok);
  check('the mail failure is reported as a warning', /could not be sent|Email/i.test(badServer.output));
  check('the backup itself is not marked failed', !/VERSIONED backup failed/.test(badServer.output));

  // Company relay mode with no relay configured must not silently pretend.
  await fs.remove(STORE);
  await forgetProfile();
  const noRelay = await runWith({ enabled: true, mode: 'company', to: 'owner@example.com' });
  check('backup succeeds when the relay is missing', noRelay.ok);
  check('the missing relay is explained', /no relay was found/.test(noRelay.output));

  // Reports off: no mail noise at all.
  await fs.remove(STORE);
  await forgetProfile();
  const off = await runWith({ enabled: false });
  check('nothing is sent when reports are off', off.ok && !/Report email/.test(off.output));

  await fs.remove(ROOT);
  await forgetProfile();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('EMAIL REPORTING TEST ERROR', error);
  process.exit(2);
});
