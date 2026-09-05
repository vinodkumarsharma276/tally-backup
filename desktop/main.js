'use strict';

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Tray,
  Menu,
  Notification,
  nativeImage,
  powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { fork } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');
const cron = require('node-cron');

const configPathManager = require('../src/utils/ConfigPathManager');
const GoogleDriveService = require('../src/GoogleDriveService');
const EmailService = require('../src/EmailService');
const SnapshotStore = require('../src/versioning/SnapshotStore');
const VersionedBackup = require('../src/versioning/VersionedBackup');
const { resolveObjectStore } = require('../src/versioning/createObjectStore');
const { createBackend, testStorageProfile } = require('../src/versioning/backends');
const { PROGRESS_PREFIX } = require('../src/utils/cliProgress');
const { statusIconBuffer } = require('./trayIcon');
const { acceptRepository } = require('../src/versioning/RepoMarker');
const { googleConfigFor, hasOwnAccount, connectTokenRef } = require('../src/utils/googleAuth');
const { signInWithGoogle, cancelSignIn } = require('./googleSignIn');
const { readSession, saveSession, clearSession, deviceIdentity } = require('./session');
const {
  migrateConfigSecrets,
  sanitizeConfigForRenderer,
  secureConfigFromRenderer,
} = require('../src/utils/ConfigSecrets');
const { autoUpdater } = require('electron-updater');

const APP_NAME = 'Backup Genie';
let mainWindow = null;
let tray = null;
let currentOperation = null;
let latestProgress = null;
let schedulerJobs = [];
let schedulerState = { enabled: false, jobs: [], errors: [] };
let runtimeSettings = {
  autoStart: true,
  minimizeToTray: true,
  notifications: true,
  schedulerEnabled: true,
};
let isQuitting = false;
let trayResetTimer = null;
let closeHintShown = false;
// Missed runs found at startup/resume, dispatched one at a time.
let pendingCatchUps = [];

const START_HIDDEN = process.argv.includes('--hidden');
// Schedules follow this machine unless the config names a zone.
const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
}

function operationWorkingDirectory() {
  return app.isPackaged ? configPathManager.getBaseDir() : appRoot();
}

function configPath() {
  if (process.env.TALLY_CONFIG) return path.resolve(process.env.TALLY_CONFIG);
  if (!app.isPackaged) return path.join(appRoot(), 'config', 'config_test.json');
  return configPathManager.getConfigPath();
}

function logsDirectory() {
  if (!app.isPackaged) return path.join(appRoot(), 'logs');
  return configPathManager.getLogsDir();
}

async function ensureConfig() {
  const target = configPath();
  if (!(await fs.pathExists(target))) {
    await fs.ensureDir(path.dirname(target));
    const template = path.join(__dirname, 'default-config.json');
    await fs.copy(template, target);
  }
  const existing = await fs.readJson(target);
  const migration = await migrateConfigSecrets(existing, target);
  if (migration.changed) {
    await writeConfigAtomic(target, migration.config);
    await appendDesktopLog(
      `Migrated ${migration.migrated.length} secret(s) to the OS credential vault and removed ${migration.deletedFiles.length} plaintext credential file(s).`
    );
  }
  return target;
}

async function writeConfigAtomic(target, config) {
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeJson(temporary, config, { spaces: 2 });
  await fs.move(temporary, target, { overwrite: true });
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Configuration must be an object.');
  if (!config.backup || !Array.isArray(config.backup.sources)) {
    throw new Error('Configuration must contain backup.sources.');
  }
  const names = new Set();
  for (const [index, source] of config.backup.sources.entries()) {
    const label = source.name ? `"${source.name}"` : `Source ${index + 1}`;
    if (!source.name) throw new Error(`${label} needs a display name.`);
    if (!source.operation) throw new Error(`${label} needs to be set to Backup or Restore.`);
    if (!['backup', 'restore'].includes(source.operation)) {
      throw new Error(`Unsupported source operation: ${source.operation}`);
    }
    // A source may list one folder or several; at least one must be set.
    const folders = Array.isArray(source.sourcePaths) && source.sourcePaths.length
      ? source.sourcePaths.map((entry) => (typeof entry === 'string' ? entry : entry && entry.path))
      : [source.sourcePath];
    if (!folders.some((folder) => String(folder || '').trim())) {
      throw new Error(
        source.operation === 'restore'
          ? `${label} needs a restore destination folder. Click Browse to choose one.`
          : `${label} needs a folder to back up. Click Browse to choose one.`
      );
    }
    if (names.has(source.name)) throw new Error(`Duplicate source name: ${source.name}`);
    names.add(source.name);
  }
  return config;
}

async function loadConfig() {
  const target = await ensureConfig();
  return fs.readJson(target);
}

async function loadConfigForRenderer() {
  const sanitized = await sanitizeConfigForRenderer(await loadConfig());
  // Profiles with a recorded repository are in use; the UI locks their provider.
  const statePath = path.join(configPathManager.dataDir, 'repo-state.json');
  const state = (await fs.readJson(statePath).catch(() => ({}))) || {};
  sanitized._profilesInUse = Object.keys(state);
  return sanitized;
}

