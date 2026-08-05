import { useEffect, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorView, lineNumbers, highlightSpecialChars } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { syntaxHighlighting } from '@codemirror/language';
import { tokenHighlightStyle } from '../editorTheme.js';
import { detectLanguage } from '../languageDetect.js';

/**
 * DiffView — the split view's "Diff" mode: a CodeMirror MergeView comparing the two panes'
 * buffers side by side, chunk-aligned with change highlighting.
 *
 * Read-only by design: this is a review surface. The buffers are SNAPSHOTS taken when diff mode
 * was entered — the live editors keep their state untouched underneath and everything (cursor,
 * undo, dirty flags) is exactly as it was when diff mode toggles off.
 *
 * Colours: the merge chunk backgrounds are styled in App.css from the status/accent tokens, and
 * syntax highlighting reuses the shared token HighlightStyle — a diff looks native in any theme.
 */
function DiffView({ leftText, rightText, leftName, rightName }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const shared = () => [
      lineNumbers(),
      highlightSpecialChars(),
      syntaxHighlighting(tokenHighlightStyle),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.lineWrapping
    ];

    const view = new MergeView({
      a: { doc: leftText, extensions: shared() },
      b: { doc: rightText, extensions: shared() },
      parent: hostRef.current,
      collapseUnchanged: { margin: 3, minSize: 6 },
      highlightChanges: true,
      gutter: true
    });

    /*
     * Language support is loaded async per side (it may be a lazy chunk); dispatched into the
     * merge editors when it lands. appendConfig avoids rebuilding the MergeView.
     */
    let cancelled = false;
    const loadLang = (name, editor) => {
      const desc = detectLanguage(name);
      if (!desc) return;
      desc.load().then(
        (support) => {
          if (!cancelled) {
            editor.dispatch({ effects: EditorState.appendConfig.of(support) });
          }
        },
        () => {}
      );
    };
    loadLang(leftName, view.a);
    loadLang(rightName, view.b);

    return () => {
      cancelled = true;
      view.destroy();
    };
  }, [leftText, rightText, leftName, rightName]);

  return (
    <div className="diff-view">
      <div className="diff-titles">
        <span className="diff-title">{leftName}</span>
        <span className="diff-title">{rightName}</span>
      </div>
      <div className="diff-host" ref={hostRef} />
    </div>
  );
}

export default DiffView;
