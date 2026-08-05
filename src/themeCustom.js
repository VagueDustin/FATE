/**
 * themeCustom.js — the custom theme builder's engine.
 *
 * The user picks SEVEN colours; everything else a theme block needs — borders, sunken/highest
 * surfaces, muted text tiers, glows, gradients, and a full 14-colour syntax palette — is derived
 * with colour math so the result hangs together like the hand-built themes do. The output is a
 * `[data-theme='custom']` block injected as a <style> element, which makes a custom theme exactly
 * as first-class as the shipped ones: every token-driven surface (including the editor and the
 * Settings theme-card preview) retunes automatically.
 *
 * Derivations are deterministic, so "Copy CSS" exports a block anyone could paste into brand.css.
 */

export const DEFAULT_CUSTOM = {
  base: '#101528',
  raised: '#182036',
  overlay: '#1F2A45',
  text: '#E6EAF2',
  accent: '#4FA3FF',
  accentHover: '#7CBBFF',
  codeBg: '#0B0F1E'
};

export const CUSTOM_FIELDS = [
  { key: 'base', label: 'Background' },
  { key: 'raised', label: 'Panels' },
  { key: 'overlay', label: 'Popovers & modals' },
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Accent' },
  { key: 'accentHover', label: 'Accent (hover)' },
  { key: 'codeBg', label: 'Code background' }
];

/* ── Colour math ─────────────────────────────────────────────────────────────────────────── */

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  const c = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

const lighten = (hex, amt) => {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([h, s, Math.min(1, l + amt)]));
};
const darken = (hex, amt) => lighten(hex, -amt);
const alpha = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
const mix = (hexA, hexB, t) => {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
};
/** Rotate hue, then clamp lightness into a readable band against dark surfaces. */
const hueShift = (hex, deg) => {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([h + deg, Math.max(0.35, Math.min(0.75, s)), Math.max(0.55, Math.min(0.75, l))]));
};

/** Merge stored custom colours over the defaults, dropping anything that isn't a hex colour. */
export function resolveCustomTheme(stored) {
  if (!stored || typeof stored !== 'object') return null;
  const out = { ...DEFAULT_CUSTOM };
  let sawAny = false;
  for (const { key } of CUSTOM_FIELDS) {
    if (typeof stored[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(stored[key])) {
      out[key] = stored[key].toUpperCase();
      sawAny = true;
    }
  }
  return sawAny ? out : null;
}

/** The generated token block. Deterministic — this is also what "Copy CSS" exports. */
export function customThemeCss(c) {
  const pressed = darken(c.accent, 0.12);
  const syn = {
    keyword: c.accentHover,
    string: hueShift(c.accent, 115),
    comment: mix(c.text, c.base, 0.55),
    number: hueShift(c.accent, 180),
    function: lighten(c.accent, 0.16),
    variable: c.text,
    attribute: hueShift(c.accent, -60),
    type: hueShift(c.accent, 40),
    tag: hueShift(c.accent, -120),
    punct: mix(c.text, c.base, 0.4),
    meta: mix(c.text, c.base, 0.5),
    regex: hueShift(c.accent, 70),
    constant: hueShift(c.accent, 150),
    invalid: '#E8617A'
  };

  return `[data-theme='custom'] {
  --surface-base: ${c.base};
  --surface-raised: ${c.raised};
  --surface-overlay: ${c.overlay};
  --surface-sunken: ${darken(c.base, 0.05)};
  --surface-highest: ${lighten(c.overlay, 0.07)};

  --border-subtle: ${alpha(c.accent, 0.1)};
  --border-default: ${lighten(c.base, 0.14)};
  --border-emphasis: ${c.accent};

  --text-primary: ${c.text};
  --text-muted: ${mix(c.text, c.base, 0.32)};
  --text-faint: ${mix(c.text, c.base, 0.48)};
  --text-inverse: ${c.base};
  --text-accent: ${c.accentHover};

  --accent-default: ${c.accent};
  --accent-hover: ${c.accentHover};
  --accent-pressed: ${pressed};
  --accent-subtle: ${alpha(c.accent, 0.12)};
  --accent-glow: ${alpha(c.accent, 0.42)};

  --status-danger: #E8617A;
  --status-success: #A6E26A;

  --gradient-depth: radial-gradient(ellipse 80% 50% at 50% -10%, ${alpha(c.accent, 0.07)}, transparent);
  --gradient-accent-text: linear-gradient(135deg, ${c.accentHover} 0%, ${c.accent} 55%, ${pressed} 100%);
  --gradient-panel: linear-gradient(180deg, ${alpha(c.overlay, 0.85)}, ${alpha(c.base, 0.92)});

  --shadow-panel: 0 20px 50px -24px rgba(0, 0, 0, 0.65), inset 0 0 0 1px ${alpha(c.accent, 0.12)};
  --shadow-glow: 0 0 0 1px ${alpha(c.accent, 0.35)}, 0 8px 30px -8px ${alpha(c.accent, 0.4)};
  --shadow-glow-soft: 0 0 20px -6px ${alpha(c.accent, 0.35)};

  --code-bg: ${c.codeBg};

${Object.entries(syn).map(([k, v]) => `  --syn-${k}: ${v};`).join('\n')}
}`;
}

/** Inject (or update / remove) the custom theme's <style> block. */
export function applyCustomTheme(colors) {
  const id = 'fate-custom-theme';
  let el = document.getElementById(id);
  if (!colors) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = customThemeCss(colors);
}
