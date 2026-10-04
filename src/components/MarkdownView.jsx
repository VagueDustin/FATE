import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { List, ImageBroken } from '@phosphor-icons/react';
import { renderMarkdown } from '../markdown.js';
import { useMermaid } from '../useMermaid.js';
import { findFragmentTarget, scrollIntoPreview, takePendingFragment } from '../previewLinks.js';
import PreviewFindBar from './PreviewFindBar.jsx';

/**
 * MarkdownView is one markdown tab's pane: TOC sidebar, resizer, and the scrolling document.
 *
 * Extracted from App.jsx when tabs arrived: each markdown tab needs its own scroll position,
 * heading cache, active-heading highlight and sidebar state, and encapsulating them here means N
 * tabs get that for free. The pane stays mounted (hidden) while inactive, so switching tabs
 * preserves scroll position exactly.
 *
 * `isActive` is the tab the user is on; `isVisible` is true for it AND for a document shown in the
 * right-hand split pane. Anything that measures layout (the active heading, Mermaid) needs only
 * the second; anything that writes the app's single progress bar needs the first.
 *
 * ── Scroll performance (see AI_CONTEXT.md §5a; do not regress) ───────────────────────────────
 * The rules from the single-document era carry over verbatim:
 *   - the progress bar/label are written straight to the DOM via refs, never via state;
 *   - headings are cached once per document, not queried per frame;
 *   - the active heading is compared against a ref so setState fires only on real changes,
 *     and the scroll effect must NOT depend on `activeHeading`;
 *   - one rAF in flight at a time; listener registered { passive: true }.
 * The one tab-era addition: progress writes are gated on `isActive`: the global progress bar and
 * "% read" belong to the visible tab, and a background tab must not fight it for the DOM node.
 *
 * ── Remote images ────────────────────────────────────────────────────────────────────────────
 * renderMarkdown leaves remote images out (placeholders) and counts them. A bar offers to load
 * them: "Load images" re-renders just this document, here, with them in; "Always load" also asks
 * App to remember the choice (`onAllowRemoteImages`), which comes back as `remoteImagesAllowed`.
 */
