import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import markedKatex from 'marked-katex-extension';

// Configure marked to use highlight.js
marked.setOptions({
  highlight: function(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
  gfm: true,
  breaks: true
});

marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

self.onmessage = (e) => {
  const { content, fPath } = e.data;
  
  // Repair mathematically corrupted control-characters from unescaped markdown generators
  const repairedContent = content
    .replace(/\x09heta/g, '\\theta')
    .replace(/\x09ext/g, '\\text')
    .replace(/\x09imes/g, '\\times')
    .replace(/\x09au/g, '\\tau')
    .replace(/\x0Crac/g, '\\frac')
    .replace(/\x0Dight/g, '\\right')
    .replace(/\x08eta/g, '\\beta')
    .replace(/\x08egin/g, '\\begin')
    .replace(/\x07pprox/g, '\\approx')
    .replace(/\x07lpha/g, '\\alpha')
    .replace(/\x0Dho/g, '\\rho')
    .replace(/\x0B/g, '\\v')
    .replace(/\\ /g, '\\\\ ');

  const rawHtml = marked.parse(repairedContent);
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { mathMl: true, html: true },
    ADD_TAGS: ['annotation'],
    ADD_ATTR: ['class', 'style', 'aria-hidden', 'encoding', 'xmlns', 'viewBox', 'd', 'preserveAspectRatio']
  });

  self.postMessage({ cleanHtml, fPath });
};
