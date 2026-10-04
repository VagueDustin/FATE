// scripts/appx-manifest.cjs: the Store manifest gets FATE's file types, and its ampersands escaped.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const appx = require('../scripts/appx-manifest.cjs');

const root = path.join(__dirname, '..');
const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');

// What electron-builder 26 writes for package.json's single fileAssociations entry (.md), inside
// its appxmanifest.xml template, description pasted unescaped.
const generated = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
   xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10">
  <Properties>
    <Description>FATE (Formatted Article & Text Editor) is a free editor</Description>
  </Properties>
  <Applications>
    <Application Id="FATEMarkdownViewer" Executable="app\\FATE.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="FATE" Description="Formatted Article &amp; Text Editor &#38; more"/>
      <Extensions>
          <uap:Extension Category="windows.fileTypeAssociation">
            <uap:FileTypeAssociation Name="md">
              <uap:SupportedFileTypes>
                <uap:FileType>.md</uap:FileType>
              </uap:SupportedFileTypes>
            </uap:FileTypeAssociation>
          </uap:Extension></Extensions>
    </Application>
  </Applications>
</Package>
`;

const fileTypes = (xml) => [...xml.matchAll(/<uap:FileType>\.([^<]+)<\/uap:FileType>/g)].map((m) => m[1]);
const names = (xml) => [...xml.matchAll(/<uap:FileTypeAssociation Name="([^"]+)"/g)].map((m) => m[1]);

test('reads the code types the NSIS installer registers', () => {
  const types = appx.installerCodeTypes(nsh).map((t) => t.ext);
  assert.ok(types.length >= 80, `only ${types.length} types`);
  for (const ext of ['js', 'py', 'ps1', 'json', 'yaml', 'asm']) assert.ok(types.includes(ext), ext);
  assert.equal(types.includes('bat'), false);
  assert.equal(types.includes('cmd'), false);
});

test('adds .markdown, .txt and every installer code type, once each, never .bat or .cmd', () => {
  const xml = appx.transformManifest(generated, nsh);
  const types = fileTypes(xml);
  const expected = ['md', 'markdown', 'txt', ...appx.installerCodeTypes(nsh).map((t) => t.ext)];
  assert.deepEqual([...types].sort(), [...new Set(expected)].sort());
  assert.equal(types.filter((t) => t === 'md').length, 1, '.md must not be declared twice');
  assert.equal(new Set(names(xml)).size, names(xml).length, 'FileTypeAssociation names must be unique');
  for (const name of names(xml)) assert.match(name, /^[a-z0-9]+$/);
  assert.equal(types.includes('bat') || types.includes('cmd'), false);
});

test('refuses .bat and .cmd even if the installer list regains them', () => {
  const tampered = `${nsh}\n  !insertmacro RegisterCodeType "bat" "BAT File (FATE)"\n  !insertmacro RegisterCodeType "cmd" "CMD File (FATE)"\n`;
  const types = fileTypes(appx.transformManifest(generated, tampered));
  assert.equal(types.includes('bat') || types.includes('cmd'), false);
});

test('creates <Extensions> when electron-builder wrote none', () => {
  const bare = generated.replace(/<Extensions>[\s\S]*<\/Extensions>/, '');
  const xml = appx.addFileTypeAssociations(bare, [{ ext: 'py', displayName: 'PY File (FATE)' }]);
  assert.match(xml, /<Extensions>[\s\S]*<uap:FileType>\.py<\/uap:FileType>[\s\S]*<\/Extensions>\s*<\/Application>/);
});

test('escapes bare ampersands and leaves entity references alone', () => {
  const xml = appx.transformManifest(generated, nsh);
  assert.ok(xml.includes('Formatted Article &amp; Text Editor) is a free editor'));
  assert.ok(xml.includes('Formatted Article &amp; Text Editor &#38; more'));
  assert.equal(/&(?!(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#x[0-9A-Fa-f]+);)/.test(xml), false);
});

test('the elements it adds are balanced', () => {
  const xml = appx.transformManifest(generated, nsh);
  for (const tag of ['uap:Extension', 'uap:FileTypeAssociation', 'uap:SupportedFileTypes', 'uap:DisplayName', 'Extensions']) {
    const open = xml.match(new RegExp(`<${tag}[ >]`, 'g'))?.length ?? 0;
    const close = xml.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0;
    assert.equal(open, close, tag);
  }
});

test('the hook rewrites a manifest file in place', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fate-appx-'));
  try {
    const file = path.join(dir, 'AppxManifest.xml');
    fs.writeFileSync(file, generated);
    appx(file);
    assert.ok(fs.readFileSync(file, 'utf8').includes('<uap:FileType>.markdown</uap:FileType>'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
