const { app, BrowserWindow, ipcMain, shell, protocol, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { pathToFileURL } = require('url');
const DiscordRPC = require('discord-rpc');

const discordClientId = '1513749770005381233';
DiscordRPC.register(discordClientId);

const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let rpcReady = false;
const sessionStartTimestamp = new Date();

rpc.on('ready', () => {
  rpcReady = true;
  setDiscordActivity();
});

function setDiscordActivity(activity = {}) {
  if (!rpcReady) return;
  rpc.setActivity({
    details: activity.details || 'Idling on the home screen',
    state: activity.state || 'Exploring Markdown',
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
  
  ipcMain.handle('check-for-updates', () => {
    if (!isDev) {
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
