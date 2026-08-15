import { Types } from 'mongoose';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import type { ClassLevel } from '../lib/classLevels';
import { daysBetween, isDayKey, shiftDay, todayKey, type DayKey } from '../lib/competitionDay';
import {
  DailyChallenge,
  DailyChallengeAttempt,
  Question,
  STUDENT_VISIBLE_STATUSES,
  type AttemptAnswerEntry,
  type ChallengeSource,
  type DailyChallengeAttemptDocument,
  type DailyChallengeDocument,
  type QuestionDocument,
} from '../models';
import type { Actor } from './taxonomyService';
import { gradeEntry, isAnswered } from './grading';
import { refView, studentQuestionView } from './questionView';

/**
 * The daily challenge: scheduling one, serving today's, answering it, and reporting
 * how it went.
 *
 * ## Four properties this module exists to hold
 *
 * **1. A day's challenge is pinned, not recomputed.** `resolveChallengeFor()` returns
 * the stored `DailyChallenge` for a day and class, and only computes one when none
 * exists — writing it before serving it. Everything downstream refers to that
 * document. The old behaviour recomputed a hash modulo the *current* number of
 * published questions, so publishing anything changed which question "today" was, for
 * everybody, mid-day.
 *
 * **2. One reward per competition day, twice guarded.** The unique index on
 * `DailyChallengeAttempt {student, day}` makes a second attempt impossible, and
 * `recordActivity()` independently caps `daily_challenge_completed` at once per day.
 * Either alone would do; both together mean a bug in one is not a paid exploit.
 *
 * **3. The day is an IST calendar day.** Every day key comes from
 * `lib/competitionDay.ts` — never from a client, and never from the host's local
 * timezone. A student answering at 00:05 IST is answering *today's* challenge, and one
 * answering at 23:55 IST followed by 00:05 IST has legitimately answered two.
 *
 * **4. XP and achievements are reached only through their own services.** This module
 * never writes a `StudentActivity` row itself and never decides what an event is
 * worth: the route calls `recordActivity()`, and `getChallengeFacts()` hands the
 * achievement catalogue two plain counts. Nothing here knows how many XP a challenge
 * is, and nothing in the XP or achievement code knows what a challenge is.
 */

// ---------------------------------------------------------------------------
// Choosing the question
// ---------------------------------------------------------------------------

/**
 * A tiny deterministic hash of the day key.
 *
 * Only used to choose which published question a day gets when nobody scheduled one,
 * so it needs to be stable and well spread, not cryptographic. Every class gets its
 * own stream because the class level is mixed in — otherwise Class 9 and Class 12
 * would land on the same index of two different lists, which is harmless but makes
 * "why did both classes get question 14?" a confusing thing to look at.
 */
