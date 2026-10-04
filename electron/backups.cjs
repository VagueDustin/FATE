'use strict';
/**
 * backups.cjs: hot exit. The renderer copies each unsaved buffer (Untitled ones included) here a
 * moment after it changes, so a crash, a forced reload or a power cut loses nothing; on the next
 * launch it lists what is left and offers it back.
 *
 * One file per tab: `<dir>/<id>.json`, written atomically (textFiles.writeFileAtomic), so a crash
 * DURING a backup leaves the previous backup rather than half a file. The folder is created
 * owner-only (0700) and the files 0600: a backup of ~/.ssh/config should not become readable by
 * other accounts just because FATE copied it.
 *
 * The renderer is trusted with its own documents but not with the file system, so:
 *   - `id` must match ID_PATTERN; it becomes a file name, and must never be able to say `../x`.
 *   - every field is type-checked, and sizes are capped (per string, per file, and in number of
 *     backups), so a runaway caller cannot fill the disk.
 *   - `list()` skips anything it cannot parse or that has the wrong shape instead of throwing:
 *     one corrupt file must never stop the rest from being restored.
 *
 * Main never deletes a backup on its own; only `remove(id)` (the tab was saved or closed) and
 * `clear()` (the session ended cleanly) do.
 *
 * Calls for the same id run in order (a per-id queue), so a `remove` that arrives while that
 * tab's `write` is still on its way to disk cannot be overtaken by it and resurrect the backup.
 *
 * Free of Electron imports; test/backups.test.cjs runs it under plain node.
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./textFiles.cjs');
const { resolveFormat } = require('./fileFormat.cjs');

const fsp = fs.promises;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_PATTERN = /^([A-Za-z0-9_-]{1,64})\.json$/;
const KINDS = ['markdown', 'code'];

/** Per text field (content, savedContent), in UTF-16 units. FATE opens files up to 25 MB. */
const MAX_TEXT_CHARS = 64 * 1024 * 1024;
/** A whole backup file, serialised. Also the most `list()` will read. */
const MAX_FILE_BYTES = 192 * 1024 * 1024;
/** Open tabs with unsaved work, at most. Far past any real session; a stop for a runaway loop. */
const MAX_BACKUPS = 100;

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function checkId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw codedError('BAD_ID', 'Backup ids are 1-64 letters, digits, _ or -');
}

/**
 * The renderer's data, checked and reduced to the known fields. Missing optional fields get
 * their empty value; a field of the wrong type is an error. An unusable `format` becomes null
 * rather than costing the user the backup.
 */
function cleanData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw codedError('BAD_DATA', 'Backup data must be an object');
  const bad = (field) => codedError('BAD_DATA', `Backup field "${field}" is missing or the wrong type`);
  const { kind, name, content } = data;
  const filePath = data.path ?? null;
  const savedContent = data.savedContent ?? null;
  const untitled = data.untitled ?? false;

  if (!KINDS.includes(kind)) throw bad('kind');
  if (typeof name !== 'string' || name.length > 1024) throw bad('name');
  if (filePath !== null && (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 32767)) throw bad('path');
  if (typeof content !== 'string') throw bad('content');
  if (savedContent !== null && typeof savedContent !== 'string') throw bad('savedContent');
  if (typeof untitled !== 'boolean') throw bad('untitled');
  if (data.editMode !== undefined && typeof data.editMode !== 'boolean') throw bad('editMode');
  if (content.length > MAX_TEXT_CHARS || (savedContent && savedContent.length > MAX_TEXT_CHARS)) {
    throw codedError('TOO_LARGE', 'This document is too large to back up');
  }

  let format = null;
  if (data.format != null) {
    try {
      format = resolveFormat(data.format, {});
    } catch {
      format = null;
    }
  }
  const clean = { kind, name, path: filePath, content, format, savedContent, untitled };
  if (data.editMode !== undefined) clean.editMode = data.editMode;
  return clean;
}

/**
 * @param {string} dir   the backups folder (main passes userData/backups)
 * @param {{ now?: () => number }} [opts]
 */
function createBackupStore(dir, { now = Date.now } = {}) {
  const queues = new Map();

  /** Run `job` after every earlier call for `id`; returns its promise. */
  function enqueue(id, job) {
    const previous = queues.get(id) || Promise.resolve();
    const run = previous.then(job, job);
    const settled = run.catch(() => {});
    queues.set(id, settled);
    settled.then(() => {
      if (queues.get(id) === settled) queues.delete(id);
    });
    return run;
  }

  const fileFor = (id) => path.join(dir, `${id}.json`);

  /** Store (or replace) the backup for `id`. Resolves { savedAt }. */
  async function write(id, data) {
    checkId(id);
    const clean = cleanData(data);
    return enqueue(id, async () => {
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      const names = await fsp.readdir(dir);
      if (!names.includes(`${id}.json`) && names.filter((n) => FILE_PATTERN.test(n)).length >= MAX_BACKUPS) {
        throw codedError('TOO_MANY', 'Too many unsaved documents to back up');
      }
      const savedAt = now();
      const json = JSON.stringify({ fate: 'backup', version: 1, savedAt, ...clean });
      const bytes = Buffer.from(json, 'utf8');
      if (bytes.length > MAX_FILE_BYTES) throw codedError('TOO_LARGE', 'This document is too large to back up');
      await writeFileAtomic(fileFor(id), bytes, { mode: 0o600 });
      return { savedAt };
    });
  }

  /** Delete the backup for `id`; a backup that isn't there is not an error. */
  async function remove(id) {
    checkId(id);
    return enqueue(id, async () => {
      try {
        await fsp.unlink(fileFor(id));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    });
  }

  /** Every readable backup: [{ id, savedAt, ...data }], oldest first. */
  async function list() {
    await Promise.all([...queues.values()]);
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const backups = [];
    for (const name of names) {
      const match = FILE_PATTERN.exec(name);
      if (!match) continue; // temporary files from an interrupted write, or strangers
      try {
        const file = path.join(dir, name);
        const stat = await fsp.stat(file);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
        const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
        if (!parsed || parsed.fate !== 'backup') continue;
        const savedAt = Number.isFinite(parsed.savedAt) ? parsed.savedAt : stat.mtimeMs;
        backups.push({ id: match[1], savedAt, ...cleanData(parsed) });
      } catch {
        /* corrupt, half-written by a crash, or the wrong shape: skip it, restore the rest */
      }
    }
    return backups.sort((a, b) => a.savedAt - b.savedAt);
  }

  /** Delete every backup (and any temporary file left by an interrupted write). */
  async function clear() {
    await Promise.all([...queues.values()]);
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    await Promise.all(
      names.map(async (name) => {
        const file = path.join(dir, name);
        try {
          if ((await fsp.lstat(file)).isFile()) await fsp.unlink(file);
        } catch {
          /* gone already */
        }
      })
    );
  }

  return { dir, write, remove, list, clear };
}

module.exports = { createBackupStore, ID_PATTERN, MAX_BACKUPS };
