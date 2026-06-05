const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (callback) => ipcRenderer.on('open-file', (_event, content, name) => callback(content, name)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateMessage: (callback) => {
    ipcRenderer.removeAllListeners('update-message');
    ipcRenderer.on('update-message', (_event, message, action) => callback(message, action));
  }
});
