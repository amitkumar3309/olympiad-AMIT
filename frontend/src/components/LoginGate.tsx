import { Link } from 'react-router-dom'
import { Gift, Trophy } from 'lucide-react'
import type { QuizPrizeInfo } from '../api/types'
import { prizeLine } from '../lib/dailyQuizCopy'
import { Button, ButtonLink, Modal } from './ui'
import styles from './LoginGate.module.css'

/**
 * The Login Gate (Milestone 30, Phase 3 — the owner's R5, brief §7.3).
 *
 * A guest who presses the floating Daily Quiz button, or any "Play today's quiz" on the
 * homepage, meets this rather than the quiz: their answer and whether it was right are
 * saved to **their** profile, so they need one. It is a `Modal`, which is a bottom sheet
 * on a phone, traps focus and closes on Escape.
 *
 * **It is only a doorway.** The quiz route is protected by the server, not by this; both
 * buttons carry `next=/daily-quiz` so the student lands on the quiz after signing in — and
 * after registering and verifying their email, because the destination rides in the link.
 *
 * The prize line comes from the server's settings (`GET /daily-quiz/info`), so this never
 * promises a gift or an amount the owner has not set. Until it loads the line is omitted
 * rather than guessed.
 */

export interface LoginGateProps {
  open: boolean
  onClose: () => void
  /** Opens the sign-in dialog, keeping `/daily-quiz` as the destination. */
  onSignIn: () => void
  /** `/register?next=%2Fdaily-quiz` (plus any referral code). */
  registerTo: string
  prize: QuizPrizeInfo | null
}

export default function LoginGate({ open, onClose, onSignIn, registerTo, prize }: LoginGateProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log in to play today’s Daily Quiz"
      description="Your answer and result are saved to your profile."
      size="sm"
      footer={
        <>
          <ButtonLink to={registerTo} variant="secondary">
            Create free account
          </ButtonLink>
          <Button onClick={onSignIn}>Sign in</Button>
        </>
      }
    >
      <div className={styles.body}>
        {prize && (
          <p className={styles.prize}>
            <span className={styles.prizeIcon} aria-hidden="true">
              <Gift size={20} strokeWidth={2.25} />
            </span>
            <span>
              <strong>Each day’s winner gets:</strong> {prizeLine(prize)}
            </span>
          </p>
        )}
        <p className={styles.note}>
          <Trophy size={16} strokeWidth={2.25} aria-hidden="true" className={styles.noteIcon} />
          <span>
            One question a day for your class.{' '}
            <Link to="/rewards/rules" className={styles.link} onClick={onClose}>
              How rewards work
            </Link>
          </span>
        </p>
      </div>
    </Modal>
  )
}
