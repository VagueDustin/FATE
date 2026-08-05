import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

/**
 * Resolve a CodeMirror language from a filename, or null for plain text.
 *
 * `languages` is the full @codemirror/language-data registry (~150 languages, PowerShell and the
 * other legacy modes included). Matching is by extension and by special filenames (Dockerfile,
 * Makefile, …); the actual language module is only loaded when `.load()` is called on the result.
 *
 * Lives in its own module rather than CodeEditor.jsx because App.jsx also needs it (for the
 * status-bar language readout) and react-refresh requires component files to export only
 * components.
 */
export function detectLanguage(fileName) {
  if (!fileName) return null;
  return LanguageDescription.matchFilename(languages, fileName);
}
