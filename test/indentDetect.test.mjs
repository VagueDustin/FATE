// Unit tests for src/indentDetect.js: per-document indentation (1.14.0, M7).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INDENT_SIZES, requiresTabs, detectIndent, indentForDocument, effectiveIndent, indentUnitText, indentLabel
} from '../src/indentDetect.js';

const lines = (...ls) => ls.join('\n');

/* ── requiresTabs ────────────────────────────────────────────────────────────────────────── */

test('requiresTabs: Makefiles in every common spelling, and Go', () => {
  for (const name of [
    'Makefile', 'makefile', 'GNUmakefile', 'Makefile.am', 'Makefile.in', 'rules.mk', 'build.mak',
    'main.go', 'C:\\src\\proj\\Makefile', '/home/me/proj/server.go', 'MAKEFILE'
  ]) {
    assert.equal(requiresTabs(name), true, name);
  }
});

test('requiresTabs: everything else, including near misses', () => {
  for (const name of ['app.js', 'Makefile.js', 'Makefilex', 'makefiles', 'go.mod', 'cargo', 'notes.md', '', null, undefined]) {
    assert.equal(requiresTabs(name), false, String(name));
  }
});

/* ── detectIndent ────────────────────────────────────────────────────────────────────────── */

test('detectIndent: a 2-space JavaScript file', () => {
  const js = lines(
    'function f(a) {',
    '  if (a) {',
    '    return 1;',
    '  }',
    '  return 2;',
    '}'
  );
  assert.deepEqual(detectIndent(js), { useTabs: false, size: 2 });
});

test('detectIndent: a 4-space Python file', () => {
  const py = lines(
    'class A:',
    '    def f(self):',
    '        if self.x:',
    '            return 1',
    '        return 2',
    '',
    '    def g(self):',
    '        pass'
  );
  assert.deepEqual(detectIndent(py), { useTabs: false, size: 4 });
});

test('detectIndent: a tab-indented C file', () => {
  const c = lines(
    'int main(void)',
    '{',
    '\tif (x) {',
    '\t\treturn 1;',
    '\t}',
    '\treturn 0;',
    '}'
  );
  assert.deepEqual(detectIndent(c), { useTabs: true });
});

test('detectIndent: the majority of indented lines decides tabs or spaces', () => {
  const mostlyTabs = lines('a', '\tb', '\tc', '\td', '  e', 'f');
  assert.deepEqual(detectIndent(mostlyTabs), { useTabs: true });
  const mostlySpaces = lines('a', '    b', '    c', '\td', 'e');
  assert.deepEqual(detectIndent(mostlySpaces), { useTabs: false, size: 4 });
});

test('detectIndent: block comments do not vote', () => {
  // Top-level JSDoc: one-space ` * ` lines above tab-indented code.
  const tabsWithDocs = lines(
    '/**',
    ' * Adds two numbers.',
    ' * @param a first',
    ' * @param b second',
    ' */',
    'function add(a, b) {',
    '\treturn a + b;',
    '}'
  );
  assert.deepEqual(detectIndent(tabsWithDocs), { useTabs: true });
  // Indented JSDoc inside a 2-space class: `   * ` lines (3 spaces) must not count.
  const spacesWithDocs = lines(
    'class A {',
    '  /**',
    '   * Says hello.',
    '   * More about it.',
    '   */',
    '  hello() {',
    '    return 1;',
    '  }',
    '}'
  );
  assert.deepEqual(detectIndent(spacesWithDocs), { useTabs: false, size: 2 });
});

test('detectIndent: coming out of nested blocks (big drops) does not set the width', () => {
  const js = lines(
    'a {',
    '  b {',
    '    c {',
    '      d',
    '    }',
    '  }',
    '}',
    'e {',
    '  f',
    '}'
  );
  assert.deepEqual(detectIndent(js), { useTabs: false, size: 2 });
});

test('detectIndent: alignment under an open paren is not an indent level', () => {
  const js = lines(
    'function f() {',
    '  const value = compute(first,',
    '                        second,',
    '                        third);',
    '  if (value) {',
    '    return value;',
    '  }',
    '}'
  );
  assert.deepEqual(detectIndent(js), { useTabs: false, size: 2 });
});

