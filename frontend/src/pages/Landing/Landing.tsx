import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import { Button, Card, EmptyState, Icon, StatTile } from '../../components/ui'
import { api } from '../../api/client'
import { CLASS_LEVELS, type LeaderboardRow, type PublicStats, type ReferralCheck } from '../../api/types'
import { AMIT_FULL_FORM } from '../../lib/brand'
import LoginDialog from '../Auth/LoginDialog'
import RegisterForm from '../Auth/RegisterForm'
import styles from './Landing.module.css'

/**
 * The public landing page (redesigned in Milestone 23, Phase F).
 *
 * ## Everything on this page has to be true
 *
 * A marketing page is where invented facts go to live, so every claim here was checked
 * against the code before it was written, and three that were already here did not
 * survive:
 *
 *  - **"There is no negative marking."** There is. `Question.negativeMarks` exists, the
 *    grader applies it (`services/grading.ts`), and the AI generator defaults it to 1. The
 *    honest version is the one the product can back: a student sees the marks *and* the
 *    penalty on every question before answering, because `studentQuestionView` includes
 *    both.
 *  - **"Results are published within 48 hours."** Nothing in the product promises that.
 *    Releasing results is a deliberate administrative act (`services/examService.ts`),
 *    which is what mints the certificates at the same moment.
 *  - **"AMIT MATHS OLYMPIAD 2027."** The year appears nowhere else: the certificate this
 *    product actually prints is titled `A.M.I.T MATHS OLYMPIAD` with no year, and the only
 *    year in the system is the *current* one, in a certificate serial. A sitting's dates
 *    come from the `Exam` window an administrator announces. Put a year back when there is
 *    one to state.
 *
 * The four figures are real counts from `/public/stats` and render **only if they load** —
 * this page has never carried a placeholder headline number and must not start.
 *
 * ## What it does not say
 *
 * The entry fee has no public endpoint (`GET /payments/status` is behind `requireAuth`),
 * so the page says an entry fee exists and that preparation is free, and names **no
 * amount**. Inventing one, or adding a public route to display one, would both be worse
 * than the omission.
 *
 * Referral rewards are not mentioned at all: `ReferralSettings.rewardEnabled` defaults to
 * false, so an earnings promise on the most public page in the product would be a claim
 * about money that is switched off.
 *
 * ## The expansion of the name appears once
 *
 * Directly under the wordmark, as part of the logotype, from `lib/brand.ts`. Not in a
 * section explaining it, not in the footer, not letter by letter — see the note in
 * `brand.ts` and the rule in `CLAUDE.md`.
 */

/** What the platform actually offers, in the order a student meets it. */
const FEATURES = [
  {
    icon: 'ph-target',
    title: 'Practice',
    body:
      'Choose a chapter and a difficulty and work through questions written for your own class. ' +
      'Marked the moment you answer, with the worked solution.',
  },
  {
    icon: 'ph-exam',
    title: 'Mock tests',
    body:
      'Full-length papers under a real clock the server keeps, so a refresh cannot buy you time. ' +
      'Your answers save as you go.',
  },
  {
    icon: 'ph-calendar-check',
    title: 'Daily challenge',
    body:
      'One question a day for your class — the same question for everyone in it, fixed for the day, ' +
      'so it is a shared problem rather than a random draw.',
  },
  {
    icon: 'ph-chart-line-up',
    title: 'Performance insights',
    body:
      'Accuracy by chapter and by difficulty, drawn from papers you have actually submitted. ' +
      'A strength or a weakness is only named once there is enough evidence for it.',
  },
]

/** The path from arriving here to sitting the paper. Each step is something the product does. */
const STEPS = [
  {
    icon: 'ph-user-plus',
    title: 'Register',
    body: 'Your details, your school and a photograph. Free, and you confirm your email address before signing in.',
  },
  {
    icon: 'ph-books',
    title: 'Prepare, free',
    body: 'Practice, mock tests, the daily challenge and your performance page cost nothing. No card, no trial.',
  },
  {
    icon: 'ph-ticket',
    title: 'Enter the Olympiad',
    body: 'The official sitting has an entry fee, shown in full before you pay. That is the only thing it buys.',
  },
  {
    icon: 'ph-certificate',
    title: 'Sit it, and be ranked',
    body: 'One attempt, in the announced window. When the organisers release the results your certificate is issued with them.',
  },
]

