import { z } from 'zod';
import mongoose from 'mongoose';
import { isDayKey, isMonthKey } from '../lib/competitionDay';
import { CLASS_GROUPS, isPrizeBandKey, MAX_CLASS, MIN_CLASS, PRIZE_DESK_VIEWS, type PrizeBandKey } from '../lib/dailyQuiz';
import type { ImportFileKind } from '../lib/importTypes';
import { DIFFICULTIES } from '../models/Question';
import { AUTO_QUIZ_SOURCES, REMINDER_DAILY_CAP_MAX } from '../models/DailyQuizSettings';
import { QUIZ_IMPORT_MAX_ROWS } from '../services/dailyQuizImportService';
import { reviewedImportQuestion } from './importSchemas';
import { importFileSchema } from './uploadSchemas';

/**
 * Daily Quiz request validation (Milestone 30; it replaced the daily challenge's).
 *
 * Absent from every student schema, and the absence is the point — `validate` replaces
 * `req.body` with the parse result, so a field no schema mentions cannot reach a handler:
 *
 *  - **The day, the time, the solve time.** The server's clock decides all three. A
 *    request that could name a time could claim a faster solve or answer a closed quiz.
 *  - **Anything about the outcome.** No `isCorrect`, no `xpAwarded`. Marking and the
 *    reward are the server's.
 *  - **An option key.** A student sends the opaque id they were shown, never the bank's
 *    `a`/`b`/`c`/`d`.
 */

const objectId = z
  .string()
  .trim()
  .refine((value) => mongoose.isValidObjectId(value), { message: 'That is not a valid identifier.' });

const dayKey = z
  .string()
  .trim()
  .refine(isDayKey, { message: 'Use a real calendar date in YYYY-MM-DD form.' });

const classNumber = z.coerce
  .number()
  .int()
  .min(MIN_CLASS, `Classes run from ${MIN_CLASS} to ${MAX_CLASS}.`)
  .max(MAX_CLASS, `Classes run from ${MIN_CLASS} to ${MAX_CLASS}.`);

const classRange = { classMin: classNumber, classMax: classNumber };
const rangeInOrder = (value: { classMin: number; classMax: number }) => value.classMin <= value.classMax;
const rangeMessage = { message: 'The first class must not be after the last.', path: ['classMax'] };

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/** The one thing a student sends: the opaque id of the option they chose. */
export const submitQuizSchema = z.object({
  selectedOptionId: z
    .string()
    .trim()
    .regex(/^o[0-9a-f]{10}$/, 'Choose one of the options shown.'),
});
export type SubmitQuizBody = z.infer<typeof submitQuizSchema>;

export const quizHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type QuizHistoryQuery = z.infer<typeof quizHistoryQuerySchema>;

export const publicWinnersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(7),
});
export type PublicWinnersQuery = z.infer<typeof publicWinnersQuerySchema>;

/** How many past problems per class group — a week by default, a fortnight at most. */
export const pastProblemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(14).default(7),
});
export type PastProblemsQuery = z.infer<typeof pastProblemsQuerySchema>;

/**
 * One page of the public archive (Milestone 30 Phase 7): a class group, the day to page back
 * from, and how many days. No value of `before` can reach an unrevealed quiz — the service
 * pages from the earlier of it and today — so it needs no upper bound here.
 */
export const quizArchiveQuerySchema = z.object({
  group: z
    .string()
    .trim()
    .refine((value) => CLASS_GROUPS.some((group) => group.key === value), {
      message: `Choose a class group: ${CLASS_GROUPS.map((group) => group.key).join(', ')}.`,
    }),
  before: dayKey.optional(),
  days: z.coerce.number().int().min(1).max(31).default(14),
});
export type QuizArchiveQuery = z.infer<typeof quizArchiveQuerySchema>;

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const scheduleQuizSchema = z
  .object({ day: dayKey, ...classRange, questionId: objectId })
  .refine(rangeInOrder, rangeMessage);
export type ScheduleQuizBody = z.infer<typeof scheduleQuizSchema>;

/**
 * Loading weeks of quizzes at once. `dryRun` defaults to **true**: the first call shows
 * the plan and writes nothing, and the administrator confirms with a second call.
 */
export const bulkScheduleSchema = z
  .object({
    ...classRange,
    startDay: dayKey,
    questionIds: z.array(objectId).min(1, 'Choose at least one question.').max(60, 'At most 60 questions at a time.'),
    dryRun: z.boolean().default(true),
  })
  .refine(rangeInOrder, rangeMessage);
export type BulkScheduleBody = z.infer<typeof bulkScheduleSchema>;

export const changeQuizSchema = z.object({ questionId: objectId });
export type ChangeQuizBody = z.infer<typeof changeQuizSchema>;

export const groupIdParamSchema = z.object({ groupId: objectId });

export const listQuizzesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  from: dayKey.optional(),
  to: dayKey.optional(),
});
export type ListQuizzesQuery = z.infer<typeof listQuizzesQuerySchema>;

