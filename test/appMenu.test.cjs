'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MENU_COMMANDS,
  RELEASES_URL,
  ISSUES_URL,
  bindingToAccelerator,
  sanitizeMenuShortcuts,
  escapeMenuLabel,
  recentFileLabel,
  buildAppMenuTemplate,
  buildTabMenuTemplate,
  buildPreviewMenuTemplate
} = require('../electron/appMenu.cjs');

/* ── bindingToAccelerator ────────────────────────────────────────────────────────────────────── */

test('accelerators: FATE bindings translate to Electron syntax', () => {
  const cases = {
    'Control+S': 'Ctrl+S',
    'Control+Shift+S': 'Ctrl+Shift+S',
    'Control+t': 'Ctrl+T',
    'Control+\\': 'Ctrl+\\',
    'Control+,': 'Ctrl+,',
    'Control+Tab': 'Ctrl+Tab',
    'Control+Shift+Tab': 'Ctrl+Shift+Tab',
    'Alt+Home': 'Alt+Home',
    'Escape': 'Esc',
    'F5': 'F5',
    'Shift+F12': 'Shift+F12',
    'Control+F24': 'Ctrl+F24',
    'Control+ArrowUp': 'Ctrl+Up',
    'Control+PageDown': 'Ctrl+PageDown',
    'Control+Space': 'Ctrl+Space',
    'Control+Enter': 'Ctrl+Enter',
    'Meta+K': 'Super+K',
    'Control+Alt+Shift+Meta+X': 'Ctrl+Alt+Shift+Super+X',
    'Control+Shift+?': 'Ctrl+Shift+?',
    'Control+1': 'Ctrl+1',
    'Control+=': 'Ctrl+=',
    'Control+-': 'Ctrl+-',
    'Control+Plus': 'Ctrl+Plus'
  };
  for (const [binding, accelerator] of Object.entries(cases)) {
    assert.equal(bindingToAccelerator(binding), accelerator, binding);
  }
});

test('accelerators: the + key, recorded as a trailing "++", becomes Plus', () => {
  assert.equal(bindingToAccelerator('Control++'), 'Ctrl+Plus');
  assert.equal(bindingToAccelerator('Control+Shift++'), 'Ctrl+Shift+Plus');
  assert.equal(bindingToAccelerator('+'), 'Plus');
});

test('accelerators: anything Electron cannot show gets no label', () => {
  for (const binding of [
    '',
    null,
    undefined,
    42,
    'Control+',
    'Control++Shift',
    '+Control',
    'Control',
    'Control+Shift',
    'Control+Control+S',
    'Ctrl+S', // not FATE's format
    'Hyper+S',
    'Control+é',
    'Control+ß',
    'Control+Dead',
    'Control+Unidentified',
    'Control+F25',
    'Control+F0',
    'Control+AudioVolumeUp',
    'Control+ContextMenu',
    `Control+${'X'.repeat(80)}`
  ]) {
    assert.equal(bindingToAccelerator(binding), null, String(binding));
  }
});

test('sanitizeMenuShortcuts keeps known ids with short string values', () => {
  assert.deepEqual(
    sanitizeMenuShortcuts({ save: 'Control+S', nextTab: 'Control+Tab', palette: 7, find: 'x'.repeat(65), gotoLine: 'Control+G' }),
    { save: 'Control+S', gotoLine: 'Control+G' }
  );
  assert.deepEqual(sanitizeMenuShortcuts(null), {});
  assert.deepEqual(sanitizeMenuShortcuts(['Control+S']), {});
  assert.deepEqual(sanitizeMenuShortcuts('Control+S'), {});
});

/* ── labels ──────────────────────────────────────────────────────────────────────────────────── */

test('labels: ampersands from file names are escaped, not mnemonics', () => {
  assert.equal(escapeMenuLabel('R&D notes.md'), 'R&&D notes.md');
  assert.equal(recentFileLabel('/home/me/R&D/a&b.md', { homeDir: '/home/me', platform: 'linux' }), '~/R&&D/a&&b.md');
});

test('labels: home is ~ on Linux only, and only for whole path segments', () => {
  assert.equal(recentFileLabel('/home/me/notes.md', { homeDir: '/home/me', platform: 'linux' }), '~/notes.md');
  assert.equal(recentFileLabel('/home/meg/notes.md', { homeDir: '/home/me', platform: 'linux' }), '/home/meg/notes.md');
  assert.equal(recentFileLabel('C:\\Users\\me\\notes.md', { homeDir: 'C:\\Users\\me', platform: 'win32' }), 'C:\\Users\\me\\notes.md');
});

