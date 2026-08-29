import { humanizeError, isSessionExpired } from '../../lib/errors'
import Button, { ButtonLink } from './Button'
import EmptyState from './EmptyState'

/**
 * A page or panel that could not load.
 *
 * It takes the **thrown error**, not a string, and that is the point: the message the
 * reader sees is produced by `humanizeError()` rather than by whichever `catch` block
 * happened to write one. So a 500's internal text cannot reach a screen by accident —
 * the sanitising is structural, not remembered.
 *
 * `onRetry` renders a retry button. Offer it when retrying could genuinely work (a
 * failed fetch, a timeout, a 5xx) and omit it when it cannot (a 403, a 404) — a
 * button that reproduces the same failure teaches the reader that the product is
 * broken rather than that the request was refused.
 *
 * An expired session is special-cased: retrying is exactly wrong, so it offers the
 * sign-in page instead.
 */

export interface ErrorStateProps {
  /** Whatever was caught. */
  error: unknown
  /** Overrides the derived message. For when the page knows better than the status. */
  message?: string
  title?: string
  /** Passed through to `EmptyState`. `'h2'` when this error IS the page. */
  titleAs?: 'h1' | 'h2' | 'h3' | 'h4'
  onRetry?: () => void
  className?: string
}

export default function ErrorState({ error, message, title, titleAs, onRetry, className }: ErrorStateProps) {
  const expired = isSessionExpired(error)

  return (
    <EmptyState
      className={className}
      titleAs={titleAs}
      icon={expired ? 'ph-sign-in' : 'ph-warning-circle'}
      title={title ?? (expired ? 'Your session has ended' : 'This could not be loaded')}
      description={message ?? humanizeError(error)}
      action={
        expired ? (
          <ButtonLink to="/" variant="primary" icon="ph-sign-in">
            Go to sign in
          </ButtonLink>
        ) : onRetry ? (
          <Button variant="secondary" icon="ph-arrow-clockwise" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  )
}
