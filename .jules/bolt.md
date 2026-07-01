## 2025-05-14 - Optimized Scroll and State Management
**Learning:** Updating React state on high-frequency events (like scroll) triggers expensive component-wide re-renders. Caching DOM queries like `querySelectorAll` in refs prevents redundant layout calculations.
**Action:** Use refs for direct DOM manipulation (progress bars) and throttled `requestAnimationFrame` handlers for smooth UI updates.
