'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { candidateFilePaths } = require('../electron/launchArgs.cjs');

test('every argument after the executable, flags skipped', () => {
  assert.deepEqual(
    candidateFilePaths(['/opt/FATE/fate', '--no-sandbox', '/home/me/a.md', '--original-process-start-time=1', '/home/me/b.txt'], {
      cwd: '/home/me',
      platform: 'linux'
    }),
    ['/home/me/a.md', '/home/me/b.txt']
  );
});

test('relative paths resolve against the given working directory, not ours', () => {
  assert.deepEqual(candidateFilePaths(['fate', 'notes.md', '../x/y.md', './z.md'], { cwd: '/srv/project/docs', platform: 'linux' }), [
    '/srv/project/docs/notes.md',
    '/srv/project/x/y.md',
    '/srv/project/docs/z.md'
  ]);
});

test('Windows: drive paths, relative paths and UNC paths', () => {
  assert.deepEqual(
    candidateFilePaths(['C:\\Program Files\\FATE\\FATE.exe', 'notes.md', '..\\other\\a.txt', 'D:\\x\\b.md', '\\\\server\\share\\c.md'], {
      cwd: 'C:\\Users\\me\\Documents',
      platform: 'win32'
    }),
    ['C:\\Users\\me\\Documents\\notes.md', 'C:\\Users\\me\\other\\a.txt', 'D:\\x\\b.md', '\\\\server\\share\\c.md']
  );
});

test('file: URIs from desktop entries (%U) become paths', () => {
  assert.deepEqual(candidateFilePaths(['fate', 'file:///home/me/My%20Notes/a%23b.md'], { cwd: '/', platform: 'linux' }), [
    '/home/me/My Notes/a#b.md'
  ]);
  assert.deepEqual(candidateFilePaths(['FATE.exe', 'file:///C:/Users/me/a.md'], { cwd: 'C:\\', platform: 'win32' }), ['C:\\Users\\me\\a.md']);
  // A remote host has no local path on Linux; it is skipped, not guessed at.
  assert.deepEqual(candidateFilePaths(['fate', 'file://server/share/a.md'], { cwd: '/', platform: 'linux' }), []);
});

test('junk is skipped', () => {
  assert.deepEqual(candidateFilePaths(['fate', '', 'a\0b.md', null, 7], { cwd: '/tmp', platform: 'linux' }), []);
  assert.deepEqual(candidateFilePaths(undefined, { cwd: '/tmp', platform: 'linux' }), []);
  assert.deepEqual(candidateFilePaths(['fate'], { cwd: '/tmp', platform: 'linux' }), []);
});
