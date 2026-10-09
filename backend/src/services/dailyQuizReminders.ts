import { createHash } from 'node:crypto';
import type { Types } from 'mongoose';
import { now } from '../lib/clock';
import { dayKeyOf, type DayKey } from '../lib/competitionDay';
import { classRangeLabel } from '../lib/dailyQuiz';
import { buildDailyQuizReminderEmail } from '../lib/email';
import { logger } from '../lib/logger';
import type { ClassLevel } from '../lib/classLevels';
import { DailyChallenge, DailyQuizStart, EmailOutbox, Student, type ReminderRun } from '../models';
import { enqueueEmail, kickOutbox } from './emailOutbox';
import { emailAllowedFor } from './notificationService';
import { getQuizSettings, isPlayable, rangeOf, recordReminderRun } from './dailyChallengeService';

/**
 * THE Daily Quiz reminder job (Milestone 30 Phase 7b, PLAN.md Q20): at 7:00 AM India time an
 * outside scheduler calls `POST /jobs/daily-quiz-reminders`, and this queues one email for
 * every student who asked for one and still needs it.
 *
 * ## Who gets one
 *
 * A student who turned reminders on (`notificationPrefs.dailyQuizReminders` — off unless they
 * did), with a verified address and an active account, in a class that has a quiz **today**,
 * who has **not already pressed Start** — and whom `emailAllowedFor(student, 'reminders')`
 * allows, because that is the one place a preference is interpreted. Nobody else: a reminder
 * to a student whose class has no quiz today is a reminder about nothing.
 *
 * ## Safe to call twice
 *
 * Each reminder's dedupe key is `dailyquiz-reminder:<day>:<student>`, and the outbox's unique
 * index on it means a second trigger the same day — a retried request, a scheduler that fires
 * twice, a test run from the scheduler's dashboard — sends nobody a second email. Only a
 * student who opted in since the first run is reminded by the second.
 *
 * ## Inside the provider's free quota
 *
 * At most `reminderDailyCap` a day (100 by default; Brevo's free plan is 300 a day for every
 * email this platform sends, verification links included). Those already queued today count
 * against it, so two runs cannot together exceed it. When there are more students than room,
 * the order is a hash of the day and the student, so it is fixed for a day (a second run cuts
 * the same people) but different every day (the same people are not always the ones cut).
 * Reminders also queue **last** (`EMAIL_PRIORITY`), behind any verification email, and expire
 * from the outbox fourteen days after they were queued.
 *
 * ## One drain, not one per email
 *
 * Every row is queued with `{ dispatch: false }` and a single drain is started afterwards —
 * the scheduler's every-minute call to `POST /jobs/outbox` sends the rest.
 *
 * ## The record
 *
 * Every run — including one that found reminders switched off — is written to the settings
 * document as `lastReminderRun`, which is how the owner can see on the settings page that the
 * scheduler is really calling.
 */

/** The dedupe keys of one day's reminders all start with this. */
export function reminderKeyPrefix(day: DayKey): string {
  return `dailyquiz-reminder:${day}:`;
}

/** One student's reminder for one day — the outbox's dedupe key. */
export function reminderKey(day: DayKey, student: Types.ObjectId | string): string {
  return `${reminderKeyPrefix(day)}${String(student)}`;
}

/**
 * The order students are considered in when the cap cannot take them all: a hash of the day
 * and the student. Deterministic — a second run on the same day keeps the same order — and
 * different every day, so the cap does not always leave out the same people. A rotation, not
 * a security measure; SHA-256 only because it is there.
 */
