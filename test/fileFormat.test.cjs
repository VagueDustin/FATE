'use strict';
/* Round trips and detection for electron/fileFormat.cjs. Run: node --test test/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ff = require('../electron/fileFormat.cjs');

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const LE_BOM = Buffer.from([0xff, 0xfe]);
const BE_BOM = Buffer.from([0xfe, 0xff]);
const le = (s) => Buffer.from(s, 'utf16le');
const be = (s) => Buffer.from(s, 'utf16le').swap16();

/** decode → encode with the detected format must give back the exact bytes. */
function assertRoundTrip(bytes, expected) {
  const { text, format } = ff.decode(bytes, null, { defaultEol: '\n' });
  if (expected) {
    if ('text' in expected) assert.equal(text, expected.text);
    for (const key of ['encoding', 'bom', 'eol']) {
      if (key in expected) assert.equal(format[key], expected[key], `format.${key}`);
    }
  }
  assert.ok(!text.includes('\r'), 'renderer text never contains \\r');
  const back = ff.encode(text, format);
  assert.ok(back.equals(bytes), `round trip changed the bytes:\n  in:  ${bytes.toString('hex')}\n  out: ${back.toString('hex')}`);
  return { text, format };
}

test('UTF-8 without a BOM, LF', () => {
  assertRoundTrip(Buffer.from('héllo\nwörld €\n', 'utf8'), { text: 'héllo\nwörld €\n', encoding: 'utf8', bom: false, eol: '\n' });
});

test('UTF-8 with a BOM, CRLF: BOM stripped from the text and recorded', () => {
  const bytes = Buffer.concat([UTF8_BOM, Buffer.from('# Title\r\nbody\r\n', 'utf8')]);
  assertRoundTrip(bytes, { text: '# Title\nbody\n', encoding: 'utf8', bom: true, eol: '\r\n' });
});

test('a second BOM after the first is content and survives', () => {
  const bytes = Buffer.concat([UTF8_BOM, UTF8_BOM, Buffer.from('x', 'utf8')]);
  assertRoundTrip(bytes, { text: '﻿x', bom: true });
});

test('UTF-16 LE with a BOM (PowerShell 5.1 Out-File), CRLF', () => {
  const bytes = Buffer.concat([LE_BOM, le('Get-Process | Out-File x.txt\r\nWrite-Host "é€"\r\n')]);
  assertRoundTrip(bytes, { text: 'Get-Process | Out-File x.txt\nWrite-Host "é€"\n', encoding: 'utf16le', bom: true, eol: '\r\n' });
});

test('UTF-16 BE with a BOM', () => {
  const bytes = Buffer.concat([BE_BOM, be('line one\nline two ✓\n')]);
  assertRoundTrip(bytes, { text: 'line one\nline two ✓\n', encoding: 'utf16be', bom: true, eol: '\n' });
});

test('UTF-16 LE and BE without a BOM are detected by their NUL pattern', () => {
  assertRoundTrip(le('[Settings]\r\nName=Value\r\n'), { text: '[Settings]\nName=Value\n', encoding: 'utf16le', bom: false, eol: '\r\n' });
  assertRoundTrip(be('[Settings]\r\nName=Value\r\n'), { text: '[Settings]\nName=Value\n', encoding: 'utf16be', bom: false, eol: '\r\n' });
});

test('UTF-16 with a BOM in a non-Latin script (no NUL pattern needed)', () => {
  assertRoundTrip(Buffer.concat([LE_BOM, le('Привет, мир\r\n日本語\r\n')]), { encoding: 'utf16le', bom: true, eol: '\r\n' });
});

test('UTF-16 keeps unpaired surrogates exactly', () => {
  const bytes = Buffer.concat([LE_BOM, Buffer.from([0x41, 0x00, 0x00, 0xd8, 0x42, 0x00])]);
  const { text } = assertRoundTrip(bytes, { encoding: 'utf16le' });
  assert.equal(text.charCodeAt(1), 0xd800);
});

test('Windows-1252: é, €, smart quotes, and the bytes Microsoft left undefined', () => {
  // "café €5 “quoted” ‘single’ – dash" in Windows-1252, CRLF.
  const bytes = Buffer.from([
    0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x35, 0x20, 0x93, 0x71, 0x94, 0x20, 0x91, 0x73, 0x92, 0x20, 0x96, 0x0d, 0x0a,
    0x81, 0x8d, 0x8f, 0x90, 0x9d, 0x0d, 0x0a
  ]);
  const { text } = assertRoundTrip(bytes, { encoding: 'windows1252', bom: false, eol: '\r\n' });
  assert.equal(text.split('\n')[0], 'café €5 “q” ‘s’ –');
});

test('all 256 Windows-1252 bytes (minus NUL) round-trip', () => {
  const bytes = Buffer.from(Array.from({ length: 255 }, (_, i) => i + 1).filter((b) => b !== 0x0a && b !== 0x0d));
  assertRoundTrip(bytes, { encoding: 'windows1252' });
});

