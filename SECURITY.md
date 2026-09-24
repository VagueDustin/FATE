# Security Policy

## Supported versions

FATE ships as a rolling desktop application: only the **latest release** receives fixes. If you
are on an older version, please update (the built-in updater or the
[latest release](https://github.com/VagueDustin/FATE/releases/latest)) before reporting.

| Version | Supported |
| ------- | --------- |
| Latest release | ✅ |
| Anything older | ❌ Update first |

## Reporting a vulnerability

Please **do not open a public issue for security problems.** Instead, use GitHub's private
reporting: go to the [Security tab](https://github.com/VagueDustin/FATE/security) and click
**"Report a vulnerability."** That opens a private thread that only you and the maintainer can
see, and it can be converted into a coordinated advisory if warranted.

When reporting, it helps a lot to include:

- The FATE version (Settings → About) and how it was installed (GitHub `.exe`, Microsoft Store, or a Linux package such as the Snap, Flatpak, AppImage, `.deb` or `.rpm`)
- Steps to reproduce, ideally with a sample file if the issue involves opening or rendering one
- What you believe the impact is

You can expect an acknowledgement within a few days. FATE is maintained by a small team, so
please allow reasonable time for a fix before any public disclosure. We will keep you informed.

## Scope notes

Things especially worth reporting:

- **Malicious-file handling:** a crafted `.md` or code file that achieves script execution,
  reads other files, or escapes the renderer when merely *opened or rendered* (FATE sanitises
  rendered HTML and never executes opened documents; anything that defeats that is a bug of the
  highest order)
- **Update integrity:** anything that could make the updater accept a package it shouldn't
- **Association/registry handling:** FATE writes Windows file-association entries; anything that
  turns that into an escalation or persistence primitive

Out of scope: issues requiring an already-compromised machine, and the inherent behaviour of
opening a file the user explicitly chose (FATE displays files; it does not sandbox-execute them).

FATE makes no network requests beyond the GitHub update check in the Windows `.exe` and the
AppImage. Microsoft Store builds and installs from the Snap Store, Flatpak, apt or dnf make none
at all. See [PRIVACY.md](PRIVACY.md).
