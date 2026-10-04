'use strict';
/**
 * fileFormat.cjs: how a text file is stored on disk, and the conversions in and out of it.
 *
 * The renderer only ever holds clean text: decoded, no byte-order mark, `\n` line breaks.
 * Everything else about the bytes on disk is the file's FORMAT,
 *
 *     { encoding: 'utf8' | 'utf16le' | 'utf16be' | 'windows1252', bom: boolean, eol: '\n' | '\r\n' | '\r' }
 *
 * which `decode` reports on open and `encode` applies on save, so a file goes back to disk the
 * way it came off it. Up to 1.13.4 FATE read every file as UTF-8 and wrote `\n`-joined UTF-8
 * back: one edit to a CRLF .bat or .ps1 rewrote every line ending (git showed the whole file
 * changed), Windows-1252 text came back with é turned into U+FFFD for good, and UTF-16 (what
 * PowerShell 5.1's `>` and Out-File write) was refused as binary because of its NUL bytes.
 *
 * The rule throughout is that a round trip never changes a byte FATE did not have to change:
 *   - Detection never picks a lossy decoding. Bytes that are not valid UTF-8 are read as
 *     Windows-1252, which maps every byte to its own character, rather than as UTF-8 with
 *     replacement characters that would be written back as U+FFFD.
 *   - UTF-16 is decoded code unit for code unit (Buffer's utf16le), so even unpaired surrogates,
 *     which Windows allows in file and registry text, survive.
 *   - Windows-1252 refuses to save text it cannot represent (UNENCODABLE) instead of writing '?'.
 *
 * Pure functions, free of Electron and fs on purpose: they run under plain node for the tests in
 * test/fileFormat.test.cjs.
 */

const ENCODINGS = ['utf8', 'utf16le', 'utf16be', 'windows1252'];
const EOLS = ['\n', '\r\n', '\r'];

/** Names for messages and status bars. */
const ENCODING_LABELS = {
  utf8: 'UTF-8',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  windows1252: 'Windows-1252'
};

/** Byte-order marks, longest first is irrelevant here: no BOM is a prefix of another. */
const BOMS = [
  { encoding: 'utf8', bytes: Buffer.from([0xef, 0xbb, 0xbf]) },
  { encoding: 'utf16le', bytes: Buffer.from([0xff, 0xfe]) },
  { encoding: 'utf16be', bytes: Buffer.from([0xfe, 0xff]) }
];

/**
 * How much of a file the binary and UTF-16 sniffs look at. 8 KB is the same window the binary
 * sniff has always used: enough to see an executable's or image's header, cheap on a 25 MB file.
 */
const SNIFF_BYTES = 8192;

/**
 * The format for a file FATE has never read: a new file from Save As, or a path main has no
 * record of. UTF-8 without a BOM everywhere; line breaks follow the platform, because a new file
 * on Windows is expected to be CRLF (Notepad, PowerShell and cmd all assume it).
 */
function defaultFormat(platform = process.platform) {
  return { encoding: 'utf8', bom: false, eol: platformEol(platform) };
}

function platformEol(platform = process.platform) {
  return platform === 'win32' ? '\r\n' : '\n';
}

/** An Error carrying a machine-readable `code`, so callers can choose the message. */
function codedError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  return Object.assign(err, extra);
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw codedError('BAD_ARGS', 'Expected the file contents as bytes');
}

/** The BOM at the start of `buf`, as { encoding, length }, or null. */
function sniffBom(buf) {
  for (const { encoding, bytes } of BOMS) {
    if (buf.length >= bytes.length && buf.subarray(0, bytes.length).equals(bytes)) {
      return { encoding, length: bytes.length };
    }
  }
  return null;
}

/** C0 controls a text file has no business containing: everything below 0x20 except tab, LF,
 *  VT, FF, CR and ESC (terminal colour codes in logs). */
function isStrayControl(byte) {
  return byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0b && byte !== 0x0c && byte !== 0x0d && byte !== 0x1b;
}