test('a UTF-8 BOM over bytes that are not UTF-8 is read losslessly as Windows-1252', () => {
  const bytes = Buffer.concat([UTF8_BOM, Buffer.from([0x63, 0x61, 0x66, 0xe9])]);
  assertRoundTrip(bytes, { text: 'ï»¿café', encoding: 'windows1252', bom: false });
});

test('line endings: CRLF, LF, CR and mixed', () => {
  assertRoundTrip(Buffer.from('a\r\nb\r\nc'), { text: 'a\nb\nc', eol: '\r\n' });
  assertRoundTrip(Buffer.from('a\nb\nc\n'), { text: 'a\nb\nc\n', eol: '\n' });
  assertRoundTrip(Buffer.from('a\rb\rc\r'), { text: 'a\nb\nc\n', eol: '\r' });

  // Mixed: the majority style wins, and the save writes it consistently.
  const mixed = ff.decode(Buffer.from('a\r\nb\r\nc\nd\r\n'), null, { defaultEol: '\n' });
  assert.equal(mixed.text, 'a\nb\nc\nd\n');
  assert.equal(mixed.format.eol, '\r\n');
  assert.equal(ff.encode(mixed.text, mixed.format).toString(), 'a\r\nb\r\nc\r\nd\r\n');
  assert.equal(ff.decode(Buffer.from('a\nb\nc\r\n'), null, { defaultEol: '\r\n' }).format.eol, '\n');
});

test('ties and files without line breaks fall back to the default', () => {
  assert.equal(ff.decode(Buffer.from('single line'), null, { defaultEol: '\r\n' }).format.eol, '\r\n');
  assert.equal(ff.decode(Buffer.from('single line'), null, { defaultEol: '\n' }).format.eol, '\n');
  assert.equal(ff.decode(Buffer.from('a\r\nb\nc'), null, { defaultEol: '\n' }).format.eol, '\n');
  assert.equal(ff.decode(Buffer.from('a\r\nb\nc'), null, { defaultEol: '\r\n' }).format.eol, '\r\n');
  assert.equal(ff.decode(Buffer.alloc(0), null, { defaultEol: '\r\n' }).format.eol, '\r\n');
});

test('defaultFormat follows the platform', () => {
  assert.deepEqual(ff.defaultFormat('win32'), { encoding: 'utf8', bom: false, eol: '\r\n' });
  assert.deepEqual(ff.defaultFormat('linux'), { encoding: 'utf8', bom: false, eol: '\n' });
});

test('encode converts between formats', () => {
  const text = 'é\nü\n';
  assert.deepEqual([...ff.encode(text, { encoding: 'utf8', bom: true, eol: '\r\n' })], [0xef, 0xbb, 0xbf, 0xc3, 0xa9, 0x0d, 0x0a, 0xc3, 0xbc, 0x0d, 0x0a]);
  assert.deepEqual([...ff.encode(text, { encoding: 'utf16le', bom: true, eol: '\n' })], [0xff, 0xfe, 0xe9, 0x00, 0x0a, 0x00, 0xfc, 0x00, 0x0a, 0x00]);
  assert.deepEqual([...ff.encode(text, { encoding: 'utf16be', bom: false, eol: '\r' })], [0x00, 0xe9, 0x00, 0x0d, 0x00, 0xfc, 0x00, 0x0d]);
  assert.deepEqual([...ff.encode(text, { encoding: 'windows1252', bom: true, eol: '\r\n' })], [0xe9, 0x0d, 0x0a, 0xfc, 0x0d, 0x0a]);
  // Stray CRs in the input are normalised, not doubled.
  assert.equal(ff.encode('a\r\nb\rc', { encoding: 'utf8', bom: false, eol: '\r\n' }).toString(), 'a\r\nb\r\nc');
});

test('Windows-1252 refuses characters it cannot hold, naming the first one and its line', () => {
  assert.throws(
    () => ff.encode('fine é\nan arrow → here\nand 😀', { encoding: 'windows1252', bom: false, eol: '\r\n' }),
    (err) => {
      assert.equal(err.code, 'UNENCODABLE');
      assert.equal(err.char, '→');
      assert.equal(err.codePoint, 0x2192);
      assert.equal(err.line, 2);
      assert.match(err.message, /U\+2192/);
      assert.match(err.message, /UTF-8/);
      return true;
    }
  );
  assert.throws(() => ff.encode('😀', { encoding: 'windows1252', bom: false, eol: '\n' }), (err) => err.code === 'UNENCODABLE' && err.char === '😀');
});

