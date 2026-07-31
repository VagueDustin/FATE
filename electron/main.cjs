const { app, BrowserWindow, ipcMain, shell, protocol, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { pathToFileURL } = require('url');
const DiscordRPC = require('discord-rpc');
const Store = require('electron-store');

/**
 * ProgId that electron-builder's NSIS installer actually registers for `.md`.
 *
 * This is taken from `build.fileAssociations[].name` in package.json — NOT from
 * `build.appx.applicationId` as previously assumed. Verified against a real install:
 *
 *     HKLM\SOFTWARE\Classes\.md                       (default) = "Markdown Document"
 *     HKLM\SOFTWARE\Classes\Markdown Document\shell\open\command
 *         = "C:\Program Files\FATE\FATE - Markdown Viewer\FATE - Markdown Viewer.exe" "%1"
 *
 * It is only a HINT here. Because "Markdown Document" is a generic name that another application
 * could plausibly claim, `getDefaultAppStatus()` does not trust it — it resolves the ProgId's open
 * command and checks that the command actually points at THIS executable. See below.
 */
const MD_PROG_ID_HINT = 'Markdown Document';

/** How many recent documents to remember. Eight fills the home-screen panel without scrolling. */
const MAX_RECENT_FILES = 8;

/**
 * The window title, and therefore the taskbar label.
 *
 * Windows takes the taskbar button's text from the window title and truncates it, so the app name
 * has to come FIRST — a title of "document.md — FATE" shows up in the taskbar as "document.md",
 * which is why the taskbar previously just read "FATE": the renderer was calling
 * `setTitle('FATE')` on close and `setTitle('FATE - <file>')` while reading.
 *
 * Composition now lives here rather than in the renderer so there is exactly one place that decides
 * what the window is called.
 */
const APP_TITLE = 'FATE - Markdown Viewer';

/** `docName` is a filename while a document is open, or null/undefined on the home screen. */
function composeTitle(docName) {
  return docName ? `${APP_TITLE} — ${docName}` : APP_TITLE;
}

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

/** Promise wrapper around `reg query`. Resolves the raw stdout, or null on any failure. */
function regQuery(args) {
  return new Promise((resolve) => {
    execFile('reg', ['query', ...args], { windowsHide: true }, (err, stdout) => {
      resolve(err || !stdout ? null : stdout);
    });
  });
}

/**
 * Read the ProgId Windows currently uses to open a given extension.
 *
 * ── The key that matters ──────────────────────────────────────────────────────────────────────
 * This reads:
 *     HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\<ext>\UserChoice
 *
 * NOT `HKCU\Software\Classes\<ext>\UserChoice`, which is where an earlier version of this function
 * looked. That key does not exist on Windows 10/11 — the result was that FATE reported "no app is
 * set for .md files yet" even when Windows Settings plainly showed FATE as the handler. The
 * FileExts location is the one Explorer actually consults and the one the Settings UI writes.
 *
 * Note the value is NOT quoted in `reg` output and the ProgId can contain spaces (ours is
 * "Markdown Document"), so the capture runs to end-of-line rather than to the first whitespace.
 *
 * Resolves null when there is no explicit user choice yet.
 */
async function readUserChoiceProgId(ext) {
  if (process.platform !== 'win32') return null;
  const stdout = await regQuery([
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}\\UserChoice`,
    '/v',
    'ProgId'
  ]);
  if (!stdout) return null;
  // "    ProgId    REG_SZ    Markdown Document"
  const match = stdout.match(/ProgId\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/im);
  return match ? match[1].trim() : null;
}

/**
 * Resolve a ProgId to the command line Windows would run for it.
 * Checks HKCU first (per-user registrations win), then HKLM.
 */
async function readProgIdCommand(progId) {
  for (const root of ['HKCU\\Software\\Classes', 'HKLM\\SOFTWARE\\Classes']) {
    const stdout = await regQuery([`${root}\\${progId}\\shell\\open\\command`, '/ve']);
    if (stdout) {
      const match = stdout.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/im);
      if (match) return match[1].trim();
    }
  }
  return null;
}

/**
 * Is FATE the current handler for `.md`?
 *
 * Deliberately does NOT just compare the ProgId string against a constant. Our ProgId is the
 * generic "Markdown Document", which another application could plausibly register — a name match
 * alone would report a false positive. Instead the ProgId is resolved to its open command and that
 * command is checked against this process's own executable. That answers the real question
 * ("would double-clicking a .md file launch *me*?") rather than a proxy for it.
 *
 * In development `process.execPath` is electron.exe, so the comparison falls back to the ProgId
 * hint — there is no packaged exe to match against yet.
 *
 * Returns `{ supported, isDefault, currentProgId, currentCommand }`. `supported: false` off Windows
 * so the renderer hides the control rather than offering something that cannot work.
 */
async function getDefaultAppStatus() {
  if (process.platform !== 'win32') {
    return { supported: false, isDefault: false, currentProgId: null, currentCommand: null };
  }

  const progId = await readUserChoiceProgId('.md');
  if (!progId) {
    return { supported: true, isDefault: false, currentProgId: null, currentCommand: null };
  }

  const command = await readProgIdCommand(progId);
  let isDefault = false;

  if (command) {
    const ourExe = path.basename(process.execPath).toLowerCase();
    const cmd = command.toLowerCase();
    isDefault = isDev
      // Dev builds run through electron.exe, so matching on the exe name is meaningless here.
      ? progId === MD_PROG_ID_HINT
      // Match on the full path when we can, falling back to the executable name. Both are checked
      // because a per-user install and a per-machine install have different directories but the
      // same exe name.
      : cmd.includes(process.execPath.toLowerCase()) || cmd.includes(ourExe);
  } else {
    // ProgId exists but has no open command registered — fall back to the name.
    isDefault = progId === MD_PROG_ID_HINT;
  }

  return { supported: true, isDefault, currentProgId: progId, currentCommand: command };
}

/**
 * Ask Windows to let the user make FATE the `.md` handler.
 *
 * ── Why this is not just a registry write ─────────────────────────────────────────────────────
 * Since Windows 10 the `UserChoice` key carries a per-user hash (visible in the registry as a
 * `Hash` value beside `ProgId`). Windows validates it, and any application that writes the key
 * itself is detected and reset — deliberately, so apps cannot silently hijack a file type. The
 * final confirmation has to come from the user through a Windows-owned UI.
 *
 * ── Why the shell dialog, not the Settings page ───────────────────────────────────────────────
 * `ms-settings:defaultapps?registeredAppUser=<name>` only jumps to a specific app's page when that
 * app has an entry under HKLM\SOFTWARE\RegisteredApplications. electron-builder does not create
 * one, so the parameter was being ignored and the user landed on the generic Default apps list and
 * had to search ".md" by hand.
 *
 * `rundll32 shell32.dll,OpenAs_RunDLL <file>` opens the shell's own "How do you want to open this
 * file?" dialog, which includes the "Always use this app to open .md files" checkbox — one dialog,
 * one checkbox, done. It needs a concrete file to act on, so it uses the currently-open document
 * when there is one and otherwise writes a tiny scratch file to temp.
 *
 * The Settings page remains the fallback for any environment where the shell dialog will not open.
 */
async function requestDefaultAppAssociation() {
  if (process.platform !== 'win32') return { ok: false, error: 'windows only' };

  // Prefer a real document the user already has open; fall back to a scratch file.
  let target = currentOpenedFilePath && /\.(md|markdown)$/i.test(currentOpenedFilePath)
    ? currentOpenedFilePath
    : null;

  if (!target || !fs.existsSync(target)) {
    try {
      target = path.join(app.getPath('temp'), 'Set FATE as default.md');
      fs.writeFileSync(
        target,
        '# FATE is now your Markdown viewer\n\n' +
          'If you ticked **"Always use this app to open .md files"**, you are all set — ' +
          'double-clicking any `.md` file will open it here.\n\n' +
          '_This scratch file was created only to give Windows something to ask about. ' +
          'You can delete it._\n',
        'utf-8'
      );
    } catch (err) {
      target = null;
    }
  }

  if (target) {
    const opened = await new Promise((resolve) => {
      execFile(
        'rundll32.exe',
        ['shell32.dll,OpenAs_RunDLL', target],
        { windowsHide: true },
        (err) => resolve(!err)
      );
    });
    if (opened) return { ok: true, via: 'shell-dialog' };
  }

  // Fallback: the Default apps page. The user has to search for ".md" themselves there.
  try {
    await shell.openExternal('ms-settings:defaultapps');
    return { ok: true, via: 'settings' };
  } catch (err) {
    return { ok: false, error: err.message };
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
    title: APP_TITLE,
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
  
  /**
   * The renderer sends the open document's filename (or null on the home screen) — never a full
   * title string. Composition is owned by composeTitle() so the app name always leads and the
   * taskbar label can never regress to a bare "FATE".
   */
  ipcMain.on('set-title', (event, docName) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.setTitle(composeTitle(docName));
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
  ipcMain.handle('request-default-app', () => requestDefaultAppAssociation());

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
