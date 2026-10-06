import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './App.tsx'

/**
 * Phosphor, the icon font's two weights (see the note in index.html), added once the page has
 * loaded (Milestone 30, Phase 6). Linked in the HTML they blocked the first paint; added straight
 * away by this script they still started 300 KB of font downloads before the first paint, which
 * on a phone's connection is what the page's own text was waiting behind. After `load`, the text
 * paints first and the icons follow — an icon is never the only carrier of meaning.
 *
 * A `load` listener, not an animation frame or an idle callback, which may never arrive in a tab
 * that is not being drawn (CLAUDE.md).
 */
function addIconStylesheets() {
  for (const weight of ['regular', 'bold']) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://unpkg.com/@phosphor-icons/web@2.1.1/src/${weight}/style.css`
    document.head.appendChild(link)
  }
}
if (document.readyState === 'complete') addIconStylesheets()
else window.addEventListener('load', addIconStylesheets, { once: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
