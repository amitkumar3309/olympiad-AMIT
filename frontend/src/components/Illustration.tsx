import type { CSSProperties } from 'react'
import { ILLUSTRATIONS, type IllustrationEntry, type IllustrationName } from './illustrations'
import styles from './Illustration.module.css'

/**
 * The launch mockups' artwork, by name — with a placeholder until the real file exists
 * (Milestone 30, Phase 1).
 *
 * ## Dropping in final art needs no code change
 *
 * Art lives in `src/assets/illustrations/`, named exactly as the registry below
 * (`hero-student.webp`, `hero-student@2x.webp`, `hero-student.avif`, … or a single
 * `.svg`). The folder is read **at build time** with `import.meta.glob`, so a file that
 * is there is used and a file that is not is never requested. That is deliberate, and
 * it is why this is not `public/illustrations/` as the brief first suggested: probing
 * `public/` for a file that may not exist costs a 404 in the console on every page,
 * and the Phase 5 link crawler fails a page with a console error. The bundled path also
 * gets a content hash, so new art is never served stale from a cache.
 *
 * `docs/launch/ASSETS_NEEDED.md` lists every name, where it appears, its display size
 * and the formats wanted.
 *
 * ## The placeholder is honest
 *
 * A soft gradient with one line icon standing for the subject — never a picture of a
 * person, never text. The mockups' art carries garbled AI lettering (book spines, a
 * framed quote) that must not be reproduced; a placeholder with no words cannot.
 *
 * ## Layout never shifts
 *
 * Every entry has its display width and height, and the box is reserved at that aspect
 * ratio whether the art has arrived or not.
 */

/** Every art file in the folder, resolved to its built URL, once, at build time. */
const FILES = import.meta.glob('../assets/illustrations/*.{svg,png,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

interface Found {
  svg?: string
  png?: string
  webp?: string
  webp2x?: string
  avif?: string
  avif2x?: string
}

function findArt(name: string): Found | null {
  const found: Found = {}
  for (const [path, url] of Object.entries(FILES)) {
    const match = /\/([^/]+?)(@2x)?\.(svg|png|webp|avif)$/.exec(path)
    if (!match || match[1] !== name) continue
    const key = `${match[3]}${match[2] ? '2x' : ''}` as keyof Found
    found[key] = url
  }
  return Object.keys(found).length > 0 ? found : null
}

export interface IllustrationProps {
  name: IllustrationName
  /** Empty (the default) for decoration — which almost every illustration here is. */
  alt?: string
  /** Load immediately and at high priority — only for the hero, if it is the LCP. */
  priority?: boolean
  className?: string
}

export default function Illustration({ name, alt = '', priority, className }: IllustrationProps) {
  const entry: IllustrationEntry = ILLUSTRATIONS[name]
  const art = findArt(name)
  const box = { aspectRatio: `${entry.width} / ${entry.height}` } as CSSProperties
  const classes = [styles.frame, className].filter(Boolean).join(' ')
  const decorative = alt === ''

  if (!art) {
    const Placeholder = entry.icon
    return (
      <div className={[classes, styles.placeholder].join(' ')} style={box} aria-hidden="true">
        <Placeholder className={styles.placeholderIcon} strokeWidth={1.5} />
      </div>
    )
  }

  const img = (
    <img
      src={art.svg ?? art.png ?? art.webp ?? art.avif}
      alt={alt}
      width={entry.width}
      height={entry.height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : undefined}
      className={styles.img}
      {...(decorative ? { 'aria-hidden': true } : {})}
    />
  )

  if (art.svg) {
    return (
      <div className={classes} style={box}>
        {img}
      </div>
    )
  }

  return (
    <div className={classes} style={box}>
      <picture>
        {art.avif && (
          <source type="image/avif" srcSet={art.avif2x ? `${art.avif} 1x, ${art.avif2x} 2x` : art.avif} />
        )}
        {art.webp && (
          <source type="image/webp" srcSet={art.webp2x ? `${art.webp} 1x, ${art.webp2x} 2x` : art.webp} />
        )}
        {img}
      </picture>
    </div>
  )
}
