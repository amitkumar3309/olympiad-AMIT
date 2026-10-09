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
 * ## A trial on the live site
 *
 * `trial` turns the same edition on for a few hours before its dates — for the owner to see it
 * where students will (the first, 9–10 October 2026, was "for testing purpose"). It ends by
 * itself, and its intro is remembered under its own id, so a browser that saw it during a trial
 * still plays it when the real week comes. **It is not copied into the backend on purpose**: a
 * trial must never award the Diwali 2026 badge, so the badge's promise keeps naming the real days.
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
  /** A few hours of the edition before its dates, on the live site (see above). Null when none is set. */
  trial?: { id: string; startsAt: string; endsAt: string } | null
}

/** Diwali 2026: from 12:00 AM on Sunday 8 November to the end of Sunday 15 November, India time. */
export const DIWALI_EDITION: FestiveEdition = {
  kind: 'diwali',
  id: 'diwali-2026',
  startsAt: '2026-11-08T00:00:00+05:30',
  endsAt: '2026-11-16T00:00:00+05:30',
  // The owner's 24-hour test on the live site (2026-10-09): until 6:30 PM on 10 October, India
  // time. It switches itself off; set this back to null afterwards.
  trial: { id: 'diwali-2026-trial', startsAt: '2026-10-09T17:30:00+05:30', endsAt: '2026-10-10T18:30:00+05:30' },
}

const within = (nowMs: number, startsAt: string, endsAt: string) => nowMs >= Date.parse(startsAt) && nowMs < Date.parse(endsAt)

/**
 * When the edition on show ends: a trial's end while only the trial is on, otherwise the week's.
 * For the hero's countdown, which runs only while `<html data-season>` is set.
 */
export function editionEndsAt(edition: FestiveEdition = DIWALI_EDITION, nowMs: number = Date.now()): string {
  const trial = edition.trial
  if (trial && !within(nowMs, edition.startsAt, edition.endsAt) && within(nowMs, trial.startsAt, trial.endsAt)) return trial.endsAt
  return edition.endsAt
}

/** The intro's element, drawn outside the app's root by `vite.prerender.ts`. */
export const INTRO_ID = 'amit-intro'

/**
 * How long the intro may cover the page, at most: `public/boot.js` (the homepage) and
 * `DiwaliIntroPlayer` (the student area) end it here whether or not its animation ever ran.
 * The animation itself is done by 7.2 s (`DiwaliIntro.module.css`). It was two seconds, the
 * owner's first ask; on seeing it, "very fast … users might not be able to process it", so
 * since 2026-10-09 each number of the count has a full second. Any key, tap or scroll still
 * ends it at once.
 */
export const INTRO_MS = 7300

/**
 * What `public/boot.js` parses out of `<meta name="amit-season">`:
 * "kind id startsAt endsAt introMs", and while a trial is set "… trialId trialStartsAt trialEndsAt"
 * — so that script holds no date or duration of its own.
 */
export function seasonMetaContent(edition: FestiveEdition = DIWALI_EDITION): string {
  const trial = edition.trial ? [edition.trial.id, edition.trial.startsAt, edition.trial.endsAt] : []
  return [edition.kind, edition.id, edition.startsAt, edition.endsAt, String(INTRO_MS), ...trial].join(' ')
}
