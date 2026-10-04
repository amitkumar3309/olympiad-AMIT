import { Types } from 'mongoose';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import { config } from '../config';
import { now } from '../lib/clock';
import { isClassLevel, type ClassLevel } from '../lib/classLevels';
import { dayKeyOf, daysBetween, isDayKey, shiftDay, type DayKey } from '../lib/competitionDay';
import {
  CLASS_GROUPS,
  classesInRange,
  classNumber,
  classRangeLabel,
  describeWinnerRule,
  hashIp,
  newOptionId,
  optionLetter,
  prizeEligibility,
  quizPhaseAt,
  quizQuestionProblem,
  quizWindow,
  rankCandidates,
  seededOrder,
  sharedIpCounts,
  shuffleSeed,
  type EligibilityRequirement,
  type PrizeDeskView,
  type QuizPhase,
  type WinnerRule,
} from '../lib/dailyQuiz';
import {
  DAILY_QUIZ_DEFAULTS,
  DAILY_QUIZ_SETTINGS_KEY,
  DailyChallenge,
  DailyChallengeAttempt,
  DailyQuizSettings,
  DailyQuizStart,
  DailyQuizWinner,
  Question,
  Student,
  type AttemptAnswerEntry,
  type ChallengeSource,
  type DailyChallengeAttemptDocument,
  type DailyChallengeDocument,
  type DailyQuizStartDocument,
  type DailyQuizWinnerDocument,
  type QuestionDocument,
  type QuizContent,
  type StudentDocument,
  type WinnerStatus,
} from '../models';
import { findImplicitSubject, type Actor } from './taxonomyService';
import { gradeEntry } from './grading';
import { displayNameFor } from './leaderboardService';

/**
 * The Daily Quiz — scheduling one, serving today's, the Start/submit pair, the reveal,
 * the history, the figures and the prize winners (Milestone 30, Phase 2).
 *
 * This file was the daily challenge (Milestone 8) and is **upgraded in place**, not
 * duplicated: the launch brief's Daily Quiz is the same feature with stricter rules. The
 * collections keep their names (`DailyChallenge`, `DailyChallengeAttempt`), so nothing
 * already recorded had to move.
 *
 * ## The properties this module exists to hold
 *
 * **1. The answer key never reaches a student before the reveal.** The correct option and
 * the worked solution unlock at the next IST midnight (the brief's R6). `revealOf()` is the
 * **only** function that reads them for a student view, and it returns nothing until
 * `quizPhaseAt(day, now)` is `revealed`. Before that a student can learn, at most, whether
 * *their own* answer was right — and only when `instantResult` is on.
 *
 * **2. One attempt per student per day, by index.** `DailyQuizStart` and
 * `DailyChallengeAttempt` are both unique on `{student, day}`. Pressing Start twice, a
 * double-clicked submit, two tabs, a retried request — each finds the stored document
 * rather than making a second one, and never resets the clock or re-marks an answer.
 *
 * **3. The server owns every instant.** "Today", the window, the solve time and the reveal
 * all come from `lib/clock.ts → now()` and `lib/dailyQuiz.ts`. No request carries a time.
 *
 * **4. One grader.** A submission is marked by `services/grading.ts`, over the same
 * `AttemptAnswerEntry` snapshot practice and mock tests use — the opaque option id the
 * student sends is mapped back to the bank's option key first.
 *
 * **5. XP and notifications are reached through their own services.** This module never
 * writes a `StudentActivity` row and never decides what a quiz is worth; the reward is
 * `services/dailyQuizRewards.ts` over the engine. That separation is also what avoids an
 * import cycle — the reward engine reads `challengeStreakOf` from here.
 */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

const asId = (value: unknown): Types.ObjectId => value as Types.ObjectId;

/** The quiz a class document belongs to. A pre-Milestone-30 document is its own group. */
export function groupIdOf(challenge: DailyChallengeDocument): Types.ObjectId {
  return asId(challenge.groupId ?? challenge._id);
}

/** A class document's range — its own class, for a document from before ranges existed. */
export function rangeOf(challenge: DailyChallengeDocument): { min: number; max: number } {
  const own = classNumber(challenge.classLevel);
  return { min: challenge.classMin ?? own, max: challenge.classMax ?? own };
}

/** True when the document can be served as a quiz — it carries the Milestone 30 snapshot. */
export function isPlayable(challenge: DailyChallengeDocument | null): challenge is DailyChallengeDocument & {
  content: QuizContent;
} {
  return Boolean(challenge?.content && challenge.content.options.length >= 2);
}

function todayOf(at: Date): DayKey {
  return dayKeyOf(at);
}

/** Every class document of one quiz. Accepts a group id or, for an old document, its own id. */
export async function loadGroup(groupId: string | Types.ObjectId): Promise<DailyChallengeDocument[]> {
  const id = typeof groupId === 'string' ? new Types.ObjectId(groupId) : groupId;
  const docs = await DailyChallenge.find({ groupId: id }).sort({ classLevel: 1 });
  if (docs.length > 0) return docs;
  const legacy = await DailyChallenge.findOne({ _id: id, groupId: null });
  return legacy ? [legacy] : [];
}

async function requireGroup(groupId: string): Promise<DailyChallengeDocument[]> {
  if (!Types.ObjectId.isValid(groupId)) throw ApiError.notFound('No Daily Quiz exists with that id.');
  const docs = await loadGroup(groupId);
  if (docs.length === 0) throw ApiError.notFound('No Daily Quiz exists with that id.');
  return docs;
}

