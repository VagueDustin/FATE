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
    autoUpdatesEnabled: true,
    sidebarWidth: 300,
    shortcuts: {
      openFile: 'Control+O',
      print: 'Control+P',
      close: 'Escape'
    },
    recentFiles: [],
    // Page setup for print preview and PDF export. 'Letter' rather than 'A4' because the app is
    // Windows-only and US Letter is the more common default there; both are offered in Settings.
    printPageSize: 'Letter',
    printLandscape: false
  }
});

/*
 * Drop settings that no longer exist, so an upgraded install doesn't carry dead keys forever.
 *
 * `discordEnabled` backed the "Show filename on Discord" toggle, removed in 1.8.0. Deleting it here
 * rather than leaving it means the on-disk config matches what the app actually reads.
 */
for (const staleKey of ['discordEnabled']) {
  if (store.has(staleKey)) store.delete(staleKey);
}

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
  }
  // No resolvable command => NOT default, regardless of what the ProgId is called.
  //
  // This used to fall back to `progId === MD_PROG_ID_HINT`, and that fallback was wrong in exactly
  // the case that matters. A broken install could leave UserChoice still naming "Markdown Document"
  // while the ProgId's command key had been deleted — so Windows fell back to another handler, but
  // FATE cheerfully reported "FATE currently opens .md files". A ProgId with nothing to run is not
  // a default; if the command cannot be resolved, the honest answer is no.

  return { supported: true, isDefault, currentProgId: progId, currentCommand: command };
}

/**
 * Open the Windows UI where the user can review or change the `.md` handler.
 *
 * ── Why this is not just a registry write ─────────────────────────────────────────────────────
 * Since Windows 10 the `UserChoice` key carries a per-user hash (visible in the registry as a
 * `Hash` value beside `ProgId`). Windows validates it, and any application that writes the key
 * itself is detected and reset — deliberately, so apps cannot silently hijack a file type. The
 * final confirmation has to come from a Windows-owned UI.
 *
 * ── Why NOT `rundll32 shell32.dll,OpenAs_RunDLL` ──────────────────────────────────────────────
 * 1.8.0 and 1.8.1 shelled out to that, on the theory that its "How do you want to open this file?"
 * dialog carries an "Always use this app" checkbox. On Windows 11 it does not — the only button is
 * **"Just once"**, so it can never actually set a default there. It merely looked like it worked.
 *
 * Worse, it is not even reliable as a picker: Windows suppresses the dialog entirely once the
 * extension has a confirmed `UserChoice`. So the moment FATE genuinely became the default, the
 * button silently did nothing at all — invoked correctly, valid file, rundll32 present, no dialog.
 * A control whose behaviour inverts once it succeeds is the wrong control.
 *
 * ── What this does instead ────────────────────────────────────────────────────────────────────
 * Deep-links into Settings, which always opens something and is the only surface that can actually
 * change a default on Windows 11. `registeredAppUser` jumps straight to FATE's own page — that works
 * because the installer now registers FATE under HKLM\SOFTWARE\RegisteredApplications with a
 * Capabilities key (see build/installer.nsh). Without that registration Windows ignores the
 * parameter, which is why earlier versions dumped the user on the full alphabetical list; the plain
 * page is kept as the fallback for exactly that case.
 */
async function requestDefaultAppAssociation() {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };

  const candidates = [
    // FATE's own page in Default apps, where `.md` can be reassigned in one click.
    `ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(APP_TITLE)}`,
    // Fallback: the Default apps list. The user searches ".md" themselves.
    'ms-settings:defaultapps'
  ];

  for (const uri of candidates) {
    try {
      await shell.openExternal(uri);
      return { ok: true, via: uri.includes('?') ? 'app-page' : 'settings-list' };
    } catch {
      /* try the next one */
    }
  }

  // Never fail silently — the renderer surfaces this in the status bar.
  return { ok: false, error: 'Could not open Windows Settings' };
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   PRINTING & PDF EXPORT
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ── Why printing was rebuilt in 1.8.0 ─────────────────────────────────────────────────────────
 * The renderer used to call `window.print()`, which hands off to the Windows print dialog. That
 * dialog renders "This app doesn't support print preview", because Electron ships Chromium *without*
 * the print-preview UI — there is no flag that turns it on. So the user got a printer picker and no
 * idea what would come out.
 *
 * The fix is to stop asking the OS to preview an app window and instead produce the artifact we
 * actually want: `webContents.printToPDF()` renders the document through the `@media print`
 * stylesheet into a real PDF. That PDF can then be
 *   - shown in a preview window (Chromium's built-in PDF viewer, which has genuine page-by-page
 *     preview, zoom, and its own print button), or
 *   - saved straight to disk as an export.
 *
 * Same renderer, same print CSS, both paths — so what you preview is what you get.
 */

