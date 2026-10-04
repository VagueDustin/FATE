'use strict';
/**
 * fileWatch.cjs: live reload for open files, one watcher per path.
 *
 * What fs.watch hands over is noisy and fragile, and up to 1.13.4 FATE took it at face value:
 *
 *   - BURSTS. An atomic save by another editor (write a temp file, rename it over the original)
 *     fires two or three events, and each one re-read the file and reloaded the tab. Events are
 *     now coalesced per path: a read happens once the path has been quiet for `debounceMs`, or
 *     `maxWaitMs` after the first event at the latest, so a file that is written continuously
 *     (a log) still updates instead of waiting for a pause that never comes.
 *
 *   - REPLACED FILES. On Linux the watch is bound to the file's inode, so once a rename puts a new
 *     file at the path the old watcher hears nothing more. After a 'rename' the watcher re-attaches
 *     to whatever is at the path now.
 *
 *   - DELETED FILES. If the file was missing when the rename timer fired (a branch switch, an
 *     editor that deletes before writing), the old code returned without re-arming: live reload
 *     was dead for that tab and the watcher leaked. Now the dead watcher is closed and the path is
 *     retried with backoff (`retryDelays`); if the file comes back it is watched and read again,
 *     and if it never does, `onDeleted` reports it once.
 *
 *   - ERRORS. A watcher can emit 'error' (Windows does when the folder goes away); with no
 *     listener that is an uncaught exception in the main process. It is now treated as a rename.
 *
 * The reads themselves belong to the caller (`read`, async), and so does what a read means
 * (`onRead`). This module guarantees that only the newest read is delivered: a read that was
 * overtaken by a newer one, or by a `hold`, is dropped.
 *
 * `hold(path)` is for FATE's own saves. While a save is writing, events for that path are parked
 * and any read already in flight is discarded (it may have caught the file mid-replace); when
 * the hold is released, one read runs. Without it, a reload that raced a save could hand the
 * renderer the pre-save text as an "external change".
 *
 * Free of Electron imports; test/fileWatch.test.cjs drives it against real files.
 */
const fs = require('fs');

const fsp = fs.promises;

const MISSING = new Set(['ENOENT', 'ENOTDIR']);

/**
 * @param {object} options
 * @param {(filePath: string) => Promise<any>} options.read   read the file (after a burst settles)
 * @param {(filePath: string, result: any) => void} options.onRead   the newest read's result
 * @param {(filePath: string) => void} [options.onDeleted]   gone, and stayed gone through every retry
 * @param {(filePath: string, err: Error) => void} [options.onError]   a read or watch failed for another reason
 * @param {(filePath: string) => string} [options.keyOf]   map key for a path (case folding on Windows)
 * @param {number} [options.debounceMs]
 * @param {number} [options.maxWaitMs]
 * @param {number[]} [options.retryDelays]
 */
