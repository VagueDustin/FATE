// The code-type list lives in three places that must agree (CONTRIBUTING → Where things live):
// CODE_EXTENSIONS in electron/main.cjs, CODE_EXTENSIONS in src/fileKinds.js, and the generated
// blocks in build/installer.nsh. The Store manifest reads the installer's list
// (scripts/appx-manifest.cjs), so a drift here would reach every Windows channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_EXTENSIONS as RENDERER_CODE, MARKDOWN_EXTENSIONS as RENDERER_MARKDOWN } from '../src/fileKinds.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nsh = readFileSync(join(root, 'build', 'installer.nsh'), 'utf8');
const mainCjs = readFileSync(join(root, 'electron', 'main.cjs'), 'utf8');

const macroArgs = (macro) => [...nsh.matchAll(new RegExp(`^[ \\t]*!insertmacro[ \\t]+${macro}[ \\t]+"([^"]+)"`, 'gm'))].map((m) => m[1]);

/** A `const NAME = [ 'a', 'b' ];` array literal from main.cjs, read as text (main.cjs needs Electron). */
function mainArray(name) {
  const m = mainCjs.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `electron/main.cjs no longer declares ${name} as an array literal; update this test`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const sorted = (list) => [...new Set(list)].sort();
const MAIN_CODE = mainArray('CODE_EXTENSIONS');
const PROTECTED = mainArray('PROTECTED_EXTENSIONS');
const INSTALLED = macroArgs('RegisterCodeType');
const UNINSTALLED = macroArgs('UnregisterCodeType');

test('main.cjs and fileKinds.js list the same code and Markdown types', () => {
  assert.deepEqual(sorted(RENDERER_CODE), sorted(MAIN_CODE));
  assert.deepEqual(sorted(RENDERER_MARKDOWN), sorted(mainArray('MARKDOWN_EXTENSIONS')));
});

test('the installer registers exactly the associable code types', () => {
  assert.deepEqual(sorted(INSTALLED), sorted(MAIN_CODE.filter((e) => !PROTECTED.includes(e))));
  assert.equal(new Set(INSTALLED).size, INSTALLED.length, 'a type is registered twice');
});

test('the installer never registers a protected type', () => {
  assert.deepEqual(PROTECTED.filter((e) => INSTALLED.includes(e)), []);
  for (const e of PROTECTED) {
    assert.ok(nsh.includes(`!insertmacro RestoreCommandProcessorType "${e}"`), `customInstall must repair .${e}`);
  }
});

test('the uninstaller removes every type the installer (or an older one) registered', () => {
  assert.deepEqual(INSTALLED.filter((e) => !UNINSTALLED.includes(e)), []);
  // 1.11.5 and earlier registered .bat and .cmd; their keys still come out.
  for (const e of PROTECTED) assert.ok(UNINSTALLED.includes(e), e);
});

test('per-user entries come out on a real uninstall, never during an update', () => {
  const unregister = nsh.match(/!macro UnregisterCodeType EXT([\s\S]*?)!macroend/)[1];
  assert.match(unregister, /\$\{IfNot\} \$\{isUpdated\}[\s\S]*DeleteRegKey HKCU "Software\\Classes\\FATE\.\$\{EXT\}"[\s\S]*\$\{EndIf\}/);
  const uninstall = nsh.match(/!macro customUnInstall([\s\S]*?)!macroend/)[1];
  assert.match(uninstall, /\$\{IfNot\} \$\{isUpdated\}[\s\S]*Markdown Document[\s\S]*DeleteRegKey HKCU "\$\{INSTALL_REGISTRY_KEY\}"[\s\S]*\$\{EndIf\}/);
});

test('preInit does nothing in the uninstaller-building pass that runs on the build machine', () => {
  const preInit = nsh.match(/!macro preInit([\s\S]*?)!macroend/)[1];
  assert.match(preInit.trim(), /^!ifndef BUILD_UNINSTALLER[\s\S]*!endif$/);
});
