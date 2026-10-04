/**
 * appx-manifest.cjs: electron-builder's appxManifestCreated hook (package.json
 * build.appxManifestCreated). Two edits to the generated AppxManifest.xml before makeappx packs it.
 *
 * 1. File types for the Microsoft Store package. electron-builder writes one
 *    uap:FileTypeAssociation per entry in build.fileAssociations, and that list is shared with the
 *    NSIS installer, where an entry means TAKING the type's default (electron-builder's
 *    APP_ASSOCIATE). That is why it holds .md alone, and why up to 1.13 the Store package offered
 *    "Open with FATE" for .md and nothing else. The .appx gets the rest here, where the installer
 *    never sees it: .markdown, .txt and every code type the installer registers, read from
 *    build/installer.nsh so the two lists cannot drift apart. A packaged app cannot take a default
 *    at all: these put FATE under "Open with" and on its Default apps page, which is exactly what the
 *    installer's OpenWithProgids entries do.
 *
 *    .bat and .cmd are refused even if the installer list ever regains them. Merely being listed as
 *    a handler is enough to make Windows show "Pick an app" instead of running a batch file, and
 *    its default cannot be picked back (PROTECTED_EXTENSIONS in electron/main.cjs; 1.11.5 did this).
 *
 * 2. Ampersands. electron-builder pastes package.json's description into the manifest as is, and
 *    FATE's description contains "Formatted Article & Text Editor". A bare "&" is not XML, so
 *    makeappx fails with "0x80080204 - The package manifest is not valid" and no Store package is
 *    built. Entity references that are already escaped (&amp;, &#38;, &#x26;) are left alone.
 *
 * The functions below are pure and exported for test/appx-manifest.test.cjs.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Never associated, whatever the installer list says. Mirrors PROTECTED_EXTENSIONS in main.cjs. */
const PROTECTED_EXTENSIONS = ['bat', 'cmd'];

/**
 * The Markdown-side types beyond .md (which build.fileAssociations already declares). Same set as
 * MARKDOWN_EXTENSIONS in main.cjs; the installer registers these through Capabilities instead of
 * RegisterCodeType, so they are not in the list read from installer.nsh.
 */
const MARKDOWN_TYPES = [
  { ext: 'markdown', displayName: 'Markdown Document' },
  { ext: 'txt', displayName: 'Text Document' },
];

function escapeBareAmpersands(xml) {
  return xml.replace(/&(?!(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#x[0-9A-Fa-f]+);)/g, '&amp;');
}

function escapeXmlText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The code types build/installer.nsh registers, in its order: every
 * `!insertmacro RegisterCodeType "ext" "Description"` line. Throws on a malformed extension rather
 * than writing it into the manifest, and when the list is empty (the macro was renamed), because
 * a Store package that silently loses every code type is the bug this hook exists to fix.
 */
function installerCodeTypes(nsh) {
  const types = [];
  const seen = new Set();
  const re = /^[ \t]*!insertmacro[ \t]+RegisterCodeType[ \t]+"([^"]*)"[ \t]+"([^"]*)"/gm;
  for (const [, ext, description] of nsh.matchAll(re)) {
    if (!/^[a-z0-9]+$/.test(ext)) throw new Error(`installer.nsh: unexpected extension "${ext}"`);
    if (seen.has(ext)) continue;
    seen.add(ext);
    types.push({ ext, displayName: description });
  }
  if (types.length === 0) throw new Error('installer.nsh: no RegisterCodeType lines found');
  return types;
}

/** Everything the Store package should associate beyond build.fileAssociations. */
function storeFileTypes(nsh) {
  return [...MARKDOWN_TYPES, ...installerCodeTypes(nsh)].filter((t) => !PROTECTED_EXTENSIONS.includes(t.ext));
}

/**
 * Add one uap:FileTypeAssociation per type to the application's <Extensions>, creating the element
 * when electron-builder wrote none. Types the manifest already declares (.md) are skipped, so a
 * file type never appears twice. The association Name is the extension, as electron-builder names
 * its own, which keeps every Name unique and lower case as the manifest schema requires.
 */
function addFileTypeAssociations(xml, types) {
  const declared = new Set(
    [...xml.matchAll(/<uap:FileType>\s*\.([^<\s]+)\s*<\/uap:FileType>/gi)].map((m) => m[1].toLowerCase()),
  );
  const blocks = types
    .filter((t) => !declared.has(t.ext))
    .map(
      (t) => `
          <uap:Extension Category="windows.fileTypeAssociation">
            <uap:FileTypeAssociation Name="${t.ext}">
              <uap:DisplayName>${escapeXmlText(t.displayName)}</uap:DisplayName>
              <uap:SupportedFileTypes>
                <uap:FileType>.${t.ext}</uap:FileType>
              </uap:SupportedFileTypes>
            </uap:FileTypeAssociation>
          </uap:Extension>`,
    )
    .join('');
  if (!blocks) return xml;
  if (xml.includes('</Extensions>')) return xml.replace('</Extensions>', `${blocks}</Extensions>`);
  if (!xml.includes('</Application>')) throw new Error('AppxManifest.xml: no </Application> element');
  return xml.replace('</Application>', `<Extensions>${blocks}</Extensions>\n    </Application>`);
}

function transformManifest(xml, nsh) {
  return escapeBareAmpersands(addFileTypeAssociations(xml, storeFileTypes(nsh)));
}

module.exports = function appxManifestCreated(manifestPath) {
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
  const xml = fs.readFileSync(manifestPath, 'utf8');
  const next = transformManifest(xml, nsh);
  if (next !== xml) fs.writeFileSync(manifestPath, next);
};

Object.assign(module.exports, {
  PROTECTED_EXTENSIONS,
  MARKDOWN_TYPES,
  escapeBareAmpersands,
  installerCodeTypes,
  storeFileTypes,
  addFileTypeAssociations,
  transformManifest,
});
