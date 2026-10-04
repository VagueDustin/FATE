// The command palette's ":" "@" "#" modes and their pure helpers (src/paletteModes.js).
// Symbol extraction runs against the real Lezer grammars FATE bundles, loaded the way the editor
// loads them: through @codemirror/language-data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import {
  scoreMatch, countLines, lineLengthIn, parseLineQuery, clampLineCol, searchText, searchDocs,
  snippet, extractSymbols, extractMarkdownHeadings, filterSymbols, plainHeading, createPaletteModes
} from '../src/paletteModes.js';

async function supportFor(languageName) {
  const desc = LanguageDescription.matchLanguageName(languages, languageName, false);
  assert.ok(desc, `language-data has ${languageName}`);
  return desc.load();
}

/** Symbols of `src` parsed as `languageName`, as compact "kind name @line:col" strings. */
async function symbolsOf(languageName, src) {
  const support = await supportFor(languageName);
  const tree = support.language.parser.parse(src);
  return extractSymbols(tree, src).map((s) => `${s.kind} ${s.name} @${s.line}:${s.col}`);
}

/* ── : go to line ─────────────────────────────────────────────────────────────────────────── */

test('parseLineQuery', () => {
  assert.equal(parseLineQuery(''), null);
  assert.equal(parseLineQuery('   '), null);
  assert.deepEqual(parseLineQuery('42'), { line: 42, col: null });
  assert.deepEqual(parseLineQuery(' 42 '), { line: 42, col: null });
  assert.deepEqual(parseLineQuery('42:7'), { line: 42, col: 7 });
  assert.deepEqual(parseLineQuery('42,7'), { line: 42, col: 7 });
  assert.deepEqual(parseLineQuery('42:'), { line: 42, col: null }, 'column still being typed');
  assert.deepEqual(parseLineQuery('0'), { line: 0, col: null });
  for (const bad of ['abc', '-3', '4.5', '42:x', ':', '1:2:3', '42 7']) {
    assert.ok(parseLineQuery(bad).error, bad);
  }
});

test('countLines, lineLengthIn and clampLineCol', () => {
  const text = 'one\ntwo two\n\nfour';
  assert.equal(countLines(text), 4);
  assert.equal(countLines(''), 1);
  assert.equal(countLines('a\n'), 2);
  assert.equal(lineLengthIn(text, 1), 3);
  assert.equal(lineLengthIn(text, 2), 7);
  assert.equal(lineLengthIn(text, 3), 0);
  assert.equal(lineLengthIn(text, 4), 4);
  assert.equal(lineLengthIn(text, 9), 0);
  const len = (n) => lineLengthIn(text, n);
  assert.deepEqual(clampLineCol(2, 3, 4, len), { line: 2, col: 3 });
  assert.deepEqual(clampLineCol(99, null, 4, len), { line: 4, col: 1 });
  assert.deepEqual(clampLineCol(0, 0, 4, len), { line: 1, col: 1 });
  assert.deepEqual(clampLineCol(2, 500, 4, len), { line: 2, col: 8 }, 'one past the last character');
});

/* ── # search ─────────────────────────────────────────────────────────────────────────────── */

test('searchText: case-insensitive, one hit per line, 1-based positions', () => {
  const text = 'Alpha beta\nnothing here\n  BETA beta Beta\nend';
  assert.deepEqual(searchText(text, 'beta'), [
    { line: 1, col: 7, text: 'Alpha beta' },
    { line: 3, col: 3, text: '  BETA beta Beta' }
  ]);
  assert.deepEqual(searchText(text, 'zzz'), []);
  assert.deepEqual(searchText(text, ''), []);
  assert.equal(searchText(text, 'beta', 1).length, 1);
  // Regex characters are literal.
  assert.deepEqual(searchText('a.b\naxb\n(x)', '.'), [{ line: 1, col: 2, text: 'a.b' }]);
  assert.deepEqual(searchText('call(x)', '(x)'), [{ line: 1, col: 5, text: 'call(x)' }]);
  // Last line without a newline, and a match at the very end.
  assert.deepEqual(searchText('x\ny\nfind', 'find'), [{ line: 3, col: 1, text: 'find' }]);
});

test('searchText keeps positions right after characters that change length when lower-cased', () => {
  const text = 'İstanbul\nİzmir needle';
  assert.deepEqual(searchText(text, 'needle'), [{ line: 2, col: 7, text: 'İzmir needle' }]);
});

