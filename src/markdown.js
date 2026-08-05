import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
// `lib/common` registers ~40 mainstream languages instead of all ~190. The full `highlight.js`
// entrypoint was costing roughly a megabyte of bundle for long-tail languages that markdown code
// fences essentially never name; anything unregistered falls back to plaintext, unstyled but
// intact.
import hljs from 'highlight.js/lib/common';
import markedKatex from 'marked-katex-extension';
// KaTeX's stylesheet is LOAD-BEARING: it hides the .katex-mathml screen-reader layer. Without it
// every equation renders twice — once as maths, once as raw MathML text.
import 'katex/dist/katex.min.css';

/**
 * markdown.js — the markdown rendering pipeline, extracted from App.jsx when tabs arrived.
 *
 * renderMarkdown() is PURE (content in, {html, toc} out) so App.jsx can call it both when opening
 * a document and when a watched file changes on disk, without the tangle of setState the old
 * processMarkdown carried.
 *
 * ── Code fences: marked-highlight, not `marked.setOptions({ highlight })` ─────────────────────
 * The old `highlight` option was removed from marked in v5. FATE had carried the dead option ever
 * since — it parsed fine, did nothing, and every fenced block rendered as plain <code> with no
 * `.hljs-*` spans, while a hard-coded github-dark.css sat in the bundle styling markup that never
 * existed. marked-highlight is the supported hook. The emitted `.hljs-*` classes are styled in
 * App.css from the SAME --syn-* tokens the code editor uses, so fenced blocks follow the active
 * theme exactly like full code files do.
 *
 * ── KaTeX (see AI_CONTEXT.md §1 — this is the app's founding feature) ─────────────────────────
 * `throwOnError: false, nonStandard: true` are load-bearing: nonStandard lets equations sit tight
 * against punctuation without breaking the whole parse.
 */

marked.setOptions({ gfm: true, breaks: true });

marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);

marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

/**
 * Render markdown source to sanitized HTML plus a table of contents.
 *
 * `fPath` (when known) anchors relative image paths, which are rewritten onto the fate-local://
 * protocol so the main process can serve them from disk.
 */
export function renderMarkdown(content, fPath) {
  // Repair mathematically corrupted control-characters from unescaped markdown generators.
  // The literal control characters are intentional — generators emit a real \t byte where they
  // meant to emit a backslash-t escape, so matching them is the entire point of this pass.
  /* eslint-disable no-control-regex */
  const repairedContent = content
    .replace(/\x09heta/g, '\\theta')
    .replace(/\x09ext/g, '\\text')
    .replace(/\x09imes/g, '\\times')
    .replace(/\x09au/g, '\\tau')
    .replace(/\x0Crac/g, '\\frac')
    .replace(/\x0Dight/g, '\\right')
    .replace(/\x08eta/g, '\\beta')
    .replace(/\x08egin/g, '\\begin')
    .replace(/\x07pprox/g, '\\approx')
    .replace(/\x07lpha/g, '\\alpha')
    .replace(/\x0Dho/g, '\\rho')
    .replace(/\x0B/g, '\\v')
    .replace(/\\ /g, '\\\\ ');
  /* eslint-enable no-control-regex */

  const rawHtml = marked.parse(repairedContent);
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { mathMl: true, html: true },
    ADD_TAGS: ['annotation'],
    ADD_ATTR: ['class', 'style', 'aria-hidden', 'encoding', 'xmlns', 'viewBox', 'd', 'preserveAspectRatio']
  });

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = cleanHtml;

  if (fPath) {
    const dirPath = fPath.substring(0, Math.max(fPath.lastIndexOf('\\'), fPath.lastIndexOf('/')));
    const imgs = tempDiv.querySelectorAll('img');
    imgs.forEach((img) => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        const isAbsolute = /^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('/');
        const absPath = isAbsolute ? src.replace(/\\/g, '/') : `${dirPath}/${src}`.replace(/\\/g, '/');
        const finalPath = absPath.startsWith('/') ? absPath : `/${absPath}`;
        img.setAttribute('src', `fate-local://${finalPath}`);
      }
    });
  }

  // Heading ids for the TOC. Do not strip markup from `html` — headings can contain KaTeX, and the
  // sidebar renders it (see AI_CONTEXT.md §2).
  const headings = Array.from(tempDiv.querySelectorAll('h1, h2, h3'));
  const toc = headings.map((h, i) => {
    const id = `heading-${i}`;
    h.id = id;
    return { id, html: h.innerHTML, level: parseInt(h.tagName.substring(1)) };
  });

  /*
   * Reading time: word count over 220 wpm (an ordinary technical-reading pace). Computed here so
   * it never costs anything at scroll/render time; the status bar just prints it.
   */
  const words = (tempDiv.textContent || '').trim().split(/\s+/).filter(Boolean).length;
  const readMins = Math.max(1, Math.round(words / 220));

  // Whether any ```mermaid fences exist — MarkdownView lazy-loads the mermaid renderer only then.
  const hasMermaid = !!tempDiv.querySelector('code.language-mermaid');

  return { html: tempDiv.innerHTML, toc, readMins, hasMermaid };
}
