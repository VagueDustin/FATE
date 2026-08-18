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
  // `meta.fromRestore` marks a tab being reinstated from last session rather than one the user
  // just asked for, so restoring tabs cannot steal focus from the file that launched the app.
  onOpenFile: (callback) => {
    ipcRenderer.removeAllListeners('open-file');
    ipcRenderer.on('open-file', (_event, content, name, path, meta) => callback(content, name, path, meta || {}));
  },
  // The path rides along so the renderer can route the update to the right TAB — any number of
  // files can be watched at once since 1.10.0.
  onFileChanged: (callback) => {
    ipcRenderer.removeAllListeners('file-changed');
    ipcRenderer.on('file-changed', (_event, content, path) => callback(content, path));
  },
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  /** A tab closed — the main process stops watching its file. */
  closeFile: (filePath) => ipcRenderer.send('close-file', filePath),

  /**
   * Code-editor persistence.
   *
   * `saveFile` writes the buffer back to the path it was opened from; the main process remembers
   * the written content so its file watcher can tell our own save apart from an external edit
   * (otherwise every save would echo back as a "file changed on disk" event).
   *
   * `saveFileAs` opens a save dialog and, on success, retargets the watcher and recents to the new
   * path WITHOUT re-sending 'open-file' — the response carries { filePath, name } and the renderer
   * updates its own state, keeping cursor and scroll position intact.
   */
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  saveFileAs: (suggestedName, content, oldPath) =>
    ipcRenderer.invoke('save-file-as', suggestedName, content, oldPath),

  /**
   * Mirror the editor's dirty flag into the main process on every transition. This is what arms
   * the unsaved-changes guards on window close and on opening another file — the main process
   * cannot ask the renderer synchronously at decision time.
   */
  setEdited: (edited) => ipcRenderer.send('set-edited', edited),

  /** Native "discard unsaved changes?" dialog. Resolves true when the user chooses to discard. */
  confirmDiscard: (message) => ipcRenderer.invoke('confirm-discard', message),

  /**
   * Quitting with unsaved work. The main process cannot save (the buffers are in the renderer), so
   * it vetoes the close, fires `onRequestClose`, and waits: the renderer walks its dirty tabs
   * asking Save / Don't save / Cancel, then answers with `confirmedClose(proceed)`.
   */
  onRequestClose: (callback) => {
    ipcRenderer.removeAllListeners('request-close');
    ipcRenderer.on('request-close', () => callback());
  },
  confirmSaveOnClose: (docName) => ipcRenderer.invoke('confirm-save-on-close', docName),
  confirmedClose: (proceed) => ipcRenderer.send('confirmed-close', proceed),

  // Recent documents. `getRecentFiles` annotates each entry with `exists`, so the UI can grey out
  // files that have since been moved or deleted rather than silently dropping them.
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  openRecentFile: (filePath, opts) => ipcRenderer.invoke('open-recent-file', filePath, opts),
  clearRecentFiles: () => ipcRenderer.invoke('clear-recent-files'),

  /**
   * Printing and PDF export.
   *
   * NOT `window.print()`. Electron ships Chromium without the print-preview UI, so the Windows
   * print dialog shows "This app doesn't support print preview". Both of these instead render the
   * document through `printToPDF` (same `@media print` stylesheet) — `printPreview` opens the result
   * in a viewer window, `exportPdf` writes it wherever the user picks. What you preview is what
   * prints.
   *
   * Pass the open document's filename; it becomes the page header and the default export name.
   */
  printPreview: (docName) => ipcRenderer.invoke('print-preview', docName),
  exportPdf: (docName) => ipcRenderer.invoke('export-pdf', docName),

  // Windows default-app association for `.md`.
  // `getDefaultAppStatus()` resolves { supported, isDefault, currentProgId }; `supported` is false
  // off Windows so the renderer can hide the control instead of offering something that cannot work.
  getDefaultAppStatus: () => ipcRenderer.invoke('get-default-app-status'),
  requestDefaultApp: () => ipcRenderer.invoke('request-default-app'),
  /**
   * How many of FATE's supported file types currently open with FATE (Settings → Windows).
   * Resolved through the shell itself (AssocQueryString), not inferred from the registry, in one
   * hidden PowerShell pass. On demand only — too heavy for the on-focus `.md` check.
   */
  getAssociationCoverage: () => ipcRenderer.invoke('get-association-coverage'),
  /**
   * Undo the file-type damage older versions did: clear the class defaults that suppress the
   * association they were meant to create, and hand .bat/.cmd back to the command processor.
   * Runs automatically at launch too — this is the manual trigger in Settings.
   */
  repairAssociations: () => ipcRenderer.invoke('repair-associations'),
  /** Build facts: { windowsStore } — Store builds route updates to the Microsoft Store. */
  getRuntimeInfo: () => ipcRenderer.invoke('get-runtime-info'),
  /** Font families installed on this machine (local enumeration only; cached per run). */
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),
  /** Classic context menus (Windows 11 full-menu tweak): read, set, and apply via Explorer restart. */
  getClassicMenu: () => ipcRenderer.invoke('get-classic-menu'),
  setClassicMenu: (enabled) => ipcRenderer.invoke('set-classic-menu', enabled),
  restartExplorer: () => ipcRenderer.invoke('restart-explorer'),
  /**
   * Set the window title from the open document's name, or `null` on the home screen.
   * Pass a FILENAME, not a composed title — the main process prepends the app name so the taskbar
   * label always starts with "FATE - Markdown Viewer". `edited` appends the unsaved-changes dot.
   */
  setTitle: (docName, edited) => ipcRenderer.send('set-title', docName, edited),
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
