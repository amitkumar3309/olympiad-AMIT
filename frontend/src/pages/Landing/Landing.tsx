import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import HomeQuizFab from '../../components/HomeQuizFab'
import LoginGate from '../../components/LoginGate'
import { api } from '../../api/client'
import type { QuizPrizeInfo } from '../../api/types'
import { useAuth } from '../../context/AuthContext'
import { usePrefersReducedMotion } from '../../components/ui'
import { roleHome } from '../../lib/roleHome'
import { registerHref, safeNext, type NextPath } from '../../lib/nextPath'
import { HOME_SECTIONS, type HomeSectionId } from '../../lib/siteConfig'
import LoginDialog from '../Auth/LoginDialog'
import Hero from './sections/Hero'
import Stats from './sections/Stats'
import Rewards from './sections/Rewards'
import About from './sections/About'
import HowItWorks from './sections/HowItWorks'
import Journey from './sections/Journey'
import TopScholars from './sections/TopScholars'
import Faq from './sections/Faq'
import FinalCta from './sections/FinalCta'
import styles from './Landing.module.css'

/**
 * The homepage (rebuilt for the launch mockup in Milestone 30, Phase 3 — brief §7).
 *
 * ## The order is configuration
 *
 * `HOME_SECTIONS` in `lib/siteConfig.ts` lists the sections top to bottom; this file only
 * renders that list. Each section fetches what it shows and **renders nothing it cannot
 * back** — the figures, the winners, the journey and the leaderboard are all real, and a
 * section whose data does not load is left out rather than filled in.
 *
 * ## Everything on this page has to be true
 *
 * It is the most public surface in the product, so each claim was checked against the
 * code (see the note in each section). Two standing omissions: the **entry fee is not
 * named** (no public endpoint), and **referral earnings are not mentioned** (switched off
 * by default). The prize wording and any amount come from the owner's settings.
 *
 * ## The Daily Quiz, from anywhere on the page
 *
 * The floating button, "Can you crack this?", the Rewards card and the About card all run
 * one flow: a student goes straight to `/daily-quiz`; a guest meets the **Login Gate**,
 * whose buttons carry `next=/daily-quiz` through sign-in — and through registration and
 * email verification, because the destination rides in the verification link.
 *
 * ## Registration is not on this page (Milestone 28)
 *
 * It is `/register`. A `?ref=` that arrives here is carried to every Register link, so a
 * code shared against `/` is not dropped at the click. `/#login` opens the one sign-in
 * dialog, and `?next=` (from a signed-in page a guest tried to open) says where to go after.
 */

/** Loaded on demand: the only section that needs the maths renderer (KaTeX). */
const CrackThis = lazy(() => import('./sections/CrackThis'))

/** In-page anchors the navbar and the hero link to. */
const SECTION_ANCHORS = new Set(['about', 'how-it-works', 'faq', 'rewards'])

export default function Landing() {
  const navigate = useNavigate()
  const { state } = useAuth()
  const [searchParams] = useSearchParams()
  const { pathname, hash } = useLocation()
  const reducedMotion = usePrefersReducedMotion()

  const [loginOpen, setLoginOpen] = useState(false)
  /** Where the sign-in dialog leads — set when it is opened from the Login Gate. */
  const [loginNext, setLoginNext] = useState<NextPath | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const [prize, setPrize] = useState<QuizPrizeInfo | null>(null)

  const isStudent = state.status === 'student'
  const ref = searchParams.get('ref')?.trim() || null
  const registerTo = registerHref(null, ref)

  // The prize, in the owner's words — shared by the Rewards section, the FAQ and the gate.
  useEffect(() => {
    let cancelled = false
    api
      .get<{ info: QuizPrizeInfo }>('/daily-quiz/info')
      .then((res) => {
        if (!cancelled) setPrize(res.info)
      })
      .catch(() => {
        // The sections fall back to wording that names no prize.
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * `/#login` opens the sign-in dialog (the header, the footer and every guarded page
   * link here); `/#faq` and friends scroll to that section. `hash` is a dependency, so
   * following the same link twice from two pages works.
   */
  useEffect(() => {
    if (hash === '#login') {
      setLoginOpen(true)
      return
    }
    const id = hash.slice(1)
    if (!SECTION_ANCHORS.has(id)) return
    document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  }, [hash, reducedMotion])

  /**
   * Closing also clears `#login` from the address. Otherwise the next press of Sign in
   * links to the same hash, which is not a change, and nothing opens.
   */
  function closeLogin() {
    setLoginOpen(false)
    setLoginNext(null)
    if (hash === '#login') navigate(pathname, { replace: true })
  }

  /** The one Daily Quiz entry: straight in for a student, the Login Gate for a guest. */
  const play = useCallback(() => {
    if (isStudent) navigate('/daily-quiz')
    else setGateOpen(true)
  }, [isStudent, navigate])

  function signInFromGate() {
    setGateOpen(false)
    setLoginNext('/daily-quiz')
    setLoginOpen(true)
  }

  const sections: Record<HomeSectionId, ReactNode> = {
    hero: <Hero signedIn={isStudent} registerTo={registerTo} />,
    stats: <Stats />,
    crack: (
      <Suspense fallback={<div className={styles.crackPlaceholder} aria-hidden="true" />}>
        <CrackThis onPlay={play} classLevel={state.status === 'student' ? state.student.classLevel : null} />
      </Suspense>
    ),
    rewards: <Rewards prize={prize} onPlay={play} />,
    about: <About onPlay={play} />,
    how: <HowItWorks registerTo={registerTo} />,
    journey: <Journey />,
    scholars: <TopScholars />,
    faq: <Faq prize={prize} />,
    cta: <FinalCta signedIn={isStudent} registerTo={registerTo} onSignIn={() => setLoginOpen(true)} />,
  }

  return (
    <div className={styles.page}>
      <Navbar />

      <main id="main-content">
        {HOME_SECTIONS.filter((section) => section.enabled).map((section) => (
          <div key={section.id}>{sections[section.id]}</div>
        ))}
      </main>

      <Footer />

      <HomeQuizFab onGuestClick={() => setGateOpen(true)} />

      <LoginGate
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        onSignIn={signInFromGate}
        registerTo={registerHref('/daily-quiz', ref)}
        prize={prize}
      />

      {/*
        The one sign-in dialog. After signing in: the Login Gate's destination, else an
        allowed `?next=`, else the role's own home (`lib/roleHome.ts`) — staff to `/admin`,
        a student to the dashboard. The role comes from the server.
      */}
      <LoginDialog
        open={loginOpen}
        onClose={closeLogin}
        onSignedIn={(role) => navigate(loginNext ?? safeNext(searchParams.get('next')) ?? roleHome(role))}
      />
    </div>
  )
}
