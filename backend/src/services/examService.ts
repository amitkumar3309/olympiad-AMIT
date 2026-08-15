import { Types } from 'mongoose';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import type { ClassLevel } from '../lib/classLevels';
import {
  ExamAttempt,
  Question,
  Result,
  type ExamAttemptDocument,
  type ExamDocument,
  type ExamStatus,
  type ExamSubmissionReason,
} from '../models';
import type { AttemptAnswerEntry } from '../models/attemptAnswer';
import { snapshotOf } from './attemptSnapshot';
import { gradeEntries, isAnswered } from './grading';

/**
 * The official Olympiad sitting (Milestone 13).
 *
 * Mirrors the *patterns* `mockTestService` established — server-owned clock, answer-key
 * snapshot at serve time, submission closed by a conditional write, lazy expiry sweep —
 * without sharing its collections, because a mock is a rehearsal and this is the
 * sitting that produces a rank and a certificate (see DECISIONS.md).
 *
 * Three things are deliberately different from a mock test:
 *
 * 1. **One attempt, ever.** Enforced by a unique index on `{exam, student}`, not by
 *    counting.
 * 2. **The window is mandatory**, because the organisers announce it in advance.
 * 3. **A score is not a result.** Submitting grades the attempt; it publishes nothing.
 *    Ranks and certificates come from `publishResults()`, which an administrator runs
 *    once the window has closed.
 */

/** Below this, starting is refused rather than handing out a paper that dies at once. */
const MIN_START_SECONDS = 60;

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface ExamAvailability {
  open: boolean;
  reason: 'open' | 'not-open-yet' | 'closed' | 'not-published';
  opensAt: Date;
  closesAt: Date;
}

export function availabilityOf(exam: ExamDocument, now = new Date()): ExamAvailability {
  const base = { opensAt: exam.opensAt, closesAt: exam.closesAt };
  if (exam.status !== 'published') return { open: false, reason: 'not-published', ...base };
  if (now < exam.opensAt) return { open: false, reason: 'not-open-yet', ...base };
  if (now > exam.closesAt) return { open: false, reason: 'closed', ...base };
  return { open: true, reason: 'open', ...base };
}

/**
 * The deadline for one attempt: the sooner of the paper's duration and the close of
 * the announced window. A student who starts five minutes before the window shuts
 * gets five minutes, not the full duration — otherwise the announced close would mean
 * nothing.
 */
export function deadlineFor(exam: ExamDocument, startedAt: Date): Date {
  const byDuration = new Date(startedAt.getTime() + exam.durationMinutes * 60_000);
  return exam.closesAt < byDuration ? exam.closesAt : byDuration;
}

// ---------------------------------------------------------------------------
// Sitting
// ---------------------------------------------------------------------------

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export interface StartExamInput {
  exam: ExamDocument;
  student: Types.ObjectId;
  studentClassLevel: ClassLevel | null | undefined;
  now?: Date;
}

export interface StartExamResult {
  attempt: ExamAttemptDocument;
  /** False when the student's existing attempt was resumed rather than one created. */
  created: boolean;
}

/**
 * Starts the student's one attempt, or resumes it.
 *
 * Resuming is checked first, and it resumes **whatever the window now says**: a
 * student admitted legitimately must come back to the same attempt with the same
 * deadline after a reload or a dropped connection, and closing the exam mid-paper must
 * not void their work. It is also what stops "start again" being a way to buy time.
 *
 * A **submitted** attempt is not resumable and not repeatable — for an official
 * sitting that is the whole point, so it is a refusal rather than a new attempt.
 */
