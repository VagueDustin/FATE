'use strict';
/* Atomic saves and async reads in electron/textFiles.cjs. Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTextFile, writeFileAtomic } = require('../electron/textFiles.cjs');

const posix = process.platform !== 'win32';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fate-textfiles-'));
  t.after(() => {
    try {
      fs.chmodSync(dir, 0o755);
    } catch {
      /* already gone */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** Files in `dir` other than the ones named: leftovers from a save. */
const strays = (dir, keep) => fs.readdirSync(dir).filter((n) => !keep.includes(n));

test('readTextFile decodes and reports the format', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.ps1');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Write-Host hi\r\n', 'utf16le')]));
  const doc = await readTextFile(file, { maxBytes: 1024 });
  assert.equal(doc.text, 'Write-Host hi\n');
  assert.deepEqual(doc.format, { encoding: 'utf16le', bom: true, eol: '\r\n' });
});

test('readTextFile refuses folders, oversized and binary files with coded errors', async (t) => {
  const dir = tempDir(t);
  await assert.rejects(readTextFile(dir), (err) => err.code === 'NOT_FILE');
  const big = path.join(dir, 'big.txt');
  fs.writeFileSync(big, 'x'.repeat(2048));
  await assert.rejects(readTextFile(big, { maxBytes: 1024 }), (err) => err.code === 'TOO_LARGE' && err.size === 2048);
  const bin = path.join(dir, 'a.bin');
  fs.writeFileSync(bin, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]));
  await assert.rejects(readTextFile(bin), (err) => err.code === 'BINARY');
  await assert.rejects(readTextFile(path.join(dir, 'missing.txt')), (err) => err.code === 'ENOENT');
});

test('an atomic save replaces the file and leaves nothing behind', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'notes.md');
  fs.writeFileSync(file, 'old');
  const before = fs.statSync(file).ino;
  const res = await writeFileAtomic(file, Buffer.from('new content'));
  assert.equal(res.method, 'atomic');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new content');
  if (posix) assert.notEqual(fs.statSync(file).ino, before, 'a new inode: the rename happened');
  assert.deepEqual(strays(dir, ['notes.md']), []);
});

test('a new file is created', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'new.txt');
  await writeFileAtomic(file, Buffer.from('hello'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'hello');
  assert.deepEqual(strays(dir, ['new.txt']), []);
});

test('permission bits are preserved', { skip: !posix }, async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'run.sh');
  fs.writeFileSync(file, '#!/bin/sh\n');
  fs.chmodSync(file, 0o750);
  await writeFileAtomic(file, Buffer.from('#!/bin/sh\necho hi\n'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o750);
});

test('new files get the requested mode', { skip: !posix }, async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'secret.json');
  await writeFileAtomic(file, Buffer.from('{}'), { mode: 0o600 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('saving through a symlink updates the target and keeps the link', { skip: !posix }, async (t) => {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, 'real'));
  const target = path.join(dir, 'real', 'config.ini');
  const link = path.join(dir, 'link.ini');
  fs.writeFileSync(target, 'a=1');
  fs.symlinkSync(target, link);
  await writeFileAtomic(link, Buffer.from('a=2'));
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'still a symlink');
  assert.equal(fs.readFileSync(target, 'utf8'), 'a=2');
  assert.deepEqual(strays(path.join(dir, 'real'), ['config.ini']), []);
});

test('a dangling symlink is written through, not replaced', { skip: !posix }, async (t) => {
  const dir = tempDir(t);
  const target = path.join(dir, 'gone.txt');
  const link = path.join(dir, 'link.txt');
  fs.symlinkSync(target, link);
  const res = await writeFileAtomic(link, Buffer.from('back'));
  assert.equal(res.method, 'in-place');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readFileSync(target, 'utf8'), 'back');
});

test('hard links are kept by writing in place', { skip: !posix }, async (t) => {
  const dir = tempDir(t);
  const a = path.join(dir, 'a.txt');
  const b = path.join(dir, 'b.txt');
  fs.writeFileSync(a, 'one');
  fs.linkSync(a, b);
  const res = await writeFileAtomic(a, Buffer.from('two, and longer'));
  assert.equal(res.method, 'in-place');
  assert.equal(fs.readFileSync(b, 'utf8'), 'two, and longer');
  // Shorter content truncates the old tail.
  await writeFileAtomic(a, Buffer.from('3'));
  assert.equal(fs.readFileSync(b, 'utf8'), '3');
});

test('a folder that refuses new files falls back to an in-place write', { skip: !posix || process.getuid() === 0 }, async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'locked.txt');
  fs.writeFileSync(file, 'before');
  fs.chmodSync(dir, 0o555); // can write the file, cannot create the temporary one
  const res = await writeFileAtomic(file, Buffer.from('after'));
  assert.equal(res.method, 'in-place');
  assert.equal(fs.readFileSync(file, 'utf8'), 'after');
  assert.deepEqual(strays(dir, ['locked.txt']), []);
});

test('an unwritable file fails cleanly and keeps its content', { skip: !posix || process.getuid() === 0 }, async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'ro.txt');
  fs.writeFileSync(file, 'keep me');
  fs.chmodSync(file, 0o444);
  fs.chmodSync(dir, 0o555);
  await assert.rejects(writeFileAtomic(file, Buffer.from('lost')), (err) => err.code === 'EACCES');
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep me');
  assert.deepEqual(strays(dir, ['ro.txt']), []);
});

test('a read-only file in a writable folder is not replaced', { skip: !posix || process.getuid() === 0 }, async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'protected.txt');
  fs.writeFileSync(file, 'keep me');
  fs.chmodSync(file, 0o444);
  await assert.rejects(writeFileAtomic(file, Buffer.from('overwritten')), (err) => err.code === 'EACCES');
  assert.equal(fs.readFileSync(file, 'utf8'), 'keep me');
  assert.equal(fs.statSync(file).mode & 0o777, 0o444);
  assert.deepEqual(strays(dir, ['protected.txt']), []);
});

test('a failed rename never leaves the temporary file behind', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'x.txt');
  fs.writeFileSync(file, 'old');
  const original = fs.promises.rename;
  fs.promises.rename = async () => {
    const err = new Error('simulated: no space left on device');
    err.code = 'ENOSPC';
    throw err;
  };
  t.after(() => {
    fs.promises.rename = original;
  });
  await assert.rejects(writeFileAtomic(file, Buffer.from('new')), (err) => err.code === 'ENOSPC');
  fs.promises.rename = original;
  assert.equal(fs.readFileSync(file, 'utf8'), 'old', 'the original is untouched');
  assert.deepEqual(strays(dir, ['x.txt']), []);
});

test('a rename refused by a lock falls back to writing in place', async (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'locked-by-another-app.txt');
  fs.writeFileSync(file, 'old');
  const original = fs.promises.rename;
  fs.promises.rename = async () => {
    const err = new Error('simulated: resource busy or locked');
    err.code = 'EBUSY';
    throw err;
  };
  t.after(() => {
    fs.promises.rename = original;
  });
  const res = await writeFileAtomic(file, Buffer.from('new'));
  fs.promises.rename = original;
  assert.equal(res.method, 'in-place');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.deepEqual(strays(dir, ['locked-by-another-app.txt']), []);
});

test('saving onto a folder is refused', async (t) => {
  const dir = tempDir(t);
  await assert.rejects(writeFileAtomic(dir, Buffer.from('x')), (err) => err.code === 'EISDIR');
});
