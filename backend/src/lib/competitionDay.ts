/**
 * The competition's definition of "a day".
 *
 * A streak is a count of consecutive *days*, so something has to decide when one
 * day ends. Using the server's UTC midnight would be wrong for this product: the
 * entrants are in India, and a student practising at 00:30 IST would have their
 * activity filed under the previous UTC day, silently breaking a streak they had
 * in fact kept. So the day boundary is Indian Standard Time.
 *
 * IST is a **fixed** UTC+05:30 with no daylight saving, which is what makes a
 * plain offset correct here and lets us avoid a timezone database (and the ₹0
 * dependency budget). If the competition ever runs in a zone that observes DST,
 * this is the one module that has to change — everything else speaks in the
 * opaque `YYYY-MM-DD` keys it returns.
 */

/** IST is UTC+05:30, year-round. */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** A calendar day in the competition's timezone, as `YYYY-MM-DD`. */
export type DayKey = string;

/**
 * The competition-local calendar day containing `at`.
 *
 * Implemented by shifting the instant into IST and then reading the *UTC* date
 * parts of the shifted value — never the host's local parts, so the result does
 * not depend on the server's own timezone (Vercel runs in UTC, a laptop does not).
 */
export function dayKeyOf(at: Date = new Date()): DayKey {
  return new Date(at.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE).toISOString().slice(0, 10);
}

export function todayKey(): DayKey {
  return dayKeyOf();
}

/** Parses a `YYYY-MM-DD` key back to the UTC instant of that IST midnight. */
function keyToUtcMidnight(key: DayKey): number {
  return Date.parse(`${key}T00:00:00.000Z`);
}

/** True for a well-formed, real calendar date key. */
export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = keyToUtcMidnight(value);
  // Rejects 2026-02-30 and friends: re-deriving the key must round-trip.
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/**
 * Whole days from `from` to `to` (positive when `to` is later). Both keys denote
 * IST midnights, so this is exact integer arithmetic with no DST discontinuity.
 */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((keyToUtcMidnight(to) - keyToUtcMidnight(from)) / MS_PER_DAY);
}

/** The key `days` before `key` (use a negative value to move forward). */
export function shiftDay(key: DayKey, days: number): DayKey {
  return new Date(keyToUtcMidnight(key) - days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The instant a competition day begins — IST midnight, as an absolute UTC `Date`.
 *
 * A day key denotes an IST calendar date, and `keyToUtcMidnight` parses it as *UTC*
 * midnight, so the real start of the day is that value shifted **back** by the offset:
 * midnight in Delhi is 18:30 UTC the previous evening.
 */
export function dayStartsAt(key: DayKey): Date {
  return new Date(keyToUtcMidnight(key) - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** The instant the day containing `at` ends and the next one begins. */
export function nextDayStartsAt(at: Date = new Date()): Date {
  // `shiftDay` counts backwards, so -1 is *tomorrow*.
  return dayStartsAt(shiftDay(dayKeyOf(at), -1));
}

/**
 * Whole seconds until the competition day rolls over.
 *
 * **The server owns this clock.** It exists so a countdown in a browser can be derived
 * from a number the server sent rather than from the browser's own idea of midnight —
 * which, in any timezone that is not IST, is the wrong moment, and on a device with a
 * wrong clock is any moment at all.
 *
 * Rounded **up**, and floored at zero. A `floor` would report `0` for the whole of the
 * final second, and a client that refetches when the countdown reaches zero would then
 * refetch in a loop against a day that has not actually changed yet.
 */
export function secondsUntilNextDay(at: Date = new Date()): number {
  return Math.max(0, Math.ceil((nextDayStartsAt(at).getTime() - at.getTime()) / 1000));
}
