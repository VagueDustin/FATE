# Contributing to FATE

Pull requests are welcome. FATE is maintained by **VagueDustin Enterprises** — the code is
[AGPL-3.0](LICENSE), the name and artwork are not (see [TRADEMARK.md](TRADEMARK.md)). Contributions
are reviewed and merged at the maintainer's discretion.

**Contribution licensing:** by submitting a pull request you agree that your contribution is
licensed under the project's AGPL-3.0 licence, and you grant VagueDustin Enterprises the right to
relicense the project (including your contribution) under other terms in the future. If you can't
agree to that, please open an issue describing the change instead of a PR.

---

## Before you write code

**For anything non-trivial, open an issue first.** A short "I'd like to add X, planning to do it by
doing Y" saves you from building something that gets declined for a reason you couldn't have known.

Small fixes — a typo, a crash, an obviously wrong value — go straight to a PR. No ceremony needed.

## Setup

```bash
git clone https://github.com/VagueDustin/FATE.git
cd FATE
npm install
npm run electron:dev      # Vite + Electron together
```

| Command | What |
| --- | --- |
| `npm run electron:dev` | dev server + Electron |
| `npm run dev` | renderer only, in a browser (no Electron APIs — the app degrades gracefully) |
| `npm run lint` | ESLint; **must pass** |
| `npm run build` | production renderer build |
| `npm run icons` | regenerate every icon from the masters in `brand/` |
| `npm run electron:build` | full installer (`dist-electron/`) |

**Note:** `build/` is gitignored, and `build/installer.nsh` is not in the repo. `npm run icons`
regenerates the icons, but a full `electron:build` needs that NSIS include — ask if you need it.

---

## House rules

These aren't style preferences; each one exists because breaking it caused a real bug. `AI_CONTEXT.md`
has the long version.

### 1. No colour literals outside `src/brand.css`

Every on-screen colour comes from a CSS custom property. `src/App.css` must contain none.

```bash
rg -n '#[0-9a-fA-F]{3,8}\b' src/App.css   # every hit must be inside @media print
```

Themes are ~25-line token blocks in `brand.css`. **Do not add per-theme component overrides** —
v1.5.0 deleted ~300 lines of exactly that, which had already drifted out of sync between themes.

### 2. Don't regress scroll performance

The viewer renders the whole document — every KaTeX node included — via `dangerouslySetInnerHTML`.
Putting scroll state into React re-rendered all of it on every tick. The current design keeps
scrolling free and must stay that way:

- Progress bar and the `%` readout are written **directly to the DOM** via refs, never `setState`
- Scroll handler is `requestAnimationFrame`-throttled; the listener is `{ passive: true }`
- Headings are cached per document, not re-queried per frame
- The effect **must not** depend on `activeHeading` — it used to, and re-registered the listener on
  every heading change mid-scroll

### 3. Nothing floats against the viewport

The shell is a three-row flex column: progress bar / `.app-main` / status bar. Chrome pinned to the
corners with `position: fixed` overlapped the content at small window sizes; that's what the status
bar row replaced. `min-height: 0` on flex scroll containers is load-bearing.

### 4. `@media (max-height: …)` rules go at the bottom of `App.css`

After the declarations they override. Equal specificity means source order decides, and placing them
earlier silently loses.

### 5. No webfont CDNs, no telemetry, no phoning home

FATE is fully offline and [PRIVACY.md](PRIVACY.md) promises it. Fonts are bundled via `@fontsource`.
The only network request the app makes is the GitHub update check.

### 6. Don't touch the LaTeX repair pass casually

The regex block in `processMarkdown` matches **literal control characters** — generators emit a real
`\t` byte where they meant `\theta`. It looks like a mistake and isn't. `markedKatex` must keep
`{ throwOnError: false, nonStandard: true }`; without `nonStandard` a `$` against punctuation breaks
the whole document.

---

## Submitting

1. Branch off `main`.
2. Keep the PR to one concern. A rename plus a bugfix plus a refactor is three reviews in one diff.
3. `npm run lint` and `npm run build` must both pass.
4. Say what you changed **and why**. The why is the part review actually needs.
5. If it's visual, include a before/after screenshot.
6. Don't bump the version or edit the changelog — releases are cut by the maintainer.

### Reviewed on

- Does it work, and does it keep working at the 680×520 minimum window size?
- Does it hold up in all four themes (FATE, Crimson, Light, Dracula)?
- Does it respect `prefers-reduced-motion` if it animates?
- Does it keep the app offline?
- Is it the smallest change that solves the problem?

### Likely to be declined

- Reintroducing floating/absolutely-positioned chrome
- Hardcoded colours, or per-theme override cascades
- Telemetry, analytics, crash reporting, or any new outbound request
- Large dependencies for something small
- Renaming or restyling the brand — see [TRADEMARK.md](TRADEMARK.md)
- Sweeping reformatting mixed into a functional change

### A note on AI-generated PRs

They're fine — but **read what you're submitting**. This repo previously accumulated 14 open PRs from
an automated agent, each a slightly different attempt at the same scroll optimization, submitted daily
for two weeks. All 14 were closed in favour of one hand-reviewed commit. One considered PR beats
fourteen near-duplicates.

---

## Reporting bugs

Include: FATE version (Settings → About), Windows version, what you did, what happened, what you
expected. A sample `.md` file helps enormously for anything render-related.

## Security

Don't open a public issue for a security problem. Use GitHub's private vulnerability reporting on this
repository, or reach out through [vaguedustin.com](https://vaguedustin.com).

---

By contributing you agree your work is licensed under the [MIT License](LICENSE), and that
contributing grants you no interest in the FATE or VagueDustin Enterprises marks or artwork.

*Provided by VagueDustin Enterprises™*
