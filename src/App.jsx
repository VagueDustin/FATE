import { useState, useEffect, useRef, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  UploadSimple, FileText, FileCode, CircleNotch, Gear, X, Plus, House, FilePlus,
  Printer, FilePdf, FloppyDisk, FolderOpen, ClockCounterClockwise, CheckCircle, Trash,
  Warning, PencilSimple, Eye, SquareSplitHorizontal, GitDiff, Palette, Keyboard,
  ArrowsOutSimple, MagnifyingGlass
} from '@phosphor-icons/react';
import fateLogo from './assets/FATE-Square-Icon.png';
import Starfield from './components/Starfield.jsx';
import CodeEditor from './components/CodeEditor.jsx';
import MarkdownView from './components/MarkdownView.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import DiffView from './components/DiffView.jsx';
import { renderMarkdown } from './markdown.js';
import { detectLanguage } from './languageDetect.js';
import { fileKindForName, isSupportedFileName } from './fileKinds.js';
import { resolveFonts, applyFonts, editorFontFor, DEFAULT_FONTS } from './fonts.js';
import { DEFAULT_THEME, resolveTheme, THEMES, SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, resolveShortcuts } from './settingsMeta.js';
import { resolveCustomTheme, applyCustomTheme } from './themeCustom.js';
import './App.css';

/** Compact relative time for the recents list. Deliberately coarse — exact minutes aren't useful. */
function relativeTime(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Shorten a directory path for display, keeping the tail (the informative end). */
function shortenDir(dir, max = 38) {
  if (!dir || dir.length <= max) return dir;
  return '…' + dir.slice(-(max - 1));
}

/** Case-insensitive path key — Windows paths compare that way. */
function pathKey(p) {
  return (p || '').replace(/\//g, '\\').toLowerCase();
}

/*
 * Display helpers for shortcut bindings. Every tooltip and keycap in the UI renders the LIVE
 * binding through these — a hardcoded "(Ctrl+N)" in a title is a lie the moment the user rebinds.
 */
function fmtShortcut(binding) {
  return (binding || '').replace('Control', 'Ctrl');
}

function kbdChips(binding) {
  return (binding || '').split('+').map((k) => (k === 'Control' ? 'Ctrl' : k));
}

/**
 * MarkdownEditView — a markdown tab's EDIT mode: CodeMirror source on the left, live preview on
 * the right, re-rendered ~a third of a second after typing pauses. Top-level component (never
 * defined inside App — that would remount it every render).
 */
function MarkdownEditView({ doc, isActive, tabSize, cursorLabelRef, onDirtyChange, onSave, registerEditor }) {
  const editorRef = useRef(null);
  const [previewHtml, setPreviewHtml] = useState(doc.html);
  const timerRef = useRef(null);

  const onDocChanged = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const text = editorRef.current?.getContent() ?? '';
      setPreviewHtml(renderMarkdown(text, doc.path).html);
    }, 350);
  }, [doc.path]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className="md-edit-split">
      <div className="md-edit-editor">
        <CodeEditor
          ref={(el) => {
            editorRef.current = el;
            registerEditor(el);
          }}
          fileName={doc.name}
          initialContent={doc.source}
          wrap={true /* prose: unwrapped markdown source is unreadable */}
          tabSize={tabSize}
          isActive={isActive}
          onDirtyChange={onDirtyChange}
          onSave={onSave}
          onDocChanged={onDocChanged}
          cursorLabelRef={cursorLabelRef}
        />
      </div>
      <div className="md-edit-preview">
        <div className="markdown-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </div>
    </div>
  );
}

