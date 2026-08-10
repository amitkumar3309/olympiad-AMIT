import type { PipelineStage, Types } from 'mongoose';
import { daysBetween, shiftDay, todayKey, type DayKey } from '../lib/competitionDay';
import { levelProgressFor, type LevelProgress } from '../lib/xp';
import { ExamAttempt, Student, StudentActivity, type ActivityType } from '../models';

/**
 * Derives everything the dashboard reports about a student from their real
 * activity log.
 *
 * **Nothing here is stored.** XP is a sum over `StudentActivity`, the streak is
 * computed from the distinct days that collection contains, and the level is a
 * pure function of the XP. There is deliberately no denormalised progress
 * document: a counter that can disagree with the events behind it is a counter
 * that eventually shows a student a number nobody can explain, and this product's
 * whole requirement is that no displayed figure is invented. The cost is one
 * aggregation per dashboard load, which is the right trade at this scale.
 */

// ---------------------------------------------------------------------------
// XP, streaks and levels
// ---------------------------------------------------------------------------

export interface StreakSummary {
  /** Consecutive days up to today (or up to yesterday, if today is not yet used). */
  current: number;
  longest: number;
  /** Distinct days with any recorded activity. */
  activeDays: number;
  lastActiveOn: DayKey | null;
  /** Whether the current day already counts, so the UI can say "keep it going". */
  countedToday: boolean;
}

/**
 * Longest and current run of consecutive days in a set of day keys.
 *
 * A streak stays alive while it *can* still be extended: if the newest recorded
 * day is yesterday, today has not been lost yet, so the run is still current. Only
 * when the newest day is older than yesterday is the current streak zero.
 */
