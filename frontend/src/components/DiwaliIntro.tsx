import type { CSSProperties, ReactNode } from 'react'
import { AMIT_COMPETITION_YEAR, AMIT_OLYMPIAD, AMIT_TAGLINE } from '../lib/brand'
import { INTRO_ID } from '../lib/season'
import { Diya } from './Diwali'
import styles from './DiwaliIntro.module.css'

/**
 * "The Diwali launch moment" (Milestone 30 Phase 7 — owner, 2026-10-08), slowed and deepened on
 * 2026-10-09 ("very fast … keep it a bit slow, engaging and immersive"): about seven seconds, the
 * first time a browser sees the Diwali edition. Embers rise through the dark; 3, 2, 1, a second
 * each, each with a ring of light going out from it; a diya catches with a burst of sparks; its
 * light finds the mathematics around it; the name; "Think • Solve • Grow" — and as it fades, the
 * fireworks open with a salute (`lib/fireworks/start.ts`).
 *
 * ## Where it plays
 *
 * On the homepage it is **not** in the app's tree: the homepage is drawn at build time and the
 * app renders over it, which would restart an animation half-way, so `vite.prerender.ts` writes
 * it beside the root and `public/boot.js` starts it. In the student area — never drawn at build
 * time — `DiwaliIntroPlayer` renders this same component. Either way it shows only while
 * `<html data-intro="play">`, which any key, tap, click or scroll removes, and its clock
 * (`INTRO_MS`, `lib/season.ts`) removes regardless, so an animation that never runs cannot leave
 * the page covered.
 *
 * ## What it may not do
 *
 * It hides nothing from a screen reader (it is `aria-hidden`; the page is all there beneath it),
 * holds no focus and no control, plays for nobody who asked for less motion, and moves only
 * whole elements' transform and opacity, which the GPU runs alone. Its maths is plain text — no
 * maths renderer on the first paint.
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

const COUNT = ['3', '2', '1']

/**
 * The embers rising through the dark: where each starts (% across), when (in beats), how long
 * it takes to rise (in beats), its size and its sway (px). Spread by a fixed rule, not at
 * random — the homepage's copy is drawn at build time, and every visitor gets the same sky.
 */
const EMBERS = Array.from(
  { length: 16 },
  (_, i) =>
    ({
      '--x': (i * 61 + 7) % 100,
      '--delay': ((i * 7) % 16) / 5,
      '--rise': 3 + ((i * 5) % 7) / 3,
      '--size': 0.6 + ((i * 3) % 5) / 6,
      '--sway': ((i * 13) % 9) * 6 - 24,
    }) as CSSProperties,
)

/** The sparks the diya throws as it catches: a twelfth of a turn apart, flying different distances (px). */
const SPARKS = Array.from({ length: 12 }, (_, i) => ({ '--n': i, '--reach': 52 + ((i * 7) % 5) * 10 }) as CSSProperties)

export default function DiwaliIntro() {
  return (
    <div id={INTRO_ID} className={styles.intro} aria-hidden="true">
      <div className={styles.embers}>
        {EMBERS.map((style, i) => (
          <span key={i} className={styles.ember} style={style} />
        ))}
      </div>
      <div className={styles.count}>
        {COUNT.map((number, i) => (
          <span key={number} className={styles.beat} style={{ '--n': i } as CSSProperties}>
            <span className={styles.ring} />
            <span className={styles.number}>{number}</span>
          </span>
        ))}
      </div>
      <div className={styles.light} />
      <ul className={styles.equations}>
        {EQUATIONS.map((equation, i) => (
          <li key={i} className={styles.equation} style={{ '--n': i } as CSSProperties}>
            {equation}
          </li>
        ))}
      </ul>
      <div className={styles.stage}>
        <div className={styles.lamp}>
          {SPARKS.map((style, i) => (
            <span key={i} className={styles.spark} style={style} />
          ))}
          <Diya className={styles.diya} />
        </div>
        <p className={styles.title}>
          {AMIT_OLYMPIAD} {AMIT_COMPETITION_YEAR}
        </p>
        <p className={styles.tagline}>{AMIT_TAGLINE}</p>
      </div>
      <p className={styles.skip}>Tap or press any key to skip</p>
    </div>
  )
}
