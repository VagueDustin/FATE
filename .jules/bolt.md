## 2026-06-27 - Initial Performance Audit
**Learning:** Found that high-frequency scroll events trigger full App re-renders due to `scrollProgress` and `activeHeading` state updates. Direct DOM manipulation for the progress bar and throttled state updates for the active heading can significantly reduce render pressure.
**Action:** Implement `requestAnimationFrame` throttling and direct DOM updates for the scroll progress bar.
