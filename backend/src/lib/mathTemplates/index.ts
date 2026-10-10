import type { ClassLevel } from '../classLevels';
import type { Difficulty } from '../../models/Question';
import { pick, rngFor, shuffled, type Template } from './engine';
import { CLASS_3, CLASS_4, CLASS_5, CLASS_6, CLASS_7 } from './junior';
import { CLASS_8, CLASS_9, CLASS_10, CLASS_11, CLASS_12 } from './senior';

/**
 * Every class's fifteen templates, in class order (2026-10-10). The practice bank builds from all of
 * them; the automatic Daily Quiz draws from a class's own.
 */
export const TEMPLATES_BY_CLASS: ReadonlyArray<readonly [ClassLevel, Template[]]> = [
  ['Class 3', CLASS_3],
  ['Class 4', CLASS_4],
  ['Class 5', CLASS_5],
  ['Class 6', CLASS_6],
  ['Class 7', CLASS_7],
  ['Class 8', CLASS_8],
  ['Class 9', CLASS_9],
  ['Class 10', CLASS_10],
  ['Class 11', CLASS_11],
  ['Class 12', CLASS_12],
];

export function templatesFor(classLevel: ClassLevel): Template[] {
  const entry = TEMPLATES_BY_CLASS.find(([level]) => level === classLevel);
  if (!entry) throw new RangeError(`No question templates for ${classLevel}.`);
  return entry[1];
}

/** One generated Daily Quiz question: the bank fields the scheduler needs, options not yet shuffled. */
export interface QuizDraft {
  topic: string;
  difficulty: Difficulty;
  questionText: string;
  options: Array<{ text: string; isCorrect: boolean }>;
  solution: string;
}

/**
 * The generated Daily Quiz question for a class on a day (2026-10-10, owner: "generates a random
 * question as per the class level daily").
 *
 * Deterministic in its inputs — the same class, day and attempt always give the same question — so
 * two servers filling the same empty day reach the same question rather than two, and a test can
 * name what a day will hold. `attempt` moves to the next question when the caller has to refuse one
 * (its text is already in the bank, where a practice copy would give the answer away).
 *
 * Prefers a class's Medium and Hard templates, because the quiz decides a prize; falls back to the
 * Easy ones only if a class had none. Returns null when no template produced a usable question in a
 * few tries, which the caller treats as "try the next attempt".
 */
export function quizDraftFor(classLevel: ClassLevel, day: string, attempt: number): QuizDraft | null {
  const templates = templatesFor(classLevel);
  const harder = templates.filter((t) => t.d !== 'Easy');
  const pool = harder.length > 0 ? harder : templates;
  const rng = rngFor(`amit-quiz:${classLevel}:${day}:${attempt}`);
  for (let tries = 0; tries < 20; tries += 1) {
    const template = pick(rng, pool);
    const draft = template.make(rng);
    if (!draft.q) continue;
    const wrong: string[] = [];
    for (const option of draft.wrong) {
      if (option !== draft.a && !wrong.includes(option)) wrong.push(option);
      if (wrong.length === 3) break;
    }
    if (wrong.length < 3) continue;
    return {
      topic: template.topic,
      difficulty: template.d,
      questionText: draft.q,
      options: shuffled(rng, [{ text: draft.a, isCorrect: true }, ...wrong.map((text) => ({ text, isCorrect: false }))]),
      solution: draft.s,
    };
  }
  return null;
}
