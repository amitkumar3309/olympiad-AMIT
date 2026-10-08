import type { ReactNode } from 'react'
import { AMIT_COMPETITION_YEAR, AMIT_OLYMPIAD, AMIT_TAGLINE } from '../lib/brand'
import { INTRO_ID } from '../lib/season'
import { Diya } from './Diwali'
import styles from './DiwaliIntro.module.css'

/**
 * "The Diwali launch moment" (Milestone 30 Phase 7 — owner, 2026-10-08): about two seconds on
 * the homepage the first time a browser sees the Diwali edition. Dark; 3, 2, 1; a diya lights;
 * its light finds the mathematics around it; then the name, then "Think • Solve • Grow".
 *
 * ## Why it is drawn outside the app
 *
 * The homepage is drawn at build time, and the app then renders over it — replacing those
 * elements, which would restart an animation half-way. So this is **not** in the app's tree:
 * `vite.prerender.ts` writes it into the homepage's HTML beside the root, where the app never
 * touches it. It plays only while `<html data-intro="play">`, which `public/boot.js` sets
 * before the first paint and removes on any key, tap, click or scroll — and after
 * `INTRO_MS` regardless (`lib/season.ts`), so an animation that never runs cannot leave the
 * page covered. `main.tsx` imports this file's stylesheet itself (the app never renders the
 * component, so nothing else would put it in the bundle) and removes the markup once it ends.
 *
 * ## What it may not do
 *
 * It hides nothing from a screen reader (it is `aria-hidden`; the page is all there beneath
 * it), holds no focus and no control, plays for nobody who asked for less motion, and is
 * smaller than the hero's heading, which stays the page's largest paint. Its maths is plain
 * text — no maths renderer on the first paint.
 */

/** The mathematics the diya's light finds. */
const EQUATIONS: ReactNode[] = [
  <>
    a<sup>2</sup> + b<sup>2</sup> = c<sup>2</sup>
  </>,
  <>
    e<sup>iπ</sup> + 1 = 0
  </>,
  <>π ≈ 3.14159</>,
  <>
    ∑ 1/n<sup>2</sup> = π<sup>2</sup>/6
  </>,
  <>√2 ≈ 1.41421</>,
  <>φ = (1 + √5) / 2</>,
  <>
    x = (−b ± √(b<sup>2</sup> − 4ac)) / 2a
  </>,
  <>
    ∫ x dx = x<sup>2</sup>/2 + C
  </>,
]

export default function DiwaliIntro() {
  return (
    <div id={INTRO_ID} className={styles.intro} aria-hidden="true">
      <div className={styles.count}>
        <span className={styles.three}>3</span>
        <span className={styles.two}>2</span>
        <span className={styles.one}>1</span>
      </div>
      <div className={styles.light} />
      <ul className={styles.equations}>
        {EQUATIONS.map((equation, i) => (
          <li key={i} className={styles.equation}>
            {equation}
          </li>
        ))}
      </ul>
      <div className={styles.stage}>
        <Diya className={styles.diya} />
        <p className={styles.title}>
          {AMIT_OLYMPIAD} {AMIT_COMPETITION_YEAR}
        </p>
        <p className={styles.tagline}>{AMIT_TAGLINE}</p>
      </div>
      <p className={styles.skip}>Tap or press any key to skip</p>
    </div>
  )
}
