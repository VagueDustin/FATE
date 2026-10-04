# AUR package: `fate-editor-bin`

`PKGBUILD` repackages the released `.deb` for Arch and its derivatives (Manjaro, EndeavourOS, CachyOS).
It installs FATE to `/opt/fate-editor` with a `fate-editor` launcher, and leaves out the parts of the
`.deb` that only make sense on Debian: the apt repository its post-install script registers and the apt
keyring. It writes `pacman` into `resources/package-type`, so FATE's built-in updater stays off and the
status-bar button says updates come from pacman. The name `fate` is already taken on the AUR by an
unrelated project.

## Publishing (one time)

1. Create an account on [aur.archlinux.org](https://aur.archlinux.org) and add an SSH public key to it.
2. Clone the empty package repository, copy the two files in, and push:
   ```bash
   git clone ssh://aur@aur.archlinux.org/fate-editor-bin.git
   cp PKGBUILD .SRCINFO fate-editor-bin/
   cd fate-editor-bin && git add PKGBUILD .SRCINFO && git commit -m "Initial release: 1.13.4" && git push
   ```
3. In the main README's Install section, replace the `makepkg -si` instructions for Arch with the AUR
   helper line (`paru -S fate-editor-bin`).

## Each release

On an Arch machine, from this directory:
```bash
sed -i "s/^pkgver=.*/pkgver=X.Y.Z/; s/^pkgrel=.*/pkgrel=1/" PKGBUILD
updpkgsums                          # refreshes sha256sums from the new release (pacman-contrib)
makepkg -f                          # test build
makepkg --printsrcinfo > .SRCINFO
```
Commit the two files here, then copy them into the AUR clone and push with a message like
`Update to X.Y.Z`.
