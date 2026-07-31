<!--
Thanks for contributing to FATE.

Please read CONTRIBUTING.md first if you haven't — it lists the handful of house rules that exist
because breaking them caused a real bug (no colour literals outside brand.css, don't regress scroll
performance, nothing floats against the viewport).
-->

## What

<!-- One or two sentences. What does this change? -->

## Why

<!-- The part review actually needs. What problem does this solve? If it fixes an issue, link it. -->

## How it was verified

<!-- How do you know it works? "Built and clicked through it" is a fine answer — just say so. -->

---

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] No colour literals added outside `src/brand.css` (`rg -n '#[0-9a-fA-F]{3,8}\b' src/App.css` — hits must be inside `@media print`)
- [ ] Still works at the minimum window size (680×520)
- [ ] Checked in all four themes, if visual — FATE, Crimson, Light, Dracula
- [ ] Respects `prefers-reduced-motion`, if it animates
- [ ] Adds no telemetry, analytics, or new outbound network request
- [ ] Version and changelog untouched (releases are cut by the maintainer)

<!-- Screenshots for anything visual — before and after. -->

---

<sub>By opening this PR you agree your contribution is licensed under the MIT License, and that it
grants you no interest in the FATE or VagueDustin Enterprises marks or artwork. See TRADEMARK.md.</sub>