/**
 * UTF-16 without a BOM, recognised by where its NUL bytes fall. Text that is mostly ASCII or
 * Latin-1 has a zero high byte in most code units: the odd bytes for little-endian, the even
 * bytes for big-endian, while the other half is almost never zero.
 *
 * Deliberately conservative; a miss just leaves the file to the binary sniff, as before 1.14.0.
 * Every one of these must hold, over the first 8 KB:
 *   - the file length is even (UTF-16 is two bytes per unit);
 *   - no code unit is 0x0000: no text contains NUL, and binary formats are full of it;
 *   - at least half the units have a zero byte on one side, and under 5% on the other;
 *   - at most 1% of the ASCII-range units are stray control characters, which rules out arrays
 *     of small 16-bit integers (zero high bytes, but low bytes like 0x01 and 0x05).
 * So text in non-Latin scripts without a BOM (Cyrillic, CJK) is not detected; Windows tools write
 * a BOM for those, and the BOM path handles them.
 *
 * Returns 'utf16le', 'utf16be' or null.
 */
function sniffUtf16(buf) {
  if (buf.length < 2 || buf.length % 2 !== 0) return null;
  const end = Math.min(buf.length, SNIFF_BYTES);
  const units = end >> 1;
  let evenNul = 0;
  let oddNul = 0;
  let leControls = 0;
  let beControls = 0;
  for (let i = 0; i < end; i += 2) {
    const even = buf[i];
    const odd = buf[i + 1];
    if (even === 0 && odd === 0) return null;
    if (even === 0) {
      evenNul++;
      if (isStrayControl(odd)) beControls++;
    } else if (odd === 0) {
      oddNul++;
      if (isStrayControl(even)) leControls++;
    }
  }
  if (oddNul * 2 >= units && evenNul * 20 < units && leControls * 100 <= units) return 'utf16le';
  if (evenNul * 2 >= units && oddNul * 20 < units && beControls * 100 <= units) return 'utf16be';
  return null;
}

/**
 * Cheap binary sniff, per encoding. For the 8-bit encodings it is the check FATE always made: a
 * NUL byte in the first 8 KB. Text never contains NUL; executables, images and archives contain
 * it almost immediately. UTF-16 text is FULL of NUL bytes (every ASCII character has one), so for
 * UTF-16 the same idea moves up a level: a NUL code unit, two zero bytes on a unit boundary.
 *
 * Must run AFTER UTF-16 detection; with the 8-bit rule applied first, every UTF-16 file was
 * refused as binary up to 1.13.4. A guard against "Open with FATE" on the wrong file, not a
 * general-purpose detector.
 */
function isProbablyBinary(input, encoding = 'utf8') {
  const buf = toBuffer(input);
  const head = buf.subarray(0, SNIFF_BYTES);
  if (encoding === 'utf16le' || encoding === 'utf16be') {
    for (let i = 0; i + 1 < head.length; i += 2) {
      if (head[i] === 0 && head[i + 1] === 0) return true;
    }
    return false;
  }
  return head.includes(0);
}

/*
 * Decoders are created once. `ignoreBOM: true` because the BOM is stripped by hand below, and a
 * SECOND U+FEFF after it is content that must survive the round trip.
 */
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
let cp1252Decoder = null;
function cp1252() {
  if (!cp1252Decoder) cp1252Decoder = new TextDecoder('windows-1252');
  return cp1252Decoder;
}

/**
 * UTF-16 through Buffer rather than TextDecoder: Buffer's utf16le maps each code unit straight
 * to a JS string unit and back, unpaired surrogates included, so decode → encode is exact.
 * TextDecoder would replace those with U+FFFD. An odd trailing byte (a truncated file) cannot be
 * a character; it becomes U+FFFD, the one lossy case, and only for a file already damaged.
 */
function decodeUtf16(body, bigEndian) {
  const evenLength = body.length - (body.length % 2);
  let units = body.subarray(0, evenLength);
  if (bigEndian) units = Buffer.from(units).swap16(); // swap a copy: swap16 works in place
  const text = units.toString('utf16le');
  return evenLength === body.length ? text : `${text}�`;
}

/**
 * Count line breaks and normalise them to `\n`. The format's eol is the most common style, so a
 * mixed file is written back consistently in its majority style. A file with no line break at
 * all takes `defaultEol`. Ties go to `defaultEol`, then CRLF, then LF.
 */
