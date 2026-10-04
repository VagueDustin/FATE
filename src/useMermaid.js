import { useEffect, useLayoutEffect, useState } from 'react';
import DOMPurify from 'dompurify';

/**
 * useMermaid: turns the ```mermaid fences in a preview into diagrams. Shared by the reading view
 * (MarkdownView) and the live preview beside the editor (MarkdownEditView).
 *
 * Fences arrive as <pre><code class="language-mermaid"> inside a Copy-button wrapper (see
 * markdown.js). The renderer is imported lazily (its own chunk, loaded only when a document
 * actually contains a diagram, still fully offline) and each fence's wrapper is swapped for the
 * diagram.
 *
 * THREE HARD-WON RULES:
 *   1. Only render while the preview is VISIBLE (`enabled`; the active tab OR the split pane).
 *      Mermaid measures text with getBBox(), which returns zeros inside display:none, so a hidden
 *      pane's diagrams failed silently and stayed as fences. Up to 1.13.4 this waited for the tab
 *      to be ACTIVE, so diagrams never rendered in the right-hand split pane at all.
 *   2. Mark a fence done only AFTER its SVG lands (and mark failures separately). The pass mutates
 *      DOM that React owns via dangerouslySetInnerHTML; any re-render that restores the original
 *      html brings the fences back, and this pass must then happily run again.
 *   3. A failed render leaves nothing behind. Mermaid used to draw its "Syntax error" picture into
 *      a temporary element at the end of <body>, where it stayed, and later PDF exports printed it
 *      on the last page. `suppressErrorRendering` stops the picture, and the temporary elements
 *      are removed by id whatever happens.
 *
 * Rendered diagrams are kept per preview, keyed by theme and source, so a preview that re-renders
 * (every pause in typing, in edit mode) puts unchanged diagrams back before paint instead of
 * flashing the fence and drawing them again.
 */

let renderCounter = 0;

const isLightTheme = () => document.documentElement.getAttribute('data-theme') === 'light';
const FENCES = 'code.language-mermaid:not([data-mermaid-done]):not([data-mermaid-failed])';
const CACHE_LIMIT = 40;

/*
 * ── Nothing from the internet, before or after ───────────────────────────────────────────────
 * Mermaid lays a diagram out in a live element at the end of <body>, so whatever it puts there
 * loads, before any sanitising of its output could help: an `<img src="https://…">` in a node
 * label, the flowchart image shape (`A@{ img: "https://…" }`), a sequence actor's icon, a
 * `url()` in `themeCSS`. A diagram is part of the document, and the document's remote images are
 * opt-in (see markdown.js), so these are closed off where mermaid allows it:
 *   - labels go through mermaid's own DOMPurify call with LABEL_PURIFY: no images, media or inline
 *     styles (which could hold a url());
 *   - `secure` keys can't be changed from inside a document (`%%{init: …}%%` or front matter):
 *     mermaid's defaults plus themeCSS, the label config, and the fonts (both are raw CSS);
 *   - the image properties that mermaid fetches directly are emptied in the source
 *     (withoutRemoteImages), so the node renders without its picture.
 * Diagrams never load remote images, even in a document whose images the user chose to load.
 *
 * ── Sanitising the SVG ───────────────────────────────────────────────────────────────────────
 * The diagram goes in with innerHTML, so it gets the same treatment as the document around it,
 * even though mermaid's strict mode sanitises its own output: DOMPurify with the SVG profile (and
 * HTML inside <foreignObject>, which holds the node labels). Beyond that:
 *   - No <img> or SVG <image>.
 *   - The diagram's own <style> keeps only rules scoped to the diagram (mermaid prefixes every
 *     rule with the SVG's id, `classDef` included), and keyframes that don't reuse a name the app
 *     animates with. Anything else could restyle the app around it (H7). Declarations that load
 *     something (`url()` other than a `#reference` within the diagram) go too.
 *   - No fixed or sticky positioning, and no url() loads, in inline styles (labels are HTML).
 */
