import type { AdminQuestion, ClassLevel } from '../../api/types'

/**
 * Handing a selection of questions from the Question Bank to the Mock Test author or the Daily Quiz
 * console (Milestone 21, Phases H and I; the Daily Quiz since Milestone 30).
 *
 * ## Why a query string rather than router state
 *
 * `navigate(path, { state })` would be tidier to write and is the wrong choice here: it does not
 * survive a page refresh, and the two destinations are forms an administrator will reload while
 * filling in. A query string survives, and it is also linkable — "here are the twenty questions,
 * open the form" is a URL somebody can send to a colleague.
 *
 * Question ids are not secrets, so putting them in a URL costs nothing. **A selection of 100 ids is
 * about 2.4 KB**, comfortably inside every browser and proxy limit, and `MAX_HANDOFF` bounds it.
 *
 * ## Why the rules live here and not in the button
 *
 * Both destinations refuse things the Question Bank could otherwise offer — a mock test's paper must
 * be all one class, a Daily Quiz needs an *unpublished* one — and the honest behaviour is to
 * **explain why the action is unavailable** rather than to navigate somewhere that then rejects the
 * selection. Putting the check next to the URL builder means the button's tooltip and the
 * destination's validation are derived from the same statement of the rule.
 */

/** The most ids one hand-off may carry. Matches the bulk-status ceiling. */
export const MAX_HANDOFF = 100

/** The single class every question in a selection shares, or `null` when they do not share one. */
export function sharedClassLevel(questions: readonly AdminQuestion[]): ClassLevel | null {
  if (questions.length === 0) return null
  const first = questions[0]!.classLevel
  return questions.every((q) => q.classLevel === first) ? first : null
}

/** Whether a selection can become a mock-test paper, and why not when it cannot. */
export function mockTestHandoff(questions: readonly AdminQuestion[]): { url: string } | { reason: string } {
  if (questions.length === 0) return { reason: 'Select some questions first.' }
  if (questions.length > MAX_HANDOFF) {
    return { reason: `A paper can hold at most ${MAX_HANDOFF} questions.` }
  }

  /**
   * A paper is for one class, and the API refuses a question from another — `classLevel` is the
   * only thing that says who a question is for, so a mixed paper would be served to the wrong
   * children. Naming the classes is more use than "invalid selection".
   */
  const classLevel = sharedClassLevel(questions)
  if (!classLevel) {
    const classes = [...new Set(questions.map((q) => q.classLevel))].sort()
    return {
      reason: `A mock test is for one class, and this selection spans ${classes.join(', ')}. Filter by class first.`,
    }
  }

  const params = new URLSearchParams({ classLevel, questions: questions.map((q) => q.id).join(',') })
  return { url: `/admin/mock-tests/new?${params.toString()}` }
}

/** The most questions one hand-off to the Daily Quiz may carry — the bulk planner's own ceiling. */
export const MAX_QUIZ_HANDOFF = 60

/**
 * Whether a selection can become Daily Quizzes, and why not when it cannot (Milestone 30).
 *
 * The opposite rule to the old daily challenge, deliberately: a Daily Quiz carries a prize, so
 * its question must be **unpublished** — a published question's solution is already readable in
 * Practice, and the answer would be one search away. The question also has to be single choice
 * with a worked solution, because the solution is what unlocks the next day. One question opens
 * the scheduler; several open the bulk planner, one day each.
 */
export function dailyQuizHandoff(questions: readonly AdminQuestion[]): { url: string } | { reason: string } {
  if (questions.length === 0) return { reason: 'Select a question first.' }
  if (questions.length > MAX_QUIZ_HANDOFF) {
    return { reason: `Schedule at most ${MAX_QUIZ_HANDOFF} quizzes at a time.` }
  }
  if (questions.some((q) => q.status === 'published')) {
    return {
      reason:
        'A Daily Quiz needs an unpublished question — a published one’s solution is already open in Practice. Use a draft; it can be published for practice once the quiz’s answer is revealed.',
    }
  }
  if (questions.some((q) => q.status === 'archived')) {
    return { reason: 'An archived question cannot be a Daily Quiz.' }
  }
  if (questions.some((q) => q.type !== 'single_choice')) {
    return { reason: 'A Daily Quiz is single choice — one correct option out of 2 to 6.' }
  }
  if (questions.some((q) => !q.solution || q.solution.trim().length === 0)) {
    return { reason: 'Every Daily Quiz needs a worked solution, because it unlocks the next day. Add one first.' }
  }

  const params = new URLSearchParams({ questions: questions.map((q) => q.id).join(',') })
  return { url: `/admin/daily-quiz?${params.toString()}` }
}
