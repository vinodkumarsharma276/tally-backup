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

  // Email must default to the customer's own SMTP, never the company relay,
  // because relay mode needs a deployed service and a shared API key.
  check('email does not default to company relay', config.email?.mode !== 'company', `mode=${config.email?.mode}`);
  check('no relay block is shipped', !config.email?.relay);
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

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('SHIPPED DEFAULTS TEST ERROR', error);
  process.exit(2);
});
