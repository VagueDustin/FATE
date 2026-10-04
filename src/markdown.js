import { marked, Parser } from 'marked';
import { markedHighlight } from 'marked-highlight';
import DOMPurify from 'dompurify';
// `lib/common` registers ~40 mainstream languages instead of all ~190. The full `highlight.js`
// entrypoint was costing roughly a megabyte of bundle for long-tail languages that markdown code
// fences essentially never name; anything unregistered falls back to plaintext, unstyled but
// intact.
import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
import dos from 'highlight.js/lib/languages/dos';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import markedKatex from 'marked-katex-extension';
// KaTeX's stylesheet is LOAD-BEARING: it hides the .katex-mathml screen-reader layer. Without it
// every equation renders twice: once as maths, once as raw MathML text.
import 'katex/dist/katex.min.css';
import { withTexRepair } from './markdownMath.js';
import { classifyImageSrc, toFateLocalUrl, createSlugger } from './previewPaths.js';

/**
 * markdown.js: the markdown rendering pipeline, extracted from App.jsx when tabs arrived.
 *
 * renderMarkdown() is PURE (content in, {html, toc, …} out) so App.jsx can call it both when
 * opening a document and when a watched file changes on disk, without the tangle of setState the
 * old processMarkdown carried.
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
 * against punctuation without breaking the whole parse. FATE's own rules around the tokenizers
 * (TeX repairs, `$5 and $10`) live in markdownMath.js.
 */

marked.setOptions({ gfm: true, breaks: true });

/*
 * Shell grammars on top of lib/common, which has bash but none of these, so a ```powershell fence
 * rendered as plain text. The code blocks people copy out of a README are mostly commands. The
 * aliases are the info strings people write; the grammars declare all but `batch` themselves.
 */
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('dos', dos);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerAliases(['ps', 'ps1', 'pwsh'], { languageName: 'powershell' });
hljs.registerAliases(['bat', 'cmd', 'batch'], { languageName: 'dos' });

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
 * ── Telling KaTeX's markup from the document's ───────────────────────────────────────────────
 * KaTeX positions every glyph with inline styles and styles itself by class, both of which the
 * sanitiser strips from everything else. Checking `closest('.katex')` alone would let raw HTML in
 * the document claim the exemption (`<span class="katex"><div style="position:fixed…">`), so the
 * renderer stamps the root element of its own output with a token made fresh for each run of the
 * app, which no document can know in advance. The sanitiser trusts only what sits under a stamped
 * root, and renderMarkdown removes the stamps before the HTML goes anywhere.
 */
const KATEX_STAMP = Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(36)).join('');

function stampKatexOutput(extension) {
  const render = extension.renderer;
  return {
    ...extension,
    renderer(token) {
      return render.call(this, token).replace(/^<span\b/, `<span data-fate-katex="${KATEX_STAMP}"`);
    }
  };
}

const katexExtension = markedKatex({ throwOnError: false, nonStandard: true });
marked.use({ extensions: katexExtension.extensions.map((ext) => stampKatexOutput(withTexRepair(ext))) });

/*
 * ── Source lines, for scroll sync ────────────────────────────────────────────────────────────
 * Ahead of each top-level block goes an empty marker holding the source line the block starts on
 * (0-based), counted through the tokens' `raw`, which together are exactly the source. Afterwards
 * annotateLines() moves each line onto the element that follows its marker, as `data-line`, and
 * drops the markers. Markers rather than pairing tokens with the rendered top-level elements by
 * position: raw HTML can turn one token into several elements, or none (a comment), or wrap the
 * blocks after it in its own <div>, and a positional pairing would then put the wrong line on
 * every later block. A marker labels its own block or nothing, so sync degrades gracefully.
 *
 * The line rides on each top-level token (processAllTokens) and the parser writes the marker in
 * front of that token's HTML (provideParser). Not as extra tokens: marked's walkTokens copies its
 * whole result list once per top-level token, and doubling their number made a long document
 * render about 50% slower.
 */
const SOURCE_LINE = Symbol('sourceLine');

function countNewlines(s) {
  let n = 0;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

marked.use({
  hooks: {
    processAllTokens(tokens) {
      if (!this.block) return tokens;
      let line = 0;
      for (const token of tokens) {
        token[SOURCE_LINE] = line;
        line += countNewlines(token.raw || '');
      }
      return tokens;
    },
    provideParser(block) {
      if (!block) return false; // marked's own inline parser
      return (tokens, options) => {
        const parser = new Parser(options);
        let html = '';
        for (const token of tokens) {
          if (token[SOURCE_LINE] !== undefined && token.type !== 'space' && token.type !== 'def') {
            html += `<span data-fate-line="${token[SOURCE_LINE]}"></span>`;
          }
          html += parser.parse([token]);
        }
        return html;
      };
    }
  }
});

function annotateLines(root) {
  // A `data-line` the document wrote itself would only confuse the sync.
  for (const el of root.querySelectorAll('[data-line]')) el.removeAttribute('data-line');
  for (const marker of root.querySelectorAll('[data-fate-line]')) {
    const next = marker.nextElementSibling;
    // Two markers in a row: the first block rendered nothing (an HTML comment), so skip its line.
    if (next && !next.hasAttribute('data-fate-line') && !next.hasAttribute('data-line')) {
      next.setAttribute('data-line', marker.getAttribute('data-fate-line'));
    }
    marker.remove();
  }
}

/*
 * ── Sanitising (H2, H7) ──────────────────────────────────────────────────────────────────────
 * Every preview stays mounted, so whatever one document's HTML can do, it does to the whole app:
 * up to 1.13.4 a <style> in one file restyled every tab and Settings, `position:fixed` content
 * drew over the UI, and forms and buttons rendered live. So, beyond DOMPurify's defaults:
 *   - SVG is allowed: KaTeX draws √, vector arrows, wide accents, braces and tall delimiters with
 *     it. Without the profile `$\sqrt{b^2-4ac}$` rendered as "b² − 4ac" and `$\vec v$` as "v".
 *   - No <style>, no forms or controls (task-list checkboxes, inert, excepted), no dialogs,
 *     popovers or invoker commands, nothing that loads another document (<iframe>, <object>,
 *     <embed>, <link>, <meta>, <base>), no SVG <image>.
 *   - `style` survives only on KaTeX's own markup (see KATEX_STAMP), and `class` only there and
 *     on highlighted code (`hljs`, `hljs-*`, `language-*`, and highlight.js's `function_`-style
 *     sub-scopes), so a document can't borrow the app's own classes (`drop-overlay`, …) either.
 *   - `id` and `name` become `user-content-…` (SANITIZE_NAMED_PROPS), so a document can't shadow
 *     the app's elements. #fragment links look for either form (previewLinks.js).
 *   - Nothing that fetches by itself: `srcset`, `poster`, `background` and CSS `url()` in SVG
 *     paint attributes are dropped; <img> is handled below (remote images are opt-in).
 */
const purifier = DOMPurify(window);

const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  ADD_TAGS: ['annotation'],
  ADD_ATTR: ['class', 'style', 'aria-hidden', 'encoding', 'xmlns', 'viewBox', 'd', 'preserveAspectRatio'],
  FORBID_TAGS: [
    'style', 'form', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'dialog',
    'meta', 'link', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'image'
  ],
  FORBID_ATTR: [
    'popover', 'popovertarget', 'popovertargetaction', 'command', 'commandfor', 'interestfor',
    'autofocus', 'contenteditable', 'srcset', 'poster', 'background'
  ],
  SANITIZE_NAMED_PROPS: true
};

const CODE_CLASS = /^(?:hljs(?:-\S+)?|language-\S+|[a-z]+_+)$/;
const PAINT_ATTRS = new Set(['fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'cursor']);
const EXTERNAL_URL_REF = /url\(\s*['"]?\s*(?!#)/i;
/* A Windows path written as a link or image (`C:\pics\a.png`, encoded `C:%5Cpics%5Ca.png` by marked).
   DOMPurify reads `C:` as an unknown URL scheme and would drop it. */
const WINDOWS_PATH_URL = /^[a-zA-Z]:(?:[\\/]|%5[cC])[^<>"'`\s]*$/;

/*
 * KaTeX's elements, found as the sanitiser walks: it visits every parent before its children, so
 * an element is KaTeX's when it carries the stamp or its parent is KaTeX's. One set lookup per
 * attribute rather than a `closest()` walk up the tree for each.
 */
const katexNodes = new WeakSet();

purifier.addHook('uponSanitizeElement', (node, data) => {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (katexNodes.has(node.parentNode) || node.getAttribute('data-fate-katex') === KATEX_STAMP) {
    katexNodes.add(node);
    return;
  }
  if (data.tagName !== 'input') return;
  // Task-list checkboxes (`- [ ]`) are the one form control a document keeps, and only inert.
  const inertCheckbox = (node.getAttribute('type') || '').toLowerCase() === 'checkbox' && node.hasAttribute('disabled');
  if (!inertCheckbox) node.remove();
});

purifier.addHook('uponSanitizeAttribute', (node, data) => {
  const name = data.attrName;
  if ((name === 'href' || name === 'src') && WINDOWS_PATH_URL.test(data.attrValue)) {
    data.forceKeepAttr = true;
    return;
  }
  if (katexNodes.has(node)) return; // KaTeX's own markup keeps its styles and classes
  if (name === 'style') {
    data.keepAttr = false;
  } else if (name === 'class') {
    const kept = data.attrValue.split(/\s+/).filter((c) => CODE_CLASS.test(c)).join(' ');
    if (kept) data.attrValue = kept;
    else data.keepAttr = false;
  } else if (PAINT_ATTRS.has(name) && EXTERNAL_URL_REF.test(data.attrValue)) {
    data.keepAttr = false;
  }
});

/*
 * ── Images ───────────────────────────────────────────────────────────────────────────────────
 * Local paths are served by the main process over fate-local:// (see toFateLocalUrl). Remote
 * images are opt-in: fetching them works as a read receipt (the sender's server learns when, and
 * from where, the document was opened), which FATE's offline promise rules out by default. Unless
 * the caller passes `remoteImages`, each one becomes a placeholder with its alt text and host, and
 * MarkdownView offers to load them. Images on network shares are never loaded (see C5 in
 * previewPaths.js).
 */
function imagePlaceholder(img, target) {
  const doc = img.ownerDocument;
  const alt = (img.getAttribute('alt') || '').trim() || 'Image';
  const host = target.host || (target.kind === 'blocked' ? 'network share' : '');
  const box = doc.createElement('span');
  box.className = 'remote-image';
  box.dataset.alt = img.getAttribute('alt') || ''; // what a copy of it gives (previewClipboard.js)
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `${alt} (not loaded${host ? ` from ${host}` : ''})`);
  box.title =
    target.kind === 'blocked'
      ? "Not loaded: FATE doesn't load images from network shares"
      : `Not loaded: ${target.url}`;
  const altEl = doc.createElement('span');
  altEl.className = 'remote-image-alt';
  altEl.textContent = alt;
  box.append(altEl);
  if (host) {
    const hostEl = doc.createElement('span');
    hostEl.className = 'remote-image-host';
    hostEl.textContent = host;
    box.append(hostEl);
  }
  return box;
}

/** Point every <img> at what it may load; returns how many remote images the document has. */
function resolveImages(root, fPath, remoteImages) {
  let remote = 0;
  for (const img of root.querySelectorAll('img')) {
    const target = classifyImageSrc(img.getAttribute('src'), fPath);
    if (target.kind === 'local') {
      img.setAttribute('src', toFateLocalUrl(target.path));
    } else if (target.kind === 'remote') {
      remote++;
      if (remoteImages) img.setAttribute('src', target.url);
      else img.replaceWith(imagePlaceholder(img, target));
    } else if (target.kind === 'blocked') {
      img.replaceWith(imagePlaceholder(img, target));
    }
    // 'data' and 'none' are fine as they are; 'unresolved' (a relative path in a document that
    // has no path yet) is left alone too, as it always was.
  }
  return remote;
}

/*
 * ── Heading ids ──────────────────────────────────────────────────────────────────────────────
 * GitHub's slugs (previewPaths.js), so `[Install](#installation)` and links into this document
 * from other files land where they do on GitHub. Set AFTER sanitising, which would prefix them.
 * A heading that came with its own id (raw HTML) keeps it, as user-content-….
 *
 * A slug can't take an id the app shell itself uses (`root`, and `fate-…` such as the custom
 * theme's <style>): getElementById would find the heading instead. Those get the
 * user-content- form, which #fragment links find as well.
 */
const isAppId = (id) => id === 'root' || id.startsWith('fate-');

/** A heading's text as GitHub slugs it: formulas count as their TeX source. */
function headingText(h) {
  const clone = h.cloneNode(true);
  for (const math of clone.querySelectorAll('.katex')) {
    math.replaceWith(math.querySelector('annotation')?.textContent ?? '');
  }
  return clone.textContent.trim();
}

/**
 * The heading's markup for its contents entry, which is a button: links inside it would be live
 * there (a click navigating instead of scrolling), and ids would be duplicated.
 */
function tocHtml(h) {
  const clone = h.cloneNode(true);
  for (const a of clone.querySelectorAll('a')) a.replaceWith(...a.childNodes);
  for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id');
  return clone.innerHTML;
}

/**
 * Render markdown source to sanitized HTML plus a table of contents.
 *
 * `fPath` (when known) anchors relative image paths, which are rewritten onto the fate-local://
 * protocol so the main process can serve them from disk. Remote images become placeholders
 * unless `remoteImages` is set; `remoteImageCount` says how many the document has either way.
 *
 * Returns { html, toc, readMins, hasMermaid, remoteImageCount }.
 */
export function renderMarkdown(content, fPath, { remoteImages = false } = {}) {
  /*
   * A leading byte-order mark (Windows tools still write UTF-8 with one) hid the first block from
   * marked: `\uFEFF# Title` rendered as a paragraph and was missing from the contents.
   *
   * `\right` and `\rho` written with a real CR are the only TeX repairs that cannot wait for the
   * maths tokenizer (see markdownMath.js). They can only match a lone CR, never a CRLF line ending.
   */
  /* eslint-disable no-control-regex */
  const repairedContent = content
    .replace(/^\uFEFF/, '')
    .replace(/\x0Dight/g, '\\right')
    .replace(/\x0Dho/g, '\\rho');
  /* eslint-enable no-control-regex */

  const rawHtml = marked.parse(repairedContent);
  const cleanHtml = purifier.sanitize(rawHtml, SANITIZE_CONFIG);

  /*
   * Post-processing happens in an INERT document (no browsing context). An element created in the
   * live one starts fetching its <img> the moment it is parsed, attached or not, so every remote
   * image used to be requested here, before anything could decide whether it should load.
   */
  const scratchDoc = document.implementation.createHTMLDocument('');
  const tempDiv = scratchDoc.createElement('div');
  tempDiv.innerHTML = cleanHtml;

  for (const el of tempDiv.querySelectorAll('[data-fate-katex]')) el.removeAttribute('data-fate-katex');

  const remoteImageCount = resolveImages(tempDiv, fPath, remoteImages);

  /*
   * Every code block gets a wrapper and a Copy button (previewClipboard.js handles the click, and
   * what any selection in the preview copies). The button is EMPTY, with its icon drawn by CSS, so
   * it adds no text to a selection that runs across the block. Mermaid fences get one too, and the
   * diagram pass replaces the whole wrapper once the SVG lands.
   */
  for (const pre of tempDiv.querySelectorAll('pre')) {
    const block = scratchDoc.createElement('div');
    block.className = 'code-block';
    const copy = scratchDoc.createElement('button');
    copy.type = 'button';
    copy.className = 'code-copy';
    copy.title = 'Copy code';
    copy.setAttribute('aria-label', 'Copy code');
    pre.replaceWith(block);
    block.append(copy, pre);
  }

  // After the wrappers, so a code block's line lands on its wrapper (the top-level element).
  annotateLines(tempDiv);

  const slug = createSlugger();
  for (const h of tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (h.id) continue;
    const id = slug(headingText(h));
    h.id = isAppId(id) ? `user-content-${id}` : id;
  }

  // The contents list: h1–h3. Keep their markup; headings can contain KaTeX, and the sidebar
  // renders it (see AI_CONTEXT.md §2).
  const toc = Array.from(tempDiv.querySelectorAll('h1, h2, h3'), (h) => ({
    id: h.id,
    html: tocHtml(h),
    level: parseInt(h.tagName.substring(1))
  }));

  /*
   * Reading time: word count over 220 wpm (an ordinary technical-reading pace). Computed here so
   * it never costs anything at scroll/render time; the status bar just prints it.
   */
  const words = (tempDiv.textContent || '').trim().split(/\s+/).filter(Boolean).length;
  const readMins = Math.max(1, Math.round(words / 220));

  // Whether any ```mermaid fences exist; the preview lazy-loads the mermaid renderer only then.
  const hasMermaid = !!tempDiv.querySelector('code.language-mermaid');

  return { html: tempDiv.innerHTML, toc, readMins, hasMermaid, remoteImageCount };
}