function createFileWatcher(options) {
  const {
    read,
    onRead,
    onDeleted = () => {},
    onError = () => {},
    keyOf = (p) => p,
    debounceMs = 150,
    maxWaitMs = 1000,
    retryDelays = [100, 300, 1000, 2000, 5000]
  } = options;

  /** key → entry: { path, handle, timer, retryTimer, burstStart, renamed, attempt, holds, pending, seq, closed } */
  const entries = new Map();

  function closeHandle(entry) {
    const handle = entry.handle;
    entry.handle = null;
    if (!handle) return;
    try {
      handle.close();
    } catch {
      /* already dead */
    }
  }

  /** Attach a fresh watcher to whatever is at the path now. Returns null, or the error. */
  function arm(entry) {
    closeHandle(entry);
    let handle;
    try {
      handle = fs.watch(entry.path, (eventType) => {
        if (entry.handle === handle) onEvent(entry, eventType);
      });
    } catch (err) {
      return err;
    }
    handle.on('error', () => {
      if (entry.handle === handle) onEvent(entry, 'rename');
    });
    entry.handle = handle;
    entry.renamed = false;
    return null;
  }

  function onEvent(entry, eventType) {
    if (entry.closed) return;
    if (eventType === 'rename') entry.renamed = true;
    schedule(entry);
  }

  function schedule(entry) {
    if (entry.closed) return;
    if (entry.holds > 0) {
      entry.pending = true;
      return;
    }
    const now = Date.now();
    if (!entry.burstStart) entry.burstStart = now;
    clearTimeout(entry.timer);
    const wait = Math.max(0, Math.min(debounceMs, entry.burstStart + maxWaitMs - now));
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.burstStart = 0;
      settle(entry);
    }, wait);
  }

  /** A burst is over: decide what is at the path now. */
  async function settle(entry) {
    if (entry.closed) return;
    if (entry.holds > 0) {
      entry.pending = true;
      return;
    }
    let stat = null;
    try {
      stat = await fsp.stat(entry.path);
    } catch (err) {
      if (!MISSING.has(err.code)) {
        onError(entry.path, err);
        return;
      }
    }
    if (entry.closed) return;
    if (entry.holds > 0) {
      // A save began while we were looking; whatever we saw may already be stale.
      entry.pending = true;
      return;
    }
    if (!stat || !stat.isFile()) {
      lost(entry);
      return;
    }
    if (entry.renamed || !entry.handle) {
      const err = arm(entry);
      if (err && MISSING.has(err.code)) {
        lost(entry);
        return;
      }
      if (err) onError(entry.path, err);
    }
    readNow(entry);
  }

  /** The file is not at its path: drop the dead watcher and start looking for it again. */
  function lost(entry) {
    closeHandle(entry);
    entry.renamed = false;
    entry.attempt = 0;
    retry(entry);
  }

  function retry(entry) {
    clearTimeout(entry.retryTimer);
    if (entry.attempt >= retryDelays.length) {
      entry.retryTimer = null;
      onDeleted(entry.path);
      return;
    }
    entry.retryTimer = setTimeout(async () => {
      entry.retryTimer = null;
      if (entry.closed) return;
      if (entry.holds > 0) {
        // One of FATE's own saves is (re)creating it; the save re-arms the watcher itself.
        entry.pending = true;
        return;
      }
      let stat = null;
      try {
        stat = await fsp.stat(entry.path);
      } catch {
        /* still missing */
      }
      if (entry.closed || entry.retryTimer || entry.handle) return; // re-armed meanwhile
      if (entry.holds > 0) {
        entry.pending = true;
        return;
      }
      if (stat && stat.isFile()) {
        const err = arm(entry);
        if (!err || !MISSING.has(err.code)) {
          // Back. (If it can't be watched, e.g. the inotify watch limit, still show what's there.)
          if (err) onError(entry.path, err);
          entry.attempt = 0;
          readNow(entry);
          return;
        }
      }
      entry.attempt++;
      retry(entry);
    }, retryDelays[entry.attempt]);
  }

  async function readNow(entry) {
    if (entry.holds > 0) {
      entry.pending = true;
      return;
    }
    const seq = ++entry.seq;
    let result;
    try {
      result = await read(entry.path);
    } catch (err) {
      if (entry.closed || seq !== entry.seq) return;
      if (MISSING.has(err.code)) lost(entry);
      else onError(entry.path, err);
      return;
    }
    // Superseded by a newer read, by one of FATE's own saves, or by the tab closing.
    if (entry.closed || seq !== entry.seq) return;
    onRead(entry.path, result);
  }

  /**
   * Watch a path (no-op if it is already watched). `rearm` re-attaches even so: after FATE's
   * own atomic save the path holds a new file, which a Linux watcher on the old one won't see.
   * A path in the missing state is re-armed on any call.
   */
  function watch(filePath, { rearm = false } = {}) {
    const key = keyOf(filePath);
    let entry = entries.get(key);
    if (entry && entry.handle && !rearm) return;
    if (!entry) {
      entry = { path: filePath, handle: null, timer: null, retryTimer: null, burstStart: 0, renamed: false, attempt: 0, holds: 0, pending: false, seq: 0, closed: false };
      entries.set(key, entry);
    }
    clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
    entry.attempt = 0;
    const err = arm(entry);
    if (err) {
      if (MISSING.has(err.code)) lost(entry);
      else onError(filePath, err);
    }
  }

  function unwatch(filePath) {
    const key = keyOf(filePath);
    const entry = entries.get(key);
    if (!entry) return;
    entry.closed = true;
    clearTimeout(entry.timer);
    clearTimeout(entry.retryTimer);
    closeHandle(entry);
    entries.delete(key);
  }

  /** Park events for a path while FATE itself writes it. Returns the release function. */
  function hold(filePath) {
    const entry = entries.get(keyOf(filePath));
    if (!entry) return () => {};
    entry.holds++;
    entry.seq++; // a read already in flight may have seen the file mid-save: drop it
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.burstStart = 0;
      entry.pending = true;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.holds--;
      if (entry.holds === 0 && entry.pending && !entry.closed) {
        entry.pending = false;
        schedule(entry);
      }
    };
  }

  function isWatching(filePath) {
    const entry = entries.get(keyOf(filePath));
    return !!entry && !!entry.handle;
  }

  function closeAll() {
    for (const entry of [...entries.values()]) unwatch(entry.path);
  }

  return { watch, unwatch, hold, isWatching, closeAll };
}

module.exports = { createFileWatcher };
