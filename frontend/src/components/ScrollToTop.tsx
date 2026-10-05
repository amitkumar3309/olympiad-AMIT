import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Starts a new page at the top (Milestone 30, Phase 4).
 *
 * `BrowserRouter` keeps the window's scroll position across a navigation, so a link
 * followed from the foot of one page opened the next at the same depth: signing in from
 * the homepage's closing call to action landed a student on the dashboard 2,400px down,
 * below the welcome and the figures, and a phone showed the middle of a page as its top.
 *
 * Two cases are left alone. A back or forward (`POP`) keeps the browser's own restoration,
 * which is what a reader returning to a list expects. A link with a `#fragment` is the
 * page's to scroll — the homepage's sections and the rewards page's `#journey` scroll
 * themselves once the section exists.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const navigationType = useNavigationType()

  // A layout effect, so the new page is never painted at the old depth first.
  useLayoutEffect(() => {
    if (navigationType === 'POP' || hash) return
    window.scrollTo(0, 0)
  }, [pathname, hash, navigationType])

  return null
}
