'use strict';
/**
 * spellcheck.cjs: the `spellcheck` setting, applied to an Electron session.
 *
 * ── Why this is not just setSpellCheckerEnabled ───────────────────────────────────────────────
 * Electron's spellchecker is on by default, and on Linux it backs onto Hunspell dictionaries it
 * DOWNLOADS from Google's servers (redirector.gvt1.com) the first time a window opens: a fresh
 * FATE profile on Linux had `Dictionaries/en-US-10-1.bdic` in it, contradicting PRIVACY.md.
 * Measured on Electron 42: neither `session.setSpellCheckerEnabled(false)` nor
 * `webPreferences.spellcheck: false` (nor both) stops that download. The session loads a
 * dictionary for every language in its list whether or not checking is enabled. What stops it is
 * an EMPTY language list, set before the first window exists. So "off" here means disabled AND no
 * languages, and "on" puts the user's language back.
 *
 * Windows defaults to on: Chromium uses the Windows spell checker there, which needs no download.
 *
 * ── Two more Electron behaviours this works around (both measured) ────────────────────────────
 *  1. A window created with `webPreferences.spellcheck: false` never marks misspellings, even after
 *     the session is enabled, so turning the setting on would need a restart. main.cjs creates the
 *     window with it true and lets the session decide, which is what makes the toggle live.
 *  2. A renderer that starts while its dictionary is still loading never receives it, so checking
 *     silently does nothing for the whole session. That is the normal case at launch (measured:
 *     the dictionary is ready ~50 ms after the window is created, ~125 ms before the page has
 *     loaded) and after a first-time download. Re-applying "enabled" re-sends the dictionary to
 *     every renderer, so refresh() runs once a dictionary reports itself initialized, and main.cjs
 *     calls it again whenever the window's page finishes loading. Either alone misses a case.
 *
 * Free of Electron imports; test/spellcheck.test.cjs drives it with a fake session.
 */

/** The setting's default when the user has never chosen: on where it costs nothing (Windows). */
function defaultSpellcheckEnabled(platform) {
  return platform === 'win32';
}

/** The stored setting, or the platform default when there is none (or it is not a boolean). */
function resolveSpellcheckSetting(stored, platform) {
  return typeof stored === 'boolean' ? stored : defaultSpellcheckEnabled(platform);
}

/**
 * The dictionary to check with: the first of the user's languages that Chromium has one for.
 * Exact matches first (`en-GB`), then the bare language (`de-AT` → `de`), then any regional one
 * (`es-CO` → the first `es-…`), then US English. Null when nothing at all is available.
 */
function pickSpellcheckLanguage(preferred, available) {
  const byLower = new Map();
  for (const code of available || []) {
    if (typeof code === 'string' && code) byLower.set(code.toLowerCase(), code);
  }
  const wanted = (preferred || [])
    .filter((code) => typeof code === 'string' && code)
    .map((code) => code.replace(/_/g, '-').toLowerCase());

  for (const code of wanted) {
    if (byLower.has(code)) return byLower.get(code);
  }
  for (const code of wanted) {
    const lang = code.split('-')[0];
    if (byLower.has(lang)) return byLower.get(lang);
    for (const [lower, original] of byLower) {
      if (lower.startsWith(`${lang}-`)) return original;
    }
  }
  return byLower.get('en-us') ?? null;
}

/**
 * Apply the setting to `session` now and whenever `set(enabled)` is called. Returns
 * { set(enabled), refresh(), isEnabled() }; refresh() is workaround 2 above.
 *
 * `preferredLanguages` is what the OS says the user reads (app.getLocale() first, then
 * app.getPreferredSystemLanguages()). macOS ignores language lists (it uses the system checker),
 * so they are only set elsewhere.
 */
function createSpellcheckController(session, { enabled, preferredLanguages = [], platform = process.platform, warn = () => {} }) {
  const setsLanguages = platform !== 'darwin';
  let on = false;

  const setLanguages = (languages) => {
    if (!setsLanguages) return;
    try {
      session.setSpellCheckerLanguages(languages);
    } catch (err) {
      warn(`Spellcheck languages not applied: ${err.message}`);
    }
  };

  function set(next) {
    on = next === true;
    if (on) {
      const language = pickSpellcheckLanguage(preferredLanguages, session.availableSpellCheckerLanguages);
      setLanguages(language ? [language] : []);
      session.setSpellCheckerEnabled(true);
    } else {
      session.setSpellCheckerEnabled(false);
      setLanguages([]); // no languages, no dictionary, no download: see the header
    }
  }

  // Workaround 2 above. Toggling the enable flag re-initialises every renderer's spellchecker with
  // whatever dictionaries have loaded by now. A no-op while off: there is nothing to send.
  function refresh() {
    if (!on) return;
    session.setSpellCheckerEnabled(false);
    session.setSpellCheckerEnabled(true);
  }
  session.on('spellcheck-dictionary-initialized', refresh);

  set(enabled);
  return { set, refresh, isEnabled: () => on };
}

module.exports = {
  defaultSpellcheckEnabled,
  resolveSpellcheckSetting,
  pickSpellcheckLanguage,
  createSpellcheckController
};
