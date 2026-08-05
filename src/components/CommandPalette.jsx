import { useState, useEffect, useRef, useMemo } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';

/**
 * CommandPalette — Ctrl+K. One fuzzy search over everything: open tabs, recent files, commands,
 * themes. The item list is assembled by App.jsx (it owns all the state a command touches); this
 * component only filters, ranks and renders it.
 *
 * Matching is subsequence-based with a small scorer (consecutive hits and word starts count
 * extra), which is the whole of what a palette needs — no fuzzy-search dependency for one loop.
 */

function scoreMatch(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += 1 + streak; // consecutive matches compound
      if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '.') score += 4; // word starts matter
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : 0;
}

function CommandPalette({ items, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(() => {
    const scored = items
      .map((item) => ({ item, score: scoreMatch(query, `${item.section} ${item.label}`) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, 40).map((r) => r.item);
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* Reset the selection when the query changes — render-time adjustment, not an effect. */
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setSelected(0);
  }

  useEffect(() => {
    const el = listRef.current?.children[selected];
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected, results]);

  const run = (item) => {
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
      if (results[selected]) run(results[selected]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input-row">
          <MagnifyingGlass size={16} weight="bold" className="palette-glass" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search tabs, files, commands, themes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>

        <ul className="palette-list" ref={listRef} role="listbox">
          {results.length === 0 && <li className="palette-empty">No matches</li>}
          {results.map((item, i) => {
            const Icon = item.icon;
            return (
              <li
                key={item.id}
                role="option"
                aria-selected={i === selected}
                className={`palette-item ${i === selected ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => run(item)}
              >
                {Icon && <Icon size={15} weight="duotone" className="palette-icon" />}
                <span className="palette-label">{item.label}</span>
                <span className="palette-section">{item.section}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default CommandPalette;
