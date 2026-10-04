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
// every equation renders twice: once as maths, once as raw MathML text.
import 'katex/dist/katex.min.css';

/**
 * markdown.js: the markdown rendering pipeline, extracted from App.jsx when tabs arrived.
 *
 * renderMarkdown() is PURE (content in, {html, toc} out) so App.jsx can call it both when opening
 * a document and when a watched file changes on disk, without the tangle of setState the old
 * processMarkdown carried.
 *
 * ── Code fences: marked-highlight, not `marked.setOptions({ highlight })` ─────────────────────
 * The old `highlight` option was removed from marked in v5. FATE had carried the dead option ever
 * since. It parsed fine, did nothing, and every fenced block rendered as plain <code> with no
 * `.hljs-*` spans, while a hard-coded github-dark.css sat in the bundle styling markup that never
 * existed. marked-highlight is the supported hook. The emitted `.hljs-*` classes are styled in
 * App.css from the SAME --syn-* tokens the code editor uses, so fenced blocks follow the active
 * theme exactly like full code files do.
 *
 * ── KaTeX (see AI_CONTEXT.md §1; this is the app's founding feature) ─────────────────────────
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

/*
 * ── Corrupted TeX is repaired in maths ONLY ──────────────────────────────────────────────────
 * Some generators write "\theta" into a string without escaping the backslash, so the file holds
 * a real TAB followed by "heta". TEX_REPAIRS turns those back into TeX. Up to 1.13.4 they ran over
 * the WHOLE document, code included: a tab-indented `auth := x` in a ```go block rendered as the
 * literal text `\tauth := x`, `cd My\ Documents` in a ```bash block became `My\\ Documents`, and
 * copying the block put the damage on the clipboard. Now each KaTeX tokenizer finds maths in the
 * source exactly as written, then re-reads the repaired span to get the formula. `raw` keeps the
 * original text, because the lexer advances by its length.
 *
 * The two carriage-return repairs live in renderMarkdown instead: marked turns a lone CR into a
 * line break before any tokenizer sees it.
 */
/* eslint-disable no-control-regex */
const TEX_REPAIRS = [
  [/\x09heta/g, '\\theta'],
  [/\x09ext/g, '\\text'],
  [/\x09imes/g, '\\times'],
  [/\x09au/g, '\\tau'],
  [/\x0Crac/g, '\\frac'],
  [/\x08eta/g, '\\beta'],
  [/\x08egin/g, '\\begin'],
  [/\x07pprox/g, '\\approx'],
  [/\x07lpha/g, '\\alpha'],
  [/\x0B/g, '\\v'],
  [/\\ /g, '\\\\ ']
];
/* eslint-enable no-control-regex */

const repairTex = (tex) => TEX_REPAIRS.reduce((s, [pattern, fix]) => s.replace(pattern, fix), tex);

function withTexRepair(extension) {
  const tokenize = extension.tokenizer;
  return {
    ...extension,
    tokenizer(src, tokens) {
      const token = tokenize.call(this, src, tokens);
      if (!token) return token;
      const repairedRaw = repairTex(token.raw);
      if (repairedRaw === token.raw) return token;
      const repaired = tokenize.call(this, repairedRaw, tokens);
      return repaired?.raw === repairedRaw ? { ...token, text: repaired.text } : token;
    }
  };
}

const katexExtension = markedKatex({ throwOnError: false, nonStandard: true });
marked.use({ extensions: katexExtension.extensions.map(withTexRepair) });

/**
 * Render markdown source to sanitized HTML plus a table of contents.
 *
 * `fPath` (when known) anchors relative image paths, which are rewritten onto the fate-local://
 * protocol so the main process can serve them from disk.
 */
export function renderMarkdown(content, fPath) {
  /*
   * A leading byte-order mark (Windows tools still write UTF-8 with one) hid the first block from
   * marked: `\uFEFF# Title` rendered as a paragraph and was missing from the contents.
   *
   * `\right` and `\rho` written with a real CR are the only TeX repairs that cannot wait for the
   * maths tokenizer (see TEX_REPAIRS). They can only match a lone CR, never a CRLF line ending.
   */
  /* eslint-disable no-control-regex */
  const repairedContent = content
    .replace(/^\uFEFF/, '')
    .replace(/\x0Dight/g, '\\right')
    .replace(/\x0Dho/g, '\\rho');
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
        /*
         * fate-local://local/<encoded absolute path>. The fixed `local` host is load-bearing:
         * fate-local is a *standard* scheme (main.cjs registerSchemesAsPrivileged), and Chromium
         * canonicalises `scheme:///C:/x` for standard schemes by collapsing the empty authority,
         * so the old `fate-local:///C:/Users/…` became host `c`, path `/Users/…`, and every local
         * image 404'd while the src attribute still looked right. Per-segment encoding keeps `#`,
         * `?` and `%` in filenames from being parsed as URL syntax; the main process decodes.
         */
        const encoded = finalPath.split('/').map(encodeURIComponent).join('/');
        img.setAttribute('src', `fate-local://local${encoded}`);
      }
    });
  }

  /*
   * Every code block gets a wrapper and a Copy button (previewClipboard.js handles the click, and
   * what any selection in the preview copies). The button is EMPTY, with its icon drawn by CSS, so
   * it adds no text to a selection that runs across the block. Mermaid fences get one too, and the
   * diagram pass replaces the whole wrapper once the SVG lands.
   */
  for (const pre of tempDiv.querySelectorAll('pre')) {
    const block = document.createElement('div');
    block.className = 'code-block';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'code-copy';
    copy.title = 'Copy code';
    copy.setAttribute('aria-label', 'Copy code');
    pre.replaceWith(block);
    block.append(copy, pre);
  }

  // Heading ids for the TOC. Do not strip markup from `html`; headings can contain KaTeX, and the
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

  // Whether any ```mermaid fences exist; MarkdownView lazy-loads the mermaid renderer only then.
  const hasMermaid = !!tempDiv.querySelector('code.language-mermaid');

  return { html: tempDiv.innerHTML, toc, readMins, hasMermaid };
}
