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

## Package signing key

The `.rpm` and the indexes of the apt and dnf repositories are signed with this key:

```
FATE Package Signing <enterprises@vaguedustin.com>
RSA 4096, created 2026-09-14
5E78 FD80 2EB3 DDCC AB6F  1026 8B2F 82F6 B2F7 1B42
```

Its public half is committed as `build/linux/fate-archive-keyring.asc` (and `.gpg`); the `.deb` and
`.rpm` ship it and register the repositories with it. To check a downloaded copy:
`gpg --show-keys fate-archive-keyring.asc`.

The private key exists in two places: the `FATE_GPG_PRIVATE_KEY` secret of this repository and the
maintainer's offline backup. In CI it is loaded only by the publish job of
`.github/workflows/build-linux.yml`, which runs no npm and no third-party action, after the build
jobs have finished. That job refuses to sign unless the secret holds exactly the keys listed in its
`SIGNING_KEYS` and every one of them is in the committed keyring, so a swapped or mistaken secret
stops a release instead of signing it with a key no install trusts.

### Rotating the key

Every installed system trusts only the keys its package shipped. A release signed by a new key alone
would never reach it: `apt update` and `dnf upgrade` would reject the repository. So the new key
travels inside a release signed by the old one, and only later takes over:

1. **Create the new key** without touching the live secret:
   `BACKUP_DIR=~/FATE-package-signing-key-new bash scripts/setup-signing-key.sh --new-key-only`
2. **One commit:** both public keys in the keyring
   (`gpg --armor --export OLD NEW > build/linux/fate-archive-keyring.asc` and
   `gpg --export OLD NEW > build/linux/fate-archive-keyring.gpg`, from a keyring holding both), and
   `SIGNING_KEYS: OLD NEW` in `build-linux.yml`, old key first.
3. **Both private keys in the secret:**
   `cat old-PRIVATE.asc new-PRIVATE.asc | gh secret set FATE_GPG_PRIVATE_KEY --repo VagueDustin/FATE`.
   (If the commit and the secret disagree when a release runs, the publish job stops before signing
   anything.)
4. **Release as usual. This is the transition release:** its packages carry both keys, its `.rpm` is
   signed by the old key (an rpm holds one signature), and the apt and dnf indexes by both. Installs
   that still know only the old key keep updating; apt warns about the key it does not know yet
   until the upgrade installs it. Keep releasing like this until the installs you care about have
   taken one of these releases (weeks, not days).
5. **Switch:** `SIGNING_KEYS: NEW`, and the secret holds the new key alone. Keep the old public key in
   the keyring unless it was compromised.

Before the first transition release, check dnf in a Fedora container that trusts only the old key:
apt accepts an index when one of its signatures verifies and warns about the rest, but this pipeline
does not test how dnf treats an index signed twice. (If dnf refuses it, leave `SIGNING_KEYS` and the
secret on the old key alone for the transition releases: they still carry the new key, just without
its signature.) An install that skipped every transition release has to take the new keyring by
hand, most simply by installing the current `.deb` or `.rpm` from the Releases page once.

If the old key leaked, skip the waiting: remove it from the keyring and the secret straight away,
release, and announce that users must take the new keyring by hand.
