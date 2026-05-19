/**
 * Preload script — secure bridge between Electron main and renderer
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('remoteforge', {
  // Auth
  signIn: (email, password) => ipcRenderer.invoke('sign-in', email, password),
  signInWithGoogle: () => ipcRenderer.invoke('sign-in-google'),

  // Agent controls
  getStatus: () => ipcRenderer.invoke('get-status'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  startAgent: () => ipcRenderer.invoke('start-agent'),
  stopAgent: () => ipcRenderer.invoke('stop-agent'),
  restartAgent: () => ipcRenderer.invoke('restart-agent'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  
  // Live events
  onLog: (callback) => {
    ipcRenderer.on('log', (_, log) => callback(log));
  },
  onStatus: (callback) => {
    ipcRenderer.on('status', (_, status) => callback(status));
  },
  onCommand: (callback) => {
    ipcRenderer.on('command', (_, cmd) => callback(cmd));
  },
});
