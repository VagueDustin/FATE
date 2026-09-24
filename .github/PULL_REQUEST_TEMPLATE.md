<!--
Thanks for contributing to FATE.

If you haven't yet, skim CONTRIBUTING.md. It covers setup, testing, and the handful of house rules
that exist because breaking them caused a real bug (no colour literals outside brand.css, don't
regress scroll performance, nothing floats against the viewport, stay offline).
-->

## What

<!-- One or two sentences. What does this change? -->

## Why

<!-- The part review actually needs. What problem does this solve? If it fixes an issue, link it: "Fixes #123". -->

## Type of change

- [ ] Bug fix
- [ ] Editor feature or improvement
- [ ] File type or language support
- [ ] Markdown rendering, printing or PDF export
- [ ] Themes, fonts or appearance
- [ ] Windows or Linux integration and packaging
- [ ] Documentation

## How it was verified

<!-- How do you know it works? Which OS did you run it on? "Built it and clicked through it on Ubuntu 24.04" is a fine answer. -->

---

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Ran it with `npm run electron:dev` and tried the change, including unsaved changes and more than one open tab where relevant
- [ ] No colour literals added outside `src/brand.css` (`rg -n '#[0-9a-fA-F]{3,8}\b' src/App.css`; hits must be inside `@media print`)
- [ ] Still works at the minimum window size (680×520)
- [ ] Checked in more than one theme, if visual (at least FATE and Light)
- [ ] Respects `prefers-reduced-motion`, if it animates
- [ ] Adds no telemetry, analytics, or new outbound network request
- [ ] Version and `CHANGELOG.md` untouched (releases are cut by the maintainer)

<!-- Screenshots for anything visual: before and after. -->

---

<sub>By opening this PR you agree your contribution is licensed under the AGPL-3.0, that the project
may be relicensed under other terms in future, and that contributing grants you no rights in the FATE
or VagueDustin Enterprises name or artwork. See BRAND.md.</sub>
