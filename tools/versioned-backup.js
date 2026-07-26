#!/usr/bin/env node
/*
 * Phase 1 local driver/verifier for the versioned backup engine.
 * Uses the LocalFsBackend so we can validate chunk -> store -> snapshot ->
 * restore end-to-end on real Tally data BEFORE wiring in Google Drive.
 *
 * Commands:
 *   backup  <sourceDir> [--store <dir>] [--source <name>] [--avg <bytes>] [--no-gzip]
 *   list                [--store <dir>]
 *   restore <id|latest> <destDir> [--store <dir>]
 *   gc                  [--store <dir>] [--keep <days>] [--dry-run]
 *   verify  <dirA> <dirB>          (byte-for-byte folder comparison)
 *
 * Default store: data/versioned-store  (under gitignored data/).
 */

'use strict';

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const Chunker = require('../src/versioning/Chunker');
const ObjectStore = require('../src/versioning/ObjectStore');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const LocalFsBackend = require('../src/versioning/backends/LocalFsBackend');
const { createBackend, testStorageProfile } = require('../src/versioning/backends');
const { renderRestoreProgress, finishProgress } = require('../src/utils/cliProgress');
const VersionedBackup = require('../src/versioning/VersionedBackup');

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--store') flags.store = argv[++i];
    else if (a === '--source') flags.source = argv[++i];
    else if (a === '--avg') flags.avg = parseInt(argv[++i], 10);
    else if (a === '--keep') flags.keep = parseInt(argv[++i], 10);
    else if (a === '--concurrency') flags.concurrency = parseInt(argv[++i], 10);
    else if (a === '--no-gzip') flags.gzip = false;
    else if (a === '--drive') flags.drive = true;
    else if (a === '--root') flags.root = argv[++i];
    else if (a === '--config') flags.config = argv[++i];
    else if (a === '--storage-profile') flags.storageProfile = argv[++i];
    else if (a === '--allow-mixed') flags.allowMixed = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else positional.push(a);
  }
  return { flags, positional };
}

function makeEngine(flags) {
  const storeDir = path.resolve(flags.store || path.join('data', 'versioned-store'));
  const backend = new LocalFsBackend(storeDir);
  const chunker = new Chunker({ avg: flags.avg || 256 * 1024 });
  const objectStore = new ObjectStore(backend, { gzip: flags.gzip !== false });
  const snapshotStore = new SnapshotStore(backend);
  const engine = new VersionedBackup({ backend, chunker, objectStore, snapshotStore, concurrency: flags.concurrency || 8 });
  return { engine, storeDir };
}

async function makeDriveEngine(flags) {
  const GoogleDriveService = require('../src/GoogleDriveService');
  const configPath = path.resolve(flags.config || path.join('config', 'config_test.json'));
  if (!(await fs.pathExists(configPath))) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const config = await fs.readJson(configPath);
  const source =
    (config.backup && config.backup.sources && config.backup.sources[0]) ||
    { backupFolderName: flags.root || 'Tally Backup New' };

  const driveService = new GoogleDriveService(config.googleDrive);
  await driveService.initialize();
  const { backend, storageLabel } = await createBackend({
    config,
    source: { ...source, storageProfile: flags.storageProfile || source.storageProfile },
    driveService,
    flags: {
      rootFolderName: flags.root,
      allowMixed: !!flags.allowMixed,
      store: flags.store,
      storageProfile: flags.storageProfile,
    },
  });

  const chunker = new Chunker({ avg: flags.avg || 256 * 1024 });
  const objectStore = new ObjectStore(backend, { gzip: flags.gzip !== false });
  const snapshotStore = new SnapshotStore(backend);
  const engine = new VersionedBackup({ backend, chunker, objectStore, snapshotStore, concurrency: flags.concurrency || 8 });
  return { engine, storeDir: storageLabel };
}

/** Build the engine for the chosen backend (local by default, Drive with --drive). */
async function resolveEngine(flags) {
  if (flags.drive) return makeDriveEngine(flags);
  return makeEngine(flags);
}

const MB = 1048576;

async function dirSize(dir) {
  let total = 0;
  const walk = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) total += (await fs.stat(full)).size;
    }
  };
  if (await fs.pathExists(dir)) await walk(dir);
  return total;
}

async function hashTree(dir) {
  // Map of relPath -> sha256 of file contents (for verify).
  const map = new Map();
  const walk = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const rel = path.relative(dir, full).split(path.sep).join('/');
        const h = crypto.createHash('sha256');
        await new Promise((res, rej) => {
          const s = fs.createReadStream(full);
          s.on('data', (c) => h.update(c));
          s.on('end', res);
          s.on('error', rej);
        });
        map.set(rel, h.digest('hex'));
      }
    }
  };
  await walk(dir);
  return map;
}

async function cmdBackup(positional, flags) {
  const [sourceDir] = positional;
  if (!sourceDir) throw new Error('Usage: backup <sourceDir>');
  const { engine, storeDir } = await resolveEngine(flags);
  const local = !flags.drive;
  const before = local ? await dirSize(storeDir) : 0;
  const stats = await engine.backup(sourceDir, { source: flags.source });
  const after = local ? await dirSize(storeDir) : 0;
  console.log('\n--- Backup complete ---');
  console.log(`Backend         : ${storeDir}`);
  console.log(`Snapshot id     : ${stats.snapshotId}`);
  console.log(`Files           : ${stats.fileCount}`);
  console.log(`Source bytes    : ${(stats.totalBytes / MB).toFixed(2)} MB  (${stats.totalChunks} chunks)`);
  console.log(`New chunks       : ${stats.newChunks}`);
  console.log(`Uploaded (gz)   : ${(stats.newBytesStored / MB).toFixed(2)} MB`);
  if (local) {
    console.log(`Store size now  : ${(after / MB).toFixed(2)} MB  (grew ${((after - before) / MB).toFixed(2)} MB)`);
  }
  console.log(`Duration        : ${(stats.durationMs / 1000).toFixed(1)}s\n`);
}

