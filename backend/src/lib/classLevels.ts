/**
 * The classes a student may register for: **Class 3 to Class 12.**
 *
 * Kept here (not in the model or the zod schema) because both of those need it, and the frontend
 * mirrors the same list in `frontend/src/api/types.ts`. That mirror is a *list* only — the zod
 * schema is what actually enforces it, so a stale copy can never widen what the API accepts.
 *
 * ## The Class 12 streams are gone (Milestone 21, Phase J)
 *
 * This list used to run Class 5–11 plus **three** Class 12 entries — `Class 12 - Science`,
 * `- Commerce` and `- Humanities` — because the competition paper differed by stream. The owner
 * collapsed them into a single `Class 12` on 2026-08-23, and the consequence is deliberate and worth
 * stating where somebody will read it: **a Commerce student and a Science student now sit the same
 * papers.** They share one practice pool, one mock test list, and one daily challenge per day.
 *
 * If a stream ever needs to matter again, it must **not** come back as three class values. That
 * shape put a curriculum distinction inside the field that decides which children see which
 * questions, so every filter, index and unique constraint had to carry it. A separate optional
 * `stream` field on `Student` is the shape to reach for.
 *
 * ## Why they are strings and not numbers
 *
 * `classLevel` is a stored enum on **nine** collections (`Student`, `Question`, `MockTest`,
 * `DailyChallenge`, `PracticeSession`, `Exam`, `Notification`, plus the historical `Certificate` and
 * `GenerationLog`), it appears in compound indexes, and it is printed on certificates. Moving to
 * integers would be a migration of every one of those for a cosmetic gain; the owner chose the
 * string form for exactly that reason.
 *
 * ## Order matters
 *
 * The array order is the order every dropdown in the product offers, so it is ascending by year
 * rather than alphabetical — `Class 10` must not sort between `Class 1` and `Class 2`.
 */
export const CLASS_LEVELS = [
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
] as const;

export type ClassLevel = (typeof CLASS_LEVELS)[number];

export function isClassLevel(value: unknown): value is ClassLevel {
  return typeof value === 'string' && (CLASS_LEVELS as readonly string[]).includes(value);
}

/**
 * The class values this platform used to run and no longer does, mapped to their replacement.
 *
 * Kept in code rather than only in the migration script because two things need it: the script that
 * rewrites stored data, and any future reader wondering why a `Certificate` printed a class that is
 * not in `CLASS_LEVELS`. A certificate is a **snapshot of what was awarded** and is deliberately not
 * migrated — rewriting it would make the record disagree with the paper a child was handed.
 */
export const RETIRED_CLASS_LEVELS: Readonly<Record<string, ClassLevel>> = {
  'Class 12 - Science': 'Class 12',
  'Class 12 - Commerce': 'Class 12',
  'Class 12 - Humanities': 'Class 12',
};

/** The current value for a class that may have been written before Phase J. */
export function currentClassLevel(stored: string): ClassLevel | null {
  if (isClassLevel(stored)) return stored;
  return RETIRED_CLASS_LEVELS[stored] ?? null;
}
