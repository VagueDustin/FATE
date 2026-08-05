/**
 * generate-file-icons.mjs — per-file-type document icons, derived from the SAME master as
 * icon-doc.ico so every type keeps the gilded-sheet brand artwork.
 *
 * Run: `npm run icons` (this runs after generate-icons.mjs) or directly with node.
 *
 * ── How a variant is made ─────────────────────────────────────────────────────────────────────
 * The document master (585×800 portrait sheet, gold border, folded corner, gold M↓) has its
 * central glyph REGION covered with a patch matching the sheet's own field gradient, and the
 * file extension is set in its place in the house gold — bright-to-deep vertical gradient, serif,
 * with a soft drop shadow so it sits IN the sheet like the original M does. Nothing else about
 * the artwork is touched, so the border, corner fold and lighting stay pixel-identical to the
 * markdown icon.
 *
 * The extension list is imported from src/fileKinds.js — one source of truth. Markdown types
 * keep the original M↓ icon (build/icon-doc.ico); every code extension gets its own
 * build/fileicons/<ext>.ico, shipped via build.extraResources to resources\fileicons\ and wired
 * to the per-type ProgIds (FATE.<ext>) by build/installer.nsh and the runtime self-heal.
 *
 * Field-patch geometry and colours were sampled from the master:
 *   field ≈ #01091A→#000818 vertical drift; glyph region x 60–525, y 175–705 (below the fold).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { CODE_EXTENSIONS } from '../src/fileKinds.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_MASTER = join(root, 'brand', 'document-icon.png');
const OUT_DIR = join(root, 'build', 'fileicons');

const MASTER_W = 585;
const MASTER_H = 800;

/** .ico frame sizes and the small-frame sharpen, matching generate-icons.mjs. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const SHARPEN_AT_OR_BELOW = 48;

/** Label font size by character count — tuned so 1..7 characters all clear the border. */
const SIZE_BY_LEN = { 1: 330, 2: 250, 3: 195, 4: 152, 5: 126, 6: 108, 7: 94 };

/**
 * The overlay SVG: a field-coloured patch over the M↓ region, then the extension label in the
 * house gold gradient. Rendered at master resolution and composited before any downscale, so
 * small frames inherit the same unsharp treatment as every other icon.
 */
function overlaySvg(label) {
  const fontSize = SIZE_BY_LEN[label.length] ?? 84;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${MASTER_W}" height="${MASTER_H}">
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#030D21"/>
      <stop offset="1" stop-color="#000714"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFE9A8"/>
      <stop offset="0.45" stop-color="#D4AF37"/>
      <stop offset="1" stop-color="#B8902B"/>
    </linearGradient>
  </defs>
  <rect x="60" y="175" width="465" height="562" fill="url(#field)"/>
  <text x="294" y="470" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-weight="bold" font-size="${fontSize}" letter-spacing="2"
        fill="#000000" opacity="0.55" transform="translate(0,7)">${label}</text>
  <text x="292" y="468" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
        font-weight="bold" font-size="${fontSize}" letter-spacing="2"
        fill="url(#gold)">${label}</text>
</svg>`);
}

/** Master + label overlay at full resolution. */
async function labelledMaster(label) {
  return sharp(DOC_MASTER).composite([{ input: overlaySvg(label), top: 0, left: 0 }]).png().toBuffer();
}

async function buildTypeIco(ext) {
  const master = await labelledMaster(ext.toUpperCase());
  const frames = await Promise.all(
    ICO_SIZES.map((size) => {
      let p = sharp(master).resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      });
      if (size <= SHARPEN_AT_OR_BELOW) p = p.sharpen({ sigma: 0.6, m1: 1, m2: 2 });
      return p.png().toBuffer();
    })
  );
  await writeFile(join(OUT_DIR, `${ext}.ico`), await pngToIco(frames));
}

await mkdir(OUT_DIR, { recursive: true });

let done = 0;
// Sequential-ish batches keep sharp's thread pool happy on 83 icons.
const BATCH = 8;
for (let i = 0; i < CODE_EXTENSIONS.length; i += BATCH) {
  await Promise.all(CODE_EXTENSIONS.slice(i, i + BATCH).map(buildTypeIco));
  done = Math.min(CODE_EXTENSIONS.length, i + BATCH);
}
console.log(`  build/fileicons/*.ico            ${done} per-type icons (${ICO_SIZES.join('/')})`);

// Contact sheet for eyeballing a spread of label lengths (not shipped).
const SAMPLE = ['ps1', 'py', 'js', 'html', 'json', 'cs', 'graphql', 'c'];
const cells = await Promise.all(
  SAMPLE.map(async (ext) => sharp(await labelledMaster(ext.toUpperCase())).resize(146, 200, { fit: 'contain', background: { r: 20, g: 20, b: 24, alpha: 1 } }).png().toBuffer())
);
const sheet = sharp({ create: { width: 146 * 4, height: 200 * 2, channels: 4, background: { r: 20, g: 20, b: 24, alpha: 1 } } })
  .composite(cells.map((input, i) => ({ input, left: (i % 4) * 146, top: Math.floor(i / 4) * 200 })));
await writeFile(join(OUT_DIR, '_contact-sheet.png'), await sheet.png().toBuffer());
console.log('  build/fileicons/_contact-sheet.png  preview (not shipped)');
