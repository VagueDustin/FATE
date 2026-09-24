# Contributing to FATE

Thanks for taking an interest. FATE is a text and code editor with a Markdown preview, and pull
requests are welcome, whether it's a one-line typo fix or a new editor feature. This guide covers
how to get a working build, how PRs flow, and the few rules that keep the app stable.

FATE is maintained by **VagueDustin Enterprises**. The code is [AGPL-3.0](LICENSE); the name and
artwork are not (see [BRAND.md](BRAND.md)). Contributions are reviewed and merged at the
maintainer's discretion.

**Contribution licensing:** by submitting a pull request you agree that your contribution is
licensed under the project's AGPL-3.0 licence, and you grant VagueDustin Enterprises the right to
relicense the project (including your contribution) under other terms in the future. If you can't
agree to that, please open an issue describing the change instead of a PR.

---

## What kinds of contributions help

- **Bug fixes.** Anything that crashes, loses data, renders wrongly or behaves differently from what
  the docs say. Issues labelled `good first issue` or `help wanted` are a good place to start.
- **Editor features and polish.** Things you'd expect from a Notepad++ style editor that FATE doesn't
  do yet, or does awkwardly. Open an issue first so we can agree on the shape.
- **File type and language support.** Better detection for unusual files, highlighting fixes, new
  extensions for the dialog filters and file associations (see the notes below on where those live).
- **Markdown rendering.** Math, Mermaid, tables, code fences and print output. A sample document that
  shows the problem is worth a lot.
- **Linux packaging.** AppImage, `.deb`, `.rpm`, Snap and Flatpak testing on distributions and
  desktops the maintainer doesn't use every day.
- **Accessibility.** Keyboard access, focus handling, screen reader labels, contrast in every theme.
- **Tests.** FATE has no automated test suite yet. Well-scoped tests for the pure modules in `src/`
  (for example `languageDetect.js`, `fileKinds.js`, `markdown.js`) would be a welcome start.
- **Documentation.** Clearer README sections, better screenshots, corrections.

## Before you write code

**For anything non-trivial, open an issue first.** A short "I'd like to add X, and I plan to do it by
doing Y" saves you from building something that gets declined for a reason you couldn't have known.

Small fixes (a typo, a crash, an obviously wrong value) can go straight to a PR. No ceremony needed.

## Setup

