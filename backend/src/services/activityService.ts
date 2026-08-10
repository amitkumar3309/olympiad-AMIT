import type { Types } from 'mongoose';
import { dayKeyOf, type DayKey } from '../lib/competitionDay';
import { logger } from '../lib/logger';
import { xpFor } from '../lib/xp';
import { ONCE_PER_ACCOUNT, ONCE_PER_DAY, StudentActivity, type ActivityType } from '../models';

/**
 * Writes to the student activity log — the single source of truth for XP, levels,
 * streaks and achievements.
 *
 * Nothing else in the backend may insert a `StudentActivity`: routing every write
 * through here is what guarantees an event's XP comes from `XP_AWARDS` and its
 * uniqueness token from the type's declared cardinality, so "50 XP for verifying,
 * once" cannot be restated differently by a second call site.
 */

/** How a type's uniqueness token is formed. Absent means freely repeatable. */
function dedupeKeyFor(type: ActivityType, day: DayKey): string | undefined {
  if (ONCE_PER_ACCOUNT.includes(type)) return 'once';
  if (ONCE_PER_DAY.includes(type)) return day;
  return undefined;
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export interface RecordActivityInput {
  student: Types.ObjectId;
  type: ActivityType;
  /** Short human-readable detail for the feed, e.g. `Class 9 → Class 10`. */
  detail?: string | null;
  /** Overrides "now". Only used by tests and the backfill script. */
  at?: Date;
}

export interface RecordActivityResult {
  /** False when the event was a duplicate of one already recorded, or the write failed. */
  recorded: boolean;
  xpAwarded: number;
}

/**
 * Records one real student event, awarding the XP that event is worth.
 *
 * **Idempotent for the constrained types.** A second `daily_visit` on the same day,
 * or a second `account_created` ever, is refused by the partial unique index on the
 * collection and reported here as `recorded: false` — not as an error. Letting the
 * database arbitrate rather than checking first is deliberate: on the serverless
 * path two concurrent requests can both pass a read-then-write check, and a student
 * would be paid twice for one visit.
 *
 * **Never throws.** Like `recordAudit`, this must not be able to fail the action it
 * describes: refusing a registration or a password change because a log write
 * failed would be a worse outcome than the missing row, and the row's absence is
 * visible in the platform logs. The trade-off is that a failed write costs the
 * student that event's XP; it is recorded in DECISIONS.md.
 */
export async function recordActivity(input: RecordActivityInput): Promise<RecordActivityResult> {
  const { student, type, detail = null, at = new Date() } = input;
  const occurredOn = dayKeyOf(at);
  const xpAwarded = xpFor(type);

  try {
    await StudentActivity.create({
      student,
      type,
      xpAwarded,
      occurredOn,
      dedupeKey: dedupeKeyFor(type, occurredOn),
      detail,
      createdAt: at,
    });
    return { recorded: true, xpAwarded };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // The expected, uninteresting case: this event has already been counted.
      return { recorded: false, xpAwarded: 0 };
    }
    logger.error({ err, type, student: String(student) }, 'Failed to record student activity');
    return { recorded: false, xpAwarded: 0 };
  }
}

/**
 * Marks the student as present today, which is what a streak actually measures.
 *
 * Called both when a student signs in and when they open their dashboard. The
 * dashboard is the important one: a session cookie outlives a sign-in by up to 30
 * days, so keying the streak on logins alone would miss every day a returning
 * student was already signed in. Calling it from both is free, because the day's
 * visit can only be recorded once.
 */
export async function touchDailyVisit(student: Types.ObjectId, at = new Date()): Promise<RecordActivityResult> {
  return recordActivity({ student, type: 'daily_visit', at });
}
