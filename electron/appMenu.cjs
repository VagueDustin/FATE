'use strict';
/**
 * appMenu.cjs: FATE's application menu (File, Edit, View, Help; Alt shows it), the tab strip's
 * right-click menu, and the print preview's menu. Templates only: main.cjs builds them with
 * Electron's Menu. Free of Electron imports; test/appMenu.test.cjs runs it under plain node.
 *
 * ── Why FATE has a menu at all ────────────────────────────────────────────────────────────────
 * Up to 1.13.4 it set none, so Electron installed its default one. autoHideMenuBar hid it, but its
 * accelerators stayed live: Ctrl+R and Ctrl+Shift+R reloaded the window, and a reload is not a
 * close, so the unsaved-changes guard never ran and every unsaved edit (Untitled buffers included)
 * was gone for good. This menu has NO Reload or Force Reload anywhere, and Toggle Developer Tools
 * only in unpackaged builds.
 *
 * ── Who handles the keys ──────────────────────────────────────────────────────────────────────
 * The renderer owns every rebindable shortcut (App.jsx's keydown handler, CodeMirror's keymaps),
 * so items it implements are DISPLAY-ONLY: `registerAccelerator: false`, a click sends
 * 'menu-command' with the item's id, and the label shows the user's own binding, which the
 * renderer reports through 'update-menu'. Registering them as well would run a command twice, or
 * run the old binding after a rebind.
 *
 * Cut, Copy, Paste and Select All are display-only too. On Windows and Linux Chromium already maps
 * Ctrl+X/C/V/A inside the page (and CodeMirror and FATE's reading-view Ctrl+A take theirs first),
 * so a registered role accelerator could only ever fire as a second handler for a key the page
 * passed on. Zoom, full screen and Exit keep their registered accelerators: nothing in the page
 * handles those keys, and Electron only fires a menu accelerator for a key the page did not
 * consume (measured on Electron 42), so a user binding on the same key still wins.
 */

const RELEASES_URL = 'https://github.com/VagueDustin/FATE/releases';
const ISSUES_URL = 'https://github.com/VagueDustin/FATE/issues/new/choose';

/** Ids the renderer implements; a click sends ('menu-command', id). The contract in preload.cjs. */
const MENU_COMMANDS = Object.freeze([
  'newFile', 'openFile', 'save', 'saveAs', 'print', 'exportPdf', 'closeTab', 'toggleEdit',
  'toggleSplit', 'focusMode', 'palette', 'settings', 'shortcuts', 'about', 'find', 'gotoLine',
  'gotoSymbol', 'undo', 'redo'
]);

/**
 * Keys that are fixed rather than rebindable (FIXED_SHORTCUTS in src/settingsMeta.js, plus
 * CodeMirror's history keys). Shown unless 'update-menu' sends a binding for the same id, so the
 * day one of them becomes rebindable the renderer's value takes over without a change here.
 */
const FIXED_BINDINGS = Object.freeze({ undo: 'Control+Z', redo: 'Control+Y', find: 'Control+F' });

/** Labels are display-only, so a binding is short; anything longer is not one FATE recorded. */
const MAX_BINDING_LENGTH = 64;

/* ════════════════════════════════════════════════════════════════════════════════════════════
   SHORTCUT LABELS
   ════════════════════════════════════════════════════════════════════════════════════════════ */

const MODIFIERS = { Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Super' };

/** `KeyboardEvent.key` names (what App.jsx records) → Electron accelerator key codes. */
const NAMED_KEYS = {
  Escape: 'Esc', Esc: 'Esc', Enter: 'Enter', Return: 'Enter', Tab: 'Tab', Space: 'Space',
  Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left',
  ArrowRight: 'Right', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right', Plus: 'Plus',
  PrintScreen: 'PrintScreen'
};

/** Printable keys Electron's accelerator parser knows (US layout), `+` spelled as Plus. */
const PUNCTUATION_KEYS = new Set(Array.from(')!@#$%^&*(:;=<,_->.?/~`{][|\\}"\''));

/**
 * FATE's binding format (`Control+Shift+S`: modifiers then `KeyboardEvent.key`, joined with `+`)
 * → an Electron accelerator (`Ctrl+Shift+S`), or null when it cannot be shown.
 *
 * Null means "no label", never an error: a dead key, a non-ASCII key (`é`, `ß`) or anything
 * malformed simply shows no shortcut, which is better than a wrong one. The renderer still
 * handles the key itself either way. A literal `+` key arrives as `Control++` (App.jsx joins with
 * the separator it records); it is read as the Plus key here.
 */
function bindingToAccelerator(binding) {
  if (typeof binding !== 'string' || !binding || binding.length > MAX_BINDING_LENGTH) return null;
  let mods;
  let key;
  if (binding === '+') {
    mods = [];
    key = '+';
  } else if (binding.endsWith('++')) {
    const head = binding.slice(0, -2);
    mods = head ? head.split('+') : [];
    key = '+';
  } else {
    mods = binding.split('+');
    key = mods.pop();
  }

  const out = [];
  for (const mod of mods) {
    const name = MODIFIERS[mod];
    if (!name || out.includes(name)) return null;
    out.push(name);
  }

  let code = null;
  if (key === '+') code = 'Plus';
  else if (Object.prototype.hasOwnProperty.call(NAMED_KEYS, key)) code = NAMED_KEYS[key];
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) code = key;
  else if (/^[a-zA-Z0-9]$/.test(key)) code = key.toUpperCase();
  else if (key.length === 1 && PUNCTUATION_KEYS.has(key)) code = key;
  if (!code) return null;

  out.push(code);
  return out.join('+');
}

