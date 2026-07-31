import { useState, useEffect, useRef, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import markedKatex from 'marked-katex-extension';
import 'katex/dist/katex.min.css';
import {
  UploadSimple, FileText, ArrowLeft, List, CircleNotch, Gear, X,
  Printer, FolderOpen, ClockCounterClockwise, CheckCircle, ArrowSquareOut, Trash
} from '@phosphor-icons/react';
import fateLogo from './assets/FATE-Square-Icon.png';
import Starfield from './components/Starfield.jsx';
import './App.css';

// Configure marked to use highlight.js
marked.setOptions({
  highlight: function(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
  gfm: true,
  breaks: true
});

marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

/**
 * Themes are defined as token blocks in brand.css. This list drives the Settings dropdown, so
 * adding a theme means adding a block there and one entry here.
 */
const THEMES = [
  { value: 'fate', label: 'FATE (Navy & Gold)' },
  { value: 'crimson', label: 'Crimson (Classic)' },
  { value: 'light', label: 'Light' },
  { value: 'dracula', label: 'Dracula' }
];
const VALID_THEMES = THEMES.map(t => t.value);
const DEFAULT_THEME = 'fate';

/**
 * Map a stored theme value onto one that still exists.
 *
 * Pre-1.5.0 the default was `'dark'`, whose styles lived in App.css's base rules. Those rules are
 * now token-driven and `'dark'` has no token block, so a stored `'dark'` would render the app with
 * every custom property unresolved — i.e. unstyled. Anyone upgrading needs to land on `fate`.
 */
function resolveTheme(stored) {
  if (VALID_THEMES.includes(stored)) return stored;
  return DEFAULT_THEME; // covers legacy 'dark', null, and anything unexpected
}

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

function App() {
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [isViewing, setIsViewing] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateAction, setUpdateAction] = useState(null);
  const [toc, setToc] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeHeading, setActiveHeading] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [recentFiles, setRecentFiles] = useState([]);
  const [defaultAppStatus, setDefaultAppStatus] = useState(null);

  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    theme: DEFAULT_THEME,
    discordEnabled: false,
    autoUpdatesEnabled: true,
    sidebarWidth: 300,
    shortcuts: { openFile: 'Control+O', print: 'Control+P', close: 'Escape' }
  });
  const [activeShortcutRebind, setActiveShortcutRebind] = useState(null);

  const updateSetting = (key, value) => {
    setSettings(prev => {
      const updated = { ...prev, [key]: value };
      if (window.electronAPI) window.electronAPI.store.set(key, value);
      if (key === 'theme') {
        document.documentElement.setAttribute('data-theme', value);
      }
      return updated;
    });
  };

  const [isLoading, setIsLoading] = useState(false);
  const contentRef = useRef(null);

  /*
   * Refs, not state, for everything the scroll handler touches.
   *
   * Scroll fires dozens of times a second. Routing any of this through useState re-rendered the
   * whole App component — including the `dangerouslySetInnerHTML` markdown body and every KaTeX
   * node in it — on every tick. These refs are what make scrolling free:
   *
   *   progressBarRef    the progress bar's width is written directly to the DOM, bypassing React
   *   progressLabelRef  the "42%" readout in the status bar, written the same way. This is WHY the
   *                     percentage is not state: a live number in the status bar would otherwise
   *                     re-introduce exactly the per-tick re-render this design removes.
   *   headingsRef       querySelectorAll('h1,h2,h3') is cached per document, not re-run per frame
   *   activeHeadingRef  the current heading is compared against a ref so setState only fires on
   *                     an actual change (and so the effect need not depend on `activeHeading`)
   *   scrollRafIdRef    one rAF in flight at a time = the handler runs at frame cadence, no more
   *   filePathRef       never rendered, so it has no business being state
   */
  const progressBarRef = useRef(null);
  const progressLabelRef = useRef(null);
  const headingsRef = useRef([]);
  const activeHeadingRef = useRef('');
  const scrollRafIdRef = useRef(null);
  const filePathRef = useRef(null);

  const isResizing = useRef(false);

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

  const resize = useCallback((e) => {
    if (isResizing.current) {
      let newWidth = e.clientX;
      if (newWidth < 200) newWidth = 200;
      if (newWidth > window.innerWidth * 0.5) newWidth = window.innerWidth * 0.5;
      setSidebarWidth(newWidth);
    }
  }, []);

  const refreshRecentFiles = useCallback(() => {
    if (!window.electronAPI?.getRecentFiles) return;
    window.electronAPI.getRecentFiles().then(setRecentFiles).catch(() => {});
  }, []);

  const refreshDefaultAppStatus = useCallback(() => {
    if (!window.electronAPI?.getDefaultAppStatus) return;
    window.electronAPI.getDefaultAppStatus().then(setDefaultAppStatus).catch(() => {});
  }, []);

  const processMarkdown = (content, fPath) => {
    setIsLoading(true);

    // Repair mathematically corrupted control-characters from unescaped markdown generators.
    // The literal control characters are intentional — generators emit a real \t byte where they
    // meant to emit a backslash-t escape, so matching them is the entire point of this pass.
    /* eslint-disable no-control-regex */
    const repairedContent = content
      .replace(/\x09heta/g, '\\theta')
      .replace(/\x09ext/g, '\\text')
      .replace(/\x09imes/g, '\\times')
      .replace(/\x09au/g, '\\tau')
      .replace(/\x0Crac/g, '\\frac')
      .replace(/\x0Dight/g, '\\right')
      .replace(/\x08eta/g, '\\beta')
      .replace(/\x08egin/g, '\\begin')
      .replace(/\x07pprox/g, '\\approx')
      .replace(/\x07lpha/g, '\\alpha')
      .replace(/\x0Dho/g, '\\rho')
      .replace(/\x0B/g, '\\v')
      .replace(/\\ /g, '\\\\ ');
    /* eslint-enable no-control-regex */

    const rawHtml = marked.parse(repairedContent);
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { mathMl: true, html: true },
      ADD_TAGS: ['annotation'],
      ADD_ATTR: ['class', 'style', 'aria-hidden', 'encoding', 'xmlns', 'viewBox', 'd', 'preserveAspectRatio']
    });

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = cleanHtml;

    if (fPath) {
      const dirPath = fPath.substring(0, Math.max(fPath.lastIndexOf('\\'), fPath.lastIndexOf('/')));
      const imgs = tempDiv.querySelectorAll('img');
      imgs.forEach(img => {
        const src = img.getAttribute('src');
        if (src && !src.startsWith('http') && !src.startsWith('data:')) {
          const isAbsolute = /^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('/');
          const absPath = isAbsolute ? src.replace(/\\/g, '/') : `${dirPath}/${src}`.replace(/\\/g, '/');
          const finalPath = absPath.startsWith('/') ? absPath : `/${absPath}`;
          img.setAttribute('src', `fate-local://${finalPath}`);
        }
      });
    }

    const headings = Array.from(tempDiv.querySelectorAll('h1, h2, h3'));
    const tocData = headings.map((h, i) => {
      const id = `heading-${i}`;
      h.id = id;
      return { id, html: h.innerHTML, level: parseInt(h.tagName.substring(1)) };
    });

    // Reset scroll tracking for the incoming document. Without this, the stale heading cache and
    // progress width from the previous file survive until the first scroll event.
    headingsRef.current = [];
    activeHeadingRef.current = '';
    setActiveHeading('');
    if (progressBarRef.current) progressBarRef.current.style.width = '0%';
    if (progressLabelRef.current) progressLabelRef.current.textContent = '0%';

    setToc(tocData);
    setIsSidebarOpen(tocData.length > 0);
    setFileContent(tempDiv.innerHTML);
    setIsLoading(false);
    setIsViewing(true);

    if (window.electronAPI) {
      // Send only the document name — the main process composes the title so the app name always
      // leads it, which is what the taskbar label is truncated from. See composeTitle in main.cjs.
      window.electronAPI.setTitle(fPath ? fPath.split(/[/\\]/).pop() : 'Document');
    }
  };

  useEffect(() => {
    if (window.electronAPI) {
      if (isViewing && fileName) {
        window.electronAPI.setDiscordActivity({
          details: 'Reading Markdown',
          state: `Viewing: ${fileName}`
        });
      } else {
        window.electronAPI.setDiscordActivity({
          details: 'Idling on the home screen',
          state: 'Exploring Markdown'
        });
      }
    }
  }, [isViewing, fileName]);

  useEffect(() => {
    if (window.electronAPI) {
      Promise.all([
        window.electronAPI.store.get('theme'),
        window.electronAPI.store.get('discordEnabled'),
        window.electronAPI.store.get('autoUpdatesEnabled'),
        window.electronAPI.store.get('sidebarWidth'),
        window.electronAPI.store.get('shortcuts')
      ]).then(([theme, discordEnabled, autoUpdatesEnabled, savedSidebarWidth, shortcuts]) => {
        const resolvedTheme = resolveTheme(theme);
        const newSettings = {
          theme: resolvedTheme,
          discordEnabled: discordEnabled || false,
          autoUpdatesEnabled: autoUpdatesEnabled !== false,
          sidebarWidth: savedSidebarWidth || 300,
          shortcuts: shortcuts || { openFile: 'Control+O', print: 'Control+P', close: 'Escape' }
        };
        setSettings(newSettings);
        setSidebarWidth(newSettings.sidebarWidth);
        document.documentElement.setAttribute('data-theme', resolvedTheme);

        // Persist the migration so the legacy value isn't re-resolved on every launch.
        if (theme !== resolvedTheme) {
          window.electronAPI.store.set('theme', resolvedTheme);
        }
      });

      window.electronAPI.onOpenFile((content, name, path) => {
        setFileName(name);
        filePathRef.current = path;
        processMarkdown(content, path);
      });

      window.electronAPI.onFileChanged((content) => {
        // Live-reload on disk change; the path is unchanged, so read it from the ref.
        processMarkdown(content, filePathRef.current);
      });

      window.electronAPI.getAppVersion().then(version => setAppVersion(version));

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
    }
  }, [refreshRecentFiles, refreshDefaultAppStatus]);

  /*
   * Re-check the default-app association when the window regains focus.
   *
   * The only way to change it is in the Windows Settings app, which means leaving FATE. Coming back
   * is the exact moment the answer may have changed, and polling would be the wrong tool.
   */
  useEffect(() => {
    const onFocus = () => refreshDefaultAppStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshDefaultAppStatus]);

  /** Refresh recents whenever the home screen comes back into view. */
  useEffect(() => {
    if (!isViewing) refreshRecentFiles();
  }, [isViewing, refreshRecentFiles]);

  // Keyboard Shortcuts
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

    if (key === 'escape' && e.key.toLowerCase() === 'escape') return true;
    if (e.key.toLowerCase() === key) return true;
    return false;
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
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

      // Don't let Escape close the document out from under an open Settings modal.
      if (showSettings && matchesShortcut(e, settings.shortcuts.close)) {
        setShowSettings(false);
        return;
      }

      if (matchesShortcut(e, settings.shortcuts.close)) {
        closeDocument();
      } else if (matchesShortcut(e, settings.shortcuts.openFile)) {
        e.preventDefault();
        if (window.electronAPI) window.electronAPI.openFileDialog();
      } else if (matchesShortcut(e, settings.shortcuts.print) && isViewing) {
        e.preventDefault();
        window.print();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isViewing, settings.shortcuts, activeShortcutRebind, showSettings]);

  /*
   * Scroll progress + active-heading tracking.
   *
   * Deliberately does NOT depend on `activeHeading`. It used to, which meant the listener was torn
   * down and re-registered on every heading change mid-scroll — the opposite of cheap. The current
   * heading is read from `activeHeadingRef` instead, so the effect only re-runs when the document
   * itself changes.
   */
  useEffect(() => {
    if (!isViewing) return;
    const scrollContainer = contentRef.current;
    if (!scrollContainer) return;

    // Cache the heading elements once per document instead of querying on every frame.
    headingsRef.current = Array.from(scrollContainer.querySelectorAll('h1, h2, h3'));

    const handleScroll = () => {
      if (scrollRafIdRef.current !== null) return; // already scheduled for this frame

      scrollRafIdRef.current = requestAnimationFrame(() => {
        scrollRafIdRef.current = null;
        if (!contentRef.current) return;

        const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
        const totalScroll = scrollHeight - clientHeight;
        const progress = totalScroll > 0 ? (scrollTop / totalScroll) * 100 : 0;

        // Both written straight to the DOM — no setState, so no re-render of the markdown body.
        if (progressBarRef.current) {
          progressBarRef.current.style.width = `${progress}%`;
        }
        if (progressLabelRef.current) {
          progressLabelRef.current.textContent = `${Math.round(progress)}%`;
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

    // passive: true — the handler never calls preventDefault, so let the compositor scroll freely.
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // initial position

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (scrollRafIdRef.current !== null) {
        cancelAnimationFrame(scrollRafIdRef.current);
        scrollRafIdRef.current = null;
      }
    };
  }, [isViewing, fileContent]);

  const handleUpdateAction = () => {
    if (!window.electronAPI) return;
    if (updateAction === 'install') {
      window.electronAPI.installUpdate();
    } else {
      window.electronAPI.checkForUpdates();
    }
  };

  const onDrop = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file && file.name) {
      // Basic check to ensure it's not a directory
      if (file.size === 0 && file.type === '') {
        console.error("Dropped item appears to be a folder or empty file.");
        return;
      }
      setFileName(file.name);
      // Electron 32+ removed File.path; webUtils.getPathForFile is the supported replacement and is
      // exposed through the preload bridge. Falling back to file.path keeps browser dev mode working.
      const resolvedPath = window.electronAPI?.getPathForFile?.(file) ?? file.path ?? null;
      filePathRef.current = resolvedPath;
      const reader = new FileReader();
      reader.onload = (e) => {
        processMarkdown(e.target.result, resolvedPath);
      };
      reader.readAsText(file);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/markdown': ['.md', '.markdown', '.txt']
    },
    multiple: false,
    // The dropzone is a large surface; clicking it should still open the picker, but the explicit
    // "Open File" button below it is the discoverable path.
    noKeyboard: true
  });

  const scrollToHeading = (id) => {
    const element = document.getElementById(id);
    if (element && contentRef.current) {
      const topOffset = element.offsetTop - 40; // 40px padding
      contentRef.current.scrollTo({ top: topOffset, behavior: 'smooth' });
    }
  };

  function closeDocument() {
    setIsViewing(false);
    if (window.electronAPI) window.electronAPI.setTitle(null);
  }

  const openRecent = (entry) => {
    if (!window.electronAPI?.openRecentFile) return;
    window.electronAPI.openRecentFile(entry.path).then((res) => {
      // A file that vanished since the list rendered is dropped by the main process; reflect that.
      if (!res?.ok) refreshRecentFiles();
    });
  };

  const isWindows = defaultAppStatus?.supported === true;

  return (
    <div className="app-shell">
      {isViewing && (
        <div className="progress-bar-container">
          <div className="progress-bar" ref={progressBarRef} />
        </div>
      )}

      <div className="app-main">
        {!isViewing ? (
          /* ── HOME ─────────────────────────────────────────────────────────────────────── */
          <>
            {/*
              Ambient sky, home screen only.

              Rendered as a sibling of `.home` rather than a child, because `.home` is the scroll
              container — an absolutely-positioned canvas inside it would scroll away with the
              content. `.app-main` does not scroll, so the sky stays put.

              Mounting it here (instead of on the shell) also means its rAF loop is torn down the
              instant a document opens. Nothing animates behind a document you are trying to read.
            */}
            <Starfield />

            <div className="home">
            <header className="home-brand">
              <img src={fateLogo} alt="" className="brand-badge" />
              <h1 className="brand-wordmark">FATE</h1>
              <p className="brand-subtitle">Formatted Article &amp; Text Explorer</p>
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
                        {isDragActive ? 'Release to open' : 'Drag & drop a markdown file'}
                      </p>
                      <span className="dz-sub">.md &middot; .markdown &middot; .txt</span>
                    </>
                  )}
                </div>

                <button
                  className="btn btn-primary btn-open"
                  onClick={() => window.electronAPI?.openFileDialog()}
                >
                  <FolderOpen size={17} weight="duotone" />
                  Open File
                  <span className="kbd-group">
                    <kbd>Ctrl</kbd><kbd>O</kbd>
                  </span>
                </button>
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
                          <FileText size={17} weight="duotone" className="recent-icon" />
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
        ) : (
          /* ── VIEWER ───────────────────────────────────────────────────────────────────── */
          <div className="viewer-layout">
            {toc.length > 0 && isSidebarOpen && (
              <>
                <aside
                  className="sidebar"
                  style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px`, flexShrink: 0 }}
                >
                  <div className="sidebar-header">
                    <h3 className="section-label">Contents</h3>
                    <button
                      className="icon-btn"
                      onClick={() => setIsSidebarOpen(false)}
                      title="Hide contents"
                    >
                      <List size={16} weight="bold" />
                    </button>
                  </div>
                  <ul className="toc-list">
                    {toc.map((item) => (
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
              <div className="viewer-header">
                <div className="header-left">
                  {toc.length > 0 && !isSidebarOpen && (
                    <button
                      className="icon-btn"
                      onClick={() => setIsSidebarOpen(true)}
                      title="Show contents"
                    >
                      <List size={18} weight="bold" />
                    </button>
                  )}
                  <div className="file-info">
                    <FileText className="file-icon" size={19} weight="duotone" />
                    <span className="file-name">{fileName}</span>
                  </div>
                </div>

                <div className="header-right">
                  <button className="icon-btn" onClick={() => window.print()} title="Print / Export PDF">
                    <Printer size={17} weight="duotone" />
                  </button>
                  <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
                    <Gear size={17} weight="duotone" />
                  </button>
                  <button className="btn btn-secondary" onClick={closeDocument}>
                    <ArrowLeft size={15} weight="bold" />
                    Back
                  </button>
                </div>
              </div>

              <div className="markdown-container" ref={contentRef}>
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: fileContent }}
                />
              </div>
            </main>
          </div>
        )}
      </div>

      {/*
        Status bar — in the layout flow, not floating.
        The version readout, settings entry point and update control used to be absolutely
        positioned in the bottom corners, which meant they overlapped the dropzone and each other
        once the window got small. As a flex row at the bottom of the shell, overlap is structurally
        impossible at any window size.
      */}
      <footer className="status-bar">
        <button className="status-btn" onClick={() => setShowSettings(true)}>
          <Gear size={15} weight="duotone" />
          <span className="status-btn-label">Settings</span>
        </button>

        <span className="status-divider" />
        <span className="status-version">v{appVersion || '—'}</span>

        {isViewing && (
          <>
            <span className="status-divider" />
            <span className="status-read">
              <span ref={progressLabelRef}>0%</span> read
            </span>
          </>
        )}

        <span className="status-spacer" />

        {isWindows && defaultAppStatus?.isDefault && (
          <span className="status-badge" title="FATE opens .md files by default">
            <CheckCircle size={13} weight="fill" />
            Default for .md
          </span>
        )}

        <button
          className={`status-btn ${updateAction === 'install' ? 'accent' : ''}`}
          onClick={handleUpdateAction}
          title="Check for updates"
        >
          {updateStatus || 'Check for updates'}
        </button>
      </footer>

      {showSettings && (
        <div className="settings-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Settings">
            <div className="settings-header">
              <h2>Settings</h2>
              <button className="icon-btn" onClick={() => setShowSettings(false)} title="Close">
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="settings-body">
              <div className="setting-group">
                <h3 className="section-label">Appearance</h3>
                <div className="setting-item">
                  <span className="setting-label">Theme</span>
                  <select value={settings.theme} onChange={e => updateSetting('theme', e.target.value)}>
                    {THEMES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Default sidebar width</span>
                  <input type="number" min="150" max="800" value={settings.sidebarWidth} onChange={e => {
                    const val = parseInt(e.target.value);
                    updateSetting('sidebarWidth', val);
                    setSidebarWidth(val);
                  }} />
                </div>
              </div>

              {isWindows && (
                <div className="setting-group">
                  <h3 className="section-label">Windows Integration</h3>
                  <div className="setting-item setting-item-stacked">
                    <div className="setting-label-block">
                      <span className="setting-label">Default app for Markdown files</span>
                      <span className="setting-hint">
                        {defaultAppStatus.isDefault ? (
                          <>
                            <CheckCircle size={12} weight="fill" className="hint-ok" />
                            {' '}FATE currently opens <code>.md</code> files.
                          </>
                        ) : (
                          <>
                            {defaultAppStatus.currentProgId
                              ? <>Another app currently opens <code>.md</code> files. </>
                              : <>No app is set for <code>.md</code> files yet. </>}
                            Windows requires you to confirm this change itself — apps aren&apos;t
                            allowed to claim a file type silently.
                          </>
                        )}
                      </span>
                    </div>
                    <button
                      className={`btn ${defaultAppStatus.isDefault ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => window.electronAPI?.requestDefaultApp()}
                    >
                      <ArrowSquareOut size={15} weight="bold" />
                      {defaultAppStatus.isDefault ? 'Manage' : 'Set as default'}
                    </button>
                  </div>
                </div>
              )}

              <div className="setting-group">
                <h3 className="section-label">Integrations &amp; Updates</h3>
                <div className="setting-item">
                  <span className="setting-label">Show filename on Discord</span>
                  <label className="switch">
                    <input type="checkbox" checked={settings.discordEnabled} onChange={e => updateSetting('discordEnabled', e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Automatic updates</span>
                  <label className="switch">
                    <input type="checkbox" checked={settings.autoUpdatesEnabled} onChange={e => updateSetting('autoUpdatesEnabled', e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div className="setting-group">
                <h3 className="section-label">Keyboard Shortcuts</h3>
                {['openFile', 'print', 'close'].map(action => (
                  <div className="setting-item" key={action}>
                    <span className="setting-label">
                      {action === 'openFile' ? 'Open file' : action === 'print' ? 'Print / export PDF' : 'Close file'}
                    </span>
                    <button
                      className={`shortcut-btn ${activeShortcutRebind === action ? 'recording' : ''}`}
                      onClick={() => setActiveShortcutRebind(activeShortcutRebind === action ? null : action)}
                    >
                      {activeShortcutRebind === action ? 'Press keys…' : settings.shortcuts[action]}
                    </button>
                  </div>
                ))}
              </div>

              <div className="setting-group setting-group-about">
                <h3 className="section-label">About</h3>
                <div className="about-row">
                  <img src={fateLogo} alt="" className="about-badge" />
                  <div className="about-text">
                    <span className="about-name">FATE <span className="about-version">v{appVersion}</span></span>
                    <span className="about-sub">Formatted Article &amp; Text Explorer</span>
                    <span className="about-credit">
                      Provided by VagueDustin Enterprises&trade; &middot; &copy; {new Date().getFullYear()} FATE
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
