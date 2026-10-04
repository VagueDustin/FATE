/**
 * settingsMeta.js: option lists shared by App.jsx, SettingsModal.jsx and CommandPalette.jsx, plus
 * the pure helpers behind them (shortcut parsing and display, the sidebar width clamp).
 * (Own module because react-refresh requires component files to export only components, and so
 * the helpers can be unit-tested under plain Node: see test/settingsMeta.test.mjs.)
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
 * Pre-1.5.0 the default was `'dark'`, which no longer has a token block, so a stored `'dark'` would
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
   SHORTCUTS: every rebindable action in the app (1.11.0: everything is rebindable).
   `id` is the key in settings.shortcuts; the defaults below are merged over stored values by
   resolveShortcuts(), so upgrades gain new actions without losing user rebinds.
   Ctrl+1…9 (jump to tab N) stays fixed; nine bindings for one concept would drown the list.
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
 *
 * 1.14.0 also migrates each stored binding to the current format (normalizeBinding: a binding of
 * the + key, stored as "Control++" up to 1.13, becomes "Control+Plus"), and drops any binding the
 * recorder should never have accepted back to its default: before 1.14.0 a bare letter could be
 * recorded, so "H" bound to Close tab closed tabs while typing, across restarts.
 */
export function resolveShortcuts(stored) {
  const merged = { ...DEFAULT_SHORTCUTS };
  if (stored && typeof stored === 'object') {
    for (const [k, v] of Object.entries(stored)) {
      if (!(k in merged) || typeof v !== 'string' || !v) continue;
      const binding = normalizeBinding(v);
      if (binding && isAllowedShortcut(binding)) merged[k] = binding;
    }
  }
  return merged;
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   SHORTCUT BINDINGS: parsing, recording, matching and display (1.14.0).

   A binding is stored as modifiers plus ONE key, joined with "+":
       "Control+Shift+S"   "Alt+Home"   "Control+,"   "Control+\"   "F5"   "Escape"
   Modifiers are written Control, Shift, Alt, Meta, always in that order. The key is the
   KeyboardEvent.key value with letters upper-cased, " " written "Space" and "+" written "Plus".

   Why "Plus": bindings are split on "+", so up to 1.13 a binding of the + key itself was stored
   as "Control++", parsed as an empty key and could never fire. Naming the key fixes the split,
   and "Plus" is also Electron's accelerator name for it (see toElectronAccelerator). Old
   "...++" strings still parse, and resolveShortcuts rewrites them on load.
   ════════════════════════════════════════════════════════════════════════════════════════════ */

const MODIFIER_FIELDS = [
  ['Control', 'ctrl'],
  ['Shift', 'shift'],
  ['Alt', 'alt'],
  ['Meta', 'meta']
];

/** Spellings a stored or hand-edited binding may use for each modifier (lower-cased). */
const MODIFIER_ALIASES = {
  control: 'ctrl', ctrl: 'ctrl',
  shift: 'shift',
  alt: 'alt', option: 'alt',
  meta: 'meta', super: 'meta', win: 'meta', cmd: 'meta', command: 'meta'
};

/** KeyboardEvent.key values that are modifiers or locks on their own, never a binding's key. */
const MODIFIER_KEYS = new Set([
  'Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'Super', 'Hyper', 'Fn', 'FnLock',
  'CapsLock', 'NumLock', 'ScrollLock', 'Symbol', 'SymbolLock'
]);

/** Named keys a binding may spell differently (Electron names, abbreviations), lower-cased. */
const KEY_ALIASES = {
  plus: 'Plus',
  space: 'Space', spacebar: 'Space',
  esc: 'Escape', escape: 'Escape',
  del: 'Delete', delete: 'Delete',
  return: 'Enter', enter: 'Enter',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  tab: 'Tab', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  insert: 'Insert', backspace: 'Backspace'
};

/** One key name in the stored form, or null when there is no usable key. */
function normalizeKey(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  if (raw === '+') return 'Plus';
  if (raw === ' ') return 'Space';
  if (raw.length === 1) {
    // Upper-case letters only where that stays one character ("ß" would become "SS").
    const upper = raw.toUpperCase();
    return upper.length === 1 ? upper : raw;
  }
  const lower = raw.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  const fKey = /^f(\d{1,2})$/.exec(lower);
  if (fKey) return `F${Number(fKey[1])}`;
  return raw;
}

/**
 * Parse a stored binding into { ctrl, shift, alt, meta, key }, or null when it names no key or
 * uses a modifier this app doesn't know. Accepts the legacy "Control++" form for the + key.
 */
export function parseShortcut(binding) {
  if (typeof binding !== 'string' || !binding.trim()) return null;
  let rest = binding;
  let key = null;
  if (rest === '+') {
    key = 'Plus';
    rest = '';
  } else if (rest.endsWith('++')) {
    key = 'Plus';
    rest = rest.slice(0, -2);
  }
  const parts = rest ? rest.split('+') : [];
  if (key === null) {
    const last = parts.pop();
    key = normalizeKey(last === ' ' ? last : last?.trim());
  }
  if (!key || MODIFIER_KEYS.has(key)) return null;

  const parsed = { ctrl: false, shift: false, alt: false, meta: false, key };
  for (const part of parts) {
    const field = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (!field) return null; // an empty segment ("Control++S") or an unknown name
    parsed[field] = true;
  }
  return parsed;
}

/** The stored string for a parsed binding: modifiers in canonical order, then the key. */
function serializeShortcut(parsed) {
  const parts = MODIFIER_FIELDS.filter(([, field]) => parsed[field]).map(([name]) => name);
  parts.push(parsed.key);
  return parts.join('+');
}

/** A binding rewritten in the current stored form ("Control++" → "Control+Plus"), or null. */
export function normalizeBinding(binding) {
  const parsed = parseShortcut(binding);
  return parsed ? serializeShortcut(parsed) : null;
}

/**
 * What the shortcut recorder stores for a keydown, in the same form parseShortcut reads, or null
 * while only modifiers are held (the recorder keeps listening until a real key arrives).
 */
export function bindingFromEvent(e) {
  const raw = e?.key;
  if (!raw || raw === 'Unidentified' || raw === 'Dead' || raw === 'Process' || MODIFIER_KEYS.has(raw)) {
    return null;
  }
  const key = normalizeKey(raw);
  if (!key) return null;
  return serializeShortcut({
    ctrl: !!e.ctrlKey,
    shift: !!e.shiftKey,
    alt: !!e.altKey,
    meta: !!e.metaKey,
    key
  });
}

/** Does this keydown fire this binding? Exact modifiers; the key compares case-insensitively. */
export function matchesShortcut(e, binding) {
  const parsed = typeof binding === 'string' ? parseShortcut(binding) : binding;
  if (!parsed || !e?.key) return false;
  if (!!e.ctrlKey !== parsed.ctrl || !!e.shiftKey !== parsed.shift) return false;
  if (!!e.altKey !== parsed.alt || !!e.metaKey !== parsed.meta) return false;
  const key = normalizeKey(e.key);
  return !!key && key.toLowerCase() === parsed.key.toLowerCase();
}

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;

/**
 * May this binding be used as a shortcut? It needs Ctrl, Alt or Meta, so it can't fire while
 * typing; Shift doesn't count, since Shift+H is just a capital H. The exceptions are F1–F12, on
 * their own or with modifiers, and a lone Escape, kept because it is the default for "Close tab /
 * dismiss (alternate)".
 */
export function isAllowedShortcut(binding) {
  const parsed = typeof binding === 'string' ? parseShortcut(binding) : binding;
  if (!parsed) return false;
  if (FUNCTION_KEY.test(parsed.key)) return true;
  if (parsed.key === 'Escape' && !parsed.ctrl && !parsed.shift && !parsed.alt && !parsed.meta) return true;
  return parsed.ctrl || parsed.alt || parsed.meta;
}

/** How each key reads on a keycap chip or in a tooltip. Anything else shows as stored. */
const KEY_LABELS = {
  Escape: 'Esc',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
};

/** What the Meta modifier is called on each platform. */
const META_LABELS = { win32: 'Win', linux: 'Super', darwin: 'Cmd' };

const currentPlatform = () =>
  (typeof window !== 'undefined' ? window.electronAPI?.platform : undefined);

/** A binding as display parts, ["Ctrl", "Shift", "S"]: one keycap chip each. [] if unparseable. */
export function shortcutParts(binding, platform = currentPlatform()) {
  const parsed = parseShortcut(binding);
  if (!parsed) return [];
  const parts = [];
  if (parsed.ctrl) parts.push('Ctrl');
  if (parsed.shift) parts.push('Shift');
  if (parsed.alt) parts.push('Alt');
  if (parsed.meta) parts.push(META_LABELS[platform] || 'Meta');
  parts.push(KEY_LABELS[parsed.key] || parsed.key);
  return parts;
}

/** A binding as one label for tooltips and menus: "Ctrl+Shift+S", "Ctrl+Plus", "Esc". */
export function formatShortcutLabel(binding, platform = currentPlatform()) {
  return shortcutParts(binding, platform).join('+');
}

/** Electron's accelerator key names where they differ from the stored ones. */
const ACCELERATOR_KEYS = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
};

