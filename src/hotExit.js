/**
 * hotExit.js: the renderer's half of hot exit (1.14.0).
 *
 * Every tab with unsaved changes is copied into the app's data folder (main's
 * `backups.write(id, data)`, one JSON file per tab) about a second after it changes, and the copy
 * is removed when the tab is saved, closed, discarded or becomes clean again. A session that ends
 * cleanly therefore leaves nothing behind; a crash, a kill or a power cut leaves exactly the
 * unsaved buffers, which the next launch puts back. Untitled buffers included: before this they
 * existed nowhere but in memory.
 *
 * This module holds the pure parts (ids, payloads, restore planning; covered by `node --test`)
 * plus the crash-flush hook the root error boundary calls. The timing and the IPC live in App.jsx.
 */

/** Main validates ids against exactly this. */
export const BACKUP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A fresh backup id for a tab: stable for the tab's life, unique across sessions. */
export function newBackupId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The payload for backups.write (the contract in electron/preload.cjs):
 * { kind, name, path, content, format, savedContent, untitled, editMode? }.
 */
export function backupPayload(doc, content, savedContent) {
  const data = {
    kind: doc.kind === 'markdown' ? 'markdown' : 'code',
    name: doc.name,
    path: doc.path || null,
    content,
    format: doc.format || null,
    savedContent: typeof savedContent === 'string' ? savedContent : null,
    untitled: !doc.path
  };
  if (doc.kind === 'markdown') data.editMode = !!doc.editMode;
  return data;
}

/** A listed backup FATE can actually restore. */
export function isRestorable(b) {
  return !!b && typeof b.id === 'string' && BACKUP_ID_RE.test(b.id) && typeof b.content === 'string';
}

/**
 * Sort a `backups.list()` result into what to do with it.
 *   byPath:   Map pathKey → backup, the newest per file (applied once that file's tab opens)
 *   untitled: backups without a path, oldest first (they become Untitled tabs in their old order)
 *   drop:     ids to delete: unreadable entries, and older copies of a file that has a newer one
 */
export function planRestore(list, keyOf) {
  const byPath = new Map();
  const untitled = [];
  const drop = [];
  const entries = Array.isArray(list) ? list : [];
  const newestFirst = [...entries].sort((a, b) => (Number(b?.savedAt) || 0) - (Number(a?.savedAt) || 0));
  for (const b of newestFirst) {
    if (!isRestorable(b)) {
      if (b && typeof b.id === 'string' && BACKUP_ID_RE.test(b.id)) drop.push(b.id);
      continue;
    }
    if (b.path) {
      const key = keyOf(b.path);
      if (byPath.has(key)) drop.push(b.id);
      else byPath.set(key, b);
    } else {
      untitled.push(b);
    }
  }
  untitled.reverse();
  return { byPath, untitled, drop };
}

/** The N of an "Untitled-N" name, or 0. Restored Untitled tabs push the counter past theirs. */
export function untitledNumber(name) {
  const m = /^Untitled-(\d+)$/.exec(name || '');
  return m ? Number(m[1]) : 0;
}

/** Shallow identity comparison of two backup signatures (arrays of the things a backup holds). */
export function sameSignature(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/*
 * ── Crash flush ──────────────────────────────────────────────────────────────────────────────
 * The root error boundary (main.jsx) cannot see App's buffers. App registers a function here that
 * writes every dirty tab's backup at once, and the boundary calls it as it catches an error, so
 * the recovery screen's Reload loses nothing typed since the last periodic write. Resolves true
 * when every write landed.
 */
let crashFlusher = null;

export function setCrashFlusher(fn) {
  crashFlusher = typeof fn === 'function' ? fn : null;
}

export function flushForCrash() {
  if (!crashFlusher) return Promise.resolve(false);
  try {
    return Promise.resolve(crashFlusher()).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}
