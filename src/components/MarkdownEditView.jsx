import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CodeEditor from './CodeEditor.jsx';
import { renderMarkdown } from '../markdown.js';
import { useMermaid } from '../useMermaid.js';
import { usePreviewScrollSync } from '../usePreviewScrollSync.js';

/**
 * MarkdownEditView is a markdown tab's EDIT mode: CodeMirror source on the left, live preview on
 * the right, re-rendered ~a third of a second after typing pauses. Its own module (it used to live
 * in App.jsx) so it is never defined inside App, which would remount it every render.
 *
 * `savedContent` is the text as last saved to disk, which can differ from `doc.source` when the
 * tab left Edit mode with unsaved changes. The editor measures "dirty" against it, so coming back
 * into Edit mode never passes unsaved text off as saved.
 *
 * The preview follows the editor's scrolling (usePreviewScrollSync) and draws Mermaid diagrams
 * like the reading view (useMermaid), a little after typing pauses so a diagram isn't redrawn on
 * every keystroke. `isVisible` (the active tab or the split pane) gates the diagrams, as there;
 * it falls back to `isActive` when not passed. Remote images load only with
 * `remoteImagesAllowed`; this preview has no bar of its own to offer them.
 */
function MarkdownEditView({
  doc,
  isActive,
  isVisible = isActive,
  tabSize,
  cursorLabelRef,
  onDirtyChange,
  onSave,
  registerEditor,
  remoteImagesAllowed = false
}) {
  const editorRef = useRef(null);
  const previewRef = useRef(null);
  const [preview, setPreview] = useState(() =>
    remoteImagesAllowed && doc.remoteImageCount > 0
      ? renderMarkdown(doc.source, doc.path, { remoteImages: true })
      : { html: doc.html, hasMermaid: doc.hasMermaid }
  );
  // Stable object, or React 19 rewrites the preview on every render (see MarkdownView).
  const previewMarkup = useMemo(() => ({ __html: preview.html }), [preview.html]);
  const timerRef = useRef(null);

  const renderNow = useCallback(() => {
    const text = editorRef.current?.getContent() ?? '';
    const { html, hasMermaid } = renderMarkdown(text, doc.path, { remoteImages: remoteImagesAllowed });
    setPreview({ html, hasMermaid });
  }, [doc.path, remoteImagesAllowed]);

  const onDocChanged = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(renderNow, 350);
  }, [renderNow]);

  // Remote images switched on (Always load, in another tab) while editing: show them now.
  const allowedRef = useRef(remoteImagesAllowed);
  useEffect(() => {
    if (allowedRef.current === remoteImagesAllowed) return;
    allowedRef.current = remoteImagesAllowed;
    onDocChanged();
  }, [remoteImagesAllowed, onDocChanged]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  usePreviewScrollSync(editorRef, previewRef, preview.html);
  useMermaid(previewRef, { html: preview.html, hasMermaid: preview.hasMermaid, enabled: isVisible, delay: 400 });

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
      <div className="md-edit-preview" ref={previewRef}>
        <div className="markdown-body" data-doc-path={doc.path ?? ''} dangerouslySetInnerHTML={previewMarkup} />
      </div>
    </div>
  );
}

export default MarkdownEditView;
