/**
 * indentDetect.js: how a document indents, tabs or spaces and how wide (1.14.0, M7).
 *
 * Up to 1.13.4 the editor's indent unit was always the "Indent size" setting in spaces, so the Tab
 * key put spaces into a Makefile recipe (make then fails with "missing separator") and into Go
 * files (which gofmt indents with tabs), and a 2-space project edited at the default 4 came out
 * mixed. Now each document gets its own indentation when it opens:
 *
 *   1. what the file type requires: Makefiles and Go always indent with tabs;
 *   2. else the file's own convention: whichever of tabs or spaces most indented lines start
 *      with, and for spaces the step most indentation increases use;
 *   3. else (nothing indented yet, an even split) the user's setting, spaces of "Indent size".
 *
 * The status bar shows the result ("Spaces: 2", "Tab size: 4") and can change it for that
 * document. Detection and changes only decide what NEW indentation looks like; nothing already in
 * the file is re-indented.
 *
 * A document's indentation is `{ useTabs: true }` (the tab WIDTH then follows the setting),
 * `{ useTabs: false, size }`, or null for "use the setting". effectiveIndent() completes any of
 * them into what the editor needs. Pure, for `node --test` (test/indentDetect.test.mjs).
 */

/** The sizes the status bar offers. Detection can find others (3 spaces), which display as found. */
export const INDENT_SIZES = [2, 4, 8];

/** Enough lines for any file's convention; a huge log stops here instead of walking it all. */
const SCAN_LINES = 10000;
const SCAN_CHARS = 2 * 1024 * 1024;

/** A step wider than this is alignment (arguments under an open paren), not an indent level. */
const MAX_STEP = 8;

/**
 * Files whose format requires tab indentation, whatever they contain now: Makefiles (recipe lines
 * must start with a tab; GNUmakefile, automake's Makefile.am / .in, *.mk and *.mak included) and
 * Go (gofmt). Other `Makefile.*` names are left to detection: `Makefile.js` is JavaScript.
 */
export function requiresTabs(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop().toLowerCase();
  return /^(?:gnu)?makefile(?:\.(?:am|in))?$/.test(base) || /\.(?:mk|mak|go)$/.test(base);
}

/**
 * The file's own indentation: `{ useTabs: true }`, `{ useTabs: false, size }` (size null when no
 * step could be measured), or null when the text has no say (nothing indented, or as many lines
 * indented with tabs as with spaces).
 *
 * Lines that don't speak for the convention are skipped: blank ones, one-space indents (a
 * comment's alignment, ` * ` continuations of a block comment above any code), and lines whose
 * text starts with `*` (block-comment bodies, wherever they sit). The width is the most common
 * INCREASE in leading spaces from one line to the next: going in is one level at a time, while
 * coming out of nested blocks can drop several at once.
 */
export function detectIndent(text) {
  if (typeof text !== 'string' || !text) return null;
  let tabLines = 0;
  let spaceLines = 0;
  const steps = new Map();
  /** Leading spaces of the last line that counted, or null after a tab-indented one. */
  let previous = 0;

  const limit = Math.min(text.length, SCAN_CHARS);
  let lineStart = 0;
  for (let n = 0; n < SCAN_LINES && lineStart < limit; n++) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    let textStart = lineStart;
    while (textStart < lineEnd && (text[textStart] === ' ' || text[textStart] === '\t')) textStart++;
    const indented = textStart > lineStart;
    const firstChar = text[lineStart];
    const blank = textStart >= lineEnd || text[textStart] === '\r';
    const commentBody = text[textStart] === '*';
    let spaces = 0;
    while (text[lineStart + spaces] === ' ') spaces++;
    lineStart = lineEnd + 1;

    if (blank) continue;
    if (!indented) {
      previous = 0;
      continue;
    }
    if (commentBody) continue;
    if (firstChar === '\t') {
      tabLines++;
      previous = null;
      continue;
    }
    // Indented with spaces (a tab later in the run doesn't make it a tab-indented line).
    if (spaces === 1) continue;
    spaceLines++;
    if (previous !== null && spaces > previous && spaces - previous <= MAX_STEP) {
      const step = spaces - previous;
      steps.set(step, (steps.get(step) || 0) + 1);
    }
    previous = spaces;
  }

  if (tabLines === spaceLines) return null;
  if (tabLines > spaceLines) return { useTabs: true };
  return { useTabs: false, size: commonStep(steps) };
}

/**
 * The step seen most often, or null when none was. A tie goes to the smaller step (two levels at
 * once look like one wider one), and a one-space step only counts when nothing else turned up:
 * it is alignment far more often than a convention.
 */
function commonStep(steps) {
  let best = null;
  let bestCount = 0;
  for (const [step, count] of steps) {
    if (step === 1) continue;
    if (count > bestCount || (count === bestCount && step < best)) {
      best = step;
      bestCount = count;
    }
  }
  if (best === null && steps.has(1)) return 1;
  return best;
}

/** A document's indentation as it opens: the file type's requirement, else the file's own, else null. */
export function indentForDocument(fileName, text) {
  if (requiresTabs(fileName)) return { useTabs: true };
  return detectIndent(text);
}

/**
 * What the editor uses: the document's indentation completed from the user's "Indent size"
 * (`settingSize`), which gives the width of tabs and of spaces nobody measured.
 */
export function effectiveIndent(docIndent, settingSize) {
  const valid = (n) => Number.isInteger(n) && n >= 1 && n <= 16;
  const size = valid(docIndent?.size) ? docIndent.size : valid(settingSize) ? settingSize : 4;
  return { useTabs: !!docIndent?.useTabs, size };
}

/** One level of indentation as text: a tab, or `size` spaces (CodeMirror's indentUnit). */
export function indentUnitText(indent) {
  return indent?.useTabs ? '\t' : ' '.repeat(indent?.size || 4);
}

/** The status bar's label: "Spaces: 4" or "Tab size: 4". */
export function indentLabel(indent) {
  return indent?.useTabs ? `Tab size: ${indent.size}` : `Spaces: ${indent?.size}`;
}