function normalizeEol(text, defaultEol) {
  if (text.indexOf('\r') === -1) {
    return { text, eol: text.indexOf('\n') === -1 ? defaultEol : '\n' };
  }
  let crlf = 0;
  let cr = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (c === 10) {
      lf++;
    }
  }
  const counts = { '\r\n': crlf, '\n': lf, '\r': cr };
  let eol = defaultEol;
  for (const candidate of [defaultEol, '\r\n', '\n', '\r']) {
    if (counts[candidate] > counts[eol]) eol = candidate;
  }
  return { text: text.replace(/\r\n?/g, '\n'), eol };
}

/** `\r\n` and lone `\r` become `\n`. What the renderer holds, and what comparisons use. */
function normalizeText(text) {
  return text.indexOf('\r') === -1 ? text : text.replace(/\r\n?/g, '\n');
}

/**
 * Decode a file's bytes.
 *
 * Without `forcedEncoding`: a BOM decides; else UTF-16 by its NUL pattern; else strict UTF-8;
 * else Windows-1252 (the Windows "ANSI" code page, which is what a non-UTF-8 text file on a
 * Western Windows machine almost always is). A file that starts with a UTF-8 BOM but is not
 * valid UTF-8 is read as Windows-1252 too, BOM bytes included as text (ï»¿): wrong-looking but
 * lossless, where UTF-8 with replacement characters would destroy the bad bytes on save.
 *
 * With `forcedEncoding` (Reopen with encoding): that encoding, and a BOM is only stripped when it
 * belongs to it. A forced decoding that could not be saved back unchanged is refused rather than
 * opened lossy: UTF-8 over invalid bytes, UTF-16 over an odd number of bytes (INVALID).
 *
 * Throws coded errors: BINARY (looks like a binary file in that encoding), INVALID, BAD_ENCODING.
 * Their messages are fragments ("it contains …") for the caller to put after the file name.
 *
 * @param {Buffer|Uint8Array} input
 * @param {string|null} [forcedEncoding]
 * @param {{ defaultEol?: string, platform?: string }} [opts]  eol for files without line breaks
 * @returns {{ text: string, format: { encoding: string, bom: boolean, eol: string } }}
 */
function decode(input, forcedEncoding = null, opts = {}) {
  const buf = toBuffer(input);
  const defaultEol = EOLS.includes(opts.defaultEol) ? opts.defaultEol : platformEol(opts.platform);
  if (forcedEncoding != null && !ENCODINGS.includes(forcedEncoding)) {
    throw codedError('BAD_ENCODING', `Unknown encoding: ${forcedEncoding}`);
  }

  const bom = sniffBom(buf);
  let encoding;
  let bomLength = 0;
  if (forcedEncoding) {
    encoding = forcedEncoding;
    if (bom && bom.encoding === forcedEncoding) bomLength = bom.length;
  } else if (bom) {
    encoding = bom.encoding;
    bomLength = bom.length;
  } else {
    encoding = sniffUtf16(buf) || 'utf8';
  }

  if (isProbablyBinary(buf, encoding)) {
    throw codedError('BINARY', `it doesn't look like ${ENCODING_LABELS[encoding]} text`);
  }

  const body = buf.subarray(bomLength);
  let text;
  if (encoding === 'utf8') {
    try {
      text = strictUtf8.decode(body);
    } catch {
      if (forcedEncoding) {
        throw codedError('INVALID', "it contains bytes that aren't valid UTF-8");
      }
      encoding = 'windows1252';
      bomLength = 0;
      text = cp1252().decode(buf);
    }
  } else if (encoding === 'utf16le' || encoding === 'utf16be') {
    if (forcedEncoding && body.length % 2 !== 0) {
      throw codedError('INVALID', "it has an odd number of bytes, so it can't be UTF-16");
    }
    text = decodeUtf16(body, encoding === 'utf16be');
  } else {
    text = cp1252().decode(body);
  }

  const normalized = normalizeEol(text, defaultEol);
  return { text: normalized.text, format: { encoding, bom: bomLength > 0, eol: normalized.eol } };
}

/*
 * Windows-1252 reverse table, built from the platform's own decoder over all 256 bytes rather
 * than typed in. The WHATWG table maps the five bytes Microsoft left undefined (0x81, 0x8D, 0x8F,
 * 0x90, 0x9D) to the matching C1 controls, so every byte has a character and every one of those
 * 256 characters has exactly one byte: decode → encode is exact for any file. Int16 so -1 can
 * mark "no byte for this character". Built on first use (128 KB).
 */
