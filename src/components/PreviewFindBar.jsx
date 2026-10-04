import { useState, useEffect, useRef, useCallback } from 'react';
import { CaretUp, CaretDown, X } from '@phosphor-icons/react';
import {
  MAX_PAINTED,
  buildTextIndex,
  clearMatches,
  findMatches,
  findTargetBody,
  foldQuery,
  isEditableTarget,
  isModalOpen,
  paintMatches,
  rangeAt,
  revealRange
} from '../previewFind.js';

/**
 * PreviewFindBar: find in one reading view (see previewFind.js for the engine and Ctrl+F).
 *
 * Its own component, holding its own state, so typing a query re-renders this bar and not the
 * whole MarkdownView. The text index is built once per version of the document and rebuilt when
 * the document changes under it (a reload from disk, a diagram landing), which a MutationObserver
 * on the body reports.
 *
 * Escape closes the bar and must not reach App, where Escape is bound to closing the tab: the
 * input stops it, and while the bar is open a document-level listener (which runs before App's
 * window listener) does the same when focus is elsewhere in this view.
 */
function PreviewFindBar({ bodyRef, scrollerRef, isVisible }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState({ total: 0, current: -1 });
  /** Bumped by every Ctrl+F / `fate:find` aimed at this view: (re)focus and select the query. */
  const [focusRequest, setFocusRequest] = useState(0);
  const inputRef = useRef(null);
  const ownerRef = useRef(Symbol('find'));
  /** { index, starts, length, current } for the query on screen. */
  const searchRef = useRef(null);
  const indexRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    clearMatches(ownerRef.current);
    searchRef.current = null;
  }, []);

  /** Paint every match, mark the current one, and optionally bring it into view. */
  const show = useCallback(
    (reveal) => {
      const s = searchRef.current;
      if (!s) return;
      const painted = s.starts.slice(0, MAX_PAINTED).map((start) => rangeAt(s.index, start, s.length));
      const current = s.current >= 0 ? rangeAt(s.index, s.starts[s.current], s.length) : null;
      paintMatches(ownerRef.current, painted, current);
      setStatus({ total: s.starts.length, current: s.current });
      if (reveal && current && scrollerRef.current) revealRange(current, scrollerRef.current);
    },
    [scrollerRef]
  );

  /**
   * Search the body for `q`. The current match starts at the first one at or below the top of the
   * view, as in a browser, rather than back at the top of the document.
   */
  const search = useCallback(
    (q, reveal) => {
      const body = bodyRef.current;
      const scroller = scrollerRef.current;
      if (!body || !scroller) return;
      if (!indexRef.current) indexRef.current = buildTextIndex(body);
      const index = indexRef.current;
      const folded = foldQuery(q);
      const starts = findMatches(index, folded);
      // Binary search: matches are in document order, so their tops only grow.
      const viewTop = scroller.getBoundingClientRect().top;
      let lo = 0;
      let hi = starts.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rangeAt(index, starts[mid], folded.length).getBoundingClientRect().top >= viewTop) hi = mid;
        else lo = mid + 1;
      }
      // Nothing below the view: wrap to the first match.
      const current = starts.length ? (lo < starts.length ? lo : 0) : -1;
      searchRef.current = { index, starts, length: folded.length, current };
      show(reveal);
    },
    [bodyRef, scrollerRef, show]
  );

  const step = useCallback(
    (dir) => {
      const s = searchRef.current;
      if (!s || !s.starts.length) return;
      s.current = (s.current + dir + s.starts.length) % s.starts.length;
      show(true);
    },
    [show]
  );

  // Open (or re-focus) on Ctrl+F / `fate:find`, when this is the view being read.
  useEffect(() => {
    const onFind = () => {
      if (!isVisible || !bodyRef.current || findTargetBody() !== bodyRef.current) return;
      setOpen(true);
      setFocusRequest((n) => n + 1);
    };
    window.addEventListener('fate:find', onFind);
    return () => window.removeEventListener('fate:find', onFind);
  }, [isVisible, bodyRef]);

  // After the bar has rendered: the input only exists once `open` has been committed.
  useEffect(() => {
    if (!open || !focusRequest) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, focusRequest]);

  // Typing: search after a short pause (a large document takes a moment to index).
  useEffect(() => {
    if (!open) return;
    if (!query) {
      // Nothing to show; the stale count is hidden while the query is empty (see below).
      searchRef.current = null;
      clearMatches(ownerRef.current);
      return;
    }
    const t = setTimeout(() => search(query, true), 60);
    return () => clearTimeout(t);
  }, [open, query, search]);

  // The document changed under the bar: rebuild the index and search again, without scrolling.
  useEffect(() => {
    const body = bodyRef.current;
    if (!open || !body) return;
    let timer = null;
    const observer = new MutationObserver(() => {
      indexRef.current = null;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (searchRef.current || inputRef.current?.value) search(inputRef.current?.value ?? '', false);
      }, 150);
    });
    observer.observe(body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [open, bodyRef, search]);

  // A fresh index for each opening; nothing painted is left behind on unmount.
  useEffect(() => {
    if (!open) indexRef.current = null;
  }, [open]);
  useEffect(() => {
    const owner = ownerRef.current;
    return () => clearMatches(owner);
  }, []);

  // Escape with focus elsewhere in this view (the document, the contents) closes the bar, not the tab.
  useEffect(() => {
    if (!open || !isVisible) return;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isModalOpen() || isEditableTarget(e.target)) return;
      if (findTargetBody() !== bodyRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, isVisible, bodyRef, close]);

  if (!open) return null;

  const onInputKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter right after typing, before the pause has run the search: search now.
      if (!searchRef.current && query) search(query, true);
      else step(e.shiftKey ? -1 : 1);
    }
  };

  const total = query ? status.total : 0;
  let count = '';
  if (query && total === 0) count = 'No matches';
  else if (total > 0) count = `${status.current + 1} of ${total.toLocaleString()}`;

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        className="find-input"
        type="text"
        value={query}
        placeholder="Find in document"
        aria-label="Find in document"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onInputKeyDown}
      />
      <span className={`find-count ${query && total === 0 ? 'none' : ''}`} aria-live="polite">
        {count}
      </span>
      <button type="button" className="icon-btn" onClick={() => step(-1)} disabled={total === 0} title="Previous match (Shift+Enter)" aria-label="Previous match">
        <CaretUp size={14} weight="bold" />
      </button>
      <button type="button" className="icon-btn" onClick={() => step(1)} disabled={total === 0} title="Next match (Enter)" aria-label="Next match">
        <CaretDown size={14} weight="bold" />
      </button>
      <button type="button" className="icon-btn" onClick={close} title="Close (Esc)" aria-label="Close find">
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}

export default PreviewFindBar;