async function saveConfig(submittedConfig) {
  const target = await ensureConfig();
  const previous = await fs.readJson(target);
  const secured = await secureConfigFromRenderer(submittedConfig, previous, target);
  validateConfig(secured.config);
  await writeConfigAtomic(target, secured.config);
  await applyDesktopSettings(secured.config);
  await configureSchedules(secured.config);
  if (secured.changed.length) {
    await appendDesktopLog(`Stored ${secured.changed.length} updated secret(s) in the OS credential vault.`);
  }
  return target;
}

function escapeXml(value) {
  return String(value).replace(/[<>&'\"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[character]);
}

function appIconImage() {
  // .ico first: Windows uses it for the taskbar button.
  for (const file of ['icon.ico', 'icon.png']) {
    const candidate = path.join(appRoot(), 'build', file);
    if (fs.existsSync(candidate)) {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return image;
    }
  }
  return nativeImage.createFromBuffer(statusIconBuffer('idle', 256));
}

function createStatusImage(state = 'idle') {
  // Electron's nativeImage cannot decode SVG on Windows, so tray icons are real
  // PNG buffers (see desktop/trayIcon.js).
  return nativeImage.createFromBuffer(statusIconBuffer(state, 32));
}

function humanBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Number(value) || 0;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function progressTooltip(progress, operation) {
  if (!progress) return `${APP_NAME} — ${operation?.type === 'restore' ? 'Restoring…' : 'Backing up…'}`;
  const total = Number(progress.totalBytes || 0);
  const processed = Number(progress.processedBytes || 0);
  const percent = total ? Math.min(100, (processed / total) * 100) : 0;
  const rate = progress.elapsedMs > 0 ? processed / (progress.elapsedMs / 1000) : 0;
  const remaining = rate > 0 ? Math.max(0, total - processed) / rate : 0;
  const eta = remaining >= 60 ? `${Math.round(remaining / 60)}m` : `${Math.round(remaining)}s`;
  const action = operation?.type === 'restore' ? 'Restoring' : 'Backing up';
  return `${APP_NAME} — ${action} ${percent.toFixed(1)}% · ${humanBytes(processed)}/${humanBytes(total)} · ETA ${eta}`;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function showNotification(title, body, state = 'idle') {
  if (runtimeSettings.notifications === false || !Notification.isSupported()) return;
  new Notification({ title, body, icon: createStatusImage(state), silent: false }).show();
}

let updateState = { status: 'idle', version: null, progress: 0, error: null };
let updaterConfigured = false;

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  emit('update:state', updateState);
  updateTrayMenu();
}

function configureAutoUpdater() {
  if (updaterConfigured || !app.isPackaged) return;
  updaterConfigured = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => {
    setUpdateState({ status: 'available', version: info.version, error: null });
    showNotification('Update available', `Version ${info.version} is downloading in the background.`, 'idle');
    appendDesktopLog(`Update available: ${info.version}`);
  });
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'none', error: null }));
  autoUpdater.on('download-progress', (progress) =>
    setUpdateState({ status: 'downloading', progress: Math.round(progress.percent || 0) })
  );
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({ status: 'downloaded', version: info.version, progress: 100, error: null });
    showNotification(
      'Update ready to install',
      `Version ${info.version} will install when you quit. Choose "Restart to update" from the tray to update now.`,
      'success'
    );
    appendDesktopLog(`Update downloaded: ${info.version}`);
  });
  autoUpdater.on('error', (error) => {
    setUpdateState({ status: 'error', error: error == null ? 'unknown' : (error.message || String(error)) });
    appendDesktopLog(`Auto-update error: ${error && error.message ? error.message : error}`);
  });
}

function checkForUpdates() {
  if (!app.isPackaged) return { status: 'unsupported', error: 'Updates are only available in the installed app.' };
  configureAutoUpdater();
  autoUpdater.checkForUpdates().catch((error) => {
    setUpdateState({ status: 'error', error: error && error.message ? error.message : String(error) });
  });
  return updateState;
}

function installUpdate() {
  if (updateState.status !== 'downloaded') return false;
  isQuitting = true;
  setImmediate(() => autoUpdater.quitAndInstall());
  return true;
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Open Backup Genie', click: showMainWindow },
    { type: 'separator' },
    {
      label: currentOperation ? 'Backup / restore in progress…' : 'Run backup now',
      enabled: !currentOperation,
      click: () => safeStartOperation('backup', { origin: 'tray' }),
    },
    {
      label: 'Stop current operation',
      enabled: Boolean(currentOperation),
      click: () => currentOperation?.child.kill('SIGTERM'),
    },
    { type: 'separator' },
    {
      label: schedulerState.enabled
        ? `Schedules active (${schedulerState.jobs.length})`
        : 'Schedules paused',
      enabled: false,
    },
    { label: 'Open logs folder', click: () => shell.openPath(logsDirectory()) },
    ...(updateState.status === 'downloaded'
      ? [
          { type: 'separator' },
          { label: `Restart to update to ${updateState.version || 'latest'}`, click: installUpdate },
        ]
      : []),
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function setTrayState(state, tooltip) {
  if (!tray) return;
  if (trayResetTimer) {
    clearTimeout(trayResetTimer);
    trayResetTimer = null;
  }
  tray.setImage(createStatusImage(state));
  tray.setToolTip(tooltip || `${APP_NAME} — Ready`);
  updateTrayMenu();
}

function scheduleTrayReset() {
  trayResetTimer = setTimeout(() => {
    if (!currentOperation) setTrayState('idle', `${APP_NAME} — Ready`);
  }, 30000);
}

function createTray() {
  if (tray) return tray;
  tray = new Tray(createStatusImage('idle'));
  tray.setToolTip(`${APP_NAME} — Ready`);
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  updateTrayMenu();
  return tray;
}

async function appendDesktopLog(message) {
  try {
    const directory = logsDirectory();
    await fs.ensureDir(directory);
    const stamp = new Date().toISOString();
    await fs.appendFile(path.join(directory, 'desktop-scheduler.log'), `${stamp} ${message}\n`);
  } catch {
    // Logging must never stop the scheduler or backup operation.
  }
}

async function applyDesktopSettings(config) {
  runtimeSettings = {
    ...runtimeSettings,
    ...(config.desktop || {}),
  };
  if (app.isPackaged) {
    const openAtLogin = runtimeSettings.autoStart !== false;
    app.setLoginItemSettings({
      openAtLogin,
      path: process.execPath,
      args: ['--hidden'],
    });
    const applied = app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] });
    if (applied.openAtLogin !== openAtLogin) {
      await appendDesktopLog(
        `Warning: Windows startup entry could not be ${openAtLogin ? 'created' : 'removed'}. ` +
          'Scheduled backups only run while the app is open.'
      );
    } else {
      await appendDesktopLog(`Start with Windows: ${openAtLogin ? 'enabled' : 'disabled'}.`);
    }
  }
}

