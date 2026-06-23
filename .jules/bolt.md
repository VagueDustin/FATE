# Bolt's Journal - FATE Markdown Viewer

## 2025-05-15 - Initial Performance Audit
**Learning:** Identified high-frequency re-renders during scrolling due to `scrollProgress` state and expensive DOM queries in `handleScroll`.
**Action:** Plan to use `requestAnimationFrame` for throttling, direct DOM manipulation for the progress bar, and caching heading elements.