You need [Node.js](https://nodejs.org/) (CI uses Node 22) and git. Windows and Linux both work for
development.

```bash
git clone https://github.com/<your-username>/FATE.git   # your fork
cd FATE
npm install
npm run electron:dev      # Vite and Electron together, with hot reload
```

| Command | What it does |
| --- | --- |
| `npm run electron:dev` | Vite dev server and Electron together; the normal way to run FATE while you work |
| `npm run dev` | renderer only, in a browser (no Electron APIs; the app degrades gracefully) |
| `npm run lint` | ESLint; **must pass** |
| `npm run build` | production renderer build; **must pass** |
| `npm run icons` | regenerate every icon from the masters in `brand/` (needed before packaging) |
| `npm run electron:build` | Windows installer and Store package in `dist-electron/` |
| `npm run electron:build:linux` | Linux AppImage, `.deb` and `.rpm` in `dist-electron/`; run `npm run icons` first, have `rpmbuild` installed, and put the public signing keyring in `build/` (README → Building from source) |
| `node scripts/write-snap-desktop.mjs` | regenerate `snap/gui/` (desktop entry and icon) for the snap build from package.json |
| `bash scripts/setup-signing-key.sh` | **maintainer, once:** create the package-signing key and store it as the `FATE_GPG_PRIVATE_KEY` secret |
| `powershell -File scripts/setup-snap-store-token.ps1` | **maintainer, once:** create the Snap Store upload token for `fate` and store it as the `SNAPCRAFT_STORE_CREDENTIALS` secret |

To run a development copy beside an installed FATE without sharing settings, set the
`FATE_USER_DATA` environment variable to a separate folder. It gets its own profile and its own
single-instance lock.

## Testing your change

There is no automated test suite yet, so testing means:

1. `npm run lint` and `npm run build` both pass.
2. Run the app with `npm run electron:dev` and exercise what you changed, including the edge cases
   (unsaved changes, several tabs open, a large file, a file changed on disk).
3. If it's visual, check it in more than one theme and at the minimum window size (680×520).
4. If it touches packaging or file associations, build the package for that platform and install it.

Say in the PR what you tried. "Built it and clicked through it on Windows 11" is a fine answer.

## Branch and pull request flow

1. **Fork** the repository and clone your fork.
2. **Branch off `main`** with a short descriptive name, for example `fix/save-as-extension` or
   `feat/goto-line`.
3. **Keep the PR to one concern.** A rename plus a bugfix plus a refactor is three reviews in one
   diff. Several small PRs are easier to merge than one large one.
4. **Commit** with messages that say what changed and why.
5. **Push** your branch and **open a pull request against `main`**. The PR template asks what you
   changed, why, and how you checked it.
6. **Include before and after screenshots** for anything visual.
7. **Don't bump the version or edit `CHANGELOG.md`.** Releases are cut by the maintainer, who writes
   the changelog entry.
8. Review happens on the PR. Once it's approved, the maintainer merges it.

---

## Where things live

- `src/`: the React renderer. `App.jsx` is the shell (tabs, split view, shortcuts, palette),
  `components/CodeEditor.jsx` is the CodeMirror editor, `components/MarkdownView.jsx` and
  `markdown.js` are the Markdown pipeline, `components/SettingsModal.jsx` is Settings, `brand.css`
  holds every theme.
- `electron/`: the main process (`main.cjs`: windows, file I/O, file watching, printing, Windows
  integration, updates), the preload bridge and the snap confinement helpers.
- `build/`: generated output and gitignored, with a few tracked exceptions (below).
- `snap/`, `flatpak/` and `.github/workflows/build-linux.yml`: Linux distribution channels.

**Note:** `build/` is gitignored except for hand-authored build source: `build/installer.nsh` (the
NSIS installer script), `build/com.vaguedustin.fate.metainfo.xml` (the AppStream metadata the Linux
packages install for software centres) and `build/linux/` (post-install scripts). That is why
`npm run icons` followed by `npm run electron:build` works from a fresh clone.

**The code-extension list lives in three places that must agree:** `electron/main.cjs`,
`src/fileKinds.js`, and the generated blocks in `build/installer.nsh`. The list is a curated dialog
filter and the set of types FATE registers for on Windows. It does **not** decide what opens. FATE
opens any text file; the only gates are the size cap and the binary sniff in `openAndWatchFile`.
Don't reintroduce an extension check on the command line or drag and drop (1.12.0 and earlier had
one, and "Edit in FATE" on a `.config` silently did nothing).

**Before adding an extension, check it against `PROTECTED_EXTENSIONS`.** A type whose system handler
runs the file itself (`.bat` and `.cmd`, whose open command is `"%1" %*`) must never be registered.
No application name appears in that command, so Windows' "Choose a default" picker has nothing to
offer for restoring it, and an editor that takes the type leaves the user unable to run their
scripts with no supported way back. Such types belong in `CODE_EXTENSIONS` (so the open dialog, drag
and drop and *Edit in FATE* still work) and in `PROTECTED_EXTENSIONS` (so nothing ever registers
them).

The Linux channels are all driven by `.github/workflows/build-linux.yml` from a release tag: apt and
dnf repositories (served from GitHub Releases under the rolling prerelease tags `apt` and
`repodata`), the Snap Store (`snap/snapcraft.yaml`) and Flathub (`flatpak/`). The workflow's header
comment explains the moving parts. The one rule to know is that the two rolling releases must stay
marked *prerelease*, or electron-updater on Windows and the AppImage will treat them as the latest
version.

---

## House rules

These aren't style preferences. Each one exists because breaking it caused a real bug.

### 1. No colour literals outside `src/brand.css`

