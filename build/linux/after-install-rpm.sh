#!/bin/bash
# Post-install (%post) for the .rpm.
#
# TEMPLATE, not a plain script: electron-builder substitutes ${executable} and
# ${sanitizedProductName} at build time and FAILS THE BUILD on any other ${name}. So: template
# variables use braces, shell variables never do ($VAR only). The first half is electron-builder's
# own default after-install.tpl, kept verbatim so replacing it loses nothing; the second half
# registers FATE's dnf repository so `dnf upgrade` keeps FATE current from then on.

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

# ── FATE dnf repository ───────────────────────────────────────────────────────────────────────
# Signed repodata served from GitHub Releases (rolling tag `repodata`, see
# .github/workflows/build-linux.yml); the packages themselves are the versioned release assets.
# The signing key ships in this package as /etc/pki/rpm-gpg/RPM-GPG-KEY-fate. Written only if
# absent; opt out entirely with `repo_add_once=false` in /etc/default/fate.
FATE_REPO=/etc/yum.repos.d/fate.repo
FATE_DEFAULTS=/etc/default/fate
repo_add_once=true
if [ -r "$FATE_DEFAULTS" ]; then
  . "$FATE_DEFAULTS"
fi
if [ "$repo_add_once" != "false" ] && [ ! -e "$FATE_REPO" ] && [ -d /etc/yum.repos.d ] && [ -r /etc/pki/rpm-gpg/RPM-GPG-KEY-fate ]; then
  cat > "$FATE_REPO" <<'REPO'
# FATE - Formatted Article & Text Editor. Added by the fate package so `dnf upgrade` keeps it
# current. Remove this file to stop receiving updates through dnf.
[fate]
name=FATE - Formatted Article & Text Editor
baseurl=https://github.com/VagueDustin/FATE/releases/download/
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-fate
metadata_expire=6h
REPO
  rpm --import /etc/pki/rpm-gpg/RPM-GPG-KEY-fate 2>/dev/null || true
fi
