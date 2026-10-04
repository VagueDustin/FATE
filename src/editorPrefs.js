import { createContext } from 'react';

/**
 * editorPrefs.js: per-pane editor preferences that reach a CodeEditor through context (1.14.0).
 *
 *   spellcheck  mark misspelled words. App turns it on only around a Markdown tab's Edit mode,
 *               and only while the `spellcheck` setting is on: code is full of words no
 *               dictionary knows, and underlining every identifier helps nobody.
 *   indent      the document's indentation, { useTabs, size } (see indentDetect.js), or null for
 *               the editor's own `tabSize` in spaces.
 *
 * Context rather than props because the Markdown editor sits inside MarkdownEditView, which App
 * doesn't render the CodeEditor of; App wraps each pane in a provider with that pane's values, and
 * a CodeEditor with no provider above it gets the defaults (no spellcheck, `tabSize` spaces).
 * A plain module, not a component file: react-refresh wants those to export components only.
 */
export const EditorPrefsContext = createContext({ spellcheck: false, indent: null });