test('searchDocs caps hits per document and in total', () => {
  const many = Array.from({ length: 50 }, (_, i) => `match ${i}`).join('\n');
  const docs = Array.from({ length: 15 }, (_, i) => ({ id: i, name: `doc${i}.txt`, text: many }));
  const hits = searchDocs(docs, (d) => d.text, 'MATCH', { perDoc: 20, total: 200 });
  assert.equal(hits.length, 200);
  for (let i = 0; i < 10; i++) assert.equal(hits.filter((h) => h.doc.id === i).length, 20);
  assert.equal(hits.filter((h) => h.doc.id >= 10).length, 0, 'the total cap stops in tab order');
  assert.equal(hits[0].line, 1);
  assert.equal(hits[19].line, 20);
});

test('snippet trims and windows long lines around the match', () => {
  assert.equal(snippet('    const x = 1;   ', 11), 'const x = 1;');
  const long = `${'a'.repeat(300)}NEEDLE${'b'.repeat(300)}`;
  const s = snippet(long, 301, 120);
  assert.ok(s.includes('NEEDLE'));
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok(s.length <= 122);
});

/* ── @ symbols ────────────────────────────────────────────────────────────────────────────── */

test('JavaScript symbols', async () => {
  const src = [
    'export function foo(a) { function inner() {} return a }', // 1
    'export default class Bar extends Baz {', // 2
    '  method() {}', // 3
    '  static async sm() {}', // 4
    '  get g() { return 1 }', // 5
    '  #priv() {}', // 6
    '  field = () => 1;', // 7
    '  [Symbol.iterator]() {}', // 8 (computed: no name)
    '}', // 9
    'const arrow = (x) => x, notfn = 3;', // 10
    'let fexpr = function named() {};', // 11
    'const obj = { meth() {}, prop: () => 1 };', // 12 (object members: not symbols)
    'export default function () {}' // 13 (anonymous)
  ].join('\n');
  assert.deepEqual(await symbolsOf('JavaScript', src), [
    'function foo @1:17',
    'function inner @1:35',
    'class Bar @2:22',
    'method method @3:3',
    'method sm @4:16',
    'method g @5:7',
    'method #priv @6:3',
    'method field @7:3',
    'function arrow @10:7',
    'function fexpr @11:5' // the expression's own name ("named") is not a second symbol
  ]);
});

test('TypeScript symbols', async () => {
  const src = [
    'interface IFoo { x: number }',
    'type Alias = string | number;',
    'enum Color { Red, Green }',
    'namespace NS { export function f(): void {} }',
    'abstract class Abs { abstract m(): void; run(): void {} }',
    'const handler: Handler = async () => {};'
  ].join('\n');
  assert.deepEqual(await symbolsOf('TypeScript', src), [
    'interface IFoo @1:11',
    'type Alias @2:6',
    'enum Color @3:6',
    'module NS @4:11',
    'function f @4:32',
    'class Abs @5:16',
    'method m @5:31',
    'method run @5:42',
    'function handler @6:7'
  ]);
});

test('Python symbols: functions, classes, methods, decorated and nested', async () => {
  const src = [
    '@dec',
    'def foo(a, b):',
    '    def helper():',
    '        pass',
    '    return a',
    '',
    'class Bar(Base):',
    '    def method(self):',
    '        def closure():',
    '            pass',
    '        return 1',
    '',
    '    async def am(self):',
    '        pass',
    ''
  ].join('\n');
  assert.deepEqual(await symbolsOf('Python', src), [
    'function foo @2:5',
    'function helper @3:9',
    'class Bar @7:7',
    'method method @8:9',
    'function closure @9:13',
    'method am @13:15'
  ]);
});

test('Markdown headings from the tree, without code blocks or Markdown syntax', async () => {
  const src = [
    '# Title', // 1
    '', // 2
    'Para', // 3
    '', // 4
    'Setext *one*', // 5
    '======', // 6
    '', // 7
    '## Sub `code` [link](http://x) ##', // 8
    '', // 9
    '```js', // 10
    '# not a heading', // 11
    'function x() {}', // 12
    '```', // 13
    '', // 14
    'Sub two', // 15
    '---', // 16
    '', // 17
    '###### Deep __bold__ snake_case_name' // 18
  ].join('\n');
  const support = await supportFor('Markdown');
  const tree = support.language.parser.parse(src);
  const headings = extractSymbols(tree, src).map((s) => [s.level, s.name, s.line]);
  assert.deepEqual(headings, [
    [1, 'Title', 1],
    [1, 'Setext one', 5],
    [2, 'Sub code link', 8],
    [2, 'Sub two', 15],
    [6, 'Deep bold snake_case_name', 18]
  ]);
  // The text scanner (reading view, no editor) finds the same headings.
  assert.deepEqual(extractMarkdownHeadings(src).map((s) => [s.level, s.name, s.line]), headings);
});

