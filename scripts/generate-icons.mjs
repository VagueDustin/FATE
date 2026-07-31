/**
 * generate-icons.mjs — derives every icon asset from the two artwork masters in `brand/`.
 *
 * Run: `npm run icons`
 *
 * Follows the VagueDustin Enterprises brand asset pattern: hi-res masters kept in `brand/`, every
 * raster size derived by script, and a table recording what lands where. Nothing is hand-exported,
 * so nothing can silently drift.
 *
 * ── Masters ───────────────────────────────────────────────────────────────────────────────────
 *   brand/app-icon.png       1178x1192  Gilded badge — gold frame, navy starfield, crescent moon,
 *                                       open book bearing M and a down-arrow, "FATE / MARKDOWN
 *                                       VIEWER" in ornate gold serif, filigree flourishes.
 *   brand/document-icon.png   585x800   Portrait sheet with a folded corner, gold ornate M over a
 *                                       down-arrow on navy.
 *
 * Neither master is square, and Windows stretches non-square .ico frames. Both are therefore
 * padded to a square canvas with transparency before any resize (`fit: 'contain'`).
 *
 * ── Small frames ──────────────────────────────────────────────────────────────────────────────
 * The badge is intentionally ornate, which fights legibility at 16px. Three approaches were
 * rendered and compared: plain downscale, sharpened downscale, and cropping to just the book+M
 * element. Cropping was rejected — it discarded the badge silhouette and read as a different app.
 * Sharpened downscale won, so frames at or below SHARPEN_AT_OR_BELOW get an unsharp pass. At 32px+
 * the wordmark is clearly readable; at 16px it resolves to a gold-on-navy badge, which is still
 * distinctive in an Explorer list.
 *
 * ── Output table ──────────────────────────────────────────────────────────────────────────────
 *   build/icon.ico                   16–256  window + taskbar icon, NSIS installer, Add/Remove
 *                                            Programs entry, desktop shortcut
 *   build/icon-doc.ico               16–256  .md / .markdown file association
 *   build/appx/*.png                 various Microsoft Store (AppX) tiles
 *   src/assets/FATE-Square-Icon.png  512     the logo on the app's home screen
 *   public/favicon.png               256     dev-server / renderer favicon
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_MASTER = join(root, 'brand', 'app-icon.png');
const DOC_MASTER = join(root, 'brand', 'document-icon.png');

/** Navy for tile backgrounds. Matches [data-theme='fate'] --surface-base in src/brand.css. */
const NAVY = { r: 0x07, g: 0x0b, b: 0x1a, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** .ico frame sizes. 16/24/32/48 are what Explorer and the taskbar actually sample. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** Frames at or below this size get an unsharp pass to survive the downscale. */
const SHARPEN_AT_OR_BELOW = 48;

/**
 * Render a master to a square PNG of the given size.
 * `fit: 'contain'` both squares a non-square master and preserves its aspect ratio.
 */
async function square(master, size, { background = TRANSPARENT, sharpen = null } = {}) {
  let pipeline = sharp(master).resize(size, size, { fit: 'contain', background });
  if (sharpen) pipeline = pipeline.sharpen(sharpen);
  return pipeline.png().toBuffer();
}

/** A frame for an .ico, sharpened when small. */
const icoFrame = (master, size) =>
  square(master, size, {
    sharpen: size <= SHARPEN_AT_OR_BELOW ? { sigma: 0.6, m1: 1, m2: 2 } : null,
  });

async function buildIco(master, outPath) {
  const frames = await Promise.all(ICO_SIZES.map((s) => icoFrame(master, s)));
  await writeFile(outPath, await pngToIco(frames));
}

/**
 * A wide AppX tile: the badge centred on navy. The master already contains the "FATE / MARKDOWN
 * VIEWER" wordmark, so no text is composited — that would duplicate it.
 */
async function wideTile(width, height) {
  const badge = await square(APP_MASTER, Math.round(height * 0.86));
  return sharp({ create: { width, height, channels: 4, background: NAVY } })
    .composite([{ input: badge, gravity: 'center' }])
    .png()
    .toBuffer();
}

await mkdir(join(root, 'build', 'appx'), { recursive: true });
await mkdir(join(root, 'src', 'assets'), { recursive: true });

// ── Windows icons ────────────────────────────────────────────────────────────────────────────
await buildIco(APP_MASTER, join(root, 'build', 'icon.ico'));
await buildIco(DOC_MASTER, join(root, 'build', 'icon-doc.ico'));
console.log(`  build/icon.ico                   ${ICO_SIZES.join('/')}  app / installer / taskbar`);
console.log(`  build/icon-doc.ico               ${ICO_SIZES.join('/')}  .md file association`);

// ── AppX tiles ───────────────────────────────────────────────────────────────────────────────
// Sizes are fixed by the Microsoft Store manifest; electron-builder passes them straight through.
// Tiles render against the Store's own chrome, so they are flattened onto navy rather than left
// transparent — a transparent tile picks up whatever accent colour the user's theme supplies.
const SQUARE_TILES = [
  ['Square44x44Logo.png', 44],
  ['Square71x71Logo.png', 71],
  ['Square150x150Logo.png', 150],
  ['Square310x310Logo.png', 310],
  ['StoreLogo.png', 50],
  ['SmallTile.png', 71],
  ['LargeTile.png', 310],
];
for (const [name, size] of SQUARE_TILES) {
  const inner = await square(APP_MASTER, Math.round(size * 0.92), {
    sharpen: size <= SHARPEN_AT_OR_BELOW ? { sigma: 0.6, m1: 1, m2: 2 } : null,
  });
  const tile = await sharp({ create: { width: size, height: size, channels: 4, background: NAVY } })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toBuffer();
  await writeFile(join(root, 'build', 'appx', name), tile);
}
await writeFile(join(root, 'build', 'appx', 'Wide310x150Logo.png'), await wideTile(310, 150));
console.log(`  build/appx/*.png                 ${SQUARE_TILES.length + 1} tiles  Microsoft Store`);

// ── In-app + renderer assets ─────────────────────────────────────────────────────────────────
// Transparent, not navy: these sit on the app's own navy surface, and a baked-in navy square would
// show as a visible box against the layered depth wash behind it.
await writeFile(join(root, 'src', 'assets', 'FATE-Square-Icon.png'), await square(APP_MASTER, 512));
await writeFile(join(root, 'public', 'favicon.png'), await square(APP_MASTER, 256));
console.log('  src/assets/FATE-Square-Icon.png  512   home-screen logo');
console.log('  public/favicon.png               256   renderer favicon');
