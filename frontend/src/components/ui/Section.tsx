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
 * `.kicker`, `.eyebrow`, and about thirty more, across fourteen thousand lines of
 * page CSS. They mostly agreed, which is worse than disagreeing: nobody could tell
 * whether a difference was a decision. This is that pattern, once.
 *
 * ## It is also the page header
 *
 * There is deliberately **no separate `PageHeader`**. A page's opening block and a
 * section inside it are the same shape at two sizes, and shipping two components for
 * that is how a design system starts growing near-duplicates. Pass `titleAs="h1"` and
 * `size="page"` and this is a page header.
 *
 * Inside `AppShell` the `h1` already lives in the topbar, so a section on a signed-in
 * page is an `h2` — the default. On a public page that renders its own chrome
 * (`/leaderboard`, `/gallery`, `/verify`), the first `Section` is the `h1`.
 *
 * ## The accent word
 *
 * Wrap one phrase of the title in `<em>` and it takes the accent colour, upright:
 *
 *     title={<>Four ways to prepare, <em>all of them free</em></>}
 *
 * A prop is deliberately not offered. The emphasis belongs *inside* the sentence, and
 * an `accentWord` string prop would either have to find the phrase (fragile) or force
 * the title to be split into three pieces at every call site. `<em>` is already the
 * element that means "stressed emphasis", so the markup stays meaningful with the
 * stylesheet turned off.
 *
 * **One phrase per heading.** Two accent phrases is no accent at all.
 *
 * ## It names its own landmark
 *
 * A bare `<section>` is **not** exposed as a landmark — it only becomes one once it
 * has an accessible name. Every page that wanted that was writing the pair by hand
 * (`<section aria-labelledby="faq">` … `<h2 id="faq">`), which means every new section
 * is a chance to forget one half, or to reuse an id that is already on the page.
 *
 * This wires it itself with `useId`, so a section rendered as `section` or `article`
 * is always a named landmark and the id is always unique. Pass `id` for a link target
 * (`/#register`); it is kept separate from the heading's id on purpose, because they
 * are different things — one is where you jump to, the other is what names the region.
 */

export interface SectionProps {
  /**
   * The micro-label above the heading, rendered as a tinted pill. Optional, and worth
   * omitting when the heading already says what the block is — an eyebrow reading
   * "Students" above a heading reading "All students" is one label too many.
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
  /** The sentence under the heading. Set at the prose measure and loose leading. */
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
