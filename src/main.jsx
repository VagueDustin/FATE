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
 * Only the weights actually used are imported, to keep the bundle small.
 */
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'

// brand.css MUST come before index.css and App.css — it defines the custom properties they consume.
import './brand.css'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
