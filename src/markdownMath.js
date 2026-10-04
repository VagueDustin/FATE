/**
 * markdownMath.js: the rules wrapped around marked-katex-extension's tokenizers. Its own module, with
 * no DOM and no CSS imports, so `node --test` can run the real marked + KaTeX tokenizers through it
 * (test/markdownMath.test.mjs). markdown.js wires it in.
 */

/*
 * ── Corrupted TeX is repaired in maths ONLY ──────────────────────────────────────────────────
 * Some generators write "\theta" into a string without escaping the backslash, so the file holds
 * a real TAB followed by "heta". TEX_REPAIRS turns those back into TeX. Up to 1.13.4 they ran over
 * the WHOLE document, code included: a tab-indented `auth := x` in a ```go block rendered as the
 * literal text `\tauth := x`, `cd My\ Documents` in a ```bash block became `My\\ Documents`, and
 * copying the block put the damage on the clipboard. Now each KaTeX tokenizer finds maths in the
 * source exactly as written, then re-reads the repaired span to get the formula. `raw` keeps the
 * original text, because the lexer advances by its length.
 *
 * The two carriage-return repairs live in renderMarkdown instead: marked turns a lone CR into a
 * line break before any tokenizer sees it.
 */
/* eslint-disable no-control-regex */
export const TEX_REPAIRS = [
  [/\x09heta/g, '\\theta'],
  [/\x09ext/g, '\\text'],
  [/\x09imes/g, '\\times'],
  [/\x09au/g, '\\tau'],
  [/\x0Crac/g, '\\frac'],
  [/\x08eta/g, '\\beta'],
  [/\x08egin/g, '\\begin'],
  [/\x07pprox/g, '\\approx'],
  [/\x07lpha/g, '\\alpha'],
  [/\x0B/g, '\\v'],
  [/\\ /g, '\\\\ ']
];
/* eslint-enable no-control-regex */

/*
 * The last rule (`\ ` → `\\ `) is the one repair that can also match CORRECT TeX. A generator
 * that loses its escapes turns `\\ ` (a line break in an aligned block) into `\ `, but `\ ` is
 * also TeX's control space, so `$10\ \mathrm{kg}$` rendered on two lines. It now applies only
 * when one of the control-character repairs above also fired in the same formula, i.e. when the
 * formula really did come from a generator that lost its escapes.
 */
const CONTROL_SPACE = TEX_REPAIRS[TEX_REPAIRS.length - 1];
const CORRUPTION_REPAIRS = TEX_REPAIRS.slice(0, -1);

const applyRepairs = (tex, rules) => rules.reduce((s, [pattern, fix]) => s.replace(pattern, fix), tex);

export function repairTex(tex) {
  const repaired = applyRepairs(tex, CORRUPTION_REPAIRS);
  return repaired === tex ? tex : applyRepairs(repaired, [CONTROL_SPACE]);
}

/**
 * Wrap one of marked-katex-extension's extensions (inline or block) with FATE's rules:
 *
 *   - Inline maths whose closing `$` is followed straight away by a digit isn't maths (Pandoc's
 *     rule), so "costs $5 and $10" stays prose instead of rendering " 5 and " as a formula. With
 *     `nonStandard: true` the extension otherwise accepts any `$…$` pair.
 *   - TEX_REPAIRS, applied to the maths alone (see above).
 */
export function withTexRepair(extension) {
  const tokenize = extension.tokenizer;
  const inline = extension.level === 'inline';
  return {
    ...extension,
    tokenizer(src, tokens) {
      const token = tokenize.call(this, src, tokens);
      if (!token) return token;
      if (inline && /[0-9]/.test(src.charAt(token.raw.length))) return undefined;
      const repairedRaw = repairTex(token.raw);
      if (repairedRaw === token.raw) return token;
      const repaired = tokenize.call(this, repairedRaw, tokens);
      return repaired?.raw === repairedRaw ? { ...token, text: repaired.text } : token;
    }
  };
}
