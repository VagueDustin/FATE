const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const isDev = process.env.NODE_ENV === 'development';

// Disable hardware acceleration to prevent Discord from thinking this is a game
app.disableHardwareAcceleration();

let mainWindow;

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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    handleArgs(process.argv);
  });
}

function handleArgs(argv) {
  if (argv.length >= 2) {
    // In production, the file path is usually the last argument when opening from explorer
    const filePath = argv.find(arg => arg.endsWith('.md'));
    if (filePath && fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const name = path.basename(filePath);
        if (mainWindow) {
          mainWindow.webContents.send('open-file', content, name);
        }
      } catch (e) {
        console.error('Error reading file:', e);
      }
    }
  }
}

app.whenReady().then(() => {
  createWindow();
  
  ipcMain.handle('get-app-version', () => app.getVersion());
  
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

// Handle second instance
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