test('extractMarkdownHeadings: front matter, fences, lists and multi-line setext', () => {
  const src = [
    '---', // 1 front matter
    'title: Not a heading', // 2
    '---', // 3
    '# Real', // 4
    '~~~~', // 5
    '## fenced', // 6
    '~~~', // 7 (too short to close a ~~~~ fence)
    '~~~~', // 8
    '- item', // 9
    '---', // 10 (a rule after a list, not a heading)
    'Line one', // 11
    'line two', // 12
    '---', // 13 (setext over both lines)
    '    # indented code', // 14
    '#hashtag', // 15 (no space: not a heading)
    '#', // 16 (empty heading: skipped)
    'C# notes ##' // 17
  ].join('\n');
  assert.deepEqual(extractMarkdownHeadings(src).map((s) => [s.level, s.name, s.line]), [
    [1, 'Real', 4],
    [2, 'Line one line two', 11]
  ]);
  assert.deepEqual(extractMarkdownHeadings(''), []);
  assert.deepEqual(extractMarkdownHeadings(undefined), []);
});

test('plainHeading strips inline Markdown', () => {
  assert.equal(plainHeading('The **bold** and *em* `code`'), 'The bold and em code');
  assert.equal(plainHeading('[Docs](https://x.y) and ![img](a.png)'), 'Docs and img');
  assert.equal(plainHeading('keep snake_case_and 2*3*4'), 'keep snake_case_and 2*3*4');
  assert.equal(plainHeading('<kbd>Ctrl</kbd>  +  K'), 'Ctrl + K');
});

test('Rust symbols', async () => {
  const src = [
    'pub fn foo(a: i32) -> i32 { a }',
    'struct Point { x: f64 }',
    'enum E { A, B }',
    'trait T { fn tm(&self); }',
    'impl T for Point { fn tm(&self) {} }',
    'type Alias = u32;',
    'mod inner { fn deep() {} }'
  ].join('\n');
  assert.deepEqual(await symbolsOf('Rust', src), [
    'function foo @1:8',
    'struct Point @2:8',
    'enum E @3:6',
    'interface T @4:7',
    'method tm @4:14',
    'impl impl T for Point @5:1',
    'method tm @5:23',
    'type Alias @6:6',
    'module inner @7:5',
    'function deep @7:16'
  ]);
});

test('Go symbols', async () => {
  const src = [
    'package main',
    'func foo(a int) int { return a }',
    'func (r *Recv) Method(x int) {}',
    'type Point struct { X int }',
    'type Iface interface { M() }',
    'type Alias = int'
  ].join('\n');
  assert.deepEqual(await symbolsOf('Go', src), [
    'function foo @2:6',
    'method Method @3:16',
    'struct Point @4:6',
    'interface Iface @5:6',
    'type Alias @6:6'
  ]);
});

test('Java symbols', async () => {
  const src = [
    'public class Foo<T> extends Bar {',
    '  private int x;',
    '  public Foo() {}',
    '  public static String method(int a) { return ""; }',
    '  interface Inner { void m(); }',
    '  enum E { A }',
    '}'
  ].join('\n');
  assert.deepEqual(await symbolsOf('Java', src), [
    'class Foo @1:14',
    'method Foo @3:10',
    'method method @4:24',
    'interface Inner @5:13',
    'method m @5:26',
    'enum E @6:8'
  ]);
});

test('C and C++ symbols: definitions, prototypes, and no struct uses', async () => {
  const src = [
    'int add(int a, int b) { return a + b; }', // 1
    'static char *ptr_fn(void) { return 0; }', // 2
    'MyType Ns::Klass::method(int x) const { return x; }', // 3
    'Klass::~Klass() {}', // 4
    'struct S { int a; };', // 5
    'struct stat st;', // 6 (a use, not a definition)
    'class C : public B { public: void m(); int inl() { return 1; } };', // 7
    'namespace ns { void f(); }', // 8
    'enum Color { RED };', // 9
    'typedef unsigned long ulong;', // 10
    'int (*fp)(int);', // 11 (a function pointer variable)
    'int proto(int);' // 12
  ].join('\n');
  assert.deepEqual(await symbolsOf('C++', src), [
    'function add @1:5',
    'function ptr_fn @2:14',
    'method Ns::Klass::method @3:8',
    'method Klass::~Klass @4:1',
    'struct S @5:8',
    'class C @7:7',
    'method m @7:35',
    'method inl @7:44',
    'module ns @8:11',
    'function f @8:21',
    'enum Color @9:6',
    'type ulong @10:23',
    'function proto @12:5'
  ]);
});

