import { useEffect, useRef, useState } from 'react';

/**
 * dialogFocus.js: keyboard focus for modal dialogs (Settings, the command palette), 1.14.0.
 *
 * Up to 1.13 both dialogs left focus wherever it happened to be: Tab walked out of the dialog
 * into the tab strip and editors behind the backdrop, and closing either left focus on <body>, so
 * the next keystroke went nowhere until you clicked back into the document. A modal has to:
 *
 *   1. move focus inside when it opens,
 *   2. keep Tab and Shift+Tab cycling inside while it is open, with the rest of the app inert
 *      (unreachable for focus and hidden from screen readers),
 *   3. give focus back to whatever had it before (usually the editor) when it closes.
 *
 * The opener is captured in a useState initializer, i.e. during the dialog's first render, which
 * is before anything inside it can take focus. The Tab and Escape handlers sit on `document`, not
 * on the dialog, so they still work after a click on a non-focusable part of the dialog has left
 * focus on <body>. They run after React's own handlers (React listens on #root, below document),
 * so a control inside that handles a key itself and calls preventDefault keeps it.
 *
 * Own module (not inside a component file) because react-refresh needs component files to export
 * only components, and both dialogs use it.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[tabindex]'
].join(',');

/** Dialogs currently open, oldest first (their refs); keyboard handling belongs to the last. */
const openDialogs = [];

/** Tab stops inside `container`, in DOM order: focusable, not tabindex="-1", and rendered. */
export function focusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0
  );
}

/**
 * Modal focus handling for the dialog element in `dialogRef`.
 *
 *   initialFocus()  the element to focus on open (default: the first tab stop, else the dialog)
 *   onEscape(e)     called for an Escape that no control inside has handled (preventDefault);
 *                   the event is preventDefault-ed, so App's own Escape handling (close the diff,
 *                   leave focus mode, close the tab) leaves it alone
 *   trapTab         false lets Tab through untouched, e.g. while the shortcut recorder is
 *                   listening and Tab may be part of the shortcut being recorded
 */
export function useDialogFocus(dialogRef, { initialFocus, onEscape, trapTab = true } = {}) {
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));

  // Latest options for the once-registered document listener.
  const optionsRef = useRef({ onEscape, trapTab });
  useEffect(() => {
    optionsRef.current = { onEscape, trapTab };
  });

  const initialFocusRef = useRef(initialFocus);

  useEffect(() => {
    const dialog = dialogRef.current;

    /*
     * Everything beside the dialog's backdrop (its parent) goes inert while it is open: the tab
     * strip, the editors, the status bar. aria-modal alone doesn't do it in Chromium; a screen
     * reader could still wander into the document behind, and so could focus. Only elements this
     * dialog made inert are restored, so a palette opened over Settings leaves Settings' own
     * inert background alone when it closes.
     */
    const backdrop = dialog?.parentElement;
    const madeInert = [];
    for (const el of backdrop?.parentElement?.children ?? []) {
      if (el !== backdrop && !el.hasAttribute('inert')) {
        el.setAttribute('inert', '');
        madeInert.push(el);
      }
    }

    const target = initialFocusRef.current?.() || focusableElements(dialog)[0] || dialog;
    target?.focus({ preventScroll: true });

    return () => {
      for (const el of madeInert) el.removeAttribute('inert');
      /*
       * Back to the opener, if it is still in the page and can take focus. A CodeMirror editor
       * restores its own selection on focus. An opener that has gone (the palette's input, when
       * the palette opened Settings) is skipped; whoever is showing now owns focus.
       */
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
  }, [dialogRef, opener]);

  useEffect(() => {
    openDialogs.push(dialogRef);
    const onKeyDown = (e) => {
      const { onEscape: escape, trapTab: trapping } = optionsRef.current;
      // Only the topmost dialog answers: the palette can open over Settings (Ctrl+K), and
      // Settings' trap would otherwise pull focus out of the palette on the first Tab.
      if (e.defaultPrevented || openDialogs[openDialogs.length - 1] !== dialogRef) return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (e.key === 'Escape') {
        if (escape) {
          e.preventDefault();
          escape(e);
        }
        return;
      }
      // Ctrl+Tab and friends are tab-switching shortcuts, not focus movement.
      if (!trapping || e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;

      const stops = focusableElements(dialog);
      if (stops.length === 0) {
        e.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      const inside = active !== dialog && dialog.contains(active);
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = openDialogs.lastIndexOf(dialogRef);
      if (i !== -1) openDialogs.splice(i, 1);
    };
  }, [dialogRef]);
}
