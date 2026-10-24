'use strict';
/* electron/storeRecovery.cjs: starting on a config.json that does not parse. Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../electron/storeRecovery.cjs');

const loadStore = async () => (await import('electron-store')).default;

function scratch(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fate-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  if (contents !== undefined) fs.writeFileSync(file, contents);
  return { dir, file };
}

const quiet = { warn: () => {}, now: () => 42 };

test('a corrupt config.json is set aside and the store starts on its defaults', async (t) => {
  const Store = await loadStore();
  for (const bad of ['', '{"theme": "fa', '\u0000\u0000\u0000']) {
    const { dir, file } = scratch(t, bad);
    const store = openStore(Store, file, { cwd: dir, defaults: { theme: 'fate' } }, quiet);
    assert.equal(store.get('theme'), 'fate');
    assert.equal(fs.readFileSync(`${file}.corrupt-42`, 'utf8'), bad, 'the original bytes are kept');
  }
});

test('a readable config.json is used as it is, and nothing is set aside', async (t) => {
  const Store = await loadStore();
  const { dir, file } = scratch(t, JSON.stringify({ theme: 'light' }));
  const store = openStore(Store, file, { cwd: dir, defaults: { theme: 'fate' } }, quiet);
  assert.equal(store.get('theme'), 'light');
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
});

test('a second instance (recover: false) rethrows rather than resetting the settings', async (t) => {
  const Store = await loadStore();
  const { dir, file } = scratch(t, '{"theme": "li');
  assert.throws(() => openStore(Store, file, { cwd: dir, defaults: { theme: 'fate' } }, { ...quiet, recover: false }), SyntaxError);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"theme": "li', 'the file is left alone');
});

test('errors other than a parse failure are not swallowed', () => {
  class Broken {
    constructor() {
      throw new TypeError('no userData');
    }
  }
  assert.throws(() => openStore(Broken, '/nowhere/config.json', {}, quiet), TypeError);
});