function daySeed(day: DayKey, classLevel: ClassLevel): number {
  let hash = 2166136261;
  const input = `${day}|${classLevel}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The question a day *would* get automatically, or null when the bank has nothing
 * published for that class.
 *
 * Sorted by `_id` so the ordering `skip` walks is total and stable. This is the only
 * place the automatic pick is decided, and its result is pinned by the caller — so the
 * instability of `skip` over a growing collection is confined to the single moment a
 * day is first served, rather than affecting every read of it.
 */
async function pickAutomaticQuestion(
  classLevel: ClassLevel,
  day: DayKey,
): Promise<QuestionDocument | null> {
  const filter = { classLevel, status: { $in: [...STUDENT_VISIBLE_STATUSES] } };
  const available = await Question.countDocuments(filter);
  if (available === 0) return null;

  return Question.findOne(filter)
    .sort({ _id: 1 })
    .skip(daySeed(day, classLevel) % available);
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * The challenge for one day and class: the stored one, or a newly pinned automatic
 * one. Null only when the bank has nothing published for that class.
 *
 * The duplicate-key path is the concurrency case and is expected, not exceptional: two
 * students opening the dashboard in the same instant both find nothing pinned, both
 * compute the same question, and both insert. One wins; the other reads the winner's
 * document. That is why the pick has to be deterministic even though it is being
 * persisted — a random pick would make the loser's students disagree with the
 * winner's for the rest of the day.
 */
export async function resolveChallengeFor(
  classLevel: ClassLevel,
  day: DayKey = todayKey(),
): Promise<DailyChallengeDocument | null> {
  const existing = await DailyChallenge.findOne({ day, classLevel });
  if (existing) return existing;

  const question = await pickAutomaticQuestion(classLevel, day);
  if (!question) return null;

  try {
    return await DailyChallenge.create({
      day,
      classLevel,
      question: question._id,
      source: 'automatic' satisfies ChallengeSource,
      marks: question.marks,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const raced = await DailyChallenge.findOne({ day, classLevel });
      if (raced) return raced;
    }
    throw err;
  }
}

/** Loads the question a challenge points at, with its taxonomy names populated. */
export async function loadChallengeQuestion(
  challenge: DailyChallengeDocument,
): Promise<QuestionDocument | null> {
  return Question.findById(challenge.question)
    .populate('subject', 'name slug')
    .populate('topic', 'name slug')
    .populate('subtopic', 'name slug');
}

// ---------------------------------------------------------------------------
// Scheduling (staff)
// ---------------------------------------------------------------------------

export interface ScheduleChallengeInput {
  day: DayKey;
  classLevel: ClassLevel;
  questionId: string;
}

/**
 * Checks a question is a legitimate choice for a challenge, and returns it.
 *
 * Three rules, all of which would otherwise surface as a broken challenge on the
 * morning it ran rather than at the moment it was scheduled:
 *  - the question must exist;
 *  - it must be **published**, because a student may only ever be served a published
 *    question (a draft would leak unreviewed content to a whole class); and
 *  - it must be for the class being scheduled, since that is who will be answering it.
 */
async function requireSchedulableQuestion(questionId: string, classLevel: ClassLevel): Promise<QuestionDocument> {
  const question = await Question.findById(questionId);
  if (!question) throw ApiError.badRequest('That question no longer exists in the bank.');
  if (!STUDENT_VISIBLE_STATUSES.includes(question.status)) {
    throw ApiError.conflict('Only a published question can be set as a daily challenge.');
  }
  if (question.classLevel !== classLevel) {
    throw ApiError.badRequest(`That question is for ${question.classLevel}, not ${classLevel}.`);
  }
  return question;
}

/**
 * Schedules a challenge for a future day (or today, if today has not been pinned yet).
 *
 * Scheduling the **past** is refused: the challenge for a past day is a record of what
 * a cohort was actually set, and rewriting it would make every attempt against it
 * describe a question the student never saw. Today is allowed only while it is
 * unpinned — see `rescheduleChallenge()` for the "already served" case, which is
 * refused for the same reason once anybody has answered.
 */
export async function scheduleChallenge(
  input: ScheduleChallengeInput,
  actor: Actor,
): Promise<DailyChallengeDocument> {
  if (!isDayKey(input.day)) throw ApiError.badRequest('Use a real calendar date (YYYY-MM-DD).');
  if (daysBetween(todayKey(), input.day) < 0) {
    throw ApiError.badRequest('A daily challenge cannot be scheduled in the past.');
  }

  const question = await requireSchedulableQuestion(input.questionId, input.classLevel);

  try {
    return await DailyChallenge.create({
      day: input.day,
      classLevel: input.classLevel,
      question: question._id,
      source: 'scheduled' satisfies ChallengeSource,
      marks: question.marks,
      createdBy: actor.id,
      createdByLabel: actor.label,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw ApiError.conflict(
        `${input.classLevel} already has a challenge for ${input.day}. Edit that one instead of adding a second.`,
      );
    }
    throw err;
  }
}

/**
 * Changes which question a scheduled day uses.
 *
 * Refused once **anybody has attempted it**, on the same reasoning as a mock test
 * whose paper freezes: the attempts already recorded snapshot their own answer key, so
 * their marks would stay correct, but the challenge document would no longer describe
 * what those students were asked — and the admin's own "how did the cohort do on this
 * question?" figures would mix two different questions.
 *
 * A day still in the future can be changed freely, which is the point of scheduling in
 * advance.
 */
export async function rescheduleChallenge(
  id: string,
  questionId: string,
  actor: Actor,
): Promise<DailyChallengeDocument> {
  const challenge = await findChallengeById(id);

  const attempts = await DailyChallengeAttempt.countDocuments({ challenge: challenge._id });
  if (attempts > 0) {
    throw ApiError.conflict(
      `${attempts} student(s) have already answered this challenge, so its question can no longer be changed.`,
    );
  }
  if (daysBetween(todayKey(), challenge.day) < 0) {
    throw ApiError.conflict('A past day cannot be changed — it is the record of what that class was set.');
  }

  const question = await requireSchedulableQuestion(questionId, challenge.classLevel);

  challenge.question = question._id as Types.ObjectId;
  challenge.marks = question.marks;
  // A day that was auto-filled and is then edited by hand becomes a staff decision.
  challenge.source = 'scheduled';
  challenge.createdBy = actor.id;
  challenge.createdByLabel = actor.label;
  await challenge.save();

  return challenge;
}

/** Removes a scheduled challenge. Refused once anybody has answered it. */
export async function deleteChallenge(id: string): Promise<DailyChallengeDocument> {
  const challenge = await findChallengeById(id);

  const attempts = await DailyChallengeAttempt.countDocuments({ challenge: challenge._id });
  if (attempts > 0) {
    throw ApiError.conflict(
      'Students have already answered this challenge, so it cannot be removed — it is part of their record.',
    );
  }

  await DailyChallenge.deleteOne({ _id: challenge._id });
  return challenge;
}

export async function findChallengeById(id: string): Promise<DailyChallengeDocument> {
  const challenge = await DailyChallenge.findById(id);
  if (!challenge) throw ApiError.notFound('No daily challenge exists with that id.');
  return challenge;
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

/** The snapshot for the single served question, priced as the challenge prices it. */
function snapshotOf(question: QuestionDocument, challenge: DailyChallengeDocument): AttemptAnswerEntry {
  return {
    question: question._id as Types.ObjectId,
    revision: question.revision,
    type: question.type,
    marks: challenge.marks,
    /**
     * **A daily challenge never penalises a wrong answer**, whatever the question's own
     * negative marking says. It is one question a day meant to build a habit, the XP
     * is for answering rather than for being right, and a negative score on a
     * single-question challenge would read as a punishment for taking part.
     */
    negativeMarks: 0,
    correctOptionKeys: question.options.filter((option) => option.isCorrect).map((option) => option.key),
    booleanAnswer: question.booleanAnswer ?? null,
    numericAnswer: question.numericAnswer ?? null,
    tolerance: question.tolerance ?? null,
    acceptedAnswers: [...(question.acceptedAnswers ?? [])],
    selectedOptionKeys: [],
    numericResponse: null,
    booleanResponse: null,
    answeredAt: null,
    isCorrect: null,
    awardedMarks: null,
  };
}

export interface ChallengeAnswerInput {
  selectedOptionKeys?: string[];
  numericResponse?: number | null;
  textResponse?: string | null;
  booleanResponse?: boolean | null;
}

export interface SubmitChallengeInput {
  challenge: DailyChallengeDocument;
  question: QuestionDocument;
  student: Types.ObjectId;
  answer: ChallengeAnswerInput;
  at?: Date;
}

export interface SubmitChallengeResult {
  attempt: DailyChallengeAttemptDocument;
  /** False when the student had already answered today — the reward is not repaid. */
  created: boolean;
}

/**
 * Grades and stores one answer to the day's challenge.
 *
 * Marking is server-side against the snapshot taken here, using the one shared grader
 * — so the browser is never given anything to mark with, and the daily challenge
 * cannot disagree with practice or a mock test about what "correct" means.
 *
 * A blank submission is refused rather than stored: unlike a paper with many
 * questions, where skipping one is a legitimate choice, an empty challenge answer is
 * either a mis-click or an attempt to claim the day's reward without playing. Refusing
 * it keeps `xpAwarded` honest without needing a special case in the reward path.
 *
 * The duplicate-key path is the reward guard doing its job: the second submission of
 * the day returns the stored attempt with `created: false`, so the caller knows not to
 * award anything and the student is shown the answer they actually gave.
 */
export async function submitChallengeAnswer(input: SubmitChallengeInput): Promise<SubmitChallengeResult> {
  const { challenge, question, student, answer } = input;
  const at = input.at ?? new Date();

  const entry = snapshotOf(question, challenge);
  const servedOptionKeys = question.options.map((option) => option.key);

  if (entry.type === 'single_choice' || entry.type === 'multiple_choice') {
    const keys = [...new Set(answer.selectedOptionKeys ?? [])];
    const unknown = keys.filter((key) => !servedOptionKeys.includes(key));
    if (unknown.length > 0) throw ApiError.badRequest('That option does not belong to this question.');
    if (entry.type === 'single_choice' && keys.length > 1) {
      throw ApiError.badRequest('This question takes a single answer.');
    }
    entry.selectedOptionKeys = keys;
  } else if (entry.type === 'true_false') {
    entry.booleanResponse = answer.booleanResponse ?? null;
  } else if (entry.type === 'fill_blank') {
    // Stored exactly as typed; normalisation belongs to the grader.
    entry.textResponse = answer.textResponse ?? null;
  } else {
    entry.numericResponse = answer.numericResponse ?? null;
  }

  if (!isAnswered(entry)) {
    throw ApiError.badRequest('Choose an answer before submitting.');
  }
  entry.answeredAt = at;

  const outcome = gradeEntry(entry);
  entry.isCorrect = outcome.isCorrect;
  entry.awardedMarks = outcome.awardedMarks;

  try {
    const attempt = await DailyChallengeAttempt.create({
      challenge: challenge._id,
      student,
      day: challenge.day,
      answer: entry,
      // Written by the route once `recordActivity` has said what was actually awarded;
      // created at 0 so a failed award can never look like a paid one.
      xpAwarded: 0,
      submittedAt: at,
    });
    return { attempt, created: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const existing = await DailyChallengeAttempt.findOne({ student, day: challenge.day });
      if (existing) return { attempt: existing, created: false };
    }
    throw err;
  }
}

/** The caller's attempt at one day, or null. Ownership is part of the query. */
export async function findOwnAttempt(
  student: Types.ObjectId,
  day: DayKey,
): Promise<DailyChallengeAttemptDocument | null> {
  return DailyChallengeAttempt.findOne({ student, day });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * The challenge as an **unanswered** student may see it.
 *
 * Question content comes from `studentQuestionView`, the same answer-stripped
 * projection every other student-facing surface uses, so there is no `isCorrect`, no
 * `solution`, and no `numericAnswer` anywhere in it. `marks` is overridden with the
 * challenge's pinned value, and `negativeMarks` is reported as 0 because that is what
 * grading will actually apply.
 */
export function challengeQuestionView(challenge: DailyChallengeDocument, question: QuestionDocument) {
  return {
    day: challenge.day,
    challengeId: String(challenge._id),
    classLevel: challenge.classLevel,
    question: {
      ...studentQuestionView(question),
      marks: challenge.marks,
      negativeMarks: 0,
    },
  };
}

/**
 * The **result** view: what the student answered, whether it was right, and why.
 *
 * The only function here that reveals a correct answer, and it can only be reached
 * with an attempt document in hand — which by construction only exists once the
 * student has answered. There is no policy to consult, unlike a mock test: a daily
 * challenge reveals immediately, because its whole purpose is to teach one question a
 * day and a withheld explanation would defeat that.
 */
export function attemptResultView(
  attempt: DailyChallengeAttemptDocument,
  question: QuestionDocument | null,
) {
  const entry = attempt.answer;

  return {
    id: String(attempt._id),
    day: attempt.day,
    submittedAt: attempt.submittedAt,
    xpAwarded: attempt.xpAwarded,
    isCorrect: entry.isCorrect ?? false,
    awardedMarks: entry.awardedMarks ?? 0,
    marks: entry.marks,
    response: {
      selectedOptionKeys: entry.selectedOptionKeys,
      numericResponse: entry.numericResponse ?? null,
      textResponse: entry.textResponse ?? null,
      booleanResponse: entry.booleanResponse ?? null,
    },
    correctAnswer: {
      optionKeys: entry.correctOptionKeys,
      booleanAnswer: entry.booleanAnswer ?? null,
      numericAnswer: entry.numericAnswer ?? null,
      tolerance: entry.tolerance ?? null,
      acceptedAnswers: entry.acceptedAnswers ?? [],
    },
    explanation: question?.solution ?? null,
    /** The question has been edited since it was answered. */
    revisionChanged: question ? question.revision !== entry.revision : false,
  };
}

/** One row of the student's own challenge history. Carries no unrevealed answer. */
export function attemptHistoryView(
  attempt: DailyChallengeAttemptDocument,
  question: QuestionDocument | null,
) {
  return {
    id: String(attempt._id),
    day: attempt.day,
    submittedAt: attempt.submittedAt,
    isCorrect: attempt.answer.isCorrect ?? false,
    awardedMarks: attempt.answer.awardedMarks ?? 0,
    marks: attempt.answer.marks,
    xpAwarded: attempt.xpAwarded,
    questionText: question?.questionText ?? null,
    subject: question ? refView(question.subject) : null,
    topic: question ? refView(question.topic) : null,
  };
}

/** The staff view of a scheduled or served day. */
export function adminChallengeView(
  challenge: DailyChallengeDocument,
  question: QuestionDocument | null,
  stats?: { attempts: number; correct: number },
) {
  return {
    id: String(challenge._id),
    day: challenge.day,
    classLevel: challenge.classLevel,
    source: challenge.source,
    marks: challenge.marks,
    question: {
      id: String(challenge.question),
      questionText: question?.questionText ?? null,
      type: question?.type ?? null,
      difficulty: question?.difficulty ?? null,
      status: question?.status ?? null,
      subject: question ? refView(question.subject) : null,
      topic: question ? refView(question.topic) : null,
    },
    attempts: stats?.attempts ?? 0,
    correct: stats?.correct ?? 0,
    /**
     * Of those who answered, so a day nobody attempted is `null` rather than 0% —
     * "nobody tried" and "everybody got it wrong" are different facts.
     */
    correctPercent: stats && stats.attempts > 0 ? Math.round((stats.correct / stats.attempts) * 100) : null,
    createdByLabel: challenge.createdByLabel ?? null,
    createdAt: challenge.createdAt,
  };
}

// ---------------------------------------------------------------------------
// History, streak and the facts the achievement catalogue needs
// ---------------------------------------------------------------------------

/**
 * The longest and current runs of consecutive days on which the student answered.
 *
 * Computed from the distinct days present rather than stored, exactly as the visit
 * streak is (`progressService`) and for the same reason: a stored counter can drift
 * from the events behind it, and there is no counter here to drift.
 *
 * `current` counts a run ending **today or yesterday** — today's challenge may not
 * have been answered yet, and a streak is not lost until a day passes without one.
 */
export function challengeStreakOf(days: readonly DayKey[], today: DayKey = todayKey()): {
  current: number;
  longest: number;
} {
  if (days.length === 0) return { current: 0, longest: 0 };

  // Newest first, de-duplicated. The unique index means one attempt per day already,
  // but the sort is what the run-length walk below depends on.
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
 * The two counts the achievement catalogue asks for, plus the current streak for the
 * student's own page.
 *
 * This is the **whole** interface between challenges and the achievement system:
 * `lib/achievements.ts` reads nothing from the database, and nothing in this module
 * knows which achievements exist or what they require.
 */
export async function getChallengeFacts(
  student: Types.ObjectId,
  today: DayKey = todayKey(),
): Promise<ChallengeFacts> {
  const days = (await DailyChallengeAttempt.distinct('day', { student })) as DayKey[];
  const streak = challengeStreakOf(days, today);

  return {
    challengesCompleted: days.length,
    currentChallengeStreak: streak.current,
    longestChallengeStreak: streak.longest,
  };
}

/**
 * Facts for a student whose challenge history cannot be read (no database, or a
 * legacy account with no class). Zeroes, so an achievement row shows honest
 * "0 / 1" progress rather than disappearing or erroring.
 */
export const NO_CHALLENGE_FACTS: ChallengeFacts = {
  challengesCompleted: 0,
  currentChallengeStreak: 0,
  longestChallengeStreak: 0,
};

export interface ListAttemptsOptions {
  page: number;
  limit: number;
}

/** The student's own past challenge attempts, newest day first. */
export async function listOwnAttempts(
  student: Types.ObjectId,
  options: ListAttemptsOptions,
): Promise<{ attempts: DailyChallengeAttemptDocument[]; total: number }> {
  const filter = { student };
  const [attempts, total] = await Promise.all([
    DailyChallengeAttempt.find(filter)
      .sort({ day: -1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit),
    DailyChallengeAttempt.countDocuments(filter),
  ]);
  return { attempts, total };
}

// ---------------------------------------------------------------------------
// Staff listing
// ---------------------------------------------------------------------------

export interface ListChallengesOptions {
  page: number;
  limit: number;
  classLevel?: ClassLevel;
  from?: DayKey;
  to?: DayKey;
}

interface ChallengeFilter {
  classLevel?: ClassLevel;
  day?: { $gte?: DayKey; $lte?: DayKey };
}

export async function listChallenges(
  options: ListChallengesOptions,
): Promise<{ challenges: DailyChallengeDocument[]; total: number }> {
  const filter: ChallengeFilter = {};
  if (options.classLevel) filter.classLevel = options.classLevel;
  if (options.from || options.to) {
    // Day keys are `YYYY-MM-DD`, so a lexicographic range *is* a chronological one.
    filter.day = {};
    if (options.from) filter.day.$gte = options.from;
    if (options.to) filter.day.$lte = options.to;
  }

  const [challenges, total] = await Promise.all([
    DailyChallenge.find(filter)
      .sort({ day: -1, classLevel: 1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit),
    DailyChallenge.countDocuments(filter),
  ]);

  return { challenges, total };
}

interface AttemptStatsRow {
  _id: Types.ObjectId;
  attempts: number;
  correct: number;
}

/**
 * How many students answered each of the given challenges, and how many were right.
 *
 * One aggregation for the whole page rather than two queries per row. Counts `correct`
 * off the nested `answer.isCorrect`, which is the only place correctness is stored —
 * there is deliberately no denormalised copy on the attempt to drift from it.
 */
export async function attemptStatsFor(
  challengeIds: readonly Types.ObjectId[],
): Promise<Map<string, { attempts: number; correct: number }>> {
  if (challengeIds.length === 0) return new Map();

  const rows = await DailyChallengeAttempt.aggregate<AttemptStatsRow>([
    { $match: { challenge: { $in: [...challengeIds] } } },
    {
      $group: {
        _id: '$challenge',
        attempts: { $sum: 1 },
        correct: { $sum: { $cond: ['$answer.isCorrect', 1, 0] } },
      },
    },
  ]);

  return new Map(rows.map((row) => [String(row._id), { attempts: row.attempts, correct: row.correct }]));
}

/**
 * Loads questions by id, keyed by id, with the taxonomy names the views print.
 *
 * Takes ids rather than challenges so the history can look up the questions its
 * *attempts* snapshotted rather than the ones their challenges currently point at. The
 * two can differ — a challenge scheduled for a future day may be re-pointed — and a
 * history row must describe the question the student actually answered.
 */
export async function loadQuestionsByIds(
  ids: readonly Types.ObjectId[],
): Promise<Map<string, QuestionDocument>> {
  if (ids.length === 0) return new Map();

  const docs = await Question.find({ _id: { $in: [...ids] } })
    .populate('subject', 'name slug')
    .populate('topic', 'name slug');

  return new Map(docs.map((doc) => [String(doc._id), doc]));
}

/** Loads the questions a set of challenges point at, keyed by question id. */
export async function loadChallengeQuestions(
  challenges: readonly DailyChallengeDocument[],
): Promise<Map<string, QuestionDocument>> {
  return loadQuestionsByIds(challenges.map((challenge) => challenge.question));
}

/**
 * The next `count` days from today, for the scheduling UI to show as a strip.
 *
 * Here rather than in the route because "what is a day" is this backend's decision and
 * the frontend must not compute IST days for itself — a browser in another timezone
 * would disagree about which day is today, and the student would be shown the wrong
 * challenge as a result.
 */
export function upcomingDays(count: number, today: DayKey = todayKey()): DayKey[] {
  return Array.from({ length: count }, (_unused, index) => shiftDay(today, -index));
}

/**
 * Logs and swallows a failure to pin an automatic challenge.
 *
 * Used by the dashboard, where the challenge is one card among many: a student whose
 * challenge cannot be resolved should still get their dashboard, with that card
 * showing its empty state.
 */
export async function resolveChallengeQuietly(
  classLevel: ClassLevel,
  day: DayKey = todayKey(),
): Promise<DailyChallengeDocument | null> {
  try {
    return await resolveChallengeFor(classLevel, day);
  } catch (err) {
    logger.error({ err, classLevel, day }, 'Could not resolve the daily challenge');
    return null;
  }
}
