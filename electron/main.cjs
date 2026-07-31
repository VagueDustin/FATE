const { app, BrowserWindow, ipcMain, shell, protocol, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { pathToFileURL } = require('url');
const DiscordRPC = require('discord-rpc');
const Store = require('electron-store');

/**
 * ProgId registered for `.md` / `.markdown` by the NSIS installer.
 *
 * electron-builder derives this from `build.appx.applicationId` + the extension, and
 * `build/installer.nsh` deletes exactly these keys when the user declines the association during
 * install. If either of those changes, this constant has to change with them or the
 * "is FATE the default?" check silently reports false forever.
 */
const MD_PROG_ID = 'FATEMarkdownViewer.md';

/** How many recent documents to remember. Eight fills the home-screen panel without scrolling. */
const MAX_RECENT_FILES = 8;

const store = new Store({
  defaults: {
    // 'fate' = VagueDustin Enterprises navy & gold (utility tier), the default since 1.5.0.
    // Installs carrying the pre-1.5.0 'dark' value are migrated to 'fate' in the renderer — see
    // resolveTheme() in src/App.jsx. 'dark' no longer has a token block, so it must not survive.
    theme: 'fate',
    discordEnabled: false,
    autoUpdatesEnabled: true,
    sidebarWidth: 300,
    shortcuts: {
      openFile: 'Control+O',
      print: 'Control+P',
      close: 'Escape'
    },
    recentFiles: []
  }
});

/* ════════════════════════════════════════════════════════════════════════════════════════════
   RECENT DOCUMENTS
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Record a document in the recents list: newest first, de-duplicated by path, capped.
 * Stores only the path and a timestamp — the display name and existence check are derived on read,
 * so a moved or renamed file cannot leave a stale name behind in the store.
 */
function rememberRecentFile(filePath) {
  const existing = store.get('recentFiles') || [];
  const normalized = path.normalize(filePath);
  const deduped = existing.filter(
    (entry) => path.normalize(entry.path || '').toLowerCase() !== normalized.toLowerCase()
  );
  deduped.unshift({ path: normalized, openedAt: Date.now() });
  store.set('recentFiles', deduped.slice(0, MAX_RECENT_FILES));
}

/**
 * Read the recents list, annotating each entry with its display name and whether it still exists.
 * Missing files are returned rather than filtered out so the UI can show them greyed with a reason
 * — silently dropping an entry looks like the app forgot the file.
 */
function readRecentFiles() {
  const entries = store.get('recentFiles') || [];
  return entries.map((entry) => ({
    path: entry.path,
    name: path.basename(entry.path),
    dir: path.dirname(entry.path),
    openedAt: entry.openedAt,
    exists: fs.existsSync(entry.path)
  }));
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   DEFAULT-APP ASSOCIATION (Windows)
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Read the ProgId Windows currently uses to open a given extension.
 *
 * Reads HKCU\Software\Classes\<ext>\UserChoice. That key is the authoritative answer — it is what
 * Explorer actually consults, and it takes precedence over the machine-wide association the
 * installer writes.
 *
 * Resolves `null` when the key is absent (no explicit user choice yet) or unreadable.
 */
function readUserChoiceProgId(ext) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile(
      'reg',
      ['query', `HKCU\\Software\\Classes\\${ext}\\UserChoice`, '/v', 'ProgId'],
      { windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        // Output looks like:  "    ProgId    REG_SZ    FATEMarkdownViewer.md"
        const match = stdout.match(/ProgId\s+REG_SZ\s+(\S+)/i);
        resolve(match ? match[1] : null);
      }
    );
  });
}

/**
 * Is FATE the current handler for `.md`?
 *
 * Returns `{ supported, isDefault, currentProgId }`. `supported: false` on non-Windows so the
 * renderer can hide the control entirely rather than showing something that cannot work.
 */
async function getDefaultAppStatus() {
  if (process.platform !== 'win32') {
    return { supported: false, isDefault: false, currentProgId: null };
  }
  const progId = await readUserChoiceProgId('.md');
  return {
    supported: true,
    isDefault: progId === MD_PROG_ID,
    currentProgId: progId
  };
}

/**
 * Open the Windows "Default apps" page for FATE.
 *
 * There is deliberately no attempt to write the association directly. Since Windows 10, the
 * `UserChoice` key is protected by a per-user hash and any app that writes it is detected and reset
 * — by design, so applications cannot silently hijack file types. Deep-linking into Settings and
 * letting the user confirm is the only supported path, so the UI says so plainly instead of
 * pretending the button did it.
 *
 * The `registeredAppUser` parameter jumps straight to FATE's own page on Windows 11; older builds
 * ignore the parameter and land on the Default apps list, which is still the right place.
 */
