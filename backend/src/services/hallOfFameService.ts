import type { PipelineStage, Types } from 'mongoose';
import { todayKey, type DayKey } from '../lib/competitionDay';
import { DailyChallengeAttempt, MockTestAttempt, PracticeSession, StudentActivity } from '../models';
import { displayNameFor, getLeaderboardPage } from './leaderboardService';
import { summariseStreak } from './progressService';

/**
 * The Hall of Fame: the platform's standing honours, every one of them a real feat
 * somebody actually performed.
 *
 * ## What makes this different from the leaderboard
 *
 * The leaderboard answers "who has the most XP right now?", and XP measures
 * *participation* more than ability (known bugs #16, #23 and #29 — a student who scores
 * 40/40 on a mock test earns exactly what one who scores 4/40 earns). A hall of fame
 * that only re-ranked XP would therefore be the leaderboard with a nicer heading. So
 * five different boards measure five different things, three of which are about how
 * well somebody did rather than how often they turned up: the best paper anybody has
 * sat, the longest run of consecutive days, and the most correct daily challenges.
 *
 * ## Nothing here is invented, and nothing is filled in
 *
 * Every entry is an aggregation over a collection this backend writes: `StudentActivity`
 * (XP and streaks), `MockTestAttempt` (submitted, graded papers), `DailyChallengeAttempt`
 * (marked answers) and `PracticeSession` (submitted sessions). There is no seeded
 * champion, no sample row and no "coming soon" placeholder — a board with nothing behind
 * it comes back **empty with a reason**, and the page says what would put somebody on
 * it. That is the same rule the landing page's figures and the dashboard's panels
 * follow, and it is why this file contains no constant that could be mistaken for data.
 *
 * There is deliberately **no official-exam board**. The Olympiad itself is not built:
 * `ExamAttempt` and `Result` are read by the product and written by nothing, so a
 * "national champions" board would be permanently empty at best and fabricated at worst.
 * It belongs to the milestone that makes an official sitting exist.
 *
 * ## Names, and who appears
 *
 * Boards are public, so names come from `displayNameFor()` — the one function that
 * decides how much of a child's name this product publishes — and only accounts in good
 * standing appear, filtered *before* the limit so a suspended account cannot consume a
 * place and silently shorten a board.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export const HALL_OF_FAME_BOARDS = [
  'xp_champions',
  'mock_masters',
  'streak_legends',
  'challenge_champions',
  'practice_devotees',
] as const;
export type HallOfFameBoardCode = (typeof HALL_OF_FAME_BOARDS)[number];

export interface HallOfFameEntry {
  rank: number;
  studentId: string;
  displayName: string;
  classLevel: string | null;
  schoolName: string | null;
  /** The measured number this board ranks on. Always server-derived. */
  value: number;
  /** How to read that number, e.g. `92% · 46/50` or `12 days`. */
  valueLabel: string;
  /** When the feat happened, for boards that measure a single dated achievement. */
  achievedOn: Date | null;
  /** A short line of context, e.g. the paper that was sat. Never a computed claim. */
  detail: string | null;
}

export interface HallOfFameBoard {
  code: HallOfFameBoardCode;
  title: string;
  description: string;
  icon: string;
  entries: HallOfFameEntry[];
  /** Shown instead of the board when it is empty. States what would fill it. */
  emptyReason: string;
}

export interface HallOfFameTotals {
  studentsRanked: number;
  xpAwarded: number;
  mockTestsGraded: number;
  challengesAnswered: number;
  practiceSessionsCompleted: number;
}

export interface HallOfFameView {
  boards: HallOfFameBoard[];
  totals: HallOfFameTotals;
  /** The competition day the boards were computed for. */
  generatedFor: DayKey;
}

/** How many names each board carries. Small on purpose: this is an honours list. */
export const DEFAULT_BOARD_SIZE = 5;
export const MAX_BOARD_SIZE = 20;

// ---------------------------------------------------------------------------
// Shared aggregation parts
// ---------------------------------------------------------------------------

interface AccountFields {
  studentId: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  classLevel?: string;
  schoolName?: string;
}

/**
 * Joins the grouped rows to their accounts and drops everyone not in good standing.
 *
 * Every board that groups by student uses this, so "who is eligible to be honoured" has
 * one answer rather than five that could drift apart.
 */
const JOIN_ACTIVE_ACCOUNT: PipelineStage[] = [
  { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'account' } },
  { $unwind: '$account' },
  { $match: { 'account.status': 'active' } },
];

