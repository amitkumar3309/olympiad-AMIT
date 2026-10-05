/**
 * The homepage's switches, in one typed place (Milestone 30, Phase 3 — brief §3: "keep
 * every tunable in one typed config module — no magic numbers in components").
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
 */
export const HOME_SECTIONS = [
  { id: 'hero', enabled: true },
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

/** How many published Daily Quiz winners the Rewards section shows. */
export const RECENT_WINNERS = 7

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
