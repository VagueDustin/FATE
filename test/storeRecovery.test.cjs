'use strict';
/*
 * electron/main.cjs openStore() recovers from a config.json that does not parse by catching the
 * SyntaxError electron-store throws for it. This pins that contract: if an upgrade starts throwing
 * something else, FATE would go back to refusing to start. Run: node --test test/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('a corrupt config.json throws a SyntaxError, and clearInvalidConfig recovers', async (t) => {
  const { default: Store } = await import('electron-store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fate-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const bad of ['', '{"theme": "fa', '\u0000\u0000\u0000']) {
    fs.writeFileSync(path.join(dir, 'config.json'), bad);
    assert.throws(() => new Store({ cwd: dir, defaults: { theme: 'fate' } }), SyntaxError);
    const store = new Store({ cwd: dir, defaults: { theme: 'fate' }, clearInvalidConfig: true });
    assert.equal(store.get('theme'), 'fate');
  }
});
