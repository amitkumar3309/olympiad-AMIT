/**
 * The homepage's picture of the day (owner, 2026-10-09): the hero's square shows one of these
 * drawn pictures — something positive to start on — and a different one each day.
 *
 * A plain list, apart from the drawings (`pages/Landing/sections/PictureOfTheDay.tsx`), because
 * the build reads its length: `vite.seo.ts` writes it into `<meta name="amit-art">`, and
 * `public/boot.js` picks today's — by the India date — before the first paint. The homepage is
 * drawn at build time for everybody, so choosing it in React would show yesterday's picture first
 * and swap it when the app took over.
 *
 * Add a picture by adding its name here and its drawing there (the types insist on both), and a
 * line for its index in `PictureOfTheDay.module.css`.
 */
export const PICTURES_OF_THE_DAY = ['summit', 'growth', 'idea', 'rocket', 'stairs', 'sunrise', 'target'] as const

export type PictureOfTheDay = (typeof PICTURES_OF_THE_DAY)[number]
