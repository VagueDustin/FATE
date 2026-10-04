'use strict';
/* Error wording in electron/fsAccess.cjs. Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const { describeFsError } = require('../electron/fsAccess.cjs');

const err = (code, message = `${code}: raw message, open '/x/.notes.md.123-ab.fate-tmp'`) => Object.assign(new Error(message), { code });
const snapEnv = { SNAP: '/snap/fate/1', SNAP_NAME: 'fate', SNAP_REAL_HOME: '/home/me' };

test('common failures are described in plain words, without the temporary file', () => {
  const d = describeFsError(err('ENOSPC'), '/home/me/notes.md', 'save');
  assert.equal(d.short, "Can't save notes.md: the disk is full");
  assert.equal(d.reason, 'the disk is full');
  assert.equal(d.advice, null);
  assert.match(d.message, /notes\.md could not be saved\.\n\nThe disk is full\./);
  assert.doesNotMatch(d.short + d.message, /fate-tmp/);
  assert.equal(describeFsError(err('EROFS'), '/mnt/cd/a.txt', 'save').short, "Can't save a.txt: the drive is read-only");
  assert.equal(describeFsError(err('EBUSY'), 'C:\\a.txt', 'save').reason, 'another program is using it');
});

test('unknown errors keep the raw detail', () => {
  const d = describeFsError(err('EWEIRD', 'something odd'), '/a/b.txt', 'open');
  assert.equal(d.short, 'something odd');
  assert.equal(d.reason, 'something odd');
});

test('permission denied, outside a snap', () => {
  const d = describeFsError(err('EACCES'), '/etc/shadow', 'open', { env: {} });
  assert.equal(d.title, 'Permission denied');
  assert.equal(d.short, 'Permission denied: shadow');
  assert.equal(d.reason, 'permission denied');
  assert.equal(d.advice, null);
});

test('snap: removable media not connected gives the connect command as advice', () => {
  const d = describeFsError(err('EACCES'), '/media/me/USB/notes.md', 'open', { env: snapEnv, isConnected: () => false });
  assert.equal(d.title, 'Removable drive not connected');
  assert.match(d.advice, /sudo snap connect fate:removable-media/);
  assert.doesNotMatch(d.reason, /notes\.md/);
});

test('snap: hidden folders in home', () => {
  const d = describeFsError(err('EACCES'), '/home/me/.config/app/settings.json', 'save', { env: snapEnv, isConnected: () => true });
  assert.equal(d.title, 'Hidden file not accessible');
  assert.match(d.advice, /\.deb, \.rpm or AppImage/);
});

test('snap: other denials', () => {
  const d = describeFsError(err('EPERM'), '/opt/x.txt', 'open', { env: snapEnv, isConnected: () => true });
  assert.equal(d.title, 'Permission denied');
  assert.match(d.advice, /is a snap/);
});
