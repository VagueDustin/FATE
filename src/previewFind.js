/**
 * previewFind.js: find in the reading view. The text index and matching, the highlights, which
 * reading view a Ctrl+F belongs to, and the Ctrl+F key itself. The bar is
 * components/PreviewFindBar.jsx, one per reading view.
 *
 * ── Highlights, not DOM edits ────────────────────────────────────────────────────────────────
 * Matches are painted with the CSS Custom Highlight API (`::highlight(fate-find)` and
 * `::highlight(fate-find-current)` in App.css): Range objects over the document's own text nodes.
 * Wrapping matches in <mark> elements would rewrite DOM that React owns through
 * dangerouslySetInnerHTML, break the selection a copy relies on, and split the text nodes the
 * next search walks.
 *
 * ── Opening ──────────────────────────────────────────────────────────────────────────────────
 * Ctrl+F opens it when a reading view is showing and focus is not in an editor or a field
 * (CodeMirror keeps Ctrl+F for its own search panel). Anything else can open it with
 * `window.dispatchEvent(new CustomEvent('fate:find'))`, e.g. the application menu's Find.
 */

const HIGHLIGHT_ALL = 'fate-find';
const HIGHLIGHT_CURRENT = 'fate-find-current';
/** Painting more ranges than this costs more than it helps; the count still covers every match. */
export const MAX_PAINTED = 5000;

function elementOf(node) {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
}

const isVisible = (el) => !!el && el.checkVisibility();

/**
 * The reading view a find belongs to, as its .markdown-body: the one holding focus, else the one
 * holding the selection (split view), else the active tab's. Only a VISIBLE one; hidden panes
 * stay mounted. Null when no reading view is showing.
 */
export function findTargetBody() {
  const views = [
    elementOf(document.activeElement)?.closest('.viewer-layout'),
    elementOf(window.getSelection()?.anchorNode)?.closest('.viewer-layout'),
    document.querySelector('.doc-pane-active .viewer-layout')
  ];
  for (const view of views) {
    if (isVisible(view)) return view.querySelector('.markdown-body');
  }
  return null;
}

/** A modal (Settings, the palette) is open over the panes. */
export const isModalOpen = () => !!document.querySelector('[role="dialog"]');