export function summariseStreak(days: readonly DayKey[], today: DayKey = todayKey()): StreakSummary {
  if (days.length === 0) {
    return { current: 0, longest: 0, activeDays: 0, lastActiveOn: null, countedToday: false };
  }

  // Newest first, de-duplicated defensively — `distinct` already returns a set,
  // but this function is also called directly by tests with hand-written input.
  const sorted = [...new Set(days)].sort().reverse();
  const newest = sorted[0]!;

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (daysBetween(sorted[i]!, sorted[i - 1]!) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  const gapFromToday = daysBetween(newest, today);
  let current = 0;
  if (gapFromToday === 0 || gapFromToday === 1) {
    current = 1;
    for (let i = 1; i < sorted.length; i += 1) {
      if (daysBetween(sorted[i]!, sorted[i - 1]!) !== 1) break;
      current += 1;
    }
  }

  return {
    current,
    longest,
    activeDays: sorted.length,
    lastActiveOn: newest,
    countedToday: gapFromToday === 0,
  };
}

interface XpSumRow {
  _id: null;
  xp: number;
}

/** Total XP for one student: the sum of what their recorded events were worth. */
export async function totalXpFor(student: Types.ObjectId): Promise<number> {
  const [row] = await StudentActivity.aggregate<XpSumRow>([
    { $match: { student } },
    { $group: { _id: null, xp: { $sum: '$xpAwarded' } } },
  ]);
  return row?.xp ?? 0;
}

export interface ProgressSummary {
  level: LevelProgress;
  streak: StreakSummary;
}

export async function getProgress(student: Types.ObjectId, today: DayKey = todayKey()): Promise<ProgressSummary> {
  const [xp, days] = await Promise.all([
    totalXpFor(student),
    // Bounded by the number of days the student has been active, not by their
    // number of events, so this stays small even for a very busy account.
    StudentActivity.distinct('occurredOn', { student }) as Promise<DayKey[]>,
  ]);

  return { level: levelProgressFor(xp), streak: summariseStreak(days, today) };
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export interface ActivityEntryView {
  id: string;
  type: ActivityType;
  xpAwarded: number;
  detail: string | null;
  occurredOn: DayKey;
  createdAt: Date;
}

export async function getRecentActivity(student: Types.ObjectId, limit: number): Promise<ActivityEntryView[]> {
  const entries = await StudentActivity.find({ student }).sort({ createdAt: -1 }).limit(limit);
  return entries.map((entry) => ({
    id: String(entry._id),
    type: entry.type,
    xpAwarded: entry.xpAwarded,
    detail: entry.detail ?? null,
    occurredOn: entry.occurredOn,
    createdAt: entry.createdAt,
  }));
}

export async function countActivity(student: Types.ObjectId): Promise<number> {
  return StudentActivity.countDocuments({ student });
}

export async function listActivity(
  student: Types.ObjectId,
  page: number,
  limit: number,
): Promise<{ entries: ActivityEntryView[]; total: number }> {
  const [entries, total] = await Promise.all([
    StudentActivity.find({ student })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    countActivity(student),
  ]);

  return {
    entries: entries.map((entry) => ({
      id: String(entry._id),
      type: entry.type,
      xpAwarded: entry.xpAwarded,
      detail: entry.detail ?? null,
      occurredOn: entry.occurredOn,
      createdAt: entry.createdAt,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/**
 * How a student is named on a leaderboard other people can see.
 *
 * First name plus last initial. The entrants are schoolchildren, and the
 * leaderboard is readable without signing in, so publishing a full legal name
 * next to a school and a class would identify a minor to anyone on the internet.
 * This keeps the ranking real and recognisable to the student themselves while not
 * being a directory of children. Widening it is a one-line change here and a
 * decision for the project owner, not a side effect of some other feature.
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
 * Only accounts in good standing appear. The `$lookup` runs before the `$limit`
 * on purpose: filtering afterwards would let a suspended account consume a place
 * in the top ten and silently shorten the list.
 *
 * Scale note — this groups the whole activity collection on every call. That is
 * appropriate for a first cohort of a few hundred students (the photo storage
 * ceiling caps it at roughly 250 anyway, see DATABASE_SCHEMA.md). If the field
 * grows by an order of magnitude, this is the query to put behind a cached
 * materialised standing, and the reason it is isolated in one function.
 */
function leaderboardPipeline(): PipelineStage[] {
  return [
    { $group: { _id: '$student', xp: { $sum: '$xpAwarded' } } },
    // A student with no XP is not ranked at all, rather than being shown as last.
    { $match: { xp: { $gt: 0 } } },
    { $sort: { xp: -1, _id: 1 } },
    { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'account' } },
    { $unwind: '$account' },
    { $match: { 'account.status': 'active' } },
  ];
}

export async function getTopLeaderboard(limit: number): Promise<LeaderboardRow[]> {
  const rows = await StudentActivity.aggregate<LeaderboardAggregateRow>([
    ...leaderboardPipeline(),
    { $limit: limit },
    {
      $project: {
        xp: 1,
        studentId: '$account.studentId',
        firstName: '$account.firstName',
        lastName: '$account.lastName',
        fullName: '$account.fullName',
        classLevel: '$account.classLevel',
        schoolName: '$account.schoolName',
      },
    },
  ]);

  return rows.map((row, index) => ({
    rank: index + 1,
    studentId: row.studentId,
    displayName: displayNameFor(row),
    classLevel: row.classLevel ?? null,
    schoolName: row.schoolName ?? null,
    xp: row.xp,
  }));
}

export interface LeaderboardStanding {
  /** Null when the student has no XP yet, i.e. is genuinely not ranked. */
  rank: number | null;
  xp: number;
  /** How many students are ranked at all, so a rank can be shown as "3 of 40". */
  totalRanked: number;
}

/**
 * Standard competition ranking: one plus the number of students strictly ahead, so
 * a tie shares a rank instead of being ordered arbitrarily.
 */
export async function getStanding(student: Types.ObjectId, xp: number): Promise<LeaderboardStanding> {
  const [aheadRows, rankedRows] = await Promise.all([
    xp > 0
      ? StudentActivity.aggregate<{ n: number }>([...leaderboardPipeline(), { $match: { xp: { $gt: xp } } }, { $count: 'n' }])
      : Promise.resolve([]),
    StudentActivity.aggregate<{ n: number }>([...leaderboardPipeline(), { $count: 'n' }]),
  ]);

  return {
    rank: xp > 0 ? (aheadRows[0]?.n ?? 0) + 1 : null,
    xp,
    totalRanked: rankedRows[0]?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// XP over time
// ---------------------------------------------------------------------------

export interface XpDayPoint {
  day: DayKey;
  xp: number;
}

interface XpByDayRow {
  _id: DayKey;
  xp: number;
}

/**
 * Real XP earned per competition day, oldest first, over the last `days` days.
 *
 * This exists so the analytics page has something true to plot. It replaced a
 * hardcoded "learning curve" (`Jul 20: 70%` … `Jul 29: 88%`) that was shown to every
 * student regardless of what they had done. Days with no activity are **omitted**
 * rather than zero-filled: a flat line at zero would imply a measured zero, where
 * the truth is that nothing was recorded.
 */
export async function getXpByDay(student: Types.ObjectId, days = 30, today: DayKey = todayKey()): Promise<XpDayPoint[]> {
  const from = shiftDay(today, days - 1);

  const rows = await StudentActivity.aggregate<XpByDayRow>([
    { $match: { student, occurredOn: { $gte: from } } },
    { $group: { _id: '$occurredOn', xp: { $sum: '$xpAwarded' } } },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((row) => ({ day: row._id, xp: row.xp }));
}

// ---------------------------------------------------------------------------
// Exam performance
// ---------------------------------------------------------------------------

export interface ExamPerformanceView {
  id: string;
  submittedAt: Date | null;
  totalScore: number;
  accuracy: number;
  timeTakenSeconds: number;
  questionCount: number;
}

/**
 * Recent submitted exam attempts.
 *
 * This is a real query against the real `ExamAttempt` collection, which no route
 * in the codebase writes to yet — so today it truthfully returns an empty list and
 * the dashboard shows its "no tests yet" state. It is written as a live query
 * rather than a hardcoded `[]` so that the panel starts working the moment exam
 * submission exists, and so nothing has to remember to come back and un-fake it.
 *
 * It matches on the human-facing `AMIT_xxxx` id because that is what
 * `ExamAttempt.studentId` is typed as (a `String`, not an ObjectId reference).
 * Whoever implements exam submission must write that same value — noted in
 * DATABASE_SCHEMA.md, since the model predates this milestone and will need
 * revisiting anyway.
 */
export async function getRecentExamPerformance(studentId: string, limit: number): Promise<ExamPerformanceView[]> {
  const attempts = await ExamAttempt.find({ studentId, status: 'Submitted' }).sort({ endTime: -1, startTime: -1 }).limit(limit);

  return attempts.map((attempt) => ({
    id: String(attempt._id),
    submittedAt: attempt.endTime ?? null,
    totalScore: attempt.totalScore,
    accuracy: attempt.accuracy,
    timeTakenSeconds: attempt.timeTakenSeconds,
    questionCount: attempt.answers.length,
  }));
}

// ---------------------------------------------------------------------------
// Public participation figures
// ---------------------------------------------------------------------------

export interface PublicStats {
  studentsRegistered: number;
  registeredToday: number;
  schoolsRepresented: number;
  studentsActiveToday: number;
}

/**
 * The figures the public landing page shows. Every one is a real count; there is
 * no "450+ participating schools" constant anywhere.
 */
export async function getPublicStats(today: DayKey = todayKey()): Promise<PublicStats> {
  const startOfToday = new Date(`${today}T00:00:00.000Z`);
  // The day key is an IST date, so its midnight is 5:30 earlier in UTC terms.
  startOfToday.setUTCMinutes(startOfToday.getUTCMinutes() - (5 * 60 + 30));

  const [studentsRegistered, registeredToday, schools, activeStudentsToday] = await Promise.all([
    Student.countDocuments({ status: 'active' }),
    Student.countDocuments({ status: 'active', registeredAt: { $gte: startOfToday } }),
    Student.distinct('schoolName', { status: 'active' }),
    StudentActivity.distinct('student', { occurredOn: today }),
  ]);

  return {
    studentsRegistered,
    registeredToday,
    // Legacy accounts have no school name; an empty value is not a school.
    schoolsRepresented: schools.filter((name): name is string => typeof name === 'string' && name.trim().length > 0).length,
    studentsActiveToday: activeStudentsToday.length,
  };
}
