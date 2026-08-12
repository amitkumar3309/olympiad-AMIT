import { z } from 'zod';
import mongoose from 'mongoose';
import { CLASS_LEVELS } from '../lib/classLevels';
import { isDayKey } from '../lib/competitionDay';

/**
 * Daily challenge request validation (Milestone 8).
 *
 * Two things are deliberately **absent** from every schema here, and their absence is
 * the point — `validate` replaces `req.body` with the parse result, so a field no
 * schema mentions cannot reach a handler:
 *
 *  - **The day, on the student side.** Which day it is, is the server's decision, taken
 *    from `lib/competitionDay.ts`. If a client could name the day it was answering, a
 *    student could claim yesterday's reward and tomorrow's, and a browser in another
 *    timezone would disagree about which challenge is today's.
 *  - **Anything about the outcome.** No `isCorrect`, `awardedMarks` or `xpAwarded`.
 *    Grading and the reward are the server's, and nothing a student sends is trusted
 *    as either.
 */

const objectId = z
  .string()
  .trim()
  .refine((value) => mongoose.isValidObjectId(value), { message: 'That is not a valid identifier.' });

/**
 * A competition day, as staff type it when scheduling.
 *
 * Validated with the same `isDayKey` the rest of the backend uses, so `2026-02-30` is
 * refused here rather than becoming a challenge nobody can ever be served.
 */
const dayKey = z
  .string()
  .trim()
  .refine(isDayKey, { message: 'Use a real calendar date in YYYY-MM-DD form.' });

/** Scheduling a challenge. The day is explicit here because staff choose it. */
export const scheduleChallengeSchema = z.object({
  day: dayKey,
  classLevel: z.enum(CLASS_LEVELS),
  questionId: objectId,
});
export type ScheduleChallengeBody = z.infer<typeof scheduleChallengeSchema>;

/**
 * Re-pointing a scheduled day at a different question. Only the question may change:
 * moving a challenge to another day or class would be indistinguishable from deleting
 * one and scheduling another, and the unique index makes the two-step version safe.
 */
export const rescheduleChallengeSchema = z.object({ questionId: objectId });
export type RescheduleChallengeBody = z.infer<typeof rescheduleChallengeSchema>;

export const challengeIdParamSchema = z.object({ id: objectId });

export const listChallengesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  classLevel: z.enum(CLASS_LEVELS).optional(),
  from: dayKey.optional(),
  to: dayKey.optional(),
});
export type ListChallengesQuery = z.infer<typeof listChallengesQuerySchema>;

/**
 * Answering today's challenge.
 *
 * All three response shapes are optional because only the one belonging to the
 * question's own type is read — but unlike a practice or mock-test answer, a *blank*
 * submission is refused by the service rather than stored. A challenge has one
 * question: skipping it is not a choice to record, and accepting a blank would hand
 * over the day's reward for nothing.
 */
export const answerChallengeSchema = z.object({
  selectedOptionKeys: z.array(z.string().trim().min(1).max(4)).max(10).optional(),
  numericResponse: z.number().finite().nullable().optional(),
  booleanResponse: z.boolean().nullable().optional(),
});
export type AnswerChallengeBody = z.infer<typeof answerChallengeSchema>;

export const listChallengeHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ListChallengeHistoryQuery = z.infer<typeof listChallengeHistoryQuerySchema>;