/** Page geometry. Margins are in inches, which is what Electron's printToPDF expects. */
const PDF_MARGINS = { top: 0.6, bottom: 0.6, left: 0.65, right: 0.65 };

/**
 * Header and footer for exported/printed pages.
 *
 * Chromium substitutes the `title`, `pageNumber`, `totalPages`, `date` and `url` classes. The
 * templates are deliberately plain and grey — this is page furniture, not a brand surface, and it
 * has to survive being printed in black and white on someone else's printer.
 *
 * The inline font-size is required: Chromium renders these templates at a default of ~1px otherwise.
 */
function headerTemplate(docName) {
  const safe = String(docName || '').replace(/[<>&]/g, '');
  return `<div style="font-family:Georgia,serif;font-size:8px;color:#666;width:100%;padding:0 0.65in;
    display:flex;justify-content:space-between;align-items:center;">
    <span style="letter-spacing:0.08em;text-transform:uppercase;">${safe}</span>
    <span class="date" style="letter-spacing:0.04em;"></span>
  </div>`;
}

const FOOTER_TEMPLATE = `<div style="font-family:Georgia,serif;font-size:8px;color:#888;width:100%;
  padding:0 0.65in;display:flex;justify-content:space-between;align-items:center;">
  <span style="letter-spacing:0.1em;text-transform:uppercase;">FATE</span>
  <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

/**
 * Render the currently open document to PDF bytes.
 *
 * Options that matter and why:
 *   printBackground: true      — see the long note below. Set true DELIBERATELY.
 *   generateDocumentOutline    — turns the document's headings into real PDF bookmarks. For a
 *                                Markdown viewer whose whole sidebar is a table of contents, this
 *                                is the single highest-value option available.
 *   generateTaggedPDF          — emits structure tags, so screen readers can navigate the export.
 *   preferCSSPageSize: false   — the requested pageSize wins over any `@page` rule, so the Settings
 *                                choice is authoritative.
 *
 * ── Why printBackground is true ───────────────────────────────────────────────────────────────
 * It was false in 1.8.0, on the reasoning that the print stylesheet forces white paper anyway. That
 * reasoning was wrong, and the flag was doing nothing: the stylesheet also sets
 * `print-color-adjust: exact` on the document container, which OVERRIDES printBackground and forces
 * backgrounds to paint regardless. So `false` bought no safety while quietly implying it did — and
 * the dark table-row backgrounds the stylesheet had failed to reset went to paper.
 *
 * Setting it true makes the actual behaviour explicit and leaves the print stylesheet as the single
 * source of truth for print appearance. The stylesheet now zeroes every background inside
 * `.markdown-body` and adds back only light values, so backgrounds printing is wanted: light zebra
 * striping on tables, grey code blocks, a tinted blockquote — all of which aid readability on paper.
 */
async function renderDocumentPdf({ landscape = false, pageSize = 'Letter', docName = 'Document' } = {}) {
  if (!mainWindow) throw new Error('no window to print from');
  return mainWindow.webContents.printToPDF({
    landscape,
    pageSize,
    margins: PDF_MARGINS,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerTemplate(docName),
    footerTemplate: FOOTER_TEMPLATE,
    generateDocumentOutline: true,
    generateTaggedPDF: true,
    preferCSSPageSize: false
  });
}

/** Filename-safe version of a document name, for the default export name. */
function safeFileStem(name) {
  return (
    String(name || 'document')
      .replace(/\.(md|markdown|txt)$/i, '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'document'
  );
}

let previewWindow = null;

/**
 * Show a print preview.
 *
 * Renders the document to a temp PDF and opens it in a child window with `plugins: true`, which is
 * what enables Chromium's bundled PDF viewer. That viewer provides the real preview the OS dialog
 * could not: actual paginated output, zoom, page navigation, and a print button that prints the
 * *PDF* — so the printer receives exactly what is on screen.
 *
 * A single preview window is reused; printing twice should not litter the desktop with windows.
 */
async function showPrintPreview(docName) {
  const pdf = await renderDocumentPdf({
    docName,
    pageSize: store.get('printPageSize') || 'Letter',
    landscape: !!store.get('printLandscape')
  });

  const file = path.join(app.getPath('temp'), `FATE-preview-${process.pid}.pdf`);
  fs.writeFileSync(file, pdf);

  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.loadURL(pathToFileURL(file).toString());
    previewWindow.focus();
    return { ok: true, reused: true };
  }

  previewWindow = new BrowserWindow({
    width: 940,
    height: 1000,
    minWidth: 480,
    minHeight: 400,
    parent: mainWindow,
    title: `${APP_TITLE} — Print preview`,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      // Required for Chromium's built-in PDF viewer. No preload and no node here — this window
      // only ever displays a PDF we generated ourselves.
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // The preview must not become a browser. Nothing in a PDF should be able to navigate it.
  previewWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  previewWindow.on('closed', () => {
    previewWindow = null;
    // Best-effort cleanup; a leftover temp PDF is harmless but there is no reason to keep it.
    try {
      fs.unlinkSync(file);
    } catch {
      /* the viewer may still hold a handle — Windows will reclaim it with the temp dir */
    }
  });

  /*
   * Fallback if the embedded viewer cannot display the PDF.
   *
   * `plugins: true` enables Chromium's bundled PDF viewer, but that depends on the Electron build
   * actually shipping it. If it is missing, `loadURL` on a PDF fails rather than rendering — which
   * would leave the user staring at an empty window with no way forward. Handing the file to the
   * OS default PDF application is a worse preview but an infinitely better failure mode than a
   * blank window.
   */
  previewWindow.webContents.once('did-fail-load', (_e, errorCode, errorDescription) => {
    console.error(`Print preview failed to render PDF (${errorCode}: ${errorDescription}); ` +
                  'falling back to the system PDF handler.');
    if (previewWindow && !previewWindow.isDestroyed()) previewWindow.destroy();
    previewWindow = null;
    shell.openPath(file);
  });

  previewWindow.loadURL(pathToFileURL(file).toString());
  return { ok: true, reused: false };
}

/** Save the document as a PDF the user chooses the location for. */
async function exportPdf(docName) {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export as PDF',
    defaultPath: `${safeFileStem(docName)}.pdf`,
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const pdf = await renderDocumentPdf({
    docName,
    pageSize: store.get('printPageSize') || 'Letter',
    landscape: !!store.get('printLandscape')
  });
  fs.writeFileSync(filePath, pdf);
  return { ok: true, filePath };
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

/**
 * Publish Rich Presence.
 *
 * ── Filenames are never sent ──────────────────────────────────────────────────────────────────
 * Presence is deliberately generic: "Reading Markdown" or "Idling on the home screen", and nothing
 * else. Up to 1.7.0 there was a "Show filename on Discord" toggle that put the open document's name
 * in the `state` field. It is gone as of 1.8.0 — broadcasting the name of whatever file you have
 * open to everyone on your friends list is a privacy footgun for a documents app, and it is not
 * something anyone needs a setting for.
 *
 * `state` is left unset rather than filled with a generic string, which is exactly the payload the
 * old toggle produced in its OFF position — so presence looks the same as it did for anyone who had
 * it disabled. Everything else about the integration is unchanged.
 *
 * Callers may still pass a `state`; it is ignored on purpose, so a stray call site cannot
 * reintroduce a filename leak.
 */
function setDiscordActivity(activity) {
  if (activity) currentActivity = activity;
  if (!rpcReady) return;

  rpc.setActivity({
    details: currentActivity.details || 'Idling on the home screen',
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

  // ── Printing & PDF export ─────────────────────────────────────────────────────────────────
  // Both are wrapped so a render failure surfaces in the UI instead of rejecting into the void.
  ipcMain.handle('print-preview', async (event, docName) => {
    try {
      return await showPrintPreview(docName);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('export-pdf', async (event, docName) => {
    try {
      return await exportPdf(docName);
    } catch (err) {
      return { ok: false, error: err.message };
    }
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
