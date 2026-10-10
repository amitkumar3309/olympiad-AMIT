import type { ClassLevel } from '../../src/lib/classLevels';
import { TEMPLATES_BY_CLASS } from '../../src/lib/mathTemplates';
import { buildBank } from './practiceGen';
import type { SeedSubject } from './seedTypes';

/**
 * The practice bank: 150 Mathematics questions for every class from 3 to 12 (owner, 2026-10-10 —
 * "add 150 questions for each class … for Practice sessions"). Each class is fifteen templates of
 * ten questions, matched to that class's syllabus, and every answer is computed by the template
 * from the numbers in its own question. Seeded by `scripts/seed-practice.ts`.
 */

export const PRACTICE_PER_CLASS = 150;

/** Built on demand: the generation is deterministic, so every call returns the same questions. */
export function practiceBanks(): Array<{ classLevel: ClassLevel; data: SeedSubject }> {
  return TEMPLATES_BY_CLASS.map(([classLevel, templates]) => ({ classLevel, data: buildBank(classLevel, templates) }));
}