/** How many students have started or submitted any class of a quiz. */
async function activityCount(docs: readonly DailyChallengeDocument[]): Promise<number> {
  const ids = docs.map((doc) => doc._id);
  const [starts, attempts] = await Promise.all([
    DailyQuizStart.countDocuments({ challenge: { $in: ids } }),
    DailyChallengeAttempt.countDocuments({ challenge: { $in: ids } }),
  ]);
  return starts + attempts;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface QuizSettings {
  prizeHeadline: string;
  prizeText: string;
  cashAmount: number | null;
  winnerRule: WinnerRule;
  winnersPerQuiz: number;
  instantResult: boolean;
  updatedAt: Date | null;
  updatedByLabel: string | null;
}

/**
 * The settings in force. A missing document is the defaults; an unreadable one is the
 * defaults too, logged — a configuration read must never stop a student playing.
 */
export async function getQuizSettings(): Promise<QuizSettings> {
  try {
    const doc = await DailyQuizSettings.findOne({ key: DAILY_QUIZ_SETTINGS_KEY });
    if (doc) {
      return {
        prizeHeadline: doc.prizeHeadline,
        prizeText: doc.prizeText,
        cashAmount: doc.cashAmount ?? null,
        winnerRule: doc.winnerRule,
        winnersPerQuiz: doc.winnersPerQuiz,
        instantResult: doc.instantResult,
        updatedAt: doc.updatedAt ?? null,
        updatedByLabel: doc.updatedByLabel ?? null,
      };
    }
  } catch (err) {
    logger.error({ err }, 'Could not read the Daily Quiz settings; using the defaults');
  }
  return { ...DAILY_QUIZ_DEFAULTS, updatedAt: null, updatedByLabel: null };
}

export type QuizSettingsInput = Omit<QuizSettings, 'updatedAt' | 'updatedByLabel'>;

export async function updateQuizSettings(input: QuizSettingsInput, actor: Actor): Promise<QuizSettings> {
  await DailyQuizSettings.findOneAndUpdate(
    { key: DAILY_QUIZ_SETTINGS_KEY },
    { $set: { ...input, updatedBy: actor.id, updatedByLabel: actor.label } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return getQuizSettings();
}

/** What any visitor may read: the prize, the rule in words, and what a correct answer earns. */
export function publicQuizInfo(settings: QuizSettings, xpForCorrect: number) {
  return {
    prizeHeadline: settings.prizeHeadline,
    prizeText: settings.prizeText,
    cashAmount: settings.cashAmount,
    winnerRule: settings.winnerRule,
    winnersPerQuiz: settings.winnersPerQuiz,
    /** Generated from the same settings the computation uses — the rules page prints this verbatim. */
    howWinnersAreChosen: describeWinnerRule(settings.winnerRule, settings.winnersPerQuiz),
    instantResult: settings.instantResult,
    xpForCorrect,
  };
}

// ---------------------------------------------------------------------------
// Choosing the question (staff)
// ---------------------------------------------------------------------------

/** The bank statuses a quiz question may have: written and reviewed, but not yet in practice. */
const QUIZ_SOURCE_STATUSES = ['draft', 'in_review'] as const;

/**
 * Checks a bank question can become a Daily Quiz, and returns it with its chapter name.
 *
 * Each rule stops a quiz failing on its morning rather than at scheduling time:
 *  - **single choice** with **2–6 options** and **exactly one correct** — the brief's
 *    A–D quiz (§6.5);
 *  - a **worked solution**, because unlocking it the next day is the point (R6);
 *  - **not published** — a published question is in the practice pool, where a student
 *    can already read its solution, so it cannot carry a prize (PLAN.md Q4);
 *  - for a class **inside the quiz's range**;
 *  - **not already a quiz on another day** — once a quiz is revealed its answer is public,
 *    so the same question may back quizzes on one day only.
 */
async function requireQuizQuestion(
  questionId: string,
  range: { min: number; max: number },
  day: DayKey,
): Promise<{ question: QuestionDocument; topicName: string | null }> {
  if (!Types.ObjectId.isValid(questionId)) throw ApiError.badRequest('That question does not exist.');
  const question = await Question.findById(questionId).populate('topic', 'name');
  if (!question) throw ApiError.badRequest('That question no longer exists in the bank.');

  if (question.status === 'published') {
    throw ApiError.conflict(
      'That question is already published for practice, so its solution is public. Use an unpublished question for the Daily Quiz — it can be published for practice once the quiz’s answer is revealed.',
    );
  }
  if (!(QUIZ_SOURCE_STATUSES as readonly string[]).includes(question.status)) {
    throw ApiError.conflict('An archived question cannot be set as a Daily Quiz.');
  }
  const problem = quizQuestionProblem(question, range);
  if (problem) throw ApiError.badRequest(problem);

  const elsewhere = await DailyChallenge.findOne({ question: question._id, day: { $ne: day } }).select('day');
  if (elsewhere) {
    throw ApiError.conflict(
      `That question is already the Daily Quiz on ${elsewhere.day}. A question can be a quiz on one day only — its answer is public after the reveal.`,
    );
  }

  const topic = question.topic as unknown as { name?: string } | null;
  return { question, topicName: topic?.name ?? null };
}

/** The quiz's own copy of the question, every option given a fresh opaque id. */
function snapshotContent(question: QuestionDocument, topicName: string | null): QuizContent {
  const correct = question.options.find((option) => option.isCorrect);
  return {
    questionText: question.questionText,
    options: question.options.map((option) => ({ key: option.key, id: newOptionId(), text: option.text })),
    correctOptionKey: correct!.key,
    solution: question.solution ?? '',
    difficulty: question.difficulty,
    topicName,
    revision: question.revision,
  };
}

// ---------------------------------------------------------------------------
// Scheduling (staff)
// ---------------------------------------------------------------------------

export interface ScheduleQuizInput {
  day: DayKey;
  classMin: number;
  classMax: number;
  questionId: string;
}

function assertSchedulableDay(day: DayKey, at: Date): void {
  if (!isDayKey(day)) throw ApiError.badRequest('Use a real calendar date (YYYY-MM-DD).');
  if (daysBetween(todayOf(at), day) < 0) {
    throw ApiError.badRequest('A Daily Quiz cannot be scheduled in the past.');
  }
}

/**
 * Schedules one quiz: one document per class in the range, sharing a `groupId` and the
 * same snapshot (so every class sees the same option ids).
 *
 * The unique `{day, classLevel}` index is what refuses an overlap — a class that already
 * has a quiz that day. Classes are checked first so the refusal can name them; if two
 * administrators race past the check, the index still decides, and the documents this
 * request did manage to write are removed again so no half-scheduled quiz is left behind.
 */
export async function scheduleQuiz(
  input: ScheduleQuizInput,
  actor: Actor,
  at: Date = now(),
): Promise<DailyChallengeDocument[]> {
  assertSchedulableDay(input.day, at);
  const classes = classesInRange(input.classMin, input.classMax);
  const range = { min: input.classMin, max: input.classMax };

  const taken = await DailyChallenge.find({ day: input.day, classLevel: { $in: classes } }).select('classLevel content');
  if (taken.length > 0) {
    const names = taken.map((doc) => doc.classLevel).join(', ');
    const legacy = taken.every((doc) => !doc.content);
    throw ApiError.conflict(
      legacy
        ? `${names} still ${taken.length === 1 ? 'has' : 'have'} a daily challenge from before the Daily Quiz on ${input.day}. Remove it from the Daily Quiz console first.`
        : `${names} already ${taken.length === 1 ? 'has' : 'have'} a Daily Quiz on ${input.day}.`,
    );
  }

  const { question, topicName } = await requireQuizQuestion(input.questionId, range, input.day);
  const content = snapshotContent(question, topicName);
  const groupId = new Types.ObjectId();

  const docs = classes.map((classLevel) => ({
    day: input.day,
    classLevel,
    question: question._id,
    source: 'scheduled' satisfies ChallengeSource,
    marks: question.marks,
    groupId,
    classMin: input.classMin,
    classMax: input.classMax,
    content,
    createdBy: actor.id,
    createdByLabel: actor.label,
  }));

  try {
    await DailyChallenge.insertMany(docs, { ordered: true });
  } catch (err) {
    await DailyChallenge.deleteMany({ groupId });
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict(`Another quiz was just scheduled for one of these classes on ${input.day}. Reload and try again.`);
    }
    throw err;
  }

  return loadGroup(groupId);
}

/**
 * Re-points a quiz at another question (or re-copies the same one after an edit).
 *
 * Refused once **anybody has started it**, not merely submitted: a student who pressed
 * Start has seen the question, and changing it under them would make their attempt, and
 * the day's figures, describe two questions. A past day is never changed — it is the
 * record of what was set.
 */
export async function changeQuizQuestion(
  groupId: string,
  questionId: string,
  actor: Actor,
  at: Date = now(),
): Promise<DailyChallengeDocument[]> {
  const docs = await requireGroup(groupId);
  const first = docs[0]!;

  if (daysBetween(todayOf(at), first.day) < 0) {
    throw ApiError.conflict('A past quiz cannot be changed — it is the record of what was set that day.');
  }
  const activity = await activityCount(docs);
  if (activity > 0) {
    throw ApiError.conflict('Students have already started this quiz, so its question can no longer be changed.');
  }

  const range = rangeOf(first);
  const { question, topicName } = await requireQuizQuestion(questionId, range, first.day);
  const content = snapshotContent(question, topicName);
  const id = groupIdOf(first);

  await DailyChallenge.updateMany(
    { _id: { $in: docs.map((doc) => doc._id) } },
    {
      $set: {
        question: question._id,
        marks: question.marks,
        content,
        groupId: id,
        classMin: range.min,
        classMax: range.max,
        source: 'scheduled',
        createdBy: actor.id,
        createdByLabel: actor.label,
      },
    },
  );
  return loadGroup(id);
}

/** Removes a quiz (every class of it). Refused once anybody has started it. */
export async function deleteQuiz(groupId: string): Promise<DailyChallengeDocument[]> {
  const docs = await requireGroup(groupId);
  const activity = await activityCount(docs);
  if (activity > 0) {
    throw ApiError.conflict('Students have already started this quiz, so it cannot be removed — it is part of their record.');
  }
  await DailyChallenge.deleteMany({ _id: { $in: docs.map((doc) => doc._id) } });
  return docs;
}

export interface BulkScheduleInput {
  classMin: number;
  classMax: number;
  startDay: DayKey;
  questionIds: string[];
  dryRun: boolean;
}

export interface BulkPlanRow {
  questionId: string;
  questionText: string | null;
  day: DayKey | null;
  error: string | null;
}

/** How far ahead a bulk schedule may reach. A year of daily quizzes is more than enough. */
const BULK_HORIZON_DAYS = 366;

/**
 * Loads weeks of quizzes at once (brief §6.5): each question, in the order given, takes the
 * next day from `startDay` on which **no class in the range** has a quiz yet.
 *
 * `dryRun` (the default from the route) writes nothing and returns the plan with a
 * per-row error — the same checks a single scheduling makes. The real run **re-checks
 * everything from scratch**, because the plan an administrator approved may be minutes
 * old, and reports per row: one bad question never stops the rest.
 */
export async function bulkScheduleQuizzes(
  input: BulkScheduleInput,
  actor: Actor,
  at: Date = now(),
): Promise<BulkPlanRow[]> {
  assertSchedulableDay(input.startDay, at);
  const classes = classesInRange(input.classMin, input.classMax);
  const range = { min: input.classMin, max: input.classMax };

  const occupied = new Set(
    (await DailyChallenge.distinct('day', { classLevel: { $in: classes }, day: { $gte: input.startDay } })) as DayKey[],
  );

  const rows: BulkPlanRow[] = [];
  const seen = new Set<string>();
  let cursor = input.startDay;

  for (const questionId of input.questionIds) {
    const row: BulkPlanRow = { questionId, questionText: null, day: null, error: null };
    rows.push(row);

    if (seen.has(questionId)) {
      row.error = 'This question appears twice in the list.';
      continue;
    }
    seen.add(questionId);

    while (occupied.has(cursor) && daysBetween(input.startDay, cursor) < BULK_HORIZON_DAYS) {
      cursor = shiftDay(cursor, -1);
    }
    if (daysBetween(input.startDay, cursor) >= BULK_HORIZON_DAYS) {
      row.error = 'No free day within a year of the start date.';
      continue;
    }

    try {
      const { question } = await requireQuizQuestion(questionId, range, cursor);
      row.questionText = question.questionText;
      row.day = cursor;
      occupied.add(cursor);
      cursor = shiftDay(cursor, -1);
    } catch (err) {
      row.error = err instanceof ApiError ? err.message : 'This question could not be checked.';
    }
  }

  if (input.dryRun) return rows;

  for (const row of rows) {
    if (!row.day || row.error) continue;
    try {
      await scheduleQuiz({ day: row.day, classMin: range.min, classMax: range.max, questionId: row.questionId }, actor, at);
    } catch (err) {
      row.error = err instanceof ApiError ? err.message : 'This quiz could not be scheduled.';
      row.day = null;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The question bank's side of the reservation
// ---------------------------------------------------------------------------

/**
 * Whether a bank question is the Daily Quiz on a day whose answer has **not been revealed
 * yet** — in which case it must not be published to practice, where its solution would be
 * readable. `questionService` asks this before publishing.
 */
export async function quizReservationFor(
  questionId: Types.ObjectId | string,
  at: Date = now(),
): Promise<{ day: DayKey; revealAt: Date } | null> {
  const latest = await DailyChallenge.findOne({ question: questionId }).sort({ day: -1 }).select('day');
  if (!latest) return null;
  if (quizPhaseAt(latest.day, at) === 'revealed') return null;
  return { day: latest.day, revealAt: quizWindow(latest.day).revealAt };
}

/** Whether any quiz, past or future, was set from this bank question. */
export async function isUsedByAnyQuiz(questionId: Types.ObjectId | string): Promise<boolean> {
  return (await DailyChallenge.exists({ question: questionId })) !== null;
}

// ---------------------------------------------------------------------------
// Serving today's quiz (students)
// ---------------------------------------------------------------------------

/**
 * Today's quiz for a class, or null. **No automatic fill** (PLAN.md Q4): a day nobody
 * scheduled has no quiz, and a pre-Milestone-30 document without a snapshot is not
 * served as one.
 */
export async function resolveQuizFor(classLevel: ClassLevel, day: DayKey): Promise<DailyChallengeDocument | null> {
  const challenge = await DailyChallenge.findOne({ day, classLevel });
  return isPlayable(challenge) ? challenge : null;
}

/** The next day after `afterDay` with a quiz for this class — for "next quiz in 2h 10m". */
export async function nextQuizDay(classLevel: ClassLevel, afterDay: DayKey): Promise<DayKey | null> {
  const next = await DailyChallenge.findOne({ classLevel, day: { $gt: afterDay }, content: { $ne: null } })
    .sort({ day: 1 })
    .select('day');
  return next?.day ?? null;
}

export interface StartQuizInput {
  challenge: DailyChallengeDocument;
  student: Types.ObjectId;
  ip?: string | null;
  userAgent?: string | null;
  at?: Date;
}

/**
 * Presses Start: records the server's instant and this student's option order.
 *
 * Idempotent — a second press, from any tab, returns the existing start untouched, so the
 * clock can never be restarted for a better solve time. Refused outside the quiz's
 * window, which the server decides.
 */
export async function startQuiz(input: StartQuizInput): Promise<{ start: DailyQuizStartDocument; created: boolean }> {
  const at = input.at ?? now();
  const { challenge, student } = input;
  if (!isPlayable(challenge)) throw ApiError.conflict('There is no Daily Quiz for your class today.');
  if (quizPhaseAt(challenge.day, at) !== 'open') throw ApiError.conflict('This Daily Quiz is not open.');

  const existing = await DailyQuizStart.findOne({ student, day: challenge.day });
  if (existing) return { start: existing, created: false };

  const groupId = groupIdOf(challenge);
  const optionOrder = seededOrder(
    challenge.content.options.map((option) => option.id),
    shuffleSeed(String(student), String(groupId)),
  );

  try {
    const start = await DailyQuizStart.create({
      challenge: challenge._id,
      groupId,
      student,
      day: challenge.day,
      startedAt: at,
      optionOrder,
      ipHash: hashIp(input.ip, config.jwtSecret),
      userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    });
    return { start, created: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const raced = await DailyQuizStart.findOne({ student, day: challenge.day });
      if (raced) return { start: raced, created: false };
    }
    throw err;
  }
}

export interface SubmitQuizInput {
  student: Types.ObjectId;
  selectedOptionId: string;
  ip?: string | null;
  userAgent?: string | null;
  at?: Date;
}

export interface SubmitQuizOutcome {
  attempt: DailyChallengeAttemptDocument;
  challenge: DailyChallengeDocument;
  /** False when the student had already submitted today — nothing was re-marked. */
  created: boolean;
}

/**
 * Submits one answer, marks it with the shared grader, and stores it once.
 *
 * In order: a start must exist **for today** (an answer for a day that has closed is
 * refused, and says so); a second submission returns the first unchanged; the chosen id
 * must belong to the quiz the student was actually shown (the start's document, not
 * whatever their class resolves to now). The solve time is the server's
 * `submittedAt − startedAt`. Nothing about the outcome is accepted from the request.
 */
export async function submitQuiz(input: SubmitQuizInput): Promise<SubmitQuizOutcome> {
  const at = input.at ?? now();
  const today = todayOf(at);
  const { student } = input;

  const existing = await DailyChallengeAttempt.findOne({ student, day: today });
  const start = await DailyQuizStart.findOne({ student, day: today });

  if (existing) {
    const challenge = await DailyChallenge.findById(existing.challenge);
    if (!challenge) throw ApiError.conflict('This quiz is no longer available.');
    return { attempt: existing, challenge, created: false };
  }

  if (!start) {
    const yesterday = await DailyQuizStart.findOne({ student, day: shiftDay(today, 1) });
    if (yesterday && !(await DailyChallengeAttempt.exists({ student, day: yesterday.day }))) {
      throw ApiError.conflict('That Daily Quiz closed at midnight, so the answer could not be accepted.');
    }
    throw ApiError.conflict('Press Start to see the question before submitting an answer.');
  }

  const challenge = await DailyChallenge.findById(start.challenge);
  if (!isPlayable(challenge)) throw ApiError.conflict('This quiz is no longer available.');
  if (quizPhaseAt(challenge.day, at) !== 'open') {
    throw ApiError.conflict('That Daily Quiz has closed, so the answer could not be accepted.');
  }

  const option = challenge.content.options.find((candidate) => candidate.id === input.selectedOptionId);
  if (!option) throw ApiError.badRequest('That option does not belong to this quiz.');

  const entry: AttemptAnswerEntry = {
    question: challenge.question,
    revision: challenge.content.revision,
    type: 'single_choice',
    marks: challenge.marks,
    // A quiz never penalises a wrong answer: one question a day, and a negative score on
    // a single question would read as a punishment for taking part.
    negativeMarks: 0,
    correctOptionKeys: [challenge.content.correctOptionKey],
    booleanAnswer: null,
    numericAnswer: null,
    tolerance: null,
    acceptedAnswers: [],
    selectedOptionKeys: [option.key],
    numericResponse: null,
    booleanResponse: null,
    textResponse: null,
    answeredAt: at,
    isCorrect: null,
    awardedMarks: null,
  };
  const outcome = gradeEntry(entry);
  entry.isCorrect = outcome.isCorrect;
  entry.awardedMarks = outcome.awardedMarks;

  try {
    const attempt = await DailyChallengeAttempt.create({
      challenge: challenge._id,
      student,
      day: challenge.day,
      answer: entry,
      // Written once the reward has been decided (`dailyQuizRewards.ts`).
      xpAwarded: 0,
      xpSettled: false,
      submittedAt: at,
      startedAt: start.startedAt,
      solveTimeMs: Math.max(0, at.getTime() - start.startedAt.getTime()),
      selectedOptionId: option.id,
      optionOrder: start.optionOrder,
      ipHash: hashIp(input.ip, config.jwtSecret),
      userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    });
    return { attempt, challenge, created: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const raced = await DailyChallengeAttempt.findOne({ student, day: challenge.day });
      if (raced) return { attempt: raced, challenge, created: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Student views — and THE reveal gate
// ---------------------------------------------------------------------------

/** A quiz's public facts: no question, no options, no key. Safe before Start. */
export function quizMetaView(challenge: DailyChallengeDocument, at: Date) {
  const window = quizWindow(challenge.day);
  const range = rangeOf(challenge);
  return {
    id: String(challenge._id),
    groupId: String(groupIdOf(challenge)),
    day: challenge.day,
    classRange: { min: range.min, max: range.max, label: classRangeLabel(range.min, range.max) },
    topic: challenge.content?.topicName ?? null,
    difficulty: challenge.content?.difficulty ?? null,
    opensAt: window.opensAt.toISOString(),
    closesAt: window.closesAt.toISOString(),
    revealAt: window.revealAt.toISOString(),
    phase: quizPhaseAt(challenge.day, at) satisfies QuizPhase,
  };
}

/**
 * The question **as one student sees it**: their option order, opaque ids, a display
 * letter. No key, no `isCorrect`, no solution — an allow-list, built here and nowhere
 * else, so a new field on `content` cannot reach a student by accident.
 */
export function quizQuestionView(challenge: DailyChallengeDocument & { content: QuizContent }, optionOrder: readonly string[]) {
  const byId = new Map(challenge.content.options.map((option) => [option.id, option]));
  const ordered = optionOrder
    .map((id) => byId.get(id))
    .filter((option): option is QuizContent['options'][number] => option !== undefined);
  // Any option missing from a stored order (it cannot happen, but a lost option must
  // still be answerable) goes at the end.
  for (const option of challenge.content.options) if (!optionOrder.includes(option.id)) ordered.push(option);
  return {
    text: challenge.content.questionText,
    options: ordered.map((option, index) => ({ id: option.id, text: option.text, letter: optionLetter(index) })),
  };
}

/**
 * **THE reveal gate.** The correct option and the worked solution, or null until the
 * quiz's `revealAt` — the next IST midnight. Every student view that could carry either
 * goes through this one function, and the leak test checks every response on both sides
 * of the boundary.
 */
export function revealOf(challenge: DailyChallengeDocument, at: Date): { correctOptionId: string; correctOptionText: string; solution: string } | null {
  if (!isPlayable(challenge)) return null;
  if (quizPhaseAt(challenge.day, at) !== 'revealed') return null;
  const correct = challenge.content.options.find((option) => option.key === challenge.content.correctOptionKey);
  if (!correct) return null;
  return { correctOptionId: correct.id, correctOptionText: correct.text, solution: challenge.content.solution };
}

/**
 * The result of a submission, as the student may see it now.
 *
 * `isCorrect` is present when `instantResult` is on (the owner's default) **or** once the
 * quiz is revealed, and `null` otherwise. Which option was right is never here before
 * the reveal — that is `revealOf()`.
 */
export function quizResultView(
  attempt: DailyChallengeAttemptDocument,
  challenge: DailyChallengeDocument,
  settings: QuizSettings,
  at: Date,
) {
  const reveal = revealOf(challenge, at);
  const showCorrectness = settings.instantResult || reveal !== null;
  return {
    submittedAt: attempt.submittedAt.toISOString(),
    solveTimeMs: attempt.solveTimeMs ?? null,
    selectedOptionId: attempt.selectedOptionId ?? null,
    isCorrect: showCorrectness ? attempt.answer.isCorrect === true : null,
    xpAwarded: attempt.xpAwarded,
    /** True while the XP is being held until the reveal (`instantResult` off). */
    xpPending: attempt.xpSettled === false,
    revealAt: quizWindow(challenge.day).revealAt.toISOString(),
    revealed: reveal !== null,
    reveal,
  };
}

export type QuizState = 'not-started' | 'in-progress' | 'submitted';

export interface TodayInput {
  student: StudentDocument;
  settings: QuizSettings;
  xpForCorrect: number;
  at: Date;
}

/** Facts for the "complete your profile to be eligible for prizes" prompt. */
export function eligibilityOf(
  student: Pick<StudentDocument, 'isEmailVerified' | 'status' | 'firstName' | 'lastName' | 'classLevel' | 'schoolName' | 'city' | 'guardianPhone'>,
): { eligible: boolean; missing: EligibilityRequirement[] } {
  return prizeEligibility({
    isEmailVerified: student.isEmailVerified,
    status: student.status,
    firstName: student.firstName,
    lastName: student.lastName,
    classLevel: student.classLevel,
    schoolName: student.schoolName,
    city: student.city ?? null,
    guardianPhone: student.guardianPhone ?? null,
  });
}

/**
 * Everything the quiz page needs for **today**, decided here so the route only does HTTP.
 *
 * The question appears only once the student has pressed Start; the result only once they
 * have submitted; the answer key never (today's reveal is tomorrow). `serverNow` is sent
 * so a countdown can be offset from the server's clock rather than the device's.
 */
export async function todayPayload(input: TodayInput) {
  const { student, settings, xpForCorrect, at } = input;
  const today = todayOf(at);
  const studentId = asId(student._id);
  const facts = await getChallengeFacts(studentId, today);

  const base = {
    serverNow: at.toISOString(),
    today,
    prize: publicQuizInfo(settings, xpForCorrect),
    eligibility: eligibilityOf(student),
    streak: { current: facts.currentChallengeStreak, longest: facts.longestChallengeStreak },
    previous: await previousQuizSummary(studentId, today, at),
  };

  if (!isClassLevel(student.classLevel)) {
    return {
      ...base,
      quiz: null,
      reason: 'no-class' as const,
      state: null,
      startedAt: null,
      question: null,
      result: null,
      nextQuizAt: null,
    };
  }

  const challenge = await resolveQuizFor(student.classLevel, today);
  if (!challenge) {
    const next = await nextQuizDay(student.classLevel, today);
    return {
      ...base,
      quiz: null,
      reason: 'none-scheduled' as const,
      state: null,
      startedAt: null,
      question: null,
      result: null,
      nextQuizAt: next ? quizWindow(next).opensAt.toISOString() : null,
    };
  }

  const [start, attempt] = await Promise.all([
    DailyQuizStart.findOne({ student: studentId, day: today }),
    DailyChallengeAttempt.findOne({ student: studentId, day: today }),
  ]);

  // A start made against another class's document (the student changed class mid-day)
  // is still the question they were shown, so it is the one served back to them.
  const shown = start && String(start.challenge) !== String(challenge._id) ? await DailyChallenge.findById(start.challenge) : challenge;
  const served = isPlayable(shown) ? shown : challenge;

  const state: QuizState = attempt ? 'submitted' : start ? 'in-progress' : 'not-started';
  const order = attempt?.optionOrder ?? start?.optionOrder ?? null;

  return {
    ...base,
    quiz: quizMetaView(served, at),
    reason: null,
    state,
    startedAt: start?.startedAt.toISOString() ?? null,
    question: order && isPlayable(served) ? quizQuestionView(served, order) : null,
    result: attempt ? quizResultView(attempt, served, settings, at) : null,
    nextQuizAt: null,
  };
}

/**
 * The student's most recent quiz before today, if its answer is now unlocked — so the
 * quiz page can say "Yesterday's answer is unlocked" and link to it.
 */
async function previousQuizSummary(student: Types.ObjectId, today: DayKey, at: Date) {
  const attempt = await DailyChallengeAttempt.findOne({ student, day: { $lt: today } }).sort({ day: -1 });
  if (!attempt) return null;
  const challenge = await DailyChallenge.findById(attempt.challenge);
  if (!challenge || !isPlayable(challenge)) return null;
  return {
    day: attempt.day,
    topic: challenge.content.topicName,
    isCorrect: attempt.answer.isCorrect === true,
    revealed: revealOf(challenge, at) !== null,
  };
}

// ---------------------------------------------------------------------------
// History (students)
// ---------------------------------------------------------------------------

export interface ListHistoryOptions {
  page: number;
  limit: number;
}

/** One day of a student's quiz record. Every field present on every row, null when unknown. */
export interface QuizHistoryRow {
  day: DayKey;
  status: 'submitted' | 'not-submitted' | 'in-progress';
  topic: string | null;
  questionText: string | null;
  /** The options in the order this student saw them — empty for a pre-quiz challenge. */
  options: Array<{ id: string; text: string; letter: string }>;
  selectedOptionId: string | null;
  selectedOptionText: string | null;
  /** Null until correctness may be shown (instant results on, or revealed). */
  isCorrect: boolean | null;
  solveTimeMs: number | null;
  xpAwarded: number;
  xpPending: boolean;
  revealAt: string;
  revealed: boolean;
  reveal: { correctOptionId: string | null; correctOptionText: string | null; solution: string | null } | null;
  won: boolean;
}

interface DayPageRow {
  page: Array<{ _id: DayKey }>;
  total: Array<{ n: number }>;
}

/**
 * The student's quiz days, newest first — submissions **and** starts never submitted
 * ("Not submitted"), paginated over the union of both, so a missed day is in the record
 * rather than silently absent.
 */
export async function listQuizHistory(student: Types.ObjectId, options: ListHistoryOptions, settings: QuizSettings, at: Date) {
  const [facet] = await DailyQuizStart.aggregate<DayPageRow>([
    { $match: { student } },
    { $project: { day: 1 } },
    {
      $unionWith: {
        coll: DailyChallengeAttempt.collection.name,
        pipeline: [{ $match: { student } }, { $project: { day: 1 } }],
      },
    },
    { $group: { _id: '$day' } },
    { $sort: { _id: -1 } },
    {
      $facet: {
        page: [{ $skip: (options.page - 1) * options.limit }, { $limit: options.limit }],
        total: [{ $count: 'n' }],
      },
    },
  ]);

  const days = (facet?.page ?? []).map((row) => row._id);
  const total = facet?.total[0]?.n ?? 0;
  if (days.length === 0) return { rows: [], total };

  const [attempts, starts, wins] = await Promise.all([
    DailyChallengeAttempt.find({ student, day: { $in: days } }),
    DailyQuizStart.find({ student, day: { $in: days } }),
    DailyQuizWinner.find({ student, status: 'published', day: { $in: days } }).select('day'),
  ]);

  const challengeIds = [
    ...attempts.map((attempt) => attempt.challenge),
    ...starts.map((start) => start.challenge),
  ];
  const challenges = new Map(
    (await DailyChallenge.find({ _id: { $in: challengeIds } })).map((doc) => [String(doc._id), doc]),
  );

  // Pre-Milestone-30 attempts have no snapshot on their challenge; read their question
  // from the bank, as the old history did.
  const legacyQuestionIds = attempts
    .filter((attempt) => !isPlayable(challenges.get(String(attempt.challenge)) ?? null))
    .map((attempt) => attempt.answer.question);
  const legacyQuestions = new Map(
    (await Question.find({ _id: { $in: legacyQuestionIds } }).populate('topic', 'name')).map((q) => [String(q._id), q]),
  );

  const attemptByDay = new Map(attempts.map((attempt) => [attempt.day, attempt]));
  const startByDay = new Map(starts.map((start) => [start.day, start]));
  const wonDays = new Set(wins.map((win) => win.day));
  const today = todayOf(at);

  const rows = days.map((day): QuizHistoryRow => {
    const attempt = attemptByDay.get(day) ?? null;
    const start = startByDay.get(day) ?? null;
    const challenge = challenges.get(String(attempt?.challenge ?? start?.challenge)) ?? null;
    const revealAt = quizWindow(day).revealAt.toISOString();

    if (attempt && challenge && isPlayable(challenge)) {
      const order = attempt.optionOrder ?? start?.optionOrder ?? challenge.content.options.map((option) => option.id);
      const question = quizQuestionView(challenge, order);
      const result = quizResultView(attempt, challenge, settings, at);
      return {
        day,
        status: 'submitted',
        topic: challenge.content.topicName,
        questionText: question.text,
        options: question.options,
        selectedOptionId: result.selectedOptionId,
        selectedOptionText: question.options.find((option) => option.id === result.selectedOptionId)?.text ?? null,
        isCorrect: result.isCorrect,
        solveTimeMs: result.solveTimeMs,
        xpAwarded: result.xpAwarded,
        xpPending: result.xpPending,
        revealAt: result.revealAt,
        revealed: result.revealed,
        reveal: result.reveal,
        won: wonDays.has(day),
      };
    }

    if (attempt) {
      // A daily challenge from before the quiz: revealed on submission, as it always was.
      const legacy = legacyQuestions.get(String(attempt.answer.question)) ?? null;
      const keyText = (key: string | undefined) => legacy?.options.find((option) => option.key === key)?.text ?? null;
      const topic = legacy?.topic as unknown as { name?: string } | null;
      return {
        day,
        status: 'submitted',
        topic: topic?.name ?? null,
        questionText: legacy?.questionText ?? null,
        options: [],
        selectedOptionId: null,
        selectedOptionText: keyText(attempt.answer.selectedOptionKeys[0]),
        isCorrect: attempt.answer.isCorrect === true,
        solveTimeMs: null,
        xpAwarded: attempt.xpAwarded,
        xpPending: false,
        revealAt,
        revealed: true,
        reveal: {
          correctOptionId: null,
          correctOptionText: keyText(attempt.answer.correctOptionKeys[0]),
          solution: legacy?.solution ?? null,
        },
        won: wonDays.has(day),
      };
    }

    // Started, never submitted: "Not submitted" once the day has closed.
    const reveal = challenge ? revealOf(challenge, at) : null;
    return {
      day,
      status: day === today ? 'in-progress' : 'not-submitted',
      topic: challenge?.content?.topicName ?? null,
      questionText: challenge && isPlayable(challenge) ? challenge.content.questionText : null,
      options: [],
      selectedOptionId: null,
      selectedOptionText: null,
      isCorrect: null,
      solveTimeMs: null,
      xpAwarded: 0,
      xpPending: false,
      revealAt,
      revealed: reveal !== null,
      reveal,
      won: false,
    };
  });

  return { rows, total };
}

/** The figures over the student's whole quiz record (brief §6.4). */
export async function quizSummary(student: Types.ObjectId, settings: QuizSettings, at: Date) {
  const today = todayOf(at);
  const [attempts, wins, facts] = await Promise.all([
    DailyChallengeAttempt.find({ student }).select('day answer.isCorrect').lean(),
    DailyQuizWinner.countDocuments({ student, status: 'published' }),
    getChallengeFacts(student, today),
  ]);

  // A correct answer counts once its correctness may be shown: at once with instant
  // results, otherwise after the reveal — the summary must not leak what the page hides.
  const counted = attempts.filter((attempt) => settings.instantResult || attempt.day < today);
  const correct = counted.filter((attempt) => attempt.answer?.isCorrect === true).length;

  return {
    attempted: attempts.length,
    correct,
    accuracy: counted.length === 0 ? null : Math.round((correct / counted.length) * 100),
    currentStreak: facts.currentChallengeStreak,
    longestStreak: facts.longestChallengeStreak,
    wins,
  };
}

// ---------------------------------------------------------------------------
// Staff: listing, calendar, figures
// ---------------------------------------------------------------------------

export interface ListQuizzesOptions {
  page: number;
  limit: number;
  from?: DayKey;
  to?: DayKey;
}

export interface GroupRow {
  _id: Types.ObjectId;
  day: DayKey;
  classLevels: ClassLevel[];
  docIds: Types.ObjectId[];
  classMin: number | null;
  classMax: number | null;
  question: Types.ObjectId;
  content: QuizContent | null;
  source: ChallengeSource;
  createdByLabel: string | null;
  createdAt: Date;
}

interface GroupPage {
  page: GroupRow[];
  total: Array<{ n: number }>;
}

/** Quizzes, one row per group, newest day first. */
export async function listQuizGroups(options: ListQuizzesOptions): Promise<{ groups: GroupRow[]; total: number }> {
  const match: Record<string, unknown> = {};
  if (options.from || options.to) {
    const day: Record<string, DayKey> = {};
    if (options.from) day.$gte = options.from;
    if (options.to) day.$lte = options.to;
    match.day = day;
  }

  const [facet] = await DailyChallenge.aggregate<GroupPage>([
    { $match: match },
    { $sort: { day: -1, classLevel: 1 } },
    {
      $group: {
        _id: { $ifNull: ['$groupId', '$_id'] },
        day: { $first: '$day' },
        classLevels: { $push: '$classLevel' },
        docIds: { $push: '$_id' },
        classMin: { $first: '$classMin' },
        classMax: { $first: '$classMax' },
        question: { $first: '$question' },
        content: { $first: '$content' },
        source: { $first: '$source' },
        createdByLabel: { $first: '$createdByLabel' },
        createdAt: { $first: '$createdAt' },
      },
    },
    { $sort: { day: -1, classMin: 1, _id: 1 } },
    {
      $facet: {
        page: [{ $skip: (options.page - 1) * options.limit }, { $limit: options.limit }],
        total: [{ $count: 'n' }],
      },
    },
  ]);

  return { groups: facet?.page ?? [], total: facet?.total[0]?.n ?? 0 };
}

export interface QuizStats {
  started: number;
  submitted: number;
  correct: number;
  /** Of those who submitted; null when nobody did — "nobody tried" is not "everybody failed". */
  correctPercent: number | null;
  medianSolveMs: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Started, submitted, % correct and median solve time, for each quiz (brief §6.5). */
export async function statsForGroups(
  groups: ReadonlyArray<{ id: string; docIds: readonly Types.ObjectId[] }>,
): Promise<Map<string, QuizStats>> {
  const allDocIds = groups.flatMap((group) => group.docIds);
  if (allDocIds.length === 0) return new Map();

  const [starts, attempts] = await Promise.all([
    DailyQuizStart.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { challenge: { $in: allDocIds } } },
      { $group: { _id: '$challenge', n: { $sum: 1 } } },
    ]),
    DailyChallengeAttempt.find({ challenge: { $in: allDocIds } }).select('challenge answer.isCorrect solveTimeMs').lean(),
  ]);

  const startsByDoc = new Map(starts.map((row) => [String(row._id), row.n]));
  const result = new Map<string, QuizStats>();

  for (const group of groups) {
    const ids = new Set(group.docIds.map(String));
    const mine = attempts.filter((attempt) => ids.has(String(attempt.challenge)));
    const correct = mine.filter((attempt) => attempt.answer?.isCorrect === true).length;
    const started = [...ids].reduce((sum, id) => sum + (startsByDoc.get(id) ?? 0), 0);
    result.set(group.id, {
      // An old attempt has no start record, so a quiz's starts are never fewer than its submissions.
      started: Math.max(started, mine.length),
      submitted: mine.length,
      correct,
      correctPercent: mine.length > 0 ? Math.round((correct / mine.length) * 100) : null,
      medianSolveMs: median(mine.map((attempt) => attempt.solveTimeMs).filter((ms): ms is number => typeof ms === 'number')),
    });
  }
  return result;
}

/** The staff row for one quiz. Staff may see the answer key — this is not a student view. */
export function adminQuizView(group: GroupRow, stats: QuizStats | undefined, at: Date, winner: { name: string; status: WinnerStatus } | null) {
  const own = classNumber(group.classLevels[0]!);
  const min = group.classMin ?? own;
  const max = group.classMax ?? own;
  const correct = group.content?.options.find((option) => option.key === group.content?.correctOptionKey) ?? null;
  return {
    groupId: String(group._id),
    day: group.day,
    phase: quizPhaseAt(group.day, at),
    classRange: { min, max, label: classRangeLabel(min, max) },
    classLevels: group.classLevels,
    source: group.source,
    playable: group.content !== null,
    question: {
      id: String(group.question),
      text: group.content?.questionText ?? null,
      topic: group.content?.topicName ?? null,
      difficulty: group.content?.difficulty ?? null,
      options: group.content?.options.map((option) => ({ id: option.id, text: option.text })) ?? [],
      correctOptionId: correct?.id ?? null,
      solution: group.content?.solution ?? null,
    },
    stats: stats ?? { started: 0, submitted: 0, correct: 0, correctPercent: null, medianSolveMs: null },
    winner,
    createdByLabel: group.createdByLabel,
    createdAt: group.createdAt,
  };
}

/**
 * The next `count` days: which classes have a quiz on each, and a warning for every class
 * group with a day **in the next three** that has no quiz for one of its classes (brief
 * §6.5). Days are this backend's — a browser must not decide which day is today.
 */
export async function quizCalendar(at: Date = now(), count = 14) {
  const today = todayOf(at);
  const days = Array.from({ length: count }, (_unused, index) => shiftDay(today, -index));
  const docs = await DailyChallenge.find({ day: { $gte: today, $lte: days[days.length - 1]! } })
    .select('day classLevel groupId classMin classMax content')
    .lean();

  const coveredByDay = new Map<DayKey, Set<number>>();
  const groupsByDay = new Map<DayKey, Map<string, { groupId: string; min: number; max: number; label: string; legacy: boolean }>>();
  for (const doc of docs) {
    const n = classNumber(doc.classLevel as ClassLevel);
    // A daily challenge from before the quiz holds its class's slot but is not a quiz: it is
    // listed (so the administrator can see what is blocking the day, and remove it) and
    // never counted as covering the class.
    const legacy = !doc.content;
    if (!legacy) {
      if (!coveredByDay.has(doc.day)) coveredByDay.set(doc.day, new Set());
      coveredByDay.get(doc.day)!.add(n);
    }
    const min = doc.classMin ?? n;
    const max = doc.classMax ?? n;
    const groupId = String(doc.groupId ?? doc._id);
    if (!groupsByDay.has(doc.day)) groupsByDay.set(doc.day, new Map());
    groupsByDay.get(doc.day)!.set(groupId, {
      groupId,
      min,
      max,
      label: legacy ? `${classRangeLabel(min, max)} · old challenge` : classRangeLabel(min, max),
      legacy,
    });
  }

  const warnings: Array<{ group: string; label: string; day: DayKey; missingClasses: number[] }> = [];
  for (const preset of CLASS_GROUPS) {
    for (const day of days.slice(0, 3)) {
      const covered = coveredByDay.get(day) ?? new Set<number>();
      const missing: number[] = [];
      for (let n = preset.min; n <= preset.max; n += 1) if (!covered.has(n)) missing.push(n);
      if (missing.length > 0) {
        warnings.push({ group: preset.key, label: classRangeLabel(preset.min, preset.max), day, missingClasses: missing });
        break; // the first gap per group is the one to act on
      }
    }
  }

  return {
    today,
    days: days.map((day) => ({
      day,
      coveredClasses: [...(coveredByDay.get(day) ?? new Set<number>())].sort((a, b) => a - b),
      quizzes: [...(groupsByDay.get(day)?.values() ?? [])].sort((a, b) => a.min - b.min),
    })),
    warnings,
  };
}

export interface CandidateOptions {
  classMin: number;
  classMax: number;
  search?: string;
  page: number;
  limit: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bank questions that can become a quiz for a class range: single choice, unpublished,
 * not archived, inside the range, with a solution, and not already a quiz. The scheduler's
 * picker lists these; scheduling re-checks every rule anyway.
 */
export async function listQuizCandidates(options: CandidateOptions) {
  const classes = classesInRange(options.classMin, options.classMax);
  const [used, subject] = await Promise.all([
    DailyChallenge.distinct('question') as Promise<Types.ObjectId[]>,
    // Scoped to the implicit subject, like every picker that chooses what a child is served
    // (CLAUDE.md); `null` (ambiguous) leaves it unscoped, as `suggestPaper()` does.
    findImplicitSubject(),
  ]);

  const filter: Record<string, unknown> = {
    type: 'single_choice',
    status: { $in: [...QUIZ_SOURCE_STATUSES] },
    classLevel: { $in: classes },
    solution: { $nin: [null, ''] },
    _id: { $nin: used },
    ...(subject ? { subject } : {}),
  };
  if (options.search && options.search.trim()) {
    filter.questionText = { $regex: escapeRegex(options.search.trim()), $options: 'i' };
  }

  const [docs, total] = await Promise.all([
    Question.find(filter)
      .sort({ updatedAt: -1, _id: 1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit)
      .populate('topic', 'name'),
    Question.countDocuments(filter),
  ]);

  return {
    candidates: docs.map((question) => {
      const topic = question.topic as unknown as { name?: string } | null;
      const correct = question.options.filter((option) => option.isCorrect).length;
      return {
        id: String(question._id),
        questionText: question.questionText,
        classLevel: question.classLevel,
        difficulty: question.difficulty,
        topic: topic?.name ?? null,
        status: question.status,
        optionCount: question.options.length,
        ready: correct === 1 && question.options.length >= 2 && question.options.length <= 6,
      };
    }),
    total,
  };
}

// ---------------------------------------------------------------------------
// Winners (staff)
// ---------------------------------------------------------------------------

/** How many leading candidates "Compute winners" writes — enough to replace a disqualified one. */
const PROVISIONAL_COUNT = 5;

const WINNER_STUDENT_FIELDS =
  'studentId firstName lastName fullName classLevel schoolName city guardianPhone guardianEmail email isEmailVerified status hideFromPublicLists';

/**
 * Ranks the quiz's correct answers by the configured rule and writes the leading few as
 * **provisional** candidates. Nothing becomes public here.
 *
 * Only once the quiz has closed (its answer revealed), so the field is complete. Rows an
 * administrator has already decided — confirmed, published, disqualified — are never
 * touched; a disqualified student is never offered again. Also returns the fastest
 * correct answers that were **not** eligible, with what each lacks, so the review can see
 * who was passed over and why.
 */
export async function computeWinners(groupId: string, at: Date = now()) {
  const docs = await requireGroup(groupId);
  const first = docs[0]!;
  if (!isPlayable(first)) throw ApiError.conflict('This day’s challenge predates the Daily Quiz and has no prize.');
  if (quizPhaseAt(first.day, at) !== 'revealed') {
    throw ApiError.conflict('Winners can be computed once the quiz has closed, after midnight.');
  }

  const settings = await getQuizSettings();
  const id = groupIdOf(first);
  const range = rangeOf(first);
  const docIds = docs.map((doc) => doc._id);

  const correctAttempts = await DailyChallengeAttempt.find({ challenge: { $in: docIds }, 'answer.isCorrect': true });
  const students = new Map(
    (await Student.find({ _id: { $in: correctAttempts.map((attempt) => attempt.student) } }).select(WINNER_STUDENT_FIELDS)).map(
      (student) => [String(student._id), student],
    ),
  );
  const existing = new Map(
    (await DailyQuizWinner.find({ groupId: id })).map((row) => [String(row.student), row]),
  );
  const shared = sharedIpCounts(correctAttempts.map((attempt) => ({ id: String(attempt._id), ipHash: attempt.ipHash ?? null })));

  const candidates = correctAttempts.map((attempt) => {
    const student = students.get(String(attempt.student));
    return {
      attemptId: String(attempt._id),
      studentId: String(attempt.student),
      solveTimeMs: attempt.solveTimeMs ?? null,
      submittedAt: attempt.submittedAt,
      eligible: student ? eligibilityOf(student).eligible : false,
      disqualified: existing.get(String(attempt.student))?.status === 'disqualified',
    };
  });

  const ranked = rankCandidates(candidates, settings.winnerRule).slice(0, PROVISIONAL_COUNT);
  const keep = new Set(ranked.map((candidate) => candidate.studentId));

  // Provisional rows that fell out of the top few are withdrawn; decided rows are kept.
  await DailyQuizWinner.deleteMany({
    groupId: id,
    status: 'provisional',
    student: { $nin: [...keep].map((s) => new Types.ObjectId(s)) },
  });

  let rank = 0;
  for (const candidate of ranked) {
    rank += 1;
    const prior = existing.get(candidate.studentId);
    if (prior && prior.status !== 'provisional') continue;
    await DailyQuizWinner.findOneAndUpdate(
      { groupId: id, student: new Types.ObjectId(candidate.studentId) },
      {
        $set: {
          day: first.day,
          classMin: range.min,
          classMax: range.max,
          attempt: new Types.ObjectId(candidate.attemptId),
          rank,
          ruleUsed: settings.winnerRule,
          status: 'provisional',
          solveTimeMs: candidate.solveTimeMs,
          submittedAt: candidate.submittedAt,
          sharedIpCount: shared.get(candidate.attemptId) ?? 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  const ineligible = rankCandidates(
    candidates.map((candidate) => ({ ...candidate, eligible: !candidate.eligible })),
    settings.winnerRule,
  )
    .slice(0, PROVISIONAL_COUNT)
    .map((candidate) => {
      const student = students.get(candidate.studentId);
      return {
        studentId: student?.studentId ?? null,
        name: student ? (student.fullName ?? `${student.firstName} ${student.lastName}`) : null,
        solveTimeMs: candidate.solveTimeMs,
        missing: student ? eligibilityOf(student).missing : (['active-account'] as EligibilityRequirement[]),
      };
    });

  return { correctCount: correctAttempts.length, ineligible };
}

export const WINNER_ACTIONS = ['confirm', 'disqualify', 'publish', 'contacted', 'delivered'] as const;
export type WinnerAction = (typeof WINNER_ACTIONS)[number];

/**
 * Moves one candidate along `provisional → confirmed → published`, disqualifies one with
 * a reason, or records that a published winner was contacted or their prize delivered.
 *
 * Every transition is a **conditional write** on the current status, so two
 * administrators acting at once cannot both confirm, and a stale page cannot publish a
 * row someone else just disqualified. Confirming snapshots the prize from the settings.
 */
export async function applyWinnerAction(
  winnerId: string,
  action: WinnerAction,
  actor: Actor,
  options: { reason?: string | null; at?: Date } = {},
): Promise<DailyQuizWinnerDocument> {
  const at = options.at ?? now();
  if (!Types.ObjectId.isValid(winnerId)) throw ApiError.notFound('No such winner candidate.');
  const row = await DailyQuizWinner.findById(winnerId);
  if (!row) throw ApiError.notFound('No such winner candidate.');

  const decided = { decidedBy: actor.id, decidedByLabel: actor.label };
  let filter: Record<string, unknown>;
  let update: Record<string, unknown>;

  switch (action) {
    case 'confirm': {
      const settings = await getQuizSettings();
      const chosen = await DailyQuizWinner.countDocuments({ groupId: row.groupId, status: { $in: ['confirmed', 'published'] } });
      if (chosen >= settings.winnersPerQuiz) {
        throw ApiError.conflict(
          settings.winnersPerQuiz === 1
            ? 'This quiz already has its winner. Disqualify them first to choose someone else.'
            : `This quiz already has its ${settings.winnersPerQuiz} winners.`,
        );
      }
      filter = { _id: row._id, status: 'provisional' };
      update = { status: 'confirmed', confirmedAt: at, prizeText: settings.prizeText, cashAmount: settings.cashAmount, ...decided };
      break;
    }
    case 'disqualify': {
      const reason = options.reason?.trim() ?? '';
      if (reason.length < 5) throw ApiError.badRequest('Say why this candidate is being disqualified (at least five characters).');
      filter = { _id: row._id, status: { $in: ['provisional', 'confirmed', 'published'] } };
      update = { status: 'disqualified', reason, ...decided };
      break;
    }
    case 'publish':
      filter = { _id: row._id, status: 'confirmed' };
      update = { status: 'published', publishedAt: at, ...decided };
      break;
    case 'contacted':
      filter = { _id: row._id, status: 'published' };
      update = { contactedAt: at, ...decided };
      break;
    case 'delivered':
      filter = { _id: row._id, status: 'published' };
      update = { deliveredAt: at, ...decided };
      break;
    default:
      throw ApiError.badRequest('That is not a winner action.');
  }

  const updated = await DailyQuizWinner.findOneAndUpdate(filter, { $set: update }, { new: true });
  if (updated && action === 'confirm') {
    // The count above and this write are two operations, so two administrators confirming
    // two different candidates in the same second could both pass it. Re-count after the
    // write and withdraw our own confirmation if it took the quiz over its limit — the
    // safe failure is "nobody confirmed, try again", never two people promised one prize.
    const settings = await getQuizSettings();
    const chosen = await DailyQuizWinner.countDocuments({ groupId: row.groupId, status: { $in: ['confirmed', 'published'] } });
    if (chosen > settings.winnersPerQuiz) {
      await DailyQuizWinner.updateOne(
        { _id: row._id, status: 'confirmed', confirmedAt: at },
        { $set: { status: 'provisional' }, $unset: { confirmedAt: 1, prizeText: 1, cashAmount: 1 } },
      );
      throw ApiError.conflict('Another winner was confirmed for this quiz at the same moment. Reload and check before confirming again.');
    }
  }
  if (!updated) {
    const needs: Record<WinnerAction, string> = {
      confirm: 'Only a provisional candidate can be confirmed.',
      disqualify: 'This candidate has already been disqualified.',
      publish: 'Only a confirmed winner can be published.',
      contacted: 'Only a published winner can be marked as contacted.',
      delivered: 'Only a published winner can be marked as delivered.',
    };
    throw ApiError.conflict(needs[action]);
  }
  return updated;
}

type WinnerStudentFacts = Pick<
  StudentDocument,
  | 'studentId'
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'classLevel'
  | 'schoolName'
  | 'city'
  | 'guardianPhone'
  | 'guardianEmail'
  | 'email'
  | 'isEmailVerified'
  | 'status'
  | 'hideFromPublicLists'
>;

/**
 * One winner row as staff see it — contact details included, because the point of this
 * view is the phone call to a parent. Shared by a quiz's own page and the prize desk so
 * the two can never describe the same row differently.
 */
function winnerRowView(row: DailyQuizWinnerDocument, student: WinnerStudentFacts | undefined) {
  return {
    id: String(row._id),
    groupId: String(row.groupId),
    day: row.day,
    classMin: row.classMin,
    classMax: row.classMax,
    rank: row.rank,
    status: row.status,
    reason: row.reason ?? null,
    ruleUsed: row.ruleUsed,
    solveTimeMs: row.solveTimeMs ?? null,
    submittedAt: row.submittedAt,
    sharedIpCount: row.sharedIpCount,
    prizeText: row.prizeText ?? null,
    cashAmount: row.cashAmount ?? null,
    confirmedAt: row.confirmedAt ?? null,
    publishedAt: row.publishedAt ?? null,
    contactedAt: row.contactedAt ?? null,
    deliveredAt: row.deliveredAt ?? null,
    decidedByLabel: row.decidedByLabel ?? null,
    student: student
      ? {
          studentId: student.studentId,
          name: student.fullName ?? `${student.firstName} ${student.lastName}`,
          classLevel: student.classLevel ?? null,
          schoolName: student.schoolName ?? null,
          city: student.city ?? null,
          email: student.email,
          emailVerified: student.isEmailVerified === true,
          guardianPhone: student.guardianPhone ?? null,
          guardianEmail: student.guardianEmail ?? null,
          eligibility: eligibilityOf(student),
        }
      : null,
  };
}

export type WinnerRowView = ReturnType<typeof winnerRowView>;

async function studentsForWinners(rows: readonly DailyQuizWinnerDocument[]) {
  const students = await Student.find({ _id: { $in: rows.map((row) => row.student) } }).select(WINNER_STUDENT_FIELDS);
  return new Map(students.map((student) => [String(student._id), student as WinnerStudentFacts]));
}

/** The staff view of one quiz's candidates and winners, best-ranked first. */
export async function winnersForGroup(groupId: Types.ObjectId): Promise<WinnerRowView[]> {
  const rows = await DailyQuizWinner.find({ groupId }).sort({ rank: 1, _id: 1 });
  const students = await studentsForWinners(rows);
  return rows.map((row) => winnerRowView(row, students.get(String(row.student))));
}

/** One winner row, after an action on it — what the prize desk re-renders. */
export async function winnerRow(winner: DailyQuizWinnerDocument): Promise<WinnerRowView> {
  const students = await studentsForWinners([winner]);
  return winnerRowView(winner, students.get(String(winner.student)));
}

/**
 * THE prize desk: every decided winner across every quiz, so contacting a parent and
 * delivering a prize can be tracked without opening each day in turn (brief §6.5, "track
 * contacted / delivered").
 *
 * `outstanding` is what still needs a person — confirmed but not yet published, or
 * published with the prize not yet delivered — oldest first, because the oldest is the
 * child who has waited longest. A winner row is self-contained (day, class range and
 * prize are on it), so the desk keeps working for a quiz that has since been removed or
 * reset; that is why a reset leaves decided rows alone. Provisional rows are not listed:
 * they are a computation awaiting review, and they live on their quiz's own page.
 */
export async function listPrizeDesk(options: { view: PrizeDeskView; page: number; limit: number }) {
  const filter: Record<string, unknown> =
    options.view === 'outstanding'
      ? { $or: [{ status: 'confirmed' }, { status: 'published', deliveredAt: null }] }
      : options.view === 'all'
        ? { status: { $in: ['confirmed', 'published', 'disqualified'] } }
        : { status: options.view };
  const sort: Record<string, 1 | -1> = options.view === 'outstanding' ? { day: 1, rank: 1, _id: 1 } : { day: -1, rank: 1, _id: 1 };

  const [rows, total, outstanding] = await Promise.all([
    DailyQuizWinner.find(filter)
      .sort(sort)
      .skip((options.page - 1) * options.limit)
      .limit(options.limit),
    DailyQuizWinner.countDocuments(filter),
    DailyQuizWinner.countDocuments({ $or: [{ status: 'confirmed' }, { status: 'published', deliveredAt: null }] }),
  ]);
  const students = await studentsForWinners(rows);
  const liveGroups = new Set(
    (await DailyChallenge.distinct('groupId', { groupId: { $in: rows.map((row) => row.groupId) } })).map(String),
  );

  return {
    winners: rows.map((row) => ({ ...winnerRowView(row, students.get(String(row.student))), quizExists: liveGroups.has(String(row.groupId)) })),
    total,
    outstanding,
  };
}

/** Who won each of these quizzes, for the listing — confirmed or published, by name. */
export async function winnerSummaries(groupIds: readonly Types.ObjectId[]) {
  const rows = await DailyQuizWinner.find({ groupId: { $in: [...groupIds] }, status: { $in: ['confirmed', 'published'] } })
    .sort({ rank: 1 })
    .populate('student', 'firstName lastName fullName');
  const out = new Map<string, { name: string; status: WinnerStatus }>();
  for (const row of rows) {
    const key = String(row.groupId);
    if (out.has(key)) continue;
    const student = row.student as unknown as { firstName?: string; lastName?: string; fullName?: string } | null;
    out.set(key, { name: student?.fullName ?? `${student?.firstName ?? ''} ${student?.lastName ?? ''}`.trim(), status: row.status });
  }
  return out;
}

/**
 * The public "recent winners" list (brief §7.4): published winners only, newest first,
 * shown as the public boards show children — first name and last initial, class, city or
 * school — and anonymous for a student who opted out of public lists.
 */
export async function publicRecentWinners(limit: number) {
  const rows = await DailyQuizWinner.find({ status: 'published' })
    .sort({ publishedAt: -1, _id: -1 })
    .limit(limit)
    .populate('student', 'firstName lastName fullName classLevel schoolName city hideFromPublicLists status');

  return rows
    .map((row) => {
      const student = row.student as unknown as StudentDocument | null;
      if (!student || student.status !== 'active') return null;
      const hidden = student.hideFromPublicLists === true;
      return {
        day: row.day,
        displayName: hidden ? `A ${student.classLevel ?? ''} student`.replace(/\s+/g, ' ').trim() : displayNameFor(student),
        classLevel: student.classLevel ?? null,
        place: hidden ? null : (student.city?.trim() || student.schoolName?.trim() || null),
        prizeText: row.prizeText ?? null,
      };
    })
    .filter((row) => row !== null);
}

// ---------------------------------------------------------------------------
// Streak and the facts the achievement catalogue needs (unchanged since Milestone 8)
// ---------------------------------------------------------------------------

/**
 * The longest and current runs of consecutive days on which the student answered.
 *
 * Computed from the distinct days present rather than stored, exactly as the visit
 * streak is (`progressService`) and for the same reason: a stored counter can drift
 * from the events behind it, and there is no counter here to drift.
 *
 * `current` counts a run ending **today or yesterday** — today's quiz may not have been
 * answered yet, and a streak is not lost until a day passes without one. A start that
 * was never submitted is not an attempt, so it neither extends nor breaks a run.
 */
export function challengeStreakOf(days: readonly DayKey[], today: DayKey = dayKeyOf(now())): {
  current: number;
  longest: number;
} {
  if (days.length === 0) return { current: 0, longest: 0 };

  const sorted = [...new Set(days)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (daysBetween(sorted[i]!, sorted[i - 1]!) === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  const newest = sorted[0]!;
  const gap = daysBetween(newest, today);
  let current = 0;
  if (gap === 0 || gap === 1) {
    current = 1;
    for (let i = 1; i < sorted.length; i += 1) {
      if (daysBetween(sorted[i]!, sorted[i - 1]!) === 1) current += 1;
      else break;
    }
  }

  return { current, longest };
}

export interface ChallengeFacts {
  challengesCompleted: number;
  currentChallengeStreak: number;
  longestChallengeStreak: number;
}

/**
 * The counts the achievement catalogue asks for, plus the current streak for the
 * student's own page — the **whole** interface between the quiz and the achievement
 * system. Submissions only: a start is not an attempt.
 */
export async function getChallengeFacts(
  student: Types.ObjectId,
  today: DayKey = dayKeyOf(now()),
): Promise<ChallengeFacts> {
  const days = (await DailyChallengeAttempt.distinct('day', { student })) as DayKey[];
  const streak = challengeStreakOf(days, today);

  return {
    challengesCompleted: days.length,
    currentChallengeStreak: streak.current,
    longestChallengeStreak: streak.longest,
  };
}

/** Facts for a student whose quiz history cannot be read — honest zeroes. */
export const NO_CHALLENGE_FACTS: ChallengeFacts = {
  challengesCompleted: 0,
  currentChallengeStreak: 0,
  longestChallengeStreak: 0,
};
