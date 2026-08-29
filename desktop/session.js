'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs-extra');

const { setSecret, getSecret, deleteSecret, hasSecret } = require('../src/utils/SecretStore');
const configPathManager = require('../src/utils/ConfigPathManager');

/**
 * Signed-in user session.
 *
 * The session token lives in the OS credential vault; the readable profile is
 * cached on disk so the app can show who is signed in while offline. Sign-in is
 * never required: backups run regardless of session state.
 */

const TOKEN_ACCOUNT = 'backup-genie.session.token';

function sessionFile() {
  return path.join(configPathManager.dataDir, 'session.json');
}

function deviceFile() {
  return path.join(configPathManager.dataDir, 'device.json');
}

async function deviceIdentity(appVersion) {
  const file = deviceFile();
  let record = await fs.readJson(file).catch(() => null);
  if (!record || !record.id) {
    record = { id: crypto.randomUUID() };
    await fs.ensureDir(path.dirname(file));
    await fs.writeJson(file, record, { spaces: 2 });
  }
  return { id: record.id, name: os.hostname(), platform: process.platform, appVersion };
}

async function readSession() {
  const cached = await fs.readJson(sessionFile()).catch(() => null);
  if (!cached || !cached.user) return { signedIn: false, user: null };
  return { signedIn: await hasSecret(TOKEN_ACCOUNT), user: cached.user, signedInAt: cached.signedInAt };
}
async function saveSession({ token, user }) {
  await setSecret(TOKEN_ACCOUNT, token);
  await fs.ensureDir(path.dirname(sessionFile()));
  await fs.writeJson(sessionFile(), { user, signedInAt: new Date().toISOString() }, { spaces: 2 });
  return { signedIn: true, user };
}

async function clearSession() {
  await deleteSecret(TOKEN_ACCOUNT).catch(() => {});
  await fs.remove(sessionFile()).catch(() => {});
  return { signedIn: false, user: null };
}

async function sessionToken() {
  if (!(await hasSecret(TOKEN_ACCOUNT))) return null;
  return getSecret(TOKEN_ACCOUNT, { required: false });
}

module.exports = { readSession, saveSession, clearSession, sessionToken, deviceIdentity };
