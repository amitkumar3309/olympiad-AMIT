import type { DayKey } from './competitionDay';

/**
 * The festive editions the backend knows about (Milestone 30 Phase 7 — owner, 2026-10-08).
 *
 * An edition's **look** belongs to the frontend (`frontend/src/lib/season.ts`, applied before
 * the first paint by `public/boot.js`). What lives here is only what the server must decide:
 * whether an answer earns the edition's achievement. The two copies of the dates are a
 * deliberate duplication across the split, like the product name — change both together.
 *
 * Days are competition days (IST, `lib/competitionDay.ts`), inclusive at both ends.
 */
export interface SeasonWindow {
  firstDay: DayKey;
  lastDay: DayKey;
}

/** Diwali 2026: Sunday 8 November — Diwali, and the launch — to Sunday 15 November. */
export const DIWALI_2026: SeasonWindow = { firstDay: '2026-11-08', lastDay: '2026-11-15' };

export function isWithin(day: DayKey, window: SeasonWindow): boolean {
  return day >= window.firstDay && day <= window.lastDay;
}
