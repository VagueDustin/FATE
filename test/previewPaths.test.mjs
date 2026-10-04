// Link targets, image sources and heading slugs in the markdown preview (src/previewPaths.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePath,
  stripQueryAndHash,
  resolveAgainstDoc,
  classifyImageSrc,
  toFateLocalUrl,
  resolveLinkTarget,
  slugify,
  createSlugger
} from '../src/previewPaths.js';

const POSIX_DOC = '/home/me/docs/guide/readme.md';
const WIN_DOC = 'C:\\Users\\me\\docs\\readme.md';
const UNC_DOC = '\\\\server\\share\\docs\\readme.md';

test('decodePath undoes marked encoding and keeps a stray %', () => {
  assert.equal(decodePath('my%20image.png'), 'my image.png');
  assert.equal(decodePath('%C3%9Cbersicht.png'), 'Übersicht.png');
  assert.equal(decodePath('100%.png'), '100%.png');
});

test('stripQueryAndHash runs before decoding, so %23 stays part of the name', () => {
  assert.equal(stripQueryAndHash('pic.png?raw=1#x'), 'pic.png');
  assert.equal(decodePath(stripQueryAndHash('a%23b.png#frag')), 'a#b.png');
});

test('resolveAgainstDoc: relative, parent, absolute, per platform', () => {
  assert.equal(resolveAgainstDoc('img/a.png', POSIX_DOC), '/home/me/docs/guide/img/a.png');
  assert.equal(resolveAgainstDoc('../CONTRIBUTING.md', POSIX_DOC), '/home/me/docs/CONTRIBUTING.md');
  assert.equal(resolveAgainstDoc('./a/../b.md', POSIX_DOC), '/home/me/docs/guide/b.md');
  assert.equal(resolveAgainstDoc('/etc/x.md', POSIX_DOC), '/etc/x.md');
  assert.equal(resolveAgainstDoc('../../../../../x.md', POSIX_DOC), '/x.md');
  assert.equal(resolveAgainstDoc('img/a.png', WIN_DOC), 'C:\\Users\\me\\docs\\img\\a.png');
  assert.equal(resolveAgainstDoc('..\\other.md', WIN_DOC), 'C:\\Users\\me\\other.md');
  assert.equal(resolveAgainstDoc('/abs/x.md', WIN_DOC), 'C:\\abs\\x.md');
  assert.equal(resolveAgainstDoc('D:/data/x.md', WIN_DOC), 'D:\\data\\x.md');
  assert.equal(resolveAgainstDoc('b.md', UNC_DOC), '\\\\server\\share\\docs\\b.md');
  assert.equal(resolveAgainstDoc('../../../b.md', UNC_DOC), '\\\\server\\share\\b.md');
  assert.equal(resolveAgainstDoc('b.md', null), null);
  assert.equal(resolveAgainstDoc('/abs/b.png', null), '/abs/b.png');
});

test('classifyImageSrc: local paths are decoded once (M6)', () => {
  assert.deepEqual(classifyImageSrc('my%20image.png', POSIX_DOC), { kind: 'local', path: '/home/me/docs/guide/my image.png' });
  assert.deepEqual(classifyImageSrc('%C3%9Cbersicht.png', POSIX_DOC), { kind: 'local', path: '/home/me/docs/guide/Übersicht.png' });
  assert.deepEqual(classifyImageSrc('pic.png?raw=true#light', POSIX_DOC), { kind: 'local', path: '/home/me/docs/guide/pic.png' });
  assert.deepEqual(classifyImageSrc('C:%5Cpics%5Ca.png', POSIX_DOC), { kind: 'local', path: 'C:\\pics\\a.png' });
});

