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
const { sendReportSafely: sendReport } = require('../src/utils/reportEmail');
const Chunker = require('../src/versioning/Chunker');
const { resolveObjectStore } = require('../src/versioning/createObjectStore');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const { createBackend } = require('../src/versioning/backends');
const { verifyRepository, acceptRepository, readMarker } = require('../src/versioning/RepoMarker');
const { mirrorRepository } = require('../src/versioning/RepositoryMirror');
const MirrorBackup = require('../src/MirrorBackup');
const { googleConfigFor } = require('../src/utils/googleAuth');
const configPathManager = require('../src/utils/ConfigPathManager');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const { renderBackupProgress, finishProgress, emitMachineEvent } = require('../src/utils/cliProgress');

const CHUNK_AVG = 256 * 1024; // locked in Phase 0
const MB = 1048576;

function resolveConfigPath(args = process.argv.slice(2)) {
  const i = args.indexOf('--config');
  if (i >= 0 && args[i + 1]) return path.resolve(args[i + 1]);
  if (process.env.TALLY_CONFIG) return path.resolve(process.env.TALLY_CONFIG);
  return path.resolve('config', 'config_test.json');
}

function resolveSourceFilter(args = process.argv.slice(2)) {
  const names = [];
  args.forEach((arg, i) => {
    if (arg === '--source' && args[i + 1]) names.push(args[i + 1]);
  });
  return names;
}

// A source may copy to one destination or several (the 3-2-1 pattern).
// Older configs name a single profile in `storageProfile`.
function destinationsOf(source) {
  if (Array.isArray(source.storageProfiles) && source.storageProfiles.length) {
    return source.storageProfiles;
  }
  return [source.storageProfile];
}

