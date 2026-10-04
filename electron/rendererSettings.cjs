'use strict';
/**
 * rendererSettings.cjs: the settings the renderer may read and write through store-get/store-set.
 *
 * Up to 1.13.4 those two handlers passed any key straight to electron-store. That is fine while
 * the renderer is trusted, but the renderer displays documents, and one sanitiser bypass would
 * have let a document rewrite main-only state: `recentFiles` (whose paths main opens), the
 * Windows `registrationStamp` (so the registry self-heal never runs again), or a dotted path
 * into any of them, since electron-store reads `a.b` as a nested key.
 *
 * So the renderer gets exactly the keys below, each with a cheap type check. Main-only keys
 * (recentFiles, registrationStamp, claimedTypes, and anything main adds later) are neither
 * readable nor writable from the renderer. The checks are deliberately loose about CONTENT: the
 * renderer already sanitises every value it reads back (resolveTheme, resolveFonts,
 * resolveShortcuts, resolveCustomTheme), so this only keeps out the wrong TYPES and runaway sizes.
 *
 * ADDING A SETTING: add its key here, or store.set() of it is refused (main logs a warning
 * naming the key, and the value is simply not saved).
 *
 * Free of Electron imports; test/rendererSettings.test.cjs runs it under plain node.
 */

const isBool = (v) => typeof v === 'boolean';
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isString = (max) => (v) => typeof v === 'string' && v.length <= max;
const isNumber = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** { action id: 'Control+Shift+X' } */
const isShortcutMap = (v) => isPlainObject(v) && Object.values(v).every((s) => typeof s === 'string' && s.length <= 64);

/**
 * The tabs to reopen: { paths: string[], active: string | null }. Other fields are allowed so the
 * renderer can keep more per-tab state here without a main-process change.
 */
const isSession = (v) =>
  isPlainObject(v) &&
  (v.paths === undefined || (Array.isArray(v.paths) && v.paths.every((p) => typeof p === 'string'))) &&
  (v.active === undefined || v.active === null || typeof v.active === 'string');

const RENDERER_SETTINGS = Object.freeze({
  theme: isString(64),
  autoUpdatesEnabled: isBool,
  sidebarWidth: isNumber(0, 10000),
  shortcuts: isShortcutMap,
  printPageSize: isString(32),
  printLandscape: isBool,
  editorWrap: isBool,
  editorTabSize: isNumber(1, 16),
  editorLint: isBool,
  fonts: isPlainObject,
  restoreSession: isBool,
  customTheme: (v) => v === null || isPlainObject(v),
  session: isSession,
  // 1.14.0
  spellcheck: isBool,
  remoteImages: isBool
});

/** No single setting needs more than this once serialised; a session of hundreds of tabs is ~50 KB. */
const MAX_VALUE_BYTES = 256 * 1024;

function isRendererSettingKey(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(RENDERER_SETTINGS, key);
}

/** May the renderer store `value` under `key`? Resolves { ok: true } or { ok: false, error }. */
function checkRendererSetting(key, value) {
  if (!isRendererSettingKey(key)) return { ok: false, error: `Unknown setting: ${String(key).slice(0, 64)}` };
  if (!RENDERER_SETTINGS[key](value)) return { ok: false, error: `Wrong type for setting ${key}` };
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    return { ok: false, error: `Setting ${key} cannot be stored` };
  }
  if (json.length > MAX_VALUE_BYTES) return { ok: false, error: `Setting ${key} is too large` };
  return { ok: true };
}

module.exports = { RENDERER_SETTINGS, isRendererSettingKey, checkRendererSetting };
