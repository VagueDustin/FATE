import { useState, useEffect, useRef, useCallback } from 'react';
import { List } from '@phosphor-icons/react';

/**
 * MarkdownView — one markdown tab's pane: TOC sidebar, resizer, and the scrolling document.
 *
 * Extracted from App.jsx when tabs arrived: each markdown tab needs its own scroll position,
 * heading cache, active-heading highlight and sidebar state, and encapsulating them here means N
 * tabs get that for free. The pane stays mounted (hidden) while inactive, so switching tabs
 * preserves scroll position exactly.
 *
 * ── Scroll performance (see AI_CONTEXT.md §5a — do not regress) ───────────────────────────────
 * The rules from the single-document era carry over verbatim:
 *   - the progress bar/label are written straight to the DOM via refs, never via state;
 *   - headings are cached once per document, not queried per frame;
 *   - the active heading is compared against a ref so setState fires only on real changes,
 *     and the scroll effect must NOT depend on `activeHeading`;
 *   - one rAF in flight at a time; listener registered { passive: true }.
 * The one tab-era addition: progress writes are gated on `isActive` — the global progress bar and
 * "% read" belong to the visible tab, and a background tab must not fight it for the DOM node.
 */
function MarkdownView({ doc, isActive, sidebarWidth, onSidebarWidthChange, progressBarRef, progressLabelRef }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(doc.toc.length > 0);
  const [activeHeading, setActiveHeading] = useState('');

  const contentRef = useRef(null);
  const headingsRef = useRef([]);
  const activeHeadingRef = useRef('');
  const scrollRafIdRef = useRef(null);
  const isActiveRef = useRef(isActive);
  const isResizing = useRef(false);

  /*
   * Re-evaluate the sidebar when the document's content is replaced (external reload) — the
   * render-time adjustment pattern, not an effect, so there is no flash of the stale state.
   */
  const [lastHtml, setLastHtml] = useState(doc.html);
  if (lastHtml !== doc.html) {
    setLastHtml(doc.html);
    setIsSidebarOpen(doc.toc.length > 0);
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

  const resize = useCallback(
    (e) => {
      if (isResizing.current) {
        let newWidth = e.clientX;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > window.innerWidth * 0.5) newWidth = window.innerWidth * 0.5;
        onSidebarWidthChange(newWidth);
      }
    },
    [onSidebarWidthChange]
  );

  /*
   * Scroll progress + active-heading tracking. Runs whenever the content changes AND whenever the
   * tab becomes active (deps below) — the latter so the global progress bar snaps to THIS tab's
   * position on switch instead of showing the previous tab's number until the first scroll.
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

        const headings = headingsRef.current;
        const triggerPoint = window.innerHeight * 0.4;
        let currentActive = activeHeadingRef.current;

        for (const h of headings) {
          if (h.getBoundingClientRect().top <= triggerPoint) {
            currentActive = h.id;
          } else {
            break;
          }
        }

        // Before the first heading scrolls past the trigger point, highlight it anyway so the TOC
        // is never blank at the top of a document.
        if (headings.length > 0 && currentActive === '' &&
            headings[0].getBoundingClientRect().top > triggerPoint) {
          currentActive = headings[0].id;
        }

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
  }, [doc.html, isActive, progressBarRef, progressLabelRef]);

  const scrollToHeading = (id) => {
    const container = contentRef.current;
    const element = container?.querySelector(`#${CSS.escape(id)}`);
    if (element && container) {
      container.scrollTo({ top: element.offsetTop - 40, behavior: 'smooth' });
    }
  };

  /*
   * Mermaid diagrams. ```mermaid fences arrive as <pre><code class="language-mermaid"> — this
   * effect lazily imports the mermaid renderer (its own ~1 MB chunk, loaded only when a document
   * actually contains a diagram, and still fully offline) and swaps each fence for its SVG.
   * The `data-mermaid-done` guard makes the pass idempotent under StrictMode's double-invoke.
   */
  useEffect(() => {
    if (!doc.hasMermaid || !contentRef.current) return;
    let cancelled = false;

    (async () => {
      const { default: mermaid } = await import('mermaid');
      if (cancelled || !contentRef.current) return;

      const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isLightTheme ? 'default' : 'dark',
        fontFamily: 'inherit'
      });

      const fences = contentRef.current.querySelectorAll(
        'code.language-mermaid:not([data-mermaid-done])'
      );
      for (const [i, code] of [...fences].entries()) {
        code.setAttribute('data-mermaid-done', '1');
        const source = code.textContent;
        try {
          const { svg } = await mermaid.render(`fate-mermaid-${doc.id}-${i}-${Date.now()}`, source);
          if (cancelled) return;
          const holder = document.createElement('div');
          holder.className = 'mermaid-diagram';
          holder.innerHTML = svg;
          code.closest('pre')?.replaceWith(holder);
        } catch (err) {
          // Invalid diagram source: leave the fence as highlighted text rather than erroring out.
          console.error('Mermaid diagram failed to render:', err?.message || err);
        }
      }
    })().catch((err) => {
      // A failed renderer load must be visible, not a silently missing diagram.
      console.error('Mermaid failed to load:', err?.message || err);
    });

    return () => {
      cancelled = true;
    };
  }, [doc.html, doc.hasMermaid, doc.id]);

  return (
    <div className="viewer-layout">
      {doc.toc.length > 0 && isSidebarOpen && (
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
              {doc.toc.map((item) => (
                <li
                  key={item.id}
                  className={`toc-level-${item.level} ${activeHeading === item.id ? 'active' : ''}`}
                  onClick={() => scrollToHeading(item.id)}
                  dangerouslySetInnerHTML={{ __html: item.html }}
                />
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
        {doc.toc.length > 0 && !isSidebarOpen && (
          <button
            className="icon-btn sidebar-reveal"
            onClick={() => setIsSidebarOpen(true)}
            title="Show contents"
          >
            <List size={18} weight="bold" />
          </button>
        )}

        <div className="markdown-container" ref={contentRef}>
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </div>
      </main>
    </div>
  );
}

export default MarkdownView;
