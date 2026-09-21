import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import { Button, ButtonLink, Card, EmptyState, Icon, IconTile, Section, StatTile } from '../../components/ui'
import { api } from '../../api/client'
import type { LeaderboardRow, PublicStats } from '../../api/types'
import { AMIT_COMPETITION_YEAR, AMIT_FULL_FORM } from '../../lib/brand'
import { roleHome } from '../../lib/roleHome'
import LoginDialog from '../Auth/LoginDialog'
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
 *  - **"AMIT MATHS OLYMPIAD 2027."** Removed in Phase F and **restored on 2026-08-29 at the
 *    owner's instruction**, which is the only thing that could restore it: the certificate
 *    this product prints is titled `A.M.I.T MATHS OLYMPIAD` with no year, and the only year
 *    in the system is the *current* one inside a certificate serial. A sitting's dates come
 *    from the `Exam` window an administrator announces. So the year is a marketing fact with
 *    no source of truth behind it, and it lives in `lib/brand.ts` — one line to change when
 *    the sitting moves, and one place to look when somebody asks where it came from.
 *
 * The four figures are real counts from `/public/stats` and render **only if they load** —
 * this page has never carried a placeholder headline number and must not start.
 *
 * ## Registration is not on this page (Milestone 28)
 *
 * It was a `<section id="register">` near the bottom, and every "Register now" button
 * scrolled to it. It is a route now — `pages/Register` — and those buttons are ordinary
 * links to it. Nothing here should scroll to a form, open one in a dialog, or render
 * `RegisterForm`: a person who has decided to register should not have to load the
 * marketing page to do it. The `?ref=` handling went with the form.
 *
 * ## The copy is deliberately short (Milestone 28)
 *
 * A headline and one or two lines per section, because the previous version explained
 * each feature in two full sentences and a reader skips all of it. Shortening is not
 * licence to overclaim: every sentence that survived still has to pass the test above,
 * and the things a reader actually needs — who may enter, that preparing is free, that
 * the sitting has a fee, where results come from — are all still stated.
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

/**
 * What the platform actually offers, in the order a student meets it.
 *
 * Each carries an `IconTile` tone. The colours are **labels, not decoration**: four
 * things a student can do, four hues, so the eye can tell them apart down the page and
 * in the dashboard later. That is the whole job the categorical palette exists for —
 * see the note in `ui/IconTile`.
 */
const FEATURES = [
  {
    tone: 'blue' as const,
    icon: 'ph-target',
    title: 'Practice',
    body: 'Questions for your class, by chapter and difficulty. Marked instantly, with the solution.',
  },
  {
    tone: 'orange' as const,
    icon: 'ph-exam',
    title: 'Mock tests',
    body: 'Full-length papers on the server’s clock. Answers save as you go.',
  },
  {
    tone: 'magenta' as const,
    icon: 'ph-calendar-check',
    title: 'Daily challenge',
    body: 'One question a day, the same for everyone in your class.',
  },
  {
    tone: 'green' as const,
    icon: 'ph-chart-line-up',
    title: 'Performance insights',
    body: 'Accuracy by chapter and difficulty, from papers you have actually submitted.',
  },
]

/** The path from arriving here to sitting the paper. Each step is something the product does. */
const STEPS = [
  {
    icon: 'ph-user-plus',
    title: 'Register',
    body: 'Free. Confirm your email address before signing in.',
  },
  {
    icon: 'ph-books',
    title: 'Prepare, free',
    body: 'Practice, mock tests and the daily challenge cost nothing. No card.',
  },
  {
    icon: 'ph-ticket',
    title: 'Enter the Olympiad',
    body: 'The sitting has an entry fee, shown in full before you pay.',
  },
  {
    icon: 'ph-certificate',
    title: 'Sit it, and be ranked',
    body: 'One attempt, in the announced window. Certificates are issued when results are released.',
  },
]

/**
 * What a student actually ends up with (Milestone 28).
 *
 * This replaced "How it is run" / "Things we can show you, not adjectives" — three
 * true statements about server-side marking, editorial review and name masking, which
 * were the *mechanics* of the product described to somebody who has not used it yet.
 * A reader deciding whether to register wants to know what they get, not how the
 * grader is implemented. The owner asked for something more impactful and this is it:
 * the same honesty, pointed at the outcome rather than the machinery.
 *
 * All three are still things the code does, which is the rule this page lives under:
 *  - the rank is real — `services/examService.ts` ranks the cohort when results are
 *    released, and equal scores share a rank (1, 2, 2, 4);
 *  - the certificate is real and verification is keyed on a random `verificationCode`
 *    rather than the readable serial (`GET /certificates/verify/:code`, page `/verify`);
 *  - the marking claim is the answer-key snapshot taken at serve time plus the
 *    one-attempt unique index, both from Milestone 13.
 *
 * The name-masking fact was not dropped — it moved to the FAQ, where a parent looking
 * for it will actually look.
 */
