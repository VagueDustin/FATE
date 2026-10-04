// FATE's rules around the KaTeX tokenizers (src/markdownMath.js), run through the real marked and
// marked-katex-extension the app uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import { repairTex, withTexRepair } from '../src/markdownMath.js';

const md = new Marked({ gfm: true, breaks: true });
md.use({ extensions: markedKatex({ throwOnError: false, nonStandard: true }).extensions.map(withTexRepair) });

/** Every maths token in `src`, as [type, text]. */
function maths(src) {
  const found = [];
  md.walkTokens(md.lexer(src), (t) => {
    if (t.type === 'inlineKatex' || t.type === 'blockKatex') found.push([t.type, t.text]);
  });
  return found;
}

test('a closing $ followed by a digit is not maths (L7)', () => {
  assert.deepEqual(maths('Costs $5 and $10 today.'), []);
  assert.deepEqual(maths('It is $x$5 wide'), []);
  assert.deepEqual(maths('Angle $\\theta$ and $x^2$, done.'), [['inlineKatex', '\\theta'], ['inlineKatex', 'x^2']]);
  assert.deepEqual(maths('$$\nx = 5\n$$\n'), [['blockKatex', 'x = 5']]);
});

test('a clean control space stays a control space (M9)', () => {
  assert.equal(repairTex('$10\\ \\mathrm{kg}$'), '$10\\ \\mathrm{kg}$');
  assert.deepEqual(maths('Mass $10\\ \\mathrm{kg}$ ok'), [['inlineKatex', '10\\ \\mathrm{kg}']]);
  // A clean `\\ ` row break is left alone too (it used to gain a stray control space).
  assert.equal(repairTex('\\begin{pmatrix} a \\\\ b \\end{pmatrix}'), '\\begin{pmatrix} a \\\\ b \\end{pmatrix}');
});

test('in a corrupted formula every repair still applies, \\ included', () => {
  assert.equal(repairTex('\x09heta \\ x'), '\\theta \\\\ x');
  assert.equal(repairTex('\x08egin{aligned} a &= b \\ c &= d \\end{aligned}'), '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}');
  assert.deepEqual(maths('A $\x07lpha \x07pprox 1$.'), [['inlineKatex', '\\alpha \\approx 1']]);
  assert.deepEqual(maths('V $\x0Bec{v}$.'), [['inlineKatex', '\\vec{v}']]);
  // A tab that isn't one of the corrupted escapes is not corruption.
  assert.equal(repairTex('a\x09b \\ c'), 'a\x09b \\ c');
});

test('the raw span is unchanged, so the lexer advances over what was written', () => {
  const tokens = md.lexer('Eq $x = \x09heta + 1$ ok.');
  const inline = tokens[0].tokens.find((t) => t.type === 'inlineKatex');
  assert.equal(inline.raw, '$x = \x09heta + 1$');
  assert.equal(inline.text, 'x = \\theta + 1');
});
