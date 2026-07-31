const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Resolve the absolute path of a drag-and-dropped File.
   *
   * Electron 32 removed the non-standard `File.path` property; `webUtils.getPathForFile` is the
   * supported replacement. Without this, dropped documents had no path, so relative image
   * references in them could not be rewritten to the `fate-local://` protocol and silently failed
   * to load. Files opened via the dialog or file association were unaffected — they get their path
   * from the main process.
   */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
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
  setDiscordActivity: (activity) => ipcRenderer.send('set-discord-activity', activity),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  appReady: () => ipcRenderer.send('app-ready'),
  store: {
    get: (key) => ipcRenderer.invoke('store-get', key),
    set: (key, val) => ipcRenderer.invoke('store-set', key, val)
  },
  onUpdateMessage: (callback) => {
    ipcRenderer.removeAllListeners('update-message');
    ipcRenderer.on('update-message', (_event, message, action) => callback(message, action));
  }
});
