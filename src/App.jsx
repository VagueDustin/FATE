import { useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { UploadSimple, FileText, ArrowLeft } from '@phosphor-icons/react';
import './App.css';

// Configure marked to use highlight.js
marked.setOptions({
  highlight: function(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
  gfm: true,
  breaks: true
});

function App() {
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [isViewing, setIsViewing] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateAction, setUpdateAction] = useState(null);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onOpenFile((content, name) => {
        setFileName(name);
        const rawHtml = marked.parse(content);
        const cleanHtml = DOMPurify.sanitize(rawHtml);
        setFileContent(cleanHtml);
        setIsViewing(true);
      });

      window.electronAPI.getAppVersion().then(version => setAppVersion(version));

      window.electronAPI.onUpdateMessage((message, action) => {
        setUpdateStatus(message);
        setUpdateAction(action);
      });

      window.electronAPI.appReady();
    }
  }, []);

  const handleUpdateAction = () => {
    if (updateAction === 'install') {
      window.electronAPI.installUpdate();
    } else {
      window.electronAPI.checkForUpdates();
    }
  };

  const onDrop = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        // Parse and sanitize markdown
        const rawHtml = marked.parse(text);
        const cleanHtml = DOMPurify.sanitize(rawHtml);
        setFileContent(cleanHtml);
        setIsViewing(true);
      };
      reader.readAsText(file);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/markdown': ['.md', '.markdown', '.txt']
    },
    multiple: false
  });

  return (
    <div className="app-container">
      {!isViewing ? (
        <>
          <div className="header">
            <h1>FATE</h1>
            <p>Formatted Article & Text Explorer</p>
            <p className="enterprise-text">Provided by VagueDustin Enterprises&trade;</p>
          </div>
          
          <div 
            {...getRootProps()} 
            className={`dropzone ${isDragActive ? 'active' : ''}`}
          >
            <input {...getInputProps()} />
            <UploadSimple className="icon" weight="duotone" />
            <p>{isDragActive ? "Drop the markdown file here" : "Drag & drop a markdown file"}</p>
            <span className="sub-text">or click to select a file (.md, .markdown)</span>
          </div>
        </>
      ) : (
        <div className="viewer-container">
          <div className="viewer-header">
            <div className="file-info">
              <FileText className="file-icon" size={24} weight="duotone" />
              {fileName}
            </div>
            <button className="action-btn" onClick={() => setIsViewing(false)}>
              <ArrowLeft size={18} weight="bold" />
              Back to Upload
            </button>
          </div>
          <div 
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: fileContent }}
          />
        </div>
      )}
      
      {appVersion && !isViewing && (
        <div className="version-container">
          <span className="version-text">v{appVersion}</span>
          <button className="update-btn" onClick={handleUpdateAction}>
            {updateStatus ? updateStatus : "Check for updates"}
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
