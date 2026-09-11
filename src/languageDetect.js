import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

/**
 * Resolve a CodeMirror language from a filename — and, when the name says nothing, from the
 * content. Returns null for plain text.
 *
 * `languages` is the full @codemirror/language-data registry (~150 languages, PowerShell and the
 * other legacy modes included). Matching is by extension and by special filenames (Dockerfile,
 * Makefile, …); the actual language module is only loaded when `.load()` is called on the result.
 *
 * Since FATE opens any text file, plenty arrive with an extension the registry has never heard
 * of — `web.config` (XML), `.properties`, a `.reg` export, an extensionless script. sniffLanguage
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
 * Guess a language from the first couple of kilobytes of content. Conservative on purpose — see
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

  // An INI section header on the first meaningful line — ahead of JSON, since both start with `[`.
  const firstMeaningful = trimmed.split(/\r?\n/).find((line) => line.trim() && !/^\s*[;#]/.test(line)) || '';
  if (/^\[[A-Za-z0-9 ._:\\/-]+\]\s*$/.test(firstMeaningful.trim())) return byLanguageName('Properties files');

  if (/^[{[]/.test(trimmed)) return byLanguageName('JSON');

  return null;
}
