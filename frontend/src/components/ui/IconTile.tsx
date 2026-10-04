import type { ReactElement } from 'react'
import Icon from './Icon'
import styles from './IconTile.module.css'

/**
 * A glyph in a tinted tile — the mockups' stat and feature icons.
 *
 * ## What colour means here
 *
 * A `tone` is a **bucket**, not a status: which kind of thing this is (the streak,
 * XP, a chapter), never whether something succeeded. Two things are therefore **not**
 * offered, and their absence is the design:
 *
 *  - **No coloured buttons.** An action is `--primary`. A lilac "Save" would be
 *    indistinguishable from a lilac "Chapter 3" marker two rows above it.
 *  - **No coloured text.** `--cat-*` values are fills and glyphs; `Badge` carries
 *    semantic tones (success, warning, danger) and says what something *is*.
 *
 * ## Fill and glyph are a solved pair
 *
 * Each tone is a pale `--cat-*` tint with a saturated `--cat-*-glyph` (Milestone 30),
 * solved to at least 3:1 on its own tint in `tokens.css` — the mockup's own gold star
 * on cream measures 2.2:1, which is why the gold glyph is a deeper gold than the XP
 * colour.
 *
 * ## It is decorative by default
 *
 * A tile beside a heading that already says "Practice" is decoration, and announcing
 * "target, Practice" is noise. Pass `label` only when the tile is the *only* thing
 * carrying the meaning — which, in this product, it should never be: the rule that no
 * icon may be the sole carrier of meaning applies here too.
 */

export type IconTileTone =
  | 'neutral'
  | 'orange'
  | 'blue'
  | 'magenta'
  | 'purple'
  | 'green'
  | 'lilac'
  /** Achievement — a certificate, a medal, a distinction. Never a category. */
  | 'gold'

export interface IconTileProps {
  /**
   * A Phosphor glyph name, with or without the `ph-` prefix — **or** an already
   * rendered element, which is how the landing page passes a Lucide icon
   * (Milestone 28; see the ADR for why one page is allowed a second icon set).
   *
   * A string is the normal case and stays the normal case: everything outside the
   * landing page uses it, and this component still decides the size and weight for
   * that path. An element is passed through untouched, so the **caller** owns its
   * size and stroke — match `ICON_SIZE` below or the tile will look wrong.
   */
  icon: string | ReactElement
  tone?: IconTileTone
  size?: 'sm' | 'md' | 'lg'
  /** `rounded` for a card's header glyph, `circle` for a marker in a row. */
  shape?: 'rounded' | 'circle'
  /**
   * An accessible name. Omit it — the default — whenever a text label sits beside
   * the tile, which is almost always. See the note above.
   */
  label?: string
  className?: string
}

const ICON_SIZE = { sm: 'sm', md: 'md', lg: 'lg' } as const

export default function IconTile({
  icon,
  tone = 'neutral',
  size = 'md',
  shape = 'rounded',
  label,
  className,
}: IconTileProps) {
  const classes = [styles.tile, styles[tone], styles[size], styles[shape], className]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={classes} {...(label ? {} : { 'aria-hidden': true })}>
      {typeof icon === 'string' ? (
        <Icon name={icon} weight="bold" size={ICON_SIZE[size]} label={label} />
      ) : (
        icon
      )}
    </span>
  )
}
