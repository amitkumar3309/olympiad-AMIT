/**
 * The festive editions (Milestone 30 Phase 7 — owner, 2026-10-08): **the Diwali edition, 8 to 15
 * November 2026**, and back to the everyday site on the 16th with nothing to undo.
 *
 * ## How an edition switches itself on and off
 *
 * `vite.seo.ts` writes these dates into a `<meta name="amit-season">` above `public/boot.js`,
 * which — before the first paint, like the theme — sets `<html data-season="diwali">` while
 * the edition is on. **Every festive touch is CSS keyed on that attribute**: the markup is
 * always there (hidden outside the dates), so the homepage drawn at build time needs no
 * second version, nothing moves when the app takes over, and no render reads the date.
 *
 * `?season=diwali` previews the edition for the rest of a tab's session (and replays the
 * intro); `?season=off` hides it; `?season=auto` goes back to the dates.
 *
 * The backend keeps its own copy of the days, for the Diwali 2026 achievement
 * (`backend/src/lib/seasons.ts`) — change both together.
 *
 * **No React and no browser API in this file** — the build imports it under Node.
 */

export interface FestiveEdition {
  /** The `data-season` value on `<html>`, and what `?season=` previews. */
  kind: 'diwali'
  /** This one edition of its kind — the key the intro remembers having been seen by. */
  id: string
  /** The first instant, India time. */
  startsAt: string
  /** The first instant **after** it — exclusive. */
  endsAt: string
}

/** Diwali 2026: from 12:00 AM on Sunday 8 November to the end of Sunday 15 November, India time. */
export const DIWALI_EDITION: FestiveEdition = {
  kind: 'diwali',
  id: 'diwali-2026',
  startsAt: '2026-11-08T00:00:00+05:30',
  endsAt: '2026-11-16T00:00:00+05:30',
}

/** The intro's element, drawn outside the app's root by `vite.prerender.ts`. */
export const INTRO_ID = 'amit-intro'

/**
 * How long the intro may cover the homepage, at most: `public/boot.js` ends it here whether or
 * not its animation ever ran. The animation itself is done by 2.0 s (`DiwaliIntro.module.css`) —
 * the owner's "two seconds", and also what keeps the hero's first paint, which waits for the
 * intro to fade, inside the brief's 2.5 s (LCP) on a slowed phone.
 */
export const INTRO_MS = 2100

/**
 * What `public/boot.js` parses out of `<meta name="amit-season">`:
 * "kind id startsAt endsAt introMs" — so that script holds no date or duration of its own.
 */
export function seasonMetaContent(edition: FestiveEdition = DIWALI_EDITION): string {
  return [edition.kind, edition.id, edition.startsAt, edition.endsAt, String(INTRO_MS)].join(' ')
}
