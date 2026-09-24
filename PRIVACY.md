# Privacy Policy for FATE - Formatted Article & Text Editor

**Effective Date:** September 15, 2026 (supersedes the August 5, 2026 policy)

FATE is a local, offline desktop application for reading and editing documents. Your files and your
data belong to you. This policy describes, in plain language, everything FATE does that could
conceivably touch data. There is very little.

## 1. Data Collection

* **No telemetry.** FATE does not collect, store, or transmit analytics, usage data, or crash
  reports. There is no tracking of any kind.
* **No cloud processing.** All parsing, rendering, syntax highlighting, diagram rendering and
  editing happens entirely on your machine. Typefaces are bundled with the app; nothing is fetched
  from a CDN or webfont service.
* **No accounts.** FATE has no sign-in, no registration, and never asks for personal information.

## 2. File Access

FATE requests local file system access ("Full Trust") solely to open, display, edit and save the
files **you explicitly choose**: through the open dialog, drag & drop, the recent-files list, a file
association, or the "Edit in FATE" context-menu entry. While a file is open, FATE watches it for
external changes so the view can refresh. FATE does not scan, index, upload, or share your files.
They never leave your device.

## 3. Data Stored Locally

FATE keeps a small local configuration file on your machine containing your settings (theme,
fonts, keyboard shortcuts, and similar), the paths of recently opened files, and (if session
restore is enabled) the paths of the tabs you had open. This file stays on your device, is never
transmitted anywhere, and is removed if you delete the app's data folder.

On Windows, FATE also writes standard registry entries so that it appears in "Open with" menus and
on its page in Windows Settings → Default apps. These entries are local system configuration (they
contain no personal data), only change further when you turn on a setting that asks for it
(such as the classic context menu switch), and are removed on uninstall.

## 4. Updates

* **Installer (.exe) builds** periodically check FATE's official GitHub repository for a newer
  version. This is a standard HTTPS request to GitHub's servers; it contains no personal data and
  no file contents. Like any web request, GitHub's infrastructure can see your IP address
  (see GitHub's own privacy statement). Automatic checks can be disabled in Settings → About.
* **Microsoft Store builds** perform no update checks at all. The Microsoft Store manages
  updates through its own pipeline.
* **Linux packages** installed through apt, dnf, the Snap Store or Flatpak likewise perform no
  update checks; those package managers deliver updates. The **AppImage** checks GitHub the same
  way the Windows installer does.

## 5. Changes to This Policy

If a future version of FATE changes what this policy describes, the policy will be updated in the
repository alongside the release, with a new effective date.

## 6. Contact

Questions or concerns about this policy: please open an issue on the official GitHub repository at
https://github.com/VagueDustin/FATE

FATE is published by VagueDustin Enterprises™.
