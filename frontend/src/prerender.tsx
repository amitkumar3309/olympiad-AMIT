import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { AppProviders, AppRoutes } from './App.tsx'

/**
 * The homepage as HTML, drawn at build time (Milestone 30, Phase 6 — brief §10, "LCP ≤ 2.5 s").
 *
 * `vite.prerender.ts` builds this file for Node and writes what `renderHome()` returns into
 * `dist/index.html`, so a phone has the page to paint as soon as the HTML and the stylesheets
 * arrive — before the ~120 KB (compressed) of script the page needs, most of it React, has
 * downloaded and run. `src/main.tsx` then draws the live page over it.
 *
 * It is the same tree the browser renders — `AppProviders` and `AppRoutes` from `App.tsx` —
 * at `/`, in the state every visit starts in: the session still being checked, nothing
 * fetched yet. So it shows what the first client render shows: the guest homepage, its
 * figures as loading skeletons, no floating button. The HTML is built once and served to
 * everybody, so nothing in it may depend on who is visiting: no cookie, no API, no stored
 * preference. (The footer's © year is the build's until React draws the page.)
 */
export function renderHome(): string {
  return renderToString(
    <StrictMode>
      <AppProviders>
        <StaticRouter location="/">
          <AppRoutes />
        </StaticRouter>
      </AppProviders>
    </StrictMode>,
  )
}
