'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedNavigation,
  classifyExternalUrl,
  resolveLocalImagePath,
  MAX_EXTERNAL_URL_LENGTH
} = require('../electron/linkSecurity.cjs');

/* ── isAllowedNavigation ─────────────────────────────────────────────────────────────────────── */

const LINUX_ENTRY = { entryUrl: 'file:///opt/FATE/resources/app.asar/dist/index.html' };
const WIN_ENTRY = { entryUrl: 'file:///C:/Program%20Files/FATE/resources/app.asar/dist/index.html' };

test('navigation: the exact entry document is allowed, with or without a #hash', () => {
  assert.equal(isAllowedNavigation('file:///opt/FATE/resources/app.asar/dist/index.html', LINUX_ENTRY, 'linux'), true);
  assert.equal(isAllowedNavigation('file:///opt/FATE/resources/app.asar/dist/index.html#/x', LINUX_ENTRY, 'linux'), true);
});

test('navigation: a relative link resolved against the page (C1) is refused', () => {
  // [Contributing](CONTRIBUTING.md) in a document becomes dist/CONTRIBUTING.md.
  assert.equal(isAllowedNavigation('file:///opt/FATE/resources/app.asar/dist/CONTRIBUTING.md', LINUX_ENTRY, 'linux'), false);
  assert.equal(isAllowedNavigation('file:///opt/FATE/resources/app.asar/dist/', LINUX_ENTRY, 'linux'), false);
  assert.equal(isAllowedNavigation('file:///opt/FATE/resources/app.asar/dist/index.html/x', LINUX_ENTRY, 'linux'), false);
  assert.equal(isAllowedNavigation('file:///opt/FATE/resources/app.asar/dist/assets/index.js', LINUX_ENTRY, 'linux'), false);
});

test('navigation: a query string, another file, another scheme or garbage is refused', () => {
  assert.equal(isAllowedNavigation('file:///opt/FATE/resources/app.asar/dist/index.html?x=1', LINUX_ENTRY, 'linux'), false);
  assert.equal(isAllowedNavigation('file:///home/me/notes.md', LINUX_ENTRY, 'linux'), false);
  assert.equal(isAllowedNavigation('https://example.com/', LINUX_ENTRY, 'linux'), false);
  assert.equal(isAllowedNavigation('devtools://devtools/bundled/inspector.html', LINUX_ENTRY, 'linux'), false);
  assert.equal(isAllowedNavigation('javascript:alert(1)', LINUX_ENTRY, 'linux'), false);
  assert.equal(isAllowedNavigation('not a url', LINUX_ENTRY, 'linux'), false);
  assert.equal(isAllowedNavigation(undefined, LINUX_ENTRY, 'linux'), false);
});

test('navigation: Linux paths compare case-sensitively', () => {
  assert.equal(isAllowedNavigation('file:///opt/fate/resources/app.asar/dist/index.html', LINUX_ENTRY, 'linux'), false);
});

test('navigation: Windows compares decoded paths case-insensitively', () => {
  // Chromium's encoding of the same path need not match pathToFileURL's byte for byte.
  assert.equal(isAllowedNavigation('file:///c:/program files/fate/resources/app.asar/dist/INDEX.html', WIN_ENTRY, 'win32'), true);
  assert.equal(isAllowedNavigation('file:///C:/Program%20Files/FATE/resources/app.asar/dist/index.html#top', WIN_ENTRY, 'win32'), true);
  assert.equal(isAllowedNavigation('file:///C:/Program%20Files/FATE/resources/app.asar/dist/README.md', WIN_ENTRY, 'win32'), false);
  // Same path on another machine (UNC) is not the app.
  assert.equal(isAllowedNavigation('file://server/C:/Program%20Files/FATE/resources/app.asar/dist/index.html', WIN_ENTRY, 'win32'), false);
});

