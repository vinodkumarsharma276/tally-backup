'use strict';

const path = require('path');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolveSecretValue } = require('../../utils/SecretStore');
const logger = require('../../utils/logger');

const LocalFsBackend = require('./LocalFsBackend');
const GoogleDriveBackend = require('./GoogleDriveBackend');
const S3Backend = require('./S3Backend');
const AzureBlobBackend = require('./AzureBlobBackend');
const { ManagedControlPlaneClient } = require('../ManagedControlPlaneClient');
const {
  DefaultAzureCredential,
  InteractiveBrowserCredential,
  ManagedIdentityCredential,
  useIdentityPlugin,
} = require('@azure/identity');

try {
  const { vsCodePlugin } = require('@azure/identity-vscode');
  useIdentityPlugin(vsCodePlugin);
} catch {
  // Optional outside VS Code; other credential sources remain available.
}

const execFileAsync = promisify(execFile);

function isUncPath(targetPath) {
  return typeof targetPath === 'string' && /^\\\\[^\\]+\\[^\\]+/i.test(targetPath);
}

function resolveStoragePath(targetPath) {
  return isUncPath(targetPath) ? targetPath : path.resolve(targetPath);
}

async function connectWindowsShare(profile, rootDir) {
  if (process.platform !== 'win32' || !isUncPath(rootDir)) {
    return { connected: false, rootDir };
  }
  const auth = profile.auth || {};
  if (!auth.username) {
    return { connected: false, rootDir };
  }

  const args = [rootDir];
  const password = await resolveSecretValue(auth.password, { required: false });
  if (password) args.push(password);
  args.push(`/user:${auth.username}`, '/persistent:no');

  try {
    await execFileAsync('net', ['use', ...args], { windowsHide: true });
    return { connected: true, rootDir };
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    if (/The command completed successfully|The local device name is already in use|The network connection could not be found/i.test(output)) {
      return { connected: true, rootDir };
    }
    throw new Error(`Failed to connect network share ${rootDir}: ${output.trim() || error.message}`);
  }
}

async function disconnectWindowsShare(session) {
  if (!session || !session.connected || process.platform !== 'win32') return;
  try {
    await execFileAsync('net', ['use', session.rootDir, '/delete', '/y'], { windowsHide: true });
  } catch {
    // Best effort; ignore if Windows keeps/reuses the session.
  }
}

async function assertWritableDirectory(targetPath) {
  const resolved = resolveStoragePath(targetPath);
  await fs.ensureDir(resolved);
  const testFile = path.join(resolved, '.tally-backend-write-test');
  await fs.writeFile(testFile, 'ok');
  await fs.remove(testFile);
  return resolved;
}

function normalizeStorageProfile(profileName, profile, fallbackRootFolderName) {
  if (profile) return { name: profileName, ...profile };
  return {
    name: profileName || 'default-google-drive',
    type: 'google_drive',
    rootFolderName: fallbackRootFolderName,
  };
}

async function resolveConfiguredSecret(rawValue) {
  if (typeof rawValue !== 'string') return rawValue;
  const match = rawValue.match(/^env:([A-Z0-9_]+)$/i);
  if (match) return process.env[match[1]] || '';
  return resolveSecretValue(rawValue, { required: false });
}

function makeStorageLabel(profile, fallback) {
  if (profile.type === 'google_drive') return fallback;
  if (profile.type === 's3') {
    const prefix = profile.prefix || profile.rootPrefix || '';
    return `s3://${profile.bucket}${prefix ? `/${prefix}` : ''}`;
  }
  if (profile.type === 'azure_blob') {
    const prefix = profile.prefix || profile.rootPrefix || '';
    return `azure://${profile.accountName || profile.accountUrl}/${profile.containerName}${prefix ? `/${prefix}` : ''}`;
  }
  if (profile.type === 'managed') {
    return `managed://${profile.tenantId || 'tenant'}`;
  }
  return fallback;
}

async function createAzureCredential(profile) {
  const auth = profile.auth || {};
  const mode = auth.mode || 'default';

  if (mode === 'sas') {
    const sasToken = await resolveConfiguredSecret(auth.sasToken || profile.sasToken);
    if (!sasToken) {
      throw new Error(`Azure Blob profile '${profile.name}' requires a SAS token.`);
    }
    return { sasToken };
  }

  if (mode === 'interactive') {
    return {
      credential: new InteractiveBrowserCredential({
        tenantId: auth.tenantId,
        clientId: auth.clientId || undefined,
        redirectUri: auth.redirectUri,
        loginHint: auth.loginHint,
      }),
    };
  }

  if (mode === 'managed_identity') {
    return {
      credential: new ManagedIdentityCredential(auth.clientId || undefined),
    };
  }

  if (mode !== 'default') {
    throw new Error(`Unsupported Azure Blob auth mode: ${mode}`);
  }

  return {
    credential: new DefaultAzureCredential({
      tenantId: auth.tenantId,
    }),
  };
}

