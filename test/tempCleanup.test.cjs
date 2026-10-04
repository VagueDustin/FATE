'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { removeStaleTempFiles, STALE_AFTER_MS } = require('../electron/tempCleanup.cjs');

function scratchDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fate-tempclean-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function touch(dir, name, ageMs) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'x');
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

const DAY = 24 * 60 * 60 * 1000;

test('removes FATE temp files older than a day', async (t) => {
  const dir = scratchDir(t);
  touch(dir, 'FATE-preview-1234.pdf', 2 * DAY);
  touch(dir, 'fate-ps-1234-7.ps1', 2 * DAY);
  touch(dir, 'fate-registration-1234.reg', 2 * DAY);
  const removed = await removeStaleTempFiles(dir);
  assert.deepEqual(removed.sort(), ['FATE-preview-1234.pdf', 'fate-ps-1234-7.ps1', 'fate-registration-1234.reg']);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('keeps young files: another FATE may have that preview open right now', async (t) => {
  const dir = scratchDir(t);
  touch(dir, 'FATE-preview-99.pdf', 60 * 1000);
  touch(dir, 'fate-ps-99-0.ps1', STALE_AFTER_MS - 60 * 1000);
  assert.deepEqual(await removeStaleTempFiles(dir), []);
  assert.equal(fs.readdirSync(dir).length, 2);
});

test('keeps anything that is not exactly one of our names', async (t) => {
  const dir = scratchDir(t);
  for (const name of [
    'FATE-preview-.pdf',
    'FATE-preview-12.pdf.bak',
    'fate-preview-12.pdf', // case matters: we write FATE-preview
    'my-FATE-preview-12.pdf',
    'fate-ps-12.ps1',
    'fate-registration-x.reg',
    'report.pdf',
    'notes.md'
  ]) {
    touch(dir, name, 10 * DAY);
  }
  assert.deepEqual(await removeStaleTempFiles(dir), []);
  assert.equal(fs.readdirSync(dir).length, 8);
});

test('never follows or removes a symlink, and never a folder', async (t) => {
  const dir = scratchDir(t);
  const target = touch(dir, 'precious.txt', 10 * DAY);
  fs.symlinkSync(target, path.join(dir, 'FATE-preview-1.pdf'));
  fs.mkdirSync(path.join(dir, 'fate-registration-2.reg'));
  const old = new Date(Date.now() - 10 * DAY);
  fs.utimesSync(path.join(dir, 'fate-registration-2.reg'), old, old);
  assert.deepEqual(await removeStaleTempFiles(dir), []);
  assert.ok(fs.existsSync(target));
  assert.ok(fs.lstatSync(path.join(dir, 'FATE-preview-1.pdf')).isSymbolicLink());
});

test('a missing folder is not an error', async () => {
  assert.deepEqual(await removeStaleTempFiles(path.join(os.tmpdir(), 'fate-no-such-dir-' + process.pid)), []);
});