const OUTCOMES = [
  {
    tone: 'gold' as const,
    icon: 'ph-medal',
    title: 'A national rank',
    body: 'Placed against every student in your class. Equal scores share a rank.',
  },
  {
    tone: 'purple' as const,
    icon: 'ph-certificate',
    title: 'A certificate anyone can check',
    body: 'Issued the moment results are released, with a code that verifies publicly.',
  },
  {
    tone: 'green' as const,
    icon: 'ph-shield-check',
    title: 'A score you can trust',
    body: 'One attempt, marked on the server against the key captured when your paper was served.',
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
    a: 'Preparation is free. Only the official Olympiad has an entry fee, and the amount is shown before you pay.',
  },
  {
    q: 'Is there negative marking?',
    a: 'It depends on the paper. Every question shows its marks and any penalty before you answer it.',
  },
  {
    q: 'When are results published?',
    a: 'The organisers release them after the sitting closes. Your certificate is issued at the same moment.',
  },
  {
    q: 'How many times can I sit the Olympiad?',
    a: 'Once. The system enforces it.',
  },
  {
    q: 'What happens if my connection drops during a paper?',
    a: 'Every answer is saved as you give it and the clock is the server’s. Sign back in and carry on.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. Everything runs in a browser, on a phone or a computer.',
  },
  {
    // Moved here from the old "How it is run" section (Milestone 28). It is a real
    // guarantee — `displayNameFor()` is the only function allowed to decide it — and
    // the FAQ is where a parent looks for it, rather than a row of cards they scroll past.
    q: 'Will my child’s name be published?',
    a: 'Public pages show a first name and a last initial only. Never a school or contact details.',
  },
]

