import type { HtmlTagDescriptor, Plugin } from 'vite'
import { AMIT_FULL_FORM, AMIT_OLYMPIAD, AMIT_SHORT, SITE_URL, SUPPORT } from './src/lib/brand.ts'
import { DEFAULT_DESCRIPTION, DISALLOWED_PREFIXES, HOME_DESCRIPTION, HOME_TITLE, INDEXED_PATHS } from './src/lib/pageMeta.ts'
import { seasonMetaContent } from './src/lib/season.ts'
import { PICTURES_OF_THE_DAY } from './src/lib/pictureOfTheDay.ts'

/**
 * Search and sharing, generated from the app's own constants (Milestone 30, Phase 6 — brief
 * §10, "SEO and sharing").
 *
 *  - **`index.html`**: the title and description (`%AMIT_HOME_TITLE%`,
 *    `%AMIT_HOME_DESCRIPTION%`), the festive edition's dates for `public/boot.js`
 *    (`%AMIT_SEASON%`, from `src/lib/season.ts` — Phase 7), the share card's Open Graph and Twitter tags with the
 *    absolute image URL, and the organisation's structured data — all from
 *    `src/lib/brand.ts` and `src/lib/pageMeta.ts`, so the HTML carries no second copy of the
 *    name, the domain or the contact details.
 *  - **`robots.txt`** and **`sitemap.xml`**, written into the build from the same page table:
 *    a public page is listed by giving it `index: true` there, and a private area is closed
 *    by listing it in `DISALLOWED_PREFIXES`.
 *  - **`manifest.json`**, for a home-screen install, with the icons from
 *    `scripts/make-brand-images.ts`.
 *
 * The dev server serves the three generated files too, so a page there behaves as it will
 * in a build (a missing manifest is a console error).
 *
 * Nothing here runs in the browser.
 */

/** The share card, made by `scripts/make-brand-images.ts`. */
export const SHARE_IMAGE = { path: '/og-image.jpg', width: 1200, height: 630 } as const

const SHARE_TITLE = `${AMIT_OLYMPIAD} — ${AMIT_FULL_FORM}`
const SHARE_DESCRIPTION = DEFAULT_DESCRIPTION

/*
 * No `og:url`: one index.html is served for every route, so a fixed one would say every shared
 * link is the homepage. A link preview falls back to the URL that was shared, which is right.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const meta = (attrs: Record<string, string>): HtmlTagDescriptor => ({ tag: 'meta', attrs, injectTo: 'head' })

/** Only facts the product already states: its name, its address and its support contact. */
function organization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: AMIT_OLYMPIAD,
    alternateName: AMIT_FULL_FORM,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon-512.png`,
    email: SUPPORT.email,
    telephone: SUPPORT.phone,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: SUPPORT.email,
      telephone: SUPPORT.phone,
      areaServed: 'IN',
      availableLanguage: ['English'],
    },
  }
}

export function robotsTxt(): string {
  return [
    '# Generated at build time from src/lib/pageMeta.ts by vite.seo.ts — edit those, not this.',
    'User-agent: *',
    'Allow: /',
    ...DISALLOWED_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n')
}

export function sitemapXml(today: string): string {
  const urls = INDEXED_PATHS.map(
    (path) => `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`,
  )
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

/**
 * The page and the dark page (`--bg` in tokens.css) — a manifest cannot read a token. The
 * light one is what a home-screen launch starts on.
 */
const PAGE_COLOUR = '#f4f8fe'

export function webManifest(): string {
  const manifest = {
    name: AMIT_OLYMPIAD,
    short_name: AMIT_SHORT,
    description: SHARE_DESCRIPTION,
    lang: 'en-IN',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: PAGE_COLOUR,
    theme_color: PAGE_COLOUR,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** The generated files, by path — written into a build and served by the dev server. */
function generatedFiles(): Record<string, { type: string; body: string }> {
  return {
    '/robots.txt': { type: 'text/plain; charset=utf-8', body: robotsTxt() },
    '/sitemap.xml': { type: 'application/xml; charset=utf-8', body: sitemapXml(new Date().toISOString().slice(0, 10)) },
    '/manifest.json': { type: 'application/manifest+json; charset=utf-8', body: webManifest() },
  }
}

export function seo(): Plugin {
  return {
    name: 'amit-seo',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = generatedFiles()[(req.url ?? '').split('?')[0] ?? '']
        if (!file) {
          next()
          return
        }
        res.setHeader('Content-Type', file.type)
        res.end(file.body)
      })
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const image = `${SITE_URL}${SHARE_IMAGE.path}`
        return {
          html: html
            .replace('%AMIT_HOME_TITLE%', escapeHtml(HOME_TITLE))
            .replace('%AMIT_HOME_DESCRIPTION%', escapeHtml(HOME_DESCRIPTION))
            .replace('%AMIT_SEASON%', escapeHtml(seasonMetaContent()))
            .replace('%AMIT_ART%', String(PICTURES_OF_THE_DAY.length)),
          tags: [
            meta({ property: 'og:type', content: 'website' }),
            meta({ property: 'og:site_name', content: AMIT_OLYMPIAD }),
            meta({ property: 'og:locale', content: 'en_IN' }),
            meta({ property: 'og:title', content: SHARE_TITLE }),
            meta({ property: 'og:description', content: SHARE_DESCRIPTION }),
            meta({ property: 'og:image', content: image }),
            meta({ property: 'og:image:width', content: String(SHARE_IMAGE.width) }),
            meta({ property: 'og:image:height', content: String(SHARE_IMAGE.height) }),
            meta({ property: 'og:image:alt', content: SHARE_TITLE }),
            meta({ name: 'twitter:card', content: 'summary_large_image' }),
            meta({ name: 'twitter:title', content: SHARE_TITLE }),
            meta({ name: 'twitter:description', content: SHARE_DESCRIPTION }),
            meta({ name: 'twitter:image', content: image }),
            meta({ name: 'twitter:image:alt', content: SHARE_TITLE }),
            {
              tag: 'script',
              attrs: { type: 'application/ld+json' },
              children: JSON.stringify(organization()),
              injectTo: 'head',
            },
          ],
        }
      },
    },
    generateBundle() {
      for (const [path, file] of Object.entries(generatedFiles())) {
        this.emitFile({ type: 'asset', fileName: path.slice(1), source: file.body })
      }
    },
  }
}
