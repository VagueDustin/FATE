import StatusMenu, { StatusMenuItem } from './StatusMenu.jsx';
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
 * The menu (positioning, keyboard, Escape) is StatusMenu's.
 */
function FormatStatus({ format, canReopen, reopenHint, onToggleEol, onSaveWithEncoding, onReopenWithEncoding }) {
  return (
    <>
      <span className="status-divider" />
      <StatusMenu
        label={encodingLabel(format)}
        title="Encoding: save with a different one, or reopen the file as another"
        menuLabel="Encoding"
      >
        {(choose) => (
          <>
            <div className="format-menu-heading" role="presentation">Save with encoding</div>
            {SAVE_ENCODINGS.map((c) => (
              <StatusMenuItem
                key={`save-${c.key}`}
                checked={isCurrentEncoding(format, c)}
                onClick={choose(() => onSaveWithEncoding(c))}
              >
                {c.label}
              </StatusMenuItem>
            ))}

            <div className="format-menu-sep" role="separator" />
            <div className="format-menu-heading" role="presentation">Reopen with encoding</div>
            {!canReopen && reopenHint && <div className="format-menu-hint">{reopenHint}</div>}
            {REOPEN_ENCODINGS.map((c) => (
              <StatusMenuItem
                key={`reopen-${c.key}`}
                disabled={!canReopen}
                onClick={choose(() => onReopenWithEncoding(c.encoding))}
              >
                {c.label}
              </StatusMenuItem>
            ))}
          </>
        )}
      </StatusMenu>
      <span className="status-divider" />
      <button
        type="button"
        className="status-btn status-format"
        onClick={onToggleEol}
        title={`Line endings: ${eolLabel(format.eol)}. Click to save with ${eolLabel(toggledEol(format.eol))} instead`}
      >
        {eolLabel(format.eol)}
      </button>
    </>
  );
}

export default FormatStatus;