let cp1252Reverse = null;
function cp1252Table() {
  if (!cp1252Reverse) {
    const chars = cp1252().decode(Uint8Array.from({ length: 256 }, (_, i) => i));
    cp1252Reverse = new Int16Array(65536).fill(-1);
    for (let byte = 0; byte < chars.length; byte++) cp1252Reverse[chars.charCodeAt(byte)] = byte;
  }
  return cp1252Reverse;
}

/** The first character Windows-1252 cannot hold, as a coded UNENCODABLE error, or null. */
function findUnencodable(text) {
  const table = cp1252Table();
  for (let i = 0; i < text.length; i++) {
    if (table[text.charCodeAt(i)] >= 0) continue;
    const codePoint = text.codePointAt(i);
    const char = String.fromCodePoint(codePoint);
    let line = 1;
    for (let j = text.indexOf('\n'); j !== -1 && j < i; j = text.indexOf('\n', j + 1)) line++;
    const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
    return codedError(
      'UNENCODABLE',
      `“${char}” (U+${hex}) on line ${line} can't be saved in Windows-1252. Save the file as UTF-8 instead.`,
      { char, codePoint, index: i, line }
    );
  }
  return null;
}

function encodeCp1252(text) {
  const table = cp1252Table();
  const out = Buffer.allocUnsafe(text.length);
  for (let i = 0; i < text.length; i++) out[i] = table[text.charCodeAt(i)];
  return out;
}

/**
 * A complete, valid format: `candidate`'s fields over `base`'s. Unknown keys are dropped (the
 * renderer may carry more per-tab state than main needs). Windows-1252 has no BOM, so `bom` is
 * forced off for it. Throws BAD_FORMAT for anything else that is wrong; a save in a format
 * nobody asked for is worse than a save that fails and says why.
 */
function resolveFormat(candidate, base) {
  if (candidate != null && (typeof candidate !== 'object' || Array.isArray(candidate))) {
    throw codedError('BAD_FORMAT', 'The file format to save in is not valid');
  }
  const fallback = base || defaultFormat();
  const pick = (key) => (candidate && candidate[key] !== undefined ? candidate[key] : fallback[key]);
  const format = { encoding: pick('encoding'), bom: pick('bom'), eol: pick('eol') };
  if (!ENCODINGS.includes(format.encoding)) {
    throw codedError('BAD_FORMAT', `Unknown encoding: ${String(format.encoding)}`);
  }
  if (typeof format.bom !== 'boolean') throw codedError('BAD_FORMAT', 'The byte-order mark setting is not valid');
  if (!EOLS.includes(format.eol)) throw codedError('BAD_FORMAT', 'The line-ending setting is not valid');
  if (format.encoding === 'windows1252') format.bom = false;
  return format;
}

function sameFormat(a, b) {
  return !!a && !!b && a.encoding === b.encoding && a.bom === b.bom && a.eol === b.eol;
}

/**
 * Encode renderer text for disk: `\n` → format.eol, then the encoding, then the BOM. Any `\r`
 * already in the text is normalised first, so stray CRs cannot turn into `\r\r\n`.
 * Throws UNENCODABLE (Windows-1252 only, naming the first offending character and its line) and
 * BAD_FORMAT.
 *
 * @returns {Buffer}
 */
function encode(text, format) {
  if (typeof text !== 'string') throw codedError('BAD_ARGS', 'Expected the document text as a string');
  const f = resolveFormat(format);
  const lf = normalizeText(text);
  if (f.encoding === 'windows1252') {
    const err = findUnencodable(lf);
    if (err) throw err;
  }
  const body = f.eol === '\n' ? lf : lf.replace(/\n/g, f.eol);

  let data;
  if (f.encoding === 'utf8') data = Buffer.from(body, 'utf8');
  else if (f.encoding === 'utf16le') data = Buffer.from(body, 'utf16le');
  else if (f.encoding === 'utf16be') data = Buffer.from(body, 'utf16le').swap16();
  else data = encodeCp1252(body);

  if (!f.bom) return data;
  const bom = BOMS.find((b) => b.encoding === f.encoding);
  return Buffer.concat([bom.bytes, data]);
}

module.exports = {
  ENCODINGS,
  EOLS,
  ENCODING_LABELS,
  defaultFormat,
  platformEol,
  decode,
  encode,
  resolveFormat,
  sameFormat,
  normalizeText,
  isProbablyBinary,
  sniffUtf16
};
