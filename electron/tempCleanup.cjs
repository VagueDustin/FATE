'use strict';
/**
 * tempCleanup.cjs: remove temp files a previous FATE run left behind.
 *
 * FATE writes three kinds of temp file and deletes each one itself when it is done: the print
 * preview's PDF (when the preview closes), the PowerShell scripts behind the Windows association
 * checks (when PowerShell exits), and the self-heal's .reg import (when reg.exe exits). A crash, a
 * kill or a power cut between the write and the delete leaves the file in the temp folder for good,
 * one per run. At launch, anything matching those names and older than a day goes.
 *
 * Only these exact name shapes, only regular files (never a symlink), and only old ones: the temp
 * folder is shared with every other program (and, on Linux, every user), and a preview another
 * FATE has open right now is younger than a day. Errors are ignored file by file: another user's
 * file, one Windows still has open, or one already gone are all fine to skip.
 *
 * Free of Electron imports; test/tempCleanup.test.cjs runs it against a scratch folder.
 */

const fs = require('fs');
const path = require('path');

const STALE_TEMP_FILE_PATTERNS = Object.freeze([
  /^FATE-preview-\d+\.pdf$/, // showPrintPreview in main.cjs
  /^fate-ps-\d+-\d+\.ps1$/, // runPowerShell in main.cjs
  /^fate-registration-\d+\.reg$/ // ensureWindowsRegistration in main.cjs
]);

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Resolves the names it removed. Never rejects. */
async function removeStaleTempFiles(dir, { now = Date.now(), maxAgeMs = STALE_AFTER_MS } = {}) {
  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of names) {
    if (!STALE_TEMP_FILE_PATTERNS.some((pattern) => pattern.test(name))) continue;
    const file = path.join(dir, name);
    try {
      const stat = await fs.promises.lstat(file);
      if (!stat.isFile() || now - stat.mtimeMs < maxAgeMs) continue;
      await fs.promises.unlink(file);
      removed.push(name);
    } catch {
      /* not ours to delete, still open, or already gone */
    }
  }
  return removed;
}

module.exports = { removeStaleTempFiles, STALE_TEMP_FILE_PATTERNS, STALE_AFTER_MS };
