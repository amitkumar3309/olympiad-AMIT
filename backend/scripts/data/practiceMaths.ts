import type { ClassLevel } from '../../src/lib/classLevels';
import { buildBank, type Template } from './practiceGen';
import { CLASS_3, CLASS_4, CLASS_5, CLASS_6, CLASS_7 } from './practiceJunior';
import { CLASS_8, CLASS_9, CLASS_10, CLASS_11, CLASS_12 } from './practiceSenior';
import type { SeedSubject } from './seedTypes';

/**
 * The practice bank: 150 Mathematics questions for every class from 3 to 12 (owner, 2026-10-10 —
 * "add 150 questions for each class … for Practice sessions"). Each class is fifteen templates of
 * ten questions, matched to that class's syllabus, and every answer is computed by the template
 * from the numbers in its own question. Seeded by `scripts/seed-practice.ts`.
 */

const TEMPLATES: Array<[ClassLevel, Template[]]> = [
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

export const PRACTICE_PER_CLASS = 150;

/** Built on demand: the generation is deterministic, so every call returns the same questions. */
export function practiceBanks(): Array<{ classLevel: ClassLevel; data: SeedSubject }> {
  return TEMPLATES.map(([classLevel, templates]) => ({ classLevel, data: buildBank(classLevel, templates) }));
}