function accountOf(row: { account?: AccountFields }): AccountFields {
  return row.account ?? { studentId: '' };
}

/**
 * Turns an ordered list of measured rows into ranked entries.
 *
 * Standard competition ranking, exactly as the leaderboard does it: equal values share a
 * rank, so a board can honestly read 1, 2, 2, 4. The caller has already applied the
 * board's tie-break to fix the *order*; this only decides the numbers.
 */
function rank<T extends { value: number }>(rows: T[]): Array<T & { rank: number }> {
  let current = 1;
  return rows.map((row, index) => {
    if (index > 0 && row.value !== rows[index - 1]!.value) current = index + 1;
    return { ...row, rank: current };
  });
}

// ---------------------------------------------------------------------------
// Board 1 — XP champions
// ---------------------------------------------------------------------------

async function xpChampions(limit: number): Promise<HallOfFameBoard> {
  // Reuses the leaderboard rather than re-deriving a standing: the Hall of Fame's XP
  // board and the leaderboard's first page must never disagree, and the only way to
  // guarantee that is for them to be the same query.
  const { rows } = await getLeaderboardPage({ scope: 'overall', period: 'all_time' }, { page: 1, limit });

  return {
    code: 'xp_champions',
    title: 'XP champions',
    description: 'The highest lifetime XP on the platform, earned across every activity.',
    icon: 'ph-crown',
    entries: rows.map((row) => ({
      rank: row.rank,
      studentId: row.studentId,
      displayName: row.displayName,
      classLevel: row.classLevel,
      schoolName: row.schoolName,
      value: row.xp,
      valueLabel: `${row.xp.toLocaleString('en-IN')} XP`,
      achievedOn: null,
      detail: null,
    })),
    emptyReason: 'Nobody has earned XP yet. Registering, verifying an email and showing up all count.',
  };
}

// ---------------------------------------------------------------------------
// Board 2 — the best papers sat
// ---------------------------------------------------------------------------

interface MockMasterRow {
  _id: Types.ObjectId;
  best: {
    score: number;
    maxMarks: number;
    accuracy: number;
    timeTakenSeconds: number;
    submittedAt: Date | null;
    percent: number;
    testTitle: string | null;
  };
  account?: AccountFields;
}

/**
 * The best single mock-test paper each student has sat, ranked by percentage.
 *
 * **Percentage, not raw score**, because papers differ: 40/40 on a twenty-question quiz
 * and 40/80 on a final are not the same feat, and ranking on the raw number would put
 * whoever happened to sit the longest paper on top.
 *
 * Only papers scoring **above zero** appear. Negative marking means a score can be zero
 * or below, and "0% of the paper" is not an achievement — a hall of fame that listed one
 * would be padding itself.
 *
 * Tie-break, in order: percentage, then accuracy over the questions answered, then the
 * shorter time, then the earlier submission. Every one of those is a real measurement of
 * the same sitting, so the order is deterministic without being arbitrary.
 */
async function mockMasters(limit: number): Promise<HallOfFameBoard> {
  const rows = await MockTestAttempt.aggregate<MockMasterRow>([
    { $match: { status: 'submitted', maxMarks: { $gt: 0 }, score: { $gt: 0 } } },
    { $addFields: { percent: { $multiply: [{ $divide: ['$score', '$maxMarks'] }, 100] } } },
    // Ordered before the grouping so `$first` really is each student's best paper.
    { $sort: { percent: -1, accuracy: -1, timeTakenSeconds: 1, submittedAt: 1, _id: 1 } },
    { $lookup: { from: 'mocktests', localField: 'test', foreignField: '_id', as: 'testDoc' } },
    {
      $group: {
        _id: '$student',
        best: {
          $first: {
            score: '$score',
            maxMarks: '$maxMarks',
            accuracy: '$accuracy',
            timeTakenSeconds: '$timeTakenSeconds',
            submittedAt: '$submittedAt',
            percent: '$percent',
            testTitle: { $ifNull: [{ $first: '$testDoc.title' }, null] },
          },
        },
      },
    },
    ...JOIN_ACTIVE_ACCOUNT,
    // `$group` does not preserve the incoming order between groups, so the board's own
    // ordering has to be re-applied to the grouped rows.
    {
      $sort: {
        'best.percent': -1,
        'best.accuracy': -1,
        'best.timeTakenSeconds': 1,
        'best.submittedAt': 1,
        _id: 1,
      },
    },
    { $limit: limit },
  ]);

  const entries = rank(
    rows.map((row) => {
      const account = accountOf(row);
      const percent = Math.round(row.best.percent * 10) / 10;
      return {
        studentId: account.studentId,
        displayName: displayNameFor(account),
        classLevel: account.classLevel ?? null,
        schoolName: account.schoolName ?? null,
        value: percent,
        valueLabel: `${percent}% · ${row.best.score}/${row.best.maxMarks}`,
        achievedOn: row.best.submittedAt ?? null,
        detail: row.best.testTitle,
      };
    }),
  );

  return {
    code: 'mock_masters',
    title: 'Best papers',
    description: 'The highest-scoring mock test anybody has sat, as a percentage of the paper.',
    icon: 'ph-exam',
    entries,
    emptyReason: 'No mock test has been scored above zero yet. Sit one from the Mock Tests page.',
  };
}