export async function startExamAttempt(input: StartExamInput): Promise<StartExamResult> {
  const now = input.now ?? new Date();
  const { exam } = input;

  if (!input.studentClassLevel) {
    throw ApiError.forbidden('Your account has no class on it, so it cannot sit an exam.');
  }
  if (exam.classLevel !== input.studentClassLevel) {
    throw ApiError.forbidden(`This exam is set for ${exam.classLevel}, so you cannot sit it.`);
  }

  const existing = await ExamAttempt.findOne({ exam: exam._id, student: input.student });
  if (existing) {
    if (existing.status === 'in_progress') return { attempt: existing, created: false };
    throw ApiError.conflict('You have already sat this exam. There is one attempt only.');
  }

  const availability = availabilityOf(exam, now);
  if (!availability.open) {
    throw ApiError.conflict(
      availability.reason === 'not-open-yet'
        ? `This exam opens at ${exam.opensAt.toISOString()}.`
        : availability.reason === 'closed'
          ? 'This exam has closed.'
          : 'This exam is not available.',
    );
  }

  const secondsLeft = Math.floor((exam.closesAt.getTime() - now.getTime()) / 1000);
  if (secondsLeft < MIN_START_SECONDS) {
    throw ApiError.conflict('There is not enough time left in the window to start this exam.');
  }

  if (exam.questions.length === 0) {
    throw ApiError.conflict('This exam has no questions on it. Please tell your administrator.');
  }

  // Serve the paper in the author's order.
  const ordered = [...exam.questions].sort((a, b) => a.order - b.order);
  const docs = await Question.find({ _id: { $in: ordered.map((ref) => ref.question) } });
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

  const questions: AttemptAnswerEntry[] = [];
  for (const ref of ordered) {
    const question = byId.get(String(ref.question));
    // Everyone sitting an exam must sit the same paper, so a missing question is a
    // refusal rather than a short paper.
    if (!question) {
      logger.error({ examId: String(exam._id), questionId: String(ref.question) }, 'Exam references a missing question');
      throw ApiError.conflict('This exam is not ready to be sat. Please tell your administrator.');
    }
    questions.push(snapshotOf(question, ref));
  }

  try {
    const attempt = await ExamAttempt.create({
      exam: exam._id,
      student: input.student,
      status: 'in_progress',
      questions,
      totalQuestions: questions.length,
      maxMarks: questions.reduce((sum, entry) => sum + entry.marks, 0),
      durationMinutes: exam.durationMinutes,
      startedAt: now,
      expiresAt: deadlineFor(exam, now),
    });
    return { attempt, created: true };
  } catch (err) {
    // The unique index is the authority, not the read above: on a serverless platform
    // two requests can both find nothing and both try to insert.
    if (isDuplicateKeyError(err)) {
      const raced = await ExamAttempt.findOne({ exam: exam._id, student: input.student });
      if (raced) return { attempt: raced, created: false };
    }
    throw err;
  }
}

export interface ExamAnswerInput {
  selectedOptionKeys?: string[];
  numericResponse?: number | null;
  textResponse?: string | null;
  booleanResponse?: boolean | null;
}

/**
 * Writes one response into an open attempt.
 *
 * Refuses on two grounds, and the second is the point: the attempt must still be
 * `in_progress`, **and the deadline must not have passed**. An answer arriving one
 * second after `expiresAt` is not stored — not stored late, not stored quietly, not
 * stored and then ignored at grading. A client is free to keep its countdown running
 * as long as it likes; this is what makes that irrelevant.
 */
export function applyExamAnswer(
  attempt: ExamAttemptDocument,
  questionId: string,
  answer: ExamAnswerInput,
  servedOptionKeys: readonly string[],
  now = new Date(),
): void {
  if (attempt.status !== 'in_progress') {
    throw ApiError.conflict('This exam has already been submitted.');
  }
  if (now >= attempt.expiresAt) {
    throw ApiError.conflict('Your time for this exam is up, so this answer was not saved.');
  }

  const entry = attempt.questions.find((candidate) => String(candidate.question) === questionId);
  if (!entry) {
    throw ApiError.notFound('That question is not part of this attempt.');
  }

  if (entry.type === 'single_choice' || entry.type === 'multiple_choice') {
    const keys = answer.selectedOptionKeys ?? [];
    const unknown = keys.filter((key) => !servedOptionKeys.includes(key));
    if (unknown.length > 0) {
      throw ApiError.badRequest('That option does not belong to this question.');
    }
    if (entry.type === 'single_choice' && keys.length > 1) {
      throw ApiError.badRequest('This question takes a single answer.');
    }
    entry.selectedOptionKeys = [...new Set(keys)];
  } else if (entry.type === 'true_false') {
    entry.booleanResponse = answer.booleanResponse ?? null;
  } else if (entry.type === 'fill_blank') {
    // Stored exactly as typed. Normalisation belongs to the grader, so what the
    // student wrote stays readable on review — including when it was marked wrong.
    entry.textResponse = answer.textResponse ?? null;
  } else {
    entry.numericResponse = answer.numericResponse ?? null;
  }

  entry.answeredAt = isAnswered(entry) ? now : null;
}

