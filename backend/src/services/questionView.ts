import type { QuestionDocument } from '../models';

/**
 * The **student** view of a question — the answer-stripped shape.
 *
 * This is the security-critical projection in the question bank. Before Milestone 4
 * the questions endpoint had no authentication at all and returned raw documents, so
 * `correctAnswer` — the entire answer key — was readable by anyone on the internet.
 * It is now an explicit allow-list, and the things that would give the answer away
 * are omitted by construction rather than deleted afterwards:
 *
 *  - `isCorrect` on each option (options keep only `key` and `text`),
 *  - `booleanAnswer` / `numericAnswer` / `tolerance`,
 *  - `acceptedAnswers` (the `fill_blank` key, Milestone 18),
 *  - `solution`.
 *
 * Being an **allow-list** is what made the Milestone 18 question type safe for free:
 * `acceptedAnswers` was added to the model and was never at risk of appearing here,
 * because a new field has to be named to be served. A deny-list would have leaked it.
 *
 * Adding a field here is therefore a deliberate act. Tests assert none of those
 * names appears in any student-facing response body.
 *
 * It lives in its own module, rather than inside `questions.routes.ts` where it
 * began, because a second student-facing surface (the daily challenge) now needs the
 * same projection. One shared definition is the point: a hand-written second
 * stripper somewhere else is exactly how an answer key leaks. Note that this is
 * still **not** merged with the author view in `questionsAdmin.routes.ts` — those
 * remain two separate functions rather than one with an `includeAnswers` flag, on
 * purpose (see CLAUDE.md "Backend Conventions").
 */

/**
 * A populated `subject` / `topic` ref, once `.populate('subject', 'name slug')` has
 * run. Mongoose types the field as the id, so this narrows it without `any`.
 */
interface PopulatedRef {
  _id: unknown;
  name?: string;
  slug?: string;
}

export function refView(value: unknown): { id: string; name: string | null } | null {
  if (!value) return null;
  if (typeof value === 'object' && 'name' in (value as PopulatedRef)) {
    const ref = value as PopulatedRef;
    return { id: String(ref._id), name: ref.name ?? null };
  }
  return { id: String(value), name: null };
}

export function studentQuestionView(question: QuestionDocument) {
  return {
    id: String(question._id),
    questionText: question.questionText,
    type: question.type,
    // Only the key and the text — never `isCorrect`.
    options: question.options.map((option) => ({ key: option.key, text: option.text })),
    subject: refView(question.subject),
    topic: refView(question.topic),
    subtopic: refView(question.subtopic),
    classLevel: question.classLevel,
    difficulty: question.difficulty,
    marks: question.marks,
    negativeMarks: question.negativeMarks,
    tags: question.tags,
    revision: question.revision,
  };
}