// ---------------------------------------------------------------------------
// Board 3 — the longest streaks
// ---------------------------------------------------------------------------

interface StreakRow {
  _id: Types.ObjectId;
  days: DayKey[];
  account?: AccountFields;
}

/** A streak of one day is just a visit; two consecutive days is the smallest real run. */
const MIN_HONOURED_STREAK = 2;

/**
 * The longest run of consecutive competition days anybody has kept.
 *
 * `longest`, never `current`: a hall of fame records what somebody achieved, and a board
 * that quietly dropped a student the day they missed would be taking away something they
 * really did. That is the same reasoning the journey map uses for its cumulative facts.
 *
 * The runs are computed in this process rather than in the database, by the *same*
 * `summariseStreak()` the dashboard uses — so the number honoured here and the number on
 * the student's own page cannot disagree. The cost is one array of day keys per active
 * student, which is bounded by the cohort (a few hundred; photo storage caps it near
 * 250) and is the same scale note the leaderboard carries.
 */
async function streakLegends(limit: number, today: DayKey): Promise<HallOfFameBoard> {
  const rows = await StudentActivity.aggregate<StreakRow>([
    { $group: { _id: '$student', days: { $addToSet: '$occurredOn' } } },
    ...JOIN_ACTIVE_ACCOUNT,
  ]);

  const measured = rows
    .map((row) => {
      const account = accountOf(row);
      const streak = summariseStreak(row.days, today);
      return {
        studentId: account.studentId,
        displayName: displayNameFor(account),
        classLevel: account.classLevel ?? null,
        schoolName: account.schoolName ?? null,
        value: streak.longest,
        valueLabel: `${streak.longest} day${streak.longest === 1 ? '' : 's'}`,
        achievedOn: null,
        detail: `${streak.activeDays} active day${streak.activeDays === 1 ? '' : 's'} in total`,
        activeDays: streak.activeDays,
      };
    })
    .filter((row) => row.value >= MIN_HONOURED_STREAK)
    // Longest run first; then the student who has been active on more days overall;
    // then the account id, so the order is total and stable between requests.
    .sort((a, b) => b.value - a.value || b.activeDays - a.activeDays || a.studentId.localeCompare(b.studentId))
    .slice(0, limit)
    .map(({ activeDays: _activeDays, ...entry }) => entry);

  return {
    code: 'streak_legends',
    title: 'Streak legends',
    description: 'The longest run of consecutive days anybody has shown up for.',
    icon: 'ph-flame',
    entries: rank(measured),
    emptyReason: 'No one has kept a run of two days or more yet. Come back tomorrow to start one.',
  };
}

// ---------------------------------------------------------------------------
// Board 4 — the daily challenge
// ---------------------------------------------------------------------------

interface CountedRow {
  _id: Types.ObjectId;
  value: number;
  lastAt: Date | null;
  account?: AccountFields;
}

/**
 * Most **correct** daily-challenge answers.
 *
 * Correct ones only, deliberately. The XP for a challenge is paid for answering rather
 * than for being right (so a wrong answer is never punished), which is the correct rule
 * for a daily habit — but it makes "challenges answered" another participation count,
 * and this board exists to measure something else.
 *
 * Ties go to whoever got there first, the same rule the leaderboard uses.
 */
