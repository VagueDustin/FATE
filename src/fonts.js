/**
 * fonts.js — the bundled typeface registry and the font-settings plumbing.
 *
 * ── Fully offline, like everything else ───────────────────────────────────────────────────────
 * Every face here ships inside the app via @fontsource (latin subset, only the weights used —
 * same discipline as the Cinzel/Inter imports in main.jsx). No webfont CDN, ever; PRIVACY.md
 * promises zero network requests.
 *
 * ── How font choices are applied ──────────────────────────────────────────────────────────────
 * Selections write CSS custom properties onto <html> (applyFonts below):
 *
 *   --font-sans          interface font (chrome, home screen, settings)
 *   --font-doc           markdown document body — .markdown-body reads var(--font-doc, --font-sans)
 *   --font-mono          default code font (editor, md code blocks, mono status readouts)
 *   --doc-font-size      markdown body size
 *   --editor-font-size   editor size
 *   --editor-liga        'normal' | 'none' → font-variant-ligatures on the editor
 *
 * Per-file-type overrides don't go through globals: App.jsx resolves the tab's font with
 * editorFontFor() and sets `--editor-font` on that tab's pane, which .cm-scroller reads as
 * var(--editor-font, var(--font-mono)). A tab of .ps1 in Cascadia and a tab of .py in Fira Code
 * can sit side by side.
 *
 * Cinzel (--font-display) is deliberately NOT user-configurable — it is the brand's display face.
 */

// Prose / interface faces
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/source-serif-4/latin-400.css';
import '@fontsource/source-serif-4/latin-600.css';
import '@fontsource/source-serif-4/latin-700.css';
import '@fontsource/source-serif-4/latin-400-italic.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-600.css';
import '@fontsource/lora/latin-700.css';
import '@fontsource/lora/latin-400-italic.css';
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/merriweather/latin-700.css';
import '@fontsource/merriweather/latin-400-italic.css';

// Code faces (regular + bold + italic — the editor renders comments in italic)
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400-italic.css';
import '@fontsource/fira-code/latin-400.css';
import '@fontsource/fira-code/latin-700.css';
import '@fontsource/cascadia-code/latin-400.css';
import '@fontsource/cascadia-code/latin-700.css';
import '@fontsource/cascadia-code/latin-400-italic.css';
import '@fontsource/source-code-pro/latin-400.css';
import '@fontsource/source-code-pro/latin-700.css';
import '@fontsource/source-code-pro/latin-400-italic.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400-italic.css';
import '@fontsource/roboto-mono/latin-400.css';
import '@fontsource/roboto-mono/latin-700.css';
import '@fontsource/roboto-mono/latin-400-italic.css';

const SYSTEM_SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const SYSTEM_MONO = "ui-monospace, 'Cascadia Code', SFMono-Regular, Consolas, monospace";

/** Interface / document faces. `sample` is the preview line the picker renders in the face. */
export const PROSE_FONTS = [
  { id: 'inter', label: 'Inter', kind: 'sans', stack: `'Inter', ${SYSTEM_SANS}` },
  { id: 'ibm-plex-sans', label: 'IBM Plex Sans', kind: 'sans', stack: `'IBM Plex Sans', ${SYSTEM_SANS}` },
  { id: 'source-serif', label: 'Source Serif 4', kind: 'serif', stack: `'Source Serif 4', Georgia, serif` },
  { id: 'lora', label: 'Lora', kind: 'serif', stack: `'Lora', Georgia, serif` },
  { id: 'merriweather', label: 'Merriweather', kind: 'serif', stack: `'Merriweather', Georgia, serif` },
  { id: 'system-sans', label: 'System default', kind: 'sans', stack: SYSTEM_SANS }
];

export const CODE_FONTS = [
  { id: 'jetbrains-mono', label: 'JetBrains Mono', stack: `'JetBrains Mono', ${SYSTEM_MONO}` },
  { id: 'fira-code', label: 'Fira Code', stack: `'Fira Code', ${SYSTEM_MONO}`, ligatures: true },
  { id: 'cascadia-code', label: 'Cascadia Code', stack: `'Cascadia Code', ${SYSTEM_MONO}`, ligatures: true },
  { id: 'source-code-pro', label: 'Source Code Pro', stack: `'Source Code Pro', ${SYSTEM_MONO}` },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', stack: `'IBM Plex Mono', ${SYSTEM_MONO}` },
  { id: 'roboto-mono', label: 'Roboto Mono', stack: `'Roboto Mono', ${SYSTEM_MONO}` },
  { id: 'system-mono', label: 'System monospace', stack: SYSTEM_MONO }
];

export const DEFAULT_FONTS = {
  ui: 'inter',
  markdown: 'inter',
  code: 'jetbrains-mono',
  markdownSize: 16,
  editorSize: 14,
  ligatures: true,
  /** extension (no dot) → CODE_FONTS id. Tabs of that type use this face instead of `code`. */
  perType: {}
};

const ALL_FONTS = [...PROSE_FONTS, ...CODE_FONTS];

export function fontById(id) {
  return ALL_FONTS.find((f) => f.id === id) || null;
}

export function fontStack(id, fallbackId) {
  return (fontById(id) || fontById(fallbackId))?.stack ?? SYSTEM_SANS;
}

/**
 * Merge stored font settings onto the defaults, dropping ids that no longer exist — a font removed
 * from the registry must degrade to the default, not to an unresolved CSS variable.
 */
export function resolveFonts(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const proseId = (id, fallback) => (PROSE_FONTS.some((f) => f.id === id) ? id : fallback);
  const codeId = (id, fallback) => (CODE_FONTS.some((f) => f.id === id) ? id : fallback);

  const perType = {};
  if (s.perType && typeof s.perType === 'object') {
    for (const [ext, id] of Object.entries(s.perType)) {
      if (CODE_FONTS.some((f) => f.id === id)) perType[ext] = id;
    }
  }

  const clamp = (n, lo, hi, dflt) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt);

  return {
    ui: proseId(s.ui, DEFAULT_FONTS.ui),
    markdown: proseId(s.markdown, DEFAULT_FONTS.markdown),
    code: codeId(s.code, DEFAULT_FONTS.code),
    markdownSize: clamp(s.markdownSize, 12, 22, DEFAULT_FONTS.markdownSize),
    editorSize: clamp(s.editorSize, 10, 20, DEFAULT_FONTS.editorSize),
    ligatures: s.ligatures !== false,
    perType
  };
}

/** Push the current font settings into the CSS custom properties the stylesheets read. */
export function applyFonts(fonts) {
  const root = document.documentElement.style;
  root.setProperty('--font-sans', fontStack(fonts.ui, DEFAULT_FONTS.ui));
  root.setProperty('--font-doc', fontStack(fonts.markdown, DEFAULT_FONTS.markdown));
  root.setProperty('--font-mono', fontStack(fonts.code, DEFAULT_FONTS.code));
  root.setProperty('--doc-font-size', `${fonts.markdownSize}px`);
  root.setProperty('--editor-font-size', `${fonts.editorSize}px`);
  root.setProperty('--editor-liga', fonts.ligatures ? 'normal' : 'none');
}

/** The editor font stack for a given file, honouring the per-type override. */
export function editorFontFor(fileName, fonts) {
  const ext = (() => {
    const base = (fileName || '').toLowerCase();
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1) : '';
  })();
  const override = fonts.perType?.[ext];
  return fontStack(override || fonts.code, DEFAULT_FONTS.code);
}