function MarkdownView({
  doc,
  isActive,
  isVisible = isActive,
  sidebarWidth,
  onSidebarWidthChange,
  progressBarRef,
  progressLabelRef,
  remoteImagesAllowed = false,
  onAllowRemoteImages
}) {
  const [remoteLoadedHere, setRemoteLoadedHere] = useState(false);
  const remoteCount = doc.remoteImageCount ?? 0;
  const withRemoteImages = remoteCount > 0 && (remoteImagesAllowed || remoteLoadedHere) && doc.source != null;
  const remoteRender = useMemo(
    () => (withRemoteImages ? renderMarkdown(doc.source, doc.path, { remoteImages: true }) : null),
    [withRemoteImages, doc.source, doc.path]
  );
  const html = remoteRender?.html ?? doc.html;
  const toc = remoteRender?.toc ?? doc.toc;

  const [isSidebarOpen, setIsSidebarOpen] = useState(toc.length > 0);
  const [activeHeading, setActiveHeading] = useState('');

  /*
   * Stable markup objects. React 19 compares `dangerouslySetInnerHTML` by object identity and
   * rewrites innerHTML whenever it changes, even to the same string, so a fresh `{ __html }` per
   * render rebuilt the whole document on every App re-render (window focus, tab switches, status
   * messages): mermaid diagrams vanished and a selection about to be copied was lost.
   */
  const bodyMarkup = useMemo(() => ({ __html: html }), [html]);
  const tocMarkup = useMemo(() => toc.map((item) => ({ __html: item.html })), [toc]);

  const layoutRef = useRef(null);
  const contentRef = useRef(null);
  const bodyRef = useRef(null);
  const headingsRef = useRef([]);
  const activeHeadingRef = useRef('');
  const scrollRafIdRef = useRef(null);
  const isActiveRef = useRef(isActive);
  const isResizing = useRef(false);

  /*
   * Re-evaluate the sidebar when the document's content is replaced (external reload), using the
   * render-time adjustment pattern, not an effect, so there is no flash of the stale state.
   */
  const [lastHtml, setLastHtml] = useState(doc.html);
  if (lastHtml !== doc.html) {
    setLastHtml(doc.html);
    setIsSidebarOpen(toc.length > 0);
  }

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const startResizing = useCallback((e) => {
    isResizing.current = true;
    e.target.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const stopResizing = useCallback((e) => {
    isResizing.current = false;
    if (e && e.target && e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) {
      e.target.releasePointerCapture(e.pointerId);
    }
  }, []);

  /*
   * The sidebar's width is the pointer's distance from THIS pane's left edge, capped at half the
   * pane. It used to be measured from the window's left edge, so in the right-hand split pane the
   * sidebar jumped to the pane's full offset on the first move.
   */
  const resize = useCallback(
    (e) => {
      if (!isResizing.current || !layoutRef.current) return;
      const pane = layoutRef.current.getBoundingClientRect();
      onSidebarWidthChange(Math.min(Math.max(e.clientX - pane.left, 200), pane.width * 0.5));
    },
    [onSidebarWidthChange]
  );

  /*
   * Scroll progress + active-heading tracking. Runs whenever the content changes AND whenever the
   * pane becomes active or visible (deps below): the former so the global progress bar snaps to
   * THIS tab's position on switch instead of showing the previous tab's number until the first
   * scroll, the latter so the contents highlight is worked out afresh from a real layout.
   *
   * The active heading is computed from scratch each time and only while the pane is visible.
   * Measured inside display:none every heading sits at 0, which used to mark the LAST heading
   * active, and a pane coming back into view kept that answer when no heading had yet passed the
   * trigger point.
   */
  useEffect(() => {
    const scrollContainer = contentRef.current;
    if (!scrollContainer) return;

    headingsRef.current = Array.from(scrollContainer.querySelectorAll('h1, h2, h3'));

    const handleScroll = () => {
      if (scrollRafIdRef.current !== null) return; // already scheduled for this frame

      scrollRafIdRef.current = requestAnimationFrame(() => {
        scrollRafIdRef.current = null;
        if (!contentRef.current) return;

        const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
        const totalScroll = scrollHeight - clientHeight;
        const progress = totalScroll > 0 ? (scrollTop / totalScroll) * 100 : 0;

        // Direct DOM writes, and only from the visible tab.
        if (isActiveRef.current) {
          if (progressBarRef.current) progressBarRef.current.style.width = `${progress}%`;
          if (progressLabelRef.current) progressLabelRef.current.textContent = `${Math.round(progress)}%`;
        }

        if (!isVisible) return;
        const headings = headingsRef.current;
        const triggerPoint = window.innerHeight * 0.4;
        let currentActive = '';
        for (const h of headings) {
          if (h.getBoundingClientRect().top <= triggerPoint) {
            currentActive = h.id;
          } else {
            break;
          }
        }

        // Before the first heading scrolls past the trigger point, highlight it anyway so the TOC
        // is never blank at the top of a document.
        if (currentActive === '' && headings.length > 0) currentActive = headings[0].id;

        if (currentActive !== activeHeadingRef.current) {
          activeHeadingRef.current = currentActive;
          setActiveHeading(currentActive);
        }
      });
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // initial position (and the snap-on-tab-switch write)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (scrollRafIdRef.current !== null) {
        cancelAnimationFrame(scrollRafIdRef.current);
        scrollRafIdRef.current = null;
      }
    };
  }, [html, isActive, isVisible, progressBarRef, progressLabelRef]);

  const scrollToHeading = (id) => {
    const element = bodyRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (element) scrollIntoPreview(element);
  };

  // A link from another document (`readme.md#setup`) asked for a place in this one.
  useEffect(() => {
    if (!isVisible || !doc.path || !bodyRef.current) return;
    const fragment = takePendingFragment(doc.path);
    const el = fragment && findFragmentTarget(bodyRef.current, fragment);
    if (el) scrollIntoPreview(el, { behavior: 'instant' });
  }, [isVisible, isActive, html, doc.path]);

  useMermaid(contentRef, { html, hasMermaid: doc.hasMermaid, enabled: isVisible });

  const showReveal = toc.length > 0 && !isSidebarOpen;

  return (
    <div className="viewer-layout" ref={layoutRef}>
      {toc.length > 0 && isSidebarOpen && (
        <>
          <aside
            className="sidebar"
            style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px`, flexShrink: 0 }}
          >
            <div className="sidebar-header">
              <h3 className="section-label">Contents</h3>
              <button className="icon-btn" onClick={() => setIsSidebarOpen(false)} title="Hide contents">
                <List size={16} weight="bold" />
              </button>
            </div>
            <ul className="toc-list">
              {toc.map((item, i) => (
                <li key={item.id} className={`toc-level-${item.level} ${activeHeading === item.id ? 'active' : ''}`}>
                  <button
                    type="button"
                    className="toc-link"
                    onClick={() => scrollToHeading(item.id)}
                    aria-current={activeHeading === item.id ? 'true' : undefined}
                    dangerouslySetInnerHTML={tocMarkup[i]}
                  />
                </li>
              ))}
            </ul>
          </aside>
          <div
            className="sidebar-resizer"
            onPointerDown={startResizing}
            onPointerMove={resize}
            onPointerUp={stopResizing}
            onPointerCancel={stopResizing}
          />
        </>
      )}

      <main className="viewer-main">
        {showReveal && (
          <button
            className="icon-btn sidebar-reveal"
            onClick={() => setIsSidebarOpen(true)}
            title="Show contents"
          >
            <List size={18} weight="bold" />
          </button>
        )}

        {remoteCount > 0 && !withRemoteImages && (
          <div className={`remote-images-bar ${showReveal ? 'with-reveal' : ''}`} role="status">
            <ImageBroken size={16} weight="duotone" className="remote-images-icon" aria-hidden="true" />
            <span className="remote-images-text">
              This document has {remoteCount} {remoteCount === 1 ? 'image' : 'images'} from the internet.
            </span>
            <button type="button" className="remote-images-btn" onClick={() => setRemoteLoadedHere(true)}>
              Load images
            </button>
            <button
              type="button"
              className="remote-images-btn"
              onClick={() => {
                setRemoteLoadedHere(true);
                onAllowRemoteImages?.();
              }}
            >
              Always load
            </button>
          </div>
        )}

        <div className="viewer-doc">
          <PreviewFindBar bodyRef={bodyRef} scrollerRef={contentRef} isVisible={isVisible} />
          <div className="markdown-container" ref={contentRef}>
            <div
              className="markdown-body"
              ref={bodyRef}
              data-doc-path={doc.path ?? ''}
              dangerouslySetInnerHTML={bodyMarkup}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

export default MarkdownView;