/** Properties of the product, not adjectives about it. Each one is enforced in code. */
const ASSURANCES = [
  {
    icon: 'ph-shield-check',
    title: 'Marked on the server, never in your browser',
    body:
      'A paper is marked against the answer key captured when it was served to you, so editing a ' +
      'question afterwards cannot change a mark you have already been given.',
  },
  {
    icon: 'ph-user-focus',
    title: 'A person approves every question',
    body:
      'Nothing reaches a student until an examiner publishes it, and a question cannot be published ' +
      'without a worked solution and a resolvable answer key.',
  },
  {
    icon: 'ph-eye-slash',
    title: 'Children are not named in public',
    body:
      'The leaderboard and the certificate check show a first name and a last initial. Full names, ' +
      'schools and contact details are never published.',
  },
]

/**
 * Answers that can be checked against the code. Where the product genuinely varies — the
 * fee, the dates, whether a given paper penalises a wrong answer — the answer says where
 * the real figure appears rather than inventing one.
 */
const FAQS = [
  {
    q: 'Who can take part?',
    a: 'Any student from Class 3 to Class 12. There is no restriction by school board.',
  },
  {
    q: 'What does it cost?',
    a:
      'Practice, mock tests, the daily challenge and your performance page are free. Only the official ' +
      'Olympiad has an entry fee, and the exact amount is shown to you before you pay.',
  },
  {
    q: 'Is there negative marking?',
    a:
      'It depends on the paper. Every question shows its marks and any penalty for a wrong answer before ' +
      'you answer it, so you always know what a question is worth.',
  },
  {
    q: 'When are results published?',
    a:
      'The organisers release them after the sitting has closed. They appear on your dashboard, and your ' +
      'certificate is issued at the same moment.',
  },
  {
    q: 'How many times can I sit the Olympiad?',
    a: 'Once. One attempt per student is enforced by the system rather than by a rule people have to remember.',
  },
  {
    q: 'What happens if my connection drops during a paper?',
    a:
      'Each answer is saved as you give it, and the clock belongs to the server, so sign back in and carry ' +
      'on from where you were with the time that is genuinely left.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. Everything runs in a browser, on a phone or a computer.',
  },
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

  function goToForm() {
    document.getElementById('register')?.scrollIntoView({ behavior: 'auto', block: 'start' })
  }

  return (
    <div>
      <Navbar />

      <main id="main-content">
        {/* ---------------------------------------------------------------- Hero */}
        <section className={styles.hero}>
          <div className={`container ${styles.heroInner}`}>
            <p className={styles.kicker}>
              <Icon name="ph-medal" weight="bold" /> National-level mathematics olympiad
            </p>
            <h1 className={styles.wordmark}>A.M.I.T Maths Olympiad</h1>
            {/* The expansion, directly under the name it expands. Nowhere else on this page. */}
            <p className={styles.fullForm}>{AMIT_FULL_FORM}</p>
            {/* "A year of preparation" was the first draft, and it is a claim about duration
                nothing in the product makes. What is true is the pricing rule the paywall
                actually implements: preparation is free, the entry fee buys the sitting. */}
            <p className={styles.tagline}>
              Think faster. Solve smarter. Prepare for free — the entry fee buys your seat in the national paper,
              and nothing else.
            </p>

            <div className={styles.heroActions}>
              {/*
                `behavior: 'auto'`, not `'smooth'`: a smooth scroll silently does nothing
                in environments that do not animate, and landing on the form is the point.
                The same reasoning as the `/register` effect above.
              */}
              <Button size="lg" iconAfter="ph-arrow-right" onClick={goToForm}>
                Register now
              </Button>
              <Button size="lg" variant="outline" icon="ph-sign-in" onClick={() => setLoginOpen(true)}>
                Student sign in
              </Button>
            </div>

            <ul className={styles.heroFacts}>
              <li>
                <Icon name="ph-student" weight="bold" /> Class 3 to Class 12
              </li>
              <li>
                <Icon name="ph-buildings" weight="bold" /> Any school board
              </li>
              <li>
                <Icon name="ph-gift" weight="bold" /> Free to prepare
              </li>
            </ul>
          </div>
        </section>

        {/* Real counts, or nothing at all — never a placeholder headline number. */}
        {stats && (
          <section className={`container ${styles.statsSection}`} aria-label="Participation so far">
            <div className={styles.statGrid}>
              <StatTile icon="ph-users-three" value={stats.studentsRegistered.toLocaleString()} label="Students registered" />
              <StatTile icon="ph-user-plus" value={stats.registeredToday.toLocaleString()} label="Registered today" tone="success" />
              <StatTile icon="ph-pulse" value={stats.studentsActiveToday.toLocaleString()} label="Active today" tone="success" />
              <StatTile icon="ph-buildings" value={stats.schoolsRepresented.toLocaleString()} label="Schools represented" tone="neutral" />
            </div>
          </section>
        )}

        {/* ------------------------------------------------------------ Features */}
        <section className={`container ${styles.section}`} aria-labelledby="what-you-get">
          <header className={styles.sectionHead}>
            <p className="eyebrow">What you get</p>
            <h2 id="what-you-get">Four ways to prepare, all of them free</h2>
            <p className={styles.sectionLead}>
              The entry fee buys a seat in the Olympiad. Everything you use to get ready for it does not.
            </p>
          </header>

          <div className={styles.featureGrid}>
            {FEATURES.map((feature) => (
              <Card key={feature.title} className={styles.feature}>
                <span className={styles.featureIcon}>
                  <Icon name={feature.icon} weight="bold" size="lg" />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* -------------------------------------------------------- How it works */}
        <section className={styles.stripe} aria-labelledby="how-it-works">
          <div className={`container ${styles.section}`}>
            <header className={styles.sectionHead}>
              <p className="eyebrow">How it works</p>
              <h2 id="how-it-works">From registering to being ranked</h2>
            </header>

            <ol className={styles.steps}>
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <span className={styles.stepNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>
                      <Icon name={step.icon} weight="bold" /> {step.title}
                    </h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------------- Classes */}
        <section className={`container ${styles.section}`} aria-labelledby="classes">
          <header className={styles.sectionHead}>
            <p className="eyebrow">Who it is for</p>
            <h2 id="classes">Ten classes, ten papers</h2>
            <p className={styles.sectionLead}>
              Questions, mock tests and the daily challenge are set per class, so a Class 4 student is never
              shown a Class 11 paper.
            </p>
          </header>

          {/* From `CLASS_LEVELS`, which mirrors the backend's own list — so this cannot
              advertise a class the product would refuse at registration. */}
          <ul className={styles.classList}>
            {CLASS_LEVELS.map((level) => (
              <li key={level}>{level.replace('Class ', '')}</li>
            ))}
          </ul>
          <p className={styles.classCaption}>Class 3 through Class 12</p>
        </section>

        {/* ---------------------------------------------------------- Assurances */}
        <section className={styles.stripe} aria-labelledby="assurances">
          <div className={`container ${styles.section}`}>
            <header className={styles.sectionHead}>
              <p className="eyebrow">How it is run</p>
              <h2 id="assurances">Things we can show you, not adjectives</h2>
            </header>

            <div className={styles.assuranceGrid}>
              {ASSURANCES.map((item) => (
                <div className={styles.assurance} key={item.title}>
                  <Icon name={item.icon} weight="bold" size="lg" className={styles.assuranceIcon} />
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- Top scholars */}
        <section className={`container ${styles.section}`} aria-labelledby="scholars">
          <header className={styles.sectionHead}>
            <p className="eyebrow">Standings</p>
            <h2 id="scholars">Top scholars</h2>
            <p className={styles.sectionLead}>The highest XP earned so far, straight from the leaderboard.</p>
          </header>

          {champions === null ? (
            <p className={styles.muted}>Loading the leaderboard…</p>
          ) : champions.length === 0 ? (
            <EmptyState
              icon="ph-trophy"
              title="Nobody is on the leaderboard yet"
              description="XP is earned by practising, sitting mock tests and answering the daily challenge. Register below and you could be the first name here."
            />
          ) : (
            <ol className={styles.championGrid}>
              {champions.map((row) => (
                <li key={row.studentId}>
                  <Card className={styles.champion}>
                    <span className={styles.championRank}>
                      {/* An icon beside the rank, never in place of it: "#4" and a medal
                          have to be comparable at a glance. */}
                      {row.rank <= 3 && <Icon name="ph-medal" weight="bold" className={styles.championMedal} />}
                      <span className="tnum">#{row.rank}</span>
                    </span>
                    {/* The API publishes a first name and a last initial only — these are
                        schoolchildren and this page is public. */}
                    <h3>{row.displayName}</h3>
                    {row.schoolName && <p className={styles.championSchool}>{row.schoolName}</p>}
                    <p className={styles.muted}>
                      {row.classLevel ? `${row.classLevel} · ` : ''}
                      <span className="tnum">{row.xp.toLocaleString()}</span> XP
                    </p>
                  </Card>
                </li>
              ))}
            </ol>
          )}

          {/* The top three are a taste of the standing; the full board is public too, and
              can be filtered by class and by period. */}
          <p className={styles.muted}>
            <Link to="/leaderboard" className="link">
              See the full leaderboard
            </Link>{' '}
            ·{' '}
            <Link to="/hall-of-fame" className="link">
              Hall of Fame
            </Link>
          </p>
        </section>

        {/* ------------------------------------------------------------ Register */}
        <section id="register" className={`container ${styles.section}`}>
          {/*
            The form itself lives in `pages/Auth/RegisterForm` (Milestone 23, Phase C).
            This page is a marketing surface that contains it; the two were one 749-line
            file, and neither could be read without the other.
          */}
          <RegisterForm referral={referral} onRequestLogin={() => setLoginOpen(true)} />
        </section>

        {/* ----------------------------------------------------------------- FAQ */}
        <section className={styles.stripe} aria-labelledby="faq">
          <div className={`container ${styles.section} ${styles.faqSection}`}>
            <header className={styles.sectionHead}>
              <p className="eyebrow">Questions</p>
              <h2 id="faq">Before you register</h2>
            </header>

            <div className={styles.faqList}>
              {FAQS.map((f) => (
                <details className={styles.faqItem} key={f.q}>
                  <summary>
                    <span>{f.q}</span>
                    <Icon name="ph-caret-down" weight="bold" className={styles.faqCaret} />
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ Final CTA */}
        <section className={`container ${styles.section}`}>
          <Card className={styles.cta}>
            <h2>Ready to sit the paper?</h2>
            <p>
              Registering is free and takes a few minutes. You can practise the same day — the entry fee only
              applies when you enter the official Olympiad.
            </p>
            <div className={styles.heroActions}>
              <Button size="lg" iconAfter="ph-arrow-right" onClick={goToForm}>
                Register now
              </Button>
              <Button size="lg" variant="ghost" icon="ph-sign-in" onClick={() => setLoginOpen(true)}>
                I already have an account
              </Button>
            </div>
          </Card>
        </section>
      </main>

      <Footer />

      {/*
        Sign-in is a dialog from the design system now, not a hand-rolled overlay: it
        traps focus, closes on Escape, locks the page behind it, and on a phone it is a
        bottom sheet. See `pages/Auth/LoginDialog`.
      */}
      <LoginDialog open={loginOpen} onClose={closeLogin} onSignedIn={() => navigate('/dashboard')} />
    </div>
  )
}
