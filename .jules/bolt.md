## 2025-05-22 - [Optimizing high-frequency scroll events]
**Learning:** Updating a progress bar via React state during high-frequency scroll events triggers massive re-renders that impact performance, especially in complex documents.
**Action:** Use direct DOM manipulation via `useRef` and `requestAnimationFrame` to decouple UI updates from the React render cycle for performance-critical paths.

**Learning:** Repeatedly querying the DOM with `querySelectorAll` in scroll handlers causes layout thrashing.
**Action:** Cache DOM elements (like headings) in a `useRef` when the content is first rendered or updated.
