/**
 * generate-icons.mjs — regenerates every icon asset from the SVG sources below.
 *
 * Run: `npm run icons`
 *
 * Follows the VagueDustin Enterprises brand asset pattern: one vector source per mark, every raster
 * size derived from it by script, and a table recording what goes where. Nothing is hand-exported.
 *
 * ── The marks ─────────────────────────────────────────────────────────────────────────────────
 * Both keep the "M↓" markdown glyph — it is the one genuinely recognisable thing about the old
 * icons and it tells a user at a glance what the file is. What changes is the palette: gunmetal +
 * red becomes navy + gold, and the red wireframe constellation is replaced by the house gold
 * hairline and depth wash.
 *
 *   app  — rounded square, navy depth gradient, gold M↓, gold hairline ring.
 *   doc  — portrait sheet with a folded corner, same glyph, so .md files read as documents in
 *          Explorer rather than as another copy of the app icon.
 *
 * ── Output table ──────────────────────────────────────────────────────────────────────────────
 *   build/icon.ico                   16-256  NSIS installer + window/taskbar icon
 *   build/icon-doc.ico               16-256  .md / .markdown file association
 *   build/appx/*.png                 various Microsoft Store (AppX) tiles
 *   src/assets/FATE-Square-Icon.png  512     in-app logo on the home screen
 *   public/favicon.png               256     dev-server favicon
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── Brand tokens (must match src/brand.css [data-theme='fate']) ──────────────────────────── */
const NAVY_975 = '#020617';
const NAVY_900 = '#0A0E27';
const NAVY_700 = '#16213E';
const GOLD_300 = '#FFE9A8';
const GOLD_500 = '#D4AF37';
const GOLD_700 = '#8C6A26';

/** Shared gradient + glyph definitions. `s` is the viewBox edge length. */
const defs = `
  <defs>
    <linearGradient id="navy" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0%" stop-color="${NAVY_700}"/>
      <stop offset="55%" stop-color="${NAVY_900}"/>
      <stop offset="100%" stop-color="${NAVY_975}"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${GOLD_300}"/>
      <stop offset="45%" stop-color="${GOLD_500}"/>
      <stop offset="100%" stop-color="${GOLD_700}"/>
    </linearGradient>
    <radialGradient id="bloom" cx="50%" cy="-8%" r="72%">
      <stop offset="0%" stop-color="${GOLD_500}" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="${GOLD_500}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

/**
 * The M↓ glyph, drawn on a 0 0 100 100 grid so it can be transformed into either mark.
 * Stroked rather than filled so it stays legible when scaled down to 16px.
 */
const glyph = `
  <g fill="none" stroke="url(#gold)" stroke-width="11" stroke-linecap="butt" stroke-linejoin="miter">
    <path d="M8 74 L8 26 L31 55 L54 26 L54 74"/>
    <path d="M78 24 L78 50"/>
  </g>
  <path d="M60 46 L78 76 L96 46 Z" fill="url(#gold)"/>`;

/**
 * Small-size variant of the glyph: the arrow is dropped and the M is set heavier and wider.
 *
 * At 16px the full M↓ occupies roughly 10 device pixels of drawn width with ~1.5px strokes, which
 * anti-aliases into mush. Explorer's list and detail views sample the 16px frame more than any
 * other, so those frames get a mark built for the size instead of a downscale of one that wasn't.
 */
const glyphSmall = `
  <g fill="none" stroke="url(#gold)" stroke-width="16" stroke-linecap="butt" stroke-linejoin="miter">
    <path d="M12 76 L12 24 L50 60 L88 24 L88 76"/>
  </g>`;

/** Rounded-square application icon. `g` lets the small frames swap in a simplified glyph. */
const appSvgWith = (g, glyphScale, glyphOffset) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs}
  <rect x="0" y="0" width="512" height="512" rx="114" fill="url(#navy)"/>
  <rect x="0" y="0" width="512" height="512" rx="114" fill="url(#bloom)"/>
  <rect x="7" y="7" width="498" height="498" rx="108" fill="none"
        stroke="${GOLD_500}" stroke-opacity="0.55" stroke-width="4"/>
  <g transform="translate(${glyphOffset}) scale(${glyphScale})">${g}</g>
</svg>`;

const appSvg = appSvgWith(glyph, 2.6, '126 150');
const appSvgSmall = appSvgWith(glyphSmall, 3.4, '86 126');

