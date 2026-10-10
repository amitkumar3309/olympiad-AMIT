import type { PipelineStage, Types } from 'mongoose';
import { shiftDay, todayKey, type DayKey } from '../lib/competitionDay';
import { StudentActivity } from '../models';
import { cached } from '../lib/cache';

/**
 * **The one place a rank is decided in this backend.**
 *
 * Every standing the product shows — the landing page's champions, the dashboard's
 * rank tile, the `/leaderboard` page's class and period boards, and the Hall of Fame's
 * XP board — is computed by the functions below, from the same pipeline, with the same
 * ordering rule. Two ranking implementations would eventually disagree, and a rank that
 * disagrees with itself on two pages is worse than no rank at all.
 *
 * ## Nothing here is stored
 *
 * This extends the Milestone 5 decision rather than revisiting it: there is no
 * `Leaderboard` collection and no materialised standing. A board is an aggregation over
 * `StudentActivity`, which is the same log XP, levels and streaks are derived from — so
 * a leaderboard cannot drift away from the XP totals it claims to rank, because it *is*
 * those totals. Scopes and periods are **filters on that one pipeline**, not new
 * collections and not stored variants.
 *
 * ## The value being ranked is authoritative
 *
 * No request may supply an XP figure, a score or a rank. Every number on every board is
 * a `$sum` over rows this backend wrote through `recordActivity()` (itself reachable
 * only through `services/rewardService.ts`). The query string chooses *which* rows are
 * summed — a scope, a period, a page — and can do nothing else. A client that sends
 * `?xp=999999` is sending a key the zod schema strips before the handler ever runs.
 *
 * ## Ties
 *
 * Two students on the same XP hold the **same rank** — standard competition ranking,
 * as `getStanding()` has always done ("one plus the number strictly ahead", so ranks
 * read 1, 2, 2, 4). Sharing a rank is the honest answer: they earned the same amount,
 * and inventing a winner between them would be a fabricated distinction of exactly the
 * kind this product does not ship.
 *
 * But *listing* them still needs an order, and that order is fully deterministic:
 *
 *   1. **XP, descending** — the thing being ranked.
 *   2. **Who reached it first, ascending** (`lastEarnedAt`, the newest activity row
 *      counted in the window). Of two students on 300 XP, the one who got there
 *      yesterday is listed above the one who got there this morning. This is the only
 *      tie-break with a defensible meaning; sorting by name would advantage the
 *      alphabet, and leaving it to Mongo's natural order would mean the same board
 *      reordered itself between two page loads.
 *   3. **The account id, ascending** — unique, so the order is a *total* order and the
 *      same query always returns the same sequence. This is what makes pagination
 *      safe: without a final unique key, a row could appear on two pages or on none.
 */

// ---------------------------------------------------------------------------
// Scope and period
// ---------------------------------------------------------------------------

export const LEADERBOARD_SCOPES = ['overall', 'class'] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];

export const LEADERBOARD_PERIODS = ['all_time', 'monthly', 'weekly', 'daily'] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

/**
 * How many competition days each period covers, counting today.
 *
 * These are **competition days** (`lib/competitionDay.ts`), not rolling 24-hour
 * windows: "this week" is the last seven IST calendar days, so every student's week
 * starts and ends at the same instant regardless of where their browser thinks it is.
 * It also means a period board can be expressed as a `$gte` on the `occurredOn` day key
 * an activity row already carries — no date arithmetic against `createdAt`, and no
 * timezone in the query.
 */
const PERIOD_DAYS: Record<LeaderboardPeriod, number | null> = {
  all_time: null,
  monthly: 30,
  weekly: 7,
  daily: 1,
};

export interface PeriodWindow {
  /** Inclusive first day, or null for all time. */
  from: DayKey | null;
  /** Inclusive last day — always today, since a board is a view of the present. */
  to: DayKey;
}

export function periodWindow(period: LeaderboardPeriod, today: DayKey = todayKey()): PeriodWindow {
  const days = PERIOD_DAYS[period];
  return { from: days === null ? null : shiftDay(today, days - 1), to: today };
}

/**
 * Which slice of the roll a board covers.
 *
 * A discriminated union rather than an optional `classLevel`, so a class board cannot
 * be requested without saying which class — the alternative is a silent fallback that
 * quietly serves the overall board under a class heading.
 */
