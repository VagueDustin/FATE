/**
 * escape-appx-manifest.cjs: electron-builder's appxManifestCreated hook (package.json
 * build.appxManifestCreated). Escapes bare ampersands in the generated AppxManifest.xml before
 * makeappx packs it.
 *
 * electron-builder pastes package.json's description into the manifest as is, and FATE's
 * description contains "Formatted Article & Text Editor". A bare "&" is not XML, so makeappx
 * fails with "0x80080204 - The package manifest is not valid" and no Store package is built.
 * Entity references that are already escaped (&amp;, &#38;, &#x26;) are left alone.
 */
const fs = require('node:fs');

module.exports = function escapeAppxManifest(manifestPath) {
  const xml = fs.readFileSync(manifestPath, 'utf8');
  const escaped = xml.replace(/&(?!(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#x[0-9A-Fa-f]+);)/g, '&amp;');
  if (escaped !== xml) fs.writeFileSync(manifestPath, escaped);
};