function clearSchedules() {
  for (const scheduled of schedulerJobs) {
    try {
      scheduled.task.stop();
      if (typeof scheduled.task.destroy === 'function') scheduled.task.destroy();
    } catch {
      // Best effort during config reload/shutdown.
    }
  }
  schedulerJobs = [];
}

function publishSchedulerState(errors = []) {
  schedulerState = {
    enabled: runtimeSettings.schedulerEnabled !== false,
    jobs: schedulerJobs.map(({ label, expression, timezone }) => ({ label, expression, timezone })),
    errors,
  };
  emit('scheduler:state', schedulerState);
  updateTrayMenu();
}

function dispatchScheduled(type, args = {}) {
  if (currentOperation) {
    const message = `Skipped scheduled ${type}: another operation is already running.`;
    appendDesktopLog(message);
    showNotification('Scheduled job skipped', message, 'paused');
    return;
  }
  try {
    appendDesktopLog(`Dispatching scheduled ${type}${args.sourceName ? ` (${args.sourceName})` : ''}.`);
    startChildOperation(type, { ...args, origin: 'scheduled' });
  } catch (error) {
    appendDesktopLog(`Failed to start scheduled ${type}: ${error.message}`);
    showNotification('Scheduled job failed to start', error.message, 'failed');
  }
}

/* ------------------------------------------------------------------ *
 * Missed-run recovery
 *
 * node-cron timers only exist while this process runs, and the OS
 * suspends them during sleep/hibernate. Without the state below, a
 * schedule that came due while the machine was off is skipped silently
 * and forever. We persist each job's next due time so the next launch
 * (or wake) can notice the gap and catch up.
 * ------------------------------------------------------------------ */

function scheduleStatePath() {
  return path.join(configPathManager.dataDir, 'schedule-state.json');
}

async function readScheduleState() {
  const state = await fs.readJson(scheduleStatePath()).catch(() => ({}));
  return state && typeof state === 'object' ? state : {};
}

async function writeScheduleState(state) {
  try {
    await fs.ensureDir(path.dirname(scheduleStatePath()));
    await fs.writeJson(scheduleStatePath(), state, { spaces: 2 });
  } catch (error) {
    appendDesktopLog(`Could not save schedule state: ${error.message}`);
  }
}

async function recordScheduleFired(key) {
  const state = await readScheduleState();
  const job = schedulerJobs.find((entry) => entry.key === key);
  const next = job?.task?.getNextRun?.();
  state[key] = {
    ...(state[key] || {}),
    lastFiredAt: new Date().toISOString(),
    dueAt: next ? new Date(next).toISOString() : null,
  };
  await writeScheduleState(state);
}

// Runs one catch-up at a time so several missed sources cannot all start at once.
function queueCatchUps(jobs) {
  pendingCatchUps.push(...jobs);
  if (!currentOperation) dispatchNextCatchUp();
}

function dispatchNextCatchUp() {
  const job = pendingCatchUps.shift();
  if (!job) return;
  appendDesktopLog(`Catching up missed ${job.type} for '${job.sourceName}' (was due ${job.dueAt}).`);
  showNotification(
    'Catching up a missed backup',
    `"${job.sourceName}" was due ${job.dueAt} while this machine was off or asleep.`,
    'idle'
  );
  dispatchScheduled(job.type, job.args);
}

