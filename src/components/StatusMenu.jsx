import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check } from '@phosphor-icons/react';

/**
 * StatusMenu: a status-bar button that opens a small menu above it (1.14.0). The encoding item
 * (FormatStatus) and the indentation item (IndentStatus) are both built on it.
 *
 * The menu is portalled to <body> with fixed positioning: the status bar clips its overflow, so a
 * popover inside it would be cut off at 30px.
 *
 * Keyboard: the menu takes focus on open; arrows move, Home/End jump, Enter/Space choose, Escape
 * closes and hands focus back to the button, Tab closes it. Escape is consumed here so it never
 * reaches the app-wide shortcut handler (which would otherwise read it as "close tab").
 *
 * `children(choose)` renders the items. `choose(fn)` is an item's click handler: it closes the
 * menu, puts focus back on the button, then runs `fn`.
 */
const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled])';

function StatusMenu({ label, title, menuLabel, width = 240, children }) {
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
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
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
      <button
        ref={buttonRef}
        type="button"
        className={`status-btn status-format ${menuPos ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!menuPos}
        onClick={toggleMenu}
        title={title}
      >
        {label}
      </button>

      {menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="format-menu"
            role="menu"
            aria-label={menuLabel}
            style={{ left: menuPos.left, bottom: menuPos.bottom, width }}
            onKeyDown={onMenuKeyDown}
          >
            {children(choose)}
          </div>,
          document.body
        )}
    </>
  );
}

/** One item: a radio item when `checked` is given (ticked when true), a plain one otherwise. */
export function StatusMenuItem({ checked, disabled = false, onClick, children }) {
  const radio = checked !== undefined;
  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? !!checked : undefined}
      className="format-menu-item"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="format-menu-check" aria-hidden="true">
        {checked && <Check size={12} weight="bold" />}
      </span>
      {children}
    </button>
  );
}

export default StatusMenu;
