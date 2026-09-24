/**
 * write-snap-desktop.mjs: generate snap/gui/fate.desktop and snap/gui/fate.png for the Snap
 * Store build, from package.json (name, description, MIME types) and build/icons (run
 * `npm run icons` first).
 *
 * snapcraft installs snap/gui/<app>.desktop as the snap's desktop entry automatically. The
 * MimeType line mirrors what the .deb/.rpm register (build.linux.mimeTypes + the .md
 * fileAssociation), so "Open With" and default-app behaviour is the same however FATE was
 * installed. Generated, not tracked: snap/gui/ is gitignored.
 *
 * Run: node scripts/write-snap-desktop.mjs
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const linux = pkg.build.linux;

const mimeTypes = [
  ...(pkg.build.fileAssociations ?? []).map((a) => a.mimeType).filter(Boolean),
  ...(linux.mimeTypes ?? [])
];
const uniqueMime = [...new Set(mimeTypes)];

const desktop = [
  '[Desktop Entry]',
  `Name=${pkg.build.productName}`,
  `GenericName=${linux.desktop?.entry?.GenericName ?? 'Text Editor'}`,
  `Comment=${linux.synopsis ?? pkg.description}`,
  'Exec=fate %U',
  'Icon=${SNAP}/meta/gui/fate.png',
  'Terminal=false',
  'Type=Application',
  'Categories=Utility;TextEditor;',
  `Keywords=${linux.desktop?.entry?.Keywords ?? 'markdown;text;editor;'}`,
  `MimeType=${uniqueMime.join(';')};`,
  `StartupWMClass=${pkg.build.productName}`,
  ''
].join('\n');

const gui = join(root, 'snap', 'gui');
await mkdir(gui, { recursive: true });
await writeFile(join(gui, 'fate.desktop'), desktop);
await copyFile(join(root, 'build', 'icons', '512x512.png'), join(gui, 'fate.png'));

console.log(`snap/gui/fate.desktop  ${uniqueMime.length} MIME types`);
console.log('snap/gui/fate.png      512px, from build/icons');