async function runMissedSchedules(reason, config) {
  if (runtimeSettings.schedulerEnabled === false) return;
  if (config?.backup?.catchUpMissed === false) {
    await appendDesktopLog(`Missed-run check skipped (${reason}): catch-up disabled in config.`);
    return;
  }
  const graceHours = Number(config?.backup?.catchUpWithinHours ?? 48);
  const state = await readScheduleState();
  const now = Date.now();
  const missed = [];

  for (const job of schedulerJobs) {
    if (!job.catchUp) continue;
    const due = state[job.key]?.dueAt ? Date.parse(state[job.key].dueAt) : NaN;
    if (!Number.isFinite(due) || due > now) continue;
    const lastFired = state[job.key]?.lastFiredAt ? Date.parse(state[job.key].lastFiredAt) : 0;
    if (lastFired >= due) continue;
    const hoursLate = (now - due) / 3_600_000;
    if (graceHours > 0 && hoursLate > graceHours) {
      await appendDesktopLog(
        `Missed ${job.type} for '${job.sourceName}' (due ${state[job.key].dueAt}, ` +
        `${Math.round(hoursLate)}h ago) is older than the ${graceHours}h catch-up window; waiting for the next schedule.`
      );
      continue;
    }
    missed.push({ ...job, dueAt: state[job.key].dueAt });
  }

  await appendDesktopLog(
    `Missed-run check (${reason}): ${missed.length} of ${schedulerJobs.filter((j) => j.catchUp).length} job(s) overdue.`
  );
  if (missed.length) queueCatchUps(missed);
}

async function persistScheduleDueTimes() {
  const state = await readScheduleState();
  const live = {};
  for (const job of schedulerJobs) {
    if (!job.catchUp) continue;
    const next = job.task?.getNextRun?.();
    live[job.key] = {
      ...(state[job.key] || {}),
      label: job.label,
      expression: job.expression,
      timezone: job.timezone,
      dueAt: next ? new Date(next).toISOString() : null,
    };
  }
  await writeScheduleState(live);
}

// Moves a cron expression earlier by `minutes`, for the pre-backup reminder.
// Only literal minute/hour schedules can be shifted; step patterns like */6
// return null so no misleading reminder is scheduled.
function shiftCronEarlier(expression, minutes) {
  const parts = String(expression).trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, weekday] = parts;
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;

  let total = Number(hour) * 60 + Number(minute) - minutes;
  // A reminder that would fall on the previous day is dropped rather than
  // firing at the wrong time on a day the backup may not run.
  if (total < 0) return null;
  return `${total % 60} ${Math.floor(total / 60)} ${dayOfMonth} ${month} ${weekday}`;
}

async function configureSchedules(config, reason = 'config reload') {
  if (!config) config = await loadConfig();
  clearSchedules();
  await applyDesktopSettings(config);
  const errors = [];

  await appendDesktopLog(
    `Configuring schedules (enabled=${runtimeSettings.schedulerEnabled !== false}, config=${configPath()}).`
  );

  if (runtimeSettings.schedulerEnabled === false) {
    publishSchedulerState(errors);
    setTrayState('paused', `${APP_NAME} — Schedules paused`);
    return schedulerState;
  }

  const enabledBackups = (config.backup?.sources || []).filter(
    (source) => source.operation === 'backup' && source.enabled !== false
  );

  // Every backup source carries its own schedule(s); older configs fall back to
  // the schedule that used to be global.
  for (const source of enabledBackups) {
    const expressions = Array.isArray(source.schedules) && source.schedules.length
      ? source.schedules
      : [source.schedule || config.backup?.schedule].filter(Boolean);
    if (!expressions.length) {
      errors.push(`No schedule set for ${source.name}`);
      continue;
    }
    const timezone = source.timezone || config.backup?.timezone || SYSTEM_TIMEZONE;
    for (const expression of expressions) {
      if (!cron.validate(expression)) {
        errors.push(`Invalid schedule for ${source.name}: ${expression}`);
        continue;
      }
      const key = `backup:${source.name}:${expression}`;
      const task = cron.createTask(
        expression,
        () => {
          recordScheduleFired(key);
          dispatchScheduled('backup', { sourceName: source.name });
        },
        { timezone }
      );
      task.start();
      schedulerJobs.push({
        key,
        label: `Backup: ${source.name}`,
        expression,
        timezone,
        task,
        catchUp: true,
        type: 'backup',
        sourceName: source.name,
        args: { sourceName: source.name },
      });

      const warnMinutes = Number(config.backup?.warnBeforeMinutes ?? 5);
      const warnExpression = warnMinutes > 0 ? shiftCronEarlier(expression, warnMinutes) : null;
      if (warnExpression && cron.validate(warnExpression)) {
        const warnTask = cron.createTask(
          warnExpression,
          () => {
            showNotification(
              'Backup starts soon',
              `"${source.name}" backs up in ${warnMinutes} minutes. Please save and close your files.`,
              'idle'
            );
            emit('backup:warning', { sourceName: source.name, minutes: warnMinutes });
            appendDesktopLog(`Pre-backup reminder sent for '${source.name}' (${warnMinutes} min).`);
          },
          { timezone }
        );
        warnTask.start();
        schedulerJobs.push({ key: `reminder:${source.name}:${warnExpression}`, label: `Reminder: ${source.name}`, expression: warnExpression, timezone, task: warnTask });
      }
    }
  }

  const restores = (config.backup?.sources || []).filter((source) => {
    return source.operation === 'restore' && source.enabled !== false &&
      source.restore?.mode === 'scheduled' && source.restore?.schedule;
  });
  for (const source of restores) {
    const expression = source.restore.schedule;
    const timezone = source.restore.timezone || config.backup?.timezone || SYSTEM_TIMEZONE;
    if (!cron.validate(expression)) {
      errors.push(`Invalid restore schedule for ${source.name}: ${expression}`);
      continue;
    }
    const restoreArgs = {
      sourceName: source.name,
      snapshotId: source.restore.snapshotId || 'latest',
      destPath: source.sourcePath,
    };
    const key = `restore:${source.name}:${expression}`;
    const task = cron.createTask(
      expression,
      () => {
        recordScheduleFired(key);
        dispatchScheduled('restore', restoreArgs);
      },
      { timezone }
    );
    task.start();
    schedulerJobs.push({
      key,
      label: `Restore: ${source.name}`,
      expression,
      timezone,
      task,
      catchUp: true,
      type: 'restore',
      sourceName: source.name,
      args: restoreArgs,
    });
  }

  for (const error of errors) appendDesktopLog(error);
  publishSchedulerState(errors);
  await appendDesktopLog(
    `Registered ${schedulerJobs.length} schedule(s)${errors.length ? ` with ${errors.length} error(s)` : ''}.`
  );
  // Order matters: compare against the previously stored due times before
  // overwriting them with the next occurrence.
  await runMissedSchedules(reason, config);
  await persistScheduleDueTimes();
  if (!currentOperation) setTrayState('idle', `${APP_NAME} — ${schedulerJobs.length} schedule(s) active`);
  return schedulerState;
}