test('navigation: non-ASCII install paths match however they are encoded', () => {
  const entry = { entryUrl: 'file:///C:/Users/Zo%C3%AB/AppData/Local/Programs/fate/resources/app.asar/dist/index.html' };
  assert.equal(isAllowedNavigation('file:///C:/Users/Zoë/AppData/Local/Programs/fate/resources/app.asar/dist/index.html', entry, 'win32'), true);
});

test('navigation: dev allows the dev server origin only', () => {
  const dev = { devServerUrl: 'http://localhost:5173' };
  assert.equal(isAllowedNavigation('http://localhost:5173/', dev, 'linux'), true);
  assert.equal(isAllowedNavigation('http://localhost:5173/src/App.jsx?t=1', dev, 'linux'), true);
  assert.equal(isAllowedNavigation('http://localhost:5174/', dev, 'linux'), false);
  assert.equal(isAllowedNavigation('http://127.0.0.1:5173/', dev, 'linux'), false);
  assert.equal(isAllowedNavigation('file:///home/me/notes.md', dev, 'linux'), false);
});

/* ── classifyExternalUrl ─────────────────────────────────────────────────────────────────────── */

test('external: http and https are web links (confirmed before opening)', () => {
  assert.deepEqual(classifyExternalUrl('https://example.com/a?b=c#d'), { kind: 'web', url: 'https://example.com/a?b=c#d' });
  assert.deepEqual(classifyExternalUrl('HTTP://Example.com'), { kind: 'web', url: 'http://example.com/' });
});

test('external: mailto opens directly', () => {
  assert.deepEqual(classifyExternalUrl('mailto:someone@example.com?subject=Hi'), {
    kind: 'mailto',
    url: 'mailto:someone@example.com?subject=Hi'
  });
});

test('external: everything else is refused', () => {
  for (const url of [
    'file:///C:/Users/me/Downloads/setup.exe',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://example.com/123',
    'ms-settings:privacy',
    'steam://run/123',
    'vscode://file/C:/x',
    'search-ms:query=x',
    'smb://host/share',
    'ftp://example.com/',
    'fate-local://local/etc/passwd',
    'CONTRIBUTING.md',
    '//example.com/x',
    'https://',
    '',
    null,
    undefined,
    42
  ]) {
    assert.equal(classifyExternalUrl(url), null, String(url));
  }
});

test('external: the canonical form is what gets opened', () => {
  // Leading/trailing whitespace and control characters are stripped by the URL parser.
  assert.deepEqual(classifyExternalUrl('  https://example.com/ \n'), { kind: 'web', url: 'https://example.com/' });
  assert.equal(classifyExternalUrl('\u0000javascript:alert(1)'), null);
});

test('external: absurdly long URLs are refused', () => {
  assert.equal(classifyExternalUrl(`https://example.com/${'a'.repeat(MAX_EXTERNAL_URL_LENGTH)}`), null);
});

/* ── resolveLocalImagePath ───────────────────────────────────────────────────────────────────── */

const ok = (filePath) => ({ ok: true, filePath });

test('fate-local: POSIX image paths are served, decoded and normalised', () => {
  assert.deepEqual(resolveLocalImagePath('fate-local://local/home/me/docs/img.png', 'linux'), ok('/home/me/docs/img.png'));
  assert.deepEqual(resolveLocalImagePath('fate-local://local/home/me/My%20Pics/a%23b.JPG', 'linux'), ok('/home/me/My Pics/a#b.JPG'));
  assert.deepEqual(resolveLocalImagePath('fate-local://local/home/me/docs/../img.svg', 'linux'), ok('/home/me/img.svg'));
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'apng']) {
    assert.equal(resolveLocalImagePath(`fate-local://local/tmp/x.${ext}`, 'linux').ok, true, ext);
  }
});

