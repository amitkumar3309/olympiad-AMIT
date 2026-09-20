import Icon from './Icon'
import styles from './IconTile.module.css'

/**
 * A glyph in a coloured tile — **the only place the categorical palette appears.**
 *
 * ## Why colour was confined to one component
 *
 * This visual language reduces actions to near-black, which frees colour to *mean*
 * something instead of decorating. That only works if colour is scarce and
 * consistent, and the way to guarantee both is to give it exactly one home. A feature
 * card's icon, a subject marker, a step number, an empty state's glyph — all of them
 * are this component with a different `tone`.
 *
 * Two things are therefore **not** offered, and their absence is the design:
 *
 *  - **No coloured buttons.** An action is `--primary`. A lilac "Save" would be
 *    indistinguishable from a lilac "Chapter 3" marker two rows above it.
 *  - **No coloured text.** `--cat-*` values are fills; `Badge` carries semantic tones
 *    (success, warning, danger) and says what something *is*, which is a different
 *    job from saying which *bucket* it is in.
 *
 * ## The `-on` colour is not always white
 *
 * White on `--cat-orange` measures 3.08:1 — below even the 3:1 a non-text graphic
 * needs. Orange, green and lilac are light fills and take ink; blue, magenta and
 * purple are dark enough for white. Each pairing is declared beside its hue in
 * `tokens.css` rather than assumed here.
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
  /** Phosphor glyph name, with or without the `ph-` prefix. */
  icon: string
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
      <Icon name={icon} weight="bold" size={ICON_SIZE[size]} label={label} />
    </span>
  )
}
