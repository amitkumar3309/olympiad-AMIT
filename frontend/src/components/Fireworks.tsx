import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { DIWALI_EDITION } from '../lib/season'
import styles from './Fireworks.module.css'

/**
 * The Diwali edition's night sky, behind every page (owner, 2026-10-09: "whole site at night",
 * fireworks bursting "at different random places"). Mounted once, at the root of the app.
 *
 * The sky is a fixed layer behind the content, shown only under `<html data-season="diwali">` —
 * the page's own colour turns transparent during the edition (`tokens.css` section 10), so this
 * is what every page stands on, and the fireworks show between and around the cards.
 *
 * The fireworks themselves are a canvas this component adds **in an effect** (`lib/fireworks`): a
 * canvas can be handed to a worker only once, and an effect may run twice, so each run makes its
 * own and removes it after. Never for a reader who asked for less motion — the night stays,
 * still — and never where the sky should keep still (`STILL`).
 */

/**
 * Where the sky keeps still: the staff pages, where the night is enough, and a paper while it
 * is being answered — a practice session, a mock test, the Olympiad itself (the pages
 * `StudentShell` renders with `focus`, and the exam's own) — where a student is working
 * against a clock and a burst at the edge of the eye is a distraction, not a celebration.
 */
const STILL = [/^\/admin(\/|$)/, /^\/ai-generator(\/|$)/, /^\/practice\/[^/]+/, /^\/mock-tests\/attempts\//, /^\/exam\/[^/]+/]

export default function Fireworks() {
  const sky = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  const quiet = STILL.some((path) => path.test(pathname))

  useEffect(() => {
    const host = sky.current
    if (!host || quiet) return
    if (document.documentElement.getAttribute('data-season') !== DIWALI_EDITION.kind) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const canvas = document.createElement('canvas')
    canvas.className = styles.canvas
    host.appendChild(canvas)
    host.dataset.running = 'true'
    let stop: (() => void) | null = null
    let cancelled = false
    // Loaded only during the edition, and only here: nobody else downloads a firework.
    void import('../lib/fireworks/start').then(({ startFireworks }) => {
      if (!cancelled) stop = startFireworks(canvas)
    })
    return () => {
      cancelled = true
      stop?.()
      canvas.remove()
      delete host.dataset.running
    }
  }, [quiet])

  // `data-fireworks` is what the browser tests find the sky by; `data-running` is set while it bursts.
  return <div ref={sky} className={styles.sky} data-fireworks="" aria-hidden="true" />
}
