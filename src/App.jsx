import { useState, useEffect, useRef, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import markedKatex from 'marked-katex-extension';
import 'katex/dist/katex.min.css';
import { UploadSimple, FileText, ArrowLeft, List, CircleNotch, Gear, X } from '@phosphor-icons/react';
import fateLogo from './assets/FATE-Square-Icon.png';
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
 *
 * `fate` is the default as of 1.5.0 — VagueDustin Enterprises navy & gold at the utility ornament
 * tier. `crimson` is the pre-1.5.0 red look, kept so the rebrand doesn't force anyone off it.
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
 * Unrecognised values fall back the same way rather than breaking the UI.
 */
function resolveTheme(stored) {
  if (VALID_THEMES.includes(stored)) return stored;
  return DEFAULT_THEME; // covers legacy 'dark', null, and anything unexpected
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
   * node in it — on every tick. These four refs are what make scrolling free:
   *
   *   progressBarRef   the progress bar's width is written directly to the DOM, bypassing React
   *   headingsRef      querySelectorAll('h1,h2,h3') is cached per document, not re-run per frame
   *   activeHeadingRef the current heading is compared against a ref so setState only fires on
   *                    an actual change (and so the effect need not depend on `activeHeading`)
   *   scrollRafIdRef   one rAF in flight at a time = the handler runs at frame cadence, no more
   *   filePathRef      never rendered, so it has no business being state
   */
  const progressBarRef = useRef(null);
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

    setToc(tocData);
    setIsSidebarOpen(tocData.length > 0);
    setFileContent(tempDiv.innerHTML);
    setIsLoading(false);
    setIsViewing(true);

    if (window.electronAPI) {
      window.electronAPI.setTitle(`FATE - ${fPath ? fPath.split(/[/\\]/).pop() : 'Document'}`);
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

        // Persist the migration so the legacy value doesn't get re-resolved on every launch.
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

      window.electronAPI.appReady();
    } else {
      // Browser dev mode (`npm run dev` without Electron): no store to read from.
      document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
    }
  }, []);

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
        setIsViewing(false);
        if (window.electronAPI) window.electronAPI.setTitle('FATE');
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

        // Written straight to the DOM — no setState, so no re-render of the markdown body.
        if (progressBarRef.current) {
          progressBarRef.current.style.width = `${progress}%`;
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
        const text = e.target.result;
        processMarkdown(text, resolvedPath);
      };
      reader.readAsText(file);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/markdown': ['.md', '.markdown', '.txt']
    },
    multiple: false
  });

  const scrollToHeading = (id) => {
    const element = document.getElementById(id);
    if (element && contentRef.current) {
      const topOffset = element.offsetTop - 40; // 40px padding
      contentRef.current.scrollTo({ top: topOffset, behavior: 'smooth' });
    }
  };

  const closeDocument = () => {
    setIsViewing(false);
    if (window.electronAPI) window.electronAPI.setTitle('FATE');
  };

  return (
    <div className="app-container">
      {isViewing && (
        <div className="progress-bar-container">
          <div className="progress-bar" ref={progressBarRef} />
        </div>
      )}

      {!isViewing ? (
        <div className="upload-view">
          <div className="header">
            <img src={fateLogo} alt="" className="fate-logo" />
            <h1>FATE</h1>
            <p className="subtitle">Formatted Article &amp; Text Explorer</p>
            <p className="enterprise-text">Provided by VagueDustin Enterprises&trade;</p>
          </div>

          <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
            <input {...getInputProps()} />
            {isLoading ? (
              <>
                <CircleNotch className="icon spinner" weight="bold" />
                <p>Rendering document...</p>
              </>
            ) : (
              <>
                <UploadSimple className="icon" weight="duotone" />
                <p>{isDragActive ? "Drop the markdown file here" : "Drag & drop a markdown file"}</p>
                <span className="sub-text">or click to select a file (.md, .markdown)</span>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="viewer-layout">
          {toc.length > 0 && isSidebarOpen && (
            <>
              <aside className="sidebar" style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px`, flexShrink: 0 }}>
                <div className="sidebar-header">
                  <List size={18} weight="bold" className="menu-icon" onClick={() => setIsSidebarOpen(false)} />
                  <h3>Contents</h3>
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
                  <List className="menu-icon" size={22} weight="bold" onClick={() => setIsSidebarOpen(true)} />
                )}
                <div className="file-info">
                  <FileText className="file-icon" size={22} weight="duotone" />
                  {fileName}
                </div>
              </div>
              <button className="action-btn" onClick={closeDocument}>
                <ArrowLeft size={16} weight="bold" />
                Back
              </button>
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

      {appVersion && !isViewing && (
        <>
          <div className="settings-trigger" onClick={() => setShowSettings(true)} title="Settings">
            <Gear size={22} weight="duotone" />
          </div>
          <div className="version-container">
            <span className="version-text">v{appVersion}</span>
            <button className="update-btn" onClick={handleUpdateAction}>
              {updateStatus ? updateStatus : "Check for updates"}
            </button>
          </div>
        </>
      )}

      {showSettings && (
        <div className="settings-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h2>Settings</h2>
              <X size={22} className="close-icon" onClick={() => setShowSettings(false)} />
            </div>

            <div className="settings-body">
              <div className="setting-group">
                <h3>Appearance</h3>
                <div className="setting-item">
                  <span>Theme</span>
                  <select value={settings.theme} onChange={e => updateSetting('theme', e.target.value)}>
                    {THEMES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="setting-item">
                  <span>Default Sidebar Width (px)</span>
                  <input type="number" min="150" max="800" value={settings.sidebarWidth} onChange={e => {
                    const val = parseInt(e.target.value);
                    updateSetting('sidebarWidth', val);
                    setSidebarWidth(val);
                  }} />
                </div>
              </div>

              <div className="setting-group">
                <h3>Integrations &amp; Updates</h3>
                <div className="setting-item">
                  <span>Show filename on Discord RPC</span>
                  <label className="switch">
                    <input type="checkbox" checked={settings.discordEnabled} onChange={e => updateSetting('discordEnabled', e.target.checked)} />
                    <span className="slider round"></span>
                  </label>
                </div>
                <div className="setting-item">
                  <span>Automatic Updates</span>
                  <label className="switch">
                    <input type="checkbox" checked={settings.autoUpdatesEnabled} onChange={e => updateSetting('autoUpdatesEnabled', e.target.checked)} />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>

              <div className="setting-group">
                <h3>Keyboard Shortcuts</h3>
                {['openFile', 'print', 'close'].map(action => (
                  <div className="setting-item" key={action}>
                    <span>{action === 'openFile' ? 'Open File' : action === 'print' ? 'Print / Export PDF' : 'Close File / Return Home'}</span>
                    <button
                      className={`shortcut-btn ${activeShortcutRebind === action ? 'recording' : ''}`}
                      onClick={() => setActiveShortcutRebind(activeShortcutRebind === action ? null : action)}
                    >
                      {activeShortcutRebind === action ? 'Press keys...' : settings.shortcuts[action]}
                    </button>
                  </div>
                ))}
              </div>

              <div className="setting-group">
                <h3>About</h3>
                <div className="setting-item">
                  <span>FATE — Formatted Article &amp; Text Explorer</span>
                  <span className="version-text">v{appVersion}</span>
                </div>
                <p className="enterprise-text" style={{ marginTop: '0.5rem', textAlign: 'left' }}>
                  Provided by VagueDustin Enterprises&trade; &middot; &copy; {new Date().getFullYear()} FATE. All rights reserved.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
