import { Info, Warning, WarningCircle, X } from '@phosphor-icons/react';

/**
 * DocBar: a one-line notice across the top of a document pane (1.14.0), for things that are about
 * THIS tab and need a decision or at least a look:
 *   - the file changed on disk while you had unsaved edits (Reload / Keep mine / Compare)
 *   - the file was deleted or moved (Keep editing / Close tab)
 *   - a large Markdown file opened as plain text (Render as Markdown)
 *
 * Deliberately not a dialog: nothing here is urgent enough to block typing, and a tab in the
 * background must be able to carry its notice until you come back to it. Not the status bar
 * either, which belongs to whichever tab is visible and holds one message at a time.
 *
 * `tone` is 'info' | 'warning' | 'danger'; `actions` are { label, onClick, title?, primary? }.
 */
const ICONS = { info: Info, warning: Warning, danger: WarningCircle };

function DocBar({ tone = 'info', message, actions = [], onDismiss }) {
  const Icon = ICONS[tone] || Info;
  return (
    <div className={`doc-bar doc-bar-${tone}`} role={tone === 'info' ? 'status' : 'alert'}>
      <Icon size={15} weight="fill" className="doc-bar-icon" aria-hidden="true" />
      <span className="doc-bar-message">{message}</span>
      <span className="doc-bar-actions">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={`doc-bar-btn ${a.primary ? 'doc-bar-btn-primary' : ''}`}
            onClick={a.onClick}
            title={a.title}
          >
            {a.label}
          </button>
        ))}
        {onDismiss && (
          <button type="button" className="doc-bar-dismiss" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
            <X size={12} weight="bold" />
          </button>
        )}
      </span>
    </div>
  );
}

export default DocBar;