function profileFor(config, source) {
  return source.storageProfile && config.storageProfiles
    ? config.storageProfiles[source.storageProfile]
    : null;
}

async function createSourceBackend(config, source) {
  const profile = profileFor(config, source);
  let driveService = null;
  if (!profile || profile.type === 'google_drive') {
    driveService = new GoogleDriveService(await googleConfigFor(config, source.storageProfile));
    await driveService.initialize();
  }
  return createBackend({ config, source, driveService });
}

function cleanTerminalText(text) {
  return String(text || '')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/^\]:\s?/, '')
    .trimEnd();
}

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function consumeOutput(stream, runId, streamName) {
  if (!stream) return;
  const lines = readline.createInterface({ input: stream });
  lines.on('line', (rawLine) => {
    const line = cleanTerminalText(rawLine);
    if (!line) return;
    if (line.startsWith(PROGRESS_PREFIX)) {
      try {
        const progress = JSON.parse(line.slice(PROGRESS_PREFIX.length));
        if (progress.kind === 'repo-conflict') {
          emit('repo:conflict', progress);
          appendDesktopLog(`Repository conflict (${progress.status}) for profile '${progress.profileName}'.`);
          return;
        }
        if (progress.kind === 'anomaly') {
          emit('operation:anomaly', progress);
          appendDesktopLog(`Anomaly: ${progress.type} for '${progress.sourceName}' (${progress.percentReuploaded}% re-uploaded).`);
          showNotification(
            'Check your backup storage',
            `${progress.sourceName}: ${progress.percentReuploaded}% of data was re-uploaded. The destination may have been reset.`,
            'failed'
          );
          return;
        }
        latestProgress = { runId, ...progress };
        emit('operation:progress', latestProgress);
        setTrayState('running', progressTooltip(progress, currentOperation));
      } catch {
        emit('operation:log', { runId, stream: streamName, line });
      }
      return;
    }
    emit('operation:log', { runId, stream: streamName, line });
  });
}

