#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs-extra');
const cron = require('node-cron');

const logger = require('../src/utils/logger');
const runVersionedBackup = require('./versioned-backup');
const runVersionedRestore = require('./versioned-restore');

function resolveConfigPath(args = process.argv.slice(2)) {
  const i = args.indexOf('--config');
  if (i >= 0 && args[i + 1]) return path.resolve(args[i + 1]);
  if (process.env.TALLY_CONFIG) return path.resolve(process.env.TALLY_CONFIG);
  return path.resolve('config', 'config_test.json');
}

function parseArgs(argv) {
  const opts = {
    configPath: resolveConfigPath(argv),
    listJobs: false,
    runBackupNow: false,
    runRestoreNow: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list-jobs') opts.listJobs = true;
    else if (arg === '--run-backup-now') opts.runBackupNow = true;
    else if (arg === '--run-restore-now' && argv[i + 1]) opts.runRestoreNow = argv[++i];
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--config' && argv[i + 1]) i += 1;
  }
  return opts;
}

function getEnabledBackupSources(config) {
  return (config.backup.sources || []).filter(
    (source) => source.operation === 'backup' && source.enabled !== false
  );
}

function getScheduledRestoreSources(config) {
  return (config.backup.sources || []).filter((source) => {
    if (source.operation !== 'restore' || source.enabled === false) return false;
    const restoreCfg = source.restore || {};
    return restoreCfg.mode === 'scheduled' && !!restoreCfg.schedule;
  });
}

async function runScheduledBackup(configPath, { dryRun = false } = {}) {
  logger.info('Scheduler dispatch: versioned backup job');
  const args = ['--config', configPath];
  if (dryRun) args.push('--dry-run');
  return runVersionedBackup(args);
}

async function runScheduledRestore(configPath, sourceName, { dryRun = false } = {}) {
  logger.info(`Scheduler dispatch: versioned restore job for '${sourceName}'`);
  const args = ['--config', configPath, '--source', sourceName];
  if (dryRun) args.push('--dry-run');
  return runVersionedRestore(args);
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!(await fs.pathExists(opts.configPath))) {
    throw new Error(`Configuration file not found: ${opts.configPath}`);
  }

  const config = await fs.readJson(opts.configPath);
  const backupSources = getEnabledBackupSources(config);
  const restoreSources = getScheduledRestoreSources(config);

  if (opts.listJobs) {
    console.log('\n--- Versioned scheduler jobs ---');
    if (config.backup && config.backup.schedule && backupSources.length > 0) {
      console.log(`backup  | ${config.backup.schedule} | ${backupSources.length} enabled source(s)`);
    } else {
      console.log('backup  | disabled / none');
    }
    if (restoreSources.length === 0) {
      console.log('restore | no scheduled restore sources');
    } else {
      for (const source of restoreSources) {
        console.log(
          `restore | ${source.restore.schedule} | ${source.name} -> ${source.sourcePath} | tz=${source.restore.timezone || 'Asia/Kolkata'}`
        );
      }
    }
    console.log('');
    return { listed: true, backupSources: backupSources.length, restoreSources: restoreSources.length };
  }

  if (opts.runBackupNow) {
    return runScheduledBackup(opts.configPath, { dryRun: opts.dryRun });
  }

  if (opts.runRestoreNow) {
    return runScheduledRestore(opts.configPath, opts.runRestoreNow, { dryRun: opts.dryRun });
  }

  logger.info('='.repeat(60));
  logger.info('Starting VERSIONED scheduler');
  logger.info(`Config: ${opts.configPath}`);
  logger.info('='.repeat(60));

  let isRunning = false;
  const jobs = [];

  const dispatch = async (label, fn) => {
    if (isRunning) {
      logger.warn(`Scheduler skipped ${label}: another versioned job is already running`);
      return;
    }
    isRunning = true;
    try {
      await fn();
    } catch (error) {
      logger.error(`Scheduler job failed (${label}):`, error);
    } finally {
      isRunning = false;
    }
  };

  if (config.backup && config.backup.schedule && backupSources.length > 0) {
    if (!cron.validate(config.backup.schedule)) {
      throw new Error(`Invalid backup cron expression: ${config.backup.schedule}`);
    }
    jobs.push(
      cron.schedule(
        config.backup.schedule,
        () => dispatch('backup', () => runScheduledBackup(opts.configPath)),
        { scheduled: false, timezone: 'Asia/Kolkata' }
      )
    );
    logger.info(
      `Registered versioned backup cron '${config.backup.schedule}' for ${backupSources.length} enabled source(s)`
    );
  }

  for (const source of restoreSources) {
    const restoreCfg = source.restore || {};
    if (!cron.validate(restoreCfg.schedule)) {
      throw new Error(`Invalid restore cron expression for '${source.name}': ${restoreCfg.schedule}`);
    }
    jobs.push(
      cron.schedule(
        restoreCfg.schedule,
        () => dispatch(`restore:${source.name}`, () => runScheduledRestore(opts.configPath, source.name)),
        {
          scheduled: false,
          timezone: restoreCfg.timezone || 'Asia/Kolkata',
        }
      )
    );
    logger.info(
      `Registered restore cron '${restoreCfg.schedule}' for '${source.name}' (${restoreCfg.timezone || 'Asia/Kolkata'})`
    );
  }

  if (jobs.length === 0) {
    logger.warn('No versioned backup or scheduled restore jobs were registered.');
    return { started: false, jobs: 0 };
  }

  for (const job of jobs) job.start();
  logger.info(`VERSIONED scheduler started with ${jobs.length} job(s)`);

  process.on('SIGINT', () => {
    logger.info('Stopping VERSIONED scheduler...');
    for (const job of jobs) job.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Stopping VERSIONED scheduler...');
    for (const job of jobs) job.stop();
    process.exit(0);
  });

  return new Promise(() => {});
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = main;