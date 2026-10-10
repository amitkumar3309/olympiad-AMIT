/**
 * The homepage's picture of the day (owner, 2026-10-09: "a positive and motivational one … updated
 * regularly"), redrawn on 2026-10-09 as **a figure of the day** — seven pieces of real mathematics,
 * each drawn exactly and captioned with a line that is true as written: compound growth, the
 * Fibonacci spiral, Pythagoras, Gauss's staircase, doubling, the primes and a triangle's angles.
 *
 * A plain list, apart from the drawings (`pages/Landing/sections/HeroArt.tsx`), because the build
 * reads its length: `vite.seo.ts` writes it into `<meta name="amit-art">`, and `public/boot.js` picks
 * today's — by the India date — before the first paint. The homepage is drawn at build time for
 * everybody, so choosing it in React would show yesterday's figure first and swap it when the app
 * took over.
 *
 * Add a figure by adding its name here and its drawing there (the types insist on both), and a line
 * for its index in `HeroArt.module.css`.
 */
export const PICTURES_OF_THE_DAY = ['growth', 'fibonacci', 'pythagoras', 'staircase', 'doubling', 'primes', 'angles'] as const

export type PictureOfTheDay = (typeof PICTURES_OF_THE_DAY)[number]