/**
 * Document icon. Portrait sheet, folded top-right corner, centred on a square canvas so the .ico
 * frames stay square (Windows stretches non-square frames).
 */
const docSvgWith = (g, glyphScale, glyphOffset) => {
  const sheet =
    'M0 26 A26 26 0 0 1 26 0 H208 L340 132 V434 A26 26 0 0 1 314 460 H26 A26 26 0 0 1 0 434 Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs}
  <g transform="translate(86 26)">
    <path d="${sheet}" fill="url(#navy)"/>
    <path d="${sheet}" fill="url(#bloom)"/>
    <path d="${sheet}" fill="none" stroke="${GOLD_500}" stroke-opacity="0.6" stroke-width="7"/>
    <path d="M208 0 L340 132 H208 Z" fill="${GOLD_500}" fill-opacity="0.22"/>
    <path d="M208 0 V132 H340" fill="none" stroke="${GOLD_500}" stroke-opacity="0.75" stroke-width="7"
          stroke-linejoin="round"/>
    <g transform="translate(${glyphOffset}) scale(${glyphScale})">${g}</g>
  </g>
</svg>`;
};

const docSvg = docSvgWith(glyph, 2.24, '58 196');
const docSvgSmall = docSvgWith(glyphSmall, 2.9, '24 176');

/** Wide AppX tile — same mark, left-aligned, with the Cinzel-ish wordmark beside it. */
const wideSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 300">
  ${defs}
  <rect width="620" height="300" fill="url(#navy)"/>
  <rect width="620" height="300" fill="url(#bloom)"/>
  <g transform="translate(58 92) scale(1.16)">${glyph}</g>
  <text x="220" y="170" font-family="Georgia, serif" font-size="78" font-weight="700"
        letter-spacing="11" fill="url(#gold)">FATE</text>
</svg>`;

const png = (svg, w, h = w) =>
  sharp(Buffer.from(svg)).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

/** .ico frame sizes. 16/24/32/48 are what Explorer and the taskbar actually sample. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** At or below this size, render the simplified glyph rather than downscaling the detailed one. */
const SMALL_FRAME_MAX = 24;

async function buildIco(svg, smallSvg, outPath) {
  const frames = await Promise.all(
    ICO_SIZES.map((s) => png(s <= SMALL_FRAME_MAX ? smallSvg : svg, s)),
  );
  await writeFile(outPath, await pngToIco(frames));
  return frames.length;
}

await mkdir(join(root, 'build', 'appx'), { recursive: true });

// ── Windows icons ────────────────────────────────────────────────────────────────────────────
const appFrames = await buildIco(appSvg, appSvgSmall, join(root, 'build', 'icon.ico'));
const docFrames = await buildIco(docSvg, docSvgSmall, join(root, 'build', 'icon-doc.ico'));
console.log(`  build/icon.ico              ${appFrames} frames ${ICO_SIZES.join('/')}`);
console.log(`  build/icon-doc.ico          ${docFrames} frames ${ICO_SIZES.join('/')}`);

// ── AppX tiles ───────────────────────────────────────────────────────────────────────────────
// Sizes are fixed by the Microsoft Store manifest; electron-builder passes them through as-is.
const APPX = [
  ['Square44x44Logo.png', 44, 44, appSvgSmall],
  ['Square71x71Logo.png', 71, 71, appSvg],
  ['Square150x150Logo.png', 150, 150, appSvg],
  ['Square310x310Logo.png', 310, 310, appSvg],
  ['StoreLogo.png', 50, 50, appSvg],
  ['SmallTile.png', 71, 71, appSvg],
  ['LargeTile.png', 310, 310, appSvg],
  ['Wide310x150Logo.png', 310, 150, wideSvg],
];
for (const [name, w, h, svg] of APPX) {
  await writeFile(join(root, 'build', 'appx', name), await png(svg, w, h));
}
console.log(`  build/appx/*.png            ${APPX.length} tiles`);

// ── In-app + web assets ──────────────────────────────────────────────────────────────────────
await writeFile(join(root, 'src', 'assets', 'FATE-Square-Icon.png'), await png(appSvg, 512));
await writeFile(join(root, 'src', 'assets', 'FATE-Icon.png'), await png(docSvg, 512));
await writeFile(join(root, 'public', 'favicon.png'), await png(appSvg, 256));
console.log('  src/assets/FATE-Square-Icon.png  512  (home-screen logo)');
console.log('  src/assets/FATE-Icon.png         512  (document mark)');
console.log('  public/favicon.png               256');
