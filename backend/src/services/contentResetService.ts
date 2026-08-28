import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import {
  DailyChallenge,
  DailyChallengeAttempt,
  Exam,
  MockTest,
  MockTestAttempt,
  Question,
  QUESTION_STATUSES,
  Topic,
} from '../models';

/**
 * THE content reset (Milestone 22, owner request 2026-08-28).
 *
 * One button per administrative area that empties it: the question bank, mock tests, the
 * daily challenge, and chapters. It exists because a platform that has been loaded with
 * trial data before launch has no other way back — deleting three thousand questions one
 * at a time is not a path anybody takes, so in practice the trial data ships.
 *
 * ## This is the most destructive thing in the product, and it is shaped accordingly
 *
 * Five properties, each answering a specific way this goes wrong:
 *
 * 1. **Super admin only.** `content:reset` sits beside `users:delete` in
 *    `SUPERADMIN_ONLY_PERMISSIONS`, on the line that table already draws: every other
 *    administrative act in this product is reversible, and these are not. A compromised
 *    *admin* session must not be able to empty the question bank.
 * 2. **It refuses rather than cascades.** Deleting chapters while questions are filed
 *    under them would leave every question pointing at a chapter that no longer exists —
 *    invisible to every filter, unfixable through the interface. So a reset **names its
 *    blockers and refuses**, and the administrator resets in dependency order. A cascade
 *    would be one click that quietly destroyed four areas instead of the one that was
 *    asked for.
 * 3. **It says exactly what it will destroy, before.** `previewReset()` counts every
 *    collection the reset touches, so the confirmation dialog states real numbers rather
 *    than "this cannot be undone".
 * 4. **It says what it will NOT destroy.** Resetting mock tests deletes attempts, which
 *    is a real loss of a student's history — but their **XP is untouched**, because
 *    `StudentActivity` is a record of something that genuinely happened and taking it
 *    back would re-rank the leaderboard against children who did nothing wrong. So is the
 *    official exam, its results and every certificate: none of the four scopes can reach
 *    them.
 * 5. **A phrase must be typed.** The route requires the scope's own confirmation phrase
 *    in the body, so neither a stray click nor a bare `POST` can empty a collection.
 *
 * ## No transaction, and the delete order is the mitigation
 *
 * There is no transaction available (the same constraint registration works under — see
 * `auth.routes.ts`), so a scope that deletes two collections can in principle fail
 * between them. The order is therefore chosen so that a partial failure leaves the *less*
 * broken state: **dependents first**. A mock test with no attempts is a paper nobody sat;
 * an attempt with no mock test is a row the student's page cannot render.
 */

export const RESET_SCOPES = ['questions', 'mock-tests', 'daily-challenges', 'chapters'] as const;
export type ResetScope = (typeof RESET_SCOPES)[number];

/** The words an administrator has to type. Distinct per scope, so one cannot be pasted into another. */
export const CONFIRM_PHRASES: Record<ResetScope, string> = {
  questions: 'RESET QUESTIONS',
  'mock-tests': 'RESET MOCK TESTS',
  'daily-challenges': 'RESET DAILY CHALLENGES',
  chapters: 'RESET CHAPTERS',
};

const SCOPE_LABELS: Record<ResetScope, string> = {
  questions: 'Question Bank',
  'mock-tests': 'Mock Tests',
  'daily-challenges': 'Daily Challenges',
  chapters: 'Chapters',
};

/**
 * `1 mock test is` / `4 mock tests are`.
 *
 * A tiny helper for a reason worth naming: these strings are the *only* description of
 * what is about to be destroyed, read by somebody who is about to press a button they
 * cannot un-press. "1 daily challenge are set from these questions" reads like a bug, and
 * a warning that reads like a bug is a warning people stop believing.
 */
