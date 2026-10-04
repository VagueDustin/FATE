'use strict';
/* Hot-exit backups in electron/backups.cjs. Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackupStore, MAX_BACKUPS } = require('../electron/backups.cjs');

function store(t, opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fate-backups-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return createBackupStore(path.join(root, 'backups'), opts);
}

const doc = (over = {}) => ({
  kind: 'code',
  name: 'script.ps1',
  path: '/home/me/script.ps1',
  content: 'Write-Host "unsaved"\n',
  format: { encoding: 'utf16le', bom: true, eol: '\r\n' },
  savedContent: 'Write-Host "saved"\n',
  untitled: false,
  ...over
});

test('write, list, remove round trip', async (t) => {
  let clock = 1000;
  const backups = store(t, { now: () => clock++ });
  await backups.write('tab-1', doc());
  await backups.write('tab_2', doc({ kind: 'markdown', name: 'Untitled-1', path: null, format: null, savedContent: null, untitled: true, editMode: true }));
  const listed = await backups.list();
  assert.deepEqual(listed, [
    { id: 'tab-1', savedAt: 1000, ...doc() },
    { id: 'tab_2', savedAt: 1001, kind: 'markdown', name: 'Untitled-1', path: null, content: 'Write-Host "unsaved"\n', format: null, savedContent: null, untitled: true, editMode: true }
  ]);

  await backups.write('tab-1', doc({ content: 'newer' }));
  assert.equal((await backups.list()).find((b) => b.id === 'tab-1').content, 'newer');

  await backups.remove('tab-1');
  await backups.remove('tab-1'); // already gone: fine
  assert.deepEqual((await backups.list()).map((b) => b.id), ['tab_2']);
});

test('ids that could escape the folder, or are not ids, are refused', async (t) => {
  const backups = store(t);
  for (const id of ['', '../evil', 'a/b', 'a b', 'x'.repeat(65), 'tab.1', null, 7, '..', 'C:']) {
    await assert.rejects(backups.write(id, doc()), (err) => err.code === 'BAD_ID', String(id));
    await assert.rejects(backups.remove(id), (err) => err.code === 'BAD_ID', String(id));
  }
  assert.deepEqual(await backups.list(), []);
});

test('data of the wrong shape is refused; an unusable format becomes null', async (t) => {
  const backups = store(t);
  for (const bad of [null, 'text', [], doc({ kind: 'image' }), doc({ content: 42 }), doc({ name: null }), doc({ path: 5 }), doc({ untitled: 'no' }), doc({ editMode: 1 }), doc({ savedContent: {} })]) {
    await assert.rejects(backups.write('x', bad), (err) => err.code === 'BAD_DATA', JSON.stringify(bad));
  }
  await backups.write('x', doc({ format: { encoding: 'klingon' }, extra: 'dropped' }));
  const [entry] = await backups.list();
  assert.equal(entry.format, null);
  assert.equal('extra' in entry, false);
  // Missing optional fields get their empty values.
  await backups.write('y', { kind: 'code', name: 'Untitled-2', content: 'x' });
  const y = (await backups.list()).find((b) => b.id === 'y');
  assert.deepEqual([y.path, y.format, y.savedContent, y.untitled], [null, null, null, false]);
});

test('corrupt and foreign files are skipped, never fatal', async (t) => {
  const backups = store(t);
  await backups.write('good', doc());
  const dir = backups.dir;
  fs.writeFileSync(path.join(dir, 'truncated.json'), '{"fate":"backup","version":1,"kind":"co');
  fs.writeFileSync(path.join(dir, 'notjson.json'), '\u0000\u0001binary');
  fs.writeFileSync(path.join(dir, 'wrongshape.json'), JSON.stringify({ fate: 'backup', kind: 'code', name: 3 }));
  fs.writeFileSync(path.join(dir, 'stranger.json'), JSON.stringify({ hello: 'world' }));
  fs.writeFileSync(path.join(dir, 'null.json'), 'null');
  fs.writeFileSync(path.join(dir, '.good.json.123-abcd.fate-tmp'), 'half a write');
  fs.writeFileSync(path.join(dir, 'README.txt'), 'not a backup');
  fs.mkdirSync(path.join(dir, 'folder.json'));
  assert.deepEqual((await backups.list()).map((b) => b.id), ['good']);
});

test('list on a fresh profile is empty', async (t) => {
  assert.deepEqual(await store(t).list(), []);
});

test('clear removes every backup and leftover', async (t) => {
  const backups = store(t);
  await backups.write('a', doc());
  await backups.write('b', doc());
  fs.writeFileSync(path.join(backups.dir, '.a.json.1-ff.fate-tmp'), 'x');
  await backups.clear();
  assert.deepEqual(fs.readdirSync(backups.dir), []);
  await store(t).clear(); // no folder yet: fine
});

test('a remove queued behind a write wins', async (t) => {
  const backups = store(t);
  const writing = backups.write('race', doc());
  const removing = backups.remove('race');
  await Promise.all([writing, removing]);
  assert.deepEqual(await backups.list(), []);
});

test('backups are private to the user', { skip: process.platform === 'win32' }, async (t) => {
  const backups = store(t);
  await backups.write('p', doc());
  assert.equal(fs.statSync(backups.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(backups.dir, 'p.json')).mode & 0o777, 0o600);
});

test('the number of backups is capped', async (t) => {
  const backups = store(t);
  for (let i = 0; i < MAX_BACKUPS; i++) await backups.write(`t${i}`, doc({ content: '' }));
  await assert.rejects(backups.write('one-too-many', doc()), (err) => err.code === 'TOO_MANY');
  await backups.write('t0', doc({ content: 'replacing an existing one is fine' }));
});
