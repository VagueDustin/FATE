#!/usr/bin/env bash
# One-time setup: create FATE's package-signing key and store it as the GitHub Actions secret
# FATE_GPG_PRIVATE_KEY on the repository. The Build Linux workflow imports it to sign the .rpm,
# the apt repository index (InRelease/Release.gpg) and the dnf repodata (repomd.xml.asc). The
# public half is committed as build/linux/fate-archive-keyring.{asc,gpg}: the packages ship it, so
# installs trust the repositories automatically.
#
# Run once, from Git Bash, WSL, macOS or Linux, logged in to `gh` as the repository owner:
#
#     bash scripts/setup-signing-key.sh                  # the first key: create it, store the secret
#     bash scripts/setup-signing-key.sh --new-key-only   # a key rotation: create a key, touch no secret
#
# Nothing is printed except the fingerprint and the next steps. The private key is written ONLY to
# the backup directory (default: ~/FATE-package-signing-key) and, without --new-key-only, to the
# GitHub secret. Move the backup into a password manager and delete it from disk.
#
# Replacing the key is NOT running this again: every installed system trusts only the keys its
# package shipped, so a release signed by a new key alone would never reach them through apt or
# dnf. Rotation goes through a transition release signed by both keys; SECURITY.md → Package
# signing key has the steps. That is also why this script refuses to replace an existing secret
# or an existing backup.
set -euo pipefail

NEW_KEY_ONLY=false
case "${1:-}" in
  '') ;;
  --new-key-only) NEW_KEY_ONLY=true ;;
  *) echo "usage: bash scripts/setup-signing-key.sh [--new-key-only]"; exit 2 ;;
esac

REPO="${REPO:-VagueDustin/FATE}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/FATE-package-signing-key}"
NAME="${SIGNING_NAME:-FATE Package Signing}"
EMAIL="${SIGNING_EMAIL:-enterprises@vaguedustin.com}"
PRIVATE="$BACKUP_DIR/fate-package-signing-PRIVATE.asc"

command -v gpg >/dev/null || { echo "gpg not found (Git for Windows ships it; on Linux: apt install gnupg)"; exit 1; }
command -v gh >/dev/null || { echo "gh not found: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not logged in: run 'gh auth login' first"; exit 1; }

# A backup that is already there may be the only copy of a key in use. Never write over it.
if [ -e "$PRIVATE" ] || [ -e "$BACKUP_DIR/README.txt" ]; then
  echo "$BACKUP_DIR already holds a signing key backup. Nothing was changed."
  echo "Move it somewhere safe first, or choose another directory:  BACKUP_DIR=~/FATE-package-signing-key-new bash $0 ${1:-}"
  exit 1
fi

if [ "$NEW_KEY_ONLY" = false ]; then
  # Capture the list, then search it. This used to be `gh secret list | grep -q ...`: grep stopped
  # reading at the first match, gh could die writing the rest, pipefail turned "found" into "not
  # found", and the script went on to replace the live key. With the output discarded, a gh error
  # (network, permissions) read as "no secret" the same way. Now a gh failure stops the script.
  if ! SECRETS="$(gh secret list --repo "$REPO" --json name -q '.[].name')"; then
    echo "Could not list the secrets of $REPO (see the gh error above). Nothing was changed."
    exit 1
  fi
  if grep -qx 'FATE_GPG_PRIVATE_KEY' <<< "$SECRETS"; then
    echo "The secret FATE_GPG_PRIVATE_KEY already exists on $REPO. Nothing was changed."
    echo "To replace the key, rotate it (SECURITY.md → Package signing key): bash $0 --new-key-only"
    exit 1
  fi
fi

# An isolated keyring so nothing touches your personal GnuPG home.
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
chmod 700 "$GNUPGHOME"
trap 'rm -rf "$GNUPGHOME"' EXIT

cat > "$GNUPGHOME/params" <<EOF
%no-protection
Key-Type: RSA
Key-Length: 4096
Key-Usage: sign
Name-Real: $NAME
Name-Email: $EMAIL
Expire-Date: 0
%commit
EOF
gpg --batch --quiet --gen-key "$GNUPGHOME/params" 2>/dev/null
FPR="$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr/ { print $10; exit }')"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
# noclobber + umask: the private key is never written over another file, and never readable by
# anyone else, not even for the moment before a chmod.
(
  set -o noclobber
  umask 077
  gpg --armor --export-secret-keys "$FPR" > "$PRIVATE"
)
gpg --armor --export "$FPR" > "$BACKUP_DIR/fate-package-signing-public.asc"
cat > "$BACKUP_DIR/README.txt" <<EOF
FATE package-signing key (apt repository, dnf repodata, .rpm signatures)
Fingerprint: $FPR
Created:     $(date -u +%Y-%m-%d)
Key:         RSA 4096, sign-only, no expiry, no passphrase (it lives in CI as a secret).

fate-package-signing-PRIVATE.asc  The GitHub Actions secret FATE_GPG_PRIVATE_KEY on $REPO holds it
                                  (alone, or beside another key during a rotation). This file is
                                  your ONLY backup. Put it in a password manager, then delete it
                                  from disk.
fate-package-signing-public.asc   Goes into build/linux/fate-archive-keyring.asc and .gpg (the
                                  packages ship it) and is uploaded beside the repository indexes.
EOF

if [ "$NEW_KEY_ONLY" = false ]; then
  gh secret set FATE_GPG_PRIVATE_KEY --repo "$REPO" < "$PRIVATE"
  echo "Signing key created and stored as FATE_GPG_PRIVATE_KEY on $REPO."
else
  echo "Signing key created. No secret was changed."
fi
echo "Fingerprint: $FPR"
echo "Backup:      $BACKUP_DIR  (move fate-package-signing-PRIVATE.asc into a password manager, then delete it)"
echo
echo "Build Linux signs only with the keys it is told to expect. Next, in one commit:"
echo "  * build/linux/fate-archive-keyring.asc and .gpg: the public key(s) installs must trust"
echo "    (the new key alone for a first key; old and new together for a rotation)"
echo "  * SIGNING_KEYS in .github/workflows/build-linux.yml: $FPR (with the old key's fingerprint"
echo "    during a rotation, as SECURITY.md → Package signing key describes)"