test('CSS rules, nested rules and keyframes', async () => {
  const src = '.a, #b > c:hover { color: red }\n@media (max-width: 10px) {\n  .inner { x: y }\n}\n@keyframes spin { from { a: b } }\n';
  assert.deepEqual(await symbolsOf('CSS', src), [
    'rule .a, #b > c:hover @1:1',
    'rule .inner @3:3',
    'rule @keyframes spin @5:1'
  ]);
});

test('PHP symbols', async () => {
  const src = '<?php\nfunction foo($a) { return $a; }\nclass Bar { public function method() {} }\ninterface I {}\ntrait T {}\n';
  assert.deepEqual(await symbolsOf('PHP', src), [
    'function foo @2:10',
    'class Bar @3:7',
    'method method @3:29',
    'interface I @4:11',
    'interface T @5:7'
  ]);
});

test('functions inside an HTML <script> are found', async () => {
  const src = '<html><script>\nfunction inScript() {}\n</script><style>.cls { a: b }</style></html>';
  assert.deepEqual(await symbolsOf('HTML', src), ['function inScript @2:10', 'rule .cls @3:17']);
});

test('filterSymbols ranks by match quality, then document order', () => {
  const symbols = [
    { name: 'renderPane', line: 1 },
    { name: 'openRecent', line: 2 },
    { name: 'render', line: 3 },
    { name: 'onRender', line: 4 }
  ];
  assert.deepEqual(filterSymbols(symbols, ''), symbols);
  assert.deepEqual(filterSymbols(symbols, 'render').map((s) => s.name), ['renderPane', 'render', 'onRender']);
  assert.deepEqual(filterSymbols(symbols, 'zzz'), []);
  assert.ok(scoreMatch('rp', 'renderPane') > 0);
});

/* ── createPaletteModes with a fake App ───────────────────────────────────────────────────── */

async function viewFor(languageName, text) {
  const support = await supportFor(languageName);
  return { state: EditorState.create({ doc: text, extensions: [support] }) };
}

function fakeApp({ docs, activeId, views = {} }) {
  const calls = [];
  const ctx = {
    getActiveDoc: () => docs.find((d) => d.id === activeId) ?? null,
    getActiveView: () => views[activeId] ?? null,
    getDocs: () => docs,
    getDocText: (d) => d.text,
    activateDoc: (id) => calls.push(['activate', id]),
    revealLine: (id, line, col) => calls.push(['reveal', id, line, col])
  };
  return { modes: createPaletteModes(ctx), calls };
}

test('modes have labels, hints and placeholders for the palette', () => {
  const { modes } = fakeApp({ docs: [], activeId: null });
  assert.deepEqual(Object.keys(modes), [':', '@', '#']);
  assert.deepEqual(Object.values(modes).map((m) => m.hint), ['go to line', 'symbol', 'search open tabs']);
  for (const m of Object.values(modes)) {
    assert.equal(typeof m.label, 'string');
    assert.equal(typeof m.placeholder, 'string');
    assert.equal(typeof m.getItems, 'function');
  }
});

test(': mode goes to a clamped line in a reading-view tab (text only)', () => {
  const doc = { id: 7, kind: 'markdown', name: 'notes.md', text: '# A\n\ntext\nlast line' };
  const { modes, calls } = fakeApp({ docs: [doc], activeId: 7 });
  const go = modes[':'];

  const [hint] = go.getItems('');
  assert.ok(hint.disabled && /1 to 4/.test(hint.label));
  const [error] = go.getItems('abc');
  assert.ok(error.disabled && error.error);

  const [item] = go.getItems('3');
  assert.equal(item.label, 'Go to line 3');
  assert.equal(item.detail, 'notes.md · 4 lines');
  item.run();
  const [far] = go.getItems('999:999');
  assert.equal(far.label, 'Go to line 4, column 10');
  far.run();
  assert.deepEqual(calls, [['reveal', 7, 3, 1], ['reveal', 7, 4, 10]]);
});

