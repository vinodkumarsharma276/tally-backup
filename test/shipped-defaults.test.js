'use strict';

/*
 * The config shipped to customers decides whether a fresh install works out of
 * the box. It must not point at a developer machine, must not carry secrets,
 * and must not enable features that need a service we have not deployed.
 *
 * Run: node test/shipped-defaults.test.js   (from the repo root)
 */

const path = require('path');
const fs = require('fs-extra');

const results = [];
const check = (name, cond, detail) => {
  results.push([name, !!cond]);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
};

async function main() {
  const config = await fs.readJson(path.join(__dirname, '..', 'desktop', 'default-config.json'));
  const raw = JSON.stringify(config);

  check('no developer host is baked in', !/localhost|127\.0\.0\.1/i.test(raw));
  check('no personal paths are baked in', !/vinodsharma|personal_workspace/i.test(raw));
  check('no email address is baked in', !/@gmail\.com|@resend\.dev/i.test(raw));

  // Relay mode is now the shipped default: the service is deployed, and it
  // spares customers from creating a mail app password. What must never ship is
  // a credential -- the service URL is public, the licence key is per install.
  check('email defaults to the company relay', config.email?.mode === 'company', `mode=${config.email?.mode}`);
  check('relay points at a deployed https service', /^https:\/\//.test(config.email?.relay?.controlPlaneUrl || ''));
  check('no tenant id is shipped', !config.email?.relay?.tenantId);
  check('no licence key is shipped', !config.email?.relay?.licenseKey);
  check('email starts disabled', config.email?.enabled === false);
  check('no SMTP password is shipped', !config.email?.smtp?.auth?.pass);
  check('no SMTP account is shipped', !config.email?.smtp?.auth?.user);

  // Accounts are optional until the control plane is deployed.
  check('account section exists', !!config.account);
  check('no service address is baked in', !config.account?.controlPlaneUrl);

  // Behaviour customers depend on.
  check('starts with Windows', config.desktop?.autoStart !== false);
  check('scheduler is enabled', config.desktop?.schedulerEnabled !== false);
  check('retention is within the supported range',
    config.retention?.keepDailyBackups >= 1 && config.retention?.keepDailyBackups <= 30,
    String(config.retention?.keepDailyBackups));

  // A shipped config must satisfy the app's own validation.
  check('backup.sources exists so the app can start', Array.isArray(config.backup?.sources));
  for (const source of config.backup?.sources || []) {
    check(`source "${source.name}" is valid`, !!(source.name && source.operation && source.sourcePath !== undefined));
  }

  // Secrets must be references to the OS vault, never literals.
  const literalSecret = /"(pass|licenseKey|secretAccessKey|sasToken)"\s*:\s*"(?!secret:|env:)[^"]+"/.exec(raw);
  check('no literal secrets anywhere', !literalSecret, literalSecret && literalSecret[0]);

  const root = path.join(__dirname, '..');
  const manifest = await fs.readJson(path.join(root, 'package.json'));
  check('Starter policy is packaged', manifest.build.files.includes('shared/edition.json'));
  check('Starter installer has a distinct download name', manifest.build.win.artifactName === 'Backup-Genie-Starter-Setup.${ext}');
  for (const file of ['build/icon.png', 'build/icon.ico', 'assets/branding/tray-*.png']) {
    check(`runtime icon is packaged: ${file}`, manifest.build.files.includes(file));
  }
  const windowsIcon = await fs.readFile(path.join(root, manifest.build.win.icon));
  check('Windows icon has multiple resolutions', windowsIcon.readUInt16LE(2) === 1 && windowsIcon.readUInt16LE(4) >= 6);
  const macIcon = await fs.readFile(path.join(root, manifest.build.mac.icon));
  check('macOS icon container is valid', macIcon.toString('ascii', 0, 4) === 'icns' && macIcon.readUInt32BE(4) === macIcon.length);
  for (const theme of ['dark', 'light']) {
    for (const state of ['idle', 'running', 'success', 'failed', 'paused']) {
      const trayIcon = await fs.readFile(path.join(root, 'assets/branding', `tray-${theme}-${state}.png`));
      check(`${theme} ${state} tray icon is a 32px PNG`, trayIcon.toString('ascii', 1, 4) === 'PNG' && trayIcon.readUInt32BE(16) === 32 && trayIcon.readUInt32BE(20) === 32);
    }
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('SHIPPED DEFAULTS TEST ERROR', error);
  process.exit(2);
});
