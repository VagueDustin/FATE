'use strict';
/* Atomic saves and async reads in electron/textFiles.cjs. Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { constants } = require('node:buffer');
const { MAX_FILE_BYTES, readTextFile, writeFileAtomic, diskChangeSince } = require('../electron/textFiles.cjs');
const { textDigest } = require('../electron/fileFormat.cjs');

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
  const stat = fs.statSync(file);
  assert.deepEqual(doc.stamp, { size: stat.size, mtimeMs: stat.mtimeMs });
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

test('the size cap stays under the longest string V8 can hold', () => {
  // Decoded text is at most one UTF-16 unit per byte, so a file under the cap always decodes. Past
  // MAX_STRING_LENGTH the decoder throws a RangeError that reads as a generic open failure.
  assert.ok(MAX_FILE_BYTES <= constants.MAX_STRING_LENGTH, `${MAX_FILE_BYTES} > ${constants.MAX_STRING_LENGTH}`);
  assert.ok(MAX_FILE_BYTES >= 160 * 1024 * 1024, 'a 160 MB report export must open (issue from 1.15.0)');
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

/* ── diskChangeSince: what a save checks first ──────────────────────────────────────────────── */

/** A file, and what FATE would know about it right after reading it. */
async function seen(t, contents) {
  const file = path.join(tempDir(t), 'a.txt');
  fs.writeFileSync(file, contents);
  const doc = await readTextFile(file);
  return { file, known: { stamp: doc.stamp, digest: textDigest(doc.text), format: doc.format } };
}

/** Move the mtime on, as any real write a moment later would. */
const later = (file) => {
  const when = new Date(Date.now() + 5000);
  fs.utimesSync(file, when, when);
};

const MINE = textDigest('mine\n');

test('diskChangeSince: an untouched file is unchanged, and is not read', async (t) => {
  const { file, known } = await seen(t, 'one\n');
  let reads = 0;
  const read = (p) => {
    reads++;
    return readTextFile(p);
  };
  const r = await diskChangeSince(file, { known, savingDigest: MINE, read });
  assert.equal(r.verdict, 'unchanged');
  assert.equal(reads, 0);
});

test('diskChangeSince: touched with the same text and format is unchanged', async (t) => {
  const { file, known } = await seen(t, 'one\r\n');
  later(file);
  const r = await diskChangeSince(file, { known, savingDigest: MINE, read: readTextFile });
  assert.equal(r.verdict, 'unchanged');
  assert.equal(r.stamp.mtimeMs, fs.statSync(file).mtimeMs, 'the new stamp is reported, to record');
});

test("diskChangeSince: another program's edit is changed, with the text to show", async (t) => {
  const { file, known } = await seen(t, 'one\n');
  fs.writeFileSync(file, 'theirs\n');
  later(file);
  const r = await diskChangeSince(file, { known, savingDigest: MINE, read: readTextFile });
  assert.equal(r.verdict, 'changed');
  assert.equal(r.doc.text, 'theirs\n');
  assert.equal(r.digest, textDigest('theirs\n'));
});

test('diskChangeSince: a line-ending change alone is a change', async (t) => {
  const { file, known } = await seen(t, 'one\r\ntwo\r\n');
  fs.writeFileSync(file, 'one\ntwo\n');
  later(file);
  const r = await diskChangeSince(file, { known, savingDigest: MINE, read: readTextFile });
  assert.equal(r.verdict, 'changed');
  assert.equal(r.format.eol, '\n');
});

test('diskChangeSince: a disk that already holds the text being saved is unchanged', async (t) => {
  const { file, known } = await seen(t, 'one\n');
  fs.writeFileSync(file, 'mine\n');
  later(file);
  const r = await diskChangeSince(file, { known, savingDigest: MINE, read: readTextFile });
  assert.equal(r.verdict, 'unchanged');
});

test('diskChangeSince: an empty known always reads', async (t) => {
  const { file } = await seen(t, 'one\n');
  const r = await diskChangeSince(file, { known: {}, savingDigest: MINE, read: readTextFile });
  assert.equal(r.verdict, 'changed');
});

test('diskChangeSince: missing, and changed but unreadable', async (t) => {
  const { file, known } = await seen(t, 'one\n');
  const gone = await diskChangeSince(path.join(path.dirname(file), 'nope.txt'), { known, read: readTextFile });
  assert.equal(gone.verdict, 'missing');
  fs.writeFileSync(file, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
  later(file);
  const r = await diskChangeSince(file, { known, savingDigest: MINE, read: readTextFile });
  assert.equal(r.verdict, 'unreadable');
  assert.equal(r.error.code, 'BINARY');
  assert.ok(r.stamp, 'the stamp is reported, so a second Save can go ahead');
});


test('diskChangeSince: a folder at the path is left for the write to refuse', async (t) => {
  const dir = tempDir(t);
  const r = await diskChangeSince(dir, { known: {}, savingDigest: MINE, read: readTextFile });
  assert.equal(r.verdict, 'unknown');
});

test('diskChangeSince: a FIFO at the path does not block the save check', { skip: !posix && 'no FIFOs at ordinary paths on Windows' }, async (t) => {
  const fifo = path.join(tempDir(t), 'pipe');
  require('node:child_process').execFileSync('mkfifo', [fifo]);
  const timedOut = new Promise((resolve) => setTimeout(resolve, 2000, 'timed out'));
  const r = await Promise.race([diskChangeSince(fifo, { known: {}, savingDigest: MINE, read: readTextFile }), timedOut]);
  assert.equal(r?.verdict, 'unknown', `got ${JSON.stringify(r)}`);
});
