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
import { changedSpan } from '../textSpan.js';

/**
 * CodeEditor: the code-file counterpart to the markdown viewer.
 *
 * ── Why CodeMirror 6 and not Monaco ───────────────────────────────────────────────────────────
 * Monaco needs web workers and special bundler treatment, and weighs an order of magnitude more.
 * CodeMirror 6 is plain ESM that Vite bundles like any other module, which matters here twice
 * over: FATE is fully offline (no CDN loading), and the renderer is loaded over file:// in
 * production where worker setup is fragile.
 *
 * ── Language support ──────────────────────────────────────────────────────────────────────────
 * `@codemirror/language-data` registers ~150 languages (including PowerShell, batch and the other
 * legacy-mode ones) with *lazy* loaders: `LanguageDescription.matchFilename` picks by filename,
 * and `.load()` dynamically imports just that language's module. Vite turns each into a chunk in
 * `dist/assets/`, so everything still ships inside the app. No file type costs anything until it
 * is actually opened.
 *
 * ── Theming ───────────────────────────────────────────────────────────────────────────────────
 * All colour comes from custom properties (--syn-* and the surface/border/accent tokens), set per
 * theme in brand.css and applied to the .cm-* classes in App.css. The HighlightStyle below emits
 * `var(--syn-…)` as literal CSS values, so a theme switch retunes the highlighted code instantly
 * with NO editor reconfiguration, the same mechanism as the rest of the app, per the token rule.
 * That is also why this file must not contain colour literals.
 *
 * The one CodeMirror default deliberately excluded is `defaultHighlightStyle` (what basicSetup
 * ships): it hard-codes light-theme colours, which is exactly what the token rule exists to keep
 * out. It is replaced wholesale by the style below, not layered under it.
 *
 * ── React integration ─────────────────────────────────────────────────────────────────────────
 * The EditorView is imperative and lives outside React's render cycle. The parent mounts one
 * instance per opened file (keyed remount), and talks to it through the imperative ref; see the
 * handle at the bottom. Per-keystroke state (dirty flag transitions, cursor position) never
 * touches React state except on actual dirty-flag *changes*; the Ln/Col readout is written
 * straight to a status-bar DOM node, following the same rule as the scroll progress bar.
 *
 * ── Dirty baseline (1.14.0) ───────────────────────────────────────────────────────────────────
 * "Dirty" means the buffer differs from the BASELINE: the text last known to be on disk. It is
 * `savedContent` when the parent passes one, else the initial content. Up to 1.13.4 it was always
 * the initial content, so a Markdown tab coming back into Edit mode with unsaved text took that
 * text as saved: Ctrl+W closed it without a prompt, quitting skipped it, and Diff found nothing.
 * Every path that moves the baseline (save, reload, the changed-on-disk choices) goes through
 * the handle, so isDirty(), getSavedContent() and the guards built on them always agree.
 */

const MAX_SYNTAX_DIAGNOSTICS = 200;

/**
 * Structural syntax diagnostics from the language parser itself.
 *
 * Lezer grammars mark unparseable regions with error nodes. A missing bracket, an unclosed
 * string, a stray token all surface there. Walking the tree for those gives real "your code is
 * broken HERE" underlines for every tree-based language (JavaScript, TypeScript, HTML, CSS,
 * JSON, Python, …) with zero per-language lint dependencies. Stream-parsed legacy modes
 * (PowerShell, shell, batch) never produce error nodes, so they simply report nothing, with no false
 * positives.
 *
 * Zero-length error nodes (very common: "something is missing here") are widened by a character
 * so the underline has somewhere to live.
 *
 * The walk is a plain cursor loop so the cap really ends it. It used to be `iterate()` with an
 * early `return`, which only skips the current node's children: past 200 errors the linter still
 * visited every remaining node of the tree on each pass (M8).
 */