function startChildOperation(type, args = {}) {
  // Google sign-in is interactive and touches no backup state, so it is allowed
  // to run while a backup or restore is in progress.
  const isAuth = type === 'auth-google';
  if (!isAuth && currentOperation) throw new Error('Another backup or restore operation is already running.');

  let script;
  const scriptArgs = ['--config', configPath()];
  if (type === 'backup') {
    script = path.join(appRoot(), 'bin', 'versioned-backup.js');
    if (args.sourceName) scriptArgs.push('--source', args.sourceName);
    for (const name of args.sourceNames || []) scriptArgs.push('--source', name);
  } else if (type === 'restore') {
    script = path.join(appRoot(), 'bin', 'versioned-restore.js');
    if (!args.sourceName && !args.profileName) throw new Error('Choose what to restore.');
    if (args.profileName) scriptArgs.push('--profile', args.profileName);
    else scriptArgs.push('--source', args.sourceName);
    if (args.snapshotId) scriptArgs.push('--snapshot', args.snapshotId);
    for (const root of args.roots || []) scriptArgs.push('--root', root);
    if (args.destPath) scriptArgs.push('--dest', args.destPath);
  } else if (type === 'auth-google') {
    script = path.join(appRoot(), 'tools', 'auth.js');
    scriptArgs.length = 0;
    scriptArgs.push('--config', configPath());
    if (args.profileName) scriptArgs.push('--profile', args.profileName);
  } else {
    throw new Error(`Unsupported operation: ${type}`);
  }

  const runId = crypto.randomUUID();
  const child = fork(script, scriptArgs, {
    cwd: operationWorkingDirectory(),
    silent: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      TALLY_PROGRESS_JSON: '1',
      TALLY_CONFIG: configPath(),
      FORCE_COLOR: '0',
    },
  });

  // The exact command line, so a failed run can be reproduced from the log.
  appendDesktopLog(
    `Started ${type} runId=${runId} pid=${child.pid} origin=${args.origin || 'manual'} ` +
    `script=${path.basename(script)} args=[${scriptArgs.join(' ')}] cwd=${operationWorkingDirectory()}`
  );

  const startedAt = new Date().toISOString();
  if (!isAuth) {
    currentOperation = {
      runId,
      type,
      origin: args.origin || 'manual',
      sourceName: args.sourceName || null,
      pid: child.pid,
      startedAt,
      child,
    };
    latestProgress = null;
    setTrayState('running', `${APP_NAME} — ${type === 'restore' ? 'Restoring…' : 'Backing up…'}`);
    emit('operation:state', { ...currentOperation, child: undefined, status: 'running' });
  }
  consumeOutput(child.stdout, runId, 'stdout');
  consumeOutput(child.stderr, runId, 'stderr');

  child.on('error', (error) => {
    emit('operation:log', { runId, stream: 'stderr', line: error.message });
    appendDesktopLog(`${type} process error: ${error.message}`);
  });
  child.on('exit', async (code, signal) => {
    if (isAuth) {
      emit('auth:state', { runId, status: code === 0 ? 'success' : 'failed', code, profileName: args.profileName || null });
      appendDesktopLog(`Google sign-in ${code === 0 ? 'completed' : 'failed'} (code=${code}).`);
      if (code === 0) showNotification('Google connected', 'Your Google account is now linked.', 'success');
      return;
    }
    const completed = {
      runId,
      type,
      origin: currentOperation?.origin || args.origin || 'manual',
      sourceName: currentOperation?.sourceName || args.sourceName || null,
      code,
      signal,
      status: code === 0 ? 'success' : 'failed',
      completedAt: new Date().toISOString(),
      destPath: args.destPath || null,
      profileName: args.profileName || null,
    };
    currentOperation = null;
    // Written before the UI is told, so a refresh sees this run.
    await recordRun({
      type,
      status: completed.status,
      origin: completed.origin,
      sourceName: completed.sourceName,
      profileName: completed.profileName,
      destPath: completed.destPath,
      startedAt,
      completedAt: completed.completedAt,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      files: latestProgress?.fileCount ?? latestProgress?.filesDone ?? null,
      bytes: latestProgress?.newBytesStored ?? latestProgress?.processedBytes ?? null,
    });
    emit('operation:state', completed);
    const description = type === 'restore' ? 'Restore' : 'Backup';
    if (code === 0) {
      setTrayState('success', `${APP_NAME} — ${description} completed successfully`);
      const progressDetail = latestProgress?.newBytesStored !== undefined
        ? ` ${humanBytes(latestProgress.newBytesStored)} uploaded.`
        : '';
      showNotification(`${description} complete`, `Your ${description.toLowerCase()} finished successfully.${progressDetail}`, 'success');
    } else {
      setTrayState('failed', `${APP_NAME} — ${description} failed. Click for details.`);
      showNotification(`${description} failed`, 'Open Backup Genie to review the activity log.', 'failed');
    }
    appendDesktopLog(`${description} ${code === 0 ? 'completed' : 'failed'} (origin=${completed.origin}, code=${code}, signal=${signal || 'none'})`);
    latestProgress = null;
    scheduleTrayReset();
    if (pendingCatchUps.length) setTimeout(() => dispatchNextCatchUp(), 2000);
  });

  return { runId, type, pid: child.pid, startedAt };
}
// Past runs, so the app can show a history that outlives the log files.
const RUN_HISTORY_LIMIT = 500;

function runHistoryPath() {
  return path.join(configPathManager.dataDir, 'run-history.json');
}

async function readRunHistory() {
  const history = await fs.readJson(runHistoryPath()).catch(() => []);
  return Array.isArray(history) ? history : [];
}

async function recordRun(entry) {
  try {
    const history = await readRunHistory();
    history.push(entry);
    await fs.ensureDir(path.dirname(runHistoryPath()));
    await fs.writeJson(runHistoryPath(), history.slice(-RUN_HISTORY_LIMIT), { spaces: 2 });
  } catch (error) {
    appendDesktopLog(`Could not record run history: ${error.message}`);
  }
}

function safeStartOperation(type, args = {}) {
  try {
    return startChildOperation(type, args);
  } catch (error) {
    showNotification('Unable to start operation', error.message, 'failed');
    appendDesktopLog(`Unable to start ${type}: ${error.message}`);
    return null;
  }
}

async function readLogTail(limit = 250) {
  const dir = logsDirectory();
  if (!(await fs.pathExists(dir))) return [];
  const files = (await fs.readdir(dir))
    .filter((name) => /^tally-backup-.*\.log$/i.test(name))
    .map((name) => ({ name, path: path.join(dir, name) }));
  if (!files.length) return [];
  const withStats = await Promise.all(
    files.map(async (file) => ({ ...file, mtime: (await fs.stat(file.path)).mtimeMs }))
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  const content = await fs.readFile(withStats[0].path, 'utf8');
  return content.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(limit, 1000)));
}

async function listSnapshots(sourceName) {
  const config = await loadConfig();
  const source = config.backup.sources.find((item) => item.name === sourceName);
  if (!source) throw new Error(`Source not found: ${sourceName}`);
  const { backend, storageLabel } = await createSourceBackend(config, source);
  const snapshots = await new SnapshotStore(backend).list();
  return { storageLabel, snapshots: [...snapshots].reverse() };
}

