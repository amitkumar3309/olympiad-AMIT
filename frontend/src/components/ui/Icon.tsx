import styles from './Icon.module.css'

/**
 * The product's only icon.
 *
 * ## One library, one component
 *
 * Phosphor is the icon library, and it pre-dates this milestone — roughly 87 distinct
 * glyphs were already in use across the application, referenced as raw markup:
 * `<i className="ph-bold ph-target" />`. This component is the seam that turns that
 * scattered convention into a system. Nothing new should write the `<i>` by hand.
 *
 * Two reasons it is a component rather than a convention:
 *
 *  - **Accessibility is decided here, not remembered per site.** A decorative icon
 *    beside a text label must be hidden from a screen reader; an icon that *is* the
 *    label (an icon-only button) must carry one. Both are one prop away, and the
 *    default — `aria-hidden` — is the safe one, because a decorative glyph announced
 *    as "target" beside the word "Practice" is noise a sighted reader never hears.
 *  - **The library is swappable.** If Phosphor is ever replaced by SVG components,
 *    this file changes and the call sites do not.
 *
 * ## Weights
 *
 * `index.html` loads the **regular** and **bold** stylesheets only. A class naming
 * `ph-fill`, `ph-light`, `ph-thin` or `ph-duotone` matches no `@font-face`, so it
 * renders an invisible glyph — not a fallback, nothing. That is why the type admits
 * two weights and no more: the failure is silent, so it has to be unrepresentable.
 *
 * ## Sizing
 *
 * An icon font is sized by `font-size`, so an icon inherits the size of its
 * surrounding text unless told otherwise — which is usually what you want inside a
 * button or a heading. Pass a step (or a number, in px) when it should not.
 */

export type IconWeight = 'regular' | 'bold'

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'inherit' | number

export interface IconProps {
  /**
   * A Phosphor glyph name, with or without the `ph-` prefix: `'target'` and
   * `'ph-target'` are the same icon. Both are accepted because the pre-existing
   * navigation tables in the shells store the prefixed form.
   */
  name: string
  weight?: IconWeight
  /** `'inherit'` (the default) takes the size from the surrounding text. */
  size?: IconSize
  /**
   * The accessible name. Provide it when the icon carries meaning on its own — an
   * icon-only button, a status glyph in a table cell. Omit it when a text label sits
   * beside the icon, and the icon is then correctly hidden from assistive technology.
   */
  label?: string
  className?: string
}

const SIZE_CLASS: Record<string, string> = {
  xs: styles.xs,
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
  xl: styles.xl,
  '2xl': styles.xxl,
}

export default function Icon({
  name,
  weight = 'regular',
  size = 'inherit',
  label,
  className,
}: IconProps) {
  const glyph = name.startsWith('ph-') ? name : `ph-${name}`
  const weightClass = weight === 'bold' ? 'ph-bold' : 'ph'
  const sizeClass = typeof size === 'string' ? SIZE_CLASS[size] : undefined

  const classes = [styles.icon, weightClass, glyph, sizeClass, className].filter(Boolean).join(' ')

  return (
    <i
      className={classes}
      style={typeof size === 'number' ? { fontSize: `${size}px` } : undefined}
      // An icon with a name is an image with alternative text; one without is
      // decoration. There is no third case, and getting this wrong is the most
      // common icon accessibility defect there is.
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}
