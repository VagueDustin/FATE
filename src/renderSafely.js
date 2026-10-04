/**
 * renderSafely.js: Markdown rendering that cannot take the app down with it (1.14.0, H3).
 *
 * Up to 1.13.4 App.jsx called renderMarkdown inside setDocs updaters. Those run while React
 * renders, so the RangeError a 10 MB .txt raised (marked's lexer recursing past the stack limit)
 * unmounted the whole tree: a blank window and every unsaved buffer gone. Rendering now happens
 * BEFORE any state update, through this wrapper, and a failure degrades to the text itself,
 * escaped, in a <pre>. The caller tells the user (a status message); the tab stays usable.
 *
 * `render` is injected (App passes renderMarkdown) so the fallback is testable under node.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Same reading-time rule as renderMarkdown (220 words a minute), for the fallback. */
function readMinutes(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * `render(content, fPath, options)` → its result plus `renderFailed: false`, or the plain-text
 * fallback (same shape) with `renderFailed: true` and the error.
 */
export function renderSafely(render, content, fPath, options) {
  try {
    return { remoteImageCount: 0, ...render(content, fPath, options), renderFailed: false };
  } catch (error) {
    return {
      html: `<pre class="md-plain-fallback">${escapeHtml(content)}</pre>`,
      toc: [],
      readMins: readMinutes(content),
      hasMermaid: false,
      remoteImageCount: 0,
      renderFailed: true,
      error
    };
  }
}
