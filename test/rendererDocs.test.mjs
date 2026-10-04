// Unit tests for the renderer-side document helpers added in 1.14.0 (renderer-docs workstream):
// text spans for reloads, file formats, size routing, safe rendering and hot-exit planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changedSpan, applySpan } from '../src/textSpan.js';
import {
  defaultFormat, eolLabel, toggledEol, encodingLabel, sameFormat, formatChanged,
  SAVE_ENCODINGS, REOPEN_ENCODINGS, isCurrentEncoding
} from '../src/docFormat.js';
import {
  MARKDOWN_EXTENSIONS, fileKindForName, kindForOpen, couldBeMarkdown,
  MARKDOWN_RENDER_LIMIT, LARGE_FILE_LIMIT
} from '../src/fileKinds.js';
import { renderSafely, escapeHtml } from '../src/renderSafely.js';
import {
  BACKUP_ID_RE, newBackupId, backupPayload, planRestore, untitledNumber, sameSignature,
  setCrashFlusher, flushForCrash, isRestorable
} from '../src/hotExit.js';

/* ── changedSpan ─────────────────────────────────────────────────────────────────────────── */

test('changedSpan: identical text is no change', () => {
  assert.equal(changedSpan('abc', 'abc'), null);
  assert.equal(changedSpan('', ''), null);
});

test('changedSpan: an appended log line is an insertion at the end', () => {
  const old = 'line 1\nline 2\n';
  const span = changedSpan(old, `${old}line 3\n`);
  assert.deepEqual(span, { from: old.length, to: old.length, insert: 'line 3\n' });
});

test('changedSpan: a change in the middle keeps the prefix and suffix', () => {
  const span = changedSpan('alpha beta gamma', 'alpha BETA gamma');
  assert.deepEqual(span, { from: 6, to: 10, insert: 'BETA' });
});

test('changedSpan: deletions, insertions at the start, and whole replacements', () => {
  assert.deepEqual(changedSpan('abcdef', 'abef'), { from: 2, to: 4, insert: '' });
  assert.deepEqual(changedSpan('world', 'hello world'), { from: 0, to: 0, insert: 'hello ' });
  assert.deepEqual(changedSpan('abc', 'xyz'), { from: 0, to: 3, insert: 'xyz' });
  assert.deepEqual(changedSpan('', 'new'), { from: 0, to: 0, insert: 'new' });
  assert.deepEqual(changedSpan('old', ''), { from: 0, to: 3, insert: '' });
});

test('changedSpan: repeated characters resolve without overlapping prefix and suffix', () => {
  for (const [a, b] of [['aaa', 'aaaa'], ['aaaa', 'aa'], ['abab', 'ab'], ['xx', 'xyx']]) {
    const span = changedSpan(a, b);
    assert.ok(span.from <= span.to, `${a} → ${b}`);
    assert.equal(applySpan(a, span), b, `${a} → ${b}`);
  }
});

test('changedSpan: never splits a surrogate pair', () => {
  const cases = [
    ['x\u{1F600}y', 'x\u{1F601}y'],
    ['\u{1F600}', '\u{1F601}'],
    ['a\u{1F600}', 'a'],
    ['a', 'a\u{1F600}'],
    ['x\uD83D\uDE00', 'x\uD83E\uDE00']
  ];
  for (const [a, b] of cases) {
    const span = changedSpan(a, b);
    assert.equal(applySpan(a, span), b);
    const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;
    assert.ok(!isLow(a.charCodeAt(span.from)) || span.from === a.length, `from splits a pair in ${JSON.stringify(a)}`);
    assert.ok(!isLow(a.charCodeAt(span.to)) || span.to === a.length, `to splits a pair in ${JSON.stringify(a)}`);
  }
});