async function cmdList(flags) {
  const { engine } = await resolveEngine(flags);
  const snaps = await engine.list();
  if (!snaps.length) return console.log('No snapshots yet.');
  console.log('\n--- Snapshots (oldest -> newest) ---');
  for (const s of snaps) {
    console.log(`  ${s.id}  ${s.source}  ${s.fileCount} files  ${(s.totalBytes / MB).toFixed(2)} MB  (${s.createdAt})`);
  }
  console.log('');
}

async function cmdRestore(positional, flags) {
  const [id, destDir] = positional;
  if (!id || !destDir) throw new Error('Usage: restore <id|latest> <destDir>');
  const { engine } = await resolveEngine(flags);
  const stats = await engine.restore(id, destDir, { onProgress: renderRestoreProgress });
  finishProgress();
  console.log('\n--- Restore complete ---');
  console.log(`Snapshot        : ${stats.snapshotId}`);
  console.log(`Destination     : ${stats.dest}`);
  console.log(`Files written   : ${stats.filesWritten}`);
  console.log(`Bytes written   : ${(stats.bytesWritten / MB).toFixed(2)} MB`);
  console.log(`Duration        : ${(stats.durationMs / 1000).toFixed(1)}s\n`);
}

async function cmdGc(flags) {
  const { engine } = await resolveEngine(flags);
  const keepDays = Number.isInteger(flags.keep) ? flags.keep : 30;
  const stats = await engine.gc({ keepDays, dryRun: !!flags.dryRun });
  console.log('\n--- GC ---');
  console.log(JSON.stringify(stats, null, 2), '\n');
}

async function cmdTestStorage(flags) {
  const configPath = path.resolve(flags.config || path.join('config', 'config_test.json'));
  if (!(await fs.pathExists(configPath))) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const config = await fs.readJson(configPath);
  const profileName = flags.storageProfile;
  if (!profileName) {
    throw new Error('Usage: test-storage --storage-profile <name> [--config <path>]');
  }

  const profile = config.storageProfiles && config.storageProfiles[profileName];
  let driveService = null;
  if (profile && profile.type === 'google_drive') {
    const GoogleDriveService = require('../src/GoogleDriveService');
    driveService = new GoogleDriveService(config.googleDrive);
    await driveService.initialize();
  }

  const result = await testStorageProfile({
    config,
    source: { storageProfile: profileName, backupFolderName: profileName },
    driveService,
    flags,
  });

  console.log('\n--- Storage test ---');
  console.log(`Profile         : ${profileName}`);
  console.log(`Type            : ${result.profileType}`);
  console.log(`Target          : ${result.storageLabel}`);
  console.log(`Exists check    : ${result.exists ? 'OK' : 'FAILED'}`);
  console.log(`Round-trip read : ${result.roundTripOk ? 'OK' : 'FAILED'}`);
  console.log('');
}

async function cmdVerify(positional) {
  const [a, b] = positional;
  if (!a || !b) throw new Error('Usage: verify <dirA> <dirB>');
  const [ha, hb] = await Promise.all([hashTree(a), hashTree(b)]);
  const problems = [];
  for (const [rel, hash] of ha) {
    if (!hb.has(rel)) problems.push(`MISSING in B: ${rel}`);
    else if (hb.get(rel) !== hash) problems.push(`DIFFERS    : ${rel}`);
  }
  for (const rel of hb.keys()) if (!ha.has(rel)) problems.push(`EXTRA in B : ${rel}`);

  console.log('\n--- Verify ---');
  console.log(`A files: ${ha.size}   B files: ${hb.size}`);
  if (problems.length === 0) {
    console.log('RESULT: IDENTICAL  (every file byte-for-byte equal)\n');
  } else {
    console.log(`RESULT: ${problems.length} difference(s):`);
    for (const p of problems.slice(0, 50)) console.log('  ' + p);
    process.exitCode = 1;
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);
  switch (cmd) {
    case 'backup': return cmdBackup(positional, flags);
    case 'list': return cmdList(flags);
    case 'restore': return cmdRestore(positional, flags);
    case 'gc': return cmdGc(flags);
    case 'verify': return cmdVerify(positional);
    case 'test-storage': return cmdTestStorage(flags);
    default:
      console.log(`Usage:
  node tools/versioned-backup.js backup  <sourceDir> [--store <dir>] [--source <name>] [--avg <bytes>] [--no-gzip]
  node tools/versioned-backup.js list                [--store <dir>]
  node tools/versioned-backup.js restore <id|latest> <destDir> [--store <dir>]
  node tools/versioned-backup.js gc                  [--store <dir>] [--keep <days>] [--dry-run]
  node tools/versioned-backup.js verify  <dirA> <dirB>
  node tools/versioned-backup.js test-storage --storage-profile <name> [--config <path>]

  Add --drive to use Google Drive instead of the local store:
    [--drive] [--root <folderName>] [--config <path to config_test.json>]
  Google Drive mode requires config/credentials.json + config/token.json (run setup-auth.js first).

  Other flags:
    --storage-profile NAME  Named storage profile from config (used by test-storage).`);
  }
}

main().catch((err) => {
  console.error('versioned-backup failed:', err);
  process.exit(1);
});