test('labels: long paths keep their start and the file name', () => {
  const long = `/home/me/${'deeply/'.repeat(20)}nested/important-file-name.md`;
  const label = recentFileLabel(long, { homeDir: '/home/me', platform: 'linux', maxLength: 60 });
  assert.equal(label.length, 60);
  assert.ok(label.startsWith('~/deeply'), label);
  assert.ok(label.endsWith('important-file-name.md'), label);
  assert.ok(label.includes('…'), label);
});

/* ── the application menu ────────────────────────────────────────────────────────────────────── */

function flatten(items, out = []) {
  for (const item of items) {
    out.push(item);
    if (Array.isArray(item.submenu)) flatten(item.submenu, out);
  }
  return out;
}

function makeActions() {
  const calls = [];
  return {
    calls,
    actions: {
      command: (id) => calls.push(['command', id]),
      openRecent: (p) => calls.push(['openRecent', p]),
      clearRecent: () => calls.push(['clearRecent']),
      checkForUpdates: () => calls.push(['checkForUpdates']),
      openUrl: (url) => calls.push(['openUrl', url])
    }
  };
}

test('menu: File, Edit, View, Help', () => {
  const { actions } = makeActions();
  const template = buildAppMenuTemplate({ isPackaged: true, platform: 'win32' }, actions);
  assert.deepEqual(template.map((m) => m.label), ['&File', '&Edit', '&View', '&Help']);
});

test('menu: no Reload or Force Reload anywhere (C2), packaged or not', () => {
  for (const isPackaged of [true, false]) {
    const { actions } = makeActions();
    const items = flatten(buildAppMenuTemplate({ isPackaged, platform: 'linux' }, actions));
    for (const item of items) {
      assert.ok(!/reload/i.test(item.role || ''), `role ${item.role}`);
      assert.ok(!/reload/i.test(item.label || ''), `label ${item.label}`);
      assert.ok(!/\bR$/.test(item.accelerator || '') || item.registerAccelerator === false, `accelerator ${item.accelerator}`);
    }
  }
});

test('menu: Toggle Developer Tools only when not packaged', () => {
  const { actions } = makeActions();
  const packaged = flatten(buildAppMenuTemplate({ isPackaged: true }, actions));
  const dev = flatten(buildAppMenuTemplate({ isPackaged: false }, actions));
  assert.equal(packaged.some((i) => /devtools/i.test(i.role || '')), false);
  assert.equal(dev.filter((i) => /devtools/i.test(i.role || '')).length, 1);
});

test('menu: every renderer command is display-only and sends its id', () => {
  const { actions, calls } = makeActions();
  const items = flatten(buildAppMenuTemplate({ isPackaged: true }, actions));
  const commandItems = items.filter((i) => MENU_COMMANDS.includes(i.id));
  // Every id in the contract has exactly one menu item.
  assert.deepEqual(commandItems.map((i) => i.id).sort(), [...MENU_COMMANDS].sort());
  for (const item of commandItems) {
    assert.equal(item.registerAccelerator, false, item.id);
    assert.equal(item.role, undefined, item.id);
    item.click();
  }
  assert.deepEqual(calls.map((c) => c[1]).sort(), [...MENU_COMMANDS].sort());
});

test('menu: shortcut labels follow the renderer, with fixed ones as fallback', () => {
  const { actions } = makeActions();
  const shortcuts = { save: 'Control+Alt+S', newFile: 'Control+N', palette: 'Control+é', gotoLine: 'Control+G' };
  const items = flatten(buildAppMenuTemplate({ shortcuts, isPackaged: true }, actions));
  const byId = Object.fromEntries(items.filter((i) => i.id).map((i) => [i.id, i]));
  assert.equal(byId.save.accelerator, 'Ctrl+Alt+S');
  assert.equal(byId.newFile.accelerator, 'Ctrl+N');
  assert.equal(byId.palette.accelerator, undefined); // untranslatable: no label
  assert.equal(byId.gotoLine.accelerator, 'Ctrl+G');
  assert.equal(byId.gotoSymbol.accelerator, undefined); // no binding: no label
  assert.equal(byId.undo.accelerator, 'Ctrl+Z');
  assert.equal(byId.redo.accelerator, 'Ctrl+Y');
  assert.equal(byId.find.accelerator, 'Ctrl+F');
  // A renderer binding for a fixed id wins.
  const rebound = flatten(buildAppMenuTemplate({ shortcuts: { find: 'Control+Shift+F' } }, actions));
  assert.equal(rebound.find((i) => i.id === 'find').accelerator, 'Ctrl+Shift+F');
});

