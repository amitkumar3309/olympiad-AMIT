/**
 * The classes a student may register for.
 *
 * Classes 5–11 are a plain year. Class 12 is split by stream, because the
 * competition paper differs between them — so the stream has to be part of the
 * stored value rather than a separate optional field that half the rows would
 * leave empty.
 *
 * Kept here (not in the model or the zod schema) because both of those need it,
 * and the frontend mirrors the same list in `frontend/src/api/types.ts`.
 */
export const CLASS_LEVELS = [
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12 - Science',
  'Class 12 - Commerce',
  'Class 12 - Humanities',
] as const;

export type ClassLevel = (typeof CLASS_LEVELS)[number];

export function isClassLevel(value: unknown): value is ClassLevel {
  return typeof value === 'string' && (CLASS_LEVELS as readonly string[]).includes(value);
}
