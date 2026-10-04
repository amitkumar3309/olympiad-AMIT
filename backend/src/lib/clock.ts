import { config } from '../config';

/**
 * The server's idea of "now" — the one place quiz logic reads the time (Milestone 30).
 *
 * ## Why not just `new Date()`
 *
 * The Daily Quiz is a set of rules about time: a quiz is open from IST midnight to the
 * next one, an answer and its solution unlock at that next midnight, a solve time is the
 * gap between two server instants. Every one of those has to be testable at the
 * boundary — 23:59:59 against 00:00:00 IST — and the end-to-end suite has to be able to
 * "move to tomorrow" to watch a solution unlock. That needs the clock to be movable, and
 * a clock that is movable must be movable in exactly one place.
 *
 * Two ways to move it: an **offset** from the real time (the end-to-end suite, where time
 * should keep passing), or a **frozen** instant (the unit tests, where a solve time of
 * exactly 12 seconds must read as 12,000 ms rather than 11,999).
 *
 * ## It cannot move in production
 *
 * Both setters throw when `NODE_ENV` is `production`. They are called only by the tests
 * and by the end-to-end hooks, which are themselves never mounted in production
 * (`routes/e2e.routes.ts`). A production server always tells the truth about the time.
 */

let offsetMs = 0;
let frozenAt: number | null = null;

/** The current instant, as this server counts it. */
export function now(): Date {
  return new Date(frozenAt ?? Date.now() + offsetMs);
}

function assertMovable(value: number): void {
  if (config.isProd) {
    throw new Error('The clock cannot be moved in production.');
  }
  if (!Number.isFinite(value)) throw new Error('The clock must be set to a finite number of milliseconds.');
}

/**
 * Moves this process's clock by `ms` from the real one, still ticking. **Tests and E2E only.**
 *
 * Absolute rather than cumulative — `setClockOffset(DAY)` then `setClockOffset(DAY)` is
 * still one day ahead — so a test that forgets to reset cannot drift the next one.
 */
export function setClockOffset(ms: number): void {
  assertMovable(ms);
  frozenAt = null;
  offsetMs = ms;
}

/** Stops this process's clock at `at`, exactly. **Tests only.** */
export function freezeClock(at: Date): void {
  assertMovable(at.getTime());
  frozenAt = at.getTime();
}

/** Back to the real time. Safe to call anywhere. */
export function resetClock(): void {
  offsetMs = 0;
  frozenAt = null;
}

/** How far this process's clock is from the real one — for the test hook's response. */
export function clockOffset(): number {
  return frozenAt === null ? offsetMs : frozenAt - Date.now();
}
