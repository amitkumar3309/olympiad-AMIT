import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { QuizPrizeInfo } from '../../api/types'
import { bandsSentence, prizeLine } from '../../lib/dailyQuizCopy'
import { AMIT_OLYMPIAD, SUPPORT } from '../../lib/brand'
import LegalLayout from './LegalLayout'
import styles from './Legal.module.css'

/**
 * The Daily Quiz & Rewards Rules (Milestone 30, Phase 3 — brief §7.5).
 *
 * TODO(legal-review): a draft from the brief's list and from what the code enforces. It
 * must be reviewed by the owner before launch — `docs/launch/LEGAL_REVIEW.md`.
 *
 * ## The rule and the prize are the server's words
 *
 * "How winners are chosen" is the sentence the server generates from the same constants
 * its monthly ranking reads (`describeWinnerRule()` — one winner a month in each class band,
 * the owner's rule since 2026-10-09, PLAN.md Q24), and the prize line is the owner's
 * own wording from Admin → Daily Quiz → Settings. Both are fetched, never typed here, so
 * this page cannot drift from what actually happens. Until they load, those two passages
 * say so rather than guess.
 *
 * Everything else is a fact the code enforces: one attempt (a unique index), the IST
 * window, the reveal at the next midnight, verification and admin approval before any
 * winner is public, and the shared-connection flag being a prompt for review, never an
 * automatic disqualification.
 */
export default function RewardsRules() {
  const [info, setInfo] = useState<QuizPrizeInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ info: QuizPrizeInfo }>('/daily-quiz/info')
      .then((res) => {
        if (!cancelled) setInfo(res.info)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const loading = !info && !failed

  return (
    <LegalLayout
      title="Daily Quiz & Rewards Rules"
      lead={`How the ${AMIT_OLYMPIAD} Daily Quiz works, who can win, and how prizes are given.`}
      updated="11 October 2026"
    >
      <h2>1. Who can take part</h2>
      <p>
        The Daily Quiz is open to registered students of Classes 3 to 12 in India. Students under 18 take part with the
        permission of a parent or guardian. Taking part is free — no payment is needed to play or to win.
      </p>

      <h2>2. One account per student</h2>
      <p>
        Each student may have one account. Registering more than one account, or playing on somebody else’s, is not
        allowed and makes a student ineligible for prizes.
      </p>

      <h2>3. The quiz</h2>
      <ul>
        <li>There is one quiz a day for every class, from Class 3 to Class 12.</li>
        <li>
          Prizes are monthly: one winner each month in each class band — {bandsSentence(info?.bands)}. Section 4 says
          how the winner is chosen.
        </li>
        <li>Each quiz is open from 12:00 AM to 11:59:59 PM India Standard Time (IST) on its day.</li>
        <li>
          You get <strong>one attempt</strong>. Your time is measured by our server from when you press Start to when
          your answer reaches us.
        </li>
        <li>
          {info && !info.instantResult
            ? 'Whether you were right is shown when the answer unlocks.'
            : 'You see straight away whether you were right.'}{' '}
          The correct answer and the full solution unlock at 12:00 AM IST the next day, in your profile’s Daily Quiz
          history.
        </li>
        <li>Looking things up is your choice: the quiz is not proctored.</li>
      </ul>

      <h2>4. How winners are chosen</h2>
      <p className={styles.fromSettings}>
        {info
          ? info.howWinnersAreChosen
          : loading
            ? 'Loading the current rule…'
            : 'The current rule could not be loaded just now. Please refresh this page.'}
      </p>
      <p>
        You can check and complete the details a winner needs in <Link to="/profile">My Profile</Link>.
      </p>

      <h2>5. Prizes</h2>
      <p className={styles.fromSettings}>
        {info
          ? `Each month’s winner in each class band receives: ${prizeLine(info)}.`
          : loading
            ? 'Loading the current prize…'
            : 'The current prize could not be loaded just now. Please refresh this page.'}
      </p>
      <ul>
        <li>Prizes are delivered to the winner’s parent or guardian, after we have verified the winner’s details.</li>
        <li>Prizes cannot be transferred to another person or exchanged.</li>
        <li>Any tax that applies to a prize is handled as the law requires.</li>
      </ul>

      <h2>6. When winners are announced</h2>
      <p>
        After each month ends, our team reviews the result. A winner is shown on the website — as a first name and last
        initial, with class and city or school — only after that review, early the following month, and is told on
        their dashboard and by email. A student who has chosen to hide their name from public lists is shown only by
        class.
      </p>

      <h2>7. Checks and disqualification</h2>
      <p>
        We may check any winner’s details before a prize is given. We may disqualify an entry that breaks these rules —
        for example, more than one account for one student, or false details. Several students sharing one internet
        connection (a family, a school) is normal, and on its own is never a reason to disqualify anybody.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may change or end the Daily Quiz or its prizes. If we do, we will say so on this page and on the website
        before the change takes effect.
      </p>

      <h2>9. Contact</h2>
      <p>
        For anything about the Daily Quiz or a prize, write to <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a>.
      </p>
    </LegalLayout>
  )
}