function countOf(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${phrase(count, noun, pluralNoun)} ${count === 1 ? 'is' : 'are'}`;
}

/**
 * `1 chapter` / `26 chapters`, grouped Indian-style for a large number.
 *
 * The **whole phrase** is built here rather than the client joining a count to a label,
 * because a client that does that produces "1 scheduled daily challenges" — and this is
 * the sentence somebody reads immediately before deleting data they cannot get back.
 */
function phrase(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count.toLocaleString('en-IN')} ${count === 1 ? noun : pluralNoun}`;
}

export interface ResetLine {
  /**
   * The collection, in the words the audit trail records. Stays a plain plural noun
   * phrase, because it is a key rather than a sentence.
   */
  label: string;
  count: number;
  /**
   * The same fact as a phrase that agrees with its own count — `1 chapter`,
   * `26 chapters`. This is what a client displays; see `phrase()`.
   */
  text: string;
  /** Why it goes, when that is not obvious from the label. */
  note?: string;
}

export interface ResetBlocker {
  label: string;
  count: number;
  /** The scope that has to be reset first, so the UI can offer it. */
  resolveWith: ResetScope | null;
}

export interface ResetPreview {
  scope: ResetScope;
  label: string;
  confirmPhrase: string;
  /** Everything this reset deletes, with live counts. */
  deletes: ResetLine[];
  /** What it deliberately leaves alone. Displayed, because it is the reassuring half. */
  preserves: string[];
  /** Non-empty means the reset is refused; each entry names what to do about it. */
  blockers: ResetBlocker[];
  canReset: boolean;
  totalToDelete: number;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

async function previewQuestions(): Promise<ResetPreview> {
  const [total, byStatus, mockTests, challenges, exams] = await Promise.all([
    Question.countDocuments({}),
    // Counted per status from `QUESTION_STATUSES` rather than four hardcoded queries, so
    // adding a status cannot leave the confirmation dialog quietly understating what it is
    // about to delete.
    Promise.all(
      QUESTION_STATUSES.map(async (status) => ({ status, count: await Question.countDocuments({ status }) })),
    ),
    MockTest.countDocuments({}),
    DailyChallenge.countDocuments({}),
    Exam.countDocuments({}),
  ]);

  const blockers: ResetBlocker[] = [];
  // Each of these embeds a **required** reference to a question, so emptying the bank
  // beneath them would leave papers that cannot be served at all.
  if (mockTests > 0) {
    blockers.push({
      label: `${countOf(mockTests, 'mock test')} built from these questions`,
      count: mockTests,
      resolveWith: 'mock-tests',
    });
  }
  if (challenges > 0) {
    blockers.push({
      label: `${countOf(challenges, 'daily challenge')} set from these questions`,
      count: challenges,
      resolveWith: 'daily-challenges',
    });
  }
  if (exams > 0) {
    // Deliberately has no `resolveWith`: there is no reset for the official Olympiad, and
    // there must not be — its results and certificates are a permanent record.
    blockers.push({
      label: `${countOf(exams, 'official exam')} built from these questions. There is no reset for the official Olympiad — its results and certificates are permanent`,
      count: exams,
      resolveWith: null,
    });
  }

  return {
    scope: 'questions',
    label: SCOPE_LABELS.questions,
    confirmPhrase: CONFIRM_PHRASES.questions,
    deletes: [
      {
        label: 'Questions',
        count: total,
        text: phrase(total, 'question'),
        // Spelled out by status, because "all questions" is the one phrase an
        // administrator might read as "the published ones".
        note: `${byStatus.map((row) => `${row.count} ${row.status.replace('_', ' ')}`).join(', ')} — all of them`,
      },
    ],
    preserves: [
      'Chapters and subtopics',
      'Practice sessions students have already sat — each one snapshots its own questions and answer key, so it still opens and still shows the right marks',
      'XP, levels, streaks and the leaderboard',
      'The official exam, its results and every certificate',
    ],
    blockers,
    canReset: blockers.length === 0 && total > 0,
    totalToDelete: total,
  };
}

async function previewMockTests(): Promise<ResetPreview> {
  const [tests, attempts, students] = await Promise.all([
    MockTest.countDocuments({}),
    MockTestAttempt.countDocuments({}),
    MockTestAttempt.distinct('student').then((ids) => ids.length),
  ]);

  return {
    scope: 'mock-tests',
    label: SCOPE_LABELS['mock-tests'],
    confirmPhrase: CONFIRM_PHRASES['mock-tests'],
    deletes: [
      { label: 'Mock tests', count: tests, text: phrase(tests, 'mock test') },
      {
        label: 'Mock-test attempts',
        count: attempts,
        text: phrase(attempts, 'mock-test attempt'),
        // Stated in people rather than rows, because "412 attempts" does not read as
        // "87 children lose their rehearsal history" — and that is the decision.
        note:
          attempts > 0
            ? `sat by ${students} student${students === 1 ? '' : 's'}. An attempt cannot outlive its paper — the student's page could not render it`
            : 'none have been sat',
      },
    ],
    preserves: [
      'The questions themselves, in the Question Bank',
      'XP already earned from these attempts — it is a record of something that really happened',
      'Practice sessions, the daily challenge, the official exam and every certificate',
    ],
    blockers: [],
    canReset: tests > 0 || attempts > 0,
    totalToDelete: tests + attempts,
  };
}

async function previewDailyChallenges(): Promise<ResetPreview> {
  const [challenges, attempts, students] = await Promise.all([
    DailyChallenge.countDocuments({}),
    DailyChallengeAttempt.countDocuments({}),
    DailyChallengeAttempt.distinct('student').then((ids) => ids.length),
  ]);

  return {
    scope: 'daily-challenges',
    label: SCOPE_LABELS['daily-challenges'],
    confirmPhrase: CONFIRM_PHRASES['daily-challenges'],
    deletes: [
      {
        label: 'Scheduled daily challenges',
        count: challenges,
        text: phrase(challenges, 'scheduled daily challenge'),
        note: 'including the days that were filled automatically',
      },
      {
        label: 'Daily-challenge attempts',
        count: attempts,
        text: phrase(attempts, 'daily-challenge attempt'),
        note: attempts > 0 ? `answered by ${students} student${students === 1 ? '' : 's'}` : 'none have been answered',
      },
    ],
    preserves: [
      'The questions themselves, in the Question Bank',
      'XP and streaks already earned — a streak is a record of days a student turned up',
      'Practice sessions, mock tests, the official exam and every certificate',
    ],
    blockers: [],
    canReset: challenges > 0 || attempts > 0,
    totalToDelete: challenges + attempts,
  };
}

async function previewChapters(): Promise<ResetPreview> {
  const [chapters, subtopics, questions] = await Promise.all([
    Topic.countDocuments({ parent: null }),
    Topic.countDocuments({ parent: { $ne: null } }),
    Question.countDocuments({}),
  ]);

  const blockers: ResetBlocker[] = [];
  if (questions > 0) {
    // `Question.topic` is `required`, so a question whose chapter is gone is not merely
    // untidy — it is invisible to every filter an administrator can construct, and there
    // is no screen that can put it right.
    blockers.push({
      label: `${countOf(questions, 'question')} filed under these chapters and would be left pointing at nothing`,
      count: questions,
      resolveWith: 'questions',
    });
  }

  return {
    scope: 'chapters',
    label: SCOPE_LABELS.chapters,
    confirmPhrase: CONFIRM_PHRASES.chapters,
    deletes: [
      { label: 'Chapters', count: chapters, text: phrase(chapters, 'chapter') },
      { label: 'Subtopics', count: subtopics, text: phrase(subtopics, 'subtopic') },
    ],
    preserves: [
      'The subject itself, so new chapters can be added straight away',
      'Everything outside the taxonomy — students, payments and the official exam',
    ],
    blockers,
    canReset: blockers.length === 0 && chapters + subtopics > 0,
    totalToDelete: chapters + subtopics,
  };
}

/** What this reset would destroy, counted from the collections rather than estimated. */
export async function previewReset(scope: ResetScope): Promise<ResetPreview> {
  switch (scope) {
    case 'questions':
      return previewQuestions();
    case 'mock-tests':
      return previewMockTests();
    case 'daily-challenges':
      return previewDailyChallenges();
    case 'chapters':
      return previewChapters();
  }
}

// ---------------------------------------------------------------------------
// Perform
// ---------------------------------------------------------------------------

export interface ResetOutcome {
  scope: ResetScope;
  label: string;
  deleted: ResetLine[];
  totalDeleted: number;
}

/**
 * Empties one area.
 *
 * Re-runs `previewReset()` first and **refuses on any blocker**, so the check is made
 * against the database at the moment of the write rather than against whatever the
 * confirmation dialog was showing — which may be minutes old, and which another
 * administrator may have invalidated in between.
 *
 * The confirmation phrase is verified by the route before this is called; it is a guard
 * against a stray click, not an authorization check, and it is deliberately not the only
 * thing standing in the way (`content:reset` is).
 */
export async function performReset(scope: ResetScope, actorLabel: string): Promise<ResetOutcome> {
  const preview = await previewReset(scope);

  if (preview.blockers.length > 0) {
    // Re-checked here, not just in the dialog: between opening it and confirming, somebody
    // may have published a mock test built from the questions about to be deleted.
    throw ApiError.conflict(
      `This reset is blocked. ${preview.blockers.map((blocker) => blocker.label).join('. ')}.`,
    );
  }

  const deleted: ResetLine[] = [];

  switch (scope) {
    case 'questions': {
      const result = await Question.deleteMany({});
      const count = result.deletedCount ?? 0;
      deleted.push({ label: 'Questions', count, text: phrase(count, 'question') });
      break;
    }

    case 'mock-tests': {
      // Attempts first. With no transaction available, a failure between the two should
      // leave papers nobody sat rather than attempts with no paper to render.
      const attempts = (await MockTestAttempt.deleteMany({})).deletedCount ?? 0;
      const tests = (await MockTest.deleteMany({})).deletedCount ?? 0;
      deleted.push({ label: 'Mock-test attempts', count: attempts, text: phrase(attempts, 'mock-test attempt') });
      deleted.push({ label: 'Mock tests', count: tests, text: phrase(tests, 'mock test') });
      break;
    }

    case 'daily-challenges': {
      const attempts = (await DailyChallengeAttempt.deleteMany({})).deletedCount ?? 0;
      const challenges = (await DailyChallenge.deleteMany({})).deletedCount ?? 0;
      deleted.push({ label: 'Daily-challenge attempts', count: attempts, text: phrase(attempts, 'daily-challenge attempt') });
      deleted.push({
        label: 'Scheduled daily challenges',
        count: challenges,
        text: phrase(challenges, 'scheduled daily challenge'),
      });
      break;
    }

    case 'chapters': {
      // Subtopics before chapters, so a failure between them cannot leave a subtopic whose
      // parent has gone — `depth` is derived from `parent`, and an orphan is unreachable.
      const subtopics = (await Topic.deleteMany({ parent: { $ne: null } })).deletedCount ?? 0;
      const chapters = (await Topic.deleteMany({ parent: null })).deletedCount ?? 0;
      deleted.push({ label: 'Subtopics', count: subtopics, text: phrase(subtopics, 'subtopic') });
      deleted.push({ label: 'Chapters', count: chapters, text: phrase(chapters, 'chapter') });
      break;
    }
  }

  const totalDeleted = deleted.reduce((sum, line) => sum + line.count, 0);

  // `warn`, not `info`: this is the entry somebody goes looking for when a question bank
  // is unexpectedly empty, and it should stand out in a log without a filter.
  logger.warn(
    { scope, actor: actorLabel, deleted: deleted.map((line) => `${line.label}=${line.count}`).join(' ') },
    'Content reset performed',
  );

  return { scope, label: SCOPE_LABELS[scope], deleted, totalDeleted };
}

export function scopeLabel(scope: ResetScope): string {
  return SCOPE_LABELS[scope];
}
