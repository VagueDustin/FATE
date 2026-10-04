// Shortcut binding helpers and the sidebar width clamp (src/settingsMeta.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShortcut, normalizeBinding, bindingFromEvent, matchesShortcut, isAllowedShortcut,
  shortcutParts, formatShortcutLabel, toElectronAccelerator, resolveShortcuts,
  DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, clampSidebarWidth
} from '../src/settingsMeta.js';

/** A KeyboardEvent-shaped object. */
const key = (k, mods = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta
});

test('parseShortcut reads modifiers and the key', () => {
  assert.deepEqual(parseShortcut('Control+Shift+S'), { ctrl: true, shift: true, alt: false, meta: false, key: 'S' });
  assert.deepEqual(parseShortcut('Alt+Home'), { ctrl: false, shift: false, alt: true, meta: false, key: 'Home' });
  assert.deepEqual(parseShortcut('Escape'), { ctrl: false, shift: false, alt: false, meta: false, key: 'Escape' });
  assert.equal(parseShortcut('Control+\\').key, '\\');
  assert.equal(parseShortcut('Control+,').key, ',');
  assert.equal(parseShortcut('Meta+K').meta, true);
});

test('parseShortcut handles the + key in the new and the legacy form', () => {
  const plus = { ctrl: true, shift: false, alt: false, meta: false, key: 'Plus' };
  assert.deepEqual(parseShortcut('Control+Plus'), plus);
  assert.deepEqual(parseShortcut('Control++'), plus, 'legacy "Control++" (split on "+" gave an empty key)');
  assert.deepEqual(parseShortcut('Control+Shift++'), { ...plus, shift: true });
  assert.deepEqual(parseShortcut('+'), { ...plus, ctrl: false });
});

test('parseShortcut accepts aliases and normalises key names', () => {
  assert.deepEqual(parseShortcut('Ctrl+k'), parseShortcut('Control+K'));
  assert.equal(parseShortcut('Control+space').key, 'Space');
  assert.equal(parseShortcut('Control+Esc').key, 'Escape');
  assert.equal(parseShortcut('Alt+Up').key, 'ArrowUp');
  assert.equal(parseShortcut('f5').key, 'F5');
  assert.equal(parseShortcut('Super+E').meta, true);
});

test('parseShortcut rejects bindings with no key or unknown parts', () => {
  for (const bad of [undefined, null, '', '   ', 'Control', 'Control+Shift', 'Control+', 'Hyper+K', 'Control++S', 42]) {
    assert.equal(parseShortcut(bad), null, String(bad));
  }
});

test('normalizeBinding writes the canonical stored form', () => {
  assert.equal(normalizeBinding('Control++'), 'Control+Plus');
  assert.equal(normalizeBinding('Shift+Control+s'), 'Control+Shift+S');
  assert.equal(normalizeBinding('ctrl+alt+delete'), 'Control+Alt+Delete');
  assert.equal(normalizeBinding('nonsense+'), null);
});

test('every default binding is already in canonical form', () => {
  for (const { id, default: binding } of SHORTCUT_ACTIONS) {
    assert.equal(normalizeBinding(binding), binding, id);
    assert.ok(isAllowedShortcut(binding), `${id} default must be allowed`);
  }
});

test('bindingFromEvent records modifiers plus the key, in the stored form', () => {
  assert.equal(bindingFromEvent(key('s', { ctrl: true })), 'Control+S');
  assert.equal(bindingFromEvent(key('S', { ctrl: true, shift: true })), 'Control+Shift+S');
  assert.equal(bindingFromEvent(key('+', { ctrl: true, shift: true })), 'Control+Shift+Plus');
  assert.equal(bindingFromEvent(key('+', { ctrl: true })), 'Control+Plus');
  assert.equal(bindingFromEvent(key(' ', { ctrl: true })), 'Control+Space');
  assert.equal(bindingFromEvent(key('Home', { alt: true })), 'Alt+Home');
  assert.equal(bindingFromEvent(key('F5')), 'F5');
  assert.equal(bindingFromEvent(key('h')), 'H');
});

test('bindingFromEvent waits while only modifiers are held', () => {
  for (const k of ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'Process', '']) {
    assert.equal(bindingFromEvent(key(k, { ctrl: true })), null, k);
  }
});

test('recording then matching round-trips, including the + key and Space', () => {
  const presses = [
    key('k', { ctrl: true }),
    key('+', { ctrl: true }),
    key('+', { ctrl: true, shift: true }),
    key(' ', { ctrl: true }),
    key('Tab', { ctrl: true, shift: true }),
    key('\\', { ctrl: true }),
    key('F12')
  ];
  for (const e of presses) {
    const binding = bindingFromEvent(e);
    assert.ok(matchesShortcut(e, binding), `${binding} should match the press that recorded it`);
  }
});

