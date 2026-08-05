/**
 * generate-store-art.mjs — Microsoft Store listing artwork, derived from brand/app-icon.png.
 *
 * Run: `node scripts/generate-store-art.mjs`  (not part of `npm run icons` — Store art is
 * uploaded manually to Partner Center, not consumed by any build).
 *
 * Outputs (build/store-art/):
 *   poster-720x1080.png / poster-1440x2160.png    9:16 Poster art (main Store logo on Win 10/11)
 *   box-1080x1080.png / box-2160x2160.png         1:1 Box art
 *   tile-300.png / tile-150.png / tile-71.png     1:1 Store display images (app tile overrides)
 *
 * All pieces are the gilded badge centred on the house navy with a soft gold aura — matching the
 * AppX tiles, just at listing resolutions. Flattened onto navy for the same reason the tiles are:
 * the Store renders these against arbitrary chrome, and transparency would pick up whatever
 * accent colour the shell supplies.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_MASTER = join(root, 'brand', 'app-icon.png');
const OUT = join(root, 'build', 'store-art');

/** Matches [data-theme='fate'] --surface-base in src/brand.css. */
const NAVY = { r: 0x07, g: 0x0b, b: 0x1a, alpha: 1 };

/** A navy canvas with a soft radial gold aura behind the badge position. */
function auraSvg(w, h, cx, cy, radius) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="#070B1A"/>
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#aura)"/>
  <defs>
    <radialGradient id="aura">
      <stop offset="0" stop-color="rgba(212,175,55,0.16)"/>
      <stop offset="0.6" stop-color="rgba(212,175,55,0.05)"/>
      <stop offset="1" stop-color="rgba(212,175,55,0)"/>
    </radialGradient>
  </defs>
</svg>`);
}

async function art(w, h, badgeFraction, outName) {
  const badgeSize = Math.round(Math.min(w, h) * badgeFraction);
  const badge = await sharp(APP_MASTER)
    .resize(badgeSize, badgeSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const cy = h > w ? Math.round(h * 0.46) : Math.round(h / 2); // poster: optically centred, a hair high
  const image = sharp(auraSvg(w, h, Math.round(w / 2), cy, Math.round(badgeSize * 0.72)))
    .composite([{ input: badge, left: Math.round((w - badgeSize) / 2), top: Math.round(cy - badgeSize / 2) }])
    .flatten({ background: NAVY })
    .png();

  await writeFile(join(OUT, outName), await image.toBuffer());
  console.log(`  build/store-art/${outName}`.padEnd(44) + `${w}x${h}`);
}

await mkdir(OUT, { recursive: true });

// 9:16 Poster art — the badge reads clearly at both accepted sizes.
await art(720, 1080, 0.82, 'poster-720x1080.png');
await art(1440, 2160, 0.82, 'poster-1440x2160.png');

// 1:1 Box art.
await art(1080, 1080, 0.84, 'box-1080x1080.png');
await art(2160, 2160, 0.84, 'box-2160x2160.png');

// 1:1 Store display images (tile overrides shown to Windows 10/11 customers).
await art(300, 300, 0.9, 'tile-300.png');
await art(150, 150, 0.9, 'tile-150.png');
await art(71, 71, 0.92, 'tile-71.png');
