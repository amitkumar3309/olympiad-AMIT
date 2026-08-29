import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import styles from './Card.module.css'

/**
 * The surface everything sits on.
 *
 * The global `.card` class it supersedes is still defined (and modernised) in
 * `styles/utilities.css`, because the whole application uses it. This component is
 * what new code uses, and what it adds over a bare class is the *header*: every page
 * in this product has sections shaped "title, optional description, optional action
 * on the right, which stacks under the title on a phone", and each one had built that
 * by hand.
 *
 * `padding="none"` is for the case that matters most on mobile: a card wrapping a
 * table or a list, where the rows own their own horizontal padding and a card
 * inset would leave the scroll region floating inside a frame.
 */

type CardElement = 'div' | 'section' | 'article' | 'li' | 'form'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardElement
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** `sunken` for a nested panel, `plain` for a bordered box with no shadow. */
  tone?: 'default' | 'sunken' | 'plain'
  /** Adds a hover/focus treatment. Only for a card that is genuinely a link. */
  interactive?: boolean
  children?: ReactNode
}

export default function Card({
  as = 'div',
  padding = 'md',
  tone = 'default',
  interactive,
  className,
  children,
  ...rest
}: CardProps) {
  // `ElementType` rather than the literal union: a union of tag names makes the
  // spread props the *intersection* of every tag's attributes, which a `form` and a
  // `div` cannot both satisfy.
  const Tag = as as ElementType
  const classes = [
    styles.card,
    styles[`pad-${padding}`],
    styles[tone],
    interactive ? styles.interactive : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  )
}

export interface CardHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Buttons, a filter, a link. Sits right on desktop, below the title on mobile. */
  actions?: ReactNode
  /** Heading level. Pick the one the document outline needs, not the one that looks
      right — the size comes from `size`, not from the tag. */
  as?: 'h1' | 'h2' | 'h3' | 'h4'
  size?: 'sm' | 'md'
  className?: string
}

export function CardHeader({
  title,
  description,
  actions,
  as: Tag = 'h2',
  size = 'md',
  className,
}: CardHeaderProps) {
  return (
    <div className={[styles.header, className].filter(Boolean).join(' ')}>
      <div className={styles.headerText}>
        <Tag className={size === 'sm' ? styles.titleSm : styles.title}>{title}</Tag>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.body, className].filter(Boolean).join(' ')}>{children}</div>
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.footer, className].filter(Boolean).join(' ')}>{children}</div>
}