// Plain folder-to-folder copy. Only local destinations make sense here: the
// point is a copy the customer can open directly.
async function runMirrorSource(config, source, overall) {
  const profileName = destinationsOf(source)[0];
  const profile = (config.storageProfiles || {})[profileName];
  if (!profile) throw new Error(`Storage profile not found for '${source.name}': ${profileName}`);
  if (profile.type !== 'local' && profile.type !== 'network') {
    throw new Error(
      `"${source.name}" makes an exact copy, which needs a folder on this computer or a network share. ` +
        `"${profileName}" is ${profile.type}. Choose a local destination, or switch this source to versioned backup.`
    );
  }
  const rootDir = profile.rootDir || profile.rootPath || profile.path;
  if (!rootDir) throw new Error(`Storage profile '${profileName}' has no folder set.`);

  const folders = Array.isArray(source.sourcePaths) && source.sourcePaths.length
    ? source.sourcePaths
    : [source.sourcePath];
  const destRoot = path.join(rootDir, source.mirrorFolderName || source.name);
  const startedAt = Date.now();

  logger.info(
    `Copying '${source.name}' from ${folders.map((f) => (typeof f === 'string' ? f : f.path)).join(', ')} -> ${destRoot}`
  );

  const stats = await new MirrorBackup({ logger }).run(folders, destRoot, {
    prune: source.mirrorPrune === true,
    onProgress: renderBackupProgress,
  });
  finishProgress();

  logger.info(
    `'${source.name}': ${stats.copiedFiles} file(s) copied, ${stats.skippedFiles} already current` +
      `${stats.deletedFiles ? `, ${stats.deletedFiles} removed` : ''} | ${(stats.copiedBytes / MB).toFixed(2)} MB written`
  );

  const entry = {
    name: source.name,
    mode: 'mirror',
    storageLabel: destRoot,
    profileName,
    dest: destRoot,
    fileCount: stats.fileCount,
    newBytesStored: stats.copiedBytes,
    totalBytes: stats.totalBytes,
    copiedFiles: stats.copiedFiles,
    deletedFiles: stats.deletedFiles,
  };
  overall.totalFilesProcessed += stats.fileCount;
  overall.totalNewBytes += stats.copiedBytes;
  overall.totalSize += stats.totalBytes;
  overall.sources.push(entry);

  return {
    totalFilesProcessed: stats.fileCount,
    totalChunks: 0,
    totalNewChunks: 0,
    totalNewBytes: stats.copiedBytes,
    totalSize: stats.totalBytes,
    duration: Date.now() - startedAt,
    sources: [entry],
    driveLinks: [],
  };
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

  const forceNewRepository = argv.includes('--force-new-repository');
  const repoStatePath = path.join(configPathManager.dataDir, 'repo-state.json');

  const onlySources = resolveSourceFilter(argv);
  const backupSources = (config.backup.sources || []).filter(
    (s) => s.operation === 'backup' && s.enabled !== false && (onlySources.length === 0 || onlySources.includes(s.name))
  );
  if (onlySources.length) {
    if (backupSources.length === 0) {
      throw new Error(`No enabled backup source named '${onlySources.join("', '")}' was found.`);
    }
    logger.info(`Backing up only: ${backupSources.map((s) => s.name).join(', ')}.`);
  }

  // One Drive service per Google account, shared by the profiles that use it.
  const driveServices = new Map();
  const driveServiceFor = async (profileName) => {
    const profile = profileName && config.storageProfiles && config.storageProfiles[profileName];
    if (profile && profile.type !== 'google_drive') return null;
    const googleConfig = await googleConfigFor(config, profileName);
    const key = googleConfig.tokenPath || 'shared';
    if (!driveServices.has(key)) {
      const service = new GoogleDriveService(googleConfig);
      await service.initialize();
      driveServices.set(key, service);
    }
    return driveServices.get(key);
  };

  const defaultKeepDays = (config.retention && config.retention.keepDailyBackups) || 30;
  // Each destination may keep a different amount of history (1-30 days).
  const keepDaysFor = (profileName) => {
    const profile = (profileName && config.storageProfiles && config.storageProfiles[profileName]) || {};
    const value = Number(profile.keepDailyBackups || defaultKeepDays);
    return Math.min(30, Math.max(1, Number.isFinite(value) ? value : 30));
  };
  const concurrency = (config.backup && config.backup.concurrency) || 8;
  const startTime = Date.now();
  let currentSource = null;
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

    for (const configuredSource of backupSources) {
      // An "exact copy" source is a plain folder copy with no history, so it
      // bypasses the versioned engine entirely.
      if (configuredSource.mode === 'mirror') {
        const result = await runMirrorSource(config, configuredSource, overall);
        if (config.email) {
          await sendReport({ config, status: 'success', result, source: configuredSource });
        }
        continue;
      }

      // A source may write to one destination or several (the 3-2-1 pattern).
      const destinations = destinationsOf(configuredSource);
      // The first destination is backed up from the original files; the rest are
      // mirrors of it, so the data is read and chunked only once.
      const [primaryDestination, ...mirrorDestinations] = destinations;
      const destinationResults = [];
      const sourceStarted = Date.now();
      let primaryBackend = null;
      let primaryStats = null;

      {
      const destination = primaryDestination;
      const source = { ...configuredSource, storageProfile: destination };
      currentSource = source;
      // A source may protect one folder (`sourcePath`) or several (`sourcePaths`,
      // each a path string or { path, label }).
      const sourceFolders = Array.isArray(source.sourcePaths) && source.sourcePaths.length
        ? source.sourcePaths
        : [source.sourcePath];
      logger.info(
        `Backing up '${source.name}' from ${sourceFolders.map((f) => (typeof f === 'string' ? f : f.path)).join(', ')} -> storage '${source.storageProfile || source.backupFolderName}'`
      );

      const { backend, storageLabel, controlPlane, lease, profile } = await createBackend({
        config,
        source,
        driveService: await driveServiceFor(destination),
      });
      primaryBackend = backend;

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

      const profileKey = source.storageProfile || storageLabel;
      const repo = await verifyRepository({
        backend,
        profileName: profileKey,
        statePath: repoStatePath,
        adopt: true,
      });
      if (repo.status === 'missing' || repo.status === 'mismatch') {
        if (!forceNewRepository) {
          emitMachineEvent('repo-conflict', {
            status: repo.status,
            profileName: profileKey,
            storageLabel,
            sourceName: source.name,
          });
          throw new Error(
            repo.status === 'missing'
              ? `Backup repository not found at '${storageLabel}'. It looks like the destination was emptied, deleted or replaced. ` +
                `Your previous restore points are NOT in this location. Point the profile back at the original location to recover them, ` +
                `or re-run with --force-new-repository to start a brand-new backup history here.`
              : `'${storageLabel}' now contains a different backup repository than '${profileKey}' used before. ` +
                `Backing up here would start a separate history. Re-run with --force-new-repository to accept this location.`
          );
        }
        await acceptRepository({ backend, profileName: profileKey, statePath: repoStatePath });
        logger.warn(`Starting a NEW backup history at '${storageLabel}' (--force-new-repository).`);
      } else if (repo.status === 'created') {
        logger.info(`Initialised a new backup repository at '${storageLabel}'.`);
      }

      const engine = new VersionedBackup({
        backend,
        chunker: new Chunker({ avg: CHUNK_AVG }),
        objectStore: await resolveObjectStore(backend, profile, { gzip: true }),
        snapshotStore: new SnapshotStore(backend),
        concurrency,
        logger,
      });

      const stats = await engine.backup(sourceFolders, {
        source: source.name,
        onProgress: renderBackupProgress,
      });
      primaryStats = stats;
      finishProgress();
      const gc = await engine.gc({ keepDays: keepDaysFor(destination) });

      // An established repository re-uploading nearly everything usually means the
      // destination lost its data even though the marker survived.
      const reuploadRatio = stats.totalChunks > 0 ? stats.newChunks / stats.totalChunks : 0;
      const anomaly =
        repo.status === 'ok' && gc.keptSnapshots > 1 && stats.totalChunks > 20 && reuploadRatio > 0.95
          ? 'possible-repository-reset'
          : null;
      if (anomaly) {
        logger.warn(
          `Possible repository reset for '${source.name}': ${(reuploadRatio * 100).toFixed(0)}% of data had to be ` +
          `re-uploaded to '${storageLabel}' even though earlier restore points exist. Verify the destination.`
        );
        emitMachineEvent('anomaly', {
          type: 'possible-repository-reset',
          sourceName: source.name,
          storageLabel,
          percentReuploaded: Math.round(reuploadRatio * 100),
        });
      }

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
      overall.sources.push({ name: source.name, storageLabel, ...stats, gc, link, anomaly });
      destinationResults.push({ name: source.name, profileName: destination, storageLabel, role: 'primary', ...stats, gc, link, anomaly });
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

      if (config.email) {
        const sourceResult = {
          totalFilesProcessed: stats.fileCount,
          totalChunks: stats.totalChunks,
          totalNewChunks: stats.newChunks,
          totalNewBytes: stats.newBytesStored,
          totalSize: stats.totalBytes,
          duration: Date.now() - sourceStarted,
          sources: [{ name: source.name, storageLabel, ...stats, gc, link, anomaly }],
          driveLinks: link ? [{ name: source.name, folderName: source.backupFolderName, operation: 'backup', link }] : [],
        };
        if (!mirrorDestinations.length) {
          await sendReport({ config, status: 'success', result: sourceResult, source });
        }
      }
      }

      for (const destination of mirrorDestinations) {
        const mirrorSource = { ...configuredSource, storageProfile: destination };
        currentSource = mirrorSource;
        const mirrorStarted = Date.now();
        const { backend: mirrorBackend, storageLabel: mirrorLabel } = await createBackend({
          config,
          source: mirrorSource,
          driveService: await driveServiceFor(destination),
        });
        logger.info(`Copying '${configuredSource.name}' to '${destination}' (${mirrorLabel}).`);

        const existingMarker = await readMarker(mirrorBackend);
        const primaryMarker = await readMarker(primaryBackend);
        const hasOwnHistory = await mirrorBackend.exists('refs.json').catch(() => false);
        // Only refuse when the copy would overwrite a real, unrelated history.
        if (
          existingMarker && primaryMarker && existingMarker.id !== primaryMarker.id &&
          hasOwnHistory && !forceNewRepository
        ) {
          emitMachineEvent('repo-conflict', {
            status: 'mismatch',
            profileName: destination,
            storageLabel: mirrorLabel,
            sourceName: configuredSource.name,
          });
          throw new Error(
            `'${mirrorLabel}' already holds a different backup history, so it cannot be used as a copy of ` +
              `'${primaryDestination}'. Choose an empty folder, or re-run with --force-new-repository to replace it.`
          );
        }

        const mirrored = await mirrorRepository({
          from: primaryBackend,
          to: mirrorBackend,
          logger,
          onProgress: renderBackupProgress,
        });
        finishProgress();
        // The copy now carries the primary's marker, so record that identity.
        await acceptRepository({ backend: mirrorBackend, profileName: destination, statePath: repoStatePath });

        // The copy inherits the main destination's history, so drop whatever the
        // main destination has already pruned instead of accumulating orphans.
        const mirrorEngine = new VersionedBackup({
          backend: mirrorBackend,
          objectStore: await resolveObjectStore(
            mirrorBackend,
            (config.storageProfiles && config.storageProfiles[destination]) || {},
            { gzip: true }
          ),
          snapshotStore: new SnapshotStore(mirrorBackend),
          logger,
        });
        const mirrorGc = await mirrorEngine.gc({ keepDays: keepDaysFor(primaryDestination) });

        const mirrorLink = mirrorBackend.rootFolderId
          ? `https://drive.google.com/drive/folders/${mirrorBackend.rootFolderId}`
          : null;
        overall.totalNewBytes += mirrored.bytes;
        overall.sources.push({
          name: configuredSource.name,
          storageLabel: mirrorLabel,
          mirroredFrom: primaryDestination,
          newBytesStored: mirrored.bytes,
          link: mirrorLink,
        });
        destinationResults.push({
          name: configuredSource.name,
          profileName: destination,
          storageLabel: mirrorLabel,
          role: 'copy',
          mirroredFrom: primaryDestination,
          objectsCopied: mirrored.copied,
          newBytesStored: mirrored.bytes,
          gc: mirrorGc,
          totalBytes: primaryStats ? primaryStats.totalBytes : 0,
          fileCount: primaryStats ? primaryStats.fileCount : 0,
          duration: Date.now() - mirrorStarted,
          link: mirrorLink,
        });
        if (mirrorLink) {
          overall.driveLinks.push({
            name: configuredSource.name,
            folderName: mirrorSource.backupFolderName,
            operation: 'backup',
            link: mirrorLink,
          });
        }
      }

      if (config.email && mirrorDestinations.length && primaryStats) {
        await sendReport({
          config,
          status: 'success',
          source: configuredSource,
          result: {
            totalFilesProcessed: primaryStats.fileCount,
            totalChunks: primaryStats.totalChunks,
            totalNewChunks: primaryStats.newChunks,
            totalNewBytes: destinationResults.reduce((sum, entry) => sum + (entry.newBytesStored || 0), 0),
            totalSize: primaryStats.totalBytes,
            duration: Date.now() - sourceStarted,
            sources: destinationResults,
            driveLinks: destinationResults
              .filter((entry) => entry.link)
              .map((entry) => ({
                name: entry.name,
                folderName: entry.storageLabel,
                operation: 'backup',
                link: entry.link,
              })),
          },
        });
      }
    }

    overall.duration = Date.now() - startTime;
    overall.success = true;

    logger.info(
      `VERSIONED backup completed in ${(overall.duration / 1000).toFixed(1)}s | ` +
        `${overall.totalNewChunks} new chunks, ${(overall.totalNewBytes / MB).toFixed(2)} MB uploaded`
    );

    return overall;
  } catch (error) {
    overall.duration = Date.now() - startTime;
    overall.success = false;
    logger.error('VERSIONED backup failed:', error);
    if (config.email) {
      await sendReport({ config, status: 'failure', result: overall, error, source: currentSource });
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = main;