async function createBackend({ config, source, driveService, flags = {} }) {
  const profileName = (source && source.storageProfile) || flags.storageProfile || null;
  const profiles = (config && config.storageProfiles) || {};
  const profile = normalizeStorageProfile(
    profileName,
    profileName ? profiles[profileName] : null,
    source && source.backupFolderName
  );

  if (profile.type === 'google_drive') {
    if (!driveService) throw new Error('Google Drive backend requires an initialized GoogleDriveService.');
    const backend = new GoogleDriveBackend(driveService, {
      rootFolderName:
        profile.rootFolderName ||
        profile.rootPath ||
        (source && source.backupFolderName) ||
        flags.rootFolderName,
      allowMixed: !!profile.allowMixed || !!flags.allowMixed,
    });
    await backend.init();
    return {
      backend,
      storageLabel: makeStorageLabel(profile, `drive://${backend.rootFolderName}`),
      profile,
    };
  }

  if (profile.type === 'local' || profile.type === 'network') {
    const rootDir =
      profile.rootDir ||
      profile.rootPath ||
      profile.path ||
      flags.store ||
      (source && source.rootPath);
    if (!rootDir) {
      throw new Error(`Storage profile '${profile.name || profileName}' requires rootDir/rootPath/path.`);
    }
    const session = await connectWindowsShare(profile, rootDir);
    const resolved = await assertWritableDirectory(rootDir);
    await disconnectWindowsShare(session);
    return {
      backend: new LocalFsBackend(resolved),
      storageLabel: makeStorageLabel(profile, resolved),
      profile,
    };
  }

  if (profile.type === 's3') {
    const accessKeyId = await resolveConfiguredSecret(
      profile.accessKeyId || (profile.auth && profile.auth.accessKeyId)
    );
    const secretAccessKey = await resolveConfiguredSecret(
      profile.secretAccessKey || (profile.auth && profile.auth.secretAccessKey)
    );
    const credentials = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
    const backend = new S3Backend({
      bucket: profile.bucket,
      region: profile.region,
      endpoint: profile.endpoint,
      forcePathStyle: !!profile.forcePathStyle,
      prefix: profile.prefix || profile.rootPrefix,
      credentials,
    });
    await backend.init();
    return {
      backend,
      storageLabel: makeStorageLabel(profile, `s3://${profile.bucket}`),
      profile,
    };
  }

  if (profile.type === 'azure_blob') {
    const accountUrl =
      profile.accountUrl ||
      (profile.accountName ? `https://${profile.accountName}.blob.core.windows.net` : null);
    if (!accountUrl || !profile.containerName) {
      throw new Error(
        `Storage profile '${profile.name || profileName}' requires accountUrl/accountName and containerName.`
      );
    }
    const auth = await createAzureCredential(profile);
    const backend = new AzureBlobBackend({
      accountUrl,
      containerName: profile.containerName,
      prefix: profile.prefix || profile.rootPrefix,
      ...auth,
    });
    await backend.init();
    return {
      backend,
      storageLabel: makeStorageLabel(profile, `azure://${profile.containerName}`),
      profile,
    };
  }

  if (profile.type === 'managed') {
    const licenseKey = await resolveConfiguredSecret(
      profile.licenseKey || (profile.auth && profile.auth.licenseKey)
    );
    const client = new ManagedControlPlaneClient({
      baseUrl: profile.controlPlaneUrl || profile.baseUrl,
      tenantId: profile.tenantId,
      licenseKey,
    });
    const lease = await client.getStorageLease();
    if (lease.provider && lease.provider !== 's3') {
      throw new Error(`Managed storage returned unsupported provider '${lease.provider}'.`);
    }
    if (lease.writable === false) {
      logger.warn(
        `Managed storage for tenant '${profile.tenantId}' is read-only ` +
        `(status=${lease.status}, quota ${Math.round((lease.quota && lease.quota.percent) || 0)}%).`
      );
    }
    const backend = new S3Backend({
      bucket: lease.bucket,
      region: lease.region,
      endpoint: lease.endpoint,
      forcePathStyle: !!lease.forcePathStyle,
      prefix: lease.prefix,
      // Provider function -> AWS SDK caches by `expiration` and auto-refreshes,
      // and the client re-vends the lease before it expires mid-run.
      credentials: () => client.getAwsCredentials(),
    });
    await backend.init();
    return {
      backend,
      storageLabel: makeStorageLabel(profile, `managed://${profile.tenantId}`),
      profile,
      controlPlane: client,
      lease,
    };
  }

  throw new Error(`Unsupported storage profile type: ${profile.type}`);
}

async function testStorageProfile({ config, source, driveService, flags = {} }) {
  const { backend, storageLabel, profile } = await createBackend({ config, source, driveService, flags });
  // Keep probes inside the allowed versioned layout. Drive folders are not
  // automatically removed when their last child is deleted, so a top-level
  // probe directory would later trip the mirror-collision safety guard.
  const probeKey = `objects/__probe__/probe-${Date.now()}.txt`;
  const payload = Buffer.from('tally-backup-probe');
  await backend.put(probeKey, payload);
  const exists = await backend.exists(probeKey);
  const roundTrip = await backend.get(probeKey);
  await backend.delete(probeKey);
  return {
    storageLabel,
    profileType: profile.type,
    exists,
    roundTripOk: roundTrip.equals(payload),
  };
}

module.exports = {
  createBackend,
  assertWritableDirectory,
  testStorageProfile,
};