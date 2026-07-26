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
const { createBackend, testStorageProfile } = require('../src/versioning/backends');
const { PROGRESS_PREFIX } = require('../src/utils/cliProgress');
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

const START_HIDDEN = process.argv.includes('--hidden');
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
  for (const source of config.backup.sources) {
    if (!source.name || !source.operation || !source.sourcePath) {
      throw new Error('Every source requires name, operation, and sourcePath.');
    }
    if (!['backup', 'restore'].includes(source.operation)) {
      throw new Error(`Unsupported source operation: ${source.operation}`);
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
  return sanitizeConfigForRenderer(await loadConfig());
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

function createStatusImage(state = 'idle') {
  const styles = {
    idle: { color: '#2fcf91', label: 'V' },
    running: { color: '#4d9fff', label: '↻' },
    success: { color: '#2fcf91', label: '✓' },
    failed: { color: '#ff6675', label: '!' },
    paused: { color: '#f0b956', label: 'Ⅱ' },
  };
  const style = styles[state] || styles.idle;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect x="2" y="2" width="28" height="28" rx="9" fill="#071018" stroke="${style.color}" stroke-width="2"/>
    <circle cx="16" cy="16" r="9" fill="${style.color}"/>
    <text x="16" y="20" text-anchor="middle" font-family="Segoe UI,Arial" font-size="12" font-weight="700" fill="#071018">${escapeXml(style.label)}</text>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 20, height: 20 });
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
    app.setLoginItemSettings({
      openAtLogin: runtimeSettings.autoStart !== false,
      path: process.execPath,
      args: ['--hidden'],
    });
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

async function configureSchedules(config) {
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
  if (enabledBackups.length > 0 && config.backup?.schedule) {
    const expression = config.backup.schedule;
    const timezone = config.backup.timezone || 'Asia/Kolkata';
    if (cron.validate(expression)) {
      const task = cron.createTask(
        expression,
        () => dispatchScheduled('backup'),
        { timezone }
      );
      task.start();
      schedulerJobs.push({ label: 'Daily backup', expression, timezone, task });
    } else {
      errors.push(`Invalid backup schedule: ${expression}`);
    }
  }

  const restores = (config.backup?.sources || []).filter((source) => {
    return source.operation === 'restore' && source.enabled !== false &&
      source.restore?.mode === 'scheduled' && source.restore?.schedule;
  });
  for (const source of restores) {
    const expression = source.restore.schedule;
    const timezone = source.restore.timezone || 'Asia/Kolkata';
    if (!cron.validate(expression)) {
      errors.push(`Invalid restore schedule for ${source.name}: ${expression}`);
      continue;
    }
    const task = cron.createTask(
      expression,
      () => dispatchScheduled('restore', {
        sourceName: source.name,
        snapshotId: source.restore.snapshotId || 'latest',
        destPath: source.sourcePath,
      }),
      { timezone }
    );
    task.start();
    schedulerJobs.push({ label: `Restore: ${source.name}`, expression, timezone, task });
  }

  for (const error of errors) appendDesktopLog(error);
  publishSchedulerState(errors);
  await appendDesktopLog(
    `Registered ${schedulerJobs.length} schedule(s)${errors.length ? ` with ${errors.length} error(s)` : ''}.`
  );
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
    driveService = new GoogleDriveService(config.googleDrive);
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
  if (currentOperation) throw new Error('Another backup or restore operation is already running.');

  let script;
  const scriptArgs = ['--config', configPath()];
  if (type === 'backup') {
    script = path.join(appRoot(), 'bin', 'versioned-backup.js');
  } else if (type === 'restore') {
    script = path.join(appRoot(), 'bin', 'versioned-restore.js');
    if (!args.sourceName) throw new Error('Choose a restore source.');
    scriptArgs.push('--source', args.sourceName);
    if (args.snapshotId) scriptArgs.push('--snapshot', args.snapshotId);
    if (args.destPath) scriptArgs.push('--dest', args.destPath);
  } else if (type === 'auth-google') {
    script = path.join(appRoot(), 'tools', 'auth.js');
    scriptArgs.length = 0;
    scriptArgs.push('--config', configPath());
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

  currentOperation = {
    runId,
    type,
    origin: args.origin || 'manual',
    sourceName: args.sourceName || null,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    child,
  };
  latestProgress = null;
  setTrayState('running', `${APP_NAME} — ${type === 'restore' ? 'Restoring…' : type === 'backup' ? 'Backing up…' : 'Connecting…'}`);
  emit('operation:state', { ...currentOperation, child: undefined, status: 'running' });
  consumeOutput(child.stdout, runId, 'stdout');
  consumeOutput(child.stderr, runId, 'stderr');

  child.on('error', (error) => {
    emit('operation:log', { runId, stream: 'stderr', line: error.message });
    appendDesktopLog(`${type} process error: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    const completed = {
      runId,
      type,
      origin: currentOperation?.origin || args.origin || 'manual',
      sourceName: currentOperation?.sourceName || args.sourceName || null,
      code,
      signal,
      status: code === 0 ? 'success' : 'failed',
      completedAt: new Date().toISOString(),
    };
    currentOperation = null;
    emit('operation:state', completed);
    const description = type === 'restore' ? 'Restore' : type === 'backup' ? 'Backup' : 'Connection';
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
  });

  return { runId, type, pid: child.pid, startedAt: currentOperation.startedAt };
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

async function testProfile(profileName) {
  const config = await loadConfig();
  const profile = config.storageProfiles && config.storageProfiles[profileName];
  if (!profile) throw new Error(`Storage profile not found: ${profileName}`);
  const source = { storageProfile: profileName, backupFolderName: profile.rootFolderName || profileName };
  let driveService = null;
  if (profile.type === 'google_drive') {
    driveService = new GoogleDriveService(config.googleDrive);
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
  ipcMain.handle('storage:test', async (_event, profileName) => testProfile(profileName));
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
    await configureSchedules();
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
  clearSchedules();
  if (currentOperation) currentOperation.child.kill('SIGTERM');
});
