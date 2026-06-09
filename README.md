# FATE (Formatted Article & Text Explorer)

FATE is a beautiful, elegant, and highly resilient Markdown viewer built specifically for technical documents, research papers, and advanced documentation. Powered by Electron, Vite, and React, FATE delivers an instant and seamless reading experience for complex files.

## Features & Capabilities

- **Instant Viewing:** Drag & drop any `.md` or `.markdown` file directly into the app, or set FATE as your default markdown viewer.
- **Deep LaTeX Math Support:** Perfectly renders complex inline and block mathematical equations, fractions, and multi-line matrices using KaTeX.
- **Surgical Math Auto-Repair:** FATE includes a custom algorithmic layer that detects and dynamically heals corrupted backslash escapes (e.g., `\theta`, `\begin`, `\approx`) caused by poorly escaped markdown generators before they hit the screen.
- **Interactive Table of Contents:** Automatically generates a sidebar table of contents. Headings containing math equations are flawlessly rendered directly in the sidebar!
- **Premium Aesthetics:** Clean typography, glassmorphic UI elements, dynamic micro-animations, and a polished dark-theme design.
- **Print to PDF:** Need a hard copy? Print your perfectly formatted documents directly to PDF with optimized page margins and scaling.

## Keyboard Shortcuts

FATE supports standard accessibility shortcuts to improve your reading experience:

| Action | Shortcut |
| --- | --- |
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

## Changelog

### v1.1.0
- **[Enhancement]** Enabled `nonStandard` boundaries for the KaTeX inline parser, eliminating parse failures when equations are tightly packed against punctuation or parentheses.
- **[Enhancement]** Upgraded the Table of Contents sidebar to natively render mathematical equations inside headings.
- **[Feature]** Added fully scaled Microsoft Store (AppX) tile assets to replace default generic icons.
- **[Maintenance]** Cleaned up build scripts and prepared the application for production release.

### v1.0.8
- **[Feature]** Injected dynamic auto-repair algorithms into the file parser to automatically reconstruct corrupted LaTeX string literals (such as missing `\` for `\theta`, `\approx`, and `\begin` cases).
- **[Bugfix]** Fixed viewport cutoff scaling bugs that occurred when the Table of Contents sidebar was expanded on ultrawide monitors.
- **[Enhancement]** Styled scrollbars to match the application's premium dark red aesthetic theme.
- **[Feature]** Implemented Print to PDF functionality with correctly inverted light-theme printer styles.
