'use strict';
/**
 * fsAccess.cjs: turn a file-system error into words the user can act on.
 *
 * The cases worth naming are sandboxes. Under snap strict confinement "permission denied" almost
 * never means Unix permissions; it means one of two things FATE can state precisely:
 *
 *   • The path is on removable media (/media, /run/media, /mnt). snap/snapcraft.yaml declares
 *     the `removable-media` interface, but the Snap Store does not connect it on install unless
 *     it has granted this snap an auto-connection assertion. Until then the user has to run
 *     `sudo snap connect fate:removable-media` once; `snapctl is-connected` tells us which case
 *     we are in, so a connected system gets the plain message instead of bad advice.
 *   • The path is a hidden entry directly under the real home directory (~/.bashrc,
 *     ~/.config/…). The `home` interface never covers those and no connection changes it, so
 *     the honest advice is the .deb, .rpm or AppImage.
 *
 * Up to 1.13.2 both surfaced as nothing at all: the stat in isOpenableArg failed, the argument
 * was dropped, and `Open with → FATE` from a USB stick did not open anything.
 *
 * Free of Electron imports on purpose; it runs under plain node for tests.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const REMOVABLE_MEDIA_ROOTS = ['/media', '/run/media', '/mnt'];

/** The part of `filePath` below `root`, or null when it is not inside it. POSIX paths only. */
function relativeWithin(root, filePath) {
  const rel = path.posix.relative(root, filePath);
  if (!rel || rel.startsWith('..') || path.posix.isAbsolute(rel)) return null;
  return rel;
}

/** `snapctl is-connected <plug>` exits 0 when connected, 1 when not. Only meaningful inside a snap. */
function snapPlugConnected(plug) {
  try {
    execFileSync('snapctl', ['is-connected', plug], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {Error} err              the fs error (`.code` and `.message` are used)
 * @param {string} filePath        the path that failed
 * @param {'open'|'save'} action   what FATE was doing
 * @param {object} [deps]          `env` (default process.env) and `isConnected(plug)`, for tests
 * @returns {{ title: string, message: string, short: string }}
 *   `title` and `message` suit dialog.showErrorBox; `short` is a one-liner for the status bar.
 */
function describeFsError(err, filePath, action = 'open', deps = {}) {
  const env = deps.env || process.env;
  const isConnected = deps.isConnected || snapPlugConnected;
  const code = err && err.code;
  const detail = (err && err.message) || String(err);
  const name = path.basename(filePath);
  const verb = action === 'save' ? 'save' : 'open';
  const denied = code === 'EACCES' || code === 'EPERM';

  if (denied && env.SNAP) {
    const snapName = env.SNAP_NAME || 'fate';
    const posix = filePath.replace(/\\/g, '/');

    const onRemovableMedia = REMOVABLE_MEDIA_ROOTS.some((root) => relativeWithin(root, posix) !== null);
    if (onRemovableMedia && !isConnected('removable-media')) {
      const cmd = `sudo snap connect ${snapName}:removable-media`;
      return {
        title: 'Removable drive not connected',
        message:
          `${name} is on a removable drive, and this copy of FATE is a snap. Snaps cannot reach ` +
          `removable drives until you allow it, once, in a terminal:\n\n    ${cmd}\n\n` +
          `Then ${verb} the file again.`,
        short: `Snap cannot reach removable drives. Run: ${cmd}`
      };
    }

    if (env.SNAP_REAL_HOME) {
      const rel = relativeWithin(env.SNAP_REAL_HOME.replace(/\\/g, '/'), posix);
      if (rel && rel.split('/')[0].startsWith('.')) {
        return {
          title: 'Hidden file not accessible',
          message:
            `${name} is inside a hidden folder of your home directory (one whose name starts with ` +
            `a dot). Snap confinement does not let any snap read or write those, and no setting ` +
            `changes it.\n\nTo ${verb} files like this one, use FATE from the .deb, .rpm or AppImage instead.`,
          short: 'Snap confinement blocks hidden files in your home folder'
        };
      }
    }

    return {
      title: 'Permission denied',
      message:
        `FATE was not allowed to ${verb} ${name}.\n\n${detail}\n\nThis copy of FATE is a snap, ` +
        `which can reach your home directory (hidden files excepted) and connected removable drives only.`,
      short: `Permission denied: ${name}`
    };
  }

  if (denied) {
    return {
      title: 'Permission denied',
      message: `FATE was not allowed to ${verb} ${name}.\n\n${detail}`,
      short: `Permission denied: ${name}`
    };
  }

  return {
    title: action === 'save' ? 'Could not save file' : 'Could not open file',
    message: `${name} could not be ${action === 'save' ? 'saved' : 'opened'}.\n\n${detail}`,
    short: detail
  };
}

module.exports = { describeFsError, REMOVABLE_MEDIA_ROOTS };
