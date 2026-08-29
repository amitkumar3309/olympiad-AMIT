import { Link } from 'react-router-dom'
import { Icon } from './ui'
import styles from './Unauthorized.module.css'

/**
 * Shown when a signed-in user reaches something they may not use. Distinct from a
 * redirect on purpose: silently bouncing an authenticated user looks like a broken
 * link, whereas this says plainly that the session is fine and the permission is not.
 */
export default function Unauthorized({
  title = 'You do not have access to this page',
  detail = 'Your account does not hold the permission this page requires. If you believe this is a mistake, ask an administrator to review your access.',
}: {
  title?: string
  detail?: string
}) {
  return (
    <div className={styles.wrap} role="alert" aria-live="polite">
      <div className={`card ${styles.card}`}>
        <Icon name="ph-lock-key" weight="bold" className={styles.icon} />
        <h2>{title}</h2>
        <p>{detail}</p>
        <Link to="/" className={styles.link}>
          Back to home
        </Link>
      </div>
    </div>
  )
}
