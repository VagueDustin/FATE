# AGENTS.md

Guidance for coding agents working in this repository. CONTRIBUTING.md is the full version; where
the two disagree, CONTRIBUTING.md wins.

## What this is

FATE (Formatted Article & Text Editor) is a text and code editor for Windows and Linux with a live
Markdown preview (KaTeX math, Mermaid diagrams). Electron main process in CommonJS (`electron/*.cjs`),
React renderer built with Vite (`src/`), CodeMirror 6 editor. Fully offline by design (PRIVACY.md).

## Layout

- `src/` - React renderer. `App.jsx` is the shell (tabs, split view, shortcuts, palette);
  `components/CodeEditor.jsx` the editor; `components/MarkdownView.jsx` + `markdown.js` the Markdown
  pipeline; `components/SettingsModal.jsx` Settings; `brand.css` holds every theme.
- `electron/` - main process (`main.cjs`: windows, file I/O, watching, printing, Windows integration,
  updates), preload bridge, snap confinement helpers.
- `test/` - `node --test` suites (`.cjs` / `.mjs`), including packaging and registration checks.
- `scripts/` - icon / store-art generation, appx manifest hook, snap desktop entry.
- `build/` - gitignored generated output, except `installer.nsh`, the AppStream metainfo and
  `build/linux/` (deb/rpm maintainer scripts and the public signing keyring), which are source.
- `snap/`, `flatpak/`, `aur/` and `.github/workflows/build-linux.yml` - Linux channels;
  `.github/workflows/build-windows.yml` - Windows installer and Store package;
  `.github/workflows/checks.yml` - the PR gate.

## Commands

Node 22 (CI). Use `npm ci` in automation.

```bash
npm ci
npm run electron:dev          # Vite + Electron with hot reload (the normal dev loop)
npm run dev                   # renderer only, in a browser (no Electron APIs)
npm run lint                  # ESLint - must pass
npm test                      # node --test over test/ - must pass
npm run build                 # production renderer build into dist/ - must pass
npm run icons                 # regenerate icons from brand/ (needed before packaging)
npm run electron:build        # Windows installer + appx into dist-electron/
npm run electron:build:linux  # AppImage, .deb, .rpm (run icons first; needs rpmbuild)
```

`lint`, `test` and `build` are what the Checks workflow runs on every PR (plus an unpacked Linux
package that must start). Set `FATE_USER_DATA=<dir>` to run a dev copy beside an installed FATE.

## House rules (each one exists because breaking it caused a bug)

1. **No colour literals outside `src/brand.css`.** Every colour is a CSS custom property.
   `rg -n '#[0-9a-fA-F]{3,8}\b' src/App.css` must only hit inside `@media print`. Themes are short
   token blocks in `brand.css`; no per-theme component overrides.
2. **Don't regress scroll performance.** Markdown scroll progress and the editor `Ln, Col` readout
   are written directly to the DOM via refs, never `setState`; the scroll handler stays
   `requestAnimationFrame`-throttled and `{ passive: true }`; the effect must not depend on
   `activeHeading`.
3. **Nothing floats against the viewport.** No `position: fixed` chrome; the shell is a three-row
   flex column. `min-height: 0` on flex scroll containers is load-bearing.
4. `@media (max-height: ...)` rules go at the bottom of `App.css`.
5. **Offline only.** No webfont CDNs (fonts via `@fontsource`), no telemetry, analytics, crash
   reporting or new outbound requests. The only request is the GitHub update check.
6. Don't touch the LaTeX repair regexes in `processMarkdown` casually (they match literal control
   characters on purpose); `markedKatex` keeps `{ throwOnError: false, nonStandard: true }`.

Also:

- The code-extension list lives in `electron/main.cjs`, `src/fileKinds.js` and the generated blocks
  in `build/installer.nsh`; they must agree (`test/windows-registration.test.mjs`). Check new
  extensions against `PROTECTED_EXTENSIONS` (`.bat`/`.cmd` must never be registered). Don't add an
  extension gate to opening files.
- deb/rpm install scripts run as root; extend `test/linux-package-scripts.test.mjs` with any change.
- Renderer-only packages belong in `devDependencies` (Vite bundles them); only what `electron/*.cjs`
  requires at runtime goes in `dependencies`. Checks fails if renderer packages land in `app.asar`.
- Workflow actions are pinned by commit SHA with the version in a comment. The Linux publish job
  holds the signing key and must never run npm or third-party actions. The rolling `apt` and
  `repodata` releases must stay marked prerelease.
- Must still work at the 680x520 minimum window size, in more than one theme, and respect
  `prefers-reduced-motion`.

## Don't

- Bump the version or edit `CHANGELOG.md` - releases are cut by the maintainer.
- Rename or restyle the FATE brand (BRAND.md).
- Mix sweeping reformatting into functional changes; keep a PR to one concern.

## Commits and PRs

Branch off `main` (`fix/...`, `feat/...`). Commit subjects say what changed and why. PRs follow
`.github/PULL_REQUEST_TEMPLATE.md` (What / Why / How it was verified, plus its checklist).
