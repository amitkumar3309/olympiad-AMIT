import { StrictMode, startTransition } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
/*
 * The Diwali intro's stylesheet (Phase 7). Its markup is drawn into the homepage's HTML outside
 * the app's root (vite.prerender.ts), and the app never renders the component — so this import
 * is the only thing that puts its rules in the stylesheet the drawn homepage links. It is *used*
 * below, because the bundler drops a stylesheet whose class names nothing reads.
 */
import introStyles from './components/DiwaliIntro.module.css'
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

/**
 * Takes the Diwali intro's markup out of the page once it has ended — at once when it never
 * played. `public/boot.js` ends it (on a key, a tap, a scroll, or its timer) by removing
 * `data-intro` from <html>; until then it is left exactly as it is, mid-animation.
 */
function releaseIntro() {
  const intro = document.querySelector(`.${introStyles.intro}`)
  if (!intro) return
  const html = document.documentElement
  if (!html.hasAttribute('data-intro')) {
    intro.remove()
    return
  }
  const watcher = new MutationObserver(() => {
    if (html.hasAttribute('data-intro')) return
    watcher.disconnect()
    intro.remove()
  })
  watcher.observe(html, { attributes: true, attributeFilter: ['data-intro'] })
}
releaseIntro()

const container = document.getElementById('root')!
const root = createRoot(container)
const app = (
  <StrictMode>
    <App />
  </StrictMode>
)

/** What identifies a link or a button in both the drawn page and the live one. */
function signatureOf(element: Element): string {
  return [
    element.tagName,
    element.id,
    element.getAttribute('href'),
    element.getAttribute('aria-label'),
    element.textContent?.trim(),
  ].join('|')
}

/**
 * Keeps a keyboard reader's place when React replaces the drawn page. A control focused before
 * the app arrived — the "Skip to content" link, most likely — is removed with the rest of the
 * drawn page, and the focus would drop to the document, sending the reader back to the top.
 * So the last control focused in the drawn page is noted, and once React's first commit has
 * replaced it, its counterpart in the live page is focused instead.
 */
function keepFocusThroughTakeover(drawn: HTMLElement) {
  let last = drawn.contains(document.activeElement) && document.activeElement ? signatureOf(document.activeElement) : null
  const onFocus = (event: FocusEvent) => {
    if (event.target instanceof Element) last = signatureOf(event.target)
  }
  drawn.addEventListener('focusin', onFocus)
  // React's first commit removes the drawn children and adds its own in one go.
  const observer = new MutationObserver(() => {
    observer.disconnect()
    drawn.removeEventListener('focusin', onFocus)
    if (last === null || document.activeElement !== document.body) return
    const tag = last.split('|')[0]!
    const counterpart = [...drawn.querySelectorAll(tag)].find((element) => signatureOf(element) === last)
    if (counterpart instanceof HTMLElement) counterpart.focus({ preventScroll: true })
  })
  observer.observe(drawn, { childList: true })
}

/*
 * The homepage arrives already drawn (`vite.prerender.ts`); every other route arrives empty.
 * Over a drawn page React's first render replaces it rather than hydrating it — see the note
 * in vite.prerender.ts — and runs as a transition: the reader is already looking at the page,
 * so that work can yield to the browser in small slices instead of holding a phone's
 * processor for most of a second (Lighthouse's "total blocking time"). An empty root is
 * rendered at once, as before, because there is nothing on screen to wait behind.
 */
if (container.hasChildNodes()) {
  keepFocusThroughTakeover(container)
  startTransition(() => root.render(app))
} else {
  root.render(app)
}
