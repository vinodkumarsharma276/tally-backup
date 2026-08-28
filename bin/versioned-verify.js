#!/usr/bin/env node
/*
 * Verify a backup repository: confirm every chunk referenced by a restore point
 * still exists at the destination. Detects partial deletion long before someone
 * needs the data back.
 *
 * Usage:
 *   node bin/versioned-verify.js --config config/config.json [--profile <name>]
 */

'use strict';

const path = require('path');
const fs = require('fs-extra');

const logger = require('../src/utils/logger');
const GoogleDriveService = require('../src/GoogleDriveService');
const Chunker = require('../src/versioning/Chunker');
const { resolveObjectStore } = require('../src/versioning/createObjectStore');
const { googleConfigFor } = require('../src/utils/googleAuth');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const { createBackend } = require('../src/versioning/backends');
const VersionedBackup = require('../src/versioning/VersionedBackup');

function arg(name, argv) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

async function verifyProfile(config, profileName) {
  const profile = (config.storageProfiles || {})[profileName];
  if (!profile) throw new Error(`Storage profile not found: ${profileName}`);
  const source = { storageProfile: profileName, backupFolderName: profile.rootFolderName || profileName };
  let driveService = null;
  if (profile.type === 'google_drive') {
    driveService = new GoogleDriveService(await googleConfigFor(config, profileName));
    await driveService.initialize();
  }
  const { backend, storageLabel } = await createBackend({ config, source, driveService });
  const engine = new VersionedBackup({
    backend,
    chunker: new Chunker(),
    objectStore: await resolveObjectStore(backend, profile, { gzip: true }),
    snapshotStore: new SnapshotStore(backend),
    logger,
  });
  const result = await engine.verify();
  return { profileName, storageLabel, ...result };
}

async function main(argv = process.argv.slice(2)) {
  const configPath = path.resolve(arg('--config', argv) || process.env.TALLY_CONFIG || path.join('config', 'config_test.json'));
  if (!(await fs.pathExists(configPath))) throw new Error(`Configuration file not found: ${configPath}`);
  const config = await fs.readJson(configPath);

  const only = arg('--profile', argv);
  const names = only ? [only] : Object.keys(config.storageProfiles || {});
  if (names.length === 0) throw new Error('No storage profiles are configured.');

  const results = [];
  for (const name of names) {
    try {
      results.push(await verifyProfile(config, name));
    } catch (error) {
      logger.error(`Verify failed for '${name}': ${error.message}`);
      results.push({ profileName: name, ok: false, error: error.message });
    }
  }

  const bad = results.filter((r) => !r.ok);
  logger.info(`Verified ${results.length} profile(s); ${bad.length} with problems.`);
  if (bad.length) process.exitCode = 1;
  return results;
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Verify failed:', error.message || error);
    process.exit(1);
  });
}

module.exports = main;
