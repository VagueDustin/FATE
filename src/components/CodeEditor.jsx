import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine
} from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  foldGutter, indentOnInput, bracketMatching, foldKeymap,
  syntaxHighlighting, indentUnit, syntaxTree
} from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { detectLanguage } from '../languageDetect.js';
import { tokenHighlightStyle } from '../editorTheme.js';

/**
 * CodeEditor — the code-file counterpart to the markdown viewer.
 *
 * ── Why CodeMirror 6 and not Monaco ───────────────────────────────────────────────────────────
 * Monaco needs web workers and special bundler treatment, and weighs an order of magnitude more.
 * CodeMirror 6 is plain ESM that Vite bundles like any other module, which matters here twice
 * over: FATE is fully offline (no CDN loading), and the renderer is loaded over file:// in
 * production where worker setup is fragile.
 *
 * ── Language support ──────────────────────────────────────────────────────────────────────────
 * `@codemirror/language-data` registers ~150 languages (including PowerShell, batch and the other
 * legacy-mode ones) with *lazy* loaders — `LanguageDescription.matchFilename` picks by filename,
 * and `.load()` dynamically imports just that language's module. Vite turns each into a chunk in
 * `dist/assets/`, so everything still ships inside the app. No file type costs anything until it
 * is actually opened.
 *
 * ── Theming ───────────────────────────────────────────────────────────────────────────────────
 * All colour comes from custom properties (--syn-* and the surface/border/accent tokens), set per
 * theme in brand.css and applied to the .cm-* classes in App.css. The HighlightStyle below emits
 * `var(--syn-…)` as literal CSS values, so a theme switch retunes the highlighted code instantly
 * with NO editor reconfiguration — the same mechanism as the rest of the app, per the token rule.
 * That is also why this file must not contain colour literals.
 *
 * The one CodeMirror default deliberately excluded is `defaultHighlightStyle` (what basicSetup
 * ships): it hard-codes light-theme colours, which is exactly what the token rule exists to keep
 * out. It is replaced wholesale by the style below, not layered under it.
 *
 * ── React integration ─────────────────────────────────────────────────────────────────────────
 * The EditorView is imperative and lives outside React's render cycle. The parent mounts one
 * instance per opened file (keyed remount), and talks to it through the imperative ref — see the
 * handle at the bottom. Per-keystroke state (dirty flag transitions, cursor position) never
 * touches React state except on actual dirty-flag *changes*; the Ln/Col readout is written
 * straight to a status-bar DOM node, following the same rule as the scroll progress bar.
 */

/**
 * Structural syntax diagnostics from the language parser itself.
 *
 * Lezer grammars mark unparseable regions with error nodes — a missing bracket, an unclosed
 * string, a stray token all surface there. Walking the tree for those gives real "your code is
 * broken HERE" underlines for every tree-based language (JavaScript, TypeScript, HTML, CSS,
 * JSON, Python, …) with zero per-language lint dependencies. Stream-parsed legacy modes
 * (PowerShell, shell, batch) never produce error nodes, so they simply report nothing — no false
 * positives.
 *
 * Zero-length error nodes (very common: "something is missing here") are widened by a character
 * so the underline has somewhere to live.
 */
const syntaxErrorLinter = linter(
  (view) => {
    const diagnostics = [];
    syntaxTree(view.state)
      .cursor()
      .iterate((node) => {
        if (!node.type.isError || diagnostics.length >= 200) return;
        const from = node.from === node.to ? Math.max(0, node.from - 1) : node.from;
        const to = node.from === node.to ? Math.min(view.state.doc.length, node.to + 1) : node.to;
        diagnostics.push({
          from,
          to,
          severity: 'error',
          message: 'Syntax error — unexpected or missing token'
        });
      });
    return diagnostics;
  },
  { delay: 400 }
);

