/**
 * fileKinds.js — which files FATE opens, and which surface renders them.
 *
 * The renderer owns the markdown-vs-code routing decision; the main process only reads bytes and
 * watches paths. CODE_EXTENSIONS here MIRRORS the list in electron/main.cjs (dialog filters, argv
 * handling) and the RegisterCodeType lines in build/installer.nsh (Windows registration) — the
 * three must be edited together.
 */

/** These render through the markdown pipeline. Everything else FATE opens goes to the code editor. */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'txt'];

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

/** Extensionless files that are obviously code (extension parsing yields nothing useful here). */
export const SPECIAL_CODE_BASENAMES = [
  'dockerfile', 'makefile', 'cmakelists.txt', '.gitignore', '.gitattributes',
  '.editorconfig', '.env', '.npmrc', '.prettierrc', '.eslintrc'
];

/** Lower-cased extension without the dot, or '' for extensionless / dotfiles. */
export function extensionOf(name) {
  const base = (name || '').toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

/** 'markdown' or 'code' — which surface renders this file. */
export function fileKindForName(name) {
  return MARKDOWN_EXTENSIONS.includes(extensionOf(name)) ? 'markdown' : 'code';
}

/** Whether a dropped file is something FATE knows how to display at all. */
export function isSupportedFileName(name) {
  const ext = extensionOf(name);
  return (
    MARKDOWN_EXTENSIONS.includes(ext) ||
    CODE_EXTENSIONS.includes(ext) ||
    SPECIAL_CODE_BASENAMES.includes((name || '').toLowerCase())
  );
}
