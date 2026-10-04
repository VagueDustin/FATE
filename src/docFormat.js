/**
 * docFormat.js: the renderer's view of a file's on-disk FORMAT (1.14.0).
 *
 * The main process owns encoding and line endings: it decodes on open, hands the renderer clean
 * `\n` text without a byte-order mark, and re-encodes on save (see electron/preload.cjs). A tab
 * only carries the format object,
 *   { encoding: 'utf8' | 'utf16le' | 'utf16be' | 'windows1252', bom: boolean, eol: '\n' | '\r\n' | '\r' }
 * and passes it back with every save. This module is the labels and comparisons the status bar
 * needs, kept pure so `node --test` covers it.
 */

/** What a new Untitled buffer is written as: UTF-8 without a BOM, the platform's line break. */
export function defaultFormat(platform) {
  return { encoding: 'utf8', bom: false, eol: platform === 'win32' ? '\r\n' : '\n' };
}

/** Status-bar label for a line ending. */
export function eolLabel(eol) {
  if (eol === '\r\n') return 'CRLF';
  if (eol === '\r') return 'CR';
  return 'LF';
}

/**
 * The status bar's EOL click: CRLF ↔ LF. A classic-Mac CR file goes to LF, the line break every
 * current tool reads.
 */
export function toggledEol(eol) {
  return eol === '\n' ? '\r\n' : '\n';
}

/** Status-bar label for an encoding (+ BOM). */
export function encodingLabel(format) {
  if (!format) return '';
  switch (format.encoding) {
    case 'utf16le':
      return 'UTF-16 LE';
    case 'utf16be':
      return 'UTF-16 BE';
    case 'windows1252':
      return 'Windows-1252';
    default:
      return format.bom ? 'UTF-8 BOM' : 'UTF-8';
  }
}

/**
 * "Save with encoding…" choices. UTF-16 is written with its byte-order mark: that is what
 * Notepad and PowerShell write, and what lets other tools tell LE from BE without guessing.
 */
export const SAVE_ENCODINGS = [
  { key: 'utf8', label: 'UTF-8', encoding: 'utf8', bom: false },
  { key: 'utf8bom', label: 'UTF-8 BOM', encoding: 'utf8', bom: true },
  { key: 'utf16le', label: 'UTF-16 LE', encoding: 'utf16le', bom: true },
  { key: 'utf16be', label: 'UTF-16 BE', encoding: 'utf16be', bom: true },
  { key: 'windows1252', label: 'Windows-1252', encoding: 'windows1252', bom: false }
];

/** "Reopen with encoding…" choices: how to DECODE the bytes (a BOM is detected either way). */
export const REOPEN_ENCODINGS = [
  { key: 'utf8', label: 'UTF-8', encoding: 'utf8' },
  { key: 'utf16le', label: 'UTF-16 LE', encoding: 'utf16le' },
  { key: 'utf16be', label: 'UTF-16 BE', encoding: 'utf16be' },
  { key: 'windows1252', label: 'Windows-1252', encoding: 'windows1252' }
];

/** Is `choice` (a SAVE_ENCODINGS entry) the encoding `format` already has? */
export function isCurrentEncoding(format, choice) {
  return !!format && format.encoding === choice.encoding && !!format.bom === choice.bom;
}

/** Same on-disk format? Two missing formats are the same; one missing and one known are not. */
export function sameFormat(a, b) {
  if (!a || !b) return !a && !b;
  return a.encoding === b.encoding && !!a.bom === !!b.bom && a.eol === b.eol;
}

/**
 * Does saving this tab change how its file is stored, even with the text untouched? True after
 * an EOL or encoding switch, until it is saved or switched back. Untitled buffers have no stored
 * format to differ from.
 */
export function formatChanged(doc) {
  return !!(doc && doc.savedFormat && doc.format && !sameFormat(doc.format, doc.savedFormat));
}
