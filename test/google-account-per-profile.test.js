'use strict';

/*
 * Each Google Drive storage profile must resolve to its own Google account,
 * while profiles that were never reconnected keep using the original shared
 * token (otherwise upgrading would silently disconnect existing installs).
 *
 * Run: node test/google-account-per-profile.test.js   (from the repo root)
 */

const assert = require('assert');
const Module = require('module');

// Stub the OS credential vault so the test never touches real secrets.
const vault = new Map();
const secretStorePath = require.resolve('../src/utils/SecretStore');
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  const resolved = (() => {
    try { return Module._resolveFilename(request, parent); } catch { return request; }
  })();
  if (resolved === secretStorePath) {
    return {
      isSecretRef: (value) => typeof value === 'string' && value.startsWith('secret:'),
      hasSecret: async (ref) => vault.has(String(ref)),
      getSecret: async (ref) => vault.get(String(ref)),
      setSecret: async (ref, value) => vault.set(String(ref), value),
    };
  }
  return realLoad(request, parent, isMain);
};

const { googleConfigFor, connectTokenRef, profileTokenRef, hasOwnAccount } = require('../src/utils/googleAuth');

const config = {
  googleDrive: {
    credentialsPath: 'secret:config_test.google.oauth.credentials',
    tokenPath: 'secret:config_test.google.oauth.token',
  },
};

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push([name, true]);
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push([name, false]);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

async function main() {
  vault.set('secret:config_test.google.oauth.token', '{"shared":true}');

  const legacy = await googleConfigFor(config, 'vinodipdelhi Google Drive');
  check('a profile with no account of its own uses the shared token', () => {
    assert.strictEqual(legacy.tokenPath, 'secret:config_test.google.oauth.token');
  });

  check('connecting targets a per-profile token', () => {
    assert.strictEqual(
      connectTokenRef(config, 'Chandra Google Drive'),
      'secret:config_test.google.oauth.token.chandra_google_drive'
    );
  });

  check('different profiles get different token names', () => {
    assert.notStrictEqual(
      connectTokenRef(config, 'Chandra Google Drive'),
      connectTokenRef(config, 'vinodipdelhi Google Drive')
    );
  });

  // Simulate "Connect Google" on one profile only.
  vault.set(connectTokenRef(config, 'Chandra Google Drive'), '{"chandra":true}');

  const connected = await googleConfigFor(config, 'Chandra Google Drive');
  const untouched = await googleConfigFor(config, 'vinodipdelhi Google Drive');
  check('the connected profile uses its own account', () => {
    assert.strictEqual(connected.tokenPath, 'secret:config_test.google.oauth.token.chandra_google_drive');
  });
  check('the other profile is unaffected', () => {
    assert.strictEqual(untouched.tokenPath, 'secret:config_test.google.oauth.token');
  });
  check('two profiles no longer share one account', () => {
    assert.notStrictEqual(connected.tokenPath, untouched.tokenPath);
  });

  check('ownAccount reports which profiles are individually connected', async () => {
    assert.strictEqual(await hasOwnAccount(config, 'Chandra Google Drive'), true);
    assert.strictEqual(await hasOwnAccount(config, 'vinodipdelhi Google Drive'), false);
  });

  check('other credentials are preserved', () => {
    assert.strictEqual(connected.credentialsPath, config.googleDrive.credentialsPath);
  });

  check('file-based token setups keep a single account', () => {
    const fileConfig = { googleDrive: { tokenPath: 'config/token.json' } };
    assert.strictEqual(profileTokenRef(fileConfig, 'Anything'), null);
    assert.strictEqual(connectTokenRef(fileConfig, 'Anything'), 'config/token.json');
  });

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('GOOGLE ACCOUNT TEST ERROR', error);
  process.exit(2);
});
