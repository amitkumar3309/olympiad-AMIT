/**
 * The homepage's picture of the day (owner, 2026-10-09: "a positive and motivational one … updated
 * regularly"), redrawn on 2026-10-09 as **a figure of the day** — pieces of real mathematics,
 * each drawn exactly and captioned with a line that is true as written: compound growth, the
 * Fibonacci spiral, Pythagoras, Gauss's staircase, doubling, the primes and a triangle's angles.
 *
 * A plain list, apart from the drawings (`pages/Landing/sections/HeroArt.tsx`), because the build
 * reads its length: `vite.seo.ts` writes it into `<meta name="amit-art">`, and `public/boot.js` picks
 * today's — by the India date — before the first paint. The homepage is drawn at build time for
 * everybody, so choosing it in React would show yesterday's figure first and swap it when the app
 * took over.
 *
 * **Sixteen since 2026-10-10**: the seven drawn here, and nine of the owner's own 335 designs — the
 * ones whose drawing really shows its topic and whose words are correct (the rest repeated ten
 * drawings in order whatever the topic, and were left out). Those nine are pictures of the drawing
 * alone (`src/assets/figures/`); their name, formula and line are text, like the seven's. Mixed in
 * this order so a drawn figure and a picture alternate rather than nine pictures arriving in a row.
 *
 * Add a figure by adding its name here and its drawing or picture there (the types insist on one),
 * and a line for its index in `HeroArt.module.css`.
 */
export const PICTURES_OF_THE_DAY = [
  'growth',
  'symmetry',
  'fibonacci',
  'circle-equation',
  'pythagoras',
  'continuity',
  'staircase',
  'triangle-inequality',
  'doubling',
  'shortest-path',
  'primes',
  'infinity',
  'angles',
  'congruent-figures',
  'fair-division',
  'isoperimetric',
] as const

export type PictureOfTheDay = (typeof PICTURES_OF_THE_DAY)[number]