/** Focus is somewhere that has its own keys: an editor or a form field. */
export function isEditableTarget(t) {
  if (!(t instanceof Element)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || !!t.closest('.cm-editor');
}

/* ── Text index ────────────────────────────────────────────────────────────────────────────── */

/* What a reader can't see: KaTeX's MathML copy of each formula, stylesheets inside diagrams, the
   empty copy buttons. */
const SKIP = '.katex-mathml, style, script, .code-copy';
const BLOCK_TAGS = new Set([
  'P', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'DIV', 'SECTION', 'ARTICLE',
  'DETAILS', 'SUMMARY', 'FIGURE', 'FIGCAPTION', 'HR'
]);
/** Ends one block's text from the next, so a match can't run from one paragraph into another. */
const BLOCK_BREAK = '\u0000';

const isSpace = (c) =>
  c <= 32 || c === 0xa0 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;

/**
 * The searchable text of `root`, folded (lower-cased, each run of whitespace one space) the way
 * queries are, with a map from every folded character back to its text node and offset.
 */
export function buildTextIndex(root) {
  const nodes = [];
  const nodeAt = [];
  const offsetAt = [];
  let text = '';
  const blockCache = new Map();
  const blockOf = (el) => {
    const hit = blockCache.get(el);
    if (hit) return hit;
    let b = el;
    while (b !== root && !BLOCK_TAGS.has(b.tagName)) b = b.parentElement;
    blockCache.set(el, b);
    return b;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  let lastBlock = null;
  let chunk = [];
  const push = (ch, ni, off) => {
    chunk.push(ch);
    nodeAt.push(ni);
    offsetAt.push(off);
  };
  let lastChar = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const ni = nodes.push(n) - 1;
    const block = blockOf(n.parentElement);
    if (lastBlock && block !== lastBlock && lastChar !== BLOCK_BREAK) {
      push(BLOCK_BREAK, ni, 0);
      lastChar = BLOCK_BREAK;
    } else if (n.previousSibling?.nodeName === 'BR' && lastChar !== ' ') {
      push(' ', ni, 0);
      lastChar = ' ';
    }
    lastBlock = block;
    const data = n.data;
    const lower = data.toLowerCase();
    const sameLength = lower.length === data.length;
    for (let i = 0; i < data.length; i++) {
      if (isSpace(data.charCodeAt(i))) {
        if (lastChar === ' ') continue;
        push(' ', ni, i);
        lastChar = ' ';
      } else {
        const ch = sameLength ? lower[i] : data[i].toLowerCase();
        push(ch.length === 1 ? ch : data[i], ni, i);
        lastChar = ch;
      }
    }
    if (chunk.length > 4096) {
      text += chunk.join('');
      chunk = [];
    }
  }
  text += chunk.join('');
  return { text, nodes, nodeAt, offsetAt };
}

/** A query folded the way the index is: lower-cased per character, whitespace runs to one space. */
export function foldQuery(query) {
  let out = '';
  for (const ch of query) {
    if (isSpace(ch.charCodeAt(0))) {
      if (!out.endsWith(' ')) out += ' ';
    } else {
      const low = ch.toLowerCase();
      out += low.length === ch.length ? low : ch;
    }
  }
  return out;
}

/** Start offsets (into index.text) of every non-overlapping match of the folded query. */
export function findMatches(index, folded) {
  const starts = [];
  if (!folded) return starts;
  for (let i = index.text.indexOf(folded); i !== -1; i = index.text.indexOf(folded, i + folded.length)) {
    starts.push(i);
  }
  return starts;
}

/** The DOM range of the match at `start`, `length` folded characters long. */
export function rangeAt(index, start, length) {
  const end = start + length - 1;
  const range = document.createRange();
  range.setStart(index.nodes[index.nodeAt[start]], index.offsetAt[start]);
  range.setEnd(index.nodes[index.nodeAt[end]], index.offsetAt[end] + 1);
  return range;
}

/* ── Painting ──────────────────────────────────────────────────────────────────────────────── */

/*
 * Two highlights for the whole app, shared by every open bar (split view can show two): each bar
 * registers its own ranges under its own key and both highlights are rebuilt from all of them.
 */
const painted = new Map();

function repaint() {
  if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
  const all = new Highlight();
  const current = new Highlight();
  current.priority = 1;
  for (const entry of painted.values()) {
    for (const r of entry.ranges) all.add(r);
    if (entry.current) current.add(entry.current);
  }
  CSS.highlights.set(HIGHLIGHT_ALL, all);
  CSS.highlights.set(HIGHLIGHT_CURRENT, current);
}

export function paintMatches(owner, ranges, current) {
  painted.set(owner, { ranges, current });
  repaint();
}

export function clearMatches(owner) {
  if (painted.delete(owner)) repaint();
}

/* ── Scrolling a match into view ───────────────────────────────────────────────────────────── */

export function revealRange(range, scroller) {
  const el = elementOf(range.startContainer);
  for (let d = el?.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) {
    d.open = true;
  }
  // Sideways first: a long line in a code block or a wide formula scrolls inside its own box.
  for (let box = el; box && box !== scroller; box = box.parentElement) {
    if (box.scrollWidth <= box.clientWidth) continue;
    const r = range.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.left < b.left || r.right > b.right) box.scrollLeft += r.left - b.left - b.width / 3;
  }
  const r = range.getBoundingClientRect();
  const b = scroller.getBoundingClientRect();
  const margin = 48;
  if (r.top < b.top + margin || r.bottom > b.bottom - margin) {
    scroller.scrollTo({ top: scroller.scrollTop + r.top - b.top - b.height / 3, behavior: 'instant' });
  }
}

/* ── Ctrl+F ─────────────────────────────────────────────────────────────────────────────────── */

function onKeyDown(e) {
  if (e.defaultPrevented || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
  if (e.key.toLowerCase() !== 'f') return;
  const t = e.target;
  // In the bar itself Ctrl+F re-selects the query, as in a browser.
  if (!(t instanceof Element && t.closest('.find-bar')) && isEditableTarget(t)) return;
  if (isModalOpen() || !findTargetBody()) return;
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('fate:find'));
}

/** Install the Ctrl+F handler; returns the uninstaller. */
export function installPreviewFind() {
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
