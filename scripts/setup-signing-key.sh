#!/usr/bin/env bash
# One-time setup: create FATE's package-signing key and store it as the GitHub Actions secret
# FATE_GPG_PRIVATE_KEY on the repository. The Build Linux workflow imports it to sign the .rpm,
# the apt repository index (InRelease/Release.gpg) and the dnf repodata (repomd.xml.asc), and
# exports the public half into the packages so installs trust the repositories automatically.
#
# Run once, from Git Bash, WSL, macOS or Linux, logged in to `gh` as the repository owner:
#
#     bash scripts/setup-signing-key.sh
#
# Nothing is printed except the fingerprint. The private key is written ONLY to the backup
# directory (default: ~/FATE-package-signing-key) and to the GitHub secret. Move the backup into a
# password manager and delete it from disk; if the key ever leaks, revoke it, run this again with
# a new key, and ship a release (the public keyring travels inside the .deb/.rpm).
set -euo pipefail

REPO="${REPO:-VagueDustin/FATE}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/FATE-package-signing-key}"
NAME="${SIGNING_NAME:-FATE Package Signing}"
EMAIL="${SIGNING_EMAIL:-enterprises@vaguedustin.com}"

command -v gpg >/dev/null || { echo "gpg not found (Git for Windows ships it; on Linux: apt install gnupg)"; exit 1; }
command -v gh >/dev/null || { echo "gh not found: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not logged in: run 'gh auth login' first"; exit 1; }

if gh secret list --repo "$REPO" 2>/dev/null | grep -q '^FATE_GPG_PRIVATE_KEY'; then
  echo "The secret FATE_GPG_PRIVATE_KEY already exists on $REPO."
  echo "Delete it first if you really mean to rotate the key:  gh secret delete FATE_GPG_PRIVATE_KEY --repo $REPO"
  exit 1
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
gpg --armor --export-secret-keys "$FPR" > "$BACKUP_DIR/fate-package-signing-PRIVATE.asc"
gpg --armor --export "$FPR" > "$BACKUP_DIR/fate-package-signing-public.asc"
chmod 600 "$BACKUP_DIR/fate-package-signing-PRIVATE.asc"
cat > "$BACKUP_DIR/README.txt" <<EOF
FATE package-signing key (apt repository, dnf repodata, .rpm signatures)
Fingerprint: $FPR
Created:     $(date -u +%Y-%m-%d)
Key:         RSA 4096, sign-only, no expiry, no passphrase (it lives in CI as a secret).

fate-package-signing-PRIVATE.asc  Stored as the GitHub Actions secret FATE_GPG_PRIVATE_KEY on $REPO.
                                  This file is your ONLY backup. Put it in a password manager, then
                                  delete it from disk.
fate-package-signing-public.asc   Published as a release asset and shipped inside the .deb/.rpm;
                                  CI regenerates it from the secret, nothing to track in git.
EOF

gh secret set FATE_GPG_PRIVATE_KEY --repo "$REPO" < "$BACKUP_DIR/fate-package-signing-PRIVATE.asc"

echo "Signing key created and stored as FATE_GPG_PRIVATE_KEY on $REPO."
echo "Fingerprint: $FPR"
echo "Backup:      $BACKUP_DIR  (move fate-package-signing-PRIVATE.asc into a password manager, then delete it)"
