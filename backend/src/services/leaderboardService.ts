import type { PipelineStage, Types } from 'mongoose';
import { shiftDay, todayKey, type DayKey } from '../lib/competitionDay';
import { StudentActivity } from '../models';

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

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export interface LeaderboardRow {
  rank: number;
  studentId: string;
  displayName: string;
  classLevel: string | null;
  schoolName: string | null;
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
}

/**
 * The stages every board shares, up to but not including ordering.
 *
 * The `$lookup` runs before any `$limit` on purpose: filtering afterwards would let a
 * suspended account consume a place in the top ten and silently shorten the list.
 *
 * Scale note — this groups the activity collection on every call. That is appropriate
 * for a first cohort of a few hundred students (photo storage caps it near 250 anyway;
 * see DATABASE_SCHEMA.md). If the field grows by an order of magnitude, this is the
 * query to put behind a cached materialised standing, and the reason it is isolated in
 * one function. The period boards are cheaper than the all-time one, because the
 * `occurredOn` index narrows them before the grouping.
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
    { $match: { 'account.status': 'active' } },
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
  },
};

async function countMatching(pipeline: PipelineStage[], extra: PipelineStage[] = []): Promise<number> {
  const [row] = await StudentActivity.aggregate<{ n: number }>([...pipeline, ...extra, { $count: 'n' }]);
  return row?.n ?? 0;
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
 * Rank is *position in the full ordering*, not position in the page, and equal XP
 * shares a rank. Both facts survive pagination without loading the whole board:
 *
 *  - The **first** row's rank is one plus the number of students strictly ahead of it
 *    on XP — a single `$count`. This is the only row whose rank cannot be derived from
 *    the page itself, precisely because a tie may straddle the page boundary: the row
 *    above it (on the previous page) might hold the same XP, in which case they share a
 *    rank, and counting-ahead gets that right where `skip + 1` would not.
 *  - Every **later** row either has strictly less XP than the row above it, in which
 *    case its rank is its absolute position (`skip + index + 1`), or the same XP, in
 *    which case it inherits. That is the definition of standard competition ranking,
 *    applied with nothing more than the previous row in hand.
 *
 * Three aggregations per page (the rows, the total, the count-ahead) and no
 * `$setWindowFields`, which would tie the correctness of a student's rank to the
 * MongoDB server version underneath it.
 */
export async function getLeaderboardPage(
  input: LeaderboardScopeInput,
  { page, limit }: LeaderboardPageInput,
): Promise<LeaderboardPage> {
  const pipeline = scopedPipeline(input);
  const skip = (page - 1) * limit;

  const [total, rows] = await Promise.all([
    countMatching(pipeline),
    StudentActivity.aggregate<LeaderboardAggregateRow>([
      ...pipeline,
      { $sort: RANKING_ORDER },
      { $skip: skip },
      { $limit: limit },
      ROW_PROJECTION,
    ]),
  ]);

  const firstRank = rows.length > 0 ? (await countMatching(pipeline, [{ $match: { xp: { $gt: rows[0]!.xp } } }])) + 1 : 1;

  let currentRank = firstRank;
  const ranked: LeaderboardRow[] = rows.map((row, index) => {
    if (index > 0 && row.xp !== rows[index - 1]!.xp) currentRank = skip + index + 1;
    return {
      rank: currentRank,
      studentId: row.studentId,
      displayName: displayNameFor(row),
      classLevel: row.classLevel ?? null,
      schoolName: row.schoolName ?? null,
      xp: row.xp,
    };
  });

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

/** This student's XP inside a window. Indexed by `{student, occurredOn}`. */
async function xpInWindow(student: Types.ObjectId, from: DayKey | null): Promise<number> {
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
 * Eligibility is decided by running the board's own pipeline filtered to this student,
 * rather than by re-reading the account and re-checking the rules here. One definition
 * of who appears on a board; a second copy would be the thing that eventually lets a
 * suspended account show a rank on the page while being absent from the list under it.
 */
export async function getStandingFor(
  student: Types.ObjectId,
  input: LeaderboardScopeInput,
  knownXp?: number,
): Promise<LeaderboardStanding> {
  const { from } = periodWindow(input.period, input.today ?? todayKey());
  const pipeline = scopedPipeline(input);

  const [xp, totalRanked] = await Promise.all([
    knownXp === undefined ? xpInWindow(student, from) : Promise.resolve(knownXp),
    countMatching(pipeline),
  ]);

  if (xp <= 0) return { rank: null, xp: Math.max(xp, 0), totalRanked };

  // `_id` after the `$group` is the student's ObjectId, and `student` is already one —
  // which matters, because `$match` inside an aggregation does **not** cast a string to
  // an ObjectId the way `find()` would, and would silently match nothing.
  const onThisBoard = await countMatching(pipeline, [{ $match: { _id: student } }]);
  if (onThisBoard === 0) return { rank: null, xp, totalRanked };

  const ahead = await countMatching(pipeline, [{ $match: { xp: { $gt: xp } } }]);
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