function App() {
  /*
   * ── Tabs ────────────────────────────────────────────────────────────────────────────────────
   * `docs` is the open-tab list, in tab-strip order. A doc is either
   *   { id, kind:'markdown', name, path, source, html, toc, readMins, hasMermaid, dirty, editMode }
   *   { id, kind:'code', name, path, codeContent, langName, dirty, untitled? }
   * (codeContent/source seed the CodeMirror instance, which owns the buffer after mount.)
   *
   * `activeId === null` with docs open = home screen behind the tab strip. `splitId` pins a second
   * doc into a right-hand pane; `diffData` (a snapshot) swaps the split for a side-by-side diff.
   * Every pane stays MOUNTED while its tab is open — that is what preserves scroll position,
   * cursor, selection and undo history across switches. Do not "optimise" this into unmounting.
   */
  const [docs, setDocs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [splitId, setSplitId] = useState(null);
  const [diffData, setDiffData] = useState(null);
  const [focusMode, setFocusMode] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateAction, setUpdateAction] = useState(null);
  const [runtimeInfo, setRuntimeInfo] = useState({ windowsStore: false });
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [recentFiles, setRecentFiles] = useState([]);
  const [defaultAppStatus, setDefaultAppStatus] = useState(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  /** Snapshot of a code buffer rendered into a print-only <pre> — see runPrintJob. */
  const [codePrintText, setCodePrintText] = useState('');

  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    theme: DEFAULT_THEME,
    autoUpdatesEnabled: true,
    sidebarWidth: 300,
    printPageSize: 'Letter',
    printLandscape: false,
    editorWrap: false,
    editorTabSize: 4,
    fonts: DEFAULT_FONTS,
    restoreSession: true,
    customTheme: null,
    shortcuts: DEFAULT_SHORTCUTS
  });
  const [activeShortcutRebind, setActiveShortcutRebind] = useState(null);

  /*
   * Refs, not state, for everything hot paths touch (see AI_CONTEXT.md §5a):
   *   progressBarRef / progressLabelRef   written by the ACTIVE MarkdownView on scroll frames
   *   cursorLabelRef                      written by the ACTIVE CodeEditor on cursor moves
   *   editorRefs                          docId → CodeEditor imperative handle (code tabs AND
   *                                       markdown tabs in edit mode)
   *   docsRef / activeIdRef / splitIdRef  current values for once-registered IPC callbacks and
   *                                       keyboard closures, which must never go stale
   */
  const progressBarRef = useRef(null);
  const progressLabelRef = useRef(null);
  const cursorLabelRef = useRef(null);
  const editorRefs = useRef({});
  const pendingPrintRef = useRef(null);
  const docIdRef = useRef(1);
  const untitledCounterRef = useRef(1);
  const docsRef = useRef([]);
  const activeIdRef = useRef(null);
  const splitIdRef = useRef(null);
  const sessionSaveTimerRef = useRef(null);

  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    splitIdRef.current = splitId;
  }, [splitId]);

  const activeDoc = docs.find((d) => d.id === activeId) || null;

  const updateSetting = (key, value) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      if (window.electronAPI) window.electronAPI.store.set(key, value);
      if (key === 'theme') {
        document.documentElement.setAttribute('data-theme', value);
      }
      if (key === 'fonts') {
        applyFonts(value);
      }
      if (key === 'customTheme') {
        applyCustomTheme(value);
      }
      return updated;
    });
  };

  /* ── Opening ─────────────────────────────────────────────────────────────────────────────── */

  const makeMarkdownDoc = (id, name, fPath, content) => ({
    id,
    kind: 'markdown',
    name,
    path: fPath || null,
    source: content,
    dirty: false,
    editMode: false,
    ...renderMarkdown(content, fPath)
  });

  /**
   * Route an opened file into a tab. All open paths funnel through here — dialog, recents, drag &
   * drop, file association, second instance, session restore. A path that is already open just
   * activates (and, for a clean buffer, refreshes) its existing tab instead of duplicating it.
   */
  const openDocument = (content, name, fPath) => {
    const kind = fileKindForName(name);
    const key = fPath ? pathKey(fPath) : null;

    const existing = key && docsRef.current.find((d) => d.path && pathKey(d.path) === key);
    if (existing) {
      setActiveId(existing.id);
      if (existing.kind === 'markdown' && !existing.editMode) {
        setDocs((ds) =>
          ds.map((d) => (d.id === existing.id ? { ...d, source: content, ...renderMarkdown(content, fPath) } : d))
        );
      } else {
        const editor = editorRefs.current[existing.id];
        if (editor && !editor.isDirty()) editor.replaceContent(content);
      }
      return;
    }

    const id = docIdRef.current++;
    const doc =
      kind === 'markdown'
        ? makeMarkdownDoc(id, name, fPath, content)
        : {
            id,
            kind,
            name,
            path: fPath || null,
            codeContent: content,
            langName: detectLanguage(name)?.name ?? 'Plain text',
            dirty: false
          };
    setDocs((ds) => [...ds, doc]);
    setActiveId(id);
    setIsLoading(false);
  };

  /** A fresh, empty, unsaved buffer. Saving offers every supported format (Save As). */
  const newFile = useCallback(() => {
    const id = docIdRef.current++;
    const n = untitledCounterRef.current++;
    setDocs((ds) => [
      ...ds,
      {
        id,
        kind: 'code',
        name: `Untitled-${n}`,
        path: null,
        codeContent: '',
        langName: 'Plain text',
        dirty: false,
        untitled: true
      }
    ]);
    setActiveId(id);
  }, []);

  /* ── Closing / navigation ────────────────────────────────────────────────────────────────── */

  const closeDoc = useCallback(async (docId) => {
    const doc = docsRef.current.find((d) => d.id === docId);
    if (!doc) return;

    const editor = editorRefs.current[docId];
    const dirty = editor ? editor.isDirty() : doc.dirty;
    if (dirty) {
      const discard = window.electronAPI
        ? await window.electronAPI.confirmDiscard(`Discard unsaved changes and close ${doc.name}?`)
        : window.confirm('Discard unsaved changes?');
      if (!discard) return;
    }

    if (doc.path && window.electronAPI) window.electronAPI.closeFile(doc.path);
    delete editorRefs.current[docId];

    // Computed outside the setDocs updater — updaters must stay pure (StrictMode runs them twice).
    const ds = docsRef.current;
    const idx = ds.findIndex((d) => d.id === docId);
    const next = ds.filter((d) => d.id !== docId);
    if (splitIdRef.current === docId) {
      setSplitId(null);
      setDiffData(null);
    }
    if (activeIdRef.current === docId) {
      setActiveId(next.length ? next[Math.min(idx, next.length - 1)].id : null);
    }
    setDocs(next);
  }, []);

  /** Cycle the active tab by offset. From the home screen, enter the strip at either end. */
  const cycleTab = useCallback((dir) => {
    const ds = docsRef.current;
    if (ds.length === 0) return;
    const idx = ds.findIndex((d) => d.id === activeIdRef.current);
    if (idx === -1) {
      setActiveId(dir > 0 ? ds[0].id : ds[ds.length - 1].id);
    } else {
      setActiveId(ds[(idx + dir + ds.length) % ds.length].id);
    }
  }, []);

  /* ── Recents / default-app plumbing ──────────────────────────────────────────────────────── */

  const refreshRecentFiles = useCallback(() => {
    if (!window.electronAPI?.getRecentFiles) return;
    window.electronAPI.getRecentFiles().then(setRecentFiles).catch(() => {});
  }, []);

  const refreshDefaultAppStatus = useCallback(() => {
    if (!window.electronAPI?.getDefaultAppStatus) return;
    window.electronAPI.getDefaultAppStatus().then(setDefaultAppStatus).catch(() => {});
  }, []);

  const requestDefaultApp = useCallback(() => {
    if (!window.electronAPI?.requestDefaultApp) return;
    setStatusError('');
    window.electronAPI
      .requestDefaultApp()
      .then((res) => {
        if (res && res.ok === false) setStatusError(res.error || 'Could not open Windows Settings');
      })
      .catch((err) => setStatusError(err?.message || 'Could not open Windows Settings'));
  }, []);

  /* ── Boot: stored settings + IPC listeners ───────────────────────────────────────────────── */

  useEffect(() => {
    if (window.electronAPI) {
      Promise.all([
        window.electronAPI.store.get('theme'),
        window.electronAPI.store.get('autoUpdatesEnabled'),
        window.electronAPI.store.get('sidebarWidth'),
        window.electronAPI.store.get('shortcuts'),
        window.electronAPI.store.get('printPageSize'),
        window.electronAPI.store.get('printLandscape'),
        window.electronAPI.store.get('editorWrap'),
        window.electronAPI.store.get('editorTabSize'),
        window.electronAPI.store.get('fonts'),
        window.electronAPI.store.get('restoreSession'),
        window.electronAPI.store.get('customTheme'),
        window.electronAPI.store.get('session')
      ]).then(([theme, autoUpdatesEnabled, savedSidebarWidth, shortcuts, printPageSize, printLandscape, editorWrap, editorTabSize, fonts, restoreSession, customTheme, session]) => {
        const resolvedCustom = resolveCustomTheme(customTheme);
        const resolvedTheme = resolveTheme(theme, !!resolvedCustom);
        const resolvedFonts = resolveFonts(fonts);
        const newSettings = {
          theme: resolvedTheme,
          autoUpdatesEnabled: autoUpdatesEnabled !== false,
          sidebarWidth: savedSidebarWidth || 300,
          printPageSize: printPageSize || 'Letter',
          printLandscape: !!printLandscape,
          editorWrap: !!editorWrap,
          editorTabSize: [2, 4, 8].includes(editorTabSize) ? editorTabSize : 4,
          fonts: resolvedFonts,
          restoreSession: restoreSession !== false,
          customTheme: resolvedCustom,
          shortcuts: resolveShortcuts(shortcuts)
        };
        setSettings(newSettings);
        setSidebarWidth(newSettings.sidebarWidth);
        applyCustomTheme(resolvedCustom);
        document.documentElement.setAttribute('data-theme', resolvedTheme);
        applyFonts(resolvedFonts);

        // Persist the migration so the legacy value isn't re-resolved on every launch.
        if (theme !== resolvedTheme) {
          window.electronAPI.store.set('theme', resolvedTheme);
        }

        /*
         * Session restore: reopen last session's saved-to-disk tabs (untitled buffers are gone by
         * definition). Runs through the main process like every open, so watchers, recents and
         * same-path dedupe (against e.g. a file-association argv arriving in parallel) all apply.
         */
        if (newSettings.restoreSession && Array.isArray(session?.paths)) {
          for (const p of session.paths) {
            window.electronAPI.openRecentFile(p).catch(() => {});
          }
        }
      });

      window.electronAPI.getRuntimeInfo?.().then(setRuntimeInfo).catch(() => {});

      window.electronAPI.onOpenFile((content, name, path) => {
        openDocument(content, name, path);
      });

      /*
       * Live-reload on external disk change, routed to the owning tab by path. Registered once —
       * everything it touches is a ref or a setter. Never clobbers unsaved edits: a dirty buffer
       * keeps the user's version and notes the change in the status bar.
       */
      window.electronAPI.onFileChanged((content, changedPath) => {
        const key = pathKey(changedPath);
        const doc = docsRef.current.find((d) => d.path && pathKey(d.path) === key);
        if (!doc) return;

        const editor = editorRefs.current[doc.id];
        if (editor) {
          // Code tab, or a markdown tab in edit mode.
          if (editor.isDirty()) {
            setStatusError(`${doc.name} changed on disk — your unsaved edits were kept`);
          } else {
            editor.replaceContent(content);
            if (doc.kind === 'markdown') {
              setDocs((ds) => ds.map((d) => (d.id === doc.id ? { ...d, source: content } : d)));
            }
          }
        } else if (doc.kind === 'markdown') {
          setDocs((ds) =>
            ds.map((d) => (d.id === doc.id ? { ...d, source: content, ...renderMarkdown(content, doc.path) } : d))
          );
        }
      });

      window.electronAPI.getAppVersion().then((version) => setAppVersion(version));

      window.electronAPI.onUpdateMessage((message, action) => {
        setUpdateStatus(message);
        setUpdateAction(action);
      });

      refreshRecentFiles();
      refreshDefaultAppStatus();
      window.electronAPI.appReady();
    } else {
      // Browser dev mode (`npm run dev` without Electron): no store to read from.
      document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
      applyFonts(DEFAULT_FONTS);
    }
    /*
     * openDocument is deliberately not a dependency: the IPC listeners are registered once, and
     * everything openDocument touches is either a setter (stable) or a ref (always current).
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshRecentFiles, refreshDefaultAppStatus]);

  /*
   * One place owns the window title and the mirrored any-tab-dirty flag. Since 1.11.0 the title is
   * just the active document's filename (the full app name shows on the home screen only) — the
   * main process composes it; see composeTitle in main.cjs.
   */
  useEffect(() => {
    if (!window.electronAPI) return;
    const anyDirty = docs.some((d) => d.dirty);
    window.electronAPI.setEdited(anyDirty);
    window.electronAPI.setTitle(activeDoc ? activeDoc.name : null, !!activeDoc?.dirty);
  }, [docs, activeDoc]);

  /* Persist the session (paths only) whenever the tab set or active tab changes, debounced. */
  useEffect(() => {
    if (!window.electronAPI) return;
    clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = setTimeout(() => {
      window.electronAPI.store.set('session', {
        paths: docs.filter((d) => d.path).map((d) => d.path),
        active: activeDoc?.path ?? null
      });
    }, 400);
    return () => clearTimeout(sessionSaveTimerRef.current);
  }, [docs, activeDoc]);

  /*
   * Re-check the default-app association when the window regains focus — coming back from
   * Windows Settings is the exact moment the answer may have changed.
   */
  useEffect(() => {
    const onFocus = () => refreshDefaultAppStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshDefaultAppStatus]);

  /** Refresh recents whenever the home screen comes back into view. */
  useEffect(() => {
    if (activeId === null) refreshRecentFiles();
  }, [activeId, refreshRecentFiles]);

  /* Rich Presence stays generic — never a filename (see setDiscordActivity in main.cjs). */
  const activeKind = activeDoc ? (activeDoc.kind === 'code' || activeDoc.editMode ? 'edit' : 'read') : null;
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.setDiscordActivity({
        details:
          activeKind === 'edit' ? 'Editing a document' : activeKind === 'read' ? 'Reading a document' : 'Idling on the home screen'
      });
    }
  }, [activeKind]);

  /* ── Printing ────────────────────────────────────────────────────────────────────────────── */

  const executePrintJob = useCallback((invoke, label, docName) => {
    setIsPrinting(true);
    setStatusError('');
    invoke(docName || 'Document')
      .then((res) => {
        if (res && res.ok === false && !res.canceled) setStatusError(res.error || `${label} failed`);
      })
      .catch((err) => setStatusError(err?.message || `${label} failed`))
      .finally(() => {
        setIsPrinting(false);
        setCodePrintText('');
      });
  }, []);

  const runPrintJob = useCallback(
    (invoke, label) => {
      if (typeof invoke !== 'function' || isPrinting) return;
      const doc = docsRef.current.find((d) => d.id === activeIdRef.current);
      if (!doc) return;

      /*
       * Anything currently backed by a live CodeMirror (code tabs, markdown in edit mode) prints
       * from a snapshot: the editor virtualises long documents, so printing its DOM would emit one
       * truncated page. The snapshot <pre> is display:none on screen and becomes the whole
       * document under `@media print`; the job runs after React commits it (effect below).
       */
      const editor = editorRefs.current[doc.id];
      if (editor) {
        pendingPrintRef.current = () => executePrintJob(invoke, label, doc.name);
        setCodePrintText(editor.getContent());
        return;
      }

      executePrintJob(invoke, label, doc.name);
    },
    [executePrintJob, isPrinting]
  );

  /* Runs the deferred snapshot-print job once the <pre> has committed to the DOM. */
  useEffect(() => {
    if (codePrintText && pendingPrintRef.current) {
      const job = pendingPrintRef.current;
      pendingPrintRef.current = null;
      job();
    }
  }, [codePrintText]);

  const openPrintPreview = useCallback(
    () => runPrintJob(window.electronAPI?.printPreview, 'Preview'),
    [runPrintJob]
  );

  const exportPdf = useCallback(
    () => runPrintJob(window.electronAPI?.exportPdf, 'Export'),
    [runPrintJob]
  );

  /* ── Saving ──────────────────────────────────────────────────────────────────────────────── */

  /**
   * Save a tab (active by default). Handles all three shapes: code tabs, markdown tabs (edit mode
   * saves the buffer; view mode saves the last known source), and untitled buffers (always Save
   * As, offering every supported format). `forceAs` is the Save As action.
   *
   * The tab is only marked clean AFTER the write succeeds — a failed save leaves the guards armed.
   */
  const saveDoc = useCallback(async (docId, { forceAs = false } = {}) => {
    const id = typeof docId === 'number' ? docId : activeIdRef.current;
    const doc = docsRef.current.find((d) => d.id === id);
    if (!doc || !window.electronAPI) return;

    const editor = editorRefs.current[id];
    const content = editor ? editor.getContent() : doc.kind === 'markdown' ? doc.source : null;
    if (content === null) return;

    setStatusError('');
    try {
      let res;
      let finalPath = doc.path;
      if (doc.path && !forceAs) {
        res = await window.electronAPI.saveFile(doc.path, content);
      } else {
        const suggested = doc.untitled ? `${doc.name}.txt` : doc.name;
        res = await window.electronAPI.saveFileAs(suggested, content, doc.path);
        if (res?.ok) {
          finalPath = res.filePath;
          const newKey = pathKey(res.filePath);
          const newLang = detectLanguage(res.name)?.name ?? 'Plain text';
          setDocs((ds) =>
            ds
              // If the chosen path was already open in another tab, that tab is now stale — drop it.
              .filter((d) => d.id === id || !d.path || pathKey(d.path) !== newKey)
              .map((d) =>
                d.id === id ? { ...d, name: res.name, path: res.filePath, untitled: false, langName: newLang } : d
              )
          );
          // New extension may mean a new language — retune the live editor without a remount.
          editor?.setLanguage(res.name);
        }
      }

      if (res?.ok) {
        if (editor) editor.markSaved();
        if (doc.kind === 'markdown') {
          // Keep the view-mode render in sync with what's now on disk.
          setDocs((ds) =>
            ds.map((d) =>
              d.id === id ? { ...d, dirty: false, source: content, ...renderMarkdown(content, finalPath) } : d
            )
          );
        } else if (!editor) {
          setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, dirty: false } : d)));
        }
      } else if (!res?.canceled) {
        setStatusError(res?.error || 'Save failed');
      }
    } catch (err) {
      setStatusError(err?.message || 'Save failed');
    }
  }, []);

  /** Mirror a tab's dirty flag into the doc list (title + guards follow via the sync effect). */
  const handleDirtyChange = useCallback((docId, dirty) => {
    setDocs((ds) => ds.map((d) => (d.id === docId ? { ...d, dirty } : d)));
  }, []);

  /* ── Markdown edit mode ──────────────────────────────────────────────────────────────────── */

  const toggleMarkdownEdit = useCallback((docId) => {
    const id = typeof docId === 'number' ? docId : activeIdRef.current;
    const doc = docsRef.current.find((d) => d.id === id);
    if (!doc || doc.kind !== 'markdown') return;

    if (!doc.editMode) {
      setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, editMode: true } : d)));
    } else {
      // Leaving edit mode: the buffer becomes the source of truth for the reading view.
      const editor = editorRefs.current[id];
      const text = editor ? editor.getContent() : doc.source;
      delete editorRefs.current[id];
      setDocs((ds) =>
        ds.map((d) =>
          d.id === id ? { ...d, editMode: false, source: text, ...renderMarkdown(text, d.path) } : d
        )
      );
    }
  }, []);

  /* ── Split view & diff ───────────────────────────────────────────────────────────────────── */

  const toggleSplit = useCallback(() => {
    if (splitIdRef.current !== null) {
      setSplitId(null);
      setDiffData(null);
      return;
    }
    const ds = docsRef.current;
    if (ds.length < 2 || activeIdRef.current === null) {
      setStatusError('Open a second tab to use split view');
      return;
    }
    const idx = ds.findIndex((d) => d.id === activeIdRef.current);
    const other = ds[(idx + 1) % ds.length];
    setSplitId(other.id);
  }, []);

  /** Text content of a doc as it stands right now (live buffer if an editor is mounted). */
  const docText = useCallback((doc) => {
    const editor = editorRefs.current[doc.id];
    if (editor) return editor.getContent();
    if (doc.kind === 'markdown') return doc.source;
    return doc.codeContent;
  }, []);

  const toggleDiff = useCallback(() => {
    if (diffData) {
      setDiffData(null);
      return;
    }
    const a = docsRef.current.find((d) => d.id === activeIdRef.current);
    if (!a) return;

    // With a split open: compare the two panes.
    const b = docsRef.current.find((d) => d.id === splitIdRef.current);
    if (b) {
      setDiffData({ leftText: docText(a), rightText: docText(b), leftName: a.name, rightName: b.name });
      return;
    }

    /*
     * No split: diff THIS file's unsaved edits against its last-saved state. The baseline is the
     * editor's saved snapshot (what markSaved recorded), so it works without touching the disk —
     * and stays correct even if the file changed externally while dirty (the baseline is what YOU
     * last had saved, which is what your edits diverged from).
     */
    const editor = editorRefs.current[a.id];
    if (!editor) {
      setStatusError('Open the document in the editor (Edit mode for markdown) to diff unsaved changes');
      return;
    }
    if (!editor.isDirty()) {
      setStatusError('No unsaved changes to diff');
      return;
    }
    setDiffData({
      leftText: editor.getSavedContent(),
      rightText: editor.getContent(),
      leftName: `${a.name} (saved)`,
      rightName: `${a.name} (unsaved)`
    });
  }, [diffData, docText]);

  /* ── Keyboard ────────────────────────────────────────────────────────────────────────────── */

  const matchesShortcut = (e, shortcutString) => {
    if (!shortcutString) return false;
    const parts = shortcutString.split('+');
    const key = parts[parts.length - 1].toLowerCase();
    const ctrl = parts.includes('Control');
    const shift = parts.includes('Shift');
    const alt = parts.includes('Alt');
    const meta = parts.includes('Meta');

    if (e.ctrlKey !== ctrl) return false;
    if (e.shiftKey !== shift) return false;
    if (e.altKey !== alt) return false;
    if (e.metaKey !== meta) return false;
    return e.key.toLowerCase() === key;
  };

  useEffect(() => {
    const actions = {
      newFile: () => newFile(),
      openFile: () => window.electronAPI?.openFileDialog(),
      save: () => saveDoc(),
      saveAs: () => saveDoc(undefined, { forceAs: true }),
      print: () => {
        if (activeIdRef.current !== null) openPrintPreview();
      },
      exportPdf: () => {
        if (activeIdRef.current !== null) exportPdf();
      },
      closeTab: () => {
        if (activeIdRef.current !== null) closeDoc(activeIdRef.current);
      },
      close: () => {
        if (activeIdRef.current !== null) closeDoc(activeIdRef.current);
      },
      nextTab: () => cycleTab(1),
      prevTab: () => cycleTab(-1),
      goHome: () => setActiveId(null),
      palette: () => setShowPalette((p) => !p),
      toggleEdit: () => toggleMarkdownEdit(),
      toggleSplit: () => toggleSplit(),
      focusMode: () => setFocusMode((f) => !f),
      settings: () => setShowSettings(true)
    };

    const handleKeyDown = (e) => {
      /*
       * CodeMirror handles its own keys first and calls preventDefault on anything it consumed
       * (Escape closing its search panel, Ctrl+S from its save keymap) — acting on those here too
       * would double-fire. The palette and pickers use the same convention.
       */
      if (e.defaultPrevented) return;

      if (activeShortcutRebind) {
        e.preventDefault();
        e.stopPropagation();
        let keys = [];
        if (e.ctrlKey) keys.push('Control');
        if (e.shiftKey) keys.push('Shift');
        if (e.altKey) keys.push('Alt');
        if (e.metaKey) keys.push('Meta');

        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
          keys.push(e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
          updateSetting('shortcuts', { ...settings.shortcuts, [activeShortcutRebind]: keys.join('+') });
          setActiveShortcutRebind(null);
        }
        return;
      }

      // Escape unwinds one layer at a time: palette (in-component) → diff → focus → settings → tab.
      if (e.key === 'Escape' && diffData) {
        setDiffData(null);
        return;
      }
      if (e.key === 'Escape' && focusMode) {
        setFocusMode(false);
        return;
      }
      if (showSettings && matchesShortcut(e, settings.shortcuts.close)) {
        setShowSettings(false);
        return;
      }

      // Fixed: Ctrl+1–9 jump (9 = last), Ctrl+PgUp/PgDn cycle.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const ds = docsRef.current;
        if (ds.length > 0) {
          const n = parseInt(e.key, 10);
          setActiveId(n === 9 ? ds[ds.length - 1].id : (ds[n - 1]?.id ?? ds[ds.length - 1].id));
        }
        return;
      }
      if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
        e.preventDefault();
        cycleTab(e.key === 'PageDown' ? 1 : -1);
        return;
      }

      // Every rebindable action, in declaration order.
      for (const { id } of SHORTCUT_ACTIONS) {
        if (matchesShortcut(e, settings.shortcuts[id])) {
          // Escape-as-close must not swallow Escape while a modal layer is open above the tabs.
          if (id === 'close' && (showSettings || showPalette)) return;
          e.preventDefault();
          actions[id]?.();
          return;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settings.shortcuts, activeShortcutRebind, showSettings, showPalette, focusMode, diffData, openPrintPreview, exportPdf, saveDoc, closeDoc, cycleTab, newFile, toggleMarkdownEdit, toggleSplit]);

  /* ── Update / drop / recents handlers ────────────────────────────────────────────────────── */

  const handleUpdateAction = () => {
    if (!window.electronAPI) return;
    if (updateAction === 'install') {
      window.electronAPI.installUpdate();
    } else {
      window.electronAPI.checkForUpdates();
    }
  };

  const onDrop = (acceptedFiles) => {
    for (const file of acceptedFiles) {
      if (!file || !file.name) continue;

      if (file.size === 0 && file.type === '') {
        console.error('Dropped item appears to be a folder or empty file.');
        continue;
      }

      if (!isSupportedFileName(file.name)) {
        setStatusError(`Can't open ${file.name} — not a markdown or code file`);
        continue;
      }

      const resolvedPath = window.electronAPI?.getPathForFile?.(file) ?? file.path ?? null;

      // With a real path, route through the main process: watcher, recents, tab dedupe.
      if (resolvedPath && window.electronAPI?.openRecentFile) {
        window.electronAPI.openRecentFile(resolvedPath);
        continue;
      }

      setIsLoading(true);
      const reader = new FileReader();
      reader.onload = (ev) => {
        openDocument(ev.target.result, file.name, resolvedPath);
      };
      reader.readAsText(file);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    noKeyboard: true
  });

  const openRecent = (entry) => {
    if (!window.electronAPI?.openRecentFile) return;
    window.electronAPI.openRecentFile(entry.path).then((res) => {
      if (!res?.ok) refreshRecentFiles();
    });
  };

  const isWindows = defaultAppStatus?.supported === true;

  /* ── Command palette items ───────────────────────────────────────────────────────────────── */

  const paletteItems = showPalette
    ? [
        ...docs.map((d) => ({
          id: `tab-${d.id}`,
          section: 'Tabs',
          label: d.name,
          icon: d.kind === 'code' ? FileCode : FileText,
          run: () => setActiveId(d.id)
        })),
        ...recentFiles
          .filter((r) => r.exists)
          .map((r) => ({
            id: `recent-${r.path}`,
            section: 'Recent',
            label: r.name,
            icon: ClockCounterClockwise,
            run: () => openRecent(r)
          })),
        { id: 'cmd-new', section: 'Commands', label: 'New file', icon: FilePlus, run: newFile },
        { id: 'cmd-open', section: 'Commands', label: 'Open file…', icon: FolderOpen, run: () => window.electronAPI?.openFileDialog() },
        { id: 'cmd-save', section: 'Commands', label: 'Save', icon: FloppyDisk, run: () => saveDoc() },
        { id: 'cmd-saveas', section: 'Commands', label: 'Save As…', icon: FloppyDisk, run: () => saveDoc(undefined, { forceAs: true }) },
        { id: 'cmd-print', section: 'Commands', label: 'Print preview', icon: Printer, run: openPrintPreview },
        { id: 'cmd-export', section: 'Commands', label: 'Export as PDF', icon: FilePdf, run: exportPdf },
        { id: 'cmd-edit', section: 'Commands', label: 'Edit / view markdown', icon: PencilSimple, run: () => toggleMarkdownEdit() },
        { id: 'cmd-split', section: 'Commands', label: splitId ? 'Close split view' : 'Split view', icon: SquareSplitHorizontal, run: toggleSplit },
        { id: 'cmd-diff', section: 'Commands', label: diffData ? 'Exit diff' : splitId !== null ? 'Diff the split panes' : 'Diff unsaved changes', icon: GitDiff, run: toggleDiff },
        { id: 'cmd-focus', section: 'Commands', label: focusMode ? 'Exit focus mode' : 'Focus mode', icon: ArrowsOutSimple, run: () => setFocusMode((f) => !f) },
        { id: 'cmd-home', section: 'Commands', label: 'Go to home screen', icon: House, run: () => setActiveId(null) },
        { id: 'cmd-close', section: 'Commands', label: 'Close tab', icon: X, run: () => activeIdRef.current !== null && closeDoc(activeIdRef.current) },
        { id: 'cmd-settings', section: 'Commands', label: 'Open settings', icon: Gear, run: () => setShowSettings(true) },
        { id: 'cmd-shortcuts', section: 'Commands', label: 'Keyboard shortcuts', icon: Keyboard, run: () => setShowSettings(true) },
        { id: 'cmd-updates', section: 'Commands', label: 'Check for updates', icon: CircleNotch, run: handleUpdateAction },
        ...THEMES.map((t) => ({
          id: `theme-${t.value}`,
          section: 'Theme',
          label: `${t.label} — ${t.sub}`,
          icon: Palette,
          run: () => updateSetting('theme', t.value)
        })),
        ...(settings.customTheme
          ? [{ id: 'theme-custom', section: 'Theme', label: 'Custom — your palette', icon: Palette, run: () => updateSetting('theme', 'custom') }]
          : [])
      ]
    : [];

  /* ── Render helpers ──────────────────────────────────────────────────────────────────────── */

  const renderPane = (d) => {
    const active = d.id === activeId;
    const inSplit = splitId === d.id && !diffData;
    const visible = active || inSplit;
    return (
      <div
        key={d.id}
        className={`doc-pane ${active ? 'doc-pane-active' : ''} ${inSplit && !active ? 'doc-pane-split-right' : ''}`}
        style={
          d.kind === 'code'
            ? { display: visible ? 'flex' : 'none', '--editor-font': editorFontFor(d.name, settings.fonts) }
            : { display: visible ? 'flex' : 'none' }
        }
      >
        {inSplit && !active && (
          <div className="split-bar" key="splitbar">
            <select
              value={splitId ?? ''}
              onChange={(e) => setSplitId(parseInt(e.target.value, 10))}
              aria-label="Document shown in the split pane"
            >
              {docs
                .filter((x) => x.id !== activeId)
                .map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
            </select>
            <button className="icon-btn" onClick={toggleDiff} title="Diff against the active tab">
              <GitDiff size={15} weight="duotone" />
            </button>
            <button className="icon-btn" onClick={() => { setSplitId(null); setDiffData(null); }} title="Close split">
              <X size={14} weight="bold" />
            </button>
          </div>
        )}

        {d.kind === 'markdown' ? (
          d.editMode ? (
            <MarkdownEditView
              key="mdedit"
              doc={d}
              isActive={active}
              tabSize={settings.editorTabSize}
              cursorLabelRef={cursorLabelRef}
              onDirtyChange={(dirty) => handleDirtyChange(d.id, dirty)}
              onSave={() => saveDoc(d.id)}
              registerEditor={(el) => {
                if (el) editorRefs.current[d.id] = el;
                else if (editorRefs.current[d.id]) delete editorRefs.current[d.id];
              }}
            />
          ) : (
            <MarkdownView
              key="mdview"
              doc={d}
              isActive={active}
              sidebarWidth={sidebarWidth}
              onSidebarWidthChange={setSidebarWidth}
              progressBarRef={progressBarRef}
              progressLabelRef={progressLabelRef}
            />
          )
        ) : (
          <CodeEditor
            key="ed"
            ref={(el) => {
              if (el) editorRefs.current[d.id] = el;
              else delete editorRefs.current[d.id];
            }}
            fileName={d.name}
            initialContent={d.codeContent}
            wrap={settings.editorWrap}
            tabSize={settings.editorTabSize}
            isActive={active}
            onDirtyChange={(dirty) => handleDirtyChange(d.id, dirty)}
            onSave={() => saveDoc(d.id)}
            cursorLabelRef={cursorLabelRef}
          />
        )}

        {/* Print-only snapshot (populated on demand by runPrintJob, cleared after). */}
        {active && codePrintText && <pre className="code-print-body" key="printsnap">{codePrintText}</pre>}
      </div>
    );
  };

  /* ── Render ──────────────────────────────────────────────────────────────────────────────── */

  return (
    <div className={`app-shell ${focusMode ? 'focus-mode' : ''}`}>
      {/* ── Tab strip — visible whenever anything is open, home screen included ─────────────── */}
      {docs.length > 0 && (
        <div className="tab-strip" role="tablist" aria-label="Open documents">
          <button
            className={`tab-home ${activeId === null ? 'active' : ''}`}
            onClick={() => setActiveId(null)}
            title="Home"
          >
            <House size={17} weight="duotone" />
          </button>

          <div className="tab-scroll">
            {docs.map((d) => (
              <div
                key={d.id}
                role="tab"
                tabIndex={0}
                aria-selected={d.id === activeId}
                className={`tab ${d.id === activeId ? 'active' : ''}`}
                onClick={() => setActiveId(d.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveId(d.id);
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeDoc(d.id);
                  }
                }}
                title={d.path || d.name}
              >
                {d.kind === 'code'
                  ? <FileCode size={14} weight="duotone" className="tab-icon" />
                  : <FileText size={14} weight="duotone" className="tab-icon" />}
                <span className="tab-name">{d.name}</span>
                {d.dirty && <span className="dirty-dot" title="Unsaved changes" />}
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeDoc(d.id);
                  }}
                  title={`Close (${fmtShortcut(settings.shortcuts.closeTab)})`}
                  aria-label={`Close ${d.name}`}
                >
                  <X size={11} weight="bold" />
                </button>
              </div>
            ))}
          </div>

          <button className="icon-btn tab-add" onClick={newFile} title={`New file (${fmtShortcut(settings.shortcuts.newFile)})`}>
            <FilePlus size={15} weight="bold" />
          </button>
          <button
            className="icon-btn tab-add"
            onClick={() => window.electronAPI?.openFileDialog()}
            title={`Open file (${fmtShortcut(settings.shortcuts.openFile)})`}
          >
            <Plus size={15} weight="bold" />
          </button>
        </div>
      )}

      {/* Reading progress is a markdown concept; the code editor has Ln/Col in the status bar. */}
      {activeDoc?.kind === 'markdown' && !activeDoc.editMode && (
        <div className="progress-bar-container">
          <div className="progress-bar" ref={progressBarRef} />
        </div>
      )}

      <div className="app-main">
        {!activeDoc && (
          /* ── HOME (also shown behind the tab strip when no tab is active) ─────────────────── */
          <>
            <Starfield />

            <div className="home">
              <header className="home-brand">
                <img src={fateLogo} alt="" className="brand-badge" />
                <h1 className="brand-wordmark">FATE</h1>
                <p className="brand-subtitle">Formatted Article &amp; Text Editor</p>
                <p className="brand-credit">Provided by VagueDustin Enterprises&trade;</p>
              </header>

              <div className="home-panes">
                <section className="pane pane-open" aria-label="Open a document">
                  <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
                    <input {...getInputProps()} />
                    {isLoading ? (
                      <>
                        <CircleNotch className="dz-icon spinner" weight="bold" />
                        <p className="dz-title">Rendering document…</p>
                      </>
                    ) : (
                      <>
                        <UploadSimple className="dz-icon" weight="duotone" />
                        <p className="dz-title">
                          {isDragActive ? 'Release to open' : 'Drag & drop markdown or code files'}
                        </p>
                        <span className="dz-sub">.md &middot; .txt &middot; .ps1 &middot; .html &middot; .py &middot; .json &middot; &hellip;</span>
                      </>
                    )}
                  </div>

                  <div className="home-actions">
                    <button
                      className="btn btn-primary btn-open"
                      onClick={() => window.electronAPI?.openFileDialog()}
                    >
                      <FolderOpen size={17} weight="duotone" />
                      Open File
                      <span className="kbd-group">
                        {kbdChips(settings.shortcuts.openFile).map((k) => <kbd key={k}>{k}</kbd>)}
                      </span>
                    </button>
                    <button className="btn btn-secondary btn-open" onClick={newFile}>
                      <FilePlus size={17} weight="duotone" />
                      New File
                      <span className="kbd-group">
                        {kbdChips(settings.shortcuts.newFile).map((k) => <kbd key={k}>{k}</kbd>)}
                      </span>
                    </button>
                  </div>
                </section>

                <section className="pane pane-recent" aria-label="Recent documents">
                  <div className="pane-head">
                    <h2 className="section-label">
                      <ClockCounterClockwise size={13} weight="bold" />
                      Recent
                    </h2>
                    {recentFiles.length > 0 && (
                      <button
                        className="link-btn"
                        onClick={() => window.electronAPI?.clearRecentFiles().then(refreshRecentFiles)}
                        title="Clear recent documents"
                      >
                        <Trash size={13} weight="bold" />
                        Clear
                      </button>
                    )}
                  </div>

                  {recentFiles.length === 0 ? (
                    <div className="pane-empty">
                      <FileText size={26} weight="duotone" />
                      <p>No documents yet</p>
                      <span>Files you open will appear here</span>
                    </div>
                  ) : (
                    <ul className="recent-list">
                      {recentFiles.map((entry) => (
                        <li key={entry.path}>
                          <button
                            className={`recent-item ${entry.exists ? '' : 'missing'}`}
                            onClick={() => openRecent(entry)}
                            title={entry.exists ? entry.path : `${entry.path} — no longer exists`}
                          >
                            {fileKindForName(entry.name) === 'code'
                              ? <FileCode size={17} weight="duotone" className="recent-icon" />
                              : <FileText size={17} weight="duotone" className="recent-icon" />}
                            <span className="recent-text">
                              <span className="recent-name">{entry.name}</span>
                              <span className="recent-dir">
                                {entry.exists ? shortenDir(entry.dir) : 'File not found'}
                              </span>
                            </span>
                            <span className="recent-time">{relativeTime(entry.openedAt)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          </>
        )}

        {/* ── DOCUMENT PANES — all mounted; active (and split) visible ────────────────────── */}
        {docs.length > 0 && (
          <div className="viewer-shell" style={{ display: activeDoc ? 'flex' : 'none' }}>
            {activeDoc && (
              <div className="viewer-header">
                <div className="header-left">
                  <div className="file-info">
                    {activeDoc.kind === 'code'
                      ? <FileCode className="file-icon" size={19} weight="duotone" />
                      : <FileText className="file-icon" size={19} weight="duotone" />}
                    <span className="file-name">{activeDoc.name}</span>
                    {activeDoc.dirty && <span className="dirty-dot" title="Unsaved changes" />}
                  </div>
                </div>

                <div className="header-right">
                  {activeDoc.kind === 'markdown' && (
                    /* THE edit/view switch — deliberately a labelled button, not a mystery icon. */
                    <button
                      className={`btn btn-compact edit-toggle ${activeDoc.editMode ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => toggleMarkdownEdit()}
                      title={`${activeDoc.editMode ? 'Back to reading view' : 'Edit this document'} (${settings.shortcuts.toggleEdit.replace('Control', 'Ctrl')})`}
                    >
                      {activeDoc.editMode
                        ? <><Eye size={15} weight="duotone" /> View</>
                        : <><PencilSimple size={15} weight="duotone" /> Edit</>}
                    </button>
                  )}
                  {(activeDoc.kind === 'code' || activeDoc.editMode || activeDoc.dirty) && (
                    <button
                      className="icon-btn"
                      onClick={() => saveDoc()}
                      disabled={!activeDoc.dirty && !activeDoc.untitled}
                      title={`Save (${settings.shortcuts.save.replace('Control', 'Ctrl')})`}
                    >
                      <FloppyDisk size={17} weight="duotone" />
                    </button>
                  )}
                  <button
                    className={`icon-btn ${splitId !== null ? 'toggled' : ''}`}
                    onClick={toggleSplit}
                    title={`Split view (${settings.shortcuts.toggleSplit.replace('Control', 'Ctrl')})`}
                  >
                    <SquareSplitHorizontal size={17} weight="duotone" />
                  </button>
                  <button
                    className={`icon-btn ${diffData ? 'toggled' : ''}`}
                    onClick={toggleDiff}
                    title={diffData ? 'Exit diff (Esc)' : splitId !== null ? 'Diff the split panes' : 'Diff unsaved changes against the saved file'}
                  >
                    <GitDiff size={17} weight="duotone" />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={exportPdf}
                    disabled={isPrinting}
                    title={`Export as PDF (${fmtShortcut(settings.shortcuts.exportPdf)})`}
                  >
                    <FilePdf size={17} weight="duotone" />
                  </button>
                  <button
                    className="icon-btn"
                    onClick={openPrintPreview}
                    disabled={isPrinting}
                    title={`Print preview (${settings.shortcuts.print.replace('Control', 'Ctrl')})`}
                  >
                    {isPrinting
                      ? <CircleNotch size={17} weight="bold" className="spinner" />
                      : <Printer size={17} weight="duotone" />}
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => setShowSettings(true)}
                    title={`Settings (${fmtShortcut(settings.shortcuts.settings)})`}
                  >
                    <Gear size={17} weight="duotone" />
                  </button>
                </div>
              </div>
            )}

            {/* Diff replaces the panes VISUALLY; the panes stay mounted underneath. */}
            {diffData && <DiffView {...diffData} />}
            <div
              className={`doc-panes ${splitId !== null && !diffData ? 'split' : ''}`}
              style={{ display: diffData ? 'none' : undefined }}
            >
              {docs.map(renderPane)}
            </div>
          </div>
        )}
      </div>

      {/* Status bar — in the layout flow, not floating (see AI_CONTEXT.md §3a). */}
      <footer className="status-bar">
        <button className="status-btn" onClick={() => setShowSettings(true)}>
          <Gear size={15} weight="duotone" />
          <span className="status-btn-label">Settings</span>
        </button>
        <button className="status-btn" onClick={() => setShowPalette(true)} title={`Command palette (${settings.shortcuts.palette.replace('Control', 'Ctrl')})`}>
          <MagnifyingGlass size={14} weight="bold" />
        </button>

        <span className="status-divider" />
        <span className="status-version">v{appVersion || '—'}</span>

        {activeDoc?.kind === 'markdown' && !activeDoc.editMode && (
          <>
            <span className="status-divider" />
            <span className="status-read">
              <span ref={progressLabelRef}>0%</span> read &middot; ~{activeDoc.readMins} min
            </span>
          </>
        )}

        {(activeDoc?.kind === 'code' || activeDoc?.editMode) && (
          <>
            <span className="status-divider" />
            <span className="status-lang" title="Detected language">
              {activeDoc.kind === 'code' ? activeDoc.langName : 'Markdown'}
            </span>
            <span className="status-divider" />
            <span className="status-cursor" ref={cursorLabelRef}>Ln 1, Col 1</span>
          </>
        )}

        <span className="status-spacer" />

        {statusError && (
          <button
            className="status-badge status-badge-error"
            onClick={() => setStatusError('')}
            title={`${statusError} — click to dismiss`}
          >
            <Warning size={13} weight="fill" />
            {statusError}
          </button>
        )}

        {isWindows && defaultAppStatus?.isDefault && (
          <span className="status-badge" title="FATE opens .md files by default">
            <CheckCircle size={13} weight="fill" />
            Default for .md
          </span>
        )}

        <button
          className={`status-btn ${updateAction === 'install' ? 'accent' : ''}`}
          onClick={handleUpdateAction}
          title={runtimeInfo.windowsStore ? 'Updates come from the Microsoft Store' : 'Check for updates'}
        >
          {runtimeInfo.windowsStore ? 'Store build · updates via Microsoft Store' : (updateStatus || 'Check for updates')}
        </button>
      </footer>

      {showPalette && <CommandPalette items={paletteItems} onClose={() => setShowPalette(false)} />}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          settings={settings}
          updateSetting={updateSetting}
          appVersion={appVersion}
          defaultAppStatus={defaultAppStatus}
          requestDefaultApp={requestDefaultApp}
          activeShortcutRebind={activeShortcutRebind}
          setActiveShortcutRebind={setActiveShortcutRebind}
          onSidebarWidthChange={setSidebarWidth}
          runtimeInfo={runtimeInfo}
        />
      )}
    </div>
  );
}

export default App;
