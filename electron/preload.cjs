const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (callback) => {
    ipcRenderer.removeAllListeners('open-file');
    ipcRenderer.on('open-file', (_event, content, name, path) => callback(content, name, path));
  },
  onFileChanged: (callback) => {
    ipcRenderer.removeAllListeners('file-changed');
    ipcRenderer.on('file-changed', (_event, content) => callback(content));
  },
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  setTitle: (title) => ipcRenderer.send('set-title', title),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  appReady: () => ipcRenderer.send('app-ready'),
  onUpdateMessage: (callback) => {
    ipcRenderer.removeAllListeners('update-message');
    ipcRenderer.on('update-message', (_event, message, action) => callback(message, action));
  }
});
