#!/bin/bash
# Post-remove (postrm) for the .deb.
#
# TEMPLATE, not a plain script: electron-builder substitutes the two macros executable and
# sanitizedProductName (written as a dollar sign + braces) at build time and FAILS THE BUILD on
# any other braced name, comments included. So: only those two use braces, shell variables never
# do ($VAR only).
#
# Setting deb.afterRemove REPLACES electron-builder's default after-remove.tpl, so the first half
# is that template's two jobs, unchanged and run for every postrm call exactly as before: drop the
# update-alternatives link, and unload and delete the AppArmor profile. (During an upgrade dpkg
# runs the old package's postrm before the new one's postinst, which puts both back.) The second
# half removes the apt source that after-install-deb.sh registered.

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the policy is not left
  # enforced until the next reboot. Live AppArmor operations mean nothing inside a chroot.
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# ── FATE apt repository ───────────────────────────────────────────────────────────────────────
# The source names Signed-By: /usr/share/keyrings/fate-archive-keyring.gpg, a file this package
# owns and dpkg has just deleted. Left behind, it makes every later `apt update` fail ("The
# repository ... is not signed"), so it goes on remove and purge, never on upgrade.
#
# Only a file FATE wrote is removed. Its first line is the marker: after-install-deb.sh writes
# "# FATE - Formatted Article & Text Editor. Added by the fate package ...", and the fate.sources
# that the README has people download from the `apt` release starts
# "# FATE - Formatted Article & Text Editor: apt repository ...". Both name the keyring that just
# went away. A source the user wrote by hand has no such line and is left alone.
case "$1" in
  remove|purge)
    FATE_SOURCES=/etc/apt/sources.list.d/fate.sources
    if [ -f "$FATE_SOURCES" ] && grep -q '^# FATE - Formatted Article & Text Editor[.:]' "$FATE_SOURCES"; then
      rm -f "$FATE_SOURCES"
    fi
    ;;
esac

# A failing postrm leaves the package half-removed; nothing above is worth that.
exit 0
