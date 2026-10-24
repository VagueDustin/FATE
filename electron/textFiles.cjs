'use strict';
/**
 * textFiles.cjs: documents on disk, read and written without blocking the main thread.
 *
 * Up to 1.13.4 every open, live reload and save was a *Sync call on Electron's main thread, so a
 * file on a slow or disconnected network share froze the whole window for the network timeout.
 * Everything here is fs.promises.
 *
 * Saves are ATOMIC. The old writeFileSync truncated the file first and then wrote it, so a full
 * disk, a dropped network share or a crash part-way through left the user with a damaged file
 * and no way back. writeFileAtomic writes a temporary file beside the target, flushes it to
 * disk, and renames it over the original: at every instant the path holds either the old file or
 * the complete new one.
 *
 * Free of Electron imports on purpose; test/textFiles.test.cjs runs it under plain node.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { decode, textDigest, sameFormat } = require('./fileFormat.cjs');

const fsp = fs.promises;

/*
 * The JS realpath, not fs.promises.realpath (the native one). On Windows the native call turns a
 * mapped drive letter into its \\server\share path and has failed outright on some virtual drives;
 * this one walks the path with lstat/readlink and leaves drive letters alone.
 */
const realpath = promisify(fs.realpath);

/**
 * The largest file FATE opens. The ceiling is V8's, not FATE's: a JS string holds at most
 * buffer.constants.MAX_STRING_LENGTH (2^29 - 24, about 536 million) UTF-16 units, and the decoded
 * text of an N-byte file is at most N units in every encoding FATE reads, so a cap under that can
 * always be decoded (test/textFiles.test.cjs holds it there). Up to 1.15.0 this was 25 MB, which
 * refused real report exports and logs; measured on 1.15.0, a 160 MB file opens in under 2 s and
 * a 500 MB one in about 4, with typing and saving unaffected (the editor's large-file mode
 * starts at 5 MB, see src/fileKinds.js). IPC is not the limit: 300M characters cross in a second.
 */
const MAX_FILE_BYTES = 500 * 1024 * 1024;

function codedError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  return Object.assign(err, extra);
}

/**
 * Read and decode a text file: `{ text, format, bytes, stamp }` (see fileFormat.cjs for `format`;
 * `bytes` is the raw Buffer, for callers that need to compare it with an encoding of the text;
 * `stamp` is { size, mtimeMs }, a cheap "has it changed since?" check for later).
 *
 * Throws the fs error as is (ENOENT, EACCES, …) or a coded one: NOT_FILE (a folder, a device,
 * a pipe: anything readFile could hang on or that isn't a document), TOO_LARGE (with `size`),
 * and decode's BINARY / INVALID.
 *
 * @param {string} filePath
 * @param {{ maxBytes?: number, forcedEncoding?: string|null, defaultEol?: string }} [opts]
 */
async function readTextFile(filePath, { maxBytes = Infinity, forcedEncoding = null, defaultEol } = {}) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw codedError('NOT_FILE', `${path.basename(filePath)} is not a file`);
  if (stat.size > maxBytes) throw codedError('TOO_LARGE', `${path.basename(filePath)} is too large`, { size: stat.size });
  const buffer = await fsp.readFile(filePath);
  // It may have grown between the stat and the read (a log being written, say).
  if (buffer.length > maxBytes) throw codedError('TOO_LARGE', `${path.basename(filePath)} is too large`, { size: buffer.length });
  const { text, format } = decode(buffer, forcedEncoding, { defaultEol });
  return { text, format, bytes: buffer, stamp: { size: buffer.length, mtimeMs: stat.mtimeMs } };
}

/**
 * Errors that mean "this folder or this file will not take a rename", not "the disk is broken".
 * Windows refuses to replace a file another program holds open (EBUSY/EPERM) or one marked
 * read-only; a folder the user can write files in but not create files in gives EACCES for the
 * temporary file; a bind-mounted single file (Docker, Flatpak portals) or a FUSE mount without
 * rename support gives EBUSY, EXDEV or ENOTSUP. For all of those the in-place write FATE always
 * did is still worth trying. NOT on the list: ENOSPC and EDQUOT, a full disk, where an in-place
 * write would truncate the original and then fail half way, which is the very damage the
 * atomic path exists to prevent.
 */