const syntaxErrorLinter = linter(
  (view) => {
    const diagnostics = [];
    const cursor = syntaxTree(view.state).cursor();
    do {
      if (!cursor.type.isError) continue;
      const from = cursor.from === cursor.to ? Math.max(0, cursor.from - 1) : cursor.from;
      const to = cursor.from === cursor.to ? Math.min(view.state.doc.length, cursor.to + 1) : cursor.to;
      diagnostics.push({
        from,
        to,
        severity: 'error',
        message: 'Syntax error: unexpected or missing token'
      });
      if (diagnostics.length >= MAX_SYNTAX_DIAGNOSTICS) break;
    } while (cursor.next());
    return diagnostics;
  },
  { delay: 400 }
);

/*
 * Syntax checking runs only where it can be right: the setting is on, the file is not in
 * large-file mode, and the language came from the FILE NAME. A language guessed from the content
 * can be wrong (a log whose lines start with "[" sniffs as JSON), and then every line of it was
 * underlined as an error (M8).
 */
const lintExtensions = (lint, largeFile, nameMatched) =>
  lint && !largeFile && nameMatched ? [syntaxErrorLinter, lintGutter()] : [];

/*
 * Props beyond the obvious:
 *   savedContent  the baseline text when it differs from initialContent (see "Dirty baseline")
 *   largeFile     large-file mode, fixed at mount: no lint, bracket matching, autocompletion or
 *                 selection-match highlighting, the extensions whose cost grows with the file
 *   plainText     never load a language (a Markdown file too big to render opens as plain text)
 */
