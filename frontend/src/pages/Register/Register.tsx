import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import { api } from '../../api/client'
import type { ReferralCheck } from '../../api/types'
import { roleHome } from '../../lib/roleHome'
import LoginDialog from '../Auth/LoginDialog'
import RegisterForm from '../Auth/RegisterForm'
import styles from './Register.module.css'

/**
 * Registration, on a route of its own (Milestone 28).
 *
 * ## Why it moved off the landing page
 *
 * It used to be a `<section id="register">` near the bottom of the marketing page, and
 * `/register` rendered that same page and scrolled to it. That worked, but it meant the
 * only way to reach the form was to load the entire landing page — every feature card,
 * the leaderboard request, the public stats request — and then jump past all of it. A
 * person who has decided to register does not need to be sold to again on the way.
 *
 * The owner asked for it to be its own page; this is that page. The form itself did not
 * move and was not rewritten: `pages/Auth/RegisterForm` is the same component the
 * landing page rendered, which is why this file is short.
 *
 * ## `?ref=` still has to work here
 *
 * `referralLinkFor()` on the backend builds `<app>/register?ref=<code>`, so this route
 * is the **destination of every referral link in the product** — that is why `/register`
 * was declared in the first place (Milestone 22, Phase F, after the links were found to
 * render a blank page). The validation that used to live on the landing page lives here
 * now, unchanged in behaviour:
 *
 * The code is checked against the server *before* the form is submitted and the outcome
 * is shown **either way**. Both directions matter. A good code gets a "referred by" line
 * so the student knows the link worked. A bad one is dropped **visibly**, because the
 * backend refuses the whole registration on a code that does not resolve — losing
 * somebody's registration over a friend's typo would be the worst behaviour available
 * here.
 */
export default function Register() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  /** `null` while it is being checked, and for anybody who arrived without a code. */
  const [referral, setReferral] = useState<ReferralCheck | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    const code = searchParams.get('ref')?.trim()
    if (!code) return

    void api
      .get<ReferralCheck>(`/referrals/validate?code=${encodeURIComponent(code)}`)
      .then(setReferral)
      // A malformed code is a 400 from the schema. Recorded as invalid rather than
      // swallowed, so the banner still tells the student it will not be applied.
      .catch(() => setReferral({ valid: false, code: code.toUpperCase(), referrerName: null }))
  }, [searchParams])

  return (
    <div className={styles.page}>
      <Navbar />

      <main id="main-content" className={`container ${styles.wrap}`}>
        {/*
          The page's own `h1`. `RegisterForm` heads each wizard step with an `h2`
          ("Create your account", "One last check", "Check your email"), so without
          this the document would start at `h2` — the defect Milestone 23 Phase G
          found on seventeen routes and on the 404 page.
        */}
        <h1 className={styles.title}>Register</h1>
        <p className={styles.lead}>Free to join. Confirm your email address and you can start practising.</p>

        <RegisterForm referral={referral} onRequestLogin={() => setLoginOpen(true)} />
      </main>

      <Footer />

      {/*
        Offered after the account exists, so somebody who has just registered can sign
        in without going looking for the homepage. It is the same one dialog the rest of
        the product uses — not a second sign-in form — and it redirects by role for the
        reason given in `lib/roleHome.ts`.
      */}
      <LoginDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSignedIn={(role) => navigate(roleHome(role))}
      />
    </div>
  )
}
