/**
 * fileKinds.js: which surface renders a file, and the curated extension lists.
 *
 * FATE opens ANY text file. Nothing gates on extension: not drag & drop, not the command line,
 * not "Edit in FATE". The only gates are size and a binary sniff, both in the main process
 * (openAndWatchFile in electron/main.cjs), with looksBinary() below covering the one renderer
 * path that reads bytes itself, a drop that arrives without a filesystem path. Up to 1.12.0 the
 * lists here doubled as an allow-list, so a `.config`, `.properties`, `.reg` or `.csv` was
 * refused with "not a markdown or code file" while the Open dialog would happily load it.
 *
 * The renderer owns the markdown-vs-code routing decision; the main process only reads bytes and
 * watches paths. CODE_EXTENSIONS here MIRRORS the list in electron/main.cjs (the curated dialog
 * filters) and the RegisterCodeType lines in build/installer.nsh (Windows registration). The
 * three must be edited together. It also drives the per-type font overrides (SettingsModal) and
 * the per-type document icons (scripts/generate-file-icons.mjs).
 */

/**
 * These render through the markdown pipeline. Everything else FATE opens goes to the code editor.
 *
 * `.txt` left this list in 1.14.0. Plain text is mostly logs, exports and notes that were never
 * written as Markdown: the pipeline reflowed them (single line breaks, `#` and `*` read as markup),
 * and a 10 MB log overflowed the parser's stack and blanked the window. A .txt that IS Markdown is
 * one "Render as Markdown" away (see couldBeMarkdown). electron/main.cjs keeps `txt` in its own
 * list: there it only drives the open dialog's filter and the Windows registration.
 */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown'];

/*
 * Size routing, in characters (UTF-16 units, close enough to bytes for the purpose).
 *
 * MARKDOWN_RENDER_LIMIT: a Markdown file larger than this opens in the editor as plain text, with
 * a notice offering "Render as Markdown". Rendering runs on the UI thread in one go (marked, KaTeX,
 * highlight.js and the sanitiser), so past a couple of megabytes the window freezes for seconds
 * before showing anything, and pathological input can exhaust the stack.
 *
 * LARGE_FILE_LIMIT: past this the code editor runs in large-file mode, without the extensions
 * whose cost grows with the document or the selection (syntax-error lint, bracket matching,
 * selection-match highlighting, autocompletion). Big logs open and scroll like small ones.
 */
export const MARKDOWN_RENDER_LIMIT = 2 * 1024 * 1024;
export const LARGE_FILE_LIMIT = 5 * 1024 * 1024;

/** The curated "Code files" filter, and the types FATE registers for on Windows. */
export const CODE_EXTENSIONS = [
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'jsonc',
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less',
  'ps1', 'psm1', 'psd1', 'py', 'pyw', 'rb', 'php', 'sql',
  'xml', 'xsl', 'svg', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'sh', 'bash', 'zsh', 'bat', 'cmd',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hxx', 'cs', 'java', 'go', 'rs',
  'swift', 'kt', 'kts', 'dart', 'lua', 'r', 'pl', 'pm', 'scala', 'groovy', 'gradle',
  'vue', 'svelte', 'tex', 'diff', 'patch', 'log', 'env',
  'proto', 'graphql', 'gql', 'vb', 'fs', 'fsx', 'erl', 'ex', 'exs', 'hs',
  'clj', 'cljs', 'edn', 'nim', 'zig', 'jl', 'asm'
];

/** Lower-cased extension without the dot, or '' for extensionless / dotfiles. */
export function extensionOf(name) {
  const base = (name || '').toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

/** 'markdown' or 'code': which surface renders this file. */
export function fileKindForName(name) {
  return MARKDOWN_EXTENSIONS.includes(extensionOf(name)) ? 'markdown' : 'code';
}

/** Which surface a file opens in, given its name AND its size (see MARKDOWN_RENDER_LIMIT). */
export function kindForOpen(name, length) {
  return fileKindForName(name) === 'markdown' && length <= MARKDOWN_RENDER_LIMIT ? 'markdown' : 'code';
}

/**
 * Could this code tab be Markdown, so "Render as Markdown" is worth offering? Markdown files that
 * opened as plain text for their size, `.txt`, and extensionless names (README, NOTES). Dotfiles
 * (.env, .gitignore) have no extension either, but they are configuration, never prose.
 */
export function couldBeMarkdown(name) {
  const base = (name || '').replace(/^.*[\\/]/, '');
  if (base.startsWith('.')) return false;
  const ext = extensionOf(base);
  return ext === '' || ext === 'txt' || MARKDOWN_EXTENSIONS.includes(ext);
}

/**
 * The renderer-side twin of the main process's binary sniff: a NUL in the first 8 K characters.
 * Text FATE can read (UTF-8, ASCII) never contains one; executables, images and archives do,
 * almost immediately. Only for content the renderer decoded itself, such as a path-less drop.
 */
export function looksBinary(text) {
  return typeof text === 'string' && text.slice(0, 8192).includes('\u0000');
}
