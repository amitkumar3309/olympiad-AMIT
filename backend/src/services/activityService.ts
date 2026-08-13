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
 * through here is what guarantees an event's uniqueness token comes from the type's
 * declared cardinality, so "50 XP for verifying, once" cannot be restated differently
 * by a second call site.
 *
 * **Since Milestone 9 this is the layer *below* the reward engine, not the public
 * one.** Routes call `services/rewardService.ts` → `grantReward()`, which decides
 * whether an event is eligible, resolves what it is worth (applying any administrator
 * override), and then calls this. Two callers still come here directly and both are
 * deliberate: the engine itself, and `scripts/backfill-activity.ts`, which writes
 * historical rows at their historical prices.
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
  /**
   * What this event is worth, resolved by the reward engine from the code award table
   * plus any administrator override.
   *
   * **Only `services/rewardService.ts` may pass this.** Absent means "use the code
   * default", which is what the backfill script and any direct test call want. It
   * exists so the *configurable* price has one resolver rather than this module
   * growing a dependency on the settings collection — but it is also the one way a
   * caller could invent a number, so the rule is stated here rather than assumed.
   */
  xpOverride?: number;
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
  const { student, type, detail = null, at = new Date(), xpOverride } = input;
  const occurredOn = dayKeyOf(at);
  // Written into the row and never looked up again: a student's total is the sum of
  // these recorded values, so re-pricing an event later cannot restate what anybody has
  // already earned. That snapshot is what makes the administrator-tunable table safe.
  const xpAwarded = typeof xpOverride === 'number' ? xpOverride : xpFor(type);

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
 * `touchDailyVisit()` moved to `services/rewardService.ts` as `grantDailyVisit()` in
 * Milestone 9, along with every other reward decision. Nothing else changed about it:
 * it is still called from both sign-in and the dashboard, and is still free to call
 * twice because the day's visit can only be recorded once.
 */
