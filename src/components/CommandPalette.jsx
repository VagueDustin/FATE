import { Fragment, useState, useEffect, useRef, useMemo, useId } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { scoreMatch } from '../paletteModes.js';
import { useDialogFocus } from '../dialogFocus.js';

/**
 * CommandPalette: Ctrl+K. One fuzzy search over everything: open tabs, recent files, commands,
 * themes. The item list is assembled by App.jsx (it owns all the state a command touches); this
 * component only filters, ranks and renders it.
 *
 * Matching is subsequence-based with a small scorer (consecutive hits and word starts count
 * extra), which is the whole of what a palette needs, with no fuzzy-search dependency for one loop.
 * The scorer lives in paletteModes.js, shared with the symbol filter.
 *
 * ── Modes (1.14.0) ───────────────────────────────────────────────────────────────────────────
 * `modes` maps a prefix to a mode (see paletteModes.js): a query starting with ":" goes to a
 * line, "@" lists the document's symbols, "#" searches every open tab. The mode gets the query
 * without its prefix and returns its own ranked rows, shown as they are. `initialQuery` opens the
 * palette already in a mode (the Go to line and Go to symbol menu items pass ":" and "@").
 *
 * ── Accessibility ────────────────────────────────────────────────────────────────────────────
 * A modal dialog (focus moves in, Tab can't leave, focus goes back to the editor on close; see
 * dialogFocus.js) around an ARIA combobox: the input owns a listbox and points at the highlighted
 * row with aria-activedescendant, so a screen reader follows the arrow keys while focus stays in
 * the input, which is what lets typing carry on at any point.
 */

/** The mode prefix the query starts with (longest first), or null. */
function modePrefixOf(modes, query) {
  if (!modes || !query) return null;
  let best = null;
  for (const prefix of Object.keys(modes)) {
    if (query.startsWith(prefix) && (best === null || prefix.length > best.length)) best = prefix;
  }
  return best;
}

function CommandPalette({ items, onClose, modes = null, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const optionId = (i) => `${baseId}-opt-${i}`;

  /*
   * A new initialQuery while open (Go to symbol chosen from the menu with the palette already up)
   * replaces the query. Render-time adjustment, not an effect, like the selection reset below.
   */
  const [lastInitialQuery, setLastInitialQuery] = useState(initialQuery);
  if (lastInitialQuery !== initialQuery) {
    setLastInitialQuery(initialQuery);
    setQuery(initialQuery);
  }

  const prefix = modePrefixOf(modes, query);
  const mode = prefix === null ? null : modes[prefix];

  const results = useMemo(() => {
    if (mode) return mode.getItems(query.slice(prefix.length)) || [];
    const scored = items
      .map((item) => ({ item, score: scoreMatch(query, `${item.section} ${item.label}`) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 40).map((r) => r.item);
  }, [items, query, mode, prefix]);

  useDialogFocus(dialogRef, {
    // The caret goes to the end, so an initial ":" or "@" is ready to be typed after.
    initialFocus: () => {
      const input = inputRef.current;
      input?.setSelectionRange(input.value.length, input.value.length);
      return input;
    },
    onEscape: onClose
  });

  /* Reset the selection when the query changes (render-time adjustment, not an effect). */
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setSelected(0);
  }
  const active = Math.min(selected, results.length - 1);

  useEffect(() => {
    const el = listRef.current?.children[active];
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const run = (item) => {
    if (!item || item.disabled) return;
    onClose();
    // After the overlay unmounts, so a command that opens a dialog isn't fighting the palette.
    setTimeout(() => item.run(), 0);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(results.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const showHints = !!modes && query === '';

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        /* Clicks on rows and padding keep focus in the input, so typing and the arrow keys carry
           on working after a mouse move or a stray click. */
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) e.preventDefault();
        }}
      >
        <div className="palette-input-row">
          <MagnifyingGlass size={16} weight="bold" className="palette-glass" />
          {mode && <span className="palette-mode">{mode.label}</span>}
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search tabs, files, commands, themes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            role="combobox"
            aria-label={mode ? mode.label : 'Search tabs, files, commands and themes'}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            aria-describedby={showHints ? hintId : undefined}
          />
          <kbd>Esc</kbd>
        </div>

        <ul className="palette-list" ref={listRef} role="listbox" id={listId} aria-label="Results">
          {results.map((item, i) => {
            const Icon = item.icon;
            const classes = ['palette-item'];
            if (i === active) classes.push('selected');
            if (item.disabled) classes.push('disabled');
            if (item.error) classes.push('error');
            return (
              <li
                key={item.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                aria-disabled={item.disabled ? true : undefined}
                className={classes.join(' ')}
                onMouseEnter={() => setSelected(i)}
                onClick={() => run(item)}
              >
                {Icon && <Icon size={15} weight="duotone" className="palette-icon" />}
                <span className="palette-label">{item.label}</span>
                {/* A mode row's detail (a file name and line, a symbol's kind and line) keeps its
                    case; the section labels of the main list are small caps. */}
                {item.detail != null ? (
                  <span className="palette-section palette-detail">{item.detail}</span>
                ) : (
                  item.section && <span className="palette-section">{item.section}</span>
                )}
              </li>
            );
          })}
        </ul>
        {results.length === 0 && (
          <div className="palette-empty" role="status">
            {mode ? mode.placeholder : 'No matches'}
          </div>
        )}

        {/* The quiet footer: ": go to line · @ symbol · # search open tabs". */}
        {showHints && (
          <div className="palette-hint" id={hintId}>
            {Object.entries(modes).map(([p, m], i) => (
              <Fragment key={p}>
                {i > 0 && ' · '}
                <kbd>{p}</kbd> {m.hint ?? m.label}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CommandPalette;
