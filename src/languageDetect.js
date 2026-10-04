import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

/**
 * Resolve a CodeMirror language from a filename and, when the name says nothing, from the
 * content. Returns null for plain text.
 *
 * `languages` is the full @codemirror/language-data registry (~150 languages, PowerShell and the
 * other legacy modes included). Matching is by extension and by special filenames (Dockerfile,
 * Makefile, …); the actual language module is only loaded when `.load()` is called on the result.
 *
 * Since FATE opens any text file, plenty arrive with an extension the registry has never heard
 * of: `web.config` (XML), `.properties`, a `.reg` export, an extensionless script. sniffLanguage
 * covers the cases a glance at the first line settles: shebangs, XML/HTML prologues, JSON, INI
 * sections. Anything else stays plain text rather than guessing wrong; a wrong highlighter is
 * worse than none.
 *
 * Lives in its own module rather than CodeEditor.jsx because App.jsx also needs it (for the
 * status-bar language readout) and react-refresh requires component files to export only
 * components.
 */
export function detectLanguage(fileName, content) {
  const byName = fileName ? LanguageDescription.matchFilename(languages, fileName) : null;
  if (byName) return byName;
  // JSONC names the registry doesn't know (.jsonc, .eslintrc, .code-workspace) are JSON to look at.
  if (isJsonWithComments(fileName)) return byLanguageName('JSON');
  return sniffLanguage(content);
}

/** Exact (case-insensitive) lookup by the registry's own language name. */
const byLanguageName = (name) => LanguageDescription.matchLanguageName(languages, name, false);

/** Interpreter names a shebang line can carry → language-data names. Order matters: first hit wins. */
const SHEBANG_LANGUAGES = [
  [/\b(?:ba|z|da|k|a)?sh\b/, 'Shell'],
  [/\bpython[0-9.]*\b/, 'Python'],
  [/\b(?:node|deno|bun)\b/, 'JavaScript'],
  [/\bruby\b/, 'Ruby'],
  [/\bperl\b/, 'Perl'],
  [/\bphp\b/, 'PHP'],
  [/\b(?:pwsh|powershell)\b/, 'PowerShell'],
  [/\blua\b/, 'Lua']
];

/**
 * Guess a language from the first couple of kilobytes of content. Conservative on purpose; see
 * detectLanguage. Exported for tests and for the Save As re-detection in CodeEditor.
 */
export function sniffLanguage(content) {
  if (typeof content !== 'string' || !content) return null;
  const head = content.slice(0, 2048).replace(/^\uFEFF/, '');
  const trimmed = head.trimStart();
  const firstLine = trimmed.split(/\r?\n/, 1)[0];

  if (firstLine.startsWith('#!')) {
    for (const [re, name] of SHEBANG_LANGUAGES) {
      if (re.test(firstLine)) return byLanguageName(name);
    }
    return null;
  }

  // Registry exports: a fixed banner, then INI-shaped [HKEY_…] sections and "name"=value lines.
  if (/^Windows Registry Editor Version|^REGEDIT4/.test(trimmed)) return byLanguageName('Properties files');

  if (/^<\?xml\b/i.test(trimmed)) return byLanguageName('XML');
  if (/^<!doctype html\b|^<html\b/i.test(trimmed)) return byLanguageName('HTML');
  // Any other opening tag or comment: XML. Covers web.config, .csproj, .plist, .xaml, .resx, …
  if (/^<(?:!--|[a-z_][\w:.-]*(?:[\s/>]|$))/i.test(trimmed)) return byLanguageName('XML');

  // An INI section header on the first meaningful line, ahead of JSON, since both start with `[`.
  const firstMeaningful = trimmed.split(/\r?\n/).find((line) => line.trim() && !/^\s*[;#]/.test(line)) || '';
  if (/^\[[A-Za-z0-9 ._:\\/-]+\]\s*$/.test(firstMeaningful.trim())) return byLanguageName('Properties files');

  if (looksLikeJson(trimmed, content)) return byLanguageName('JSON');

  return null;
}

/** Files up to this size get a full JSON.parse when their first token doesn't settle it. */
const JSON_PARSE_LIMIT = 1024 * 1024;

/** Whitespace and JSONC comments, which may sit between JSON tokens. */
const GAP = String.raw`(?:\s|//[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*`;
const SCALAR = String.raw`(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)`;
const OBJECT_HEAD = new RegExp(String.raw`^\{${GAP}["}]`);
const ARRAY_HEAD = new RegExp(String.raw`^\[${GAP}(?:[[{"]|${SCALAR}${GAP}[,\]]|\]${GAP}$)`);

/**
 * Is this JSON? Up to 1.13 anything starting with `[` or `{` was, so a log whose lines start
 * `[2026-10-04 12:00:01] INFO` or `[INFO]` opened as JSON and syntax checking underlined hundreds
 * of "errors". Now the first token after the bracket has to be one JSON allows there (comments
 * may come first, for JSONC):
 *
 *   `[` then  `{`  `[`  `"`, a number / true / false / null followed by `,` or `]`, or `]` that
 *            ends the file
 *   `{` then  `"`  `}`
 *
 * A number has to be followed by `,` or `]` because a timestamp starts with digits too
 * (`[2026-10-04` is the number 2026 followed by `-`), and an empty array has to be the whole file
 * because `[ ] task` is a checklist. When the head doesn't settle it, a file under 1 MB that
 * parses as a whole still counts. `head` is the trimmed start of the file.
 */
export function looksLikeJson(head, content = head) {
  if (typeof head !== 'string') return false;
  if (head[0] === '{') return OBJECT_HEAD.test(head) || parsesAsJson(content);
  if (head[0] === '[') return ARRAY_HEAD.test(head) || parsesAsJson(content);
  return false;
}

function parsesAsJson(content) {
  if (typeof content !== 'string' || content.length > JSON_PARSE_LIMIT) return false;
  try {
    JSON.parse(content.replace(/^\uFEFF/, ''));
    return true;
  } catch {
    return false;
  }
}

/** Exact basenames of JSON files whose tools accept comments (lower-cased). */
const JSONC_NAMES = new Set([
  '.eslintrc', '.eslintrc.json',
  // VS Code's own files: .vscode/settings.json, keybindings.json, launch.json, tasks.json.
  'settings.json', 'keybindings.json', 'launch.json', 'tasks.json',
  'devcontainer.json', '.devcontainer.json'
]);

/**
 * Is this a JSON-with-comments file (JSONC)? Comments and trailing commas there are allowed by
 * the tool that reads the file, so a syntax checker must not flag them as JSON errors: `.jsonc`,
 * tsconfig*.json and jsconfig*.json (TypeScript reads them as JSONC), .eslintrc(.json), VS Code's
 * settings/keybindings/launch/tasks.json and .code-workspace files, and devcontainer.json.
 * Takes a bare name or a full path.
 */
export function isJsonWithComments(fileName) {
  if (typeof fileName !== 'string' || !fileName) return false;
  const base = fileName.split(/[\\/]/).pop().toLowerCase();
  if (base.endsWith('.jsonc') || base.endsWith('.code-workspace')) return true;
  if (/^(?:ts|js)config.*\.json$/.test(base)) return true;
  return JSONC_NAMES.has(base);
}
