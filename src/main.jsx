import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

/*
 * Fonts are bundled locally via @fontsource, NOT loaded from a webfont CDN. FATE is a fully
 * offline app with a no-telemetry privacy posture (see PRIVACY.md) — a Google Fonts request would
 * both break offline use and leak a request on every launch. Vite fingerprints and inlines these
 * into dist/, so the packaged app carries its own type.
 *
 * Cinzel  — the house display face (wordmark, headings, section labels).
 * Inter   — the house UI face (everything else).
 *
 * LATIN SUBSET ONLY, and only the weights actually used. The bare `@fontsource/<font>/400.css`
 * entrypoints pull every subset the family ships — Cyrillic, Cyrillic-ext, Greek, Greek-ext,
 * Vietnamese, Latin-ext — which came to 64 font files and roughly 3 MB in the bundle. FATE's chrome
 * is English-only (there is no i18n layer), and document text renders in the reader's own system
 * fonts via the fallback stack, so those subsets were dead weight shipped to every user on every
 * auto-update. Latin-only cuts it to 12 files.
 *
 * If UI localisation is ever added, widen these imports to match the languages supported.
 */
import '@fontsource/cinzel/latin-400.css'
import '@fontsource/cinzel/latin-700.css'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'

// brand.css MUST come before index.css and App.css — it defines the custom properties they consume.
import './brand.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
