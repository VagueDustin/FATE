import { useEffect, useRef } from 'react';

/**
 * usePreviewScrollSync: in Markdown edit mode, scrolling the source scrolls the live preview to
 * the same place. One way only, editor → preview; the preview can still be scrolled on its own.
 *
 * renderMarkdown marks each top-level rendered block with the source line it starts on
 * (`data-line`, 0-based; see markdown.js). On each scroll frame the editor's top visible line,
 * fractional within a wrapped line, is placed between the two blocks around it and the preview
 * scrolled to the interpolated point, so a long paragraph or code block scrolls smoothly rather
 * than in block-sized jumps. With no annotated blocks (nothing lined up) it does nothing.
 *
 * Hot path rules as for the reading view: one rAF in flight, a passive listener, direct
 * scrollTop writes, no React state. The block list is cached per render of the preview and
 * rebuilt when a block it holds has been replaced (a Mermaid diagram landing).
 */

/** Blocks with a source line, in document order, lines never decreasing; hidden ones skipped. */
function collectBlocks(preview) {
  const lines = [];
  const els = [];
  let last = -1;
  for (const el of preview.querySelectorAll('.markdown-body [data-line]')) {
    const line = Number(el.getAttribute('data-line'));
    if (!(line >= last) || !el.getClientRects().length) continue;
    lines.push(line);
    els.push(el);
    last = line;
  }
  return { lines, els };
}

function syncPreview(view, preview, cache) {
  const scroller = view.scrollDOM;
  const max = preview.scrollHeight - preview.clientHeight;
  if (max <= 0) return;
  // Pinned ends: the top of the source shows the top of the preview, the end shows the end.
  if (scroller.scrollTop <= 0) {
    preview.scrollTop = 0;
    return;
  }
  if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1) {
    preview.scrollTop = max;
    return;
  }

  // The source line at the top edge of the editor, with how far into it (wrapped lines are tall).
  const height = Math.max(0, scroller.getBoundingClientRect().top - view.documentTop);
  const lineBlock = view.lineBlockAtHeight(height);
  const into = lineBlock.height > 0 ? Math.min(1, Math.max(0, (height - lineBlock.top) / lineBlock.height)) : 0;
  const line = view.state.doc.lineAt(lineBlock.from).number - 1 + into;

  if (!cache.current || cache.current.els.some((el) => !el.isConnected)) cache.current = collectBlocks(preview);
  const { lines, els } = cache.current;
  if (!lines.length) return;

  // The last block starting at or before `line`.
  let lo = 0;
  let hi = lines.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid] <= line) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // y in the preview's content coordinates.
  const origin = preview.getBoundingClientRect().top - preview.scrollTop;
  const top = (el) => el.getBoundingClientRect().top - origin;
  let fromLine, toLine, fromY, toY;
  if (i < 0) {
    [fromLine, fromY] = [0, 0];
    [toLine, toY] = [lines[0], top(els[0])];
  } else if (i === lines.length - 1) {
    [fromLine, fromY] = [lines[i], top(els[i])];
    [toLine, toY] = [view.state.doc.lines, els[i].getBoundingClientRect().bottom - origin];
  } else {
    [fromLine, fromY] = [lines[i], top(els[i])];
    [toLine, toY] = [lines[i + 1], top(els[i + 1])];
  }
  const t = toLine > fromLine ? (line - fromLine) / (toLine - fromLine) : 0;
  preview.scrollTop = Math.min(max, Math.max(0, fromY + (toY - fromY) * Math.min(1, t)));
}

/**
 * `editorRef` is CodeEditor's handle (its `getView()`), `previewRef` the scrolling preview element,
 * `html` the preview's current markup (a change lines the preview up again).
 */
export function usePreviewScrollSync(editorRef, previewRef, html) {
  const scheduleRef = useRef(null);
  const blocksRef = useRef(null);

  useEffect(() => {
    const view = editorRef.current?.getView?.();
    const preview = previewRef.current;
    if (!view || !preview) return;
    let raf = null;
    const schedule = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (preview.checkVisibility()) syncPreview(view, preview, blocksRef);
      });
    };
    scheduleRef.current = schedule;
    view.scrollDOM.addEventListener('scroll', schedule, { passive: true });
    // Images and diagrams arriving later change the preview's height: line it up again.
    const body = preview.querySelector('.markdown-body');
    const resizes = body ? new ResizeObserver(schedule) : null;
    if (body) resizes.observe(body);
    return () => {
      view.scrollDOM.removeEventListener('scroll', schedule);
      resizes?.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
      scheduleRef.current = null;
    };
  }, [editorRef, previewRef]);

  useEffect(() => {
    blocksRef.current = null;
    scheduleRef.current?.();
  }, [html]);
}