export default function Landing() {
  const navigate = useNavigate()

  // Real public figures. Both are best-effort: the landing page must still render if
  // the API is unreachable, so a failure leaves them empty rather than blocking the
  // registration form behind an error screen.
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [champions, setChampions] = useState<LeaderboardRow[] | null>(null)

  const [searchParams] = useSearchParams()
  const { pathname, hash } = useLocation()

  const [loginOpen, setLoginOpen] = useState(false)

  /**
   * Where every "Register now" on this page points.
   *
   * A `?ref=` that arrived on *this* URL is carried across, so a code shared as
   * `<app>/?ref=CODE` rather than the `<app>/register?ref=CODE` that
   * `referralLinkFor()` generates still reaches the form that reads it. Without this
   * the code would be silently dropped at the moment the reader clicks through, and a
   * dropped referral is invisible to everybody involved.
   */
  const ref = searchParams.get('ref')?.trim()
  const registerHref = ref ? `/register?ref=${encodeURIComponent(ref)}` : '/register'

  /**
   * `/#login`, which the header and footer link to (Milestone 23, Phase B).
   *
   * The sign-in form is a dialog on this page rather than a route of its own, so
   * without this there would be **no way to ask for it from anywhere else in the
   * product** — a visitor on the leaderboard would have to find their way back to the
   * hero and hunt for the button.
   *
   * `hash` is a dependency, so following the same link twice from two pages works.
   *
   * `#register` used to be handled here too, scrolling to the form further down. It is
   * gone with the form: registration is `/register` now, and the header and footer link
   * straight to it.
   */
  useEffect(() => {
    if (hash !== '#login') return
    // Opening it is all this has to do: the dialog moves focus to its first field
    // itself, the same way it does when the hero button opens it.
    setLoginOpen(true)
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

      <main id="main-content">
        {/* ---------------------------------------------------------------- Hero */}
        <section className={styles.hero}>
          <div className={`container ${styles.heroInner}`}>
            <p className={styles.kicker}>
              <Icon name="ph-medal" weight="bold" /> National-level mathematics olympiad
            </p>
            {/* The year is owner-supplied and lives in `brand.ts`: nothing in the backend
                knows it, so there is one place to change when the sitting moves. */}
            {/* "A.M.I.T. Olympiad", not "A.M.I.T Maths Olympiad" (owner, 2026-09-21).
                Matches the navbar wordmark, which already carried the trailing stop.
                The printed certificate is still titled `A.M.I.T MATHS OLYMPIAD` and is
                deliberately left alone — it is a record of what was handed to somebody,
                and re-titling it would make new certificates disagree with issued ones. */}
            <h1 className={styles.wordmark}>A.M.I.T. Olympiad {AMIT_COMPETITION_YEAR}</h1>
            {/* The expansion, directly under the name it expands. Nowhere else on this page. */}
            <p className={styles.fullForm}>{AMIT_FULL_FORM}</p>
            {/* "A year of preparation" was the first draft, and it is a claim about duration
                nothing in the product makes. What is true is the pricing rule the paywall
                actually implements: preparation is free, the entry fee buys the sitting. */}
            <p className={styles.tagline}>Prepare for free. The entry fee buys your seat in the national paper.</p>

            <div className={styles.heroActions}>
              {/*
                A real link to `/register`, not a scroll and not a dialog (Milestone 28).
                `ButtonLink` so middle-click, ⌘-click and "copy link address" all behave —
                none of which a `<button>` running `scrollIntoView` could do.
              */}
              <ButtonLink to={registerHref} size="lg">
                Register now
              </ButtonLink>
              <Button size="lg" variant="outline" onClick={() => setLoginOpen(true)}>
                Sign in
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
        {/*
          `ui/Section` from here down (Milestone 26). It replaces `.sectionHead` and
          `.sectionLead` and the hand-written `aria-labelledby` / `id` pairs — the
          component wires its own, so a section cannot end up as an unnamed landmark or
          reuse an id already on the page.
        */}
        <Section
          className={`container ${styles.section}`}
          eyebrow="What you get"
          title="Four ways to prepare, all of them free"
          lead="The entry fee buys a seat in the Olympiad. Getting ready for it costs nothing."
        >
          <div className={styles.featureGrid}>
            {FEATURES.map((feature) => (
              <Card key={feature.title} className={styles.feature} interactive>
                <IconTile icon={feature.icon} tone={feature.tone} size="lg" />
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* -------------------------------------------------------- How it works */}
        <div className={styles.stripe}>
          <Section
            className={`container ${styles.section}`}
            eyebrow="How it works"
            title="From registering to being ranked"
          >
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
          </Section>
        </div>

        {/*
          ------------------------------------------------------------ Assurances

          The "Ten classes, ten papers" section sat between this and the one above it
          and was removed in Milestone 28 at the owner's request, along with its class
          grid and caption.

          Its band moved rather than simply vanishing. The page alternates plain and
          tinted sections, and that section was a plain one between two tinted ones —
          deleting it on its own left "How it works" and this one as a single
          undifferentiated stripe. So this section is plain now, and the alternation
          holds again.

          Nothing factual was lost with it: who may enter is in the hero facts
          ("Class 3 to Class 12") and answered directly in the FAQ below.
        */}
        <Section
          className={`container ${styles.section}`}
          eyebrow="Why it counts"
          title="What you walk away with"
          lead="Practice is preparation. The Olympiad is the thing that goes on record."
        >
          <div className={styles.outcomeGrid}>
            {OUTCOMES.map((item) => (
              <div className={styles.outcome} key={item.title}>
                <IconTile icon={item.icon} tone={item.tone} size="md" />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
          {/* The certificate claim is checkable from this page, which is the point of
              making it: `/verify` takes a code and answers from the real record. */}
          <p className={styles.muted}>
            <Link to="/verify" className="link">
              Verify a certificate
            </Link>
          </p>
        </Section>

        {/* ------------------------------------------------------- Top scholars */}
        {/* The reference puts its people section on the pale blue band rather than the
            sand one — a second tint, so three consecutive bands do not read as one. */}
        <div className={styles.stripeBlue}>
          <Section
            className={`container ${styles.section}`}
            eyebrow="Standings"
            title="Top scholars"
            lead="The highest XP earned so far, straight from the leaderboard."
          >
            {champions === null ? (
              <p className={styles.muted}>Loading the leaderboard…</p>
            ) : champions.length === 0 ? (
              <EmptyState
                icon="ph-trophy"
                title="Nobody is on the leaderboard yet"
                // "Register below" until Milestone 28, which was a direction to a form
                // that is no longer on this page — the kind of copy that survives a
                // layout change by describing one.
                description="XP is earned by practising, sitting mock tests and answering the daily challenge. Register and you could be the first name here."
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
          </Section>
        </div>

        {/*
          ----------------------------------------------------------------- FAQ

          The registration form was a `<section id="register">` here until Milestone 28.
          It is `/register` now — see the note at the top of this file — which is also
          why this section is no longer striped: it followed a plain section then, and
          it follows the tinted "Top scholars" band now.
        */}
        <Section
          className={`container ${styles.section} ${styles.faqSection}`}
          eyebrow="Questions"
          title="Before you register"
        >
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
        </Section>

        {/* ------------------------------------------------------------ Final CTA */}
        <section className={`container ${styles.section}`}>
          <Card className={styles.cta}>
            <h2>Ready to sit the paper?</h2>
            <p>Registering is free, and you can practise the same day.</p>
            <div className={styles.heroActions}>
              <ButtonLink to={registerHref} size="lg">
                Register now
              </ButtonLink>
              <Button size="lg" variant="ghost" onClick={() => setLoginOpen(true)}>
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
      {/*
        Redirects by **role** (Milestone 28). This used to send everybody to
        `/dashboard`, which was right while staff had a sign-in form of their own and
        wrong the moment the two forms merged: an administrator signing in here landed
        on the student dashboard with no indication that `/admin` was where they meant
        to be. The role comes from the server on the session response — see
        `lib/roleHome.ts`.
      */}
      <LoginDialog open={loginOpen} onClose={closeLogin} onSignedIn={(role) => navigate(roleHome(role))} />
    </div>
  )
}
