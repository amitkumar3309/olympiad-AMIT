import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { DIWALI_EDITION, INTRO_ID, INTRO_MS } from '../lib/season'
import DiwaliIntro from './DiwaliIntro'

/**
 * The Diwali intro for a signed-in student (owner, 2026-10-09: "full immersive … for logged in
 * users as well") — once that week, the first time they open the student area.
 *
 * The homepage's intro is drawn at build time and started by `public/boot.js`; the student area
 * is not drawn at build time, so here the app plays the same component, by the same rules: only
 * during the edition, never for a reader who asked for less motion or in a tab nobody is looking
 * at, once per browser for the edition (the same `amit-intro` key, so a student who saw it on the
 * homepage is not shown it twice), ended by any key, tap or scroll, and by its own clock
 * regardless. It sets `<html data-intro="play">` like boot.js, which is what shows it and what
 * pauses the page's loops and the fireworks beneath it. A portal, so it sits beside the app's root.
 */
export default function DiwaliIntroPlayer() {
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    if (root.getAttribute('data-season') !== DIWALI_EDITION.kind) return
    if (root.hasAttribute('data-intro')) return
    if (document.visibilityState !== 'visible') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // The edition on show, as boot.js named it: a trial has its own id, so seeing its intro does
    // not stop the real week's from playing.
    const editionId = root.getAttribute('data-season-id') || DIWALI_EDITION.id
    try {
      if (window.localStorage.getItem(INTRO_ID) === editionId) return
    } catch {
      // Storage blocked: it plays, and cannot be remembered.
    }

    const events = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const
    let timer = 0
    const stop = () => {
      root.removeAttribute('data-intro')
      setPlaying(false)
      for (const name of events) window.removeEventListener(name, finish, true)
      window.clearTimeout(timer)
    }
    // Remembered when it has been seen — not when an effect is undone, which React may do to
    // one it has only just run.
    function finish() {
      try {
        window.localStorage.setItem(INTRO_ID, editionId)
      } catch {
        // Storage blocked.
      }
      stop()
    }
    root.setAttribute('data-intro', 'play')
    setPlaying(true)
    for (const name of events) window.addEventListener(name, finish, { capture: true, passive: true })
    timer = window.setTimeout(finish, INTRO_MS)
    return stop
  }, [])

  return playing ? createPortal(<DiwaliIntro />, document.body) : null
}