test('menu: Cut, Copy, Paste and Select All are roles that never register their keys', () => {
  const { actions } = makeActions();
  const items = flatten(buildAppMenuTemplate({ isPackaged: true }, actions));
  for (const role of ['cut', 'copy', 'paste', 'selectAll']) {
    const item = items.find((i) => i.role === role);
    assert.ok(item, role);
    assert.equal(item.registerAccelerator, false, role);
  }
  // No undo/redo roles: CodeMirror owns history.
  assert.equal(items.some((i) => i.role === 'undo' || i.role === 'redo'), false);
});

test('menu: zoom, full screen and Exit are real roles', () => {
  const { actions } = makeActions();
  const items = flatten(buildAppMenuTemplate({ isPackaged: true }, actions));
  const roles = items.map((i) => i.role).filter(Boolean);
  for (const role of ['resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen', 'quit']) assert.ok(roles.includes(role), role);
  const hiddenZoom = items.find((i) => i.id === 'zoomInEquals');
  assert.equal(hiddenZoom.visible, false);
  assert.equal(hiddenZoom.accelerator, 'CommandOrControl+=');
});

test('menu: Open Recent lists the files and clears them', () => {
  const { actions, calls } = makeActions();
  const recentFiles = ['/home/me/a.md', '/home/me/b&c.txt', null, ''];
  const template = buildAppMenuTemplate({ recentFiles, homeDir: '/home/me', platform: 'linux' }, actions);
  const recent = template[0].submenu.find((i) => i.id === 'openRecent').submenu;
  assert.deepEqual(recent.map((i) => i.label || i.type), ['~/a.md', '~/b&&c.txt', 'separator', 'Clear Recently Opened']);
  recent[1].click();
  recent[3].click();
  assert.deepEqual(calls, [['openRecent', '/home/me/b&c.txt'], ['clearRecent']]);
});

test('menu: Open Recent with nothing in it says so', () => {
  const { actions } = makeActions();
  const template = buildAppMenuTemplate({ recentFiles: [] }, actions);
  const recent = template[0].submenu.find((i) => i.id === 'openRecent').submenu;
  assert.equal(recent[0].label, 'No Recent Files');
  assert.equal(recent[0].enabled, false);
  assert.equal(recent.find((i) => i.id === 'clearRecent').enabled, false);
});

test('menu: Help links and the update check', () => {
  const { actions, calls } = makeActions();
  const items = flatten(buildAppMenuTemplate({}, actions));
  items.find((i) => i.id === 'releaseNotes').click();
  items.find((i) => i.id === 'reportIssue').click();
  items.find((i) => i.id === 'checkForUpdates').click();
  assert.deepEqual(calls, [['openUrl', RELEASES_URL], ['openUrl', ISSUES_URL], ['checkForUpdates']]);
  assert.match(RELEASES_URL, /^https:\/\/github\.com\/VagueDustin\/FATE\//);
  assert.match(ISSUES_URL, /^https:\/\/github\.com\/VagueDustin\/FATE\//);
});

test('menu: ids are unique', () => {
  const { actions } = makeActions();
  const ids = flatten(buildAppMenuTemplate({ recentFiles: ['/a', '/b'], isPackaged: false }, actions)).map((i) => i.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
});

/* ── tab and preview menus ───────────────────────────────────────────────────────────────────── */

test('tab menu: actions in the contract, path items need a path', () => {
  const picked = [];
  const pick = (action) => () => picked.push(action);
  const withPath = buildTabMenuTemplate({ hasPath: true }, pick);
  assert.deepEqual(withPath.map((i) => i.id || i.type), ['copyPath', 'reveal', 'separator', 'close', 'closeOthers', 'closeRight']);
  assert.deepEqual(withPath.map((i) => i.label).filter(Boolean), [
    'Copy Full Path', 'Open Containing Folder', 'Close', 'Close Others', 'Close Tabs to the Right'
  ]);
  withPath.filter((i) => i.click).forEach((i) => i.click());
  assert.deepEqual(picked, ['copyPath', 'reveal', 'close', 'closeOthers', 'closeRight']);

  const untitled = buildTabMenuTemplate({ hasPath: false }, pick);
  assert.equal(untitled.find((i) => i.id === 'copyPath').enabled, false);
  assert.equal(untitled.find((i) => i.id === 'reveal').enabled, false);
  assert.notEqual(untitled.find((i) => i.id === 'close').enabled, false);
});

test('preview menu: only Close Preview', () => {
  const items = flatten(buildPreviewMenuTemplate());
  assert.deepEqual(items.map((i) => i.role).filter(Boolean), ['close']);
});
