// Unit tests for fonts resolution, defaults, system fonts, and CSS variable mapping (src/fonts.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// src/fonts.js imports its @fontsource stylesheets, which Vite bundles but Node cannot load.
// Stub every .css import with an empty module before fonts.js is imported.
register('data:text/javascript,' + encodeURIComponent(
  "export async function load(url, context, next) {" +
  "  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };" +
  "  return next(url, context);" +
  "}"
));

const {
  resolveFonts, DEFAULT_FONTS, PROSE_FONTS, DISPLAY_FONTS, CODE_FONTS,
  isSystemFontId, systemFontEntry, fontStack, applyFonts
} = await import('../src/fonts.js');

test('DEFAULT_FONTS keeps the bundled faces: Cinzel display and headings, Inter text, JetBrains Mono code', () => {
  assert.equal(DEFAULT_FONTS.ui, 'inter');
  assert.equal(DEFAULT_FONTS.display, 'cinzel');
  assert.equal(DEFAULT_FONTS.markdown, 'inter');
  assert.equal(DEFAULT_FONTS.heading, 'cinzel');
  assert.equal(DEFAULT_FONTS.code, 'jetbrains-mono');
});

test('DISPLAY_FONTS offers Cinzel plus every prose face; system defaults stay selectable', () => {
  assert.equal(DISPLAY_FONTS[0].id, 'cinzel');
  for (const f of PROSE_FONTS) assert.ok(DISPLAY_FONTS.some((d) => d.id === f.id));
  assert.ok(PROSE_FONTS.some((f) => f.id === 'system-sans'));
  assert.ok(CODE_FONTS.some((f) => f.id === 'system-mono'));
  assert.ok(!PROSE_FONTS.some((f) => f.id === 'cinzel'), 'Cinzel is a display face, not a body face');
});

test('isSystemFontId and systemFontEntry identify and format system fonts', () => {
  assert.ok(isSystemFontId('system:Arial'));
  assert.ok(isSystemFontId('system:Fira Sans'));
  assert.ok(!isSystemFontId('inter'));
  assert.ok(!isSystemFontId('system:'));
  assert.ok(!isSystemFontId(null));

  const entry = systemFontEntry('system:Comic Sans MS', false);
  assert.equal(entry.id, 'system:Comic Sans MS');
  assert.equal(entry.label, 'Comic Sans MS');
  assert.ok(entry.stack.includes("'Comic Sans MS'"));
});

test('resolveFonts merges stored settings and handles display & heading', () => {
  const resolvedDefault = resolveFonts(undefined);
  assert.equal(resolvedDefault.ui, 'inter');
  assert.equal(resolvedDefault.display, 'cinzel');
  assert.equal(resolvedDefault.markdown, 'inter');
  assert.equal(resolvedDefault.heading, 'cinzel');
  assert.equal(resolvedDefault.code, 'jetbrains-mono');

  // Settings saved before display/heading existed keep the Cinzel look.
  const legacy = resolveFonts({ ui: 'lora', markdown: 'lora', code: 'fira-code' });
  assert.equal(legacy.display, 'cinzel');
  assert.equal(legacy.heading, 'cinzel');

  // Unknown ids fall back to the defaults; Cinzel is accepted for display/heading only.
  const bad = resolveFonts({ ui: 'cinzel', display: 'nope', heading: 'cinzel' });
  assert.equal(bad.ui, 'inter');
  assert.equal(bad.display, 'cinzel');
  assert.equal(bad.heading, 'cinzel');

  const custom = resolveFonts({
    ui: 'inter',
    display: 'system:Fira Sans',
    markdown: 'lora',
    heading: 'system:Ubuntu',
    code: 'fira-code'
  });
  assert.equal(custom.ui, 'inter');
  assert.equal(custom.display, 'system:Fira Sans');
  assert.equal(custom.markdown, 'lora');
  assert.equal(custom.heading, 'system:Ubuntu');
  assert.equal(custom.code, 'fira-code');
});

test('fontStack returns valid CSS font-family strings', () => {
  assert.ok(fontStack('system-sans', 'system-sans').includes('system-ui'));
  assert.ok(fontStack('cinzel', 'inter').includes("'Cinzel'"));
  assert.ok(fontStack('system:Arial', 'system-sans').includes("'Arial'"));
  assert.ok(fontStack('inter', 'system-sans').includes("'Inter'"));
});

test('applyFonts sets all CSS custom properties on document element', () => {
  // Mock global document if running under Node.js
  const properties = {};
  const mockStyle = {
    setProperty(key, val) {
      properties[key] = val;
    }
  };
  globalThis.document = {
    documentElement: { style: mockStyle }
  };

  const fonts = resolveFonts({
    ui: 'system-sans',
    display: 'system:Impact',
    markdown: 'system-sans',
    heading: 'system:Georgia',
    code: 'system-mono'
  });

  applyFonts(fonts);
  applyFonts(resolveFonts(undefined));
  assert.ok(properties['--font-display'].includes("'Cinzel'"));
  assert.ok(properties['--font-heading'].includes("'Cinzel'"));
  assert.ok(properties['--font-sans'].includes("'Inter'"));
  applyFonts(fonts);

  assert.ok(properties['--font-sans']);
  assert.ok(properties['--font-display'].includes("'Impact'"));
  assert.ok(properties['--font-doc']);
  assert.ok(properties['--font-heading'].includes("'Georgia'"));
  assert.ok(properties['--font-mono']);
});
