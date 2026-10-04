'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  defaultSpellcheckEnabled,
  resolveSpellcheckSetting,
  pickSpellcheckLanguage,
  createSpellcheckController
} = require('../electron/spellcheck.cjs');

// What Electron 42 reports on Linux (session.availableSpellCheckerLanguages).
const AVAILABLE = ['af', 'bg', 'ca', 'cs', 'cy', 'da', 'de', 'de-DE', 'el', 'en', 'en-AU', 'en-CA', 'en-GB',
  'en-GB-oxendict', 'en-US', 'es', 'es-419', 'es-AR', 'es-ES', 'es-MX', 'es-US', 'et', 'fa', 'fo', 'fr',
  'fr-FR', 'gl', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'it', 'it-IT', 'ko', 'lt', 'lv', 'nb', 'nl', 'pl', 'pt',
  'pt-BR', 'pt-PT', 'ro', 'ru', 'sh', 'sk', 'sl', 'sq', 'sr', 'sv', 'ta', 'tg', 'tr', 'uk', 'vi'];

/** Records what the controller does to the session, in order. */
function fakeSession({ available = AVAILABLE, throwOnLanguages = false } = {}) {
  const ses = new EventEmitter();
  ses.calls = [];
  ses.enabled = true; // Electron's default
  ses.languages = ['en-US'];
  ses.availableSpellCheckerLanguages = available;
  ses.setSpellCheckerEnabled = (on) => {
    ses.calls.push(['enabled', on]);
    ses.enabled = on;
  };
  ses.setSpellCheckerLanguages = (langs) => {
    ses.calls.push(['languages', langs]);
    if (throwOnLanguages) throw new Error('Invalid language code provided');
    ses.languages = langs;
  };
  return ses;
}

test('default: on for Windows (its own checker), off elsewhere (dictionaries download)', () => {
  assert.equal(defaultSpellcheckEnabled('win32'), true);
  assert.equal(defaultSpellcheckEnabled('linux'), false);
  assert.equal(defaultSpellcheckEnabled('darwin'), false);
});

test('a stored boolean wins; anything else falls back to the default', () => {
  assert.equal(resolveSpellcheckSetting(true, 'linux'), true);
  assert.equal(resolveSpellcheckSetting(false, 'win32'), false);
  assert.equal(resolveSpellcheckSetting(undefined, 'win32'), true);
  assert.equal(resolveSpellcheckSetting(undefined, 'linux'), false);
  assert.equal(resolveSpellcheckSetting('yes', 'linux'), false);
  assert.equal(resolveSpellcheckSetting(1, 'linux'), false);
});

test('language: exact, then bare language, then regional, then US English', () => {
  assert.equal(pickSpellcheckLanguage(['en-GB', 'en-US'], AVAILABLE), 'en-GB');
  assert.equal(pickSpellcheckLanguage(['EN_us'], AVAILABLE), 'en-US');
  assert.equal(pickSpellcheckLanguage(['de-AT'], AVAILABLE), 'de');
  assert.equal(pickSpellcheckLanguage(['pt-MZ'], AVAILABLE), 'pt');
  assert.equal(pickSpellcheckLanguage(['es-CO'], ['es-ES', 'es-MX', 'en-US']), 'es-ES');
  assert.equal(pickSpellcheckLanguage(['ja-JP', 'fr-CA'], AVAILABLE), 'fr');
  assert.equal(pickSpellcheckLanguage(['ja-JP'], AVAILABLE), 'en-US');
  assert.equal(pickSpellcheckLanguage([], AVAILABLE), 'en-US');
  assert.equal(pickSpellcheckLanguage(['ja-JP'], ['ko']), null);
  assert.equal(pickSpellcheckLanguage([null, 7, ''], AVAILABLE), 'en-US');
  assert.equal(pickSpellcheckLanguage(['en-US'], undefined), null);
});

test('off: disabled AND no languages, so no dictionary is loaded or downloaded', () => {
  const ses = fakeSession();
  const ctl = createSpellcheckController(ses, { enabled: false, preferredLanguages: ['en-US'], platform: 'linux' });
  assert.equal(ctl.isEnabled(), false);
  assert.equal(ses.enabled, false);
  assert.deepEqual(ses.languages, []);
});

test('on: the user language, then enabled', () => {
  const ses = fakeSession();
  const ctl = createSpellcheckController(ses, { enabled: true, preferredLanguages: ['en-GB'], platform: 'linux' });
  assert.equal(ctl.isEnabled(), true);
  assert.deepEqual(ses.calls, [['languages', ['en-GB']], ['enabled', true]]);
});

test('runtime toggles restore and clear the language list', () => {
  const ses = fakeSession();
  const ctl = createSpellcheckController(ses, { enabled: false, preferredLanguages: ['de-DE'], platform: 'linux' });
  ctl.set(true);
  assert.deepEqual([ses.enabled, ses.languages], [true, ['de-DE']]);
  ctl.set(false);
  assert.deepEqual([ses.enabled, ses.languages], [false, []]);
  ctl.set('true'); // only a real boolean true turns it on
  assert.equal(ses.enabled, false);
});

test('a dictionary that finishes loading is pushed to renderers by re-enabling', () => {
  const ses = fakeSession();
  createSpellcheckController(ses, { enabled: true, preferredLanguages: ['en-US'], platform: 'linux' });
  ses.calls.length = 0;
  ses.emit('spellcheck-dictionary-initialized', {}, 'en-US');
  assert.deepEqual(ses.calls, [['enabled', false], ['enabled', true]]);
});

test('refresh() re-sends the state to renderers (called when the page has loaded)', () => {
  const ses = fakeSession();
  const ctl = createSpellcheckController(ses, { enabled: true, preferredLanguages: ['en-US'], platform: 'linux' });
  ses.calls.length = 0;
  ctl.refresh();
  assert.deepEqual(ses.calls, [['enabled', false], ['enabled', true]]);
  assert.equal(ses.enabled, true);
});

test('no re-enabling while the setting is off', () => {
  const ses = fakeSession();
  const ctl = createSpellcheckController(ses, { enabled: true, preferredLanguages: ['en-US'], platform: 'linux' });
  ctl.set(false);
  ses.calls.length = 0;
  ses.emit('spellcheck-dictionary-initialized', {}, 'en-US');
  ctl.refresh();
  assert.deepEqual(ses.calls, []);
  assert.equal(ses.enabled, false);
});

test('macOS: languages are never set (the system checker ignores them)', () => {
  const ses = fakeSession();
  const ctl = createSpellcheckController(ses, { enabled: true, preferredLanguages: ['en-US'], platform: 'darwin' });
  ctl.set(false);
  assert.equal(ses.calls.some(([kind]) => kind === 'languages'), false);
});

test('a language Electron rejects is reported, not thrown', () => {
  const warnings = [];
  const ses = fakeSession({ throwOnLanguages: true });
  const ctl = createSpellcheckController(ses, { enabled: true, preferredLanguages: ['en-US'], platform: 'linux', warn: (m) => warnings.push(m) });
  assert.equal(ctl.isEnabled(), true);
  assert.equal(ses.enabled, true);
  assert.equal(warnings.length, 1);
});
