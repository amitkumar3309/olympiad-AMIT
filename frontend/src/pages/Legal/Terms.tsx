import { Link } from 'react-router-dom'
import { AMIT_OLYMPIAD, SUPPORT } from '../../lib/brand'
import LegalLayout from './LegalLayout'

/**
 * Terms of Use (Milestone 30, Phase 3 — brief §10).
 *
 * TODO(legal-review): a **draft** describing how the product actually works. It names no
 * governing law, jurisdiction or organiser entity — those are the owner's to supply (see
 * `docs/launch/LEGAL_REVIEW.md`) and are not guessed here.
 */
export default function Terms() {
  return (
    <LegalLayout
      title="Terms of Use"
      lead={`The rules for using the ${AMIT_OLYMPIAD} website.`}
      updated="4 October 2026"
    >
      <h2>1. Using the site</h2>
      <p>
        By registering or using this website you agree to these terms. A student under 18 should use it with the
        permission of a parent or guardian, who is responsible for that permission.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>One account per student, with true details. You must verify your email address before you can sign in.</li>
        <li>Keep your password to yourself. You are responsible for what happens on your account.</li>
        <li>We may suspend an account that breaks these terms, for example one created with false details.</li>
      </ul>

      <h2>3. What is free, and what is paid</h2>
      <p>
        Practice, mock tests and the Daily Quiz are free. The official Olympiad has an entry fee, and the amount is shown
        in full before you pay. See <Link to="/refunds">Refund &amp; Cancellation</Link>.
      </p>

      <h2>4. The Olympiad</h2>
      <ul>
        <li>Each student may sit the Olympiad once, online, in the window the organisers announce.</li>
        <li>Answers are marked by our server. Ranks and certificates are issued when results are released.</li>
        <li>Certificates can be checked by anyone at <Link to="/verify">Verify a certificate</Link>.</li>
      </ul>

      <h2>5. The Daily Quiz and prizes</h2>
      <p>
        The Daily Quiz and its prizes follow the <Link to="/rewards/rules">Daily Quiz &amp; Rewards Rules</Link>.
      </p>

      <h2>6. Fair use</h2>
      <ul>
        <li>Do not try to break, overload or get around the website’s security.</li>
        <li>Do not copy and republish our questions, solutions or papers.</li>
        <li>Be respectful in anything you send us.</li>
      </ul>

      <h2>7. Our content</h2>
      <p>
        The questions, solutions, papers and design of this website belong to the organisers of the {AMIT_OLYMPIAD}.
        You may use them for your own preparation.
      </p>

      <h2>8. Availability and changes</h2>
      <p>
        We work to keep the site running but cannot promise it will never be interrupted. We may change these terms; if
        we do, we will update this page and the date at the top.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a>.
      </p>
    </LegalLayout>
  )
}