test('resolveFormat fills gaps from the base, ignores extra keys, rejects nonsense', () => {
  const base = { encoding: 'utf16le', bom: true, eol: '\r\n' };
  assert.deepEqual(ff.resolveFormat({ eol: '\n', indent: 'tabs' }, base), { encoding: 'utf16le', bom: true, eol: '\n' });
  assert.deepEqual(ff.resolveFormat(undefined, base), base);
  assert.deepEqual(ff.resolveFormat(null, null), ff.defaultFormat());
  assert.deepEqual(ff.resolveFormat({ encoding: 'windows1252', bom: true }, base), { encoding: 'windows1252', bom: false, eol: '\r\n' });
  for (const bad of ['utf8', [], { encoding: 'latin2' }, { bom: 'yes' }, { eol: '\n\r' }]) {
    assert.throws(() => ff.resolveFormat(bad, base), (err) => err.code === 'BAD_FORMAT', JSON.stringify(bad));
  }
});

test('binary files are refused; UTF-16 is not mistaken for binary', () => {
  assert.throws(() => ff.decode(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])), (err) => err.code === 'BINARY');
  assert.throws(() => ff.decode(Buffer.from('\x89PNG\r\n\x1a\n\0\0\0\rIHDR', 'latin1')), (err) => err.code === 'BINARY');
  assert.equal(ff.isProbablyBinary(Buffer.concat([LE_BOM, le('text')]), 'utf16le'), false);
  assert.equal(ff.isProbablyBinary(Buffer.concat([LE_BOM, le('text')]), 'utf8'), true);
  // UTF-32 LE starts with FF FE 00 00: a UTF-16 BOM followed by a NUL unit, so binary.
  assert.throws(() => ff.decode(Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00])), (err) => err.code === 'BINARY');
});

test('random binary is never taken for UTF-16', () => {
  for (let i = 0; i < 200; i++) {
    const bytes = crypto.randomBytes(64 + i * 37);
    assert.equal(ff.sniffUtf16(bytes), null, `sample ${i}`);
  }
  // Even with NULs sprinkled into every other byte (a structure, not text), the zero units and
  // control characters give it away.
  const ints = Buffer.alloc(4096);
  for (let i = 0; i < ints.length; i += 2) ints[i] = (i / 2) % 7; // little-endian uint16 0..6
  assert.equal(ff.sniffUtf16(ints), null);
  const smallInts = Buffer.alloc(4096);
  for (let i = 0; i < smallInts.length; i += 2) smallInts[i] = 1 + ((i / 2) % 9);
  assert.equal(ff.sniffUtf16(smallInts), null);
  // Odd length cannot be UTF-16 without a BOM.
  assert.equal(ff.sniffUtf16(Buffer.concat([le('hello'), Buffer.from([0x41])])), null);
});

test('reopen with a forced encoding', () => {
  const utf8Bytes = Buffer.from('Ã©tÃ©', 'latin1'); // valid UTF-8 for "été"
  assert.equal(ff.decode(utf8Bytes).text, 'été');
  const forced = ff.decode(utf8Bytes, 'windows1252');
  assert.equal(forced.text, 'Ã©tÃ©');
  assert.equal(forced.format.encoding, 'windows1252');
  assert.ok(ff.encode(forced.text, forced.format).equals(utf8Bytes));

  // A BOM is only stripped when it belongs to the forced encoding.
  const bomFile = Buffer.concat([UTF8_BOM, Buffer.from('x')]);
  assert.deepEqual(ff.decode(bomFile, 'utf8').format.bom, true);
  assert.equal(ff.decode(bomFile, 'windows1252').text, 'ï»¿x');

  // Lossy forced decodes are refused instead of opened.
  assert.throws(() => ff.decode(Buffer.from([0x63, 0xe9]), 'utf8'), (err) => err.code === 'INVALID');
  assert.throws(() => ff.decode(Buffer.from([0x63, 0x64, 0x65]), 'utf16le'), (err) => err.code === 'INVALID');
  assert.throws(() => ff.decode(le('abc'), 'utf8'), (err) => err.code === 'BINARY');
  assert.throws(() => ff.decode(Buffer.from('x'), 'ebcdic'), (err) => err.code === 'BAD_ENCODING');
});

test('a truncated UTF-16 file with a BOM still opens', () => {
  const { text } = ff.decode(Buffer.concat([LE_BOM, le('ok'), Buffer.from([0x41])]));
  assert.equal(text, 'ok�');
});

test('sameFormat and normalizeText', () => {
  assert.ok(ff.sameFormat({ encoding: 'utf8', bom: false, eol: '\n' }, { encoding: 'utf8', bom: false, eol: '\n' }));
  assert.ok(!ff.sameFormat({ encoding: 'utf8', bom: false, eol: '\n' }, { encoding: 'utf8', bom: false, eol: '\r\n' }));
  assert.ok(!ff.sameFormat(null, { encoding: 'utf8', bom: false, eol: '\n' }));
  assert.equal(ff.normalizeText('a\r\nb\rc\n'), 'a\nb\nc\n');
});
