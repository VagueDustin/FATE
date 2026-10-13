'use strict';
/**
 * windowsRegistration.cjs: whether THIS launch should run the Windows registration self-heal
 * (ensureWindowsRegistration in main.cjs), which points the FATE.* ProgIds, the Markdown open
 * command and "Edit in FATE" at process.execPath under HKCU.
 *
 * Only an everyday launch of a real build does. Skipped for:
 *  - anything but Windows, and unpackaged runs (`electron .` would register node_modules'
 *    electron.exe);
 *  - the Microsoft Store package, whose manifest declares its associations;
 *  - an isolated profile: FATE_USER_DATA, or Chromium's --user-data-dir. That is how a test or
 *    side-by-side copy is run (CONTRIBUTING → Setup). Such a copy has its own empty settings,
 *    so the registration stamp never matches and it re-registered on every start: a packaged
 *    test build launched from a worktree took the installed copy's associations over, pointing
 *    them at the worktree's exe. The installed copy's own stamp still matched, so its next
 *    launch did not take them back.
 *
 * An isolated profile is the signal rather than the exe's location: FATE installs anywhere the
 * user picks (allowToChangeInstallationDirectory), and an everyday launch never sets either.
 *
 * Free of Electron imports; test/windowsRegistration.test.cjs covers it under plain node.
 */

/** True when argv carries Chromium's --user-data-dir switch, as `--user-data-dir=X` or `--user-data-dir X`. */
function hasUserDataDirSwitch(argv) {
  return (Array.isArray(argv) ? argv : []).some(
    (arg) => typeof arg === 'string' && /^--user-data-dir(=|$)/i.test(arg)
  );
}

/** True when this process runs on a profile of its own rather than the installed FATE's. */
function isIsolatedProfile({ env = {}, argv = [] } = {}) {
  return Boolean(env.FATE_USER_DATA) || hasUserDataDirSwitch(argv);
}

function shouldSelfRegister({ platform, isPackaged, isWindowsStore, env, argv } = {}) {
  if (platform !== 'win32' || !isPackaged || isWindowsStore) return false;
  return !isIsolatedProfile({ env, argv });
}

module.exports = { shouldSelfRegister, isIsolatedProfile };
