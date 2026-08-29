import { Link } from 'react-router-dom'
import { ButtonLink, Icon } from './ui'
import styles from './EntryFeeRequired.module.css'

/**
 * What an unpaid student sees where a paid one would see practice, a mock test, the
 * daily challenge or the exam.
 *
 * Deliberately **not** a redirect to `/payment`. Bouncing somebody out of the page they
 * asked for reads as a bug, and it hides what they were reaching for — which is the one
 * thing that makes paying feel worth it. So the page stays, and this explains what is
 * behind it.
 *
 * Also deliberately not the `Unauthorized` screen: "you may not" and "not yet, and here
 * is the button" are different messages, and the second one has an action attached.
 */
export default function EntryFeeRequired({ feature }: { feature: string }) {
  return (
    <div className={`card ${styles.wrap}`}>
      <Icon name="ph-lock-simple" weight="bold" size="xl" className={styles.icon} />
      <h2 className={styles.title}>{feature} unlocks when you enter</h2>
      <p className={styles.body}>
        The Olympiad entry fee is a single payment for your seat in the national competition. Practice, mock tests and
        the daily challenge are free — you can keep preparing either way, and pay whenever you are ready to compete.
      </p>

      <ButtonLink to="/payment" size="lg" icon="ph-currency-inr" className={styles.cta}>
        Pay the entry fee
      </ButtonLink>

      <p className={styles.foot}>
        Already paid? <Link to="/payment">Open the payment page</Link> and we will check with the provider and confirm
        it.
      </p>
    </div>
  )
}
