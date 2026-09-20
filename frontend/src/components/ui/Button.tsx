import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import styles from './Button.module.css'

/**
 * The button.
 *
 * ## Compatibility
 *
 * This replaces the Milestone-2-era `components/Button.tsx`, which is now a re-export
 * of this file — forty pages import it, and every one of them keeps working. The old
 * props (`variant` of `primary | outline | danger | ghost`, and `fullWidth`) are all
 * still honoured, so those pages pick up the new treatment without being touched.
 *
 * ## Shape and colour (Milestone 26)
 *
 * **Every button is a pill, and the primary one is near-black.** Milestone 23 had
 * deliberately un-pilled them; the new visual language puts that back, and for a
 * better reason than fashion — cards, cells, inputs and tags here are all rectangles
 * with a modest radius, so a fully-rounded control is the one shape that can only be
 * an action.
 *
 * The `pill` prop is kept and still resolves to the same radius, so no call site
 * changed. It is simply no longer the thing that makes a button a pill.
 *
 * Hovering still does not lift the button. Pressing it moves it 1px — feedback for a
 * tap on a phone, where there was no hover state to confirm the target first.
 *
 * ## Loading
 *
 * `loading` disables the button, sets `aria-busy`, and swaps the leading icon for a
 * spinner **while keeping the label**. Replacing the label with a spinner makes the
 * button change width mid-click, which moves whatever is beside it.
 *
 * ## Icon-only
 *
 * An icon-only button has no text, so it has no accessible name unless it is given
 * one. The type makes `aria-label` mandatory in that case rather than trusting a
 * reviewer to notice — a row of unlabelled icon buttons is the most common
 * accessibility failure in an admin table.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'subtle' | 'ghost' | 'danger'

export type ButtonSize = 'sm' | 'md' | 'lg'

interface CommonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  /**
   * Retained for compatibility and now a no-op in appearance: every button is a pill
   * as of Milestone 26. Kept so the call sites that pass it do not have to change.
   */
  pill?: boolean
  /** Phosphor glyph name, drawn before the label. */
  icon?: string
  /** Phosphor glyph name, drawn after the label — a chevron, an external-link mark. */
  iconAfter?: string
  children?: ReactNode
  className?: string
}

function classesFor({
  variant = 'primary',
  size = 'md',
  fullWidth,
  pill,
  iconOnly,
  className,
}: CommonProps & { iconOnly?: boolean }) {
  return [
    styles.btn,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : '',
    pill ? styles.pill : '',
    iconOnly ? styles.iconOnly : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

function Inner({
  icon,
  iconAfter,
  loading,
  children,
}: Pick<CommonProps, 'icon' | 'iconAfter' | 'children'> & { loading?: boolean }) {
  return (
    <>
      {loading ? (
        <span className={styles.spinner} aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} weight="bold" />
      )}
      {children}
      {iconAfter && !loading && <Icon name={iconAfter} weight="bold" />}
    </>
  )
}

type ButtonOwnProps = CommonProps & {
  loading?: boolean
} & (
    | { iconOnly: true; 'aria-label': string; icon: string }
    | { iconOnly?: false }
  )

export type ButtonProps = ButtonOwnProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

export default function Button(props: ButtonProps) {
  const {
    variant,
    size,
    fullWidth,
    pill,
    icon,
    iconAfter,
    loading,
    iconOnly,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  } = props as ButtonProps & { iconOnly?: boolean }

  return (
    <button
      // An unspecified `type` inside a form is `submit`, which has silently submitted
      // forms from buttons that only meant to open a dialog. Default to `button` and
      // make submission explicit.
      type={type}
      className={classesFor({ variant, size, fullWidth, pill, iconOnly, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Inner icon={icon} iconAfter={iconAfter} loading={loading}>
        {children}
      </Inner>
    </button>
  )
}

type ButtonLinkProps = CommonProps &
  (
    | ({ to: string; href?: never } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className'>)
    | ({ href: string; to?: never } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className'>)
  )

/**
 * A link that looks like a button.
 *
 * It exists because a navigation control must be an `<a>`: middle-click, ctrl-click,
 * "copy link" and a screen reader's link list all depend on it, and a `<button>` with
 * an `onClick` that calls `navigate()` has none of them. Pages had been styling
 * `<Link>` with a private `.btn` class each time; this is that pattern, once.
 *
 * `to` routes internally through React Router; `href` renders a plain anchor for an
 * external destination or a download.
 */
export function ButtonLink(props: ButtonLinkProps) {
  const { variant, size, fullWidth, pill, icon, iconAfter, className, children, to, href, ...rest } =
    props as ButtonLinkProps & { to?: string; href?: string }

  const classes = classesFor({ variant, size, fullWidth, pill, className })
  const inner = (
    <Inner icon={icon} iconAfter={iconAfter}>
      {children}
    </Inner>
  )

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {inner}
      </Link>
    )
  }

  return (
    <a href={href} className={classes} {...rest}>
      {inner}
    </a>
  )
}