test('matchesShortcut needs exactly the bound modifiers', () => {
  assert.ok(matchesShortcut(key('s', { ctrl: true }), 'Control+S'));
  assert.ok(matchesShortcut(key('S', { ctrl: true, shift: true }), 'Control+Shift+S'));
  assert.ok(!matchesShortcut(key('s', { ctrl: true, shift: true }), 'Control+S'));
  assert.ok(!matchesShortcut(key('s'), 'Control+S'));
  assert.ok(!matchesShortcut(key('s', { ctrl: true, alt: true }), 'Control+S'));
  assert.ok(matchesShortcut(key('+', { ctrl: true }), 'Control++'), 'legacy binding of the + key now fires');
  assert.ok(matchesShortcut(key('Escape'), 'Escape'));
  assert.ok(!matchesShortcut(key('Escape'), ''));
  assert.ok(!matchesShortcut(key('Escape'), undefined));
});

test('isAllowedShortcut: Ctrl, Alt or Meta required, except F1-F12 and a lone Escape', () => {
  for (const ok of ['Control+S', 'Alt+Home', 'Meta+K', 'Control+Shift+Plus', 'F1', 'F12', 'Shift+F5', 'Escape', 'Control+Escape']) {
    assert.ok(isAllowedShortcut(ok), ok);
  }
  for (const bad of ['H', 'Shift+H', 'Space', 'Tab', 'Shift+Tab', 'Enter', 'Home', 'F13', 'Shift+Escape', 'Plus', '', 'Control']) {
    assert.ok(!isAllowedShortcut(bad), bad);
  }
});

test('shortcutParts and formatShortcutLabel read like keycaps', () => {
  assert.deepEqual(shortcutParts('Control+Shift+S', 'linux'), ['Ctrl', 'Shift', 'S']);
  assert.equal(formatShortcutLabel('Control+Plus', 'win32'), 'Ctrl+Plus');
  assert.equal(formatShortcutLabel('Control++', 'win32'), 'Ctrl+Plus');
  assert.equal(formatShortcutLabel('Escape', 'linux'), 'Esc');
  assert.equal(formatShortcutLabel('Control+PageDown', 'linux'), 'Ctrl+PgDn');
  assert.equal(formatShortcutLabel('Alt+ArrowUp', 'linux'), 'Alt+Up');
  assert.equal(formatShortcutLabel('Meta+E', 'win32'), 'Win+E');
  assert.equal(formatShortcutLabel('Meta+E', 'linux'), 'Super+E');
  assert.equal(formatShortcutLabel('Meta+E'), 'Meta+E', 'no platform known (plain Node)');
  assert.equal(formatShortcutLabel(DEFAULT_SHORTCUTS.newFile, 'linux'), 'Ctrl+T');
  assert.deepEqual(shortcutParts('garbage+'), []);
});

test('toElectronAccelerator uses Electron key names', () => {
  assert.equal(toElectronAccelerator('Control+Shift+S'), 'Control+Shift+S');
  assert.equal(toElectronAccelerator('Control++'), 'Control+Plus');
  assert.equal(toElectronAccelerator('Alt+ArrowLeft'), 'Alt+Left');
  assert.equal(toElectronAccelerator('Control+,'), 'Control+,');
  assert.equal(toElectronAccelerator(''), null);
});

test('resolveShortcuts merges, migrates "++" and drops bindings that fire while typing', () => {
  const resolved = resolveShortcuts({
    save: 'Control+Alt+S', // a normal rebind survives
    closeTab: 'H', // the 1.13 recorder accepted bare letters: back to the default
    palette: 'Control++', // legacy + key: migrated
    print: 'Control++S', // unparseable: back to the default
    goHome: 'shift+home', // Shift alone doesn't count: back to the default
    removedAction: 'Control+Q' // no longer exists: dropped
  });
  assert.equal(resolved.save, 'Control+Alt+S');
  assert.equal(resolved.closeTab, DEFAULT_SHORTCUTS.closeTab);
  assert.equal(resolved.palette, 'Control+Plus');
  assert.equal(resolved.print, DEFAULT_SHORTCUTS.print);
  assert.equal(resolved.goHome, DEFAULT_SHORTCUTS.goHome);
  assert.ok(!('removedAction' in resolved));
  assert.deepEqual(resolveShortcuts(undefined), DEFAULT_SHORTCUTS);
  assert.deepEqual(resolveShortcuts({ close: 'Escape' }).close, 'Escape');
});

test('clampSidebarWidth keeps the width within 200-600', () => {
  assert.equal(clampSidebarWidth(450), 450);
  assert.equal(clampSidebarWidth(4), 200);
  assert.equal(clampSidebarWidth(99999), 600);
  assert.equal(clampSidebarWidth('320'), 320);
  assert.equal(clampSidebarWidth(250.6), 251);
  assert.equal(clampSidebarWidth(undefined), 300);
  assert.equal(clampSidebarWidth('abc'), 300);
  assert.equal(clampSidebarWidth(NaN, 280), 280);
});
