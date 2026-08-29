import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Button from '../../components/Button'
import { api } from '../../api/client'
import type { LeaderboardRow, PublicStats, ReferralCheck } from '../../api/types'
import { AMIT_FULL_FORM } from '../../lib/brand'
import LoginDialog from '../Auth/LoginDialog'
import RegisterForm from '../Auth/RegisterForm'
import styles from './Landing.module.css'

const MEDALS = ['🥇', '🥈', '🥉']

const FAQS = [
  { q: 'Who can participate?', a: 'Students from Class 3 to Class 12, across any school board, can register for the Olympiad.' },
  { q: 'Is there negative marking?', a: 'No — there is no negative marking. Attempt every question with confidence.' },
  { q: 'How will results be announced?', a: 'Results are published on your personal dashboard within 48 hours of your exam.' },
]

export default function Landing() {
  const navigate = useNavigate()

  // Real public figures. Both are best-effort: the landing page must still render if
  // the API is unreachable, so a failure leaves them empty rather than blocking the
  // registration form behind an error screen.
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [champions, setChampions] = useState<LeaderboardRow[] | null>(null)

  /**
   * The referral code from `?ref=` on the link they followed (Milestone 22, Phase F).
   *
   * Checked against the server before it is used, and the outcome is **shown either way**.
   * That matters in both directions: a good code gets a "referred by" line so the student
   * knows the link worked, and a bad one is dropped *visibly* — because the backend refuses
   * the whole registration on a code that does not resolve, and losing somebody's
   * registration over a friend's typo would be the worst possible behaviour here.
   *
   * `null` while it is being checked, and for a visitor who arrived without one.
   */
  const [referral, setReferral] = useState<ReferralCheck | null>(null)
  const [searchParams] = useSearchParams()
  const { pathname, hash } = useLocation()

  const [loginOpen, setLoginOpen] = useState(false)

  /**
   * Somebody who followed a referral link came to register, so put them at the form.
   *
   * Scoped to `/register` rather than to the presence of `?ref=`, so an ordinary visit to
   * the landing page still starts at the hero.
   *
   * **Instant, not smooth.** A smooth scroll reads better, but its failure mode is that
   * nothing happens at all — and it is exactly what fails in environments that do not run
   * scroll animations, including the browser this was verified in. Landing on the form is
   * the point; the animation is decoration, and decoration is not worth a feature that
   * silently does not work. It also means somebody who has asked for reduced motion is not
   * given an animation they did not want.
   */
  useEffect(() => {
    if (pathname !== '/register') return
    // After the first paint, or the section is not laid out yet and the scroll goes nowhere.
    const timer = window.setTimeout(
      () => document.getElementById('register')?.scrollIntoView({ behavior: 'auto', block: 'start' }),
      120,
    )
    return () => window.clearTimeout(timer)
  }, [pathname])

  /**
   * `/#login` and `/#register`, which the header and footer link to (Milestone 23,
   * Phase B).
   *
   * The sign-in form is a panel on this page rather than a route of its own, so before
   * this there was **no way to ask for it from anywhere else in the product** — a
   * visitor on the leaderboard had to find their way back to the hero and hunt for the
   * button. The hash is the smallest thing that fixes it without inventing a `/login`
   * route and a second form.
   *
   * `hash` is a dependency, so following the same link twice from two pages works;
   * `scrollIntoView` is instant here for the reason the note above gives.
   */
  useEffect(() => {
    if (hash === '#login') {
      // Opening it is all this has to do: the dialog moves focus to its first field
      // itself, the same way it does when the hero button opens it.
      setLoginOpen(true)
      return
    }
    if (hash === '#register') {
      const timer = window.setTimeout(
        () => document.getElementById('register')?.scrollIntoView({ behavior: 'auto', block: 'start' }),
        120,
      )
      return () => window.clearTimeout(timer)
    }
  }, [hash])

  /**
   * Closing also clears the `#login` hash.
   *
   * Without that, the URL stays at `/#login` after the dialog is dismissed — and the
   * next press of Sign in, in the header or the footer, links to the same hash, which
   * is not a change, so the effect above never runs and nothing opens. Found in the
   * browser: close it once and the button is dead for the rest of the visit.
   */
  function closeLogin() {
    setLoginOpen(false)
    if (hash === '#login') navigate(pathname, { replace: true })
  }

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

  useEffect(() => {
    void api
      .get<{ stats: PublicStats }>('/public/stats')
      .then((res) => setStats(res.stats))
      .catch(() => setStats(null))
    void api
      .get<{ leaderboard: LeaderboardRow[] }>('/leaderboard?limit=3')
      .then((res) => setChampions(res.leaderboard))
      .catch(() => setChampions([]))
  }, [])

  return (
    <div>
      <Navbar />

      <section className={styles.hero}>
        <div className={`container ${styles.heroInner}`}>
          <span className={styles.kicker}>🌟 National Level Mathematics Competition</span>
          <h1>AMIT MATHS OLYMPIAD 2027</h1>
          {/* The expansion, directly under the name it expands. Nowhere else on this page. */}
          <p className={styles.fullForm}>{AMIT_FULL_FORM}</p>
          <p className={styles.tagline}>Think Faster. Solve Smarter. Become a Champion.</p>
          <div className={styles.heroActions}>
            {/*
              `behavior: 'auto'`, not `'smooth'`: a smooth scroll silently does nothing
              in environments that do not animate, and landing on the form is the point.
              The same reasoning as the `/register` effect above.
            */}
            <Button
              size="lg"
              iconAfter="ph-arrow-right"
              onClick={() => document.getElementById('register')?.scrollIntoView({ behavior: 'auto', block: 'start' })}
            >
              Register now
            </Button>
            <Button size="lg" variant="outline" icon="ph-sign-in" onClick={() => setLoginOpen(true)}>
              Student sign in
            </Button>
          </div>
        </div>
      </section>

      {/* Real counts, or nothing at all — never a placeholder headline number. */}
      {stats && (
        <section className={`container ${styles.stats}`}>
          <div className="card">
            <div className={styles.statValue}>{stats.studentsRegistered.toLocaleString()}</div>
            <div className={styles.statLabel}>Students Registered</div>
          </div>
          <div className="card">
            <div className={styles.statValue}>{stats.registeredToday.toLocaleString()}</div>
            <div className={styles.statLabel}>Registered Today</div>
          </div>
          <div className="card">
            <div className={styles.statValue}>{stats.studentsActiveToday.toLocaleString()}</div>
            <div className={styles.statLabel}>Active Today</div>
          </div>
          <div className="card">
            <div className={styles.statValue}>{stats.schoolsRepresented.toLocaleString()}</div>
            <div className={styles.statLabel}>Schools Represented</div>
          </div>
        </section>
      )}

      <section className={`container ${styles.section}`}>
        <h2>🏆 Top Scholars</h2>
        <p>The highest XP earned so far, straight from the leaderboard</p>
        {champions === null ? (
          <p className={styles.championMeta}>Loading the leaderboard…</p>
        ) : champions.length === 0 ? (
          <div className="card">
            <p>
              No one is on the leaderboard yet. Register below, and you could be the first name here.
            </p>
          </div>
        ) : (
          <div className={styles.championGrid}>
            {champions.map((row, index) => (
              <div className="card" key={row.studentId}>
                <div className={styles.championRank}>{MEDALS[index] ?? `#${row.rank}`}</div>
                {/* The API publishes a first name and a last initial only — these are
                    schoolchildren and this page is public. */}
                <h3>{row.displayName}</h3>
                {row.schoolName && <p>{row.schoolName}</p>}
                <p className={styles.championMeta}>
                  {row.classLevel ? `${row.classLevel} · ` : ''}Rank #{row.rank}
                </p>
                <span className={styles.badge}>👑 {row.xp.toLocaleString()} XP</span>
              </div>
            ))}
          </div>
        )}
        {/* The top three are a taste of the standing; the full board is public too, and
            can be filtered by class and by period. */}
        <p className={styles.championMeta}>
          <Link to="/leaderboard">See the full leaderboard</Link> · <Link to="/hall-of-fame">Hall of Fame</Link>
        </p>
      </section>

      <section id="register" className={`container ${styles.section}`}>
        {/*
          The form itself lives in `pages/Auth/RegisterForm` (Milestone 23, Phase C).
          This page is a marketing surface that contains it; the two were one 749-line
          file, and neither could be read without the other.
        */}
        <RegisterForm referral={referral} onRequestLogin={() => setLoginOpen(true)} />
      </section>

      <section className={`container ${styles.section}`}>
        <h2>Frequently Asked Questions</h2>
        {FAQS.map((f) => (
          <details className={styles.faqItem} key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <Footer />

      {/*
        Sign-in is a dialog from the design system now, not a hand-rolled overlay: it
        traps focus, closes on Escape, locks the page behind it, and on a phone it is a
        bottom sheet. See `pages/Auth/LoginDialog`.
      */}
      <LoginDialog
        open={loginOpen}
        onClose={closeLogin}
        onSignedIn={() => navigate('/dashboard')}
      />
    </div>
  )
}