async function listSnapshotsByProfile(profileName) {
  const config = await loadConfig();
  const profile = config.storageProfiles && config.storageProfiles[profileName];
  if (!profile) throw new Error(`Storage profile not found: ${profileName}`);
  const source = { storageProfile: profileName, backupFolderName: profile.rootFolderName || profileName };
  let driveService = null;
  if (profile.type === 'google_drive') {
    driveService = new GoogleDriveService(await googleConfigFor(config, profileName));
    await driveService.initialize();
  }
  const { backend, storageLabel } = await createBackend({ config, source, driveService });
  const snapshots = await new SnapshotStore(backend).list();
  return { storageLabel, snapshots: [...snapshots].reverse() };
}

async function testProfile(profileName) {
  const config = await loadConfig();
  const profile = config.storageProfiles && config.storageProfiles[profileName];
  if (!profile) throw new Error(`Storage profile not found: ${profileName}`);
  const source = { storageProfile: profileName, backupFolderName: profile.rootFolderName || profileName };
  let driveService = null;
  if (profile.type === 'google_drive') {
    driveService = new GoogleDriveService(await googleConfigFor(config, profileName));
    await driveService.initialize();
  }
  return testStorageProfile({ config, source, driveService });
}

function registerIpc() {
  ipcMain.handle('config:get', async () => ({ config: await loadConfigForRenderer(), path: configPath() }));
  ipcMain.handle('config:save', async (_event, config) => {
    const savedPath = await saveConfig(config);
    return {
      path: savedPath,
      scheduler: schedulerState,
      config: await loadConfigForRenderer(),
    };
  });
  ipcMain.handle('dialog:directory', async (_event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Choose a folder',
      defaultPath: options.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('operation:start', async (_event, request) => startChildOperation(request.type, request));
  ipcMain.handle('operation:cancel', async () => {
    if (!currentOperation) return false;
    currentOperation.child.kill('SIGTERM');
    return true;
  });
  ipcMain.handle('operation:status', async () =>
    currentOperation ? { ...currentOperation, child: undefined, status: 'running' } : null
  );
  ipcMain.handle('scheduler:status', async () => schedulerState);
  ipcMain.handle('snapshots:list', async (_event, sourceName) => listSnapshots(sourceName));
  ipcMain.handle('snapshots:list-by-profile', async (_event, profileName) => listSnapshotsByProfile(profileName));
  ipcMain.handle('repo:verify', async (_event, profileName) => {
    const config = await loadConfig();
    const profile = config.storageProfiles && config.storageProfiles[profileName];
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
      objectStore: await resolveObjectStore(backend, profile, { gzip: true }),
      snapshotStore: new SnapshotStore(backend),
      logger: { info: appendDesktopLog, warn: appendDesktopLog, error: appendDesktopLog },
    });
    const result = await engine.verify();
    appendDesktopLog(`Verify '${profileName}': ${result.ok ? 'OK' : `${result.missingChunks} missing chunk(s)`}.`);
    return { storageLabel, ...result };
  });
  ipcMain.handle('session:get', async () => {
    const config = await loadConfig();
    const serviceUrl = config.account?.controlPlaneUrl || config.email?.relay?.controlPlaneUrl || '';
    return { ...(await readSession()), serviceUrl, signInAvailable: !!serviceUrl };
  });
  ipcMain.handle('session:sign-out', async () => {
    appendDesktopLog('Signed out of Backup Genie account.');
    return clearSession();
  });
  ipcMain.handle('session:sign-in', async () => {
    const config = await loadConfig();
    const controlPlaneUrl = config.account?.controlPlaneUrl || config.email?.relay?.controlPlaneUrl;
    if (!controlPlaneUrl) throw new Error('No Backup Genie service address is configured, so sign-in is unavailable.');
    // Reuse the OAuth client that already has the loopback redirect registered.
    const credentials = await new GoogleDriveService(config.googleDrive || {}).loadCredentials();
    const { idToken } = await signInWithGoogle(credentials);
    const endpoint = `${controlPlaneUrl.replace(/\/$/, '')}/v1/auth/google`;
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken, device: await deviceIdentity(app.getVersion()) }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      // Google accepted the sign-in; our own service is what could not be reached.
      throw new Error(
        `Signed in with Google, but the Backup Genie service at ${controlPlaneUrl} could not be reached ` +
          `(${error.message}). Check your connection and try again. Your backups are unaffected.`
      );
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Sign-in failed.');
    appendDesktopLog(`Signed in as ${body.user?.email || 'unknown account'}.`);
    return saveSession({ token: body.token, user: body.user });
  });
  ipcMain.handle('session:sign-in-cancel', async () => cancelSignIn());
  ipcMain.handle('system:default-restore-dir', async (_event, label) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${label ? `${label} ` : ''}restore ${stamp}`.replace(/[\\/:*?"<>|]/g, '-');
    return path.join(app.getPath('downloads'), name);
  });
  ipcMain.handle('snapshots:detail', async (_event, profileName, snapshotId) => {
    const config = await loadConfig();
    const profile = config.storageProfiles && config.storageProfiles[profileName];
    if (!profile) throw new Error(`Storage profile not found: ${profileName}`);
    const source = { storageProfile: profileName, backupFolderName: profile.rootFolderName || profileName };
    let driveService = null;
    if (profile.type === 'google_drive') {
      driveService = new GoogleDriveService(await googleConfigFor(config, profileName));
      await driveService.initialize();
    }
    const { backend } = await createBackend({ config, source, driveService });
    const store = new SnapshotStore(backend);
    const snapshot = await store.read(await store.resolveId(snapshotId));
    return {
      id: snapshot.id,
      source: snapshot.source,
      createdAt: snapshot.createdAt,
      fileCount: snapshot.fileCount,
      totalBytes: snapshot.totalBytes,
      roots: snapshot.roots || [],
    };
  });
  ipcMain.handle('history:get', async () => (await readRunHistory()).slice().reverse());
  ipcMain.handle('storage:test', async (_event, profileName) => testProfile(profileName));
  ipcMain.handle('repo:accept', async (_event, profileName) => {
    const config = await loadConfig();
    const profile = config.storageProfiles && config.storageProfiles[profileName];
    if (!profile) throw new Error(`Storage profile not found: ${profileName}`);
    const source = { storageProfile: profileName, backupFolderName: profile.rootFolderName || profileName };
    let driveService = null;
    if (profile.type === 'google_drive') {
      driveService = new GoogleDriveService(await googleConfigFor(config, profileName));
      await driveService.initialize();
    }
    const { backend } = await createBackend({ config, source, driveService });
    const marker = await acceptRepository({
      backend,
      profileName,
      statePath: path.join(configPathManager.dataDir, 'repo-state.json'),
    });
    appendDesktopLog(`Accepted repository ${marker.id} for profile '${profileName}'.`);
    return { id: marker.id };
  });
  ipcMain.handle('storage:google-account', async (_event, profileName) => {
    try {
      const config = await loadConfig();
      if (!config.googleDrive) return null;
      const service = new GoogleDriveService(await googleConfigFor(config, profileName));
      await service.initialize();
      const about = await service.drive.about.get({
        fields: 'user(emailAddress,displayName),storageQuota(limit,usage)',
      });
      const data = about.data || {};
      return {
        email: data.user?.emailAddress || null,
        name: data.user?.displayName || null,
        quotaUsed: Number(data.storageQuota?.usage || 0),
        quotaLimit: Number(data.storageQuota?.limit || 0),
        ownAccount: await hasOwnAccount(config, profileName),
      };
    } catch (error) {
      return null;
    }
  });
  ipcMain.handle('logs:get', async (_event, limit) => readLogTail(limit));
  ipcMain.handle('email:test', async () => {
    const config = await loadConfig();
    if (!config.email || !config.email.enabled) throw new Error('Email is disabled in configuration.');
    const service = new EmailService(config.email);
    await service.initialize();
    await service.sendTestEmail();
    return true;
  });
  ipcMain.handle('system:open-path', async (_event, targetPath) => shell.openPath(targetPath));
  ipcMain.handle('update:status', async () => updateState);
  ipcMain.handle('update:check', async () => checkForUpdates());
  ipcMain.handle('update:install', async () => installUpdate());
  ipcMain.handle('system:info', async () => ({
    appName: APP_NAME,
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    configPath: configPath(),
    logsPath: logsDirectory(),
    dataPath: configPathManager.dataDir,
    autoStart: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false,
  }));
}

async function createWindow() {
  await ensureConfig();
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#071018',
    title: APP_NAME,
    icon: appIconImage(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (runtimeSettings.minimizeToTray === false) {
      isQuitting = true;
      app.quit();
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    if (!closeHintShown) {
      closeHintShown = true;
      showNotification(
        `${APP_NAME} is still running`,
        'Scheduled backups continue in the notification area. Click the tray icon to reopen.',
        'idle'
      );
    }
  });
  mainWindow.once('ready-to-show', () => {
    if (!START_HIDDEN) mainWindow.show();
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await mainWindow.loadURL(devUrl);
  else await mainWindow.loadFile(path.join(appRoot(), 'ui', 'dist', 'index.html'));
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    app.setName(APP_NAME);
    if (process.platform === 'win32') app.setAppUserModelId('in.backupgenie.app');
    createTray();
    await appendDesktopLog(
      `Desktop started (packaged=${app.isPackaged}, hidden=${START_HIDDEN}, appRoot=${appRoot()}).`
    );
    registerIpc();
    await createWindow();
    await configureSchedules(undefined, 'startup');
    // Sleep suspends cron timers and they do not fire retroactively, so the
    // schedules are rebuilt and checked for misses on every wake.
    powerMonitor.on('resume', () => {
      appendDesktopLog('System resumed from sleep; re-arming schedules.');
      configureSchedules(undefined, 'resume from sleep').catch((error) =>
        appendDesktopLog(`Failed to re-arm schedules after resume: ${error.message}`)
      );
    });
    powerMonitor.on('suspend', () => appendDesktopLog('System going to sleep; schedules paused until wake.'));
    powerMonitor.on('shutdown', () => appendDesktopLog('System shutting down.'));
    if (app.isPackaged) {
      configureAutoUpdater();
      setTimeout(() => checkForUpdates(), 8000);
      setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000).unref();
    }
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
      else showMainWindow();
    });
  });
}

app.on('window-all-closed', () => {
  // Tray residency keeps schedules and background operations alive.
});

app.on('second-instance', () => showMainWindow());

app.on('before-quit', () => {
  isQuitting = true;
  appendDesktopLog('Desktop shutting down; scheduled jobs will not run until it is reopened.');
  clearSchedules();
  if (currentOperation) currentOperation.child.kill('SIGTERM');
});
