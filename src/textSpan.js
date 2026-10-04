/**
 * textSpan.js: the smallest single edit that turns one text into another.
 *
 * Reloading a file from disk used to replace the WHOLE document, so every reload put the caret
 * on line 1, dropped the folds, and made following a growing log impossible. A change limited to
 * the span that actually differs (common prefix and suffix left alone) lets CodeMirror map the
 * selection and folds through it like any other edit. An appended log line is an insertion at
 * the end; everything above it stays put.
 *
 * Positions are UTF-16 offsets, like CodeMirror's. A boundary never splits a surrogate pair, so
 * an emoji that changed is replaced whole rather than half of it.
 */

const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;

/**
 * `null` when the texts are identical; otherwise `{ from, to, insert }`, replacing
 * `oldText.slice(from, to)` with `insert`.
 */
export function changedSpan(oldText, newText) {
  if (oldText === newText) return null;
  const oldLen = oldText.length;
  const newLen = newText.length;
  const max = Math.min(oldLen, newLen);

  let start = 0;
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  // Don't end the shared prefix between the halves of a surrogate pair.
  if (start > 0 && isHigh(oldText.charCodeAt(start - 1))) start--;

  let oldEnd = oldLen;
  let newEnd = newLen;
  while (oldEnd > start && newEnd > start && oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  // Nor start the shared suffix on the low half of one: take that half into the change too.
  if (oldEnd < oldLen && isLow(oldText.charCodeAt(oldEnd))) {
    oldEnd++;
    newEnd++;
  }

  return { from: start, to: oldEnd, insert: newText.slice(start, newEnd) };
}

/** Apply a span from changedSpan to `text` (tests, and anything that needs the result as a string). */
export function applySpan(text, span) {
  if (!span) return text;
  return text.slice(0, span.from) + span.insert + text.slice(span.to);
}
