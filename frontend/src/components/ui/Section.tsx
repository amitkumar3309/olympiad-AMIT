import { useId, type ElementType, type ReactNode } from 'react'
import Icon from './Icon'
import styles from './Section.module.css'

/**
 * A titled block of a page: **eyebrow → heading → lead → content**.
 *
 * ## Why this exists
 *
 * It is the rhythm the whole redesign is built on, and before Milestone 26 every page
 * spelled it out by hand — `.sectionHead`, `.panelHeader`, `.pageTitle`, `.lead`,
 * `.kicker`, and about thirty more across fourteen thousand lines of page CSS. They
 * mostly agreed, which is worse than disagreeing: nobody could tell whether a
 * difference was a decision. This is that pattern, once.
 *
 * ## It is also the page header
 *
 * There is deliberately **no separate `PageHeader`**. A page's opening block and a
 * section inside it are the same shape at two sizes, and shipping two components for
 * that is how a design system grows near-duplicates. Pass `titleAs="h1" size="page"`
 * and this is a page header.
 *
 * Inside `AppShell` the `h1` already lives in the topbar, so a section on a signed-in
 * page is an `h2` — the default. On a public page that renders its own chrome
 * (`/leaderboard`, `/gallery`, `/verify`), the first `Section` is the `h1`.
 *
 * ## It names its own landmark
 *
 * A bare `<section>` is **not** exposed as a landmark — it only becomes one once it
 * has an accessible name. Every page that wanted that was writing the pair by hand
 * (`<section aria-labelledby="faq">` … `<h2 id="faq">`), which makes every new section
 * a chance to forget one half or reuse an id already on the page. This wires it
 * itself with `useId`.
 *
 * `id` is kept separate from the heading's id on purpose: one is where you jump to
 * (`/#register`), the other is what names the region.
 *
 * ## There is no "accent word"
 *
 * A heading here is one colour. `<em>` inside a title renders as **muted**, which is
 * a genuine de-emphasis for a trailing clause — not a second colour. In this visual
 * language colour lives on `IconTile` and on status, never in a sentence; a heading
 * with a brightly-coloured phrase in it would be the loudest thing on a page whose
 * actions are near-black.
 */

export interface SectionProps {
  /**
   * The micro-label above the heading, rendered as a tinted pill. Worth omitting when
   * the heading already says what the block is — an eyebrow reading "Students" above
   * a heading reading "All students" is one label too many.
   */
  eyebrow?: ReactNode
  /** Phosphor glyph for the eyebrow pill. Decorative: the eyebrow carries the words. */
  eyebrowIcon?: string
  title: ReactNode
  /**
   * Heading level. Pick the one the document outline needs, not the one that looks
   * right — the size comes from `size`, not from the tag. A page whose outline jumps
   * from `h1` to `h3` is a page a screen-reader user cannot navigate.
   */
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4'
  /** The sentence under the heading. Set at the prose measure. */
  lead?: ReactNode
  /** Buttons or a filter. Beside the heading on desktop, under it on a phone. */
  actions?: ReactNode
  /**
   * `page` is a page's opening block (display sizing). `default` is a section inside
   * one. `compact` is a sub-block within a card.
   */
  size?: 'compact' | 'default' | 'page'
  /**
   * Vertical breathing room *around* the whole block.
   *
   * `none` (the default) leaves spacing to the parent, which is right inside a stack.
   * `block` and `section` apply the two fluid rhythm tokens, for a page that lays its
   * own sections out — the landing page and the public surfaces.
   */
  spacing?: 'none' | 'block' | 'section'
  /** Centres the header. For a marketing band; never for a page of controls. */
  align?: 'start' | 'center'
  /** A hairline under the header. For a dense administrative page, not a landing one. */
  divider?: boolean
  as?: ElementType
  id?: string
  className?: string
  children?: ReactNode
}

export default function Section({
  eyebrow,
  eyebrowIcon,
  title,
  titleAs: Heading = 'h2',
  lead,
  actions,
  size = 'default',
  spacing = 'none',
  align = 'start',
  divider,
  as: Tag = 'section',
  id,
  className,
  children,
}: SectionProps) {
  const headingId = useId()
  const classes = [
    styles.section,
    styles[`size-${size}`],
    styles[`spacing-${spacing}`],
    align === 'center' ? styles.center : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  /* Only a sectioning element becomes a landmark, so only those are named. Putting
     `aria-labelledby` on a `div` names nothing and adds an IDREF for no reader. */
  const isLandmark = Tag === 'section' || Tag === 'article' || Tag === 'aside' || Tag === 'nav'

  return (
    <Tag id={id} className={classes} aria-labelledby={isLandmark ? headingId : undefined}>
      <div className={divider ? styles.headWithDivider : styles.head}>
        <div className={styles.headText}>
          {eyebrow && (
            <p className={styles.eyebrow}>
              {eyebrowIcon && <Icon name={eyebrowIcon} weight="bold" size="xs" />}
              {eyebrow}
            </p>
          )}
          <Heading id={headingId} className={styles.title}>
            {title}
          </Heading>
          {lead && <p className={styles.lead}>{lead}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {children && <div className={styles.body}>{children}</div>}
    </Tag>
  )
}
