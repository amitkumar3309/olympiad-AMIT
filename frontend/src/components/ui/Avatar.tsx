import { useState } from 'react'
import styles from './Avatar.module.css'

/**
 * A person, at a glance.
 *
 * ## Why initials rather than a generic silhouette
 *
 * Most accounts here have a photograph — it is mandatory at registration — but a
 * staff account has none, a photo can fail to load, and an admin table paging fifty
 * rows fires fifty image requests against the free tier. A silhouette on every one of
 * those tells the reader nothing; initials tell them which row they are looking at
 * even when the picture never arrives.
 *
 * ## `name` is required, and it does two jobs
 *
 * It is the initials *and* the image's alternative text. Making it mandatory is the
 * type-level form of the rule that an image carrying meaning needs a description: an
 * avatar with a `src` and no name is a picture of a child with no way to know whose.
 *
 * ## The fallback is real, not hopeful
 *
 * A failed load switches to initials via `onError` rather than leaving the browser's
 * broken-image glyph in a table cell. That matters here specifically: photographs
 * come from an authenticated endpoint, so a session that has just expired would
 * otherwise turn every avatar on the page into a broken icon.
 *
 * ## Decorative or not
 *
 * When the person's name is printed beside the avatar — which it is, in every table
 * in this product — pass `decorative`. Hearing "Priya Sharma, image, Priya Sharma" is
 * noise. Omit it when the avatar stands alone.
 */

export interface AvatarProps {
  /** The person's full name. Used for the initials and for the image's alt text. */
  name: string
  /** Photograph URL. Falls back to initials if absent or if the request fails. */
  src?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /**
   * Hides the avatar from assistive technology. Correct whenever the name is printed
   * beside it, which is the usual case in a table or a list row.
   */
  decorative?: boolean
  className?: string
}

/**
 * First letter of the first word plus first letter of the last — `Priya Sharma` → PS,
 * `Amit` → A.
 *
 * Deliberately not "the first two characters", which turns every `Mohammed Ali` into
 * MO; and capped at two, because three initials in a 32px circle is a smudge. A name
 * that is empty or punctuation-only falls back to a bullet rather than rendering an
 * empty circle, which reads as a loading state that never finishes.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '•'

  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  const initials = `${first}${last}`.toUpperCase()

  return initials || '•'
}

export default function Avatar({ name, src, size = 'md', decorative, className }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed

  const classes = [styles.avatar, styles[size], className].filter(Boolean).join(' ')
  const hidden = decorative ? { 'aria-hidden': true as const } : {}

  if (showImage) {
    return (
      <img
        src={src ?? undefined}
        // Empty alt on a decorative image rather than no alt — the two differ: a
        // missing alt makes a screen reader read the URL.
        alt={decorative ? '' : name}
        className={classes}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        {...hidden}
      />
    )
  }

  return (
    <span className={classes} {...(decorative ? hidden : { role: 'img', 'aria-label': name })}>
      <span aria-hidden="true">{initialsOf(name)}</span>
    </span>
  )
}
