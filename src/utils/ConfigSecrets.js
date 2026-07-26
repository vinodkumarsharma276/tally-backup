'use strict';

const path = require('path');
const fs = require('fs-extra');
const {
  isSecretRef,
  createSecretRef,
  setSecret,
  hasSecret,
} = require('./SecretStore');

const PLACEHOLDERS = new Set(['change-me', 'your-key', 'your-secret', '']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeName(value) {
  return String(value || 'default').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function configScope(configPath) {
  return safeName(path.basename(configPath, path.extname(configPath)) || 'config');
}

function isUsablePlainSecret(value) {
  return typeof value === 'string' && !isSecretRef(value) && !value.startsWith('env:') && !PLACEHOLDERS.has(value.trim());
}

function resolveLegacyFilePath(configPath, configuredPath) {
  if (!configuredPath || isSecretRef(configuredPath) || configuredPath.startsWith('env:')) return null;
  if (path.isAbsolute(configuredPath)) return configuredPath;
  const configDir = path.dirname(configPath);
  const baseDir = path.basename(configDir).toLowerCase() === 'config' ? path.dirname(configDir) : configDir;
  return path.resolve(baseDir, configuredPath);
}

async function migrateField(owner, key, account, migrated) {
  if (!owner || !isUsablePlainSecret(owner[key])) return;
  owner[key] = await setSecret(account, owner[key]);
  migrated.push(account);
}

async function migrateJsonFile(owner, key, account, configPath, migrated, deletedFiles, removeLegacyFiles) {
  if (!owner || !owner[key] || isSecretRef(owner[key]) || String(owner[key]).startsWith('env:')) return;
  const sourcePath = resolveLegacyFilePath(configPath, owner[key]);
  if (!sourcePath || !(await fs.pathExists(sourcePath))) return;
  const contents = await fs.readFile(sourcePath, 'utf8');
  JSON.parse(contents); // Fail closed before changing config or deleting the file.
  owner[key] = await setSecret(account, contents);
  migrated.push(account);
  deletedFiles.push(sourcePath);
  if (removeLegacyFiles) await fs.remove(sourcePath);
}

async function migrateConfigSecrets(config, configPath, { removeLegacyFiles = true } = {}) {
  const next = clone(config);
  const migrated = [];
  const deletedFiles = [];
  const scope = configScope(configPath);
  let metadataChanged = false;

  await migrateField(next.email?.smtp?.auth, 'pass', `${scope}.email.smtp.password`, migrated);

  for (const [profileName, profile] of Object.entries(next.storageProfiles || {})) {
    if (!profile.secretId) {
      profile.secretId = safeName(profileName);
      metadataChanged = true;
    }
    const prefix = `${scope}.storage.${safeName(profile.secretId)}`;
    await migrateField(profile.auth, 'password', `${prefix}.network.password`, migrated);
    await migrateField(profile.auth, 'accessKeyId', `${prefix}.s3.accessKeyId`, migrated);
    await migrateField(profile.auth, 'secretAccessKey', `${prefix}.s3.secretAccessKey`, migrated);
    await migrateField(profile.auth, 'sasToken', `${prefix}.azure.sasToken`, migrated);
    await migrateField(profile.auth, 'licenseKey', `${prefix}.managed.licenseKey`, migrated);
    await migrateField(profile, 'connectionString', `${prefix}.azure.connectionString`, migrated);
    await migrateField(profile, 'accountKey', `${prefix}.azure.accountKey`, migrated);
  }

  await migrateJsonFile(
    next.googleDrive,
    'credentialsPath',
    `${scope}.google.oauth.credentials`,
    configPath,
    migrated,
    deletedFiles,
    removeLegacyFiles
  );
  await migrateJsonFile(
    next.googleDrive,
    'tokenPath',
    `${scope}.google.oauth.token`,
    configPath,
    migrated,
    deletedFiles,
    removeLegacyFiles
  );

  return { config: next, migrated, deletedFiles, changed: migrated.length > 0 || metadataChanged };
}

async function secretStatus(config) {
  const status = {
    emailPassword: false,
    googleCredentials: false,
    googleToken: false,
    storageProfiles: {},
  };
  status.emailPassword = isSecretRef(config.email?.smtp?.auth?.pass)
    ? await hasSecret(config.email.smtp.auth.pass)
    : false;
  status.googleCredentials = isSecretRef(config.googleDrive?.credentialsPath)
    ? await hasSecret(config.googleDrive.credentialsPath)
    : false;
  status.googleToken = isSecretRef(config.googleDrive?.tokenPath)
    ? await hasSecret(config.googleDrive.tokenPath)
    : false;

  for (const [name, profile] of Object.entries(config.storageProfiles || {})) {
    const refs = [
      profile.auth?.password,
      profile.auth?.accessKeyId,
      profile.auth?.secretAccessKey,
      profile.auth?.sasToken,
      profile.auth?.licenseKey,
      profile.connectionString,
      profile.accountKey,
    ].filter(isSecretRef);
    status.storageProfiles[name] = refs.length > 0 && (await Promise.all(refs.map(hasSecret))).every(Boolean);
  }
  return status;
}

async function sanitizeConfigForRenderer(config) {
  const sanitized = clone(config);
  if (sanitized.email?.smtp?.auth) sanitized.email.smtp.auth.pass = '';
  for (const profile of Object.values(sanitized.storageProfiles || {})) {
    if (profile.auth) {
      if ('password' in profile.auth) profile.auth.password = '';
      if ('accessKeyId' in profile.auth) profile.auth.accessKeyId = '';
      if ('secretAccessKey' in profile.auth) profile.auth.secretAccessKey = '';
      if ('sasToken' in profile.auth) profile.auth.sasToken = '';
      if ('licenseKey' in profile.auth) profile.auth.licenseKey = '';
    }
    if ('connectionString' in profile) profile.connectionString = '';
    if ('accountKey' in profile) profile.accountKey = '';
  }
  sanitized._secretStatus = await secretStatus(config);
  return sanitized;
}

async function storeOrPreserve(owner, previousOwner, key, account, changed) {
  if (!owner) return;
  const submitted = owner[key];
  if (isUsablePlainSecret(submitted)) {
    owner[key] = await setSecret(account, submitted);
    changed.push(account);
    return;
  }
  const previous = previousOwner?.[key];
  if (isSecretRef(previous)) owner[key] = previous;
  else if (submitted === '') delete owner[key];
}

async function secureConfigFromRenderer(submittedConfig, previousConfig, configPath) {
  const next = clone(submittedConfig);
  delete next._secretStatus;
  const changed = [];
  const scope = configScope(configPath);

  await storeOrPreserve(
    next.email?.smtp?.auth,
    previousConfig.email?.smtp?.auth,
    'pass',
    `${scope}.email.smtp.password`,
    changed
  );

  for (const [profileName, profile] of Object.entries(next.storageProfiles || {})) {
    profile.secretId = profile.secretId || safeName(profileName);
    const previous = previousConfig.storageProfiles?.[profileName] ||
      Object.values(previousConfig.storageProfiles || {}).find(
        (candidate) => candidate.secretId && candidate.secretId === profile.secretId
      ) || {};
    const prefix = `${scope}.storage.${safeName(profile.secretId)}`;
    await storeOrPreserve(profile.auth, previous.auth, 'password', `${prefix}.network.password`, changed);
    await storeOrPreserve(profile.auth, previous.auth, 'accessKeyId', `${prefix}.s3.accessKeyId`, changed);
    await storeOrPreserve(profile.auth, previous.auth, 'secretAccessKey', `${prefix}.s3.secretAccessKey`, changed);
    await storeOrPreserve(profile.auth, previous.auth, 'sasToken', `${prefix}.azure.sasToken`, changed);
    await storeOrPreserve(profile.auth, previous.auth, 'licenseKey', `${prefix}.managed.licenseKey`, changed);
    await storeOrPreserve(profile, previous, 'connectionString', `${prefix}.azure.connectionString`, changed);
    await storeOrPreserve(profile, previous, 'accountKey', `${prefix}.azure.accountKey`, changed);
  }

  // OAuth JSON is managed by the auth flow and never editable in the renderer.
  if (isSecretRef(previousConfig.googleDrive?.credentialsPath)) {
    next.googleDrive = next.googleDrive || {};
    next.googleDrive.credentialsPath = previousConfig.googleDrive.credentialsPath;
  }
  if (isSecretRef(previousConfig.googleDrive?.tokenPath)) {
    next.googleDrive = next.googleDrive || {};
    next.googleDrive.tokenPath = previousConfig.googleDrive.tokenPath;
  }

  return { config: next, changed };
}

module.exports = {
  migrateConfigSecrets,
  sanitizeConfigForRenderer,
  secureConfigFromRenderer,
  secretStatus,
  resolveLegacyFilePath,
  createSecretRef,
};