export type LeaderboardScopeInput =
  | { scope: 'overall'; period: LeaderboardPeriod; today?: DayKey }
  | { scope: 'class'; classLevel: string; period: LeaderboardPeriod; today?: DayKey };

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * How a student is named on a leaderboard other people can see.
 *
 * First name plus last initial. The entrants are schoolchildren, and the leaderboard is
 * readable without signing in, so publishing a full legal name next to a school and a
 * class would identify a minor to anyone on the internet. This keeps the ranking real
 * and recognisable to the student themselves while not being a directory of children.
 * Widening it is a one-line change here and a decision for the project owner, not a
 * side effect of some other feature.
 *
 * Milestone 10 kept this unchanged while adding class boards, period boards and the
 * Hall of Fame: every one of those surfaces publishes names through this function, so
 * there is still exactly one answer to "how much of a child's name does this product
 * put on a public page?".
 */
export function displayNameFor(account: {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
}): string {
  const first = account.firstName?.trim();
  const last = account.lastName?.trim();
  if (first) return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;

  // Accounts created before the name parts existed only have `fullName`.
  const parts = (account.fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AMIT student';
  const firstPart = parts[0]!;
  const lastPart = parts.length > 1 ? parts[parts.length - 1]! : null;
  return lastPart ? `${firstPart} ${lastPart.charAt(0).toUpperCase()}.` : firstPart;
}

/** The account fields a public list may read. Nothing else is ever projected for one. */
export interface PublicListAccount {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  classLevel?: string | null;
  schoolName?: string | null;
  city?: string | null;
  hideFromPublicLists?: boolean | null;
}

/** How a list names a student who opted out: "A Class 7 student" — the class, nothing else. */
export function anonymousNameFor(classLevel: string | null | undefined): string {
  const level = classLevel?.trim();
  return level ? `A ${level} student` : 'A student';
}

/**
 * How a student appears on a **list** anyone can read — the leaderboards, the Hall of
 * Fame and the Daily Quiz winners (Milestone 30; brief §3).
 *
 * A student who ticked "hide me from public lists" on their profile keeps their place —
 * a rank is still theirs, and removing them would move everybody below — but is named
 * only by class, with no school and no city. Everybody else is named by `displayNameFor()`
 * and placed by city or school, the brief's public-display rule for minors.
 *
 * The opt-out is decided here and nowhere else, so a new board cannot forget it. Until
 * this existed the profile switch was honoured by the winners list alone, while the
 * leaderboard — the most-read public list, and on the homepage since Phase 3 — ignored it.
 */
export function publicListingFor(account: PublicListAccount): {
  displayName: string;
  schoolName: string | null;
  city: string | null;
} {
  if (account.hideFromPublicLists === true) {
    return { displayName: anonymousNameFor(account.classLevel), schoolName: null, city: null };
  }
  return {
    displayName: displayNameFor(account),
    schoolName: account.schoolName?.trim() || null,
    city: account.city?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  rank: number;
  studentId: string;
  displayName: string;
  classLevel: string | null;
  /** Null for a student who opted out of public lists — see `publicListingFor()`. */
  schoolName: string | null;
  city: string | null;
  xp: number;
}

interface LeaderboardAggregateRow {
  _id: Types.ObjectId;
  xp: number;
  studentId: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  classLevel?: string;
  schoolName?: string;
  city?: string;
  hideFromPublicLists?: boolean;
}

/**
 * The stages every board shares, up to but not including ordering.
 *
 * The `$lookup` runs before any `$limit` on purpose: filtering afterwards would let a
 * suspended account consume a place in the top ten and silently shorten the list.
 *
 * Scale note — this groups the activity collection, so it runs once per board per minute
 * (`loadBoard()`, 2026-10-10), never once per request. The period boards are cheaper than
 * the all-time one, because the `occurredOn` index narrows them before the grouping.
 */
function scopedPipeline(input: LeaderboardScopeInput): PipelineStage[] {
  const { from } = periodWindow(input.period, input.today ?? todayKey());
  const stages: PipelineStage[] = [];

  // Day keys are `YYYY-MM-DD`, so a lexicographic `$gte` is a chronological one.
  if (from !== null) stages.push({ $match: { occurredOn: { $gte: from } } });

  stages.push(
    {
      $group: {
        _id: '$student',
        xp: { $sum: '$xpAwarded' },
        // The moment this student's counted total stopped changing — the tie-break.
        lastEarnedAt: { $max: '$createdAt' },
      },
    },
    // A student with no XP in this window is not ranked at all, rather than last.
    { $match: { xp: { $gt: 0 } } },
    { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'account' } },
    { $unwind: '$account' },
    // Staff are not ranked (owner, 2026-10-10): a promoted admin is a student account with a
    // role, and must not take a place among the children who compete.
    { $match: { 'account.status': 'active', 'account.role': 'student' } },
  );

  if (input.scope === 'class') {
    stages.push({ $match: { 'account.classLevel': input.classLevel } });
  }

  return stages;
}

/** The total order described in the file header. Never varied per caller. */
const RANKING_ORDER: Record<string, 1 | -1> = { xp: -1, lastEarnedAt: 1, _id: 1 };

const ROW_PROJECTION: PipelineStage = {
  $project: {
    xp: 1,
    studentId: '$account.studentId',
    firstName: '$account.firstName',
    lastName: '$account.lastName',
    fullName: '$account.fullName',
    classLevel: '$account.classLevel',
    schoolName: '$account.schoolName',
    city: '$account.city',
    hideFromPublicLists: '$account.hideFromPublicLists',
  },
};

// ---------------------------------------------------------------------------
// The board, worked out once a minute
// ---------------------------------------------------------------------------

/**
 * Every ranked student on one board, in ranking order — the whole board from **one**
 * aggregation (2026-10-10).
 *
 * Before, a page ran three aggregations over the activity log (the rows, the total, the
 * count-ahead) and a student's standing two or three more, so 1,000 students at once queued
 * for seconds (50 at once: about 20 requests a second, 3 s each). Now the board is computed
 * once per minute per key (`lib/cache.ts`), and a page, a total and a rank are arithmetic over
 * it. Still nothing stored: it is the same `$sum` over `StudentActivity`, and it expires.
 *
 * A board is at most a few thousand small rows, and only what a row prints is kept. Up to a
 * minute stale for other students' XP, which a student cannot perceive; a student's **own**
 * XP is always fresh in `getStandingFor()`.
 */
interface BoardEntry {
  /** The account's ObjectId as a string. */
  id: string;
  xp: number;
  studentId: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  classLevel?: string;
  schoolName?: string;
  city?: string;
  hideFromPublicLists?: boolean;
}

const BOARD_TTL_SECONDS = 60;

async function computeBoard(input: LeaderboardScopeInput): Promise<BoardEntry[]> {
  const rows = await StudentActivity.aggregate<LeaderboardAggregateRow>([
    ...scopedPipeline(input),
    { $sort: RANKING_ORDER },
    ROW_PROJECTION,
  ]);
  return rows.map(({ _id, ...row }) => ({ ...row, id: String(_id) }));
}

function loadBoard(input: LeaderboardScopeInput): Promise<BoardEntry[]> {
  const today = input.today ?? todayKey();
  const classLevel = input.scope === 'class' ? input.classLevel : '-';
  return cached(`lb:${input.scope}:${classLevel}:${input.period}:${today}`, BOARD_TTL_SECONDS, () =>
    computeBoard({ ...input, today }),
  );
}

/** How many entries hold strictly more XP than `xp`. The board is sorted by XP descending. */
function countAhead(board: BoardEntry[], xp: number): number {
  let low = 0;
  let high = board.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (board[middle]!.xp > xp) low = middle + 1;
    else high = middle;
  }
  return low;
}

