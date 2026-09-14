#!/bin/bash
# Post-install for the .deb.
#
# TEMPLATE, not a plain script: electron-builder substitutes ${executable} and
# ${sanitizedProductName} at build time and FAILS THE BUILD on any other ${name}. So: template
# variables use braces, shell variables never do ($VAR only). The first half is electron-builder's
# own default after-install.tpl, kept verbatim so replacing it loses nothing; the second half
# registers FATE's apt repository so `apt upgrade` keeps FATE current from then on.

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# ── FATE apt repository ───────────────────────────────────────────────────────────────────────
# A signed flat repository served from GitHub Releases (rolling tag `apt`, see
# .github/workflows/build-linux.yml). The signing key ships in this package as
# /usr/share/keyrings/fate-archive-keyring.gpg. Written only if absent, so a user who deletes or
# edits it is left alone; opt out entirely with `repo_add_once=false` in /etc/default/fate.
FATE_SOURCES=/etc/apt/sources.list.d/fate.sources
FATE_DEFAULTS=/etc/default/fate
repo_add_once=true
if [ -r "$FATE_DEFAULTS" ]; then
  . "$FATE_DEFAULTS"
fi
if [ "$repo_add_once" != "false" ] && [ ! -e "$FATE_SOURCES" ] && [ -d /etc/apt/sources.list.d ] && [ -r /usr/share/keyrings/fate-archive-keyring.gpg ]; then
  cat > "$FATE_SOURCES" <<'SOURCES'
# FATE - Formatted Article & Text Editor. Added by the fate package so `apt upgrade` keeps it
# current. Remove this file to stop receiving updates through apt.
Types: deb
URIs: https://github.com/VagueDustin/FATE/releases/download/
Suites: apt/
Signed-By: /usr/share/keyrings/fate-archive-keyring.gpg
SOURCES
fi
