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

function App() {
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const filePathRef = useRef(null);
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
    theme: 'dark',
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
  const progressBarRef = useRef(null);
  const activeHeadingRef = useRef('');
  const scrollRafId = useRef(null);
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
    
    // Repair mathematically corrupted control-characters from unescaped markdown generators
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
        const newSettings = {
          theme: theme || 'dark',
          discordEnabled: discordEnabled || false,
          autoUpdatesEnabled: autoUpdatesEnabled !== false,
          sidebarWidth: savedSidebarWidth || 300,
          shortcuts: shortcuts || { openFile: 'Control+O', print: 'Control+P', close: 'Escape' }
        };
        setSettings(newSettings);
        setSidebarWidth(newSettings.sidebarWidth);
        document.documentElement.setAttribute('data-theme', newSettings.theme);
      });
      window.electronAPI.onOpenFile((content, name, path) => {
        setFileName(name);
        filePathRef.current = path;
        processMarkdown(content, path);
      });

      window.electronAPI.onFileChanged((content) => {
        // Keep the same path
        processMarkdown(content, filePathRef.current);
      });

      window.electronAPI.getAppVersion().then(version => setAppVersion(version));

      window.electronAPI.onUpdateMessage((message, action) => {
        setUpdateStatus(message);
        setUpdateAction(action);
      });

      window.electronAPI.appReady();
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
  }, [isViewing, settings.shortcuts, activeShortcutRebind]);

  // Scroll Progress and Active Heading Tracking
  useEffect(() => {
    const handleScroll = () => {
      if (scrollRafId.current) return;

      scrollRafId.current = requestAnimationFrame(() => {
        scrollRafId.current = null;
        if (!contentRef.current) return;

        // Update scroll progress bar directly to avoid React re-renders on every scroll tick
        const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
        const progress = (scrollTop / (scrollHeight - clientHeight)) * 100;

        if (progressBarRef.current) {
          progressBarRef.current.style.width = `${progress || 0}%`;
        }

        // Identify the active heading for TOC highlighting
        const headings = Array.from(contentRef.current.querySelectorAll('h1, h2, h3'));
        let currentActive = activeHeadingRef.current;

        for (const h of headings) {
          const rect = h.getBoundingClientRect();
          if (rect.top <= window.innerHeight * 0.4) {
            currentActive = h.id;
          } else {
            break;
          }
        }

        if (headings.length > 0 && currentActive === '' && headings[0].getBoundingClientRect().top > window.innerHeight * 0.4) {
          currentActive = headings[0].id;
        }

        // Only trigger a state update if the active heading has actually changed
        if (currentActive !== activeHeadingRef.current) {
          activeHeadingRef.current = currentActive;
          setActiveHeading(currentActive);
        }
      });
    };

    const scrollContainer = contentRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      handleScroll(); // Initial check
    }

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', handleScroll);
      }
      if (scrollRafId.current) {
        cancelAnimationFrame(scrollRafId.current);
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
      filePathRef.current = file.path || null; // path is available in Electron via webkitRelativePath or path property
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        processMarkdown(text, file.path || null);
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
            <img src={fateLogo} alt="FATE Logo" className="fate-logo" style={{ width: 'clamp(60px, 15vh, 120px)', height: 'clamp(60px, 15vh, 120px)', marginBottom: '1rem', borderRadius: '24px', boxShadow: '0 8px 32px rgba(230, 57, 70, 0.2)' }} />
            <h1>FATE</h1>
            <p>Formatted Article & Text Explorer</p>
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
                  <List size={20} weight="bold" className="menu-icon" onClick={() => setIsSidebarOpen(false)} />
                  <h3>Table of Contents</h3>
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
                  <List className="menu-icon" size={24} weight="bold" onClick={() => setIsSidebarOpen(true)} style={{marginRight: '1rem', color: '#c9d1d9'}} />
                )}
                <div className="file-info">
                  <FileText className="file-icon" size={24} weight="duotone" />
                  {fileName}
                </div>
              </div>
              <button className="action-btn" onClick={() => {
                setIsViewing(false);
                if (window.electronAPI) window.electronAPI.setTitle('FATE');
              }}>
                <ArrowLeft size={18} weight="bold" />
                Back
              </button>
            </div>
            <div 
              className="markdown-container" 
              ref={contentRef}
            >
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
          <div className="settings-trigger" onClick={() => setShowSettings(true)}>
            <Gear size={24} weight="duotone" />
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
              <X size={24} className="close-icon" onClick={() => setShowSettings(false)} />
            </div>
            
            <div className="settings-body">
              <div className="setting-group">
                <h3>Appearance</h3>
                <div className="setting-item">
                  <span>Theme</span>
                  <select value={settings.theme} onChange={e => updateSetting('theme', e.target.value)}>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="dracula">Dracula</option>
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
                <h3>Integrations & Updates</h3>
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
                      {activeShortcutRebind === action ? 'Press new shortcut...' : settings.shortcuts[action]}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
