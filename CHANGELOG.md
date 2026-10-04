# Changelog

What changed in each FATE release, newest first. Downloads and the same notes are on the [Releases page](https://github.com/VagueDustin/FATE/releases).

## v1.14.0
- **[New]** **Copy buttons on code blocks, and clean copies from the reading view.** Every code block in a Markdown document has a Copy button that copies its exact text, without the trailing newline that made a pasted command run straight away, and with Windows line breaks on Windows. Copying a selection no longer brings the theme with it (Word, Outlook and Teams pasted navy boxes or white text): code copies as plain text, everything else as plain text plus clean HTML that the other app formats its own way, and maths copies as its TeX source. Ctrl+A in the reading view selects the document instead of the whole window.
- **[New]** **Right-click menus.** Cut, Copy, Paste and Select All in the editor and in fields, Copy on a selection in the reading view, Copy Link Address on links, and spelling suggestions when spell check is on. Tabs have their own: Copy Full Path, Open Containing Folder, Close, Close Others and Close Tabs to the Right.
- **[New]** **An application menu.** Press Alt for File (with Open Recent), Edit, View and Help, labelled with your own shortcut bindings. On Windows, files you open also appear in FATE's Jump List.
- **[New]** **Files keep their line endings, encoding and indentation.** FATE detects each file's line endings (CRLF or LF), encoding (UTF-8, UTF-8 with BOM, UTF-16 LE/BE, Windows-1252) and indentation (tabs or spaces, and how wide), writes it back exactly that way, and shows all three in the status bar, where a click changes them: convert the line endings, save with another encoding, reopen a file whose encoding was guessed wrong, switch between tabs and spaces. UTF-16 files, such as PowerShell 5.1's output, now open instead of being refused as binary, and Makefiles and Go files indent with tabs.
- **[New]** **Hot exit.** Unsaved changes, Untitled tabs included, are backed up a moment after you type and come back if FATE crashes or loses power.
- **[New]** **When a file changes on disk while you're editing it,** a bar says so and offers Reload, Keep mine or Compare (side by side). A file deleted or moved away gets its own bar, and saving puts it back.
- **[New]** **Links in Markdown work.** A link to another file opens it in a tab (with or without a `#section`), `#anchors` scroll, and web and email links open in your browser after a confirmation. Headings get GitHub-style anchors, so links written for GitHub land in FATE too.
- **[New]** **Command palette modes:** `:` goes to a line, `@` lists the symbols in the current file (functions, classes, headings), and `#` searches the text of every open tab.
- **[New]** **Find in the reading view** (Ctrl+F), with a match count and next and previous.
- **[New]** **Edit mode scrolls the preview with you,** and renders Mermaid diagrams too.
- **[New]** **Large files and logs.** Files over 5 MB open with the heavier editor features off, and a Follow toggle in the status bar keeps a growing log scrolled to its end. Plain `.txt` files open as text in the editor (so do Markdown files over 2 MB), with Render as Markdown when you want the preview.
- **[New]** **Spell check while editing Markdown** (Settings → Markdown). On by default on Windows, where it uses Windows' own spell checker; off by default on Linux (see Privacy below).
- **[New]** **PowerShell, batch and Dockerfile code blocks are highlighted** in the reading view.
- **[Bugfix]** **Unsaved Markdown edits could be lost.** After editing a Markdown document and switching back to the reading view without saving, a change to the file on disk, or opening it again, replaced your edits; and going back into Edit mode treated the unsaved text as saved, so closing the tab or quitting no longer asked. Both are fixed.
- **[Bugfix]** **Clicking a relative link in a document replaced the whole app with an error page,** taking every tab and unsaved edit with it, and Ctrl+R or Ctrl+Shift+R did the same (Electron's hidden default menu reloaded the window). Neither can happen now, and anything that tries to reload a window with unsaved work asks first.
- **[Bugfix]** **Saving no longer converts Windows line endings to LF** (git showed every line changed, and LF-only batch files can break), and files that weren't UTF-8 are no longer damaged on save. **Saves are atomic:** FATE writes a temporary file and swaps it in, so a full disk or a dropped network share can't leave half a file behind; links stay links and permissions are kept.
- **[Bugfix]** **A large text file no longer blanks the window.** A 10 MB log crashed the Markdown renderer and took every tab with it. Rendering now falls back to plain text, and a recovery screen catches anything else, with your unsaved work backed up.
- **[Bugfix]** **Fewer ways to lose work:** text typed while a save was in progress was marked saved without reaching the disk; dropping a file onto the editor pasted its contents in as well as opening it; a reload jumped the caret to line 1; Save As over a file open in another tab dropped that tab's unsaved changes. Closing a tab with unsaved changes now offers Save. And the same file no longer opens twice when FATE starts with a file from the last session, or grows another duplicate in the session on every launch.
- **[Security]** **Documents can't reach out of the preview any more.** Style tags, inline styles outside maths, forms, dialogs and the app's own class names are stripped, so a document can't restyle or cover the app; a Content Security Policy now applies to the whole window; Mermaid's output is sanitised too. An image written as `//server/share/x.png` is treated as a web image and never fetched over Windows file sharing, which handed your Windows sign-in hash to that server just for opening the document, and FATE's local image protocol now serves only local image files.
- **[Privacy]** **Images from the internet stay off until you allow them,** for one document (Load images) or always (Settings → Markdown). Before, opening a document fetched them silently, which tells their servers when and from where it was read. FATE also no longer fetches remote images while rendering in the background, and Mermaid diagrams never load them.
- **[Privacy]** **No dictionary download on Linux.** Electron's built-in spell checker downloaded a dictionary from Google's servers the first time FATE ran on Linux, although FATE never used it. Nothing is downloaded now unless you turn spell check on.
- **[Security]** The main process only saves to files FATE has open and only accepts settings it knows, so a compromised document can't use them to write elsewhere, and web links opened in a new window ask first, like every other link.
- **[Bugfix]** **Maths:** square roots, vector arrows, wide hats, braces and tall brackets render again (their SVG was being stripped), "$5 and $10" stays text, `\ ` stays a space, and the LaTeX repair pass leaves code alone (it rewrote tab-indented code and `My\ Documents`). A UTF-8 byte-order mark no longer hides the first heading.
- **[Bugfix]** **Mermaid diagrams render reliably.** They were wiped whenever the window regained focus or the app updated its status, never rendered in the right-hand split pane, and a broken diagram left error graphics that could print. Local images with spaces or accented letters in their names load.
- **[Bugfix]** **Diffs are syntax highlighted** (they never were), and a diff closes with its tabs.
- **[Bugfix]** **Escape only closes a tab when you're not typing.** In the editor, a field or a menu it no longer closes the document.
- **[Bugfix]** **Shortcuts:** the recorder no longer stays armed after Settings closes, where a stray key could become a shortcut; single letters can't be bound; shortcuts that use the + key work.
- **[Bugfix]** **Split view:** shortcuts act on the pane you're working in, and the contents sidebar resizes correctly there.
- **[Bugfix]** Live reload recovers when a file is deleted and recreated, and another editor's save causes one reload instead of three. Log files that start with `[` are no longer mistaken for JSON, and comments in files like `tsconfig.json` aren't underlined as errors. Printing a Markdown document in Edit mode prints the rendered page. A second "Open with FATE" no longer briefly starts a second copy, and it opens every selected file and resolves relative paths properly. Several unreadable files from the last session produce one message, not one each.
- **[Enhancement]** **Faster:** the reading view no longer rebuilds every open document whenever the window regains focus or a tab switches; recent files are checked without freezing on unreachable network drives; the home-screen starfield pauses while FATE isn't focused.
- **[Enhancement]** **Accessibility:** Settings and the command palette are proper dialogs (focus moves in, stays in, and returns when they close), every setting has a name for screen readers, and the contents sidebar and the tab strip work from the keyboard.
- **[Enhancement]** **Much smaller downloads.** The packages carried a second copy of every library the app had already bundled. The app's own archive inside every installer, AppImage, package and snap shrinks from 211 MB to 13 MB.
- **[Bugfix]** **Installing and uninstalling.** Removing the `.deb` no longer leaves a repository entry that makes every later `apt update` fail; upgrading the `.rpm` no longer deletes the `FATE` command (and the upgrade to 1.14.0 puts it back); uninstalling on Windows also removes FATE's per-user file associations, so `.md` files don't point at a missing `FATE.exe` afterwards. The Microsoft Store package now offers *Open with FATE* for `.markdown`, `.txt` and the code types, not just `.md`. Windows updates download only what changed, from 1.14.1 on.
- **[Security]** **Release pipeline.** The key that signs the apt and dnf repositories is now used only in a job that runs no npm and no third-party code, and only if it matches the published fingerprint; third-party GitHub Actions are pinned to exact commits; a release must match the app's version, and drafts and prereleases never reach the stable channels. Pull requests are linted, tested, built and started before they merge.

## v1.13.4
- **[Bugfix]** **Linux: the taskbar recognises FATE's window.** Every desktop entry said `StartupWMClass=FATE - Formatted Article & Text Editor`, but FATE's window reports itself as `fate-markdown-viewer`, so desktops could not match the running window to its launcher: a generic icon in the taskbar, and pinning and grouping misbehaved. The `.deb`, `.rpm`, AppImage and snap entries now name the window's real app id.
- **[Bugfix]** **Linux: FATE no longer becomes the default for SVG images.** FATE declared `image/svg+xml`, so on a system with no explicit SVG default, double-clicking an image could open it in the editor. SVG source still opens through *Open With → FATE*.
- **[New]** **A package for Arch Linux.** `aur/` holds a PKGBUILD for `fate-editor-bin`, which repackages the released `.deb` for Arch, Manjaro, EndeavourOS and CachyOS. It installs to `/opt/fate-editor` with a `fate-editor` launcher, keeps FATE's own updater off, and the status bar says updates come from pacman. Until it is published on the AUR, build it from a clone with `makepkg -si`. The README also notes that the AppImage needs FUSE 2.
- **[Security]** **DOMPurify 3.4.15 → 3.4.16** (the Markdown sanitiser), plus build-tool updates (fast-uri, brace-expansion, http-cache-semantics), including the fix for a fast-uri advisory. `npm audit` reports zero findings.

## v1.13.3
- **[Bugfix]** **Snap: files on removable drives no longer disappear silently.** The snap declares the `removable-media` interface, but the Snap Store does not connect it on install, and FATE treated the resulting "permission denied" exactly like "no such file": *Open with → FATE* on a document on a USB stick or a second disk did nothing at all. FATE now recognises the confinement case and shows the one command that fixes it (`sudo snap connect fate:removable-media`), checking first whether the interface is already connected so it never gives stale advice. Saving to such a path reports the same in the status bar, and hidden files in your home folder (which snap confinement never allows) get an honest explanation instead of a generic error. The same applies to any permission error on any platform: it is now reported, not swallowed.
- **[Removed]** **Discord Rich Presence is gone entirely.** FATE no longer talks to a Discord client at all: the dependency, the IPC channel, the Settings entry and the privacy-policy section are all removed. The only connection FATE makes is the GitHub update check on installs that update themselves.

## v1.13.2
- **[New]** **`apt install fate` and `dnf install fate`.** Every release now publishes a signed apt
  repository and signed dnf repodata, served entirely from GitHub Releases: the indexes live under
  two rolling prerelease tags (`apt` and `repodata`) and point at the versioned packages. The
  `.deb` and `.rpm` register the repository during installation, so a one-off download turns
  into `apt upgrade` / `dnf upgrade` keeping FATE current from then on. Both paths are tested on
  every release by installing `fate` from the live repositories in Debian and Fedora containers.
- **[New]** **Snap Store and Flathub packaging.** A strict-confinement snap (`fate`) is built on
  every release and uploaded to the Snap Store's stable channel; a Flatpak manifest
  (`com.vaguedustin.fate`) repackages the released `.deb` on Electron's Flathub base and is built
  and linted on every release, with Flathub's bot configured to pick up new versions on its own.
- **[Enhancement]** **Installs that have an owner no longer update themselves.** Flatpak, Snap,
  apt and dnf each deliver updates on their own schedule; FATE now recognises those installs and
  stays out of the way, the same way the Microsoft Store build does. The status-bar button says
  who is in charge and opens the latest release notes. The Windows installer and the AppImage
  still update themselves.

## v1.13.1
- **[Security]** **Every open Dependabot alert resolved: sixty of them.** They spanned the whole
  dependency tree: Electron/Chromium itself, electron-updater and its runtime, DOMPurify (the
  markdown sanitiser), js-yaml, fast-uri, and electron-builder's toolchain. Every fix was
  available within the existing version ranges, so nothing in `package.json` changed; the lock
  moved. Electron 42.3.3 → 42.11.3, electron-updater 6.8.3 → 6.8.9, DOMPurify 3.4.8 → 3.4.15,
  electron-builder 26.8.1 → 26.15.3. `npm audit` reports zero findings.
- **[Bugfix]** **Local images in Markdown documents load: they never did.** A relative image
  such as `![](docs/shot.png)` was rewritten to `fate-local:///C:/…`, and Chromium collapses the
  empty authority of a standard scheme the way it does for `http:///host`: `C:` became the host,
  the drive letter vanished, and every local image failed with *file not found* while its `src`
  still looked right. Confirmed on the previous Electron too: the URL shape, not a Chromium
  change. Images now travel as `fate-local://local/<encoded path>`, so filenames containing `#`,
  `?` or `%` work as well.
- **[Enhancement]** **Linux packages are real applications.** The `.deb`/`.rpm` register FATE
  for Markdown, plain text and about sixty code MIME types (so it appears under *Open With* and
  can be made the default from the file manager or `xdg-mime`) and ship AppStream metadata for
  GNOME Software / KDE Discover. A Fedora `.rpm` joins the AppImage and `.deb`. These landed
  right after v1.13.0 and were attached to that release; they are part of this version's source.

## v1.13.0
- **[Enhancement]** **FATE opens any text file.** Up to 1.12.0 the command line, *Edit in FATE*
  and drag & drop accepted only extensions on a built-in list of about ninety, so `web.config`, a
  `.properties` file, a `.reg` export, a `.csv`, an extensionless script (anything not on it) did
  nothing at all, silently, while the Open dialog would load the very same file. The list no
  longer gates anything; the only checks left are the ones that matter (a 25 MB size cap and a
  binary sniff), and both explain themselves. The Open and Save As dialogs default to *All files*,
  so nothing hides behind a filter switch, and Save As no longer appends `.md` to a name typed
  without an extension (saving a new buffer as `Dockerfile` produced `Dockerfile.md`).
- **[Enhancement]** **Unknown extensions get highlighting from their content.** A file the
  language registry has never heard of is sniffed: XML/HTML prologues (`web.config`, `.csproj`,
  `.plist`), JSON, INI sections and registry exports, and shebang lines (`#!/bin/bash`,
  `#!/usr/bin/env python3`, …). Anything ambiguous stays plain text rather than guessing wrong.
- **[New]** **Linux builds.** `npm run electron:build:linux` produces an AppImage, a `.deb`
  (Ubuntu, Debian) and an `.rpm` (Fedora, RHEL, openSUSE), and a *Build Linux* GitHub Actions
  workflow does the same on a real Linux runner for every tag.
  The app itself needed little: the Windows-only integration (file-type registration, Default
  apps, classic context menus) was already gated and simply doesn't appear; the installed-font
  picker now enumerates through fontconfig; paths compare case-sensitively where the filesystem
  does; and the window carries its own icon. The AppImage self-updates (`latest-linux.yml`); the
  `.deb` updates through the package manager.

## v1.12.0
- **[Bugfix]** **FATE no longer breaks `.bat` and `.cmd`, and this release repairs machines where
  it did.** Both were registered like any other code type, and for these two, that alone is
  destructive. Their handlers (`batfile`/`cmdfile`) open with `"%1" %*`, where the script *is* the
  executable; as soon as a second handler appears in the type's "Open with" list and no explicit
  user choice exists, Windows stops running the script and shows **"Pick an app"** instead.
  Setting FATE as the default on its own Default-apps page then made it unrecoverable, because
  that picker has no "Windows Command Processor" to select. FATE now refuses to register either
  type at all. **The repair happens during install**: the per-machine entries a previous version
  wrote need elevation, so upgrading is what actually restores your batch files; the app repeats
  the per-user half on every launch and deletes any FATE `UserChoice` (which needs the parent key
  handle, not `reg.exe`; that asks for `KEY_ALL_ACCESS` and is refused by the key's deny ACE).
  Both types still open in FATE from the Open dialog, drag & drop, and *Edit in FATE*.
- **[Bugfix]** **"Claim file types" was breaking the very types it claimed to fix: it is gone, and
  a Repair button undoes it.** Claiming wrote a per-user class default for each unowned extension.
  On Windows 11 that does not make an app the handler *and* it suppresses the rule that does (being
  the only registered `OpenWithProgids` handler), so 39 file types that Explorer was happy to hand
  FATE ended up with no handler at all, while the counter reported them as won. On the author's
  machine: 68 of 86 claimed, 29 actually working. Repair removes those entries; the same machine
  went from **29 to 59** working types with one click.
- **[Bugfix]** **The coverage counter now asks the shell instead of guessing.** It resolves each
  type through `AssocQueryString` (the same API Explorer uses) rather than reimplementing an
  association order that turned out to be wrong. It also breaks the total down: how many types no
  app owns at all, and how many belong to something else.
- **[Enhancement]** **Quitting with unsaved work now offers to save it.** The prompt was
  "Discard changes and close?" with no way to keep them; it is now **Save / Don't save / Cancel**,
  asked per tab, with the tab in question brought to the front so you can see what you are
  answering about. Cancelling (or cancelling a Save As) calls the whole quit off.
- **[Enhancement]** **Turning off "reopen last session's tabs" now also forgets them.** The setting
  moved to a labelled control that explains both directions, and with it off FATE clears the stored
  tab list rather than keeping a record of files you asked it not to reopen.
- **[Bugfix]** **Opening a file while FATE is already running now switches to it.** Session restore
  reopens every tab from last time and each one took the focus as it arrived, so double-clicking a
  file to launch FATE landed you on whichever restored tab happened to load last. Restored tabs no
  longer steal the selection; an explicitly opened file always wins.
- **[Bugfix]** Every PowerShell helper now also passes `-WindowStyle Hidden` alongside `windowsHide`,
  which should settle the console window that occasionally blinked at launch.

## v1.11.5
- **[Bugfix]** **A custom install directory no longer gets reset on upgrade.** The installer's
  `preInit` unconditionally reseeded the remembered install location to the default publisher folder,
  so anyone who chose their own directory would be moved back to the default on every update,
  including silent auto-updates, which trust that remembered value. It now seeds the default only on
  a first install, or immediately after removing a pre-rename install.
- **[Bugfix]** **The rename migration could silently skip.** It read the remembered install location
  through `SHCTX`, which isn't reliably settled that early in `preInit`; if it resolved to HKCU while
  the old install was recorded in HKLM, the read came back empty and a pre-rename "FATE - Markdown
  Viewer" install would quietly survive beside the new one. Now reads HKLM explicitly, with an HKCU
  fallback.
- **[Licence]** FATE is now **AGPL-3.0**. Fork it, learn from it, improve it: anything you distribute
  or serve over a network ships its complete source under the same licence.
- **[Docs]** `TRADEMARK.md` is now **[BRAND.md](BRAND.md)**, rewritten to say what's actually true:
  no registered trademarks, just a brand and an alias, with artwork protected by copyright. The
  fork-and-rename checklist is current again (executable name, per-type ProgIds, the shell verb,
  store art). Contribution terms, PR and issue templates updated to match.
- **[Maintenance]** `build/installer.nsh` is now tracked in the repository: it's hand-authored build
  source, and without it a clone can't produce an installer at all. Generated icons and Store art stay
  ignored.

## v1.11.4
- **[Bugfix]** **Drag & drop actually works now, anywhere in the window.** Two root causes fixed: the drop library's file handles broke Electron's path resolution, and a drop landing outside the drop zone fell through to Chromium's default behaviour, *navigating the whole app to the dropped file*. Drops are now handled natively across the entire window (home screen, editor, tab strip, anywhere), with a gold "Release to open" overlay while dragging, and stray navigations are refused by the main process as a second line of defence.
- **[Feature]** **Broken code gets flagged as you type.** The editor now underlines regions the language parser cannot make sense of (missing brackets, unclosed strings, stray tokens) with a marker in the gutter and a tooltip on hover. Powered by each language's real parse tree, so there are no per-language lint configs and no false-positive guessing; structural parsers (JavaScript, TypeScript, HTML, CSS, JSON, Python, and most others) report precisely, and shell-style languages report nothing rather than noise. Toggle under Settings → Code Editor.

## v1.11.3
- **[Feature]** **Use any font installed on your PC.** Every font picker (interface, markdown documents, code, and per-file-type overrides) now offers the fonts installed on your system alongside the bundled library, with a search box, each candidate previewed in its own typeface, and Enter to take the top match. Selections persist as `system:<Family>` and degrade gracefully through the standard fallback stack if a font is later uninstalled. Enumeration is one local query, cached per run; nothing leaves your machine.
- **[Maintenance]** Dev/test instances can run beside an installed FATE via the `FATE_USER_DATA` environment variable (separate profile, separate single-instance lock).

## v1.11.2
- **[Bugfix]** **Mermaid diagrams now render reliably.** Two causes fixed: rendering was attempted inside hidden (backgrounded) tabs, where SVG text measurement returns zeros and mermaid fails; the pass now runs when the tab is visible and re-runs on activation; and fences are only marked processed after their SVG actually lands, so a re-render can no longer strand them.
- **[Bugfix]** **Live reload now catches atomic saves.** Most editors (VS Code included) save by writing a temp file and renaming it over the original, which arrives as a `rename` event the watcher used to ignore; FATE now re-attaches to the new file and reloads.
- **[Bugfix]** Spurious file-watch events (antivirus scans, indexing) no longer trigger pointless re-renders: a change notification with identical content is ignored, which also stops rendered diagrams from flickering back to source.

## v1.11.1
- **[Feature]** **"Edit in FATE" on the right-click menu** for every file: a classic shell verb with the FATE badge, written by both the installer and the runtime self-heal. On Windows 11 it lives under *Show more options* (the top-level modern menu requires a packaged `IExplorerCommand`, which an NSIS install cannot provide; that's why Notepad++ ships a companion MSIX for theirs).
- **[Feature]** **Settings → Windows → "Always show full context menus"**: the practical route to top-level placement: an opt-in, fully reversible per-user switch that restores Windows 11's classic right-click menu everywhere (where Edit in FATE sits at the top level), with a one-click Explorer restart to apply.
- **[Bugfix]** Every shortcut shown in a tooltip or keycap chip (tab strip, home screen, header buttons) now renders the **live binding** instead of a hardcoded default; rebind an action and its hints follow.
- **[Feature]** **Diff your unsaved changes.** The header's diff button (and `Ctrl+K` → "Diff unsaved changes") with no split open compares the current buffer against the last-saved state, side by side, chunk-aligned. With a split open it diffs the two panes as before. `Escape` exits a diff.
- **[Enhancement]** New file default shortcut is now `Ctrl`+`T` (browser-style; rebindable as ever).
- **[Bugfix]** The font picker opens upward when it sits near the bottom of the Settings pane instead of clipping into the modal edge.
- **[Bugfix]** The registry self-heal now gates on `app.isPackaged` rather than `NODE_ENV`, so a production-mode dev run can never register ProgIds pointing at the development toolchain's electron.exe.
- **[Fixed]** About-page copyright now credits VagueDustin Enterprises.

## v1.11.0
- **[Feature]** **Every file type gets its own gilded icon.** All 83 code extensions now carry a document icon derived from the same master artwork as the markdown mark: the navy sheet, gold border and folded corner are pixel-identical; the M↓ gives way to the extension set in gold (`PS1`, `PY`, `JS`, `GRAPHQL`, …). Generated by script from the master (`npm run icons`), shipped in `resources\fileicons\`, and wired through one ProgId per type (`FATE.py`, `FATE.ps1`, …) so Explorer shows the right icon the moment FATE becomes a type's default. Existing associations made on earlier builds keep working via the legacy shared ProgId.
- **[Rebrand]** **FATE is now the *Formatted Article & Text Editor*.** The window title, taskbar, installer, Windows registration and Store metadata all carry the new name. Open documents title the window with **just the filename** (plus the unsaved `•`); the full name shows on the home screen. The app now installs to `C:\Program Files\VagueDustin Enterprises\FATE`, and the installer silently removes any pre-rename install first (cleaning up its directory), so the two never coexist.
- **[Feature]** **New files.** `Ctrl`+`N` (or the tab-strip/home buttons) opens an untitled buffer; saving offers **every supported format**, and the editor re-detects its language from the extension you choose: buffer, cursor and undo history survive the naming.
- **[Feature]** **Command palette** (`Ctrl`+`K`): one fuzzy search across open tabs, recent files, every command, and every theme.
- **[Feature]** **Markdown edit mode.** A labelled **Edit** button (and `Ctrl`+`E`) switches a markdown tab from the reading view to a split source editor with **live preview**; save with `Ctrl`+`S`, switch back to **View** and the reading view reflects your edits instantly.
- **[Feature]** **Split view** (`Ctrl`+`\`): any two open tabs side by side, built for ultrawides. The right pane has its own document selector, and a **Diff** toggle renders a chunk-aligned, syntax-highlighted comparison of the two panes (CodeMirror merge view, read-only snapshots).
- **[Feature]** **Every shortcut is rebindable** in Settings → Shortcuts: sixteen actions with conflict detection and one-click reset. `Ctrl`+`1` to `9` stays fixed.
- **[Feature]** **Four new themes**: Nord, Gruvbox, One Dark, Rosé Pine, each with its full syntax palette, plus a **custom theme builder**: pick seven colours, FATE derives the other ~30 tokens (borders, glows, gradients, syntax colours) and can export the generated CSS block.
- **[Feature]** **Mermaid diagrams** render inside markdown (```mermaid fences), fully offline, theme-aware, loaded lazily only when a document contains one.
- **[Feature]** **Session restore** (Settings → Appearance): reopen last session's tabs on launch. **Focus mode** (`Ctrl`+`Shift`+`F`): nothing but the document. **Reading time** joins the % read readout.
- **[Feature]** **Microsoft Store builds now handle updates honestly.** electron-updater cannot update an AppX, so the Store build never starts it; the update button routes to the Store's own downloads page and Settings says so, instead of a check that pretends and fails.
- **[Bugfix]** **The file-type coverage counter now counts the way Explorer decides**: user choice, then class default, then sole registered handler, instead of user choice alone, which under-reported (3 vs the real 22 on the author's machine; the sole-handler rule also exposed a classic PowerShell one-element-array unwrap bug, fixed). **Claim file types** takes every extension no app owns (per-user, one click, fully reversible from the same page); types owned by another app deep-link to FATE's page in Windows Settings, which now actually opens on FATE's page (the deep link needed `registeredAppMachine`, not `registeredAppUser`, for a per-machine registration).
- **[Bugfix]** **Registration self-heals.** The app asserts its per-user file-type registration at launch (ProgIds pointing at the running executable), so a raced upgrade, a moved install directory, or a vanished HKLM key can no longer leave "Open with FATE" broken. Discovered after an uninstall/reinstall cycle left ProgIds referenced by UserChoice with no command.
- **[Bugfix]** The installer's ".md default" checkbox is gone: defaults are managed from Settings → Windows, which is the only place that can actually set them on Windows 11 anyway.
- **[Bugfix]** KaTeX's stylesheet import was lost in the 1.10.0 refactor, which made every equation render twice (once as maths, once as raw MathML text). Restored, with a comment explaining why it is load-bearing.

## v1.10.0
- **[Feature]** **Tabs.** Open any number of files at once, Notepad++-style: markdown and code mixed freely. Every pane stays alive while backgrounded, so scroll position, cursor, selection and undo history survive tab switches. `Ctrl`+`Tab`/`Ctrl`+`Shift`+`Tab` cycles, `Ctrl`+`1` to `9` jumps (9 = last), `Ctrl`+`W` or `Escape` closes, middle-click closes, and the badge button returns to the home screen without closing anything. Opening an already-open file activates its tab instead of duplicating it. Per-tab dirty dots; the window guard arms if *any* tab has unsaved edits.
- **[Feature]** **A bundled font library, and font settings done properly.** Six code faces (JetBrains Mono, the new default, Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono, Roboto Mono) and five prose faces (Inter, IBM Plex Sans, Source Serif 4, Lora, Merriweather) ship inside the app: latin subsets only, fully offline, no CDN. Separate choices for interface, markdown documents, and code; text-size sliders for documents and the editor; a ligatures toggle; and **per-file-type overrides** so `.ps1` can render in Cascadia while `.py` uses Fira Code, per tab, live.
- **[Feature]** **Settings, redesigned.** A navigation rail with seven sections replaces the single scrolling column. Theme cards render each theme *from its own design tokens* (`data-theme` scoping) rather than hand-kept swatches; the font picker renders every face in itself with a live sample line, ligatures visible before you commit.
- **[Feature]** **Windows file associations for every supported type.** The installer registers a `FATE.CodeFile` ProgId and adds it to each of the 83 code extensions' "Open with" lists, *politely*: no extension's default handler is touched at install time. All types are declared on FATE's page in Windows Settings → Default apps, where you assign them yourself; Settings → Windows shows live coverage ("N of 86 file types currently open with FATE").
- **[Bugfix]** **Markdown code fences hadn't been syntax-highlighted since the marked v5 upgrade.** The `highlight` option FATE passed was removed from marked years ago: it parsed fine and did nothing, while a hard-coded dark stylesheet shipped for markup that never existed (and would have been unreadable in the Light theme if it had). Fences now highlight through `marked-highlight`, and the colours come from the same `--syn-*` theme tokens the code editor uses: a ```powershell fence and an open `.ps1` tab are coloured identically, in every theme.
- **[Performance]** The renderer bundle dropped ~720 KB by importing highlight.js's common-languages build instead of all ~190 languages.
- **[Enhancement]** Multiple files can be dropped onto the home screen at once; each opens in its own tab.
- **[Bugfix]** Print/PDF export with multiple tabs open renders only the active tab, never a concatenation.

## v1.9.0
- **[Feature]** **Full code viewing and editing.** FATE now opens code files: `.ps1`, `.html`, `.py`, `.js`, `.ts`, `.json`, `.css`, `.yaml`, `.sql`, `.sh`, `.bat` and 80+ more, plus extensionless standards like `Dockerfile` and `.gitignore`, in a real editor built on CodeMirror 6: syntax highlighting, line numbers, code folding, bracket matching, search & replace (`Ctrl`+`F`), multiple cursors, and full undo history. Markdown keeps its reading view; the two never mix.
- **[Feature]** **Languages load lazily and entirely offline.** Each language ships inside the app as its own chunk and is loaded only the first time a file of that type is opened. No CDN, no network: the PRIVACY.md promise holds.
- **[Feature]** **Saving, done carefully.** `Ctrl`+`S` (or the header button) writes back to disk; the window title carries the standard `•` unsaved marker. Unsaved changes are guarded at every exit: closing the file, opening another (from any path: dialog, recents, drag & drop, file association, a second instance), and closing the window all confirm first. A failed save keeps the guards armed.
- **[Feature]** **Live reload that respects your edits.** An external change reloads a clean editor in place (cursor and undo history preserved). If the buffer is dirty, your edits win and the change is noted in the status bar instead. FATE's own saves are filtered out of the watcher entirely, so saving never bounces back as a fake external change.
- **[Feature]** **Syntax colours are theme tokens.** Each of the four themes defines its own `--syn-*` palette: gold-led for FATE, GitHub-dark for Crimson, GitHub-light for Light, the official spec palette for Dracula, so switching themes retunes the highlighted code instantly, like every other surface.
- **[Feature]** **Printing and PDF export work for code too.** The editor virtualises long files (only visible lines exist in the DOM), so printing renders the full buffer through a print-only path instead: black monospace on white, wrapped long lines, same headers, footers and page setup as markdown.
- **[Feature]** The status bar shows the detected language and a live `Ln, Col` readout (written straight to the DOM, per the house scroll-performance rule). New Settings → Code Editor group: wrap long lines, indent size.
- **[Enhancement]** The open dialog gains proper filters (All supported / Markdown / Code / All files), the dropzone accepts code files, recents show a code icon for code files, and the command line / "Open with" accepts every supported extension; previously it was hard-wired to `.md`.
- **[Enhancement]** Dropped files with a resolvable path now route through the main process like every other open, so drag & drop gets live reload, recents, and the unsaved-changes guard too.
- **[Bugfix]** Binary files and files over 25 MB are refused with a clear error instead of being fed to the renderer as garbage.

## v1.8.2
- **[Bugfix]** **"Manage" / "Set as default" did nothing when clicked.** It shelled out to the Windows shell's Open-With dialog (`rundll32 shell32.dll,OpenAs_RunDLL`), and Windows *suppresses that dialog entirely* once a file type already has a confirmed handler, so the moment FATE genuinely became the default for `.md`, the button became a silent no-op. Correct invocation, valid file, no dialog, no error.
- **[Bugfix]** That dialog was the wrong tool regardless: on Windows 11 its only button is **"Just once"**, so it could never actually set a default. The button now opens Windows Settings, which is the only surface on Windows 11 that can.
- **[Feature]** **FATE is now a properly registered Windows application.** The installer writes a `Capabilities` key and a `RegisteredApplications` entry, the documented mechanism electron-builder omits. That gives FATE its own page in Settings → Default apps, and makes "Set as default" deep-link straight to it instead of dumping you on the full alphabetical list. Registered regardless of the install checkbox, since declaring that FATE *can* open Markdown is not the same as claiming the extension.
- **[Bugfix]** A failure to open Windows Settings now surfaces in the status bar. Nothing in this path is allowed to fail silently any more.

## v1.8.1
- **[Bugfix]** **Exported PDFs printed table rows in navy on white paper.** The print stylesheet reset colours element by element and had missed `table tr` (which uses the app's dark surface tokens), the table cell borders, `hr`, and the blockquote tint, so black text landed on a near-black background. Confirmed by decompressing the PDF content stream: rows were being filled `#070B1A`. The reset is now a blanket one: every background inside the document is zeroed and only deliberate light values are added back, so anything added in future is print-safe by default.
- **[Bugfix]** `printBackground` was set to `false` on the reasoning that the stylesheet forces white paper anyway. It was doing nothing: the stylesheet also sets `print-color-adjust: exact`, which overrides that flag and forces backgrounds to paint. The flag is now `true` and honest about it, with the stylesheet as the single source of truth, which means tables keep light zebra striping and code blocks a grey background, both of which help on paper.
- **[Bugfix]** **Ticking "make FATE the default for .md" during install stopped working in 1.7.0.** The installer's un-associate branch keyed off a variable that is only assigned when the custom install page actually runs; if it didn't, the empty value compared unequal to "checked" and the branch fired on every install. That was harmless while it deleted keys that never existed, but 1.7.0 corrected it to delete the real ones, at which point the latent bug began actively stripping the association. It now defaults to "checked" and only an explicit uncheck un-associates.
- **[Bugfix]** That same branch also deleted the `Markdown Document` ProgId outright, taking FATE's open command and icon with it, which removed FATE from the Windows "Open with" list entirely and let Windows fall back to another handler. Declining the checkbox now releases the `.md` claim while leaving FATE registered and selectable.
- **[Bugfix]** Settings could report "FATE currently opens .md files" when it didn't. If the ProgId resolved to no command (exactly the broken state above), the check fell back to matching the ProgId *name* and returned a false positive. A ProgId with nothing to run is no longer treated as a default.
- **[Enhancement]** Wide tables and long block equations shrink to the page instead of being cropped at the margin, and block equations avoid being split across pages.

## v1.8.0
- **[Feature]** **Print preview actually works.** `Ctrl`+`P` now opens a real page-by-page preview instead of the Windows dialog reporting *"This app doesn't support print preview"*: Electron ships Chromium without the print-preview UI, and no flag turns it on. FATE now renders the document to a PDF through its own print stylesheet and previews that, so what you see is exactly what prints.
- **[Feature]** **Export as PDF**: a dedicated button in the document header, saving wherever you choose.
- **[Feature]** Exported PDFs carry **heading bookmarks** generated from the document's own structure, **page numbers**, the document name in the header, and **tagged-PDF** structure so screen readers can navigate them.
- **[Feature]** **Paper size and orientation** in Settings → Printing: Letter, A4, Legal, Tabloid, A3, A5, portrait or landscape. Applies to both preview and export.
- **[Bugfix]** Print and export are gated while a render is in flight, and a failed render now surfaces in the status bar instead of failing silently.
- **[Bugfix]** If Chromium's embedded PDF viewer is unavailable in a given build, the preview falls back to the system PDF handler rather than opening an empty window.
- **[Bugfix]** Fixed a temporal-dead-zone crash introduced while wiring the print shortcut: the keyboard effect named a `const` callback declared further down the component, which threw on every render and blanked the entire app. Caught before release.
- **[Bugfix]** The print shortcut could print under the *previous* document's header. Opening a second document while already reading doesn't change the viewing state, so the shortcut's effect never re-ran and held a stale filename.

## v1.7.0
- **[Feature]** **Animated constellation sky** behind the home screen: twinkling starfield, larger constellation stars with cross glints, faint linking lines, the occasional meteor, and a slow gold halo breathing behind the badge. Ported from the [702 Squad](https://palworld.702squad.com) portal, the ceremonial-tier expression of the same brand.
  - Home screen only. Nothing animates behind a document you're reading; the loop is torn down the instant one opens.
  - Follows the active theme: gold in FATE, red in Crimson, violet in Dracula, dark gold on Light.
  - Pauses entirely while the window is hidden, and honours `prefers-reduced-motion` by rendering one static frame.
- **[Bugfix]** **Fixed the default-app check, which was always wrong.** FATE reported "no app is set for `.md` files yet" even when Windows plainly had FATE as the handler. Two causes: it read `HKCU\Software\Classes\.md\UserChoice`, a key that doesn't exist on Windows 10 or 11: the real one lives under `Explorer\FileExts\.md`, and it compared against a ProgId (`FATEMarkdownViewer.md`) that was never registered. The actual ProgId is `Markdown Document`.
- **[Enhancement]** Detection no longer trusts the ProgId name. "Markdown Document" is generic enough that another app could claim it, so FATE now resolves the ProgId's open command and checks it actually points at FATE's own executable, answering "would double-clicking a `.md` file open *me*?" rather than a proxy for it.
- **[Enhancement]** **"Set as default" now opens the Windows Open-With dialog**, which has the "Always use this app" checkbox: one dialog, one tick, done. It previously deep-linked to the Default apps page with a parameter Windows ignored (there's no `RegisteredApplications` entry), so you landed on the full list and had to search `.md` by hand. The Settings page remains the fallback.
- **[Bugfix]** **The window and taskbar now read "FATE - Markdown Viewer"** instead of a bare "FATE". Windows truncates the taskbar label from the *start* of the window title, so the app name has to lead it; title composition moved into the main process so the renderer can't set a wrong one. Pinned shortcuts get an explicit name too.
- **[Feature]** Opened the repo to contributions: `CONTRIBUTING.md`, `TRADEMARK.md`, PR and issue templates. Code stays MIT; the name and artwork are explicitly reserved.
- **[Bugfix]** The starfield's rebuild was debounced with `requestAnimationFrame`, which never fires while a window is hidden: a resize or theme change made while minimised was dropped and never applied. Debounced with a timer instead, and a `MutationObserver` on `data-theme` now repaints on theme switch rather than waiting for a resize.

## v1.6.0
- **[Feature]** New **gilded badge artwork** across every surface: window and taskbar icon, installer, Add/Remove Programs entry, Microsoft Store tiles, the home screen, and the About panel. Matching document mark for `.md` file associations. All sizes are derived from two masters in `brand/` by `npm run icons`.
- **[Feature]** **Set FATE as your default Markdown app**: Settings → Windows Integration. Shows whether FATE currently handles `.md`, re-checks whenever the window regains focus, and deep-links to the Windows Default Apps page. Windows deliberately blocks apps from claiming a file type silently, so the UI says so rather than pretending the button did it.
- **[Feature]** **Recent documents** on the home screen. The last eight files you opened, with folder and relative time, click to reopen. Files that have since moved or been deleted are shown struck through rather than silently dropped, and clicking one prunes it.
- **[Feature]** **Open File button** with its `Ctrl`+`O` shortcut shown inline; previously the only discoverable way in was to click the drop area.
- **[Enhancement]** **Rebuilt the layout as a proper app shell.** The version readout, settings gear and update button used to be absolutely positioned in the bottom corners, where they overlapped the drop area and each other once the window got small. They now live in a real status bar row at the bottom of the shell, which makes that overlap *structurally* impossible at any window size rather than something to keep tuning breakpoints against.
- **[Enhancement]** The status bar also shows live reading progress while a document is open, written straight to the DOM, so it costs nothing per scroll frame.
- **[Enhancement]** **Settings is reachable while reading.** The gear is in the viewer header alongside a new Print button; previously Settings only existed on the home screen, so you had to close your document to reach it.
- **[Enhancement]** Home screen reworked into two panes on wide windows, so the horizontal space carries the recents list instead of sitting empty. Stacks to one column below 860px, and tightens its vertical rhythm on short windows so it fits without scrolling even at the minimum size.
- **[Enhancement]** The window now has a **minimum size** (680×520). The layout is responsive down to there and simply refuses to get smaller rather than degrading.
- **[Enhancement]** Sidebar toggle, print and settings are proper icon buttons with hover, focus and title tooltips, instead of bare clickable SVGs.
- **[Bugfix]** Added a global `box-sizing: border-box`. Without it padding was added *on top of* every width and height, so a panel capped at 268px actually occupied 291px: every sized box in the app was quietly lying about its size.
- **[Bugfix]** Print styles now also reset the new shell containers, so printing from the redesigned layout still produces a clean single flow.
- **[Maintenance]** Icon masters live in `brand/` and every raster size is script-derived; nothing is hand-exported. Removed the unused `src/assets/FATE-Icon.png`.
- **[Maintenance]** NSIS installer, uninstaller and header icons are now configured explicitly instead of relying on electron-builder's fallback.

## v1.5.0
- **[Feature]** Rebuilt the interface on the **VagueDustin Enterprises design language**: deep navy surfaces, metallic gold accents, engraved Cinzel display type, gilded hairlines. Applied at the *utility* ornament tier, the tier intended for tools: no filigree, no ambient motion, density and scanning speed first.
- **[Feature]** Document headings, table headers, and section labels now set in **Cinzel**, so rendered markdown reads as typeset rather than dumped.
- **[Feature]** Added the **Crimson** theme: the pre-1.5.0 red identity, kept as an explicit choice so nobody is forced off it by the rebrand.
- **[Feature]** New navy-and-gold application and document icons, including a purpose-drawn simplified mark at 16/24px rather than a downscale that turned to mush in Explorer.
- **[Enhancement]** **Typefaces are now bundled with the app.** Cinzel and Inter ship as local assets and the Google Fonts request on every launch is gone; FATE is genuinely offline now, matching what `PRIVACY.md` already promised.
- **[Enhancement]** Rewrote the stylesheet to be entirely token-driven. Themes were previously ~300 lines of per-theme override cascade that had to be touched for every change and had already drifted; each theme is now a ~25-line block of custom properties, and `src/App.css` contains no colour literals at all.
- **[Performance]** Scrolling no longer re-renders the app. The progress bar is written straight to the DOM, the scroll handler is throttled with `requestAnimationFrame`, heading elements are cached per document instead of re-queried every frame, and listeners are registered `passive`. Scrolling a large document went from a full React commit per tick (re-rendering the whole markdown body and every KaTeX node in it) to none.
- **[Performance]** Fixed the scroll effect depending on `activeHeading`, which tore down and re-registered the scroll listener on every heading change mid-scroll.
- **[Bugfix]** Drag-and-dropped files resolve their path again, via `webUtils.getPathForFile`. Electron 32 removed `File.path`, which had silently broken relative image loading for dropped documents; files opened via the dialog or a file association were unaffected.
- **[Bugfix]** Printing now actually produces the white, ink-saving output the docs described; the previous version printed the dark theme verbatim, background included.
- **[Bugfix]** `Escape` inside the Settings modal closes the modal instead of closing the document behind it.
- **[Bugfix]** Opening a new document resets scroll progress and the heading cache, so a stale table-of-contents highlight no longer carries over from the previous file.
- **[Accessibility]** Visible focus rings on all interactive controls, and `prefers-reduced-motion` now disables every decorative animation.
- **[Maintenance]** Icons are generated from vector sources via `npm run icons` instead of being hand-exported.

## v1.4.2
- **[Bugfix]** Fixed missing Dracula theme hooks for interactive UI buttons and scrollbars.

## v1.4.1
- **[Feature]** Added the Dracula theme option.
- **[Enhancement]** Added a red pulsing glow to the Settings gear icon.
- **[Bugfix]** Fixed low text contrast in the Light theme with stronger overrides for Markdown headings and paragraphs.

## v1.4.0
- **[Feature]** Added a Settings window with a theme switcher, an automatic updates toggle and an adjustable sidebar width.
- **[Feature]** Keyboard shortcuts can now be rebound.
- **[Feature]** Preferences are now saved with `electron-store`, so they survive app updates.
- **[Feature]** Added an installer checkbox that associates FATE with `.md` and `.markdown` files.
- **[Maintenance]** GitHub releases now publish only the `.exe` installer.

## v1.3.0
- **[Enhancement]** Reworked the layout with Flexbox so the interface scales with the window.
- **[Enhancement]** The app name and window titles now read "FATE - Markdown Viewer".
- **[Enhancement]** New square FATE app icons, and rectangular document icons for `.md` files in File Explorer.
- **[Enhancement]** Regenerated all Microsoft AppX tile assets so they match.
- **[Maintenance]** Removed the leftover boilerplate graphics from the source tree.

## v1.1.0
- **[Feature]** Added a repair pass to the parser that fixes broken LaTeX escapes, such as a missing `\` in `\theta`, `\approx` and `\begin`.
- **[Feature]** Added Print to PDF, with a light stylesheet for printing.
- **[Feature]** Added Microsoft Store (AppX) tile assets at every size in place of the generic defaults.
- **[Enhancement]** Enabled `nonStandard` boundaries in the KaTeX inline parser, so equations packed tightly against punctuation or parentheses no longer fail to parse.
- **[Enhancement]** The Table of Contents sidebar now renders math inside headings.
- **[Enhancement]** Scrollbars now match the dark red theme.
- **[Bugfix]** Fixed the layout being cut off on ultrawide monitors when the Table of Contents sidebar was open.
- **[Maintenance]** Cleaned up the build scripts ahead of the first production release.

## v1.0.8
- **[Compliance]** Added `PRIVACY.md` and explicitly defined `displayName` in AppX build configuration for Microsoft Store validation.

## v1.0.7
- **[Minor]** Added trademark symbol to AppX publisher display name.

## v1.0.6
- **[Bugfix]** Resolved build artifact collision by disabling the portable target.

## v1.0.5
- **[Enhancement]** Bypassed CDN cache.

## v1.0.4
- **[Bugfix]** Added explicit publisher information and fixed artifact naming conventions.

## v1.0.3
- **[Bugfix]** Fixed a critical race condition, hid the update UI while a document is open, and turned GPU rendering back on.

## v1.0.2
- **[Feature]** Added automatic update UI.

## v1.0.1
- **[Enhancement]** Configured automatic updates and applied MIT licensing.

## v1.0.0
- **[Release]** Initial FATE Markdown Viewer release with Electron, React, and Vite.