test('classifyImageSrc: // is remote, never local (C5)', () => {
  assert.deepEqual(classifyImageSrc('//attacker.example/share/x.png', WIN_DOC), {
    kind: 'remote',
    url: 'https://attacker.example/share/x.png',
    host: 'attacker.example'
  });
  assert.equal(classifyImageSrc('https://example.com/a.png', WIN_DOC).kind, 'remote');
  // Plain http is upgraded: the renderer's CSP only admits https images.
  assert.deepEqual(classifyImageSrc('HTTP://example.com/a.png', WIN_DOC), { kind: 'remote', url: 'https://example.com/a.png', host: 'example.com' });
  // Encoded UNC paths decode to a network share: blocked outright.
  assert.deepEqual(classifyImageSrc('%5C%5Cserver%5Cshare%5Cx.png', WIN_DOC), { kind: 'blocked', host: 'server' });
  assert.deepEqual(classifyImageSrc('%2F%2Fserver/x.png', POSIX_DOC), { kind: 'blocked', host: 'server' });
  assert.equal(classifyImageSrc('ftp://example.com/a.png', POSIX_DOC).kind, 'blocked');
  assert.equal(classifyImageSrc('data:image/png;base64,AAAA', POSIX_DOC).kind, 'data');
  assert.equal(classifyImageSrc('', POSIX_DOC).kind, 'none');
  assert.equal(classifyImageSrc('rel.png', null).kind, 'unresolved');
});

test('toFateLocalUrl encodes each segment once', () => {
  assert.equal(toFateLocalUrl('/home/me/my image.png'), 'fate-local://local/home/me/my%20image.png');
  assert.equal(toFateLocalUrl('C:\\pics\\Übersicht #1.png'), 'fate-local://local/C%3A/pics/%C3%9Cbersicht%20%231.png');
  assert.equal(toFateLocalUrl('/x/100%.png'), 'fate-local://local/x/100%25.png');
});

test('resolveLinkTarget sorts links into fragment, file, external and ignore', () => {
  assert.deepEqual(resolveLinkTarget('#%C3%9Cber-uns', POSIX_DOC), { kind: 'fragment', fragment: 'Über-uns' });
  assert.deepEqual(resolveLinkTarget('../CONTRIBUTING.md', POSIX_DOC), { kind: 'file', path: '/home/me/docs/CONTRIBUTING.md', fragment: '' });
  assert.deepEqual(resolveLinkTarget('other.md?plain=1#Setup', POSIX_DOC), { kind: 'file', path: '/home/me/docs/guide/other.md', fragment: 'Setup' });
  assert.deepEqual(resolveLinkTarget('my%20file.md', WIN_DOC), { kind: 'file', path: 'C:\\Users\\me\\docs\\my file.md', fragment: '' });
  assert.deepEqual(resolveLinkTarget('https://example.com/a', POSIX_DOC), { kind: 'external', url: 'https://example.com/a' });
  assert.deepEqual(resolveLinkTarget('mailto:a@example.com', POSIX_DOC), { kind: 'external', url: 'mailto:a@example.com' });
  for (const href of ['//host/x.md', '%5C%5Cserver%5Cshare%5Cx.md', 'ftp://x/y', 'tel:123', 'javascript:alert(1)', '', 'rel.md']) {
    const docPath = href === 'rel.md' ? null : POSIX_DOC;
    assert.deepEqual(resolveLinkTarget(href, docPath), { kind: 'ignore' }, href);
  }
});

test('slugify matches GitHub', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('Über uns'), 'über-uns');
  assert.equal(slugify('A – B'), 'a--b');
  assert.equal(slugify('snake_case and `code`'), 'snake_case-and-code');
  assert.equal(slugify('🎉 Party'), '-party');
  assert.equal(slugify('1.14.0 (2026-10-04)'), '1140-2026-10-04');
  assert.equal(slugify('\\theta and x²'), 'theta-and-x');
});

test('createSlugger numbers repeats the way github-slugger does', () => {
  const slug = createSlugger();
  assert.deepEqual(['Intro 1', 'Intro', 'Intro', 'Intro'].map(slug), ['intro-1', 'intro', 'intro-2', 'intro-3']);
  assert.equal(slug('🎉'), 'section');
  assert.equal(slug('✨'), 'section-1');
});
