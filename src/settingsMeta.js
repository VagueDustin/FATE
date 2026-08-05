/**
 * settingsMeta.js — option lists shared by App.jsx, SettingsModal.jsx and CommandPalette.jsx.
 * (Own module because react-refresh requires component files to export only components.)
 */

/**
 * Themes are defined as token blocks in brand.css. This list drives the Settings theme cards and
 * the palette's theme commands, so adding a theme means adding a block there and one entry here.
 * 'custom' is special: its block is generated at runtime from the user's own colours (see
 * src/themeCustom.js) and it is only offered once the user has built one.
 */
export const THEMES = [
  { value: 'fate', label: 'FATE', sub: 'Navy & Gold' },
  { value: 'crimson', label: 'Crimson', sub: 'The classic red' },
  { value: 'light', label: 'Light', sub: 'Paper white' },
  { value: 'dracula', label: 'Dracula', sub: 'Community classic' },
  { value: 'nord', label: 'Nord', sub: 'Arctic blues' },
  { value: 'gruvbox', label: 'Gruvbox', sub: 'Retro warmth' },
  { value: 'onedark', label: 'One Dark', sub: "Atom's classic" },
  { value: 'rosepine', label: 'Rosé Pine', sub: 'Soho vibes' }
];

export const VALID_THEMES = THEMES.map((t) => t.value);
export const DEFAULT_THEME = 'fate';

/**
 * Map a stored theme value onto one that still exists.
 *
 * Pre-1.5.0 the default was `'dark'`, which no longer has a token block — a stored `'dark'` would
 * render the app with every custom property unresolved. `'custom'` is only honoured when the user
 * actually has a custom theme saved (`hasCustom`), otherwise it degrades to the default too.
 */
export function resolveTheme(stored, hasCustom = false) {
  if (stored === 'custom') return hasCustom ? 'custom' : DEFAULT_THEME;
  if (VALID_THEMES.includes(stored)) return stored;
  return DEFAULT_THEME; // covers legacy 'dark', null, and anything unexpected
}

/**
 * Paper sizes offered for print preview and PDF export.
 *
 * These strings are passed straight to Electron's `printToPDF` `pageSize` option, so they must match
 * the names Chromium recognises. Letter leads because FATE is Windows-only and Letter is the more
 * common default there.
 */
export const PAGE_SIZES = [
  { value: 'Letter', label: 'Letter (8.5 × 11 in)' },
  { value: 'A4', label: 'A4 (210 × 297 mm)' },
  { value: 'Legal', label: 'Legal (8.5 × 14 in)' },
  { value: 'Tabloid', label: 'Tabloid (11 × 17 in)' },
  { value: 'A3', label: 'A3 (297 × 420 mm)' },
  { value: 'A5', label: 'A5 (148 × 210 mm)' }
];

/* ════════════════════════════════════════════════════════════════════════════════════════════
   SHORTCUTS — every rebindable action in the app (1.11.0: everything is rebindable).
   `id` is the key in settings.shortcuts; the defaults below are merged over stored values by
   resolveShortcuts(), so upgrades gain new actions without losing user rebinds.
   Ctrl+1…9 (jump to tab N) stays fixed — nine bindings for one concept would drown the list.
   ════════════════════════════════════════════════════════════════════════════════════════════ */
export const SHORTCUT_ACTIONS = [
  { id: 'newFile', label: 'New file', default: 'Control+T' },
  { id: 'openFile', label: 'Open file', default: 'Control+O' },
  { id: 'save', label: 'Save', default: 'Control+S' },
  { id: 'saveAs', label: 'Save As…', default: 'Control+Shift+S' },
  { id: 'print', label: 'Print preview', default: 'Control+P' },
  { id: 'exportPdf', label: 'Export as PDF', default: 'Control+Shift+E' },
  { id: 'closeTab', label: 'Close tab', default: 'Control+W' },
  { id: 'close', label: 'Close tab / dismiss (alternate)', default: 'Escape' },
  { id: 'nextTab', label: 'Next tab', default: 'Control+Tab' },
  { id: 'prevTab', label: 'Previous tab', default: 'Control+Shift+Tab' },
  { id: 'goHome', label: 'Go to home screen', default: 'Alt+Home' },
  { id: 'palette', label: 'Command palette', default: 'Control+K' },
  { id: 'toggleEdit', label: 'Edit / view markdown', default: 'Control+E' },
  { id: 'toggleSplit', label: 'Split view', default: 'Control+\\' },
  { id: 'focusMode', label: 'Focus mode', default: 'Control+Shift+F' },
  { id: 'settings', label: 'Open settings', default: 'Control+,' }
];

export const DEFAULT_SHORTCUTS = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, a.default])
);

/**
 * Merge stored shortcut bindings over the defaults, dropping keys that no longer exist. Pre-1.11
 * stores only had openFile/print/close; users upgrading keep those three rebinds and gain the
 * rest at their defaults.
 */
export function resolveShortcuts(stored) {
  const merged = { ...DEFAULT_SHORTCUTS };
  if (stored && typeof stored === 'object') {
    for (const [k, v] of Object.entries(stored)) {
      if (k in merged && typeof v === 'string' && v) merged[k] = v;
    }
  }
  return merged;
}

/** Truly fixed bindings, shown in Settings for discoverability. */
export const FIXED_SHORTCUTS = [
  { keys: ['Ctrl', '1–9'], label: 'Jump to tab (9 = last)' },
  { keys: ['Ctrl', 'F'], label: 'Find in file (code editor)' },
  { keys: ['Ctrl', 'PgUp/PgDn'], label: 'Previous / next tab (alternate)' }
];
