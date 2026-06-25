## 2025-02-14 - Optimized Scroll Performance in Markdown Viewer

**Learning:** High-frequency events like scrolling can trigger a massive number of React re-renders (190+ in a single scroll session) if they update state (e.g., scroll progress bar). Direct DOM manipulation via `useRef` for these UI elements and throttling with `requestAnimationFrame` significantly reduces the load (from 192 re-renders to just 2). Caching expensive DOM queries like `querySelectorAll` for headings further improves frame consistency.

**Action:** For high-frequency UI updates that don't require React reconciliation (like progress bars or active heading highlights), bypass state and update the DOM directly via refs. Always throttle these events with `requestAnimationFrame` and cache DOM lookups.
