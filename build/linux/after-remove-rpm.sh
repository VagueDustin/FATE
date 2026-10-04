#!/bin/bash
# Post-uninstall (postun) for the .rpm.
#
# TEMPLATE, not a plain script: electron-builder substitutes the two macros executable and
# sanitizedProductName (written as a dollar sign + braces) at build time and FAILS THE BUILD on
# any other braced name, comments included. So: only those two use braces, shell variables never
# do ($VAR only). fpm then pastes the result verbatim into the spec file, where rpmbuild expands
# macros, so this file must not contain a single percent sign either.
#
# Setting rpm.afterRemove REPLACES electron-builder's default after-remove.tpl, which ran
# unguarded. In an upgrade rpm runs the NEW package's post-install first and the OLD package's
# post-uninstall last, so `dnf upgrade` deleted the /usr/bin link the new version had just
# created, and FATE disappeared from PATH. $1 is the number of FATE packages left once this one is
# gone: 0 on erase, 1 or more on upgrade. An upgrade leaves everything alone. (Upgrades away from
# 1.13.x and older still run THEIR unguarded script; posttrans-rpm.sh repairs the link after it.)

if [ "$1" -ge 1 ] 2>/dev/null; then
  exit 0
fi

# Erase: electron-builder's default template, unchanged. Delete the link to the binary
# (update-alternatives --remove <name> <path>: 'path' is the registered alternative binary, not
# the generic symlink), then unload and delete the AppArmor profile.
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# ── FATE dnf repository ───────────────────────────────────────────────────────────────────────
# after-install-rpm.sh wrote /etc/yum.repos.d/fate.repo with gpgkey= pointing at
# /etc/pki/rpm-gpg/RPM-GPG-KEY-fate, a file this package owns and rpm has just deleted. Only that
# file goes, recognised by its first line. The fate.repo the README has people download from the
# `repodata` release fetches its key from GitHub, keeps working without the package, and is left
# alone, as is anything the user wrote.
FATE_REPO=/etc/yum.repos.d/fate.repo
if [ -f "$FATE_REPO" ] && grep -q '^# FATE - Formatted Article & Text Editor\. Added by the fate package' "$FATE_REPO"; then
  rm -f "$FATE_REPO"
fi

exit 0
