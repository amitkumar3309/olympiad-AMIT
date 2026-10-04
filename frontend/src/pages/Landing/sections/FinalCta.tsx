import { ArrowRight } from 'lucide-react'
import Illustration from '../../../components/Illustration'
import { Button, ButtonLink } from '../../../components/ui'
import styles from '../Landing.module.css'

/**
 * "Ready to sit the paper?" — the closing call to action (brief §7.1 #11). A signed-in
 * student is already registered, so they are offered their dashboard instead.
 */
export interface FinalCtaProps {
  signedIn: boolean
  registerTo: string
  onSignIn: () => void
}

export default function FinalCta({ signedIn, registerTo, onSignIn }: FinalCtaProps) {
  return (
    <section className={`container ${styles.section}`} aria-labelledby="cta-title">
      <div className={styles.cta}>
        <div className={styles.ctaArt} aria-hidden="true">
          <Illustration name="mountain-climber" />
        </div>
        <div className={styles.ctaCopy}>
          <h2 id="cta-title">Ready to sit the paper?</h2>
          <p>Registering is free, and you can practise the same day.</p>
          <div className={styles.ctaActions}>
            {signedIn ? (
              <ButtonLink to="/dashboard" size="lg" variant="brand" iconAfter={<ArrowRight size={18} aria-hidden="true" />}>
                Go to your dashboard
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
        {/* The second handwritten accent (Caveat). Decoration: the heading says it all. */}
        <p className={styles.ctaHand} aria-hidden="true">
          Same questions, bigger thinking
        </p>
      </div>
    </section>
  )
}