// ---------------------------------------------------------------------------
// A page of a board
// ---------------------------------------------------------------------------

export interface LeaderboardPageInput {
  page: number;
  limit: number;
}

export interface LeaderboardPage {
  scope: LeaderboardScope;
  classLevel: string | null;
  period: LeaderboardPeriod;
  /** The competition days the XP was summed over, so the page can state it plainly. */
  window: PeriodWindow;
  rows: LeaderboardRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * One page of a board, with every row's rank already decided.
 *
 * ## How the ranks are computed across a page boundary
 *
 * Rank is *position in the full ordering*, not position in the page, and equal XP shares a
 * rank. The **first** row's rank is one plus the number of students strictly ahead of it on
 * XP — a tie may straddle the page boundary, and counting-ahead gets that right where
 * `skip + 1` would not. Every **later** row either has strictly less XP than the row above it,
 * in which case its rank is its absolute position (`skip + index + 1`), or the same XP, in
 * which case it inherits. That is standard competition ranking.
 */
export async function getLeaderboardPage(
  input: LeaderboardScopeInput,
  { page, limit }: LeaderboardPageInput,
): Promise<LeaderboardPage> {
  const board = await loadBoard(input);
  const skip = (page - 1) * limit;
  const rows = board.slice(skip, skip + limit);

  let currentRank = rows.length > 0 ? countAhead(board, rows[0]!.xp) + 1 : 1;
  const ranked: LeaderboardRow[] = rows.map((row, index) => {
    if (index > 0 && row.xp !== rows[index - 1]!.xp) currentRank = skip + index + 1;
    return {
      rank: currentRank,
      studentId: row.studentId,
      ...publicListingFor(row),
      classLevel: row.classLevel ?? null,
      xp: row.xp,
    };
  });

  const total = board.length;
  return {
    scope: input.scope,
    classLevel: input.scope === 'class' ? input.classLevel : null,
    period: input.period,
    window: periodWindow(input.period, input.today ?? todayKey()),
    rows: ranked,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** The top of the overall, all-time board — what the dashboard and landing page show. */
export async function getTopLeaderboard(limit: number): Promise<LeaderboardRow[]> {
  const { rows } = await getLeaderboardPage({ scope: 'overall', period: 'all_time' }, { page: 1, limit });
  return rows;
}

// ---------------------------------------------------------------------------
// One student's standing
// ---------------------------------------------------------------------------

export interface LeaderboardStanding {
  /** Null when the student is genuinely not ranked on this board — see below. */
  rank: number | null;
  xp: number;
  /** How many students are ranked at all, so a rank can be shown as "3 of 40". */
  totalRanked: number;
}

/**
 * This student's XP inside a window. Indexed by `{student, occurredOn}`. Exported for the
 * dashboard's "+N this week" (Milestone 30, Phase 4), which is the weekly board's window —
 * one definition of "this week" for both.
 */
export async function xpInWindow(student: Types.ObjectId, from: DayKey | null): Promise<number> {
  const match: Record<string, unknown> = { student };
  if (from !== null) match.occurredOn = { $gte: from };

  const [row] = await StudentActivity.aggregate<{ xp: number }>([
    { $match: match },
    { $group: { _id: null, xp: { $sum: '$xpAwarded' } } },
  ]);
  return row?.xp ?? 0;
}

/**
 * Where one student stands on one board.
 *
 * `rank` is null for three genuinely different situations, all of which mean "you are
 * not on this board": no XP in the window, an account that is not in good standing, and
 * a student looking at a class that is not theirs. The `xp` is still reported, because
 * it is true and the student earned it — what they have not got is a position.
 *
 * Eligibility is decided by the board itself — the student is on it or not — rather than by
 * re-reading the account and re-checking the rules here. One definition of who appears on a
 * board; a second copy would be the thing that eventually lets a suspended account show a rank
 * on the page while being absent from the list under it.
 *
 * The student's own XP is **fresh** (read now, or handed in by the caller); the others' comes
 * from the cached board, up to a minute old. So a student who has just earned XP sees their
 * rank move at once, and one who has just earned their first XP is unranked for up to a minute.
 */
export async function getStandingFor(
  student: Types.ObjectId,
  input: LeaderboardScopeInput,
  knownXp?: number,
): Promise<LeaderboardStanding> {
  const { from } = periodWindow(input.period, input.today ?? todayKey());

  const [xp, board] = await Promise.all([
    knownXp === undefined ? xpInWindow(student, from) : Promise.resolve(knownXp),
    loadBoard(input),
  ]);
  const totalRanked = board.length;

  if (xp <= 0) return { rank: null, xp: Math.max(xp, 0), totalRanked };

  const me = String(student);
  const mine = board.find((entry) => entry.id === me);
  if (!mine) return { rank: null, xp, totalRanked };

  // Everybody else strictly ahead of this student's current XP. Their own cached row is left
  // out, because it may hold an older, lower total.
  const ahead = countAhead(board, xp) - (mine.xp > xp ? 1 : 0);
  return { rank: ahead + 1, xp, totalRanked };
}

/**
 * Standing on the overall, all-time board, for a caller that has already computed the
 * student's total XP (the dashboard has, from the reward engine's facts). Saves the
 * one query that would otherwise re-derive a figure the caller is holding.
 */
export async function getStanding(student: Types.ObjectId, xp: number): Promise<LeaderboardStanding> {
  return getStandingFor(student, { scope: 'overall', period: 'all_time' }, xp);
}