export function rotationOrder<T extends { _id: unknown }>(day: DayKey, students: readonly T[]): T[] {
  return students
    .map((student) => ({ student, rank: createHash('sha256').update(`${day}:${String(student._id)}`).digest('hex') }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .map((entry) => entry.student);
}

/**
 * How many rows are queued at once. Bounded so a run of three hundred is not three hundred
 * simultaneous inserts against a five-connection pool, and parallel so it is not three hundred
 * round trips in a row inside one serverless invocation.
 */
const QUEUE_CONCURRENCY = 8;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** What the email may say about a class's quiz — the card's facts before Start, nothing more. */
interface QuizFacts {
  classRange: string;
  topic: string | null;
}

/**
 * Queues today's reminders and records the run. Never sends anything itself — the outbox does.
 *
 * `at` is the server's clock (`lib/clock.ts`), so the tests can stand on any day.
 */
export async function queueDailyQuizReminders(at: Date = now()): Promise<ReminderRun> {
  const day = dayKeyOf(at);
  const settings = await getQuizSettings();
  const run: ReminderRun = {
    day,
    at,
    enabled: settings.remindersEnabled,
    eligible: 0,
    alreadyStarted: 0,
    alreadyReminded: 0,
    overCap: 0,
    queued: 0,
    failed: 0,
  };

  if (!settings.remindersEnabled) {
    await recordReminderRun(run);
    return run;
  }

  // Today's playable quizzes, one document per class — the same test `resolveQuizFor()` uses,
  // so a reminder is never sent for a quiz the page would not serve.
  const quizzes = await DailyChallenge.find({ day, content: { $ne: null } });
  const quizByClass = new Map<ClassLevel, QuizFacts>();
  for (const quiz of quizzes) {
    if (!isPlayable(quiz)) continue;
    const range = rangeOf(quiz);
    quizByClass.set(quiz.classLevel, {
      classRange: classRangeLabel(range.min, range.max),
      topic: quiz.content.topicName ?? null,
    });
  }

  if (quizByClass.size > 0) {
    const candidates = await Student.find({
      status: 'active',
      isEmailVerified: true,
      email: { $type: 'string', $ne: '' },
      'notificationPrefs.dailyQuizReminders': true,
      classLevel: { $in: [...quizByClass.keys()] },
    }).select('email status notificationPrefs classLevel');

    // The query narrows; `emailAllowedFor()` decides — it is the one interpreter of a preference.
    const wanting = candidates.filter((student) => emailAllowedFor(student, 'reminders'));
    run.eligible = wanting.length;

    const [started, remindedRows] = await Promise.all([
      DailyQuizStart.find({ day, student: { $in: wanting.map((student) => student._id) } }).distinct('student'),
      // Every reminder already queued today, whoever it was for — they all count against the cap.
      EmailOutbox.find({ dedupeKey: { $type: 'string', $regex: `^${escapeRegex(reminderKeyPrefix(day))}` } }).select('student'),
    ]);
    const startedIds = new Set(started.map((id) => String(id)));
    const remindedIds = new Set(remindedRows.map((row) => String(row.student)));

    const fresh = wanting.filter((student) => {
      const id = String(student._id);
      if (remindedIds.has(id)) {
        run.alreadyReminded += 1;
        return false;
      }
      if (startedIds.has(id)) {
        run.alreadyStarted += 1;
        return false;
      }
      return true;
    });

    const room = Math.max(0, settings.reminderDailyCap - remindedRows.length);
    const ordered = rotationOrder(day, fresh);
    const chosen = ordered.slice(0, room);
    run.overCap = ordered.length - chosen.length;

    for (let index = 0; index < chosen.length; index += QUEUE_CONCURRENCY) {
      const outcomes = await Promise.all(
        chosen.slice(index, index + QUEUE_CONCURRENCY).map((student) => {
          const quiz = quizByClass.get(student.classLevel);
          // Unreachable — the query only matched classes in the map — but a missing quiz must
          // never become a reminder about nothing.
          if (!quiz) return Promise.resolve({ queued: false as const, reason: 'error' as const });
          return enqueueEmail(
            {
              ...buildDailyQuizReminderEmail({ to: student.email, classRange: quiz.classRange, topic: quiz.topic }),
              category: 'reminders',
              student: student._id as Types.ObjectId,
              dedupeKey: reminderKey(day, student._id as Types.ObjectId),
            },
            { dispatch: false },
          );
        }),
      );
      for (const outcome of outcomes) {
        if (outcome.queued) run.queued += 1;
        // Lost a race with another run on the unique key: that run queued it.
        else if (outcome.reason === 'duplicate') run.alreadyReminded += 1;
        else run.failed += 1;
      }
    }
  }

  // One drain for the whole batch; the scheduler's every-minute outbox call sends the rest.
  if (run.queued > 0) await kickOutbox();
  await recordReminderRun(run);

  logger.info({ ...run, driver: 'daily-quiz-reminders' }, 'Daily Quiz reminders queued');
  return run;
}
