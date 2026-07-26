#!/usr/bin/env node
/*
 * Versioned backup runner (NEW Git-like flow) — production-style entry point.
 *
 * Mirrors the existing scheduled flow (npm command -> backup -> email) but uses
 * the content-defined-chunking versioned engine writing to Google Drive, instead
 * of the legacy overwrite-mirror. Runs side-by-side with the old flow so the new
 * strategy can be trialed for a couple of weeks before deprecating the old one.
 *
 * Config resolution (first match wins):
 *   --config <path>   |   env TALLY_CONFIG   |   config/config_test.json (default)
 *
 * For each source with operation === "backup":
 *   - back up sourcePath into its own dedicated Drive folder (backupFolderName)
 *   - apply retention GC (retention.keepDailyBackups, default 30)
 * Then send one success/failure email (config.email), like the legacy flow.
 *
 * Restore-type sources are skipped here (restore is on-demand via
 * tools/versioned-backup.js restore).
 */

'use strict';

const path = require('path');
const fs = require('fs-extra');

const logger = require('../src/utils/logger');
const GoogleDriveService = require('../src/GoogleDriveService');
const { sendReport } = require('../src/utils/reportEmail');
const Chunker = require('../src/versioning/Chunker');
const { createObjectStore } = require('../src/versioning/createObjectStore');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const { createBackend } = require('../src/versioning/backends');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const { renderBackupProgress, finishProgress } = require('../src/utils/cliProgress');

const CHUNK_AVG = 256 * 1024; // locked in Phase 0
const MB = 1048576;

function resolveConfigPath(args = process.argv.slice(2)) {
  const i = args.indexOf('--config');
  if (i >= 0 && args[i + 1]) return path.resolve(args[i + 1]);
  if (process.env.TALLY_CONFIG) return path.resolve(process.env.TALLY_CONFIG);
  return path.resolve('config', 'config_test.json');
}

async function main(argv = process.argv.slice(2)) {
  const configPath = resolveConfigPath(argv);
  logger.info('='.repeat(60));
  logger.info('Starting VERSIONED Tally Backup (new flow)');
  logger.info(`Config: ${configPath}`);
  logger.info('='.repeat(60));

  if (!(await fs.pathExists(configPath))) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }
  const config = await fs.readJson(configPath);

  const backupSources = (config.backup.sources || []).filter(
    (s) => s.operation === 'backup' && s.enabled !== false
  );

  const requiresDriveService = backupSources.some((source) => {
    const profileName = source.storageProfile;
    const profile = profileName && config.storageProfiles && config.storageProfiles[profileName];
    return !profile || profile.type === 'google_drive';
  });

  let driveService = null;
  if (requiresDriveService) {
    driveService = new GoogleDriveService(config.googleDrive);
    await driveService.initialize();
  }

  const keepDays = (config.retention && config.retention.keepDailyBackups) || 30;
  const concurrency = (config.backup && config.backup.concurrency) || 8;
  const startTime = Date.now();
  const overall = {
    totalFilesProcessed: 0,
    totalChunks: 0,
    totalNewChunks: 0,
    totalNewBytes: 0,
    totalSize: 0,
    duration: 0,
    success: false,
    sources: [],
    driveLinks: [],
  };

  try {
    if (backupSources.length === 0) {
      logger.warn('No enabled sources with operation "backup" found in config.');
    }

    for (const source of backupSources) {
      logger.info(
        `Backing up '${source.name}' from ${source.sourcePath} -> storage '${source.storageProfile || source.backupFolderName}'`
      );

      const { backend, storageLabel, controlPlane, lease, profile } = await createBackend({
        config,
        source,
        driveService,
      });

      if (lease && lease.writable === false) {
        // Managed storage is read-only (over quota or subscription lapsed).
        // Pause uploads for this source; existing data is retained.
        logger.warn(
          `Skipping backup of '${source.name}': managed storage is read-only ` +
          `(status=${lease.status}, ${Math.round((lease.quota && lease.quota.percent) || 0)}% of quota used). ` +
          `Upgrade the plan or free space to resume uploads.`
        );
        overall.sources.push({ name: source.name, storageLabel, skipped: true, reason: 'managed-read-only' });
        continue;
      }

      const engine = new VersionedBackup({
        backend,
        chunker: new Chunker({ avg: CHUNK_AVG }),
        objectStore: createObjectStore(backend, profile, { gzip: true }),
        snapshotStore: new SnapshotStore(backend),
        concurrency,
        logger,
      });

      const stats = await engine.backup(source.sourcePath, {
        source: source.name,
        onProgress: renderBackupProgress,
      });
      finishProgress();
      const gc = await engine.gc({ keepDays });
      const link = backend.rootFolderId
        ? `https://drive.google.com/drive/folders/${backend.rootFolderId}`
        : null;

      if (controlPlane) {
        // Report metering to the managed control plane (best effort).
        try {
          await controlPlane.reportUsage({ bytesStored: stats.totalBytes, bytesUploaded: stats.newBytesStored });
        } catch (error) {
          logger.warn(`Managed usage report failed for '${source.name}': ${error.message}`);
        }
      }

      overall.totalFilesProcessed += stats.fileCount;
      overall.totalChunks += stats.totalChunks;
      overall.totalNewChunks += stats.newChunks;
      overall.totalNewBytes += stats.newBytesStored;
      overall.totalSize += stats.totalBytes;
      overall.sources.push({ name: source.name, storageLabel, ...stats, gc, link });
      if (link) {
        overall.driveLinks.push({
          name: source.name,
          folderName: source.backupFolderName,
          operation: 'backup',
          link,
        });
      }

      logger.info(
        `'${source.name}': snapshot ${stats.snapshotId} | ${stats.fileCount} files, ` +
          `${stats.newChunks} new chunks, ${(stats.newBytesStored / MB).toFixed(2)} MB uploaded | ` +
          `GC kept ${gc.keptSnapshots} snapshots, removed ${gc.deletedChunks} orphan chunks`
      );
    }

    overall.duration = Date.now() - startTime;
    overall.success = true;

    logger.info(
      `VERSIONED backup completed in ${(overall.duration / 1000).toFixed(1)}s | ` +
        `${overall.totalNewChunks} new chunks, ${(overall.totalNewBytes / MB).toFixed(2)} MB uploaded`
    );

    if (config.email) {
      await sendReport({ config, status: 'success', result: overall });
    }

    return overall;
  } catch (error) {
    overall.duration = Date.now() - startTime;
    overall.success = false;
    logger.error('VERSIONED backup failed:', error);
    if (config.email) {
      await sendReport({ config, status: 'failure', result: overall, error });
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = main;
