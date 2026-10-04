// Content sniffing and JSON-with-comments detection (src/languageDetect.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, sniffLanguage, looksLikeJson, isJsonWithComments } from '../src/languageDetect.js';

const sniffed = (text) => sniffLanguage(text)?.name ?? null;

test('logs that start with "[" are not JSON (M8)', () => {
  const logs = [
    '[2026-10-04 12:00:01] INFO Server started\n[2026-10-04 12:00:02] WARN Slow request\n',
    '[2026-10-04T12:00:01.123Z] started',
    '[INFO] Starting build\n[INFO] Done\n',
    '[ERROR] something failed',
    '[main] INFO  c.e.App - started',
    '[12:00:01] tick',
    '[1/3] Compiling',
    '[- INFO -] banner',
    '[true story] not a literal',
    '[ ] unchecked task'
  ];
  for (const log of logs) assert.equal(sniffed(log), null, JSON.stringify(log.slice(0, 30)));
});

test('real JSON is still JSON', () => {
  const json = [
    '{"name": "fate", "version": "1.14.0"}',
    '{\n  "a": 1\n}',
    '{}',
    '{ }',
    '[]',
    '[]\n',
    '[1, 2, 3]',
    '[-1.5e3, 0]',
    '[0,1]',
    '[true, false, null]',
    '[null, 1]',
    '["a", "b"]',
    '[\n  {\n    "id": 1\n  }\n]',
    '[[1, 2], [3, 4]]',
    '\uFEFF{"bom": true}',
    '   \n  [1, 2]',
    // JSONC: comments before the first token.
    '{\n  // editor settings\n  "a": 1\n}',
    '[ /* first */ 1, 2 ]'
  ];
  for (const text of json) assert.equal(sniffed(text), 'JSON', JSON.stringify(text));
});

test('the head rules match JSON whose first token fits the sniffed head', () => {
  assert.ok(looksLikeJson('[1,'));
  assert.ok(looksLikeJson('[ "x"'));
  assert.ok(looksLikeJson('{"k"'));
  assert.ok(!looksLikeJson('[2026-10-04'));
  assert.ok(!looksLikeJson('{name: 1}'), 'a JS object literal is not JSON');
  assert.ok(!looksLikeJson('{{ template }}'));
  assert.ok(!looksLikeJson('plain text'));
  assert.ok(!looksLikeJson(''));
  assert.ok(!looksLikeJson(undefined));
});

test('a small file that parses as a whole is JSON even when the head rules say no', () => {
  // A number longer than the 2 KB head: the head never shows what follows it.
  const longNumber = `[${'1'.repeat(3000)}]`;
  assert.equal(sniffed(longNumber), 'JSON');
  // The same shape that doesn't parse stays plain text.
  assert.equal(sniffed(`[${'1'.repeat(3000)} x`), null);
});

test('INI sections, shebangs and XML still win over JSON', () => {
  assert.equal(sniffed('[section]\nkey=value\n'), 'Properties files');
  // A lone one-value array reads as an INI section header, as it did before 1.14.0.
  assert.equal(sniffed('[0]'), 'Properties files');
  assert.equal(sniffed('; comment\n[core]\neditor = vim\n'), 'Properties files');
  assert.equal(sniffed('#!/usr/bin/env python3\nprint(1)\n'), 'Python');
  assert.equal(sniffed('<?xml version="1.0"?><a/>'), 'XML');
  assert.equal(sniffed('Windows Registry Editor Version 5.00\n\n[HKEY_CURRENT_USER\\Software]\n'), 'Properties files');
});

test('detectLanguage: the file name first, then the content', () => {
  // .log has no language in the registry, so the content decides, and a log is plain text.
  assert.equal(detectLanguage('server.log', '[2026-10-04 12:00:01] INFO Server started'), null);
  assert.equal(detectLanguage('server.log', '[INFO] Server started'), null);
  // A .json name wins whatever the content looks like.
  assert.equal(detectLanguage('data.json', '[2026-10-04').name, 'JSON');
  assert.equal(detectLanguage('notes', '{"a": 1}').name, 'JSON');
  assert.equal(detectLanguage('notes', '[INFO] hello'), null);
  // .jsonc isn't in the registry; its content still sniffs as JSON.
  assert.equal(detectLanguage('x.jsonc', '{\n  // comment\n  "a": 1\n}').name, 'JSON');
});

test('isJsonWithComments knows the JSONC files', () => {
  const jsonc = [
    'settings.jsonc', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json', 'jsconfig.json',
    '.eslintrc', '.eslintrc.json', 'settings.json', 'keybindings.json', 'launch.json', 'tasks.json',
    'devcontainer.json', '.devcontainer.json', 'fate.code-workspace', 'TSCONFIG.JSON',
    '/home/me/project/.vscode/settings.json', 'C:\\Users\\me\\project\\tsconfig.json'
  ];
  for (const name of jsonc) assert.ok(isJsonWithComments(name), name);
  const strict = ['package.json', 'package-lock.json', 'data.json', 'composer.json', 'tsconfig.ts', 'config.json', '', undefined, null];
  for (const name of strict) assert.ok(!isJsonWithComments(name), String(name));
});
