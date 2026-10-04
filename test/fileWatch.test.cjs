'use strict';
/* electron/fileWatch.cjs against real files and real fs.watch events. Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileWatcher } = require('../electron/fileWatch.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (check()) return true;
    await sleep(10);
  }
  return false;
}

/** A watcher with short timings, recording what it delivers. */
function setup(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fate-watch-'));
  const file = path.join(dir, 'doc.txt');
  fs.writeFileSync(file, 'v0');
  const reads = [];
  const deleted = [];
  const errors = [];
  const watcher = createFileWatcher({
    read: (p) => fs.promises.readFile(p, 'utf8'),
    onRead: (p, text) => reads.push(text),
    onDeleted: (p) => deleted.push(p),
    onError: (p, err) => errors.push(err),
    debounceMs: 60,
    maxWaitMs: 400,
    retryDelays: [40, 80, 160],
    ...overrides
  });
  t.after(() => {
    watcher.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, file, reads, deleted, errors, watcher };
}

test('a write is read once', async (t) => {
  const { file, reads, watcher } = setup(t);
  watcher.watch(file);
  fs.writeFileSync(file, 'v1');
  assert.ok(await waitFor(() => reads.length > 0));
  await sleep(200);
  assert.deepEqual(reads, ['v1']);
});

test("another editor's atomic save gives ONE read, and the watcher follows the new file", async (t) => {
  const { dir, file, reads, watcher } = setup(t);
  watcher.watch(file);
  const tmp = path.join(dir, '.doc.txt.swp');
  fs.writeFileSync(tmp, 'v1 from another editor');
  fs.renameSync(tmp, file);
  assert.ok(await waitFor(() => reads.length > 0));
  await sleep(250);
  assert.deepEqual(reads, ['v1 from another editor']);
  assert.ok(watcher.isWatching(file));

  fs.appendFileSync(file, ', then appended');
  assert.ok(await waitFor(() => reads.length > 1), 're-armed on the new inode');
  assert.equal(reads.at(-1), 'v1 from another editor, then appended');
});

test('a burst of writes is coalesced', async (t) => {
  const { file, reads, watcher } = setup(t);
  watcher.watch(file);
  fs.writeFileSync(file, 'a');
  fs.writeFileSync(file, 'ab');
  fs.writeFileSync(file, 'abc');
  assert.ok(await waitFor(() => reads.length > 0));
  await sleep(250);
  assert.deepEqual(reads, ['abc']);
});

test('a file written continuously still updates (no starvation)', async (t) => {
  const { file, reads, watcher } = setup(t);
  watcher.watch(file);
  let text = '';
  for (let i = 0; i < 25; i++) {
    text += `${i}\n`;
    fs.writeFileSync(file, text);
    await sleep(40);
  }
  assert.ok(reads.length >= 2, `got ${reads.length} reads during a 1 s stream`);
  assert.ok(await waitFor(() => reads.at(-1) === text));
});

test('delete then recreate re-arms the watcher', async (t) => {
  const { file, reads, deleted, watcher } = setup(t);
  watcher.watch(file);
  fs.unlinkSync(file);
  await sleep(90); // inside the retry window
  fs.writeFileSync(file, 'recreated');
  assert.ok(await waitFor(() => reads.includes('recreated')));
  fs.writeFileSync(file, 'edited after');
  assert.ok(await waitFor(() => reads.includes('edited after')), 'still watching after the recreate');
  assert.deepEqual(deleted, []);
});

test('a file that stays deleted is reported once', async (t) => {
  const { file, reads, deleted, watcher } = setup(t);
  watcher.watch(file);
  fs.unlinkSync(file);
  assert.ok(await waitFor(() => deleted.length > 0, 2000));
  await sleep(300);
  assert.deepEqual(deleted, [file]);
  assert.deepEqual(reads, []);
  assert.equal(watcher.isWatching(file), false);

  // A later save by FATE (which calls watch again) brings it back.
  fs.writeFileSync(file, 'saved again');
  watcher.watch(file);
  assert.ok(watcher.isWatching(file));
  fs.writeFileSync(file, 'and edited');
  assert.ok(await waitFor(() => reads.includes('and edited')));
});

test('unwatch stops everything, including pending retries', async (t) => {
  const { file, reads, deleted, watcher } = setup(t);
  watcher.watch(file);
  fs.unlinkSync(file);
  await sleep(100);
  watcher.unwatch(file);
  fs.writeFileSync(file, 'back');
  await sleep(500);
  assert.deepEqual(reads, []);
  assert.deepEqual(deleted, []);
});

test('hold parks events during our own save, then reads once', async (t) => {
  const { file, reads, watcher } = setup(t);
  watcher.watch(file);
  const release = watcher.hold(file);
  fs.writeFileSync(file, 'saved by FATE');
  await sleep(250);
  assert.deepEqual(reads, [], 'nothing delivered while held');
  watcher.watch(file, { rearm: true });
  release();
  assert.ok(await waitFor(() => reads.length > 0));
  await sleep(200);
  assert.deepEqual(reads, ['saved by FATE']);
});

test('a read overtaken by a newer one is dropped', async (t) => {
  let calls = 0;
  const { file, reads, watcher } = setup(t, {
    read: async (p) => {
      const text = await fs.promises.readFile(p, 'utf8');
      if (calls++ === 0) await sleep(400); // the first read is slow
      return text;
    }
  });
  watcher.watch(file);
  fs.writeFileSync(file, 'first');
  await sleep(120); // first read is now in flight
  fs.writeFileSync(file, 'second');
  assert.ok(await waitFor(() => reads.length > 0));
  await sleep(500);
  assert.deepEqual(reads, ['second'], 'the slow, stale read never lands');
});

test('a read in flight when a save starts is dropped', async (t) => {
  let slow = true;
  const { file, reads, watcher } = setup(t, {
    read: async (p) => {
      const text = await fs.promises.readFile(p, 'utf8');
      if (slow) await sleep(300);
      return text;
    }
  });
  watcher.watch(file);
  fs.writeFileSync(file, 'external edit');
  await sleep(100); // its read is in flight
  slow = false;
  const release = watcher.hold(file);
  fs.writeFileSync(file, 'saved by FATE');
  release();
  await sleep(600);
  assert.ok(!reads.includes('external edit'), `stale read delivered: ${JSON.stringify(reads)}`);
});

test('a save that starts while a burst is being checked holds the read back', async (t) => {
  const { file, reads, watcher } = setup(t);
  watcher.watch(file);
  // Slow the stat inside settle down, so the hold lands between the stat and the read.
  const realStat = fs.promises.stat;
  let release = null;
  fs.promises.stat = async (...args) => {
    const result = await realStat(...args);
    if (!release) {
      release = watcher.hold(file);
      fs.writeFileSync(file, 'saved by FATE');
    }
    return result;
  };
  t.after(() => {
    fs.promises.stat = realStat;
  });
  fs.writeFileSync(file, 'external edit');
  assert.ok(await waitFor(() => release !== null));
  fs.promises.stat = realStat;
  await sleep(250);
  assert.deepEqual(reads, [], 'nothing read while our save holds the path');
  release();
  assert.ok(await waitFor(() => reads.length > 0));
  await sleep(200);
  assert.deepEqual(reads, ['saved by FATE']);
});
