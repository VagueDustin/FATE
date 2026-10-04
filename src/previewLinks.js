/**
 * previewLinks.js: what clicking a link in rendered markdown does (the reading view, and the live
 * preview beside the editor).
 *
 * ── Why every click is handled here (C1) ─────────────────────────────────────────────────────
 * Left to Chromium, a link NAVIGATES THE WINDOW. `[Contributing](CONTRIBUTING.md)` resolved
 * against the app's own index.html, the navigation guard waved it through (it only checked the
 * folder), and the whole app was replaced by an error page: every tab and unsaved edit gone, no
 * prompt. So the default is always prevented, for every link in every preview, and FATE decides:
 *
 *   #fragment          scrolls within that preview (GitHub-style heading ids, or a
 *                      `user-content-` id the sanitiser prefixed; see markdown.js)
 *   relative/absolute  opens the file as a tab, resolved against the document's own folder
 *   path               (`data-doc-path` on .markdown-body); `other.md#setup` scrolls there once
 *                      the tab shows
 *   http(s), mailto:   goes to the system browser / mail app through the main process, which
 *                      confirms http(s) first
 *   anything else      nothing (other schemes, and network paths: see resolveLinkTarget)
 *
 * Middle-click (auxclick) is handled too: its default opens a new window, which the main process
 * used to pass to the browser with no confirmation at all.
 *
 * Installed once, from installPreviewClipboard() (App's mount effect), delegated from `document`.
 */
import { resolveLinkTarget } from './previewPaths.js';

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const IS_WINDOWS = window.electronAPI?.platform === 'win32';

/** Paths compare the way the file system does: case-insensitively on Windows, either slash. */
const samePath = (a, b) => {
  const key = (p) => (IS_WINDOWS ? p.replace(/\//g, '\\').toLowerCase() : p);
  return !!a && !!b && key(a) === key(b);
};

/** The scrolling element of the preview `el` is in. */
function previewScroller(el) {
  return el.closest('.markdown-container, .md-edit-preview');
}

/**
 * Scroll `el` to near the top of its preview, opening any collapsed <details> around it first.
 * Measured from the scroller rather than offsetTop, which counts from whatever happens to be the
 * offset parent (anything above the document in the pane would skew it).
 */
export function scrollIntoPreview(el, { behavior = 'smooth', offset = 40 } = {}) {
  for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) {
    d.open = true;
  }
  const scroller = previewScroller(el);
  if (!scroller) return;
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset;
  scroller.scrollTo({ top: Math.max(0, top), behavior });
}

/** What `#fragment` names inside `body`: an id or a name, as written or with the user-content- prefix. */
export function findFragmentTarget(body, fragment) {
  if (!fragment) return null;
  const tries = [...new Set([fragment, fragment.toLowerCase()])].flatMap((f) => [f, `user-content-${f}`]);
  for (const name of tries) {
    const quoted = CSS.escape(name);
    const el = body.querySelector(`[id="${quoted}"]`) ?? body.querySelector(`[name="${quoted}"]`);
    if (el) return el;
  }
  return null;
}

/*
 * `other.md#setup`: the fragment waits here until a reading view of that file is showing (the tab
 * opens asynchronously, or was already open in the background). MarkdownView collects it. Kept a
 * few seconds only, so a fragment can't fire long after the click that asked for it.
 */
const pending = { path: null, fragment: '', until: 0 };

export function takePendingFragment(docPath) {
  if (!pending.path || Date.now() > pending.until || !samePath(pending.path, docPath)) return null;
  const { fragment } = pending;
  pending.path = null;
  return fragment;
}

function hrefOf(link) {
  return link.getAttribute('href') ?? link.getAttributeNS(XLINK_NS, 'href') ?? '';
}

function markMissing(link, path) {
  const name = path.split(/[\\/]/).pop();
  link.dataset.linkState = 'missing';
  link.title = `Can't open ${name}: the file wasn't found`;
}

function onLinkActivate(event) {
  if (event.type === 'auxclick' && event.button !== 1) return;
  const start = event.target instanceof Element ? event.target : event.target?.parentElement;
  const link = start?.closest('a, area');
  const body = link?.closest('.markdown-body');
  if (!body) return;
  event.preventDefault();

  const docPath = body.dataset.docPath || null;
  const target = resolveLinkTarget(hrefOf(link), docPath);
  if (target.kind === 'fragment') {
    const el = findFragmentTarget(body, target.fragment);
    if (el) scrollIntoPreview(el);
  } else if (target.kind === 'external') {
    window.electronAPI?.openExternal?.(target.url)?.catch?.(() => {});
  } else if (target.kind === 'file') {
    // A link to this same document (`readme.md#install` from readme.md) just scrolls.
    if (samePath(target.path, docPath)) {
      const el = findFragmentTarget(body, target.fragment);
      if (el) scrollIntoPreview(el);
      return;
    }
    const api = window.electronAPI;
    if (!api?.openRecentFile) return;
    if (target.fragment) Object.assign(pending, { path: target.path, fragment: target.fragment, until: Date.now() + 5000 });
    api.openRecentFile(target.path).then(
      (result) => {
        if (result && result.ok === false) {
          pending.path = null;
          if (result.reason === 'missing') markMissing(link, target.path);
        }
      },
      () => {
        pending.path = null;
      }
    );
  }
}

/** Install the document-level link handling; returns the uninstaller. */
export function installPreviewLinks() {
  document.addEventListener('click', onLinkActivate);
  document.addEventListener('auxclick', onLinkActivate);
  return () => {
    document.removeEventListener('click', onLinkActivate);
    document.removeEventListener('auxclick', onLinkActivate);
  };
}
