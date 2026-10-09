/**
 * The homepage's switches, in one typed place (Milestone 30, Phase 3 — brief §3: "keep
 * every tunable in one typed config module — no magic numbers in components"), and since
 * Phase 4 the student dashboard's too (the daily lines, the motto, how much each card lists).
 *
 * Brand facts (the name, the year, the contact details) live in `lib/brand.ts`; the prize
 * wording and amount are owner-editable in Admin → Daily Quiz → Settings and come from
 * the server. This file holds only how the homepage is put together.
 */

/**
 * The homepage, top to bottom (brief §7.1: "keep the order in a config array"). Reorder
 * or switch a section off here; `Landing.tsx` renders whatever this lists.
 *
 * Two of the brief's sections are **absent on purpose** rather than switched off: the
 * Sunday Math Boss Battle and the Month-End Booster are events the product does not run
 * (PLAN.md Q6), and advertising one would be a promise nothing keeps. `about` is the
 * target of the navbar's About link — what the Olympiad offers, not an explanation of
 * the name (CLAUDE.md: the expansion is shown once, never glossed).
 *
 * `diwali` is the Diwali edition's "Diwali Special" band (Phase 7): always listed, and shown
 * only from 8 to 15 November 2026 — the dates, not this switch, decide (`lib/season.ts`).
 */
export const HOME_SECTIONS = [
  { id: 'hero', enabled: true },
  { id: 'diwali', enabled: true },
  { id: 'stats', enabled: true },
  { id: 'crack', enabled: true },
  { id: 'rewards', enabled: true },
  { id: 'about', enabled: true },
  { id: 'how', enabled: true },
  { id: 'journey', enabled: true },
  { id: 'scholars', enabled: true },
  { id: 'faq', enabled: true },
  { id: 'cta', enabled: true },
] as const satisfies ReadonlyArray<{ id: string; enabled: boolean }>

export type HomeSectionId = (typeof HOME_SECTIONS)[number]['id']

/** The live figures under the hero. Each can be hidden; all four are real counts. */
export const HOME_STATS = {
  studentsRegistered: true,
  schoolsRepresented: true,
  questionsSolved: true,
  studentsActiveToday: true,
} as const

/** "Can you crack this?" — seconds on the clock once the card is half in view. */
export const CRACK_THIS_SECONDS = 30

/**
 * "Can you crack this?" — how many past Daily Quiz problems per class group "Try another"
 * steps back through (the server allows 1–14). Only problems whose answers are already
 * public are ever sent: never today's.
 */
export const PAST_PROBLEMS_PER_GROUP = 7

/** How many published Daily Quiz winners the Rewards section shows — two months of four class bands. */
export const RECENT_WINNERS = 8

/** The podium (1–3) plus the table under it (4–8). */
export const TOP_SCHOLARS = 8

/**
 * The floating Daily Quiz button (brief §7.2). The homepage is the only page that renders
 * it — never an auth page, the admin area or the quiz page itself — and `showWhenNoQuiz`
 * decides whether it stays up, saying when the next one opens, on a day with nothing
 * scheduled for the student's class.
 */
export const DAILY_QUIZ_FAB = {
  showWhenNoQuiz: true,
} as const

/** The hero's quote card. A line of the brand's own, not attributed to a person. */
export const HERO_QUOTE = 'Small steps in the right direction give big results.'

// ---------------------------------------------------------------------------
// The student dashboard (Milestone 30, Phase 4 — brief §8)
// ---------------------------------------------------------------------------

/**
 * The welcome banner's line of the day — chosen by the server's IST date, so every student
 * sees the same one all day and a new one at midnight. The brand's own words, attributed
 * to nobody, like `HERO_QUOTE`.
 */
export const DAILY_QUOTES = [
  'Small steps in the right direction give big results in mathematics.',
  'Every problem you finish makes the next one a little easier.',
  'A mistake you understand is worth more than an answer you guessed.',
  'Ten focused minutes beat an hour of distraction.',
  'Read the question twice — most answers hide in its words.',
  'Practice does not make perfect. It makes progress.',
  'A hard question is a few easy steps you have not found yet.',
  'Show up today. Tomorrow’s rank is built now.',
] as const

/**
 * "Today’s Maths Thought", rotating daily out of step with the quote. Every statement here
 * is true as written — check a new one before adding it.
 */
export const MATHS_THOUGHTS = [
  'Every difficult problem is simply a collection of smaller problems waiting to be understood.',
  'There is no largest prime number: however big the one you know, a bigger one exists.',
  '1 + 2 + 3 + … + 100 = 5050. Pair the first number with the last, and the sum appears.',
  'A pattern spotted is half a problem solved.',
  'The angles of a triangle drawn on a flat page always add up to 180°.',
  'Estimating first tells you when an exact answer has gone wrong.',
  'If you can explain a solution in plain words, you have understood it.',
  'A quick diagram is often the fastest way into a geometry problem.',
] as const

/** The motivational card at the foot of the student sidebar, from 1280px (the mockup's line). */
export const SIDEBAR_MOTTO = 'Discipline today, a top rank tomorrow.'

/** How many recent events the dashboard's activity card lists ("View all" opens the rest). */
export const DASHBOARD_ACTIVITY = 3

/** How many chapters "Subject progress" shows — the ones with the most answers. */
export const DASHBOARD_CHAPTERS = 5
