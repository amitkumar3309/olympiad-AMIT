import styles from './Diwali.module.css'

/**
 * The Diwali edition's artwork (Milestone 30 Phase 7 — `lib/season.ts`): a diya, a hanging
 * lantern, a firework, a string of lights and the header's greeting.
 *
 * **Drawn here in SVG and CSS**, so the edition downloads no image and nothing from anywhere
 * else, and costs the slow phone it is mostly seen on almost nothing. Every piece is
 * decoration — `aria-hidden`, never focusable — and moves only by turning, breathing or
 * fading in place (the landing page's rule for anything that moves), and not at all for a
 * reader who asked for less motion.
 *
 * `StringLights` and `DiwaliGreeting` hide themselves outside the edition; the diya, the
 * lantern and the firework do not, because the surfaces that use them (the hero's sky, the
 * intro, the Diwali Special band) are already shown only during it.
 *
 * **Only whole elements move** — an `<svg>`, a `<span>` — never a shape inside an SVG. A shape
 * inside an SVG can only be redrawn on the main thread, every frame; a whole element is moved
 * by the GPU. Measured on a slowed phone (Lighthouse), animating the shapes tripled the main
 * thread's style, layout and paint work and pushed the hero's paint past 3 s. So the diya's
 * flame is an SVG of its own, laid over the bowl's.
 */

function cx(...names: Array<string | undefined>): string {
  return names.filter(Boolean).join(' ')
}

/** A clay lamp with a flickering flame — two SVGs on one box, so the flame can move alone. */
export function Diya({ className }: { className?: string }) {
  return (
    <span className={cx(styles.diya, className)} aria-hidden="true">
      <svg className={styles.diyaBowl} viewBox="0 0 64 48" focusable="false">
        <path className={styles.bowl} d="M5 28 H59 C 57 38, 47 45, 32 45 C 17 45, 7 38, 5 28 Z" />
        <path className={styles.bowlBand} d="M10 33 C 18 37, 46 37, 54 33" />
      </svg>
      <svg className={styles.diyaFlame} viewBox="0 0 64 48" focusable="false">
        <path className={styles.flameOuter} d="M32 3 C 25 13, 24 21, 32 28 C 40 21, 39 13, 32 3 Z" />
        <path className={styles.flameInner} d="M32 12 C 29 17, 28.5 22, 32 26 C 35.5 22, 35 17, 32 12 Z" />
      </svg>
    </span>
  )
}

/** A paper lantern on its cord, swinging gently from the top. */
export function Lantern({ className }: { className?: string }) {
  return (
    <svg className={cx(styles.lantern, className)} viewBox="0 0 40 112" aria-hidden="true" focusable="false">
      <path className={styles.cord} d="M20 0 V34" />
      <path className={styles.lanternCap} d="M14 34 H26 L28 40 H12 Z" />
      <path className={styles.lanternShade} d="M12 40 H28 L35 62 L28 84 H12 L5 62 Z" />
      <path className={styles.lanternLight} d="M15 45 H25 L30 62 L25 79 H15 L10 62 Z" />
      <path className={styles.lanternTassel} d="M20 84 V102 M16 102 H24" />
    </svg>
  )
}

const RAYS = Array.from({ length: 12 }, (_, i) => i * 30)

/** One firework, bursting and fading on a loop. */
export function Firework({ className }: { className?: string }) {
  return (
    <svg className={cx(styles.firework, className)} viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
      {RAYS.map((angle) => (
        <path key={angle} className={styles.ray} d="M0 -14 V-38" transform={`rotate(${angle})`} />
      ))}
      {RAYS.map((angle) => (
        <circle key={`spark-${angle}`} className={styles.spark} cx="0" cy="-44" r="2.4" transform={`rotate(${angle + 15})`} />
      ))}
    </svg>
  )
}

const BULBS = Array.from({ length: 14 }, (_, i) => i)

/**
 * A string of fairy lights along the bottom of a header — only during the edition.
 *
 * Two strands of fourteen, interleaved, and it is the **strands** that twinkle, out of step:
 * two moving layers instead of twenty-eight. Measured on a slowed phone, twenty-eight bulbs
 * each animating their own opacity made every tap on a signed-in page wait for the frame —
 * the slowest went from about 100 ms to over 300.
 */
export function StringLights({ className }: { className?: string }) {
  return (
    <div className={cx(styles.lights, className)} aria-hidden="true">
      {['one', 'two'].map((strand) => (
        <span key={strand} className={cx(styles.strand, strand === 'two' ? styles.strandTwo : undefined)}>
          {BULBS.map((i) => (
            <span key={i} className={styles.bulb} />
          ))}
        </span>
      ))}
    </div>
  )
}

/** "Happy Diwali" beside the brand — only during the edition. Words, so a screen reader hears it too. */
export function DiwaliGreeting({ className }: { className?: string }) {
  return (
    <span className={cx(styles.greeting, className)}>
      <Diya className={styles.greetingDiya} />
      <span className={styles.greetingText}>Happy Diwali</span>
    </span>
  )
}