async function challengeChampions(limit: number): Promise<HallOfFameBoard> {
  const rows = await DailyChallengeAttempt.aggregate<CountedRow>([
    { $match: { 'answer.isCorrect': true } },
    { $group: { _id: '$student', value: { $sum: 1 }, lastAt: { $max: '$submittedAt' } } },
    ...JOIN_ACTIVE_ACCOUNT,
    { $sort: { value: -1, lastAt: 1, _id: 1 } },
    { $limit: limit },
  ]);

  return {
    code: 'challenge_champions',
    title: 'Challenge champions',
    description: "The most daily challenges answered correctly — one question a day, one chance at it.",
    icon: 'ph-dice-five',
    entries: rank(
      rows.map((row) => {
        const account = accountOf(row);
        return {
          studentId: account.studentId,
          displayName: displayNameFor(account),
          classLevel: account.classLevel ?? null,
          schoolName: account.schoolName ?? null,
          value: row.value,
          valueLabel: `${row.value} correct`,
          achievedOn: row.lastAt ?? null,
          detail: null,
        };
      }),
    ),
    emptyReason: 'Nobody has answered a daily challenge correctly yet. Today’s is waiting.',
  };
}

// ---------------------------------------------------------------------------
// Board 5 — practice
// ---------------------------------------------------------------------------

/**
 * Most practice sessions actually submitted.
 *
 * Submitted, not started: an abandoned session is not practice, and counting it would
 * make the board fillable by opening papers and walking away.
 */
async function practiceDevotees(limit: number): Promise<HallOfFameBoard> {
  const rows = await PracticeSession.aggregate<CountedRow>([
    { $match: { status: 'submitted' } },
    { $group: { _id: '$student', value: { $sum: 1 }, lastAt: { $max: '$submittedAt' } } },
    ...JOIN_ACTIVE_ACCOUNT,
    { $sort: { value: -1, lastAt: 1, _id: 1 } },
    { $limit: limit },
  ]);

  return {
    code: 'practice_devotees',
    title: 'Practice devotees',
    description: 'The most practice sessions worked through and submitted.',
    icon: 'ph-target',
    entries: rank(
      rows.map((row) => {
        const account = accountOf(row);
        return {
          studentId: account.studentId,
          displayName: displayNameFor(account),
          classLevel: account.classLevel ?? null,
          schoolName: account.schoolName ?? null,
          value: row.value,
          valueLabel: `${row.value} session${row.value === 1 ? '' : 's'}`,
          achievedOn: row.lastAt ?? null,
          detail: null,
        };
      }),
    ),
    emptyReason: 'No practice session has been submitted yet. The Practice Zone is open.',
  };
}

// ---------------------------------------------------------------------------
// The whole hall
// ---------------------------------------------------------------------------

/**
 * Platform-wide totals, so the page can say how much of this is real without a visitor
 * having to count the rows themselves. Every one is a live count.
 */
async function hallTotals(): Promise<HallOfFameTotals> {
  const [xpRow, mockTestsGraded, challengesAnswered, practiceSessionsCompleted, rankedRow] = await Promise.all([
    StudentActivity.aggregate<{ xp: number }>([{ $group: { _id: null, xp: { $sum: '$xpAwarded' } } }]),
    MockTestAttempt.countDocuments({ status: 'submitted' }),
    DailyChallengeAttempt.countDocuments({}),
    PracticeSession.countDocuments({ status: 'submitted' }),
    StudentActivity.aggregate<{ n: number }>([
      { $group: { _id: '$student', xp: { $sum: '$xpAwarded' } } },
      { $match: { xp: { $gt: 0 } } },
      ...JOIN_ACTIVE_ACCOUNT,
      { $count: 'n' },
    ]),
  ]);

  return {
    studentsRanked: rankedRow[0]?.n ?? 0,
    xpAwarded: xpRow[0]?.xp ?? 0,
    mockTestsGraded,
    challengesAnswered,
    practiceSessionsCompleted,
  };
}

export async function getHallOfFame(limit = DEFAULT_BOARD_SIZE, today: DayKey = todayKey()): Promise<HallOfFameView> {
  const [champions, masters, legends, challengers, devotees, totals] = await Promise.all([
    xpChampions(limit),
    mockMasters(limit),
    streakLegends(limit, today),
    challengeChampions(limit),
    practiceDevotees(limit),
    hallTotals(),
  ]);

  return {
    // Ordered as the page reads them: the headline standing first, then the three
    // boards that measure how well somebody did, then the one that measures effort.
    boards: [champions, masters, legends, challengers, devotees],
    totals,
    generatedFor: today,
  };
}