export const candidatesQuerySchema = z
  .object({
    ...classRange,
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine(rangeInOrder, rangeMessage);
export type CandidatesQuery = z.infer<typeof candidatesQuerySchema>;

export const winnerActionParamSchema = z.object({
  winnerId: objectId,
  action: z.enum(['confirm', 'disqualify', 'publish', 'contacted', 'delivered']),
});

const monthKey = z.string().refine(isMonthKey, 'Name a month as YYYY-MM, for example 2026-11.');

/** The monthly winners page: one month, or the default when none is named. */
export const monthlyWinnersQuerySchema = z.object({ month: monthKey.optional() });
export type MonthlyWinnersQuery = z.infer<typeof monthlyWinnersQuerySchema>;

/** Working out one month's candidates in one class band. */
export const monthlyComputeParamSchema = z.object({
  month: monthKey,
  band: z.string().refine(isPrizeBandKey, 'Name a class band: 3-5, 6-8, 9-10 or 11-12.') as z.ZodType<PrizeBandKey>,
});

export const prizeDeskQuerySchema = z.object({
  view: z.enum(PRIZE_DESK_VIEWS).default('outstanding'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type PrizeDeskQuery = z.infer<typeof prizeDeskQuerySchema>;

/**
 * A reason is required to disqualify; the service enforces it, since only it sees the action.
 * Every other action carries no body at all, which is why a missing one is an empty one.
 */
export const winnerActionBodySchema = z
  .object({
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .default({});
export type WinnerActionBody = z.infer<typeof winnerActionBodySchema>;

// ---------------------------------------------------------------------------
// Bulk import (a file of quizzes — see services/dailyQuizImportService.ts)
// ---------------------------------------------------------------------------

/** One file to preview. Nothing is saved by this request but the importer's batch row. */
export function quizImportPreviewSchema(kind: ImportFileKind) {
  return z.object({
    file: importFileSchema(kind),
    /** The chapter for rows that name none and whose chapter cannot be detected. Optional. */
    topic: objectId.nullish().default(null),
    difficulty: z.enum(DIFFICULTIES).default('Medium'),
  });
}
export type QuizImportPreviewBody = z.infer<ReturnType<typeof quizImportPreviewSchema>>;

/**
 * The previewed rows the administrator approved, sent back to be saved and scheduled.
 * The question in each is re-validated by the importer; the day and range by the quiz.
 */
export const quizImportApproveSchema = z.object({
  batchId: objectId,
  rows: z
    .array(
      z
        .object({
          clientId: z.string().trim().min(1).max(80),
          sourceRef: z.string().trim().max(300),
          day: dayKey,
          ...classRange,
          question: reviewedImportQuestion,
        })
        .refine(rangeInOrder, rangeMessage),
    )
    .min(1, 'Choose at least one quiz to schedule.')
    .max(QUIZ_IMPORT_MAX_ROWS, `Schedule at most ${QUIZ_IMPORT_MAX_ROWS} quizzes at a time.`),
});
export type QuizImportApproveBody = z.infer<typeof quizImportApproveSchema>;

export const quizTemplateQuerySchema = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
});
export type QuizTemplateQuery = z.infer<typeof quizTemplateQuerySchema>;

/**
 * The owner-editable settings. `cashAmount` is a whole number of rupees or null — and
 * null is the default, so no figure is ever shown until someone chooses one. How winners are
 * chosen is not a setting since the prize became monthly (PLAN.md Q24): a request still
 * naming `winnerRule` or `winnersPerQuiz` has them dropped, like any field not listed here.
 *
 * The two reminder settings (Milestone 30 Phase 7b) are **optional**: a request that leaves
 * one out keeps the stored value rather than resetting it. `lastReminderRun` is absent on
 * purpose — the job writes it, and a person cannot.
 */
export const quizSettingsSchema = z.object({
  prizeHeadline: z.string().trim().min(3, 'Add a headline.').max(80),
  prizeText: z.string().trim().min(3, 'Describe the prize.').max(120),
  cashAmount: z.number().int('Use a whole number of rupees.').min(0).max(100000).nullable(),
  instantResult: z.boolean(),
  remindersEnabled: z.boolean().optional(),
  reminderDailyCap: z
    .number()
    .int('Use a whole number of emails.')
    .min(0, 'Use 0 or more.')
    .max(
      REMINDER_DAILY_CAP_MAX,
      `At most ${REMINDER_DAILY_CAP_MAX} a day — that is the email provider's whole free daily quota, which sign-ups share.`,
    )
    .optional(),
  // Automation (2026-10-10), optional for the same reason the reminder settings are.
  autoSchedule: z.boolean().optional(),
  autoSource: z.enum(AUTO_QUIZ_SOURCES).optional(),
});
export type QuizSettingsBody = z.infer<typeof quizSettingsSchema>;