/**
 * The 'update-menu' payload's shortcuts, kept to what the menu can use: known ids, short strings.
 * The renderer is the only sender, but its values end up in native menu labels.
 */
function sanitizeMenuShortcuts(shortcuts) {
  const clean = {};
  if (!shortcuts || typeof shortcuts !== 'object' || Array.isArray(shortcuts)) return clean;
  for (const id of MENU_COMMANDS) {
    const value = shortcuts[id];
    if (typeof value === 'string' && value.length <= MAX_BINDING_LENGTH) clean[id] = value;
  }
  return clean;
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   LABELS
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Menu labels on Windows and Linux treat `&` as the mnemonic marker: `R&D notes.md` would show as
 * "RD notes.md" with an underlined D. Text that is not ours (file names, spelling suggestions)
 * doubles it, which displays a literal `&`.
 */
function escapeMenuLabel(text) {
  return String(text).replace(/&/g, '&&');
}

/** A recent file as the menu shows it: the full path (two `notes.md` stay apart), `~` for home. */
function recentFileLabel(filePath, { homeDir = '', platform = process.platform, maxLength = 80 } = {}) {
  let shown = String(filePath);
  if (platform !== 'win32' && homeDir && (shown === homeDir || shown.startsWith(`${homeDir}/`))) {
    shown = `~${shown.slice(homeDir.length)}`;
  }
  // Long paths keep their start (drive, home) and their end (the file name), not the middle.
  if (shown.length > maxLength) {
    const tail = Math.ceil((maxLength - 1) * 0.65);
    shown = `${shown.slice(0, maxLength - 1 - tail)}…${shown.slice(-tail)}`;
  }
  return escapeMenuLabel(shown);
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   TEMPLATES
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The application menu.
 *
 * `state`: { shortcuts (from 'update-menu'), recentFiles (paths, newest first), isPackaged,
 * platform, homeDir }. `actions`: { command(id), openRecent(path), clearRecent(),
 * checkForUpdates(), openUrl(url) }, which main.cjs wires to IPC, file opening and the updater.
 */
function buildAppMenuTemplate(state, actions) {
  const { shortcuts = {}, recentFiles = [], isPackaged = true, platform = process.platform, homeDir = '' } = state || {};
  const separator = { type: 'separator' };

  /** An item the renderer implements: display-only shortcut, click → 'menu-command'. */
  const command = (label, id) => {
    const accelerator = bindingToAccelerator(shortcuts[id] ?? FIXED_BINDINGS[id]);
    return {
      id,
      label,
      ...(accelerator ? { accelerator } : {}),
      registerAccelerator: false,
      click: () => actions.command(id)
    };
  };

  const recentItems = recentFiles
    .filter((p) => typeof p === 'string' && p)
    .map((filePath, i) => ({
      id: `recent${i}`,
      label: recentFileLabel(filePath, { homeDir, platform }),
      click: () => actions.openRecent(filePath)
    }));
  const openRecent = recentItems.length
    ? [...recentItems, separator, { id: 'clearRecent', label: 'Clear Recently Opened', click: () => actions.clearRecent() }]
    : [
        { id: 'noRecent', label: 'No Recent Files', enabled: false },
        separator,
        { id: 'clearRecent', label: 'Clear Recently Opened', enabled: false }
      ];

  return [
    {
      label: '&File',
      submenu: [
        command('&New', 'newFile'),
        command('&Open…', 'openFile'),
        { id: 'openRecent', label: 'Open &Recent', submenu: openRecent },
        separator,
        command('&Save', 'save'),
        command('Save &As…', 'saveAs'),
        separator,
        command('Print Pre&view…', 'print'),
        command('&Export as PDF…', 'exportPdf'),
        separator,
        command('&Close Tab', 'closeTab'),
        separator,
        command('Se&ttings…', 'settings'),
        separator,
        // Goes through the window's close guard like the title-bar X, so unsaved work is asked
        // about first. The role keeps Ctrl+Q on Linux and nothing on Windows, where Alt+F4 is it.
        { id: 'exit', role: 'quit', label: 'E&xit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        // CodeMirror keeps its own history, so these are commands, not the undo/redo roles
        // (which would run Chromium's document-level undo underneath the editor).
        command('&Undo', 'undo'),
        command('&Redo', 'redo'),
        separator,
        { id: 'cut', role: 'cut', label: 'Cu&t', registerAccelerator: false },
        { id: 'copy', role: 'copy', label: '&Copy', registerAccelerator: false },
        { id: 'paste', role: 'paste', label: '&Paste', registerAccelerator: false },
        { id: 'selectAll', role: 'selectAll', label: 'Select &All', registerAccelerator: false },
        separator,
        command('&Find…', 'find'),
        command('Go to &Line…', 'gotoLine'),
        command('Go to S&ymbol…', 'gotoSymbol')
      ]
    },
    {
      label: '&View',
      submenu: [
        command('Edit/View &Markdown', 'toggleEdit'),
        command('&Split View', 'toggleSplit'),
        command('&Focus Mode', 'focusMode'),
        separator,
        command('&Command Palette…', 'palette'),
        separator,
        { id: 'resetZoom', role: 'resetZoom', label: '&Actual Size' },
        { id: 'zoomIn', role: 'zoomIn', label: 'Zoom &In' },
        // The role's accelerator is Ctrl+Plus, which on most layouts needs Shift; Ctrl+= is the
        // key people press. Hidden items' accelerators still fire on Windows and Linux.
        { id: 'zoomInEquals', role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false },
        { id: 'zoomOut', role: 'zoomOut', label: 'Zoom &Out' },
        separator,
        { id: 'fullScreen', role: 'togglefullscreen', label: 'Toggle F&ull Screen' },
        ...(isPackaged ? [] : [separator, { id: 'devTools', role: 'toggleDevTools', label: 'Toggle &Developer Tools' }])
      ]
    },
    {
      label: '&Help',
      submenu: [
        command('&Keyboard Shortcuts', 'shortcuts'),
        separator,
        { id: 'releaseNotes', label: '&Release Notes', click: () => actions.openUrl(RELEASES_URL) },
        { id: 'reportIssue', label: 'Report an &Issue', click: () => actions.openUrl(ISSUES_URL) },
        separator,
        { id: 'checkForUpdates', label: 'Check for &Updates', click: () => actions.checkForUpdates() },
        separator,
        command('&About FATE', 'about')
      ]
    }
  ];
}

/**
 * A tab's right-click menu. `pick(action)` returns the click handler that reports that action;
 * the renderer carries it out (copying the path, revealing the file, closing tabs), so main only
 * ever says which item was chosen. Path items are disabled for a tab with no file (Untitled).
 */
function buildTabMenuTemplate({ hasPath }, pick) {
  return [
    { id: 'copyPath', label: 'Copy Full Path', enabled: !!hasPath, click: pick('copyPath') },
    { id: 'reveal', label: 'Open Containing Folder', enabled: !!hasPath, click: pick('reveal') },
    { type: 'separator' },
    { id: 'close', label: 'Close', click: pick('close') },
    { id: 'closeOthers', label: 'Close Others', click: pick('closeOthers') },
    { id: 'closeRight', label: 'Close Tabs to the Right', click: pick('closeRight') }
  ];
}

/**
 * The print preview window's menu. Without one it would inherit the application menu, whose
 * commands all act on the main window, and lose Ctrl+W, which closed the preview through
 * Electron's default menu before FATE had its own.
 */
function buildPreviewMenuTemplate() {
  return [{ label: '&File', submenu: [{ id: 'closePreview', role: 'close', label: '&Close Preview' }] }];
}

module.exports = {
  MENU_COMMANDS,
  FIXED_BINDINGS,
  RELEASES_URL,
  ISSUES_URL,
  bindingToAccelerator,
  sanitizeMenuShortcuts,
  escapeMenuLabel,
  recentFileLabel,
  buildAppMenuTemplate,
  buildTabMenuTemplate,
  buildPreviewMenuTemplate
};
