import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CodeEditor from './CodeEditor.jsx';
import { renderMarkdown } from '../markdown.js';

/**
 * MarkdownEditView is a markdown tab's EDIT mode: CodeMirror source on the left, live preview on
 * the right, re-rendered ~a third of a second after typing pauses. Its own module (it used to live
 * in App.jsx) so it is never defined inside App, which would remount it every render.
 *
 * `savedContent` is the text as last saved to disk, which can differ from `doc.source` when the
 * tab left Edit mode with unsaved changes. The editor measures "dirty" against it, so coming back
 * into Edit mode never passes unsaved text off as saved.
 */
function MarkdownEditView({ doc, isActive, tabSize, cursorLabelRef, onDirtyChange, onSave, registerEditor }) {
  const editorRef = useRef(null);
  const [previewHtml, setPreviewHtml] = useState(doc.html);
  // Stable object, or React 19 rewrites the preview on every render (see MarkdownView).
  const previewMarkup = useMemo(() => ({ __html: previewHtml }), [previewHtml]);
  const timerRef = useRef(null);

  const onDocChanged = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const text = editorRef.current?.getContent() ?? '';
      setPreviewHtml(renderMarkdown(text, doc.path).html);
    }, 350);
  }, [doc.path]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div className="md-edit-split">
      <div className="md-edit-editor">
        <CodeEditor
          ref={(el) => {
            editorRef.current = el;
            registerEditor(el);
          }}
          fileName={doc.name}
          initialContent={doc.source}
          savedContent={doc.savedSource ?? doc.source}
          lint={false /* markdown has no syntax errors; skip the empty lint gutter */}
          wrap={true /* prose: unwrapped markdown source is unreadable */}
          tabSize={tabSize}
          isActive={isActive}
          onDirtyChange={onDirtyChange}
          onSave={onSave}
          onDocChanged={onDocChanged}
          cursorLabelRef={cursorLabelRef}
        />
      </div>
      <div className="md-edit-preview">
        <div className="markdown-body" dangerouslySetInnerHTML={previewMarkup} />
      </div>
    </div>
  );
}

export default MarkdownEditView;