const MERMAID_SECURE_KEYS = [
  'secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges',
  'themeCSS', 'dompurifyConfig', 'fontFamily', 'altFontFamily'
];
const LABEL_PURIFY = {
  FORBID_TAGS: ['style', 'img', 'image', 'picture', 'source', 'video', 'audio', 'track', 'iframe', 'object', 'embed', 'link', 'meta'],
  FORBID_ATTR: ['style', 'srcset', 'poster', 'background']
};

/*
 * The image properties mermaid loads by itself live in `{…}` property blocks: the flowchart image
 * shape (`A@{ img: "…" }`) and a sequence actor's `properties A: {"icon": "…"}`. A value survives
 * only if it loads nothing: a data: URI, or an `@name` reference to a symbol in the diagram. An
 * allow-list, because URL parsing is lenient (`https:host/x`, ` https://…`, backslashes, and
 * `file://host/…`, a network share on Windows, all fetch).
 */
const PROPERTY_BLOCK = /\{[^{}]*\}/g;
const IMAGE_PROPERTY = /((?:\bimg|"icon")\s*:\s*)(?:(["'])((?:(?!\2)[^\\\n]|\\.)*)\2|([^\s,}"']+))/gi;
const withoutRemoteImages = (source) =>
  source.replace(PROPERTY_BLOCK, (block) =>
    block.replace(IMAGE_PROPERTY, (match, key, _quote, quoted, bare) =>
      /^\s*(?:data:|@)/i.test(quoted ?? bare ?? '') ? match : `${key}""`
    )
  );

const REMOTE_URL_VALUE = /url\(\s*['"]?\s*(?!#)/i;

const svgPurifier = DOMPurify(window);
svgPurifier.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'img') node.replaceWith(node.getAttribute('alt') || '');
});

const SVG_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ['foreignobject'],
  HTML_INTEGRATION_POINTS: { foreignobject: true },
  FORBID_TAGS: ['image', 'script', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'dialog'],
  FORBID_ATTR: ['popover', 'popovertarget', 'command', 'commandfor', 'interestfor', 'autofocus', 'contenteditable', 'srcset']
};

let appKeyframes = null;
/** Animation names the app's own stylesheets (in <head>) define. */
function appKeyframeNames() {
  if (appKeyframes) return appKeyframes;
  appKeyframes = new Set();
  for (const sheet of document.styleSheets) {
    if (sheet.ownerNode?.parentNode !== document.head) continue;
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) if (rule instanceof CSSKeyframesRule) appKeyframes.add(rule.name);
  }
  return appKeyframes;
}

function isScoped(rule, scope) {
  if (rule instanceof CSSStyleRule) return rule.selectorText.split(',').every((s) => scope.test(s.trim()));
  if (rule instanceof CSSKeyframesRule) return !appKeyframeNames().has(rule.name);
  if (rule instanceof CSSGroupingRule) return [...rule.cssRules].every((r) => isScoped(r, scope));
  return false; // @import, @font-face, @property, …
}

/** Drop every declaration in `style` (a CSSStyleDeclaration) that would load something. */
function dropLoads(style) {
  for (const prop of [...style]) {
    if (REMOTE_URL_VALUE.test(style.getPropertyValue(prop))) style.removeProperty(prop);
  }
}

function dropRuleLoads(rule) {
  if (rule.style) dropLoads(rule.style);
  if (rule.cssRules) for (const r of rule.cssRules) dropRuleLoads(r);
}

/** Sanitised markup for the diagram mermaid rendered as `id`. */
function sanitizeDiagram(svg, id) {
  const template = document.createElement('template');
  template.innerHTML = svgPurifier.sanitize(svg, SVG_CONFIG);
  const root = template.content;
  const scope = new RegExp(`^#${id.replace(/[-]/g, '\\-')}(?![\\w-])`);
  for (const style of root.querySelectorAll('style')) {
    const sheet = new CSSStyleSheet();
    try {
      sheet.replaceSync(style.textContent);
    } catch {
      style.remove();
      continue;
    }
    const kept = [...sheet.cssRules].filter((r) => isScoped(r, scope));
    for (const rule of kept) dropRuleLoads(rule);
    style.textContent = kept.map((r) => r.cssText).join('\n');
  }
  for (const el of root.querySelectorAll('[style]')) {
    if (/^(fixed|sticky)$/.test(el.style.position)) el.style.removeProperty('position');
    dropLoads(el.style);
  }
  return template.innerHTML;
}