async function openDefaultAppsSettings() {
  const appName = encodeURIComponent('FATE - Markdown Viewer');
  try {
    await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${appName}`);
    return { ok: true };
  } catch {
    try {
      await shell.openExternal('ms-settings:defaultapps');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

const discordClientId = '1513749770005381233';
DiscordRPC.register(discordClientId);

const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let rpcReady = false;
const sessionStartTimestamp = new Date();

rpc.on('ready', () => {
  rpcReady = true;
  setDiscordActivity();
});

let currentActivity = {};

function setDiscordActivity(activity) {
  if (activity) currentActivity = activity;
  if (!rpcReady) return;
  
  const showFilename = store.get('discordEnabled');
  
  rpc.setActivity({
    details: currentActivity.details || 'Idling on the home screen',
    state: showFilename ? (currentActivity.state || 'Exploring Markdown') : undefined,
    startTimestamp: sessionStartTimestamp,
    largeImageKey: 'fate-logo',
    largeImageText: 'FATE',
    instance: false,
  }).catch(console.error);
}

rpc.login({ clientId: discordClientId }).catch(console.error);
protocol.registerSchemesAsPrivileged([
  { scheme: 'fate-local', privileges: { bypassCSP: true, supportFetchAPI: true, secure: true, standard: true, stream: true } }
]);

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let currentFileWatcher = null;
let currentOpenedFilePath = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Below roughly this size the two-column home layout has nowhere left to go and the viewer
    // header starts colliding with itself. The layout is responsive down to here and no further,
    // so the window simply refuses to get smaller rather than degrading into overlap.
    minWidth: 680,
    minHeight: 520,
    title: 'FATE - Markdown Viewer',
    backgroundColor: '#070b1a', // avoids a white flash before the renderer paints
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  // SECURITY: Prevent inner navigation and force external links to open in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', async (event, url) => {
    if (!url.startsWith('http://localhost:5173') && !url.startsWith('file://') && !url.startsWith('devtools://')) {
      event.preventDefault();
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Open Browser'],
        defaultId: 1,
        cancelId: 0,
        title: 'External Link',
        message: `You are about to open an external link:\n${url}\n\nDo you want to continue?`
      });
      if (response === 1) {
        shell.openExternal(url);
      }
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  ipcMain.once('app-ready', () => {
    handleArgs(process.argv);
  });
}

function openAndWatchFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const name = path.basename(filePath);
    currentOpenedFilePath = filePath;
    rememberRecentFile(filePath);

    if (mainWindow) {
      mainWindow.webContents.send('open-file', content, name, filePath);
    }

    // Setup file watcher for live reload
    if (currentFileWatcher) {
      currentFileWatcher.close();
    }
    
    currentFileWatcher = fs.watch(filePath, (eventType) => {
      if (eventType === 'change') {
        try {
          const updatedContent = fs.readFileSync(filePath, 'utf-8');
          if (mainWindow) {
            mainWindow.webContents.send('file-changed', updatedContent);
          }
        } catch (err) {
          console.error("Error reading updated file:", err);
        }
      }
    });

  } catch (e) {
    console.error('Error reading file:', e);
  }
}

function handleArgs(argv) {
  if (argv.length >= 2) {
    const filePath = argv.find(arg => arg.endsWith('.md'));
    if (filePath) {
      openAndWatchFile(filePath);
    }
  }
}

app.whenReady().then(() => {
  // Register custom protocol for local images
  protocol.handle('fate-local', (request) => {
    let urlPath = request.url.replace(/^fate-local:\/\//, '');
    if (process.platform === 'win32' && urlPath.startsWith('/')) {
      urlPath = urlPath.slice(1);
    }
    urlPath = decodeURIComponent(urlPath);
    return net.fetch(pathToFileURL(urlPath).toString());
  });

  createWindow();
  
  ipcMain.handle('get-app-version', () => app.getVersion());
  
  ipcMain.on('set-title', (event, title) => {
    const webContents = event.sender;
    const win = BrowserWindow.fromWebContents(webContents);
    if (win) win.setTitle(title);
  });

  ipcMain.on('set-discord-activity', (event, activity) => {
    setDiscordActivity(activity);
  });

  ipcMain.handle('store-get', (event, key) => store.get(key));
  ipcMain.handle('store-set', (event, key, val) => {
    store.set(key, val);
    if (key === 'discordEnabled') {
      setDiscordActivity();
    }
  });

  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      openAndWatchFile(filePath);
    }
  });
  
  // ── Recent documents ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('get-recent-files', () => readRecentFiles());

  ipcMain.handle('open-recent-file', (event, filePath) => {
    // Re-check existence here rather than trusting the renderer's cached `exists` flag; the file
    // may have been deleted since the list was rendered.
    if (!filePath || !fs.existsSync(filePath)) {
      // Drop the dead entry so the list self-heals instead of offering it again.
      const remaining = (store.get('recentFiles') || []).filter(
        (e) => path.normalize(e.path || '').toLowerCase() !== path.normalize(filePath || '').toLowerCase()
      );
      store.set('recentFiles', remaining);
      return { ok: false, reason: 'missing' };
    }
    openAndWatchFile(filePath);
    return { ok: true };
  });

  ipcMain.handle('clear-recent-files', () => {
    store.set('recentFiles', []);
    return { ok: true };
  });

  // ── Default-app association ───────────────────────────────────────────────────────────────
  ipcMain.handle('get-default-app-status', () => getDefaultAppStatus());
  ipcMain.handle('open-default-apps-settings', () => openDefaultAppsSettings());

  ipcMain.handle('check-for-updates', () => {
    if (!isDev && store.get('autoUpdatesEnabled')) {
      autoUpdater.checkForUpdates();
    }
  });

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on('checking-for-update', () => {
    if(mainWindow) mainWindow.webContents.send('update-message', 'Checking for updates...', null);
  });
  
  autoUpdater.on('update-available', (info) => {
    if(mainWindow) mainWindow.webContents.send('update-message', `Update v${info.version} available! Downloading...`, null);
  });
  
  autoUpdater.on('update-not-available', () => {
    if(mainWindow) mainWindow.webContents.send('update-message', 'You are on the latest version.', null);
  });
  
  autoUpdater.on('error', (err) => {
    if(mainWindow) mainWindow.webContents.send('update-message', `Error checking for updates: ${err.message}`, null);
  });
  
  autoUpdater.on('update-downloaded', () => {
    if(mainWindow) mainWindow.webContents.send('update-message', 'Update downloaded! Ready to install.', 'install');
  });

  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      handleArgs(commandLine)
    }
  })
}