Every on-screen colour comes from a CSS custom property. `src/App.css` must contain none.

```bash
rg -n '#[0-9a-fA-F]{3,8}\b' src/App.css   # every hit must be inside @media print
```

Themes are short token blocks in `brand.css`. **Do not add per-theme component overrides.** v1.5.0
deleted about 300 lines of exactly that, which had already drifted out of sync between themes.

### 2. Don't regress scroll performance

The Markdown view renders the whole document, every KaTeX node included, via
`dangerouslySetInnerHTML`. Putting scroll state into React re-rendered all of it on every tick. The
current design keeps scrolling free and must stay that way:

- The progress bar and the `%` readout are written **directly to the DOM** via refs, never `setState`
- The scroll handler is `requestAnimationFrame`-throttled; the listener is `{ passive: true }`
- Headings are cached per document, not re-queried per frame
- The effect **must not** depend on `activeHeading`. It used to, and re-registered the listener on
  every heading change mid-scroll

The same applies to the editor's `Ln, Col` readout, which is written straight to its status bar node.

### 3. Nothing floats against the viewport

The shell is a three-row flex column: progress bar / `.app-main` / status bar. Chrome pinned to the
corners with `position: fixed` overlapped the content at small window sizes; the status bar row
replaced it. `min-height: 0` on flex scroll containers is load-bearing.

### 4. `@media (max-height: …)` rules go at the bottom of `App.css`

They must come after the declarations they override. Equal specificity means source order decides,
and placing them earlier silently loses.

### 5. No webfont CDNs, no telemetry, no phoning home

FATE is fully offline and [PRIVACY.md](PRIVACY.md) promises it. Fonts are bundled via `@fontsource`,
and languages ship as local chunks. The only network request the app makes is the GitHub update
check on installs that update themselves.

### 6. Don't touch the LaTeX repair pass casually

The regex block in `processMarkdown` matches **literal control characters**: generators emit a real
tab byte where they meant `\theta`. It looks like a mistake and isn't. `markedKatex` must keep
`{ throwOnError: false, nonStandard: true }`; without `nonStandard`, a `$` against punctuation breaks
the whole document.

---

## How PRs are reviewed

- Does it work, and does it keep working at the 680×520 minimum window size?
- Does it hold up across the themes (FATE, Crimson, Light, Dracula, Nord, Gruvbox, One Dark, Rosé
  Pine, and a custom theme)?
- Does it keep unsaved work safe (dirty tabs, quit prompts, live reload)?
- Does it respect `prefers-reduced-motion` if it animates?
- Does it keep the app offline?
- Is it the smallest change that solves the problem?

### Likely to be declined

- Reintroducing floating or absolutely positioned chrome
- Hardcoded colours, or per-theme override cascades
- Telemetry, analytics, crash reporting, or any new outbound request
- Large dependencies for something small
- Renaming or restyling the brand (see [BRAND.md](BRAND.md))
- Sweeping reformatting mixed into a functional change

### Read what you submit

Whatever tools you use to write a change, read and test it before you open the PR. This repository
once received 14 near-identical PRs over two weeks, each a slightly different attempt at the same
scroll optimisation. All 14 were closed in favour of one reviewed commit. One considered PR beats a
dozen near-duplicates.

---

## Reporting bugs

Use the bug report form. Include your FATE version (Settings → About), your operating system (and
for Linux, how you installed FATE), what you did, what happened and what you expected. A sample file
helps enormously for anything to do with rendering, highlighting or saving.

## Security

Don't open a public issue for a security problem. Use GitHub's private vulnerability reporting on
this repository (see [SECURITY.md](SECURITY.md)), or reach out through
[vaguedustin.com](https://vaguedustin.com).

---

By contributing you agree your work is licensed under the [AGPL-3.0](LICENSE), that VagueDustin
Enterprises may relicense the project (including your contribution) under other terms in future,
and that contributing grants you no rights in the FATE or VagueDustin Enterprises name or artwork.
See [BRAND.md](BRAND.md).

*Provided by VagueDustin Enterprises™*
