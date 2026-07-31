# FATE (Formatted Article & Text Explorer)

FATE is a beautiful, elegant, and highly resilient Markdown viewer built specifically for technical documents, research papers, and advanced documentation. Powered by Electron, Vite, and React, FATE delivers an instant and seamless reading experience for complex files.

## Features & Capabilities

- **Instant Viewing:** Drag & drop any `.md` or `.markdown` file directly into the app, or set FATE as your default markdown viewer.
- **Deep LaTeX Math Support:** Perfectly renders complex inline and block mathematical equations, fractions, and multi-line matrices using KaTeX.
- **Surgical Math Auto-Repair:** FATE includes a custom algorithmic layer that detects and dynamically heals corrupted backslash escapes (e.g., `\theta`, `\begin`, `\approx`) caused by poorly escaped markdown generators before they hit the screen.
- **Interactive Table of Contents:** Automatically generates a sidebar table of contents. Headings containing math equations are flawlessly rendered directly in the sidebar!
- **Premium Aesthetics:** Deep navy surfaces with metallic gold accents, engraved Cinzel display type, and gilded hairlines — the VagueDustin Enterprises design language.
- **Four Themes:** **FATE** (navy & gold, default), **Crimson** (the classic red look), **Light**, and **Dracula**. Each theme is a single block of design tokens, so the entire UI retunes together.
- **Fully Offline:** Typefaces ship with the app. No webfont CDN, no network requests, no telemetry — see [PRIVACY.md](PRIVACY.md).
- **Print to PDF:** Need a hard copy? Print your perfectly formatted documents directly to PDF with optimized page margins and scaling — on a clean white, ink-saving background whatever theme you read in.

## Keyboard Shortcuts

FATE supports standard accessibility shortcuts to improve your reading experience:

| Action | Shortcut |
| --- | --- |
| **Open File** | `Ctrl` + `O` |
| **Close File / Return Home** | `Escape` |
| **Zoom In** | `Ctrl` + `+` |
| **Zoom Out** | `Ctrl` + `-` |
| **Reset Zoom** | `Ctrl` + `0` |
| **Print / Export PDF** | `Ctrl` + `P` |

## How to Build from Source

Don't want to use the pre-compiled releases? You can easily build FATE from source:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/VagueDustin/FATE.git
   cd FATE
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Run the development server:**
   ```bash
   npm run electron:dev
   ```
4. **Compile the executable:**
   ```bash
   npm run electron:build
   ```
   The built installers will be output to the `dist-electron/` directory.

## Printing & PDF export

`Ctrl`+`P` opens a real **page-by-page preview** — actual paginated output, not a printer picker with
"This app doesn't support print preview". A separate button exports straight to PDF.

Both render through the same print stylesheet, so what you preview is what prints:

- **White paper, black ink** whatever theme you read in
- **Heading bookmarks** in exported PDFs, built from the document's own structure
- **Page numbers** and the document name in the header
- **Tagged PDF** output, so screen readers can navigate the export
- Code blocks, tables, images and block equations avoid being split across pages
- Paper size and orientation in Settings → Printing

## Contributing

Pull requests are welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup and the house rules.
For anything non-trivial, open an issue first.

## Licence & brand

The **code** is [MIT](LICENSE) — fork it, modify it, ship it, sell it.

The **name and the artwork are not.** "FATE", "VagueDustin Enterprises", the gilded badge and the
document mark are trademarks and artwork owned by VagueDustin Enterprises, and all rights in them are
reserved. MIT is a copyright licence and says nothing about trademarks, which is exactly why
**[TRADEMARK.md](TRADEMARK.md)** exists.

In short: fork freely, but **rename and re-skin before you distribute.**

## Changelog

