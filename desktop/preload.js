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
  testStorage: (profileName) => ipcRenderer.invoke('storage:test', profileName),
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
  onUpdateState: (callback) => subscribe('update:state', callback),
});