const CodeEditor = forwardRef(function CodeEditor(
  {
    fileName, initialContent, savedContent, wrap, tabSize, onDirtyChange, onSave, onDocChanged,
    cursorLabelRef, isActive = true, lint = true, largeFile = false, plainText = false
  },
  ref
) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  /** The baseline (a CM Text): the text last known to be on disk. Dirty = current doc ≠ this. */
  const savedDocRef = useRef(null);
  /** getSavedContent's string, cached per baseline (the hot-exit backups ask for it repeatedly). */
  const savedTextRef = useRef({ doc: null, text: '' });
  const dirtyRef = useRef(false);
  /** True while replaceContent dispatches: it sets the baseline itself, right after. */
  const replacingRef = useRef(false);
  /*
   * Tabs: several editors stay mounted at once, but the status bar has ONE Ln/Col node. Only the
   * visible tab may write to it; a background tab receiving a live-reload must not clobber the
   * readout of the tab the user is looking at.
   */
  const isActiveRef = useRef(isActive);
  /** Fixed at mount like largeFile; read by setLanguage after a Save As. */
  const plainTextRef = useRef(plainText);
  /** Did the file NAME pick the language (not a content sniff)? Gates syntax checking. */
  const nameMatchedRef = useRef(false);
  /** The lint inputs as last rendered, for setLanguage to reapply them under a new name. */
  const lintPropsRef = useRef({ lint, largeFile });

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

  /** Point the baseline at `text`, sharing the live doc when they are equal (cheap comparisons). */
  const setBaselineText = (view, text) => {
    const doc = view.state.doc;
    const next = view.state.toText(text);
    savedDocRef.current = doc.eq(next) ? doc : next;
    setDirty(!doc.eq(savedDocRef.current));
  };

  /*
   * One EditorView per mount. The parent keys this component on its open counter, so opening a
   * file (including re-opening the same path) gets a clean editor with fresh undo history.
   * `initialContent`/`savedContent`/`fileName`/`largeFile`/`plainText` are read once here by
   * design, hence their absence from the dependency list.
   */
  const writeCursor = useCallback(
    (state) => {
      const el = cursorLabelRef?.current;
      if (!el || !isActiveRef.current) return;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      // Direct DOM write: this updates on every keystroke and must not re-render the app.
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
    nameMatchedRef.current = !plainText && !!detectLanguage(fileName);

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
        ...(largeFile ? [] : [bracketMatching(), closeBrackets(), autocompletion()]),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        ...(largeFile ? [] : [highlightSelectionMatches()]),
        languageCompartment.of([]),
        lintCompartment.of(lintExtensions(lint, largeFile, nameMatchedRef.current)),
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
          ...(largeFile ? [] : closeBracketsKeymap),
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...(largeFile ? [] : completionKeymap),
          indentWithTab
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            if (!replacingRef.current) setDirty(!update.state.doc.eq(savedDocRef.current));
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
    // The baseline. A different savedContent (unsaved text coming back into Edit mode, a restored
    // backup) means the editor starts dirty, and says so at once.
    savedDocRef.current =
      savedContent == null || savedContent === initialContent ? state.doc : state.toText(savedContent);
    if (!state.doc.eq(savedDocRef.current)) setDirty(true);
    writeCursor(state);

    // Load the language for this filename asynchronously; plain text until (and unless) it lands.
    // The content rides along so an unknown extension can still be sniffed (web.config → XML).
    const langDesc = plainText ? null : detectLanguage(fileName, initialContent);
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

  /* Settings changes retune the live editor through compartments: no rebuild, no history loss. */
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
    lintPropsRef.current = { lint, largeFile };
    viewRef.current?.dispatch({
      effects: lintCompartment.reconfigure(lintExtensions(lint, largeFile, nameMatchedRef.current))
    });
  }, [lint, largeFile, lintCompartment]);

  useImperativeHandle(
    ref,
    () => ({
      /** The live EditorView (for scroll sync, go-to-line and the like), or null once destroyed. */
      getView: () => viewRef.current,

      /** Current buffer contents: what Save writes to disk. */
      getContent: () => viewRef.current?.state.doc.toString() ?? '',

      /**
       * The document itself (an immutable CM Text), for a save to snapshot BEFORE it awaits the
       * write: whatever is typed while the write is in flight is not in this snapshot (M4).
       */
      getDocSnapshot: () => viewRef.current?.state.doc ?? null,

      /** The baseline as a CM Text. Identity changes exactly when the baseline moves. */
      getSavedDoc: () => savedDocRef.current,

      /** The baseline as text: what "Diff unsaved changes" compares against. */
      getSavedContent: () => {
        const doc = savedDocRef.current;
        if (!doc) return '';
        if (savedTextRef.current.doc !== doc) savedTextRef.current = { doc, text: doc.toString() };
        return savedTextRef.current.text;
      },

      /**
       * A save landed. The baseline becomes `snapshot` (the doc as it was when the save read it)
       * or, without one, the current doc. Keys pressed during the write leave the tab dirty.
       */
      markSaved: (snapshot) => {
        const view = viewRef.current;
        if (!view) return;
        savedDocRef.current = snapshot ?? view.state.doc;
        setDirty(!view.state.doc.eq(savedDocRef.current));
      },

      /** Move the baseline without touching the buffer (keep my version, file deleted, …). */
      setBaseline: (text) => {
        const view = viewRef.current;
        if (view) setBaselineText(view, text);
      },

      /**
       * Put `text` in the buffer: a reload from disk, a restored backup, a reopened encoding.
       * Only the span that differs is replaced (identical text is not touched at all), so the
       * caret, selection and folds map through the change, and undo history survives (M5).
       * The baseline becomes `baseline`, by default the new text itself (a reload: clean).
       */
      replaceContent: (text, baseline) => {
        const view = viewRef.current;
        if (!view) return;
        const span = changedSpan(view.state.doc.toString(), text);
        if (span) {
          replacingRef.current = true;
          try {
            view.dispatch({ changes: span });
          } finally {
            replacingRef.current = false;
          }
        }
        if (baseline === undefined) {
          savedDocRef.current = view.state.doc;
          setDirty(false);
        } else {
          setBaselineText(view, baseline);
        }
      },

      /** Log following: bring the end of the document into view. */
      scrollToEnd: () => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'end' }) });
      },

      isDirty: () => dirtyRef.current,
      focus: () => viewRef.current?.focus(),

      /**
       * Re-detect and load the language for a (new) filename. Used after Save As gives an
       * untitled buffer a real extension. Reconfigures the language compartment in place, so the
       * buffer, cursor and undo history all survive the rename.
       */
      setLanguage: (newFileName) => {
        if (plainTextRef.current) return;
        nameMatchedRef.current = !!detectLanguage(newFileName);
        const { lint: lintOn, largeFile: large } = lintPropsRef.current;
        viewRef.current?.dispatch({
          effects: lintCompartment.reconfigure(lintExtensions(lintOn, large, nameMatchedRef.current))
        });
        const langDesc = detectLanguage(newFileName, viewRef.current?.state.doc.sliceString(0, 2048));
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
