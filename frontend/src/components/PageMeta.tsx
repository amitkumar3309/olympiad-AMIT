import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { pageMetaFor } from '../lib/pageMeta'

/**
 * The tab title, the description, `robots` and the canonical link for the page in view
 * (Milestone 30, Phase 6), from the one table in `lib/pageMeta.ts`. Renders nothing.
 *
 * **The canonical link is set here and nowhere else.** `index.html` is served for every
 * route, so a canonical in it would tell a crawler that reads the HTML before the script
 * that every page is the homepage. A private page gets `noindex, nofollow` and no
 * canonical at all.
 *
 * The share tags (`og:*`, `twitter:*`) are deliberately left as `index.html` sets them: the
 * crawlers behind a link preview do not run JavaScript, so a shared link of any page shows
 * the site's own card, and changing them here would only change what nobody reads.
 */

function setMeta(name: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.name = name
    document.head.appendChild(element)
  }
  element.content = content
}

function setCanonical(href: string | null) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (href === null) {
    link?.remove()
    return
  }
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = href
}

export default function PageMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    const meta = pageMetaFor(pathname)
    document.title = meta.title
    setMeta('description', meta.description)
    setMeta('robots', meta.index ? 'index, follow' : 'noindex, nofollow')
    setCanonical(meta.canonical)
  }, [pathname])

  return null
}
