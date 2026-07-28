#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs-extra');

const logger = require('../src/utils/logger');
const GoogleDriveService = require('../src/GoogleDriveService');
const EmailService = require('../src/EmailService');
const Chunker = require('../src/versioning/Chunker');
const { createObjectStore } = require('../src/versioning/createObjectStore');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const { createBackend } = require('../src/versioning/backends');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const { renderRestoreProgress, finishProgress } = require('../src/utils/cliProgress');

const CHUNK_AVG = 256 * 1024;
const MB = 1048576;

function resolveConfigPath(args) {
  const i = args.indexOf('--config');
  if (i >= 0 && args[i + 1]) return path.resolve(args[i + 1]);
  if (process.env.TALLY_CONFIG) return path.resolve(process.env.TALLY_CONFIG);
  return path.resolve('config', 'config_test.json');
}

function parseArgs(argv) {
  const opts = {
    all: false,
    dryRun: false,
    force: false,
    sourceName: null,
    snapshotId: null,
    destOverride: null,
    configPath: resolveConfigPath(argv),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') opts.all = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--source' && argv[i + 1]) opts.sourceName = argv[++i];
    else if (arg === '--snapshot' && argv[i + 1]) opts.snapshotId = argv[++i];
    else if (arg === '--dest' && argv[i + 1]) opts.destOverride = argv[++i];
    else if (arg === '--config' && argv[i + 1]) i += 1;
  }
  return opts;
}

function buildDriveLink(folderId) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

function selectRestoreSources(config, sourceName, all) {
  const enabledRestores = (config.backup.sources || []).filter(
    (s) => s.operation === 'restore' && s.enabled !== false
  );
  if (sourceName) {
    const match = enabledRestores.find((s) => s.name === sourceName);
    if (!match) throw new Error(`Enabled restore source not found: ${sourceName}`);
    return [match];
  }
  if (all || enabledRestores.length <= 1) return enabledRestores;
  throw new Error('Multiple enabled restore sources found. Pass --all or --source "<name>".');
}

function validateRestoreDestination(config, sourceConfig, destPath, force) {
  const dest = path.resolve(destPath);
  const backupSources = (config.backup.sources || []).filter(
    (s) => s.operation === 'backup' && s.enabled !== false
  );
  for (const source of backupSources) {
    const folders = (Array.isArray(source.sourcePaths) && source.sourcePaths.length
      ? source.sourcePaths
      : [source.sourcePath]
    ).map((f) => (typeof f === 'string' ? f : f && f.path));
    for (const folder of folders) {
      if (folder && path.resolve(folder) === dest && !force) {
        throw new Error(
          `Refusing to restore into live backup source path: ${dest}. ` +
            'Use a different destination or pass --force.'
        );
      }
    }
  }
  return dest;
}

