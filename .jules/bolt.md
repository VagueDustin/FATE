## 2025-05-14 - [Scroll Performance & DOM Query Caching]
**Learning:** High-frequency events like scrolling can become a bottleneck when they trigger expensive DOM queries (like `querySelectorAll`) and React state updates. Throttling with `requestAnimationFrame` and caching DOM elements in a `useRef` significantly reduces main-thread work.
**Action:** Always throttle scroll/resize handlers and cache DOM queries that don't need to be re-run on every event tick. Use `useRef` for tracking values that don't need to trigger a re-render.
