#!/bin/bash
# posttrans for the .rpm: runs once, at the very end of an install or upgrade transaction, after
# every other scriptlet, including the OLD package's post-uninstall.
#
# FATE 1.13.x and older shipped electron-builder's default post-uninstall, which removes the
# /usr/bin/FATE alternative unconditionally, and rpm runs it AFTER the new package's post-install.
# So moving off one of those versions deletes the command the new version has just created.
# after-remove-rpm.sh stops that from this version on; this puts the link back after the old
# script has run, and does nothing when the link is already there.
#
# NOT an electron-builder template: fpm reads it as is (--rpm-posttrans in package.json), so the
# paths are spelled out. Like every rpm scriptlet it lands in the spec file, where rpmbuild expands
# macros: no percent signs.
FATE_EXE='/opt/FATE - Formatted Article & Text Editor/FATE'

if [ -x "$FATE_EXE" ] && [ ! -e /usr/bin/FATE ]; then
  if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --install /usr/bin/FATE FATE "$FATE_EXE" 100 || ln -sf "$FATE_EXE" /usr/bin/FATE
  else
    ln -sf "$FATE_EXE" /usr/bin/FATE
  fi
fi

exit 0
