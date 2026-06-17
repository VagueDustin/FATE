## 2025-05-15 - [Scroll Performance & React Re-renders]
**Learning:** Updating React state (like `scrollProgress`) on every scroll event triggers a full component re-render, which is expensive in complex layouts like a Markdown viewer with a Table of Contents.
**Action:** Use `useRef` to hold DOM references for elements like progress bars and update their styles directly in the scroll listener to bypass React's re-render cycle. Combine with `requestAnimationFrame` for smooth throttling.

## 2025-05-15 - [Memoization & Callbacks]
**Learning:** `React.memo()` is ineffective if the child component receives functions as props that are recreated on every parent render.
**Action:** Always wrap event handlers passed to memoized components in `useCallback()` to ensure they maintain stable identities.
