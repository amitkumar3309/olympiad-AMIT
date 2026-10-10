import { ArrowRight } from 'lucide-react'
import { Button, ButtonLink } from '../../../components/ui'
import { AMIT_TAGLINE } from '../../../lib/brand'
import { useReveal } from '../motion'
import styles from '../Landing.module.css'

/**
 * "Ready to sit the paper?" — the closing call to action (brief §7.1 #11). A signed-in
 * student is already registered, so they are offered their dashboard instead.
 *
 * Since 2026-10-09 a quiet, centred band on the hero's graph paper — the tagline, the question and
 * the two actions — where a placeholder picture and a handwritten line stood. It rises into place
 * once, when it is scrolled to (`useReveal`).
 */
export interface FinalCtaProps {
  signedIn: boolean
  /** A signed-in administrator: the link goes to the admin panel. */
  staff?: boolean
  registerTo: string
  onSignIn: () => void
}

export default function FinalCta({ signedIn, staff = false, registerTo, onSignIn }: FinalCtaProps) {
  const reveal = useReveal<HTMLDivElement>({ selector: null, rise: 24 })
  return (
    <section className={`container ${styles.section}`} aria-labelledby="cta-title">
      <div ref={reveal} className={styles.cta}>
        <p className={styles.ctaEyebrow}>{AMIT_TAGLINE}</p>
        <h2 id="cta-title">Ready to sit the paper?</h2>
        <p className={styles.ctaLead}>Registering is free, and you can practise the same day.</p>
        <div className={styles.ctaActions}>
            {signedIn ? (
              <ButtonLink to={staff ? '/admin' : '/dashboard'} size="lg" variant="brand" iconAfter={<ArrowRight size={18} aria-hidden="true" />}>
                {staff ? 'Go to the admin panel' : 'Go to your dashboard'}
              </ButtonLink>
            ) : (
              <>
                <ButtonLink to={registerTo} size="lg" variant="brand" iconAfter={<ArrowRight size={18} aria-hidden="true" />}>
                  Register now
                </ButtonLink>
                <Button size="lg" variant="secondary" onClick={onSignIn}>
                  I already have an account
                </Button>
              </>
            )}
        </div>
      </div>
    </section>
  )
}