const FALLBACK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EXDEV', 'ENOTSUP', 'ENOSYS']);

/**
 * Write `data` into an existing file, keeping the file itself: same inode, hard links, owner,
 * permissions and (on Windows) attributes, ACLs and alternate streams.
 *
 * 'r+' rather than 'w' on purpose: 'w' opens with CREATE_ALWAYS on Windows, which fails with
 * EPERM on a hidden or system file. The length is set after writing, so a write that dies part
 * way leaves the old tail rather than an empty file.
 */
async function writeInPlace(filePath, data) {
  let handle;
  try {
    handle = await fsp.open(filePath, 'r+');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    handle = await fsp.open(filePath, 'w'); // a dangling symlink: create the file it points at
  }
  try {
    await handle.writeFile(data);
    await handle.truncate(data.length);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Where a save should land and what is there now: symlinks resolved, so saving through a link
 * updates the file it points at and the link stays a link (renaming over the link itself would
 * replace it with a regular file).
 */
async function resolveTarget(filePath) {
  let real = filePath;
  try {
    real = await realpath(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      let link = null;
      try {
        link = await fsp.lstat(filePath);
      } catch {
        /* nothing there at all: a new file */
      }
      return { path: filePath, stat: null, danglingLink: !!link && link.isSymbolicLink() };
    }
    // Anything else is the resolver's problem, not the save's; write to the path as given.
  }
  const stat = await fsp.stat(real);
  if (!stat.isFile()) throw codedError('EISDIR', `${path.basename(filePath)} is not a file`);
  return { path: real, stat, danglingLink: false };
}

/**
 * Save `data` (a Buffer) to `filePath` atomically: temporary file in the same folder, fsync,
 * rename over the target. Same folder because a rename is only atomic within one file system.
 *
 * Kept from the original file: its permission bits and, when FATE can set it, its owner; on
 * Windows its mark of the web (the Zone.Identifier stream that makes PowerShell's RemoteSigned
 * policy refuse a downloaded script; losing it on save would quietly lift that protection).
 *
 * Falls back to an in-place write (see writeInPlace) instead when the atomic route would change
 * what the file IS or cannot work:
 *   - the file has other hard links (a rename would split this name off from them);
 *   - its owner cannot be carried over (a shared file in someone else's name would become ours);
 *   - the temporary file or the rename is refused (FALLBACK_CODES);
 *   - the path is a dangling symlink (writing through it creates the target, link intact).
 * The temporary file never outlives the call.
 *
 * @param {string} filePath
 * @param {Buffer} data
 * @param {{ mode?: number }} [opts]  permissions for a NEW file (default 0o666, less the umask)
 * @returns {Promise<{ path: string, method: 'atomic' | 'in-place' }>}
 */
async function writeFileAtomic(filePath, data, { mode = 0o666 } = {}) {
  const target = await resolveTarget(filePath);
  const inPlace = async () => {
    await writeInPlace(target.path, data);
    return { path: target.path, method: 'in-place' };
  };
  if (target.danglingLink) return inPlace();
  /*
   * A rename only needs permission on the FOLDER, so without this check a read-only file in a
   * writable folder would be silently replaced, where the old in-place write was refused. A file
   * marked read-only (or a git-annex locked one) must stay protected: refuse with EACCES/EPERM.
   */
  if (target.stat) await fsp.access(target.path, fs.constants.W_OK);
  if (target.stat && target.stat.nlink > 1) return inPlace();

  const dir = path.dirname(target.path);
  // Dot-prefixed so file managers and `ls` don't flash it up during the save.
  const tmp = path.join(dir, `.${path.basename(target.path)}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.fate-tmp`);
  const posix = process.platform !== 'win32';
  let handle = null;
  let tmpExists = false;
  try {
    try {
      handle = await fsp.open(tmp, 'wx', target.stat ? target.stat.mode & 0o777 : mode);
      tmpExists = true;
    } catch (err) {
      if (target.stat && FALLBACK_CODES.has(err.code)) return await inPlace();
      throw err;
    }
    // Before the write, so a refusal costs nothing.
    if (target.stat && posix && (target.stat.uid !== process.getuid() || target.stat.gid !== process.getgid())) {
      try {
        await handle.chown(target.stat.uid, target.stat.gid);
      } catch {
        return await inPlace();
      }
    }
    await handle.writeFile(data);
    await handle.sync();
    if (target.stat && posix) {
      // open()'s mode is filtered through the umask; set the original bits exactly (after the
      // chown, which clears set-id bits). A file system without Unix permissions (FAT, exFAT,
      // some network mounts) refuses, and that's fine.
      await handle.chmod(target.stat.mode & 0o7777).catch(() => {});
    }
    await handle.close();
    handle = null;

    if (target.stat && !posix) {
      try {
        const zone = await fsp.readFile(`${target.path}:Zone.Identifier`);
        await fsp.writeFile(`${tmp}:Zone.Identifier`, zone);
      } catch {
        /* no mark of the web, or a drive without alternate data streams */
      }
    }

    try {
      await fsp.rename(tmp, target.path);
      tmpExists = false;
    } catch (err) {
      if (target.stat && FALLBACK_CODES.has(err.code)) return await inPlace();
      throw err;
    }

    // Make the rename itself durable (the folder entry), where the platform allows it.
    if (posix) {
      try {
        const dirHandle = await fsp.open(dir, 'r');
        try {
          await dirHandle.sync();
        } finally {
          await dirHandle.close();
        }
      } catch {
        /* best effort */
      }
    }
    return { path: target.path, method: 'atomic' };
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (tmpExists) await fsp.unlink(tmp).catch(() => {});
  }
}

/**
 * Before a save: has the file moved on since FATE last read or wrote it? Up to 1.15.0 a save simply
 * wrote, and another program's edit that FATE had not shown yet was replaced without a word.
 *
 * `known` is what FATE last saw, { stamp, digest, format } (all optional: an empty `known` forces
 * a read). `savingDigest` is textDigest of the text about to be written. `read` reads the file the
 * way its tab does (main's readDocument); `formatOf` settles the format of what it read (main's
 * adoptFormat). Size and mtime come first, from an open handle rather than a path stat so a
 * network client revalidates attributes it may have cached; the text is read only when they moved.
 *
 * Resolves `{ verdict, stamp? }`, the stamp being the file's as it is now:
 *   'unchanged'   write (also when the disk already holds exactly the text being saved)
 *   'missing'     write: the save brings the file back
 *   'unknown'     write: it can't be checked (permissions), and the write reports any real error
 *   'changed'     don't write. Also { doc, format, digest } for showing the disk text
 *   'unreadable'  don't write: it changed but can't be shown (too large, binary). Also { error }
 */
async function diskChangeSince(filePath, { known = {}, savingDigest, read, formatOf = (doc) => doc.format }) {
  let stat;
  try {
    const handle = await fsp.open(filePath, 'r');
    try {
      stat = await handle.stat();
    } finally {
      await handle.close();
    }
  } catch (err) {
    return { verdict: err.code === 'ENOENT' ? 'missing' : 'unknown' };
  }
  const stamp = { size: stat.size, mtimeMs: stat.mtimeMs };
  if (known.stamp && stamp.size === known.stamp.size && stamp.mtimeMs === known.stamp.mtimeMs) {
    return { verdict: 'unchanged', stamp };
  }
  let doc;
  try {
    doc = await read(filePath);
  } catch (error) {
    if (error.code === 'TOO_LARGE' || error.code === 'BINARY') return { verdict: 'unreadable', error, stamp };
    return { verdict: 'unknown' };
  }
  const digest = textDigest(doc.text);
  const format = formatOf(doc);
  // Touched but not changed (a scan, a sync client), or already exactly what is being saved.
  if ((digest === known.digest && known.format && sameFormat(format, known.format)) || digest === savingDigest) {
    return { verdict: 'unchanged', stamp: doc.stamp };
  }
  return { verdict: 'changed', stamp: doc.stamp, doc, format, digest };
}

module.exports = { MAX_FILE_BYTES, readTextFile, writeFileAtomic, diskChangeSince };