test('fate-local: Windows drive paths are served', () => {
  assert.deepEqual(resolveLocalImagePath('fate-local://local/C%3A/Users/me/Pictures/shot.png', 'win32'), ok('C:\\Users\\me\\Pictures\\shot.png'));
  assert.deepEqual(resolveLocalImagePath('fate-local://local/d:/x/y.PNG', 'win32'), ok('d:\\x\\y.PNG'));
});

test('fate-local: network paths are refused before anything touches the disk (C5)', () => {
  // ![](//attacker.example/share/x.png) → fate-local://local//attacker.example/share/x.png
  for (const [url, platform] of [
    ['fate-local://local//attacker.example/share/x.png', 'win32'],
    ['fate-local://local//attacker.example/share/x.png', 'linux'],
    ['fate-local://local/%5C%5Cattacker.example%5Cshare%5Cx.png', 'win32'],
    ['fate-local://local/%5C%5Cattacker.example%5Cshare%5Cx.png', 'linux'],
    ['fate-local://local/%2F%2Fattacker.example/share/x.png', 'linux'],
    // Mixed separators are one UNC root on Windows: '/\host/share' is \\host\share.
    ['fate-local://local/%5Cattacker.example%5Cshare%5Cx.png', 'win32'],
    // Device and long-path roots.
    ['fate-local://local/%5C%5C%3F%5CUNC%5Chost%5Cshare%5Cx.png', 'win32'],
    ['fate-local://local/%5C%5C.%5Cpipe%5Cx.png', 'win32'],
    ['fate-local://local/%5C%5C%3F%5CC%3A%5Cx.png', 'win32']
  ]) {
    const result = resolveLocalImagePath(url, platform);
    assert.equal(result.ok, false, `${platform} ${url}`);
    assert.equal(result.status, 403, `${platform} ${url}`);
  }
});

test('fate-local: relative and drive-relative paths are refused', () => {
  assert.equal(resolveLocalImagePath('fate-local://local/C%3Aimg.png', 'win32').status, 403);
  assert.equal(resolveLocalImagePath('fate-local://local/img.png', 'win32').status, 403); // \img.png: current drive
  assert.equal(resolveLocalImagePath('fate-local://local/', 'linux').status, 403);
});

test('fate-local: only images are served', () => {
  for (const url of [
    'fate-local://local/home/me/.ssh/id_rsa',
    'fate-local://local/etc/passwd',
    'fate-local://local/home/me/notes.md',
    'fate-local://local/home/me/page.html',
    'fate-local://local/home/me/x.png.exe',
    'fate-local://local/home/me/x.png/',
    'fate-local://local/home/me/.png'
  ]) {
    const result = resolveLocalImagePath(url, 'linux');
    assert.equal(result.ok, false, url);
    assert.equal(result.status, 403, url);
  }
  assert.equal(resolveLocalImagePath('fate-local://local/C%3A/Windows/win.ini', 'win32').status, 403);
});

test('fate-local: Windows device names are refused whatever the extension', () => {
  for (const name of ['CON.png', 'nul.jpg', 'COM1.png', 'lpt9.gif', 'aux.tar.png', 'COM1 .png']) {
    assert.equal(resolveLocalImagePath(`fate-local://local/C%3A/x/${encodeURIComponent(name)}`, 'win32').status, 403, name);
  }
  assert.equal(resolveLocalImagePath('fate-local://local/C%3A/x/console.png', 'win32').ok, true);
  assert.equal(resolveLocalImagePath('fate-local://local/home/me/CON.png', 'linux').ok, true); // just a name on Linux
});

test('fate-local: malformed requests are 400', () => {
  for (const url of [
    'fate-local://local/home/me/%E0%A4%A.png', // broken percent-encoding
    'fate-local://local/home/me/a%00.png', // NUL
    'fate-local://elsewhere/home/me/a.png', // not the fixed host
    'https://local/home/me/a.png',
    'garbage'
  ]) {
    assert.equal(resolveLocalImagePath(url, 'linux').status, 400, url);
  }
});