test(': mode with a live editor uses its document', async () => {
  const doc = { id: 1, kind: 'code', name: 'a.js', text: 'stale text' };
  const view = await viewFor('JavaScript', 'let a = 1;\nlet bb = 2;\n');
  const { modes, calls } = fakeApp({ docs: [doc], activeId: 1, views: { 1: view } });
  const [item] = modes[':'].getItems('2:99');
  assert.equal(item.label, 'Go to line 2, column 12');
  item.run();
  assert.deepEqual(calls, [['reveal', 1, 2, 12]]);
  const [none] = fakeApp({ docs: [], activeId: null }).modes[':'].getItems('3');
  assert.ok(none.disabled);
});

test('@ mode lists and filters symbols, and reveals the chosen one', async () => {
  const text = 'function alpha() {}\nclass Beta { gamma() {} }\nconst delta = () => 1;\n';
  const doc = { id: 3, kind: 'code', name: 'x.js', text };
  const view = await viewFor('JavaScript', text);
  const { modes, calls } = fakeApp({ docs: [doc], activeId: 3, views: { 3: view } });
  const sym = modes['@'];

  const all = sym.getItems('');
  assert.deepEqual(all.map((i) => i.label), ['alpha', 'Beta', 'gamma', 'delta']);
  assert.deepEqual(all.map((i) => i.detail), ['Function · line 1', 'Class · line 2', 'Method · line 2', 'Function · line 3']);
  assert.ok(all.every((i) => typeof i.icon === 'object' || typeof i.icon === 'function'));

  const filtered = sym.getItems('gam');
  assert.deepEqual(filtered.map((i) => i.label), ['gamma']);
  filtered[0].run();
  assert.deepEqual(calls, [['reveal', 3, 2, 14]]);

  const [nomatch] = sym.getItems('zzz');
  assert.ok(nomatch.disabled && /No symbols match "zzz"/.test(nomatch.label));
});

test('@ mode in a Markdown reading view scans the text for headings', () => {
  const doc = { id: 4, kind: 'markdown', name: 'r.md', text: '# One\n\n## Two\n\nbody\n' };
  const { modes, calls } = fakeApp({ docs: [doc], activeId: 4 });
  const items = modes['@'].getItems('');
  assert.deepEqual(items.map((i) => [i.label, i.detail]), [['One', 'Heading 1 · line 1'], ['Two', 'Heading 2 · line 3']]);
  items[1].run();
  assert.deepEqual(calls, [['reveal', 4, 3, 1]]);

  const empty = fakeApp({ docs: [{ ...doc, text: 'no headings' }], activeId: 4 }).modes['@'].getItems('');
  assert.equal(empty[0].label, 'This document has no headings');
});

test('@ mode reuses its symbols while the document is unchanged', async () => {
  const text = 'function a() {}\n';
  const view = await viewFor('JavaScript', text);
  const doc = { id: 1, kind: 'code', name: 'a.js', text };
  const { modes } = fakeApp({ docs: [doc], activeId: 1, views: { 1: view } });
  const first = modes['@'].getItems('');
  view.state = view.state.update({ changes: { from: text.length, insert: 'function b() {}\n' } }).state;
  const second = modes['@'].getItems('');
  assert.deepEqual(first.map((i) => i.label), ['a']);
  assert.deepEqual(second.map((i) => i.label), ['a', 'b'], 'a new document state is re-read');
});

test('# mode searches every open tab and switches tab before revealing', () => {
  const docs = [
    { id: 1, kind: 'code', name: 'a.js', text: 'const Needle = 1;\nnothing\n  needle again' },
    { id: 2, kind: 'markdown', name: 'b.md', text: '# NEEDLE heading' },
    { id: 3, kind: 'code', name: 'c.txt', text: 'no match here' }
  ];
  const { modes, calls } = fakeApp({ docs, activeId: 1 });
  const find = modes['#'];

  assert.ok(find.getItems('')[0].disabled);
  assert.ok(find.getItems('   ')[0].disabled, 'only spaces after "#" is still an empty query');
  const items = find.getItems(' needle');
  assert.deepEqual(items.map((i) => [i.label, i.detail]), [
    ['const Needle = 1;', 'a.js:1'],
    ['needle again', 'a.js:3'],
    ['# NEEDLE heading', 'b.md:1']
  ]);
  items[1].run();
  items[2].run();
  assert.deepEqual(calls, [['reveal', 1, 3, 3], ['activate', 2], ['reveal', 2, 1, 3]]);

  const [none] = find.getItems('absent');
  assert.ok(none.disabled && /No matches for "absent"/.test(none.label));
  assert.ok(fakeApp({ docs: [], activeId: null }).modes['#'].getItems('x')[0].disabled);
});
