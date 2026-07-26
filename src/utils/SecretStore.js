'use strict';

const SERVICE_NAME = 'VE Tally Backup';
const SECRET_PREFIX = 'secret:';
let keytarModule = null;

function keytar() {
  if (!keytarModule) keytarModule = require('keytar');
  return keytarModule;
}

function isSecretRef(value) {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX) && value.length > SECRET_PREFIX.length;
}

function accountFromRef(reference) {
  if (!isSecretRef(reference)) throw new Error('Invalid secure secret reference.');
  return reference.slice(SECRET_PREFIX.length);
}

function createSecretRef(account) {
  if (!account || typeof account !== 'string') throw new Error('Secret account name is required.');
  return `${SECRET_PREFIX}${account}`;
}

async function setSecret(account, value) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Refusing to store an empty secret: ${account}`);
  }
  await keytar().setPassword(SERVICE_NAME, account, String(value));
  return createSecretRef(account);
}

async function getSecret(referenceOrAccount, { required = true } = {}) {
  const account = isSecretRef(referenceOrAccount)
    ? accountFromRef(referenceOrAccount)
    : referenceOrAccount;
  const value = await keytar().getPassword(SERVICE_NAME, account);
  if (required && value === null) {
    throw new Error(`Secure credential not found in the OS vault: ${account}`);
  }
  return value;
}

async function deleteSecret(referenceOrAccount) {
  const account = isSecretRef(referenceOrAccount)
    ? accountFromRef(referenceOrAccount)
    : referenceOrAccount;
  return keytar().deletePassword(SERVICE_NAME, account);
}

async function resolveSecretValue(value, options) {
  if (!isSecretRef(value)) return value;
  return getSecret(value, options);
}

async function hasSecret(referenceOrAccount) {
  return (await getSecret(referenceOrAccount, { required: false })) !== null;
}

module.exports = {
  SERVICE_NAME,
  SECRET_PREFIX,
  isSecretRef,
  createSecretRef,
  setSecret,
  getSecret,
  deleteSecret,
  resolveSecretValue,
  hasSecret,
};