const CodeEditor = forwardRef(function CodeEditor(
  { fileName, initialContent, wrap, tabSize, onDirtyChange, onSave, onDocChanged, cursorLabelRef, isActive = true, lint = true },
  ref
) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  /** The document as of the last save (a CM Text). Dirty = current doc !== this. */
  const savedDocRef = useRef(null);
  const dirtyRef = useRef(false);
  /*
   * Tabs: several editors stay mounted at once, but the status bar has ONE Ln/Col node. Only the
   * visible tab may write to it — a background tab receiving a live-reload must not clobber the
   * readout of the tab the user is looking at.
   */
  const isActiveRef = useRef(isActive);

  // Latest callbacks, readable from extensions without rebuilding the editor state.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  /** Fires on every doc change (markdown edit mode debounces it into a live preview render). */
  const onDocChangedRef = useRef(onDocChanged);
  onDocChangedRef.current = onDocChanged;

  // Compartments let individual facets be swapped at runtime (settings changes, async language
  // load) without touching the rest of the editor state.
  const languageCompartment = useRef(new Compartment()).current;
  const wrapCompartment = useRef(new Compartment()).current;
  const tabSizeCompartment = useRef(new Compartment()).current;
  const lintCompartment = useRef(new Compartment()).current;

  const setDirty = (dirty) => {
    if (dirty !== dirtyRef.current) {
      dirtyRef.current = dirty;
      onDirtyChangeRef.current?.(dirty);
    }
  };

  /*
   * One EditorView per mount. The parent keys this component on its open counter, so opening a
   * file (including re-opening the same path) gets a clean editor with fresh undo history.
   * `initialContent`/`fileName` are read once here by design — hence their absence from the
   * dependency list.
   */
  const writeCursor = useCallback(
    (state) => {
      const el = cursorLabelRef?.current;
      if (!el || !isActiveRef.current) return;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      // Direct DOM write — this updates on every keystroke and must not re-render the app.
      el.textContent = `Ln ${line.number}, Col ${head - line.from + 1}`;
    },
    [cursorLabelRef]
  );

  /* Becoming the visible tab: reclaim the Ln/Col readout and take focus. */
  useEffect(() => {
    isActiveRef.current = isActive;
    if (isActive && viewRef.current) {
      writeCursor(viewRef.current.state);
      viewRef.current.focus();
    }
  }, [isActive, writeCursor]);

  useEffect(() => {

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(tokenHighlightStyle),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        languageCompartment.of([]),
        lintCompartment.of(lint ? [syntaxErrorLinter, lintGutter()] : []),
        wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
        tabSizeCompartment.of([
          EditorState.tabSize.of(tabSize),
          indentUnit.of(' '.repeat(tabSize))
        ]),
        keymap.of([
          // Save first so it wins over anything else bound to Mod-s.
          {
            key: 'Mod-s',
            run: () => {
              onSaveRef.current?.();
              return true;
            }
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            setDirty(!update.state.doc.eq(savedDocRef.current));
            onDocChangedRef.current?.();
          }
          if (update.selectionSet || update.docChanged) {
            writeCursor(update.state);
          }
        })
      ]
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    savedDocRef.current = state.doc;
    writeCursor(state);

    // Load the language for this filename asynchronously; plain text until (and unless) it lands.
    const langDesc = detectLanguage(fileName);
    let cancelled = false;
    if (langDesc) {
      langDesc.load().then(
        (support) => {
          if (!cancelled && viewRef.current) {
            viewRef.current.dispatch({ effects: languageCompartment.reconfigure(support) });
          }
        },
        (err) => console.error(`Failed to load language ${langDesc.name}:`, err)
      );
    }

    if (isActiveRef.current) view.focus();

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Settings changes retune the live editor through compartments — no rebuild, no history loss. */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : [])
    });
  }, [wrap, wrapCompartment]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: tabSizeCompartment.reconfigure([
        EditorState.tabSize.of(tabSize),
        indentUnit.of(' '.repeat(tabSize))
      ])
    });
  }, [tabSize, tabSizeCompartment]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lintCompartment.reconfigure(lint ? [syntaxErrorLinter, lintGutter()] : [])
    });
  }, [lint, lintCompartment]);

  useImperativeHandle(
    ref,
    () => ({
      /** Current buffer contents — what Save writes to disk. */
      getContent: () => viewRef.current?.state.doc.toString() ?? '',

      /** The buffer as of the last save (or open) — the baseline "diff unsaved changes" compares against. */
      getSavedContent: () => savedDocRef.current?.toString() ?? '',

      /** Call after a successful save: the current doc becomes the clean reference point. */
      markSaved: () => {
        if (!viewRef.current) return;
        savedDocRef.current = viewRef.current.state.doc;
        setDirty(false);
      },

      /**
       * Replace the buffer with content reloaded from disk (external change, clean editor only —
       * the caller checks). A whole-document change rather than a remount, so the undo history
       * survives and the selection is mapped instead of reset.
       */
      replaceContent: (text) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text }
        });
        savedDocRef.current = view.state.doc;
        setDirty(false);
      },

      isDirty: () => dirtyRef.current,
      focus: () => viewRef.current?.focus(),

      /**
       * Re-detect and load the language for a (new) filename — used after Save As gives an
       * untitled buffer a real extension. Reconfigures the language compartment in place, so the
       * buffer, cursor and undo history all survive the rename.
       */
      setLanguage: (newFileName) => {
        const langDesc = detectLanguage(newFileName);
        if (!langDesc) {
          viewRef.current?.dispatch({ effects: languageCompartment.reconfigure([]) });
          return;
        }
        langDesc.load().then(
          (support) => {
            viewRef.current?.dispatch({ effects: languageCompartment.reconfigure(support) });
          },
          (err) => console.error(`Failed to load language ${langDesc.name}:`, err)
        );
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return <div className="code-editor" ref={hostRef} />;
});

export default CodeEditor;
