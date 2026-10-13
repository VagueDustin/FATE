'use strict';
// The decision only: nothing here touches the registry.
const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldSelfRegister, isIsolatedProfile } = require('../electron/windowsRegistration.cjs');

const EXE = 'C:\\Program Files\\FATE - Formatted Article & Text Editor\\FATE.exe';
const installed = { platform: 'win32', isPackaged: true, isWindowsStore: false, env: {}, argv: [EXE] };

test('an everyday launch of the installed build registers', () => {
  assert.equal(shouldSelfRegister(installed), true);
  // Opened from Explorer with a file, or with Chromium flags of its own.
  assert.equal(shouldSelfRegister({ ...installed, argv: [EXE, 'C:\\notes\\a.md', '--original-process-start-time=1'] }), true);
  // A per-user install somewhere else (the installer lets the user pick the folder).
  assert.equal(shouldSelfRegister({ ...installed, argv: ['D:\\Apps\\FATE\\FATE.exe'] }), true);
});

test('Linux, unpackaged runs and the Store package never register', () => {
  assert.equal(shouldSelfRegister({ ...installed, platform: 'linux' }), false);
  assert.equal(shouldSelfRegister({ ...installed, isPackaged: false }), false);
  assert.equal(shouldSelfRegister({ ...installed, isWindowsStore: true }), false);
});

test('a launch on its own profile (FATE_USER_DATA) does not register', () => {
  assert.equal(shouldSelfRegister({ ...installed, env: { FATE_USER_DATA: 'C:\\scratch\\profile' } }), false);
  // Set but empty is not an override: main.cjs ignores it too and uses the real profile.
  assert.equal(shouldSelfRegister({ ...installed, env: { FATE_USER_DATA: '' } }), true);
});

test('a launch with --user-data-dir does not register, in either spelling', () => {
  assert.equal(shouldSelfRegister({ ...installed, argv: [EXE, '--user-data-dir=C:\\scratch\\profile'] }), false);
  assert.equal(shouldSelfRegister({ ...installed, argv: [EXE, '--user-data-dir', 'C:\\scratch\\profile', 'a.md'] }), false);
  // Only the switch itself counts: not a file that happens to be named like it, nor a lookalike.
  assert.equal(shouldSelfRegister({ ...installed, argv: [EXE, 'C:\\notes\\--user-data-dir.md'] }), true);
  assert.equal(shouldSelfRegister({ ...installed, argv: [EXE, '--user-data-directory=x'] }), true);
});

test('isIsolatedProfile tolerates missing input', () => {
  assert.equal(isIsolatedProfile(), false);
  assert.equal(isIsolatedProfile({ env: {}, argv: null }), false);
  assert.equal(shouldSelfRegister(), false);
});