/** Mermaid's temporary elements for a render, removed whether it worked or not. */
function removeLeftovers(id) {
  for (const leftover of [`d${id}`, `i${id}`, id]) document.getElementById(leftover)?.remove();
}

function replaceFence(code, diagram) {
  const holder = document.createElement('div');
  holder.className = 'mermaid-diagram';
  holder.innerHTML = diagram.svg;
  // The diagram replaces the fence's Copy-button wrapper too (see renderMarkdown), and takes over
  // its source line for scroll sync.
  const block = code.closest('.code-block') ?? code.closest('pre');
  const line = block?.getAttribute('data-line');
  if (line != null) holder.setAttribute('data-line', line);
  code.setAttribute('data-mermaid-done', '1');
  block?.replaceWith(holder);
}

const cacheKey = (code) => `${isLightTheme() ? 'light' : 'dark'}\n${code.textContent}`;

/** A cached diagram can go in only once per preview: its SVG id must stay unique. */
function usable(container, diagram) {
  return diagram && !container.querySelector(`[id="${CSS.escape(diagram.id)}"]`);
}

function remember(cache, key, diagram) {
  cache.delete(key);
  cache.set(key, diagram);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

async function renderFences(container, cache, isCancelled) {
  const { default: mermaid } = await import('mermaid');
  if (isCancelled() || !container.isConnected) return;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    secure: MERMAID_SECURE_KEYS,
    dompurifyConfig: LABEL_PURIFY,
    theme: isLightTheme() ? 'default' : 'dark',
    fontFamily: 'inherit'
  });

  for (const code of container.querySelectorAll(FENCES)) {
    if (isCancelled()) return;
    if (!code.isConnected) continue; // a re-render replaced it meanwhile
    const key = cacheKey(code);
    let diagram = cache.get(key);
    if (!usable(container, diagram)) {
      const id = `fate-mermaid-${++renderCounter}`;
      try {
        const { svg } = await mermaid.render(id, withoutRemoteImages(code.textContent));
        diagram = { id, svg: sanitizeDiagram(svg, id) };
        remember(cache, key, diagram);
      } catch (err) {
        // Invalid diagram source: keep the fence as highlighted text, don't retry it forever. A
        // warning, not an error: the mistake is the document's, and the app is fine.
        code.setAttribute('data-mermaid-failed', '1');
        console.warn('Mermaid diagram failed to render:', err?.message || err);
        continue;
      } finally {
        removeLeftovers(id);
      }
    }
    if (isCancelled() || !code.isConnected) return;
    replaceFence(code, diagram);
  }
}

/**
 * Render the diagrams in `containerRef`'s current `html`.
 *   hasMermaid  renderMarkdown's flag; nothing is loaded without it
 *   enabled     the preview is visible (see rule 1)
 *   delay       ms to wait after the last change before drawing new diagrams (edit mode)
 */
export function useMermaid(containerRef, { html, hasMermaid, enabled, delay = 0 }) {
  const [cache] = useState(() => new Map());

  // Diagrams rendered before for the same source and theme go back in before the browser paints.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!hasMermaid || !container) return;
    for (const code of container.querySelectorAll(FENCES)) {
      const diagram = cache.get(cacheKey(code));
      if (usable(container, diagram)) replaceFence(code, diagram);
    }
  }, [html, hasMermaid, containerRef, cache]);

  useEffect(() => {
    const container = containerRef.current;
    if (!hasMermaid || !enabled || !container) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      renderFences(container, cache, () => cancelled).catch((err) => {
        // A failed renderer load must be visible, not a silently missing diagram.
        console.error('Mermaid failed to load:', err?.message || err);
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [html, hasMermaid, enabled, delay, containerRef, cache]);
}