test('detectIndent: a tie between step widths goes to the smaller one', () => {
  const text = lines('a', '  b', 'c', '    d');
  assert.deepEqual(detectIndent(text), { useTabs: false, size: 2 });
});

test('detectIndent: a 3-space file is reported as found', () => {
  const text = lines('a:', '   b:', '      c', '   d', 'e:', '   f');
  assert.deepEqual(detectIndent(text), { useTabs: false, size: 3 });
});

test('detectIndent: nothing indented, an even split, or no text: no say', () => {
  assert.equal(detectIndent(lines('a', 'b', 'c')), null);
  assert.equal(detectIndent(lines('a', '\tb', '  c')), null);
  assert.equal(detectIndent(''), null);
  assert.equal(detectIndent(null), null);
  assert.equal(detectIndent(lines('a', '', '   ', '\t', 'b')), null); // whitespace-only lines
});

test('detectIndent: spaces with no measurable step leave the width to the setting', () => {
  // Every space-indented line follows a tab-indented one, so no step is ever measured.
  const text = lines('a', '\tb', '    c', '\td', '    e', '    f');
  assert.deepEqual(detectIndent(text), { useTabs: false, size: null });
});

test('detectIndent: one-space indents only count when nothing else does', () => {
  assert.equal(detectIndent(lines('a', ' b', ' c')), null);
  assert.deepEqual(detectIndent(lines('a', '  b', '   c', '    d')), { useTabs: false, size: 2 });
});

test('detectIndent: tolerates CRLF line ends', () => {
  assert.deepEqual(detectIndent('a {\r\n  b\r\n}\r\n'), { useTabs: false, size: 2 });
});

test('detectIndent: a huge file is only scanned at its start, and quickly', () => {
  const head = Array.from({ length: 20000 }, (_, i) => (i % 2 ? '  x' : 'y')).join('\n');
  const tail = Array.from({ length: 50000 }, () => '\tz').join('\n');
  const started = Date.now();
  assert.deepEqual(detectIndent(`${head}\n${tail}`), { useTabs: false, size: 2 });
  assert.ok(Date.now() - started < 1000);
});

/* ── indentForDocument / effectiveIndent / labels ────────────────────────────────────────── */

test('indentForDocument: Makefiles and Go use tabs whatever they contain', () => {
  const spaced = lines('all:', '    echo hi', '    echo there');
  assert.deepEqual(indentForDocument('Makefile', spaced), { useTabs: true });
  assert.deepEqual(indentForDocument('main.go', spaced), { useTabs: true });
  assert.deepEqual(indentForDocument('build.sh', spaced), { useTabs: false, size: 4 });
  assert.equal(indentForDocument('empty.txt', ''), null);
});

test('effectiveIndent: completes a document indentation from the setting', () => {
  assert.deepEqual(effectiveIndent(null, 4), { useTabs: false, size: 4 });
  assert.deepEqual(effectiveIndent({ useTabs: true }, 8), { useTabs: true, size: 8 });
  assert.deepEqual(effectiveIndent({ useTabs: false, size: 2 }, 4), { useTabs: false, size: 2 });
  assert.deepEqual(effectiveIndent({ useTabs: false, size: null }, 2), { useTabs: false, size: 2 });
  assert.deepEqual(effectiveIndent({ useTabs: true, size: 2 }, 8), { useTabs: true, size: 2 });
  // Garbage falls back to the setting, and a garbage setting to 4.
  assert.deepEqual(effectiveIndent({ useTabs: false, size: 0 }, 2), { useTabs: false, size: 2 });
  assert.deepEqual(effectiveIndent(undefined, 'x'), { useTabs: false, size: 4 });
});

test('indentUnitText and indentLabel', () => {
  assert.equal(indentUnitText({ useTabs: true, size: 4 }), '\t');
  assert.equal(indentUnitText({ useTabs: false, size: 2 }), '  ');
  assert.equal(indentLabel({ useTabs: false, size: 4 }), 'Spaces: 4');
  assert.equal(indentLabel({ useTabs: true, size: 8 }), 'Tab size: 8');
  assert.deepEqual(INDENT_SIZES, [2, 4, 8]);
});