/**
 * The binding as an Electron accelerator string ("Control+Shift+S", "Control+Plus"), for menu
 * labels drawn by Electron itself, or null when it can't be expressed. Display only: the renderer
 * keeps handling the keys.
 */
export function toElectronAccelerator(binding) {
  const parsed = parseShortcut(binding);
  if (!parsed) return null;
  return serializeShortcut({ ...parsed, key: ACCELERATOR_KEYS[parsed.key] || parsed.key });
}

/* ── Markdown contents sidebar width (Settings → Appearance) ─────────────────────────────────── */
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 600;
export const DEFAULT_SIDEBAR_WIDTH = 300;

/**
 * A stored or typed sidebar width, rounded and clamped to 200–600, or `fallback` when it isn't a
 * number at all. Up to 1.13 the Settings field saved every keystroke unchecked, so a store can
 * hold anything from 1 to 99999.
 */
export function clampSidebarWidth(value, fallback = DEFAULT_SIDEBAR_WIDTH) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(n)));
}

/** Truly fixed bindings, shown in Settings for discoverability. */
export const FIXED_SHORTCUTS = [
  { keys: ['Ctrl', '1–9'], label: 'Jump to tab (9 = last)' },
  { keys: ['Ctrl', 'F'], label: 'Find in file (code editor)' },
  { keys: ['Ctrl', 'PgUp/PgDn'], label: 'Previous / next tab (alternate)' }
];