### v1.8.1
- **[Bugfix]** **Exported PDFs printed table rows in navy on white paper.** The print stylesheet reset colours element by element and had missed `table tr` (which uses the app's dark surface tokens), the table cell borders, `hr`, and the blockquote tint — so black text landed on a near-black background. Confirmed by decompressing the PDF content stream: rows were being filled `#070B1A`. The reset is now a blanket one — every background inside the document is zeroed and only deliberate light values are added back, so anything added in future is print-safe by default.
- **[Bugfix]** `printBackground` was set to `false` on the reasoning that the stylesheet forces white paper anyway. It was doing nothing: the stylesheet also sets `print-color-adjust: exact`, which overrides that flag and forces backgrounds to paint. The flag is now `true` and honest about it, with the stylesheet as the single source of truth — which means tables keep light zebra striping and code blocks a grey background, both of which help on paper.
- **[Bugfix]** **Ticking "make FATE the default for .md" during install stopped working in 1.7.0.** The installer's un-associate branch keyed off a variable that is only assigned when the custom install page actually runs; if it didn't, the empty value compared unequal to "checked" and the branch fired on every install. That was harmless while it deleted keys that never existed — but 1.7.0 corrected it to delete the real ones, at which point the latent bug began actively stripping the association. It now defaults to "checked" and only an explicit uncheck un-associates.
- **[Bugfix]** That same branch also deleted the `Markdown Document` ProgId outright, taking FATE's open command and icon with it — which removed FATE from the Windows "Open with" list entirely and let Windows fall back to another handler. Declining the checkbox now releases the `.md` claim while leaving FATE registered and selectable.
- **[Bugfix]** Settings could report "FATE currently opens .md files" when it didn't. If the ProgId resolved to no command — exactly the broken state above — the check fell back to matching the ProgId *name* and returned a false positive. A ProgId with nothing to run is no longer treated as a default.
- **[Enhancement]** Wide tables and long block equations shrink to the page instead of being cropped at the margin, and block equations avoid being split across pages.

### v1.8.0
- **[Feature]** **Print preview actually works.** `Ctrl`+`P` now opens a real page-by-page preview instead of the Windows dialog reporting *"This app doesn't support print preview"* — Electron ships Chromium without the print-preview UI, and no flag turns it on. FATE now renders the document to a PDF through its own print stylesheet and previews that, so what you see is exactly what prints.
- **[Feature]** **Export as PDF** — a dedicated button in the document header, saving wherever you choose.
- **[Feature]** Exported PDFs carry **heading bookmarks** generated from the document's own structure, **page numbers**, the document name in the header, and **tagged-PDF** structure so screen readers can navigate them.
- **[Feature]** **Paper size and orientation** in Settings → Printing: Letter, A4, Legal, Tabloid, A3, A5, portrait or landscape. Applies to both preview and export.
- **[Removed]** **The "Show filename on Discord" option is gone.** Broadcasting the name of whatever file you have open to your entire friends list is a poor default for a documents app and not something worth a setting. Rich Presence is unchanged otherwise — it still shows that you're reading or idle, exactly as it did with the option switched off. The filename no longer even crosses the internal IPC boundary, and the stale setting is cleaned out of existing configs on upgrade.
- **[Bugfix]** Print and export are gated while a render is in flight, and a failed render now surfaces in the status bar instead of failing silently.
- **[Bugfix]** If Chromium's embedded PDF viewer is unavailable in a given build, the preview falls back to the system PDF handler rather than opening an empty window.
- **[Bugfix]** Fixed a temporal-dead-zone crash introduced while wiring the print shortcut: the keyboard effect named a `const` callback declared further down the component, which threw on every render and blanked the entire app. Caught before release.
- **[Bugfix]** The print shortcut could print under the *previous* document's header. Opening a second document while already reading doesn't change the viewing state, so the shortcut's effect never re-ran and held a stale filename.

### v1.7.0
- **[Feature]** **Animated constellation sky** behind the home screen — twinkling starfield, larger constellation stars with cross glints, faint linking lines, the occasional meteor, and a slow gold halo breathing behind the badge. Ported from the [702 Squad](https://palworld.702squad.com) portal, the ceremonial-tier expression of the same brand.
  - Home screen only. Nothing animates behind a document you're reading — the loop is torn down the instant one opens.
  - Follows the active theme: gold in FATE, red in Crimson, violet in Dracula, dark gold on Light.
  - Pauses entirely while the window is hidden, and honours `prefers-reduced-motion` by rendering one static frame.
- **[Bugfix]** **Fixed the default-app check, which was always wrong.** FATE reported "no app is set for `.md` files yet" even when Windows plainly had FATE as the handler. Two causes: it read `HKCU\Software\Classes\.md\UserChoice`, a key that doesn't exist on Windows 10 or 11 — the real one lives under `Explorer\FileExts\.md` — and it compared against a ProgId (`FATEMarkdownViewer.md`) that was never registered. The actual ProgId is `Markdown Document`.
- **[Enhancement]** Detection no longer trusts the ProgId name. "Markdown Document" is generic enough that another app could claim it, so FATE now resolves the ProgId's open command and checks it actually points at FATE's own executable — answering "would double-clicking a `.md` file open *me*?" rather than a proxy for it.
- **[Enhancement]** **"Set as default" now opens the Windows Open-With dialog**, which has the "Always use this app" checkbox — one dialog, one tick, done. It previously deep-linked to the Default apps page with a parameter Windows ignored (there's no `RegisteredApplications` entry), so you landed on the full list and had to search `.md` by hand. The Settings page remains the fallback.
- **[Bugfix]** **The window and taskbar now read "FATE - Markdown Viewer"** instead of a bare "FATE". Windows truncates the taskbar label from the *start* of the window title, so the app name has to lead it; title composition moved into the main process so the renderer can't set a wrong one. Pinned shortcuts get an explicit name too.
- **[Feature]** Opened the repo to contributions: `CONTRIBUTING.md`, `TRADEMARK.md`, PR and issue templates. Code stays MIT; the name and artwork are explicitly reserved.
- **[Bugfix]** The starfield's rebuild was debounced with `requestAnimationFrame`, which never fires while a window is hidden — a resize or theme change made while minimised was dropped and never applied. Debounced with a timer instead, and a `MutationObserver` on `data-theme` now repaints on theme switch rather than waiting for a resize.

### v1.6.0
- **[Feature]** New **gilded badge artwork** across every surface — window and taskbar icon, installer, Add/Remove Programs entry, Microsoft Store tiles, the home screen, and the About panel. Matching document mark for `.md` file associations. All sizes are derived from two masters in `brand/` by `npm run icons`.
- **[Feature]** **Set FATE as your default Markdown app** — Settings → Windows Integration. Shows whether FATE currently handles `.md`, re-checks whenever the window regains focus, and deep-links to the Windows Default Apps page. Windows deliberately blocks apps from claiming a file type silently, so the UI says so rather than pretending the button did it.
- **[Feature]** **Recent documents** on the home screen. The last eight files you opened, with folder and relative time, click to reopen. Files that have since moved or been deleted are shown struck through rather than silently dropped, and clicking one prunes it.
- **[Feature]** **Open File button** with its `Ctrl`+`O` shortcut shown inline — previously the only discoverable way in was to click the drop area.
- **[Enhancement]** **Rebuilt the layout as a proper app shell.** The version readout, settings gear and update button used to be absolutely positioned in the bottom corners, where they overlapped the drop area and each other once the window got small. They now live in a real status bar row at the bottom of the shell, which makes that overlap *structurally* impossible at any window size rather than something to keep tuning breakpoints against.
- **[Enhancement]** The status bar also shows live reading progress while a document is open — written straight to the DOM, so it costs nothing per scroll frame.
- **[Enhancement]** **Settings is reachable while reading.** The gear is in the viewer header alongside a new Print button; previously Settings only existed on the home screen, so you had to close your document to reach it.
- **[Enhancement]** Home screen reworked into two panes on wide windows, so the horizontal space carries the recents list instead of sitting empty. Stacks to one column below 860px, and tightens its vertical rhythm on short windows so it fits without scrolling even at the minimum size.
- **[Enhancement]** The window now has a **minimum size** (680×520). The layout is responsive down to there and simply refuses to get smaller rather than degrading.
- **[Enhancement]** Sidebar toggle, print and settings are proper icon buttons with hover, focus and title tooltips, instead of bare clickable SVGs.
- **[Bugfix]** Added a global `box-sizing: border-box`. Without it padding was added *on top of* every width and height, so a panel capped at 268px actually occupied 291px — every sized box in the app was quietly lying about its size.
- **[Bugfix]** Print styles now also reset the new shell containers, so printing from the redesigned layout still produces a clean single flow.
- **[Maintenance]** Icon masters live in `brand/` and every raster size is script-derived; nothing is hand-exported. Removed the unused `src/assets/FATE-Icon.png`.
- **[Maintenance]** NSIS installer, uninstaller and header icons are now configured explicitly instead of relying on electron-builder's fallback.

### v1.5.0
- **[Feature]** Rebuilt the interface on the **VagueDustin Enterprises design language** — deep navy surfaces, metallic gold accents, engraved Cinzel display type, gilded hairlines. Applied at the *utility* ornament tier, the tier intended for tools: no filigree, no ambient motion, density and scanning speed first.
- **[Feature]** Document headings, table headers, and section labels now set in **Cinzel**, so rendered markdown reads as typeset rather than dumped.
- **[Feature]** Added the **Crimson** theme — the pre-1.5.0 red identity, kept as an explicit choice so nobody is forced off it by the rebrand.
- **[Feature]** New navy-and-gold application and document icons, including a purpose-drawn simplified mark at 16/24px rather than a downscale that turned to mush in Explorer.
- **[Enhancement]** **Typefaces are now bundled with the app.** Cinzel and Inter ship as local assets and the Google Fonts request on every launch is gone — FATE is genuinely offline now, matching what `PRIVACY.md` already promised.
- **[Enhancement]** Rewrote the stylesheet to be entirely token-driven. Themes were previously ~300 lines of per-theme override cascade that had to be touched for every change and had already drifted; each theme is now a ~25-line block of custom properties, and `src/App.css` contains no colour literals at all.
- **[Performance]** Scrolling no longer re-renders the app. The progress bar is written straight to the DOM, the scroll handler is throttled with `requestAnimationFrame`, heading elements are cached per document instead of re-queried every frame, and listeners are registered `passive`. Scrolling a large document went from a full React commit per tick — re-rendering the whole markdown body and every KaTeX node in it — to none.
- **[Performance]** Fixed the scroll effect depending on `activeHeading`, which tore down and re-registered the scroll listener on every heading change mid-scroll.
- **[Bugfix]** Drag-and-dropped files resolve their path again, via `webUtils.getPathForFile`. Electron 32 removed `File.path`, which had silently broken relative image loading for dropped documents; files opened via the dialog or a file association were unaffected.
- **[Bugfix]** Printing now actually produces the white, ink-saving output the docs described — the previous version printed the dark theme verbatim, background included.
- **[Bugfix]** `Escape` inside the Settings modal closes the modal instead of closing the document behind it.
- **[Bugfix]** Opening a new document resets scroll progress and the heading cache, so a stale table-of-contents highlight no longer carries over from the previous file.
- **[Accessibility]** Visible focus rings on all interactive controls, and `prefers-reduced-motion` now disables every decorative animation.
- **[Maintenance]** Icons are generated from vector sources via `npm run icons` instead of being hand-exported.

### v1.4.2
- **[Bugfix]** Fixed missing Dracula theme hooks for interactive UI buttons and scrollbars.
- **[Bugfix]** Corrected Discord RPC payload mapping to accurately mask the filename when Privacy Mode is enabled.

### v1.4.1
- **[Feature]** Added the Dracula theme option.
- **[Enhancement]** Refactored Discord Rich Presence to use a "Privacy Filter" instead of completely disabling the client.
- **[Enhancement]** Added a red pulsing glow to the Settings gear icon.
- **[Bugfix]** Fixed Light theme typography contrast by applying aggressive readability overrides to markdown headers and paragraphs.

### v1.4.0
- **[Feature]** Implemented a dynamic Settings modal featuring Theme toggling, Discord RPC control, Automatic Updates toggle, and an adjustable sidebar width.
- **[Feature]** Built a dynamic keyboard shortcut re-binding system.
- **[Feature]** Added a persistent `electron-store` backend to seamlessly save all user preferences across application updates.
- **[Feature]** Added a custom NSIS installer checkbox to automatically associate FATE with `.md` and `.markdown` files.
- **[Maintenance]** Streamlined GitHub releases to exclusively publish the optimized `.exe` installer.

### v1.3.0
- **[Feature]** Fully integrated Discord Rich Presence to proudly display your reading activity.
- **[Enhancement]** Complete UI responsiveness overhaul using fluid Flexbox scaling.
- **[Enhancement]** Rebranded core identity and window titles to explicitly declare "FATE - Markdown Viewer".
- **[Enhancement]** Integrated premium square FATE app icons and rectangular FATE document icons for `.md` Windows File Explorer associations.
- **[Enhancement]** Regenerated and unified all Microsoft Appx package tile assets.
- **[Maintenance]** Completely purged all default boilerplate graphics from the source tree.


### v1.1.0
- **[Feature]** Injected dynamic auto-repair algorithms into the file parser to automatically reconstruct corrupted LaTeX string literals (such as missing `\` for `\theta`, `\approx`, and `\begin` cases).
- **[Feature]** Implemented Print to PDF functionality with correctly inverted light-theme printer styles.
- **[Feature]** Added fully scaled Microsoft Store (AppX) tile assets to replace default generic icons.
- **[Enhancement]** Enabled `nonStandard` boundaries for the KaTeX inline parser, eliminating parse failures when equations are tightly packed against punctuation or parentheses.
- **[Enhancement]** Upgraded the Table of Contents sidebar to natively render mathematical equations inside headings.
- **[Enhancement]** Styled scrollbars to match the application's premium dark red aesthetic theme.
- **[Bugfix]** Fixed viewport cutoff scaling bugs that occurred when the Table of Contents sidebar was expanded on ultrawide monitors.
- **[Maintenance]** Cleaned up build scripts and prepared the application for production release.

### v1.0.8
- **[Compliance]** Added `PRIVACY.md` and explicitly defined `displayName` in AppX build configuration for Microsoft Store validation.

### v1.0.7
- **[Minor]** Added trademark symbol to AppX publisher display name.

### v1.0.6
- **[Bugfix]** Resolved build artifact collision by disabling the portable target.

### v1.0.5
- **[Enhancement]** Bypassed CDN cache.

### v1.0.4
- **[Bugfix]** Added explicit publisher information and fixed artifact naming conventions.

### v1.0.3
- **[Bugfix]** Fixed a critical race condition, dynamically hid update UI when viewing a document, and re-enabled GPU rendering support.

### v1.0.2
- **[Feature]** Added automatic update UI and resolved Discord overlay conflicts.

### v1.0.1
- **[Enhancement]** Configured automatic updates and applied MIT licensing.

### v1.0.0
- **[Release]** Initial FATE Markdown Viewer release with Electron, React, and Vite.
