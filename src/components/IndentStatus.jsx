import StatusMenu, { StatusMenuItem } from './StatusMenu.jsx';
import { INDENT_SIZES, indentLabel } from '../indentDetect.js';

/**
 * IndentStatus: the status bar's indentation item (1.14.0, M7), "Spaces: 4" or "Tab size: 4".
 *
 * Its menu sets how THIS document indents from now on: spaces or tabs, and the width (of one level
 * of spaces, or of a tab). Nothing already in the file is re-indented; Tab and the automatic
 * indentation of new lines use the new choice. `indent` is the document's effective indentation
 * ({ useTabs, size }, see indentDetect.js); `onChange` gets the whole new value.
 */
function IndentStatus({ indent, onChange }) {
  return (
    <>
      <span className="status-divider" />
      <StatusMenu
        label={indentLabel(indent)}
        title="Indentation: what Tab and new lines insert in this document. Existing lines stay as they are"
        menuLabel="Indentation"
        width={210}
      >
        {(choose) => (
          <>
            <StatusMenuItem checked={!indent.useTabs} onClick={choose(() => onChange({ ...indent, useTabs: false }))}>
              Indent using spaces
            </StatusMenuItem>
            <StatusMenuItem checked={indent.useTabs} onClick={choose(() => onChange({ ...indent, useTabs: true }))}>
              Indent using tabs
            </StatusMenuItem>
            <div className="format-menu-sep" role="separator" />
            <div className="format-menu-heading" role="presentation">{indent.useTabs ? 'Tab size' : 'Indent size'}</div>
            {INDENT_SIZES.map((n) => (
              <StatusMenuItem key={n} checked={indent.size === n} onClick={choose(() => onChange({ ...indent, size: n }))}>
                {n}
              </StatusMenuItem>
            ))}
          </>
        )}
      </StatusMenu>
    </>
  );
}

export default IndentStatus;
