import { Link } from 'react-router-dom'
import { AMIT_OLYMPIAD, SUPPORT } from '../../lib/brand'
import LegalLayout from './LegalLayout'

/**
 * Privacy Policy (Milestone 30, Phase 3 — brief §10).
 *
 * TODO(legal-review): a **draft**, written from what the code collects and does — every
 * field below is one the registration form, the profile or the quiz really stores. The
 * users are minors, and India's Digital Personal Data Protection Act, 2023 asks for
 * verifiable parental consent for under-18s; this page is a minimum, not a legal
 * guarantee. Open questions (the organiser's legal name and address, how long data is
 * kept, a grievance officer) are listed in `docs/launch/LEGAL_REVIEW.md`.
 *
 * Phase 6 changed §2 only to keep it true: registration now asks for a parent or guardian's
 * phone or email and records when they agreed (`guardianConsentAt`). The wording of that
 * addition is part of the review (LEGAL_REVIEW.md, question 8).
 */
export default function Privacy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      lead={`What ${AMIT_OLYMPIAD} collects about students, why, and the choices you have.`}
      updated="6 October 2026"
    >
      <h2>1. Who this is for</h2>
      <p>
        Our users are students of Classes 3 to 12, most of them under 18. A student under 18 should register with the
        permission of a parent or guardian, and a parent or guardian may contact us about their child’s account at any
        time.
      </p>

      <h2>2. What we collect</h2>
      <ul>
        <li>
          <strong>When you register:</strong> the student’s name, father’s and mother’s names, date of birth, class,
          school, address, mobile number, email address and a photograph, and a password (stored only in a scrambled,
          one-way form we cannot read). Also a parent or guardian’s phone number or email address, and the date and time
          they agreed to the registration, kept as the record of their consent.
        </li>
        <li>
          <strong>If you add them in My Profile:</strong> your city, and a parent or guardian’s phone number and email
          address if you did not give both when you registered. A parent or guardian’s contact details are used only to
          verify and deliver a Daily Quiz prize.
        </li>
        <li>
          <strong>When you use the site:</strong> your answers in practice, mock tests, the Daily Quiz and the Olympiad;
          your scores, XP, streaks and badges; and, for each Daily Quiz attempt, a scrambled (hashed) form of your
          internet address and your browser’s name, used only to review prize winners fairly.
        </li>
        <li>
          <strong>When you pay the Olympiad entry fee:</strong> the payment is handled by Razorpay. We keep the order
          and payment reference, the amount and whether it succeeded — never your card or bank details.
        </li>
      </ul>

      <h2>3. Why we use it</h2>
      <ul>
        <li>to run your account, mark your answers and show your progress;</li>
        <li>to send emails you need — verifying your address, resetting a password, results and prize news;</li>
        <li>to run the Olympiad, issue certificates and decide Daily Quiz winners;</li>
        <li>to keep the site safe and to stop cheating and duplicate accounts.</li>
      </ul>
      <p>We do not sell personal data, and we do not show advertising.</p>

      <h2>4. What is public</h2>
      <p>
        Leaderboards, the Hall of Fame and the list of Daily Quiz winners show a student’s first name and last initial,
        with class and city or school — never contact details, a full name or a photo. Other students only ever see
        initials, not your photograph. You can hide your name from all public lists in{' '}
        <Link to="/profile">My Profile</Link>, and you will then appear only as, for example, “A Class 7 student”.
      </p>

      <h2>5. Who else handles it</h2>
      <p>
        We use trusted services to run the site: website hosting, a database, an email-sending service and Razorpay for
        payments. They process data only to provide those services to us. Our question-writing tools never receive any
        student’s information.
      </p>

      <h2>6. Cookies</h2>
      <p>
        We use only the cookies needed to keep you signed in. Your browser also remembers a few settings on your own
        device, such as your light or dark theme. We use no advertising or tracking cookies.
      </p>

      <h2>7. Your choices</h2>
      <ul>
        <li>See and correct most of your details in My Profile.</li>
        <li>Hide your name from public lists in My Profile.</li>
        <li>
          Ask us for a copy of your data, to correct something you cannot change yourself, or to delete your account,
          by writing to <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a>. Official Olympiad results and
          certificates already issued may need to be kept as a record.
        </li>
      </ul>

      <h2>8. Keeping it safe</h2>
      <p>
        Passwords are stored scrambled, connections are encrypted, and staff access is limited to the people who run
        the Olympiad, with their actions recorded.
      </p>

      <h2>9. Changes</h2>
      <p>If we change this policy we will update this page and the date at the top.</p>
    </LegalLayout>
  )
}
