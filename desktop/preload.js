'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('tallyDesktop', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  chooseDirectory: (options) => ipcRenderer.invoke('dialog:directory', options),
  startOperation: (request) => ipcRenderer.invoke('operation:start', request),
  cancelOperation: () => ipcRenderer.invoke('operation:cancel'),
  getOperationStatus: () => ipcRenderer.invoke('operation:status'),
  getSchedulerStatus: () => ipcRenderer.invoke('scheduler:status'),
  listSnapshots: (sourceName) => ipcRenderer.invoke('snapshots:list', sourceName),
  listSnapshotsByProfile: (profileName) => ipcRenderer.invoke('snapshots:list-by-profile', profileName),
  getSnapshotDetail: (profileName, snapshotId) => ipcRenderer.invoke('snapshots:detail', profileName, snapshotId),
  testStorage: (profileName) => ipcRenderer.invoke('storage:test', profileName),
  acceptRepository: (profileName) => ipcRenderer.invoke('repo:accept', profileName),
  verifyRepository: (profileName) => ipcRenderer.invoke('repo:verify', profileName),
  getSession: () => ipcRenderer.invoke('session:get'),
  getRunHistory: () => ipcRenderer.invoke('history:get'),
  getDefaultRestoreDir: (label) => ipcRenderer.invoke('system:default-restore-dir', label),
  signIn: () => ipcRenderer.invoke('session:sign-in'),
  cancelSignIn: () => ipcRenderer.invoke('session:sign-in-cancel'),
  signOut: () => ipcRenderer.invoke('session:sign-out'),
  getGoogleAccount: (profileName) => ipcRenderer.invoke('storage:google-account', profileName),
  getLogs: (limit) => ipcRenderer.invoke('logs:get', limit),
  testEmail: () => ipcRenderer.invoke('email:test'),
  openPath: (targetPath) => ipcRenderer.invoke('system:open-path', targetPath),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onProgress: (callback) => subscribe('operation:progress', callback),
  onOperationLog: (callback) => subscribe('operation:log', callback),
  onOperationState: (callback) => subscribe('operation:state', callback),
  onSchedulerState: (callback) => subscribe('scheduler:state', callback),
  onAuthState: (callback) => subscribe('auth:state', callback),
  onRepoConflict: (callback) => subscribe('repo:conflict', callback),
  onBackupWarning: (callback) => subscribe('backup:warning', callback),
  onUpdateState: (callback) => subscribe('update:state', callback),
});
