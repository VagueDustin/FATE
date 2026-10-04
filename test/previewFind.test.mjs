// Query folding and matching for find in the reading view (src/previewFind.js). The index walk
// itself needs a DOM and is covered in the running app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldQuery, findMatches } from '../src/previewFind.js';

test('foldQuery lower-cases and collapses whitespace like the index does', () => {
  assert.equal(foldQuery('Filler  Paragraph'), 'filler paragraph');
  assert.equal(foldQuery('a\tb c\nd'), 'a b c d');
  assert.equal(foldQuery('ÜBER'), 'über');
  // A character whose lower case is longer (İ → i̇) stays as typed, as in the index.
  assert.equal(foldQuery('İx'), 'İx');
  assert.equal(foldQuery(''), '');
});

test('findMatches returns every non-overlapping match', () => {
  const index = { text: 'aaaa banana\u0000ana' };
  assert.deepEqual(findMatches(index, 'aa'), [0, 2]);
  assert.deepEqual(findMatches(index, 'ana'), [6, 12]);
  assert.deepEqual(findMatches(index, ''), []);
  assert.deepEqual(findMatches(index, 'zz'), []);
});

test('a match never runs across a block break', () => {
  // "banana" ends one paragraph and "ana" starts the next; the break is not a space.
  assert.deepEqual(findMatches({ text: 'banana\u0000ana' }, foldQuery('na ana')), []);
});