export interface FinalizeExamResult {
  attempt: ExamAttemptDocument;
  /** True only for the call that actually transitioned the attempt to `submitted`. */
  graded: boolean;
}

/**
 * Grades and closes an attempt. Idempotent, and safe against a race.
 *
 * The write is conditional on the attempt still being `in_progress`, so of two
 * concurrent submissions — the student pressing Submit as their countdown hits zero —
 * exactly one transitions it. The other gets `graded: false` and the stored document,
 * so it cannot re-grade answers already marked or write a second audit entry.
 *
 * `submittedAt` is clamped to the deadline: grading a paper noticed after time as
 * though it were handed in then would record a time taken longer than the exam
 * allowed.
 */
export async function finalizeExamAttempt(
  attempt: ExamAttemptDocument,
  reason: ExamSubmissionReason,
  at = new Date(),
): Promise<FinalizeExamResult> {
  if (attempt.status !== 'in_progress') {
    return { attempt, graded: false };
  }

  const totals = gradeEntries(attempt.questions);
  const submittedAt = at < attempt.expiresAt ? at : attempt.expiresAt;
  const timeTakenSeconds = Math.max(0, Math.round((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000));

  const updated = await ExamAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'in_progress' },
    {
      $set: {
        questions: attempt.questions,
        score: totals.score,
        correctCount: totals.correctCount,
        incorrectCount: totals.incorrectCount,
        unansweredCount: totals.unansweredCount,
        accuracy: totals.accuracy,
        status: 'submitted',
        submittedAt,
        timeTakenSeconds,
        submissionReason: reason,
      },
    },
    { returnDocument: 'after' },
  );

  if (updated) return { attempt: updated, graded: true };

  // Lost the race. The stored document is the authority — never the in-memory copy,
  // whose grades were computed by a call that did not win.
  const stored = await ExamAttempt.findById(attempt._id);
  if (!stored) throw ApiError.notFound('That attempt no longer exists.');
  return { attempt: stored, graded: false };
}

/**
 * Closes an attempt whose time has run out.
 *
 * Deliberately **lazy**, for the same reason mock tests are: the deployment target is
 * Vercel's free tier and there is no cron to run a scheduler. Laziness costs nothing
 * that matters, because grading uses `expiresAt` rather than the moment of discovery —
 * an attempt finalised a week late is marked exactly as it would have been the second
 * the clock ran out.
 */
export async function finalizeIfExpired(attempt: ExamAttemptDocument, now = new Date()): Promise<FinalizeExamResult> {
  if (attempt.status !== 'in_progress' || now < attempt.expiresAt) {
    return { attempt, graded: false };
  }
  return finalizeExamAttempt(attempt, 'time_expired', attempt.expiresAt);
}

/**
 * Finalises every expired attempt for one exam.
 *
 * Run before publishing results and before an administrator reads the attempts table,
 * so a paper cannot show as "in progress" hours after it could possibly have been
 * written — and, more importantly, so an abandoned attempt is **graded and ranked**
 * rather than silently excluded from the cohort.
 */