test('changedSpan: random edits always round-trip', () => {
  const alphabet = 'ab\n \u{1F600}';
  let seed = 7;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const word = (len) => Array.from({ length: len }, () => [...alphabet][rand([...alphabet].length)]).join('');
  for (let i = 0; i < 2000; i++) {
    const a = word(rand(12));
    const b = word(rand(12));
    assert.equal(applySpan(a, changedSpan(a, b)), b, `${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
});

/* ── docFormat ───────────────────────────────────────────────────────────────────────────── */

test('defaultFormat: UTF-8 without BOM, CRLF only on Windows', () => {
  assert.deepEqual(defaultFormat('win32'), { encoding: 'utf8', bom: false, eol: '\r\n' });
  assert.deepEqual(defaultFormat('linux'), { encoding: 'utf8', bom: false, eol: '\n' });
  assert.deepEqual(defaultFormat(undefined), { encoding: 'utf8', bom: false, eol: '\n' });
});

test('eolLabel and toggledEol', () => {
  assert.equal(eolLabel('\r\n'), 'CRLF');
  assert.equal(eolLabel('\n'), 'LF');
  assert.equal(eolLabel('\r'), 'CR');
  assert.equal(toggledEol('\r\n'), '\n');
  assert.equal(toggledEol('\n'), '\r\n');
  assert.equal(toggledEol('\r'), '\n');
});

test('encodingLabel covers every encoding the main process reports', () => {
  assert.equal(encodingLabel({ encoding: 'utf8', bom: false }), 'UTF-8');
  assert.equal(encodingLabel({ encoding: 'utf8', bom: true }), 'UTF-8 BOM');
  assert.equal(encodingLabel({ encoding: 'utf16le', bom: true }), 'UTF-16 LE');
  assert.equal(encodingLabel({ encoding: 'utf16be', bom: false }), 'UTF-16 BE');
  assert.equal(encodingLabel({ encoding: 'windows1252', bom: false }), 'Windows-1252');
  assert.equal(encodingLabel(null), '');
});

test('encoding choices match the contract', () => {
  assert.deepEqual(SAVE_ENCODINGS.map((e) => e.label), ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE', 'Windows-1252']);
  const contract = ['utf8', 'utf16le', 'utf16be', 'windows1252'];
  for (const e of SAVE_ENCODINGS) assert.ok(contract.includes(e.encoding));
  assert.deepEqual(REOPEN_ENCODINGS.map((e) => e.encoding), contract);
  assert.ok(isCurrentEncoding({ encoding: 'utf8', bom: true, eol: '\n' }, SAVE_ENCODINGS[1]));
  assert.ok(!isCurrentEncoding({ encoding: 'utf8', bom: true, eol: '\n' }, SAVE_ENCODINGS[0]));
});

test('sameFormat and formatChanged', () => {
  const lf = { encoding: 'utf8', bom: false, eol: '\n' };
  const crlf = { ...lf, eol: '\r\n' };
  assert.ok(sameFormat(lf, { ...lf }));
  assert.ok(!sameFormat(lf, crlf));
  assert.ok(!sameFormat(lf, { ...lf, bom: true }));
  assert.ok(sameFormat(null, undefined));
  assert.ok(!sameFormat(lf, null));
  assert.equal(formatChanged({ format: crlf, savedFormat: lf }), true);
  assert.equal(formatChanged({ format: lf, savedFormat: { ...lf } }), false);
  // Untitled buffers (and files whose format main never reported) have nothing to differ from.
  assert.equal(formatChanged({ format: crlf, savedFormat: null }), false);
  assert.equal(formatChanged({ format: null, savedFormat: lf }), false);
});

/* ── fileKinds ───────────────────────────────────────────────────────────────────────────── */

test('.txt opens as plain text; .md and .markdown render', () => {
  assert.deepEqual(MARKDOWN_EXTENSIONS, ['md', 'markdown']);
  assert.equal(fileKindForName('notes.txt'), 'code');
  assert.equal(fileKindForName('README.md'), 'markdown');
  assert.equal(fileKindForName('a.MARKDOWN'), 'markdown');
});

test('kindForOpen: Markdown over the render limit opens in the editor', () => {
  assert.equal(kindForOpen('big.md', MARKDOWN_RENDER_LIMIT), 'markdown');
  assert.equal(kindForOpen('big.md', MARKDOWN_RENDER_LIMIT + 1), 'code');
  assert.equal(kindForOpen('log.txt', 10), 'code');
  assert.ok(LARGE_FILE_LIMIT > MARKDOWN_RENDER_LIMIT);
});

test('couldBeMarkdown: .md/.markdown/.txt and extensionless names, not dotfiles or code', () => {
  for (const n of ['a.md', 'a.markdown', 'notes.txt', 'README', 'NOTES', 'C:\\docs\\CHANGES', '/x/LICENSE']) {
    assert.ok(couldBeMarkdown(n), n);
  }
  for (const n of ['.env', '.gitignore', 'app.js', 'data.json', 'Untitled.log', '']) {
    assert.ok(!couldBeMarkdown(n) || n === '', n);
  }
  assert.ok(couldBeMarkdown('Untitled-3'));
});

/* ── renderSafely ────────────────────────────────────────────────────────────────────────── */

test('renderSafely passes a good render through', () => {
  const r = renderSafely((c) => ({ html: `<p>${c}</p>`, toc: [], readMins: 1, hasMermaid: false }), 'hi', null);
  assert.equal(r.html, '<p>hi</p>');
  assert.equal(r.renderFailed, false);
  assert.equal(r.remoteImageCount, 0);
});

test('renderSafely falls back to escaped text in a <pre> when the renderer throws', () => {
  const r = renderSafely(() => {
    throw new RangeError('Maximum call stack size exceeded');
  }, '<script>alert(1)</script> & "x"', '/tmp/a.md');
  assert.equal(r.renderFailed, true);
  assert.equal(r.html, '<pre class="md-plain-fallback">&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</pre>');
  assert.deepEqual(r.toc, []);
  assert.equal(r.hasMermaid, false);
  assert.ok(r.error instanceof RangeError);
});

test('escapeHtml', () => {
  assert.equal(escapeHtml(`<a href='x'>&</a>`), '&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;');
});

/* ── hotExit ─────────────────────────────────────────────────────────────────────────────── */

test('newBackupId matches what main accepts', () => {
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    const id = newBackupId();
    assert.match(id, BACKUP_ID_RE);
    ids.add(id);
  }
  assert.equal(ids.size, 50);
});

test('backupPayload follows the preload contract', () => {
  const fmt = { encoding: 'utf8', bom: false, eol: '\r\n' };
  assert.deepEqual(
    backupPayload({ kind: 'markdown', name: 'a.md', path: '/x/a.md', format: fmt, editMode: true }, 'new', 'old'),
    { kind: 'markdown', name: 'a.md', path: '/x/a.md', content: 'new', format: fmt, savedContent: 'old', untitled: false, editMode: true }
  );
  assert.deepEqual(
    backupPayload({ kind: 'code', name: 'Untitled-2', path: null, format: null, untitled: true }, 'text', undefined),
    { kind: 'code', name: 'Untitled-2', path: null, content: 'text', format: null, savedContent: null, untitled: true }
  );
});

test('planRestore: newest backup per path wins, untitled keep their order, junk is dropped', () => {
  const key = (p) => p.toLowerCase();
  const list = [
    { id: 'a1', savedAt: 100, path: '/x/A.md', content: 'old' },
    { id: 'a2', savedAt: 200, path: '/x/a.md', content: 'new' },
    { id: 'u1', savedAt: 50, path: null, name: 'Untitled-1', content: 'one' },
    { id: 'u2', savedAt: 300, path: null, name: 'Untitled-4', content: 'four' },
    { id: 'bad', savedAt: 10, path: null },
    { id: '../evil', content: 'x' },
    null
  ];
  const plan = planRestore(list, key);
  assert.deepEqual([...plan.byPath.keys()], ['/x/a.md']);
  assert.equal(plan.byPath.get('/x/a.md').id, 'a2');
  assert.deepEqual(plan.untitled.map((b) => b.id), ['u1', 'u2']);
  assert.deepEqual(plan.drop.sort(), ['a1', 'bad']);
  assert.ok(!isRestorable({ id: '../evil', content: 'x' }));
  assert.deepEqual(planRestore(undefined, key), { byPath: new Map(), untitled: [], drop: [] });
});

test('untitledNumber and sameSignature', () => {
  assert.equal(untitledNumber('Untitled-12'), 12);
  assert.equal(untitledNumber('notes.md'), 0);
  const t = {};
  assert.ok(sameSignature([t, 'a', null], [t, 'a', null]));
  assert.ok(!sameSignature([t, 'a'], [{}, 'a']));
  assert.ok(!sameSignature(null, [t]));
});

test('flushForCrash resolves false without a flusher and survives a throwing one', async () => {
  setCrashFlusher(null);
  assert.equal(await flushForCrash(), false);
  setCrashFlusher(() => {
    throw new Error('boom');
  });
  assert.equal(await flushForCrash(), false);
  setCrashFlusher(() => Promise.resolve(true));
  assert.equal(await flushForCrash(), true);
  setCrashFlusher(null);
});
