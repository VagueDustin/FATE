import { useState, useEffect, useRef, useMemo } from 'react';
import {
  X, Palette, TextAa, Code, Printer, WindowsLogo, Keyboard, Info,
  CaretDown, Check, Trash, ArrowSquareOut, CheckCircle, Plus, Copy, ArrowCounterClockwise,
  Warning
} from '@phosphor-icons/react';
import fateLogo from '../assets/FATE-Square-Icon.png';
import { THEMES, PAGE_SIZES, SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, FIXED_SHORTCUTS } from '../settingsMeta.js';
import { PROSE_FONTS, CODE_FONTS } from '../fonts.js';
import { CODE_EXTENSIONS } from '../fileKinds.js';
import { DEFAULT_CUSTOM, CUSTOM_FIELDS, customThemeCss } from '../themeCustom.js';

/**
 * SettingsModal — navigation rail + content pane (1.10.0 redesign, extended in 1.11.0 with the
 * full keybinding editor, the custom theme builder, and the association tools).
 *
 * Design notes:
 *   - Theme cards render INSIDE their own theme via data-theme scoping — previews come from the
 *     theme's real tokens, never hand-kept swatches. The custom theme's card works the same way
 *     because its block is injected as real CSS (see src/themeCustom.js).
 *   - FontPicker is a custom listbox because a native <select> cannot render each option in its
 *     own typeface.
 *   - Everything stays token-driven; no colour literal in this file or its CSS.
 */

const PROSE_SAMPLE = 'The quick brown fox jumps over the lazy dog.';
const CODE_SAMPLE = 'const sum = (a, b) => a !== b ? a + b : 0;';

function FontPicker({ value, options, onChange, mono }) {
  const [open, setOpen] = useState(false);
  /* Opens UPWARD when the button sits low in the viewport — the list is absolutely positioned
     inside the modal's scroll pane, so opening down near the bottom clipped it (user-reported). */
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef(null);

  const toggleOpen = () => {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      setOpenUp(window.innerHeight - rect.bottom < 320);
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    // Capture-phase Escape closes ONLY the picker; the app-level handler skips defaultPrevented.
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const current = options.find((o) => o.id === value) || options[0];

  return (
    <div className="font-picker" ref={rootRef}>
      <button
        type="button"
        className="font-picker-btn"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ fontFamily: current.stack }}
      >
        <span className="fp-current">{current.label}</span>
        <CaretDown size={13} weight="bold" className={`fp-caret ${open ? 'up' : ''}`} />
      </button>

      {open && (
        <ul className={`font-picker-list ${openUp ? 'up' : ''}`} role="listbox">
          {options.map((o) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={`fp-option ${o.id === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              <span className="fp-texts">
                <span className="fp-name" style={{ fontFamily: o.stack }}>
                  {o.label}
                  {o.ligatures && <span className="fp-tag">ligatures</span>}
                </span>
                <span className="fp-sample" style={{ fontFamily: o.stack }}>
                  {mono ? CODE_SAMPLE : PROSE_SAMPLE}
                </span>
              </span>
              {o.id === value && <Check size={14} weight="bold" className="fp-check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SizeSlider({ label, value, min, max, suffix = 'px', onChange }) {
  return (
    <div className="setting-item">
      <span className="setting-label">{label}</span>
      <span className="size-slider">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
        />
        <span className="size-readout">{value}{suffix}</span>
      </span>
    </div>
  );
}

/** Pretty-print a stored binding ("Control+Shift+S" → chips). */
function BindingChips({ binding }) {
  const parts = (binding || '').split('+').map((p) => (p === 'Control' ? 'Ctrl' : p));
  return (
    <span className="kbd-group">
      {parts.map((p, i) => <kbd key={i}>{p}</kbd>)}
    </span>
  );
}

function SettingsModal({
  onClose,
  settings,
  updateSetting,
  appVersion,
  defaultAppStatus,
  requestDefaultApp,
  activeShortcutRebind,
  setActiveShortcutRebind,
  onSidebarWidthChange,
  runtimeInfo
}) {
  const [section, setSection] = useState('appearance');
  const [coverage, setCoverage] = useState(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimedCount, setClaimedCount] = useState(0);
  const [classicMenu, setClassicMenu] = useState(null);
  const [explorerRestartNeeded, setExplorerRestartNeeded] = useState(false);
  const [newOverrideExt, setNewOverrideExt] = useState('');
  const [customDraft, setCustomDraft] = useState(settings.customTheme || DEFAULT_CUSTOM);
  const [copied, setCopied] = useState(false);

  const isWindows = defaultAppStatus?.supported === true;
  const fonts = settings.fonts;
  const setFonts = (patch) => updateSetting('fonts', { ...fonts, ...patch });

  const sections = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'fonts', label: 'Fonts', icon: TextAa },
    { id: 'editor', label: 'Code Editor', icon: Code },
    { id: 'printing', label: 'Printing', icon: Printer },
    ...(isWindows ? [{ id: 'windows', label: 'Windows', icon: WindowsLogo }] : []),
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
    { id: 'about', label: 'About', icon: Info }
  ];

  const refreshCoverage = () => {
    if (window.electronAPI?.getAssociationCoverage) {
      window.electronAPI.getAssociationCoverage().then(setCoverage).catch(() => {});
    }
    if (window.electronAPI?.getClaimedTypes) {
      window.electronAPI.getClaimedTypes().then((l) => setClaimedCount(l.length)).catch(() => {});
    }
    if (window.electronAPI?.getClassicMenu) {
      window.electronAPI.getClassicMenu().then(setClassicMenu).catch(() => {});
    }
  };

  const toggleClassicMenu = async (enabled) => {
    const res = await window.electronAPI?.setClassicMenu?.(enabled);
    if (res?.ok) {
      setClassicMenu(enabled);
      setExplorerRestartNeeded(true);
    }
  };

  /* Association coverage runs a registry sweep — fetched only when its section opens. */
  useEffect(() => {
    if (section === 'windows') refreshCoverage();
  }, [section]);

  const claimTypes = async () => {
    setClaimBusy(true);
    await window.electronAPI?.claimUnclaimedTypes?.();
    refreshCoverage();
    setClaimBusy(false);
  };

  const releaseTypes = async () => {
    setClaimBusy(true);
    await window.electronAPI?.releaseClaimedTypes?.();
    refreshCoverage();
    setClaimBusy(false);
  };

  const overrides = Object.entries(fonts.perType);
  const overridableExts = CODE_EXTENSIONS.filter((ext) => !(ext in fonts.perType));

  const addOverride = () => {
    if (!newOverrideExt) return;
    setFonts({ perType: { ...fonts.perType, [newOverrideExt]: fonts.code } });
    setNewOverrideExt('');
  };

  const removeOverride = (ext) => {
    const next = { ...fonts.perType };
    delete next[ext];
    setFonts({ perType: next });
  };

  /* Duplicate bindings — flagged inline rather than silently letting first-match win. */
  const conflicts = useMemo(() => {
    const seen = {};
    const dupes = new Set();
    for (const { id } of SHORTCUT_ACTIONS) {
      const b = settings.shortcuts[id];
      if (!b) continue;
      if (seen[b]) {
        dupes.add(b);
      }
      seen[b] = id;
    }
    return dupes;
  }, [settings.shortcuts]);

  const saveCustomTheme = () => {
    updateSetting('customTheme', customDraft);
    updateSetting('theme', 'custom');
  };

  const removeCustomTheme = () => {
    if (settings.theme === 'custom') updateSetting('theme', 'fate');
    updateSetting('customTheme', null);
    setCustomDraft(DEFAULT_CUSTOM);
  };

  const copyCustomCss = async () => {
    try {
      await navigator.clipboard.writeText(customThemeCss(customDraft));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — nothing sensible to do */
    }
  };

  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-nav-title">
            <h2>Settings</h2>
          </div>
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                className={`settings-nav-item ${section === s.id ? 'active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                <Icon size={16} weight="duotone" />
                {s.label}
              </button>
            );
          })}
          <div className="settings-nav-foot">
            <span className="settings-nav-version">v{appVersion || '—'}</span>
          </div>
        </nav>

        <div className="settings-content">
          <div className="settings-content-head">
            <h3 className="section-label">{sections.find((s) => s.id === section)?.label}</h3>
            <button className="icon-btn" onClick={onClose} title="Close (Esc)">
              <X size={18} weight="bold" />
            </button>
          </div>

          <div className="settings-body">
            {/* ── APPEARANCE ─────────────────────────────────────────────────────────────── */}
            {section === 'appearance' && (
              <>
                <div className="setting-group">
                  <span className="group-caption">Theme</span>
                  <div className="theme-grid">
                    {THEMES.map((t) => (
                      <button
                        key={t.value}
                        data-theme={t.value}
                        className={`theme-card ${settings.theme === t.value ? 'selected' : ''}`}
                        onClick={() => updateSetting('theme', t.value)}
                        aria-pressed={settings.theme === t.value}
                      >
                        <span className="tc-preview">
                          <span className="tc-chrome" />
                          <span className="tc-line wide" />
                          <span className="tc-line" />
                          <span className="tc-line narrow" />
                          <span className="tc-accent" />
                        </span>
                        <span className="tc-label">{t.label}</span>
                        <span className="tc-sub">{t.sub}</span>
                        {settings.theme === t.value && (
                          <CheckCircle size={15} weight="fill" className="tc-check" />
                        )}
                      </button>
                    ))}
                    {settings.customTheme && (
                      <button
                        data-theme="custom"
                        className={`theme-card ${settings.theme === 'custom' ? 'selected' : ''}`}
                        onClick={() => updateSetting('theme', 'custom')}
                        aria-pressed={settings.theme === 'custom'}
                      >
                        <span className="tc-preview">
                          <span className="tc-chrome" />
                          <span className="tc-line wide" />
                          <span className="tc-line" />
                          <span className="tc-line narrow" />
                          <span className="tc-accent" />
                        </span>
                        <span className="tc-label">Custom</span>
                        <span className="tc-sub">Your palette</span>
                        {settings.theme === 'custom' && (
                          <CheckCircle size={15} weight="fill" className="tc-check" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div className="setting-group">
                  <span className="group-caption">Custom theme</span>
                  <p className="setting-hint group-hint">
                    Pick seven colours; FATE derives the rest — borders, glows, gradients and a full
                    syntax palette — so the result hangs together like the built-in themes. Copy CSS
                    exports the generated token block.
                  </p>
                  <div className="custom-theme-grid">
                    {CUSTOM_FIELDS.map((f) => (
                      <label className="custom-color" key={f.key}>
                        <input
                          type="color"
                          value={customDraft[f.key]}
                          onChange={(e) => setCustomDraft((c) => ({ ...c, [f.key]: e.target.value.toUpperCase() }))}
                        />
                        <span className="custom-color-label">{f.label}</span>
                        <code className="custom-color-hex">{customDraft[f.key]}</code>
                      </label>
                    ))}
                  </div>
                  <div className="custom-theme-actions">
                    <button className="btn btn-primary btn-compact" onClick={saveCustomTheme}>
                      <Check size={14} weight="bold" />
                      {settings.customTheme ? 'Update & apply' : 'Create & apply'}
                    </button>
                    <button className="btn btn-secondary btn-compact" onClick={copyCustomCss}>
                      <Copy size={14} weight="bold" />
                      {copied ? 'Copied!' : 'Copy CSS'}
                    </button>
                    {settings.customTheme && (
                      <button className="btn btn-secondary btn-compact" onClick={removeCustomTheme}>
                        <Trash size={14} weight="bold" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="setting-group">
                  <span className="group-caption">Layout &amp; startup</span>
                  <div className="setting-item">
                    <span className="setting-label">Default sidebar width</span>
                    <input
                      type="number"
                      min="150"
                      max="800"
                      value={settings.sidebarWidth}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (Number.isFinite(val)) {
                          updateSetting('sidebarWidth', val);
                          onSidebarWidthChange(val);
                        }
                      }}
                    />
                  </div>
                  <div className="setting-item">
                    <span className="setting-label">Reopen last session&apos;s tabs on launch</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={settings.restoreSession}
                        onChange={(e) => updateSetting('restoreSession', e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* ── FONTS ──────────────────────────────────────────────────────────────────── */}
            {section === 'fonts' && (
              <>
                <div className="setting-group">
                  <span className="group-caption">Interface</span>
                  <div className="setting-item">
                    <span className="setting-label">Application font</span>
                    <FontPicker value={fonts.ui} options={PROSE_FONTS} onChange={(id) => setFonts({ ui: id })} />
                  </div>
                </div>

                <div className="setting-group">
                  <span className="group-caption">Markdown documents</span>
                  <div className="setting-item">
                    <span className="setting-label">Document font</span>
                    <FontPicker value={fonts.markdown} options={PROSE_FONTS} onChange={(id) => setFonts({ markdown: id })} />
                  </div>
                  <SizeSlider label="Document text size" value={fonts.markdownSize} min={12} max={22} onChange={(v) => setFonts({ markdownSize: v })} />
                </div>

                <div className="setting-group">
                  <span className="group-caption">Code</span>
                  <div className="setting-item">
                    <span className="setting-label">Code font</span>
                    <FontPicker mono value={fonts.code} options={CODE_FONTS} onChange={(id) => setFonts({ code: id })} />
                  </div>
                  <SizeSlider label="Editor text size" value={fonts.editorSize} min={10} max={20} onChange={(v) => setFonts({ editorSize: v })} />
                  <div className="setting-item">
                    <span className="setting-label">Font ligatures</span>
                    <label className="switch">
                      <input type="checkbox" checked={fonts.ligatures} onChange={(e) => setFonts({ ligatures: e.target.checked })} />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div className="setting-group">
                  <span className="group-caption">Per-file-type fonts</span>
                  <p className="setting-hint group-hint">
                    Give any file type its own code font — every open tab of that type follows.
                    Types without an override use the code font above.
                  </p>

                  {overrides.map(([ext, fontId]) => (
                    <div className="override-row" key={ext}>
                      <code className="override-ext">.{ext}</code>
                      <FontPicker
                        mono
                        value={fontId}
                        options={CODE_FONTS}
                        onChange={(id) => setFonts({ perType: { ...fonts.perType, [ext]: id } })}
                      />
                      <button className="icon-btn override-remove" onClick={() => removeOverride(ext)} title={`Remove .${ext} override`}>
                        <Trash size={14} weight="bold" />
                      </button>
                    </div>
                  ))}

                  <div className="override-row override-add">
                    <select value={newOverrideExt} onChange={(e) => setNewOverrideExt(e.target.value)} aria-label="File type to override">
                      <option value="">Choose a file type…</option>
                      {overridableExts.map((ext) => (
                        <option key={ext} value={ext}>.{ext}</option>
                      ))}
                    </select>
                    <button className="btn btn-secondary btn-compact" onClick={addOverride} disabled={!newOverrideExt}>
                      <Plus size={14} weight="bold" />
                      Add override
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ── CODE EDITOR ────────────────────────────────────────────────────────────── */}
            {section === 'editor' && (
              <div className="setting-group">
                <div className="setting-item">
                  <span className="setting-label">Wrap long lines</span>
                  <label className="switch">
                    <input type="checkbox" checked={settings.editorWrap} onChange={(e) => updateSetting('editorWrap', e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Indent size</span>
                  <select value={settings.editorTabSize} onChange={(e) => updateSetting('editorTabSize', parseInt(e.target.value, 10))}>
                    <option value={2}>2 spaces</option>
                    <option value={4}>4 spaces</option>
                    <option value={8}>8 spaces</option>
                  </select>
                </div>
                <div className="setting-item setting-item-stacked">
                  <div className="setting-label-block">
                    <span className="setting-label">Editing</span>
                    <span className="setting-hint">
                      Code files open straight into the editor; markdown opens in the reading view
                      with an <code>Edit</code> button (and live preview) in the header. New files
                      (<code>Ctrl</code>+<code>N</code>) save as any supported format. Fonts live in
                      the Fonts section; every shortcut is rebindable under Shortcuts.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── PRINTING ───────────────────────────────────────────────────────────────── */}
            {section === 'printing' && (
              <div className="setting-group">
                <div className="setting-item">
                  <span className="setting-label">Paper size</span>
                  <select value={settings.printPageSize} onChange={(e) => updateSetting('printPageSize', e.target.value)}>
                    {PAGE_SIZES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Landscape</span>
                  <label className="switch">
                    <input type="checkbox" checked={settings.printLandscape} onChange={(e) => updateSetting('printLandscape', e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="setting-item setting-item-stacked">
                  <div className="setting-label-block">
                    <span className="setting-label">Preview &amp; export</span>
                    <span className="setting-hint">
                      Printing opens a page-by-page preview. Exports carry heading bookmarks and
                      page numbers, and always print on white regardless of your theme. Code files
                      print the full buffer in black monospace; with a split open, only the active
                      pane prints.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── WINDOWS ────────────────────────────────────────────────────────────────── */}
            {section === 'windows' && isWindows && (
              <>
                <div className="setting-group">
                  <span className="group-caption">Markdown default</span>
                  <div className="setting-item setting-item-stacked">
                    <div className="setting-label-block">
                      <span className="setting-label">Default app for Markdown files</span>
                      <span className="setting-hint">
                        {defaultAppStatus.isDefault ? (
                          <>
                            <CheckCircle size={12} weight="fill" className="hint-ok" />
                            {' '}FATE currently opens <code>.md</code> files. Manage opens Windows
                            Settings if you want to change it.
                          </>
                        ) : (
                          <>
                            {defaultAppStatus.currentProgId
                              ? <>Another app currently opens <code>.md</code> files. </>
                              : <>No app is set for <code>.md</code> files yet. </>}
                            Opens FATE&apos;s page in Windows Settings, where you pick FATE for{' '}
                            <code>.md</code>. Windows requires you to confirm this itself.
                          </>
                        )}
                      </span>
                    </div>
                    <button
                      className={`btn ${defaultAppStatus.isDefault ? 'btn-secondary' : 'btn-primary'} btn-compact`}
                      onClick={requestDefaultApp}
                    >
                      <ArrowSquareOut size={15} weight="bold" />
                      {defaultAppStatus.isDefault ? 'Manage' : 'Set as default'}
                    </button>
                  </div>
                </div>

                <div className="setting-group">
                  <span className="group-caption">All supported file types</span>
                  <div className="coverage-card">
                    <div className="coverage-numbers">
                      <span className="coverage-count">
                        {coverage ? coverage.ours : '…'}
                        <span className="coverage-total"> / {coverage ? coverage.total : '…'}</span>
                      </span>
                      <span className="coverage-caption">file types currently open with FATE</span>
                    </div>
                    <div className="coverage-actions">
                      {coverage && coverage.claimable?.length > 0 && (
                        <button className="btn btn-primary btn-compact" onClick={claimTypes} disabled={claimBusy}>
                          <Check size={14} weight="bold" />
                          {claimBusy ? 'Working…' : `Claim ${coverage.claimable.length} unclaimed types`}
                        </button>
                      )}
                      <button className="btn btn-secondary btn-compact" onClick={requestDefaultApp}>
                        <ArrowSquareOut size={14} weight="bold" />
                        Choose in Windows
                      </button>
                    </div>
                  </div>
                  <p className="setting-hint group-hint">
                    The count reflects what double-clicking would actually launch — your confirmed
                    choices, plus every type where FATE is the only registered handler.
                    <strong> Claim</strong> takes the types no app owns at all (per-user and fully
                    reversible); types owned by another app can only be reassigned on FATE&apos;s
                    page in Windows Settings — Windows enforces that one-click-per-type itself.
                  </p>
                  {claimedCount > 0 && (
                    <button className="link-btn" onClick={releaseTypes} disabled={claimBusy}>
                      <ArrowCounterClockwise size={13} weight="bold" />
                      Release the {claimedCount} types FATE claimed
                    </button>
                  )}
                </div>

                <div className="setting-group">
                  <span className="group-caption">Context menu</span>
                  <div className="setting-item setting-item-stacked">
                    <div className="setting-label-block">
                      <span className="setting-label">&quot;Edit in FATE&quot; placement</span>
                      <span className="setting-hint">
                        FATE adds <strong>Edit in FATE</strong> to every file&apos;s right-click menu.
                        Windows 11 tucks classic entries under <em>Show more options</em>; top-level
                        placement requires a signed system component that apps like Notepad++ ship
                        separately. The switch below is the practical alternative: it restores the
                        full classic menu everywhere — with Edit in FATE at the top level.
                      </span>
                    </div>
                  </div>
                  <div className="setting-item">
                    <span className="setting-label">Always show full context menus</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={classicMenu === true}
                        disabled={classicMenu === null}
                        onChange={(e) => toggleClassicMenu(e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                  {explorerRestartNeeded && (
                    <div className="setting-item setting-item-stacked">
                      <div className="setting-label-block">
                        <span className="setting-hint">
                          Takes effect after Windows Explorer restarts. Restarting closes and
                          reopens your Explorer windows.
                        </span>
                      </div>
                      <button
                        className="btn btn-primary btn-compact"
                        onClick={() => {
                          window.electronAPI?.restartExplorer?.();
                          setExplorerRestartNeeded(false);
                        }}
                      >
                        <ArrowCounterClockwise size={14} weight="bold" />
                        Restart Explorer now
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── SHORTCUTS ──────────────────────────────────────────────────────────────── */}
            {section === 'shortcuts' && (
              <>
                <div className="setting-group">
                  <div className="shortcuts-head">
                    <span className="group-caption">Rebindable — click a binding, press keys</span>
                    <button
                      className="link-btn"
                      onClick={() => updateSetting('shortcuts', { ...DEFAULT_SHORTCUTS })}
                      title="Reset every shortcut to its default"
                    >
                      <ArrowCounterClockwise size={13} weight="bold" />
                      Reset all
                    </button>
                  </div>
                  {conflicts.size > 0 && (
                    <p className="setting-hint group-hint shortcut-conflict">
                      <Warning size={13} weight="fill" /> Two actions share a binding — the one
                      higher in this list wins. Rebind one of them.
                    </p>
                  )}
                  {SHORTCUT_ACTIONS.map((a) => (
                    <div className="setting-item" key={a.id}>
                      <span className={`setting-label ${conflicts.has(settings.shortcuts[a.id]) ? 'conflicted' : ''}`}>
                        {a.label}
                      </span>
                      <button
                        className={`shortcut-btn ${activeShortcutRebind === a.id ? 'recording' : ''} ${conflicts.has(settings.shortcuts[a.id]) ? 'conflicted' : ''}`}
                        onClick={() => setActiveShortcutRebind(activeShortcutRebind === a.id ? null : a.id)}
                      >
                        {activeShortcutRebind === a.id
                          ? 'Press keys…'
                          : <BindingChips binding={settings.shortcuts[a.id]} />}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="setting-group">
                  <span className="group-caption">Fixed</span>
                  {FIXED_SHORTCUTS.map((s) => (
                    <div className="setting-item" key={s.label}>
                      <span className="setting-label">{s.label}</span>
                      <span className="kbd-group">
                        {s.keys.map((k) => <kbd key={k}>{k}</kbd>)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── ABOUT ──────────────────────────────────────────────────────────────────── */}
            {section === 'about' && (
              <>
                <div className="setting-group">
                  <span className="group-caption">Updates</span>
                  {runtimeInfo?.windowsStore ? (
                    <div className="setting-item setting-item-stacked">
                      <div className="setting-label-block">
                        <span className="setting-label">Microsoft Store build</span>
                        <span className="setting-hint">
                          This copy of FATE is managed by the Microsoft Store, which delivers its
                          updates automatically. The update button in the status bar opens the
                          Store&apos;s downloads page.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="setting-item">
                      <span className="setting-label">Automatic updates</span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={settings.autoUpdatesEnabled}
                          onChange={(e) => updateSetting('autoUpdatesEnabled', e.target.checked)}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>
                  )}
                </div>

                <div className="setting-group">
                  <span className="group-caption">Privacy</span>
                  <div className="setting-item setting-item-stacked">
                    <div className="setting-label-block">
                      <span className="setting-label">Discord Rich Presence</span>
                      <span className="setting-hint">
                        FATE shows only whether you&apos;re reading, editing, or idle. Document
                        names are never sent, and FATE makes no other network requests.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="setting-group setting-group-about">
                  <div className="about-row">
                    <img src={fateLogo} alt="" className="about-badge" />
                    <div className="about-text">
                      <span className="about-name">FATE <span className="about-version">v{appVersion}</span></span>
                      <span className="about-sub">Formatted Article &amp; Text Editor</span>
                      <span className="about-credit">
                        &copy; {new Date().getFullYear()} VagueDustin Enterprises&trade; &middot; All rights reserved
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