export async function sweepExpiredExamAttempts(examId: Types.ObjectId | string, now = new Date()): Promise<number> {
  const stale = await ExamAttempt.find({ exam: examId, status: 'in_progress', expiresAt: { $lte: now } });

  let closed = 0;
  for (const attempt of stale) {
    try {
      const outcome = await finalizeExamAttempt(attempt, 'time_expired', attempt.expiresAt);
      if (outcome.graded) closed += 1;
    } catch (err) {
      // Housekeeping must not stop an administrator reading the results that are
      // complete, so a failure here is logged rather than thrown.
      logger.error({ err, attemptId: String(attempt._id) }, 'Could not finalise an expired exam attempt');
    }
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Result publication
// ---------------------------------------------------------------------------

export interface PublicationOutcome {
  candidates: number;
  resultsWritten: number;
}

/**
 * Ranks every submitted attempt for one exam and writes published `Result` rows.
 *
 * Runs a sweep first, so an abandoned paper is graded and counted rather than quietly
 * dropped from the cohort — which would otherwise flatter everybody else's rank.
 *
 * **Equal scores share a rank** (standard competition ranking: 1, 2, 2, 4), the same
 * rule the leaderboard uses, because two students who scored identically did not
 * finish one ahead of the other and inventing an order between them would be a
 * fabricated distinction. The listing order within a tie is by submission time, which
 * is deterministic but is *not* used to break the rank.
 *
 * Idempotent: republishing recomputes and updates the same rows via the unique index
 * on `{exam, student}`, rather than adding a second result per student.
 */
export async function publishResults(
  exam: ExamDocument,
  publishedBy: string,
  now = new Date(),
): Promise<PublicationOutcome> {
  await sweepExpiredExamAttempts(exam._id as Types.ObjectId, now);

  const attempts = await ExamAttempt.find({ exam: exam._id, status: 'submitted' }).sort({ score: -1, submittedAt: 1 });

  if (attempts.length === 0) {
    throw ApiError.conflict('No attempt has been submitted for this exam, so there is nothing to publish.');
  }

  const total = attempts.length;
  let rank = 0;
  let previousScore: number | null = null;
  let written = 0;

  for (const [index, attempt] of attempts.entries()) {
    // Standard competition ranking: the rank only advances when the score changes,
    // and it jumps to the current position so 1, 2, 2, 4 rather than 1, 2, 2, 3.
    if (previousScore === null || attempt.score !== previousScore) {
      rank = index + 1;
      previousScore = attempt.score;
    }

    const percentage = attempt.maxMarks > 0 ? Math.round((attempt.score / attempt.maxMarks) * 1000) / 10 : 0;
    // The share of the cohort this student finished at least level with.
    const percentile = Math.round(((total - rank + 1) / total) * 1000) / 10;

    await Result.findOneAndUpdate(
      { exam: exam._id, student: attempt.student },
      {
        $set: {
          attempt: attempt._id,
          score: attempt.score,
          maxMarks: attempt.maxMarks,
          percentage,
          accuracy: attempt.accuracy,
          rank,
          totalCandidates: total,
          percentile,
          isPublished: true,
          publishedAt: now,
          publishedBy,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    written += 1;
  }

  exam.resultsPublishedAt = now;
  exam.resultsPublishedBy = publishedBy;
  await exam.save();

  return { candidates: total, resultsWritten: written };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * What a student may see about an exam before sitting it.
 *
 * Never the questions, and never a score before results are published.
 */
export function studentExamSummary(
  exam: ExamDocument,
  attempt: ExamAttemptDocument | null,
  now = new Date(),
) {
  const availability = availabilityOf(exam, now);
  return {
    id: String(exam._id),
    examCode: exam.examCode,
    title: exam.title,
    description: exam.description ?? null,
    classLevel: exam.classLevel,
    durationMinutes: exam.durationMinutes,
    totalMarks: exam.totalMarks,
    questionCount: exam.questions.length,
    opensAt: exam.opensAt,
    closesAt: exam.closesAt,
    isOpen: availability.open,
    windowState: availability.reason,
    resultsPublished: Boolean(exam.resultsPublishedAt),
    attempt: attempt
      ? {
          id: String(attempt._id),
          status: attempt.status,
          startedAt: attempt.startedAt,
          submittedAt: attempt.submittedAt ?? null,
        }
      : null,
  };
}

/** Seconds left on the server's clock. The browser's countdown is a display of this. */
export function secondsRemaining(attempt: ExamAttemptDocument, now = new Date()): number {
  return Math.max(0, Math.floor((attempt.expiresAt.getTime() - now.getTime()) / 1000));
}

export interface ExamStatusChange {
  status: ExamStatus;
  actorLabel: string;
}
