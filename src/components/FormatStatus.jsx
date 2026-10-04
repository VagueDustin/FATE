import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check } from '@phosphor-icons/react';
import {
  eolLabel, encodingLabel, toggledEol, SAVE_ENCODINGS, REOPEN_ENCODINGS, isCurrentEncoding
} from '../docFormat.js';

/**
 * FormatStatus: the status bar's encoding and line-ending items (1.14.0).
 *
 *   UTF-8 ▸ menu: "Save with encoding" (changes how the next save writes the file; the tab turns
 *           dirty until then) and "Reopen with encoding" (rereads the file decoded another way,
 *           for a guess that came out wrong; only on a clean tab with a file behind it, since it
 *           replaces the buffer)
 *   CRLF  ▸ click: switch CRLF ↔ LF, applied on the next save
 *
 * The menu is portalled to <body> with fixed positioning: the status bar clips its overflow, so a
 * popover inside it would be cut off at 30px.
 *
 * Keyboard: the menu takes focus on open; arrows move, Enter/Space choose, Escape closes and hands
 * focus back to the button. Escape is consumed here so it never reaches the app-wide shortcut
 * handler (which would otherwise read it as "close tab").
 */
const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled])';
const MENU_WIDTH = 240;

function FormatStatus({ format, canReopen, reopenHint, onToggleEol, onSaveWithEncoding, onReopenWithEncoding }) {
  const [menuPos, setMenuPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const closeMenu = (refocus) => {
    setMenuPos(null);
    if (refocus) buttonRef.current?.focus();
  };

  const toggleMenu = () => {
    if (menuPos) {
      setMenuPos(null);
      return;
    }
    const r = buttonRef.current.getBoundingClientRect();
    setMenuPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)),
      bottom: window.innerHeight - r.top + 6
    });
  };

  useEffect(() => {
    if (!menuPos) return;
    menuRef.current?.querySelector(ITEM_SELECTOR)?.focus();
    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      setMenuPos(null);
    };
    const dismiss = () => setMenuPos(null);
    document.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [menuPos]);

  const onMenuKeyDown = (e) => {
    const items = [...(menuRef.current?.querySelectorAll(ITEM_SELECTOR) || [])];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  };

  const choose = (fn) => () => {
    closeMenu(true);
    fn();
  };

  return (
    <>
      <span className="status-divider" />
      <button
        ref={buttonRef}
        type="button"
        className={`status-btn status-format ${menuPos ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!menuPos}
        onClick={toggleMenu}
        title="Encoding: save with a different one, or reopen the file as another"
      >
        {encodingLabel(format)}
      </button>
      <span className="status-divider" />
      <button
        type="button"
        className="status-btn status-format"
        onClick={onToggleEol}
        title={`Line endings: ${eolLabel(format.eol)}. Click to save with ${eolLabel(toggledEol(format.eol))} instead`}
      >
        {eolLabel(format.eol)}
      </button>

      {menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="format-menu"
            role="menu"
            aria-label="Encoding"
            style={{ left: menuPos.left, bottom: menuPos.bottom, width: MENU_WIDTH }}
            onKeyDown={onMenuKeyDown}
          >
            <div className="format-menu-heading" role="presentation">Save with encoding</div>
            {SAVE_ENCODINGS.map((c) => {
              const current = isCurrentEncoding(format, c);
              return (
                <button
                  key={`save-${c.key}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  className="format-menu-item"
                  onClick={choose(() => onSaveWithEncoding(c))}
                >
                  <span className="format-menu-check" aria-hidden="true">
                    {current && <Check size={12} weight="bold" />}
                  </span>
                  {c.label}
                </button>
              );
            })}

            <div className="format-menu-sep" role="separator" />
            <div className="format-menu-heading" role="presentation">Reopen with encoding</div>
            {!canReopen && reopenHint && <div className="format-menu-hint">{reopenHint}</div>}
            {REOPEN_ENCODINGS.map((c) => (
              <button
                key={`reopen-${c.key}`}
                type="button"
                role="menuitem"
                className="format-menu-item"
                disabled={!canReopen}
                onClick={choose(() => onReopenWithEncoding(c.encoding))}
              >
                <span className="format-menu-check" aria-hidden="true" />
                {c.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

export default FormatStatus;
