'use strict';
/**
 * launchArgs.cjs: which command-line arguments might name files to open, as absolute paths.
 *
 * A shape filter only: main.cjs's isOpenableArg then keeps the ones that are existing regular
 * files (and not FATE's own entry script), and openAndWatchFile decides whether each is text.
 *
 *  - Flags (`--ozone-platform=x11`, Chromium's own `--original-process-start-time=…`) are skipped.
 *    argv[0] is the executable.
 *  - Relative paths resolve against `cwd`. For a SECOND instance that must be the second
 *    process's working directory (the 'second-instance' event's `workingDirectory`): resolving
 *    against the running instance's folder opened the wrong file, or none.
 *  - `file:` URIs become paths. FATE's Linux desktop entries launch it with `%U`, and file
 *    managers may pass local files as `file:///home/me/notes.md`; those used to fail the stat in
 *    isOpenableArg and open nothing.
 *
 * Free of Electron imports; test/launchArgs.test.cjs covers Windows-style paths under plain node.
 */

const path = require('path');
const { fileURLToPath } = require('url');

function candidateFilePaths(argv, { cwd, platform = process.platform } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const paths = [];
  for (const arg of (Array.isArray(argv) ? argv : []).slice(1)) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-') || arg.includes('\0')) continue;
    let filePath = arg;
    if (/^file:/i.test(arg)) {
      try {
        filePath = fileURLToPath(arg, { windows: platform === 'win32' });
      } catch {
        continue; // a remote host on Linux, or not a valid file URL at all
      }
    }
    paths.push(cwd ? p.resolve(cwd, filePath) : p.resolve(filePath));
  }
  return paths;
}

module.exports = { candidateFilePaths };