async function ensureWritableDest(dest) {
  await fs.ensureDir(dest);
  const testFile = path.join(dest, '.tally-restore-write-test');
  await fs.writeFile(testFile, 'ok');
  await fs.remove(testFile);
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  logger.info('='.repeat(60));
  logger.info('Starting VERSIONED Tally Restore');
  logger.info(`Config: ${opts.configPath}`);
  logger.info('='.repeat(60));

  if (!(await fs.pathExists(opts.configPath))) {
    throw new Error(`Configuration file not found: ${opts.configPath}`);
  }
  const config = await fs.readJson(opts.configPath);

  let emailService = null;
  if (config.email) {
    emailService = new EmailService(config.email);
    await emailService.initialize();
  }

  const concurrency = (config.backup && config.backup.concurrency) || 8;
  const restoreSources = selectRestoreSources(config, opts.sourceName, opts.all);
  if (restoreSources.length === 0) {
    logger.warn('No enabled sources with operation "restore" found in config.');
    return { success: true, totalFilesProcessed: 0, totalSize: 0, sources: [], driveLinks: [] };
  }

  const startTime = Date.now();
  const requiresDriveService = restoreSources.some((source) => {
    const profileName = source.storageProfile;
    const profile = profileName && config.storageProfiles && config.storageProfiles[profileName];
    return !profile || profile.type === 'google_drive';
  });

  let driveService = null;
  if (requiresDriveService) {
    driveService = new GoogleDriveService(config.googleDrive);
    await driveService.initialize();
  }

  const overall = {
    totalFilesProcessed: 0,
    totalFilesDownloaded: 0,
    totalSize: 0,
    duration: 0,
    success: false,
    sources: [],
    driveLinks: [],
  };

  try {
    for (const source of restoreSources) {
      const restoreCfg = source.restore || {};
      const snapshotId = opts.snapshotId || restoreCfg.snapshotId || 'latest';
      const destPath = validateRestoreDestination(
        config,
        source,
        opts.destOverride || source.sourcePath,
        opts.force
      );

      logger.info(
        `Restoring '${source.name}' from storage '${source.storageProfile || source.backupFolderName}' -> ${destPath}`
      );

      const { backend, storageLabel, profile } = await createBackend({
        config,
        source,
        driveService,
      });

      const engine = new VersionedBackup({
        backend,
        chunker: new Chunker({ avg: CHUNK_AVG }),
        objectStore: createObjectStore(backend, profile, { gzip: true }),
        snapshotStore: new SnapshotStore(backend),
        concurrency,
        logger,
      });

      const resolvedSnapshotId = await engine.snapshotStore.resolveId(snapshotId);
      const snapshot = await engine.snapshotStore.read(resolvedSnapshotId);
      const link = backend.rootFolderId ? buildDriveLink(backend.rootFolderId) : null;
      if (link) {
        overall.driveLinks.push({
          name: source.name,
          folderName: source.backupFolderName,
          operation: 'restore',
          link,
        });
      }

      if (opts.dryRun) {
        logger.info(
          `[dry-run] '${source.name}': snapshot ${resolvedSnapshotId} -> ${destPath} | ` +
            `${snapshot.fileCount} files, ${(snapshot.totalBytes / MB).toFixed(2)} MB`
        );
        overall.sources.push({
          name: source.name,
          operation: 'restore',
          snapshotId: resolvedSnapshotId,
          dest: destPath,
          storageLabel,
          filesWritten: snapshot.fileCount,
          bytesWritten: snapshot.totalBytes,
          dryRun: true,
          link,
        });
        overall.totalFilesProcessed += snapshot.fileCount;
        overall.totalFilesDownloaded += snapshot.fileCount;
        overall.totalSize += snapshot.totalBytes;
        continue;
      }

      await ensureWritableDest(destPath);
      if (restoreCfg.cleanDest === true) {
        logger.info(`Cleaning restore destination before restore: ${destPath}`);
        await fs.emptyDir(destPath);
      }

      const stats = await engine.restore(resolvedSnapshotId, destPath, {
        onProgress: renderRestoreProgress,
      });
      finishProgress();

      overall.totalFilesProcessed += stats.filesWritten;
      overall.totalFilesDownloaded += stats.filesWritten;
      overall.totalSize += stats.bytesWritten;
      overall.sources.push({ name: source.name, operation: 'restore', storageLabel, ...stats, link });

      logger.info(
        `'${source.name}': restored snapshot ${stats.snapshotId} | ${stats.filesWritten} files, ` +
          `${(stats.bytesWritten / MB).toFixed(2)} MB written`
      );
    }

    overall.duration = Date.now() - startTime;
    overall.success = true;

    logger.info(
      `VERSIONED restore completed in ${(overall.duration / 1000).toFixed(1)}s | ` +
        `${overall.totalFilesDownloaded} files, ${(overall.totalSize / MB).toFixed(2)} MB`
    );

    if (emailService && !opts.dryRun) {
      await emailService.sendBackupSuccessWithMultipleLinks(
        {
          totalFilesProcessed: overall.totalFilesProcessed,
          totalFilesUploaded: 0,
          totalFilesDownloaded: overall.totalFilesDownloaded,
          totalSize: overall.totalSize,
          duration: overall.duration,
        },
        overall.driveLinks
      );
    }

    return overall;
  } catch (error) {
    overall.duration = Date.now() - startTime;
    logger.error('VERSIONED restore failed:', error);
    if (emailService) {
      await emailService.sendBackupFailure(error, overall);
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = main;