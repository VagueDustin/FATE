/**
 * previewClipboard.js: what copying out of rendered markdown puts on the clipboard (the reading
 * view, and the live preview beside the editor).
 *
 * ── Why FATE handles this itself ──────────────────────────────────────────────────────────────
 * Left to Chromium, a copy from the preview carried the THEME: text/html with every computed style
 * inlined (navy backgrounds, near-white text, gold borders, the app's fonts). Anything that pastes
 * HTML (Word, Outlook, Teams, OneNote, mail) got a dark box, or white text on a white page, and a
 * command copied out of a ```powershell block arrived with all of it attached. CodeMirror never
 * had the problem because it writes plain text only; this module holds the preview to that:
 *
 *   - Each code block's Copy button copies its exact text, minus the newline marked ends every
 *     block with, so a pasted command waits at the prompt instead of running.
 *   - A selection inside code (a fenced block, or inline `code`) copies as plain text only.
 *   - Any other selection copies as plain text plus clean HTML: structure survives (headings,
 *     lists, links, tables, code blocks), styles, classes and ids do not, so the receiving app
 *     formats it its own way.
 *   - Maths copies as its TeX source ($…$, $$…$$). Chromium's copy of a KaTeX formula put every
 *     glyph on its own line, twice over (the MathML layer, then the visual one). KaTeX's own
 *     contrib/copy-tex does the same substitution, but it installs a second global listener and
 *     loses paragraph breaks.
 *   - On Windows, plain text gets CRLF line breaks, as Chromium's own copies do there.
 *
 * Everything is delegated from `document`, so every preview (tabs, split panes, edit mode) is
 * covered with no per-component wiring and the HTML from renderMarkdown stays a static string.
 */
import { installPreviewLinks } from './previewLinks.js';
import { installPreviewFind } from './previewFind.js';

const IS_WINDOWS = window.electronAPI?.platform === 'win32';

/** Line breaks the way the platform's clipboard expects them. */
function toClipboardText(text) {
  const lf = text.replace(/\r\n?/g, '\n');
  return IS_WINDOWS ? lf.replace(/\n/g, '\r\n') : lf;
}

function elementOf(node) {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

/* ── Copy buttons ──────────────────────────────────────────────────────────────────────────── */

const BUTTON_LABEL = 'Copy code';
const resetTimers = new WeakMap();

/** Brief "Copied" / "Copy failed" feedback on the button itself (icon via CSS, label for AT). */
function flashButton(button, state, label) {
  clearTimeout(resetTimers.get(button));
  button.dataset.state = state;
  button.title = label;
  button.setAttribute('aria-label', label);
  resetTimers.set(
    button,
    setTimeout(() => {
      delete button.dataset.state;
      button.title = BUTTON_LABEL;
      button.setAttribute('aria-label', BUTTON_LABEL);
    }, 1600)
  );
}

function onClick(event) {
  const button = event.target instanceof Element ? event.target.closest('.code-copy') : null;
  const pre = button?.closest('.code-block')?.querySelector('pre');
  if (!pre) return;
  const code = pre.textContent.replace(/\n$/, '');
  navigator.clipboard.writeText(toClipboardText(code)).then(
    () => flashButton(button, 'copied', 'Copied'),
    () => flashButton(button, 'failed', 'Copy failed')
  );
}

/* ── Selections ────────────────────────────────────────────────────────────────────────────── */

/** True when nothing in `pre` follows the end of `range`. */
function reachesEnd(range, pre) {
  const rest = document.createRange();
  rest.setStart(range.endContainer, range.endOffset);
  rest.setEnd(pre, pre.childNodes.length); // collapses to the start if `range` ends after `pre`
  return rest.toString() === '';
}

/** Swap each KaTeX formula for its TeX source, delimited the way it was written. */
function replaceMathWithTex(fragment, insideDisplay) {
  for (const visual of fragment.querySelectorAll('.katex-mathml + .katex-html')) visual.remove();
  for (const mathml of fragment.querySelectorAll('.katex-mathml')) {
    const tex = mathml.querySelector('annotation')?.textContent ?? '';
    const display = insideDisplay || !!mathml.closest('.katex-display');
    mathml.replaceWith(display ? `$$${tex}$$` : `$${tex}$`);
  }
}

/** The only attributes that survive into copied HTML: the ones that carry meaning, not looks. */
const KEPT_ATTRIBUTES = {
  A: ['href'],
  IMG: ['src', 'alt'],
  OL: ['start'],
  TH: ['align', 'colspan', 'rowspan'],
  TD: ['align', 'colspan', 'rowspan'],
  INPUT: ['type', 'checked', 'disabled']
};

function stripPresentation(el) {
  const kept = KEPT_ATTRIBUTES[el.tagName] ?? [];
  for (const { name } of [...el.attributes]) {
    if (!kept.includes(name)) el.removeAttribute(name);
  }
}

/*
 * Ancestors the copied nodes need around them. Inline formatting that encloses the whole selection
 * (a partly selected link must stay a link), then the structure a fragment is invalid without
 * (list items need their list, rows and cells their table). Block containers are left out on
 * purpose: a phrase from inside a paragraph pastes inline, not as a new paragraph.
 */
const INLINE_CONTEXT = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'DEL', 'S', 'U', 'MARK', 'SUB', 'SUP']);
const STRUCTURE_CONTEXT = new Set(['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR']);

function wrapInContext(holder, start, root) {
  let content = holder;
  const wrap = (ancestor) => {
    const shell = ancestor.cloneNode(false);
    stripPresentation(shell);
    shell.append(...content.childNodes);
    content = document.createElement('div');
    content.append(shell);
  };
  let el = start;
  for (; el && el !== root && INLINE_CONTEXT.has(el.tagName); el = el.parentElement) wrap(el);
  for (; el && el !== root && STRUCTURE_CONTEXT.has(el.tagName); el = el.parentElement) wrap(el);
  return content;
}

/*
 * Plain text of copied nodes as a reader sees them. innerText applies CSS (block breaks, <pre>
 * whitespace, tabs between table cells) but only to RENDERED nodes, so they are laid out off-screen
 * inside a .markdown-body for one synchronous read. Consumes `content`.
 */
function renderedText(content, root) {
  const scratch = document.createElement('div');
  scratch.className = 'markdown-body';
  scratch.setAttribute('aria-hidden', 'true');
  scratch.style.cssText = `position:fixed;left:-100000px;top:0;width:${root.clientWidth}px`;
  scratch.append(...content.childNodes);
  document.body.append(scratch);
  try {
    return scratch.innerText;
  } finally {
    scratch.remove();
  }
}

function onCopy(event) {
  const selection = window.getSelection();
  if (event.defaultPrevented || !event.clipboardData) return;
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;

  const range = selection.getRangeAt(0).cloneRange();
  const common = elementOf(range.commonAncestorContainer);
  const root = common?.closest('.markdown-body');
  if (!root) return; // the editors and the rest of the app keep their own copy behaviour

  // Code: exactly the selected characters, and no HTML for a rich editor to restyle.
  const code = common.closest('pre, code, .code-block');
  if (code) {
    let text = selection.toString();
    // The block's final newline is marked's, not the author's; copied, it runs the command on paste.
    const pre = code.closest('.code-block')?.querySelector('pre') ?? code.closest('pre');
    if (pre && text.endsWith('\n') && reachesEnd(range, pre)) text = text.slice(0, -1);
    event.preventDefault();
    event.clipboardData.setData('text/plain', toClipboardText(text));
    return;
  }

  // A formula is copied whole or not at all; its source cannot be split mid-glyph.
  const startMath = elementOf(range.startContainer)?.closest('.katex');
  if (startMath) range.setStartBefore(startMath);
  const endMath = elementOf(range.endContainer)?.closest('.katex');
  if (endMath) range.setEndAfter(endMath);
  const context = elementOf(range.commonAncestorContainer);

  const holder = document.createElement('div');
  holder.append(range.cloneContents());
  const hasMath = !!holder.querySelector('.katex-mathml');
  if (hasMath) replaceMathWithTex(holder, !!context.closest('.katex-display'));

  for (const button of holder.querySelectorAll('.code-copy')) button.remove();
  for (const img of holder.querySelectorAll('img')) {
    // fate-local:// images only resolve inside FATE; anywhere else they paste as a broken box.
    if (!/^(https?|data):/i.test(img.getAttribute('src') ?? '')) img.replaceWith(img.alt ?? '');
  }
  // An image that wasn't loaded (see markdown.js) copies as its alt text too, not "alt host".
  const placeholders = holder.querySelectorAll('.remote-image');
  for (const box of placeholders) box.replaceWith(box.dataset.alt ?? '');
  // SVG (mermaid diagrams) is left whole: without its attributes it is not a picture any more.
  for (const el of holder.querySelectorAll('*')) {
    if (!el.closest('svg')) stripPresentation(el);
  }

  const content = wrapInContext(holder, context, root);
  const html = content.innerHTML;
  // Chromium's own plain text for everything but maths and unloaded images (it is what users
  // already get today); those are swapped for text above (TeX, alt text), so their plain text
  // comes from the cleaned copy.
  const text = hasMath || placeholders.length ? renderedText(content, root) : selection.toString();

  event.preventDefault();
  event.clipboardData.setData('text/plain', toClipboardText(text));
  event.clipboardData.setData('text/html', html);
}

/*
 * Ctrl+A in a preview selects the DOCUMENT. The browser default selects the whole window (tab
 * strip, toolbar, contents sidebar, status bar), so select-all-then-copy gave you the app's
 * chrome along with the text. Prefers the preview the current selection is in (split panes),
 * else the active tab's. A selection can outlive its tab (hidden panes stay mounted), so only a
 * VISIBLE preview counts. Returns false when there is none to select.
 */
export function selectPreviewDocument() {
  const selection = window.getSelection();
  if (!selection) return false;
  const anchored = elementOf(selection.anchorNode)?.closest('.markdown-body');
  const body = anchored?.checkVisibility() ? anchored : document.querySelector('.doc-pane-active .markdown-body');
  if (!body?.checkVisibility()) return false;
  selection.selectAllChildren(body);
  return true;
}

/**
 * Install the document-level handlers; returns the uninstaller (App's mount effect). Every other
 * document-level preview handler is installed from here as well, so App keeps a single call: link
 * clicks (previewLinks.js) and Ctrl+F in the reading view (previewFind.js).
 */
export function installPreviewClipboard() {
  document.addEventListener('copy', onCopy);
  document.addEventListener('click', onClick);
  const uninstallLinks = installPreviewLinks();
  const uninstallFind = installPreviewFind();
  return () => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('click', onClick);
    uninstallLinks();
    uninstallFind();
  };
}
