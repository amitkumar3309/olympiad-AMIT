import { Router, type Request, type Response } from 'express';
import type { PipelineStage, Types } from 'mongoose';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { Student, StudentActivity } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { getPlatformAnalytics } from '../../services/platformAnalyticsService';
import { periodWindow, type LeaderboardPeriod } from '../../services/leaderboardService';
import { ACHIEVEMENTS } from '../../lib/achievements';
import { levelProgressFor } from '../../lib/xp';
import {
  getQuestionPerformance,
  getTestPerformance,
  type QuestionPerformanceQuery,
} from '../../services/questionAnalyticsService';
import {
  platformAnalyticsQuerySchema,
  adminLeaderboardQuerySchema,
  questionPerformanceQuerySchema,
  type PlatformAnalyticsQuery,
  type AdminLeaderboardQuery,
} from '../../validation/contentSchemas';

/**
 * The three read-only administrative insight surfaces (Milestone 12): platform
 * analytics, the leaderboard as staff see it, and how the reward catalogue is
 * actually landing.
 *
 * All three are **reads with no side effects**, and all three are counted from
 * collections rather than estimated — see the header of
 * `services/platformAnalyticsService.ts` for why that rule is written down.
 */
const router = Router();

// ---------------------------------------------------------------------------
// Platform analytics
// ---------------------------------------------------------------------------

/**
 * Gated on `analytics:read:any` rather than a new permission: this is precisely
 * "read analytics that are not your own", which that permission already means, and
 * inventing `analytics:read:platform` would split one capability across two names.
 */
router.get(
  '/admin/analytics',
  requirePermission('analytics:read:any'),
  validate({ query: platformAnalyticsQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { days } = req.query as unknown as PlatformAnalyticsQuery;
      sendSuccess(res, 200, { analytics: await getPlatformAnalytics(days) });
    } catch (err) {
      logger.error({ err }, 'Failed to build platform analytics');
      sendError(res, 500, 'Could not load analytics right now. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// The leaderboard, unmasked
// ---------------------------------------------------------------------------

const PERIOD_BY_QUERY: Record<AdminLeaderboardQuery['period'], LeaderboardPeriod> = {
  all: 'all_time',
  month: 'monthly',
  week: 'weekly',
  today: 'daily',
};

interface AdminBoardRow {
  _id: Types.ObjectId;
  xp: number;
  studentId: string;
  fullName?: string;
  email?: string;
  classLevel?: string;
  schoolName?: string;
  status?: string;
}

/**
 * The same ranking as the public board, with the masking removed.
 *
 * The public leaderboard shortens names to a first name and a last initial, because
 * the entrants are schoolchildren and that page is indexable (see the Milestone 10
 * ADR). Staff running the competition need the opposite: the full name, the student
 * ID and the account's status, so a standing can be checked against a real person.
 * That is the entire difference, and it is why this cannot just be the public
 * endpoint with a flag — the masking is a property of the public surface.
 *
 * Ordering deliberately reuses `periodWindow()` from `leaderboardService`, so an
 * administrator and a student asked about "this week" get the same week.
 */
router.get(
  '/admin/leaderboard',
  requirePermission('students:read'),
  validate({ query: adminLeaderboardQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, classLevel, period } = req.query as unknown as AdminLeaderboardQuery;
      const window = periodWindow(PERIOD_BY_QUERY[period]);

      const match: Record<string, unknown> = {};
      if (window.from) match.occurredOn = { $gte: window.from };

      const pipeline: PipelineStage[] = [
        ...(Object.keys(match).length > 0 ? [{ $match: match } as PipelineStage] : []),
        { $group: { _id: '$student', xp: { $sum: '$xpAwarded' }, firstAt: { $min: '$occurredOn' } } },
        { $match: { xp: { $gt: 0 } } },
        { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'account' } },
        { $unwind: '$account' },
        // Staff-only accounts are not competitors and must not appear on any board.
        { $match: { 'account.role': { $ne: 'superadmin' } } },
        ...(classLevel ? [{ $match: { 'account.classLevel': classLevel } } as PipelineStage] : []),
        {
          $project: {
            xp: 1,
            firstAt: 1,
            studentId: '$account.studentId',
            fullName: '$account.fullName',
            email: '$account.email',
            classLevel: '$account.classLevel',
            schoolName: '$account.schoolName',
            status: '$account.status',
          },
        },
        // The same total ordering the public board uses: XP, then who got there
        // first, then the account id — the third key is what stops a row appearing
        // on two pages or on none.
        { $sort: { xp: -1, firstAt: 1, _id: 1 } },
      ];

      const [rows, totalRows] = await Promise.all([
        StudentActivity.aggregate<AdminBoardRow & { firstAt: string }>([
          ...pipeline,
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ]),
        StudentActivity.aggregate<{ total: number }>([...pipeline, { $count: 'total' }]),
      ]);

      const total = totalRows[0]?.total ?? 0;
      const startRank = (page - 1) * limit + 1;

      sendSuccess(res, 200, {
        leaderboard: rows.map((row, index) => ({
          // Position in the full ordering, not in the page.
          rank: startRank + index,
          studentId: row.studentId,
          fullName: row.fullName ?? null,
          email: row.email ?? null,
          classLevel: row.classLevel ?? null,
          schoolName: row.schoolName ?? null,
          status: row.status ?? null,
          xp: row.xp,
          level: levelProgressFor(row.xp).level,
        })),
        period,
        classLevel: classLevel ?? null,
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to build the administrative leaderboard');
      sendError(res, 500, 'Could not load the leaderboard right now. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// How the reward catalogue is landing
// ---------------------------------------------------------------------------

/**
 * XP distribution by level, and how many students hold each achievement.
 *
 * Gated on `rewards:write` because this is the evidence an administrator needs
 * *before* re-pricing the award table — the two belong to the same job.
 *
 * The honest limitation, stated rather than hidden: achievement holders are counted
 * from the **activity log**, not by evaluating the catalogue per student.
 * `evaluateAchievements()` is a pure function of `RewardFacts`, and assembling
 * facts is a several-query job per account — doing that for every student would be
 * hundreds of round trips to render one table. So each achievement declares which
 * activity type and count it corresponds to, and the count is one grouped
 * aggregation. Any achievement that cannot be expressed that way is reported with
 * `holders: null` rather than a guess, and the UI says "not counted" instead of
 * showing a number that is not one.
 */
/**
 * Which achievements can be counted **exactly** from the activity log, and how.
 *
 * The distinction matters more than it looks. "Answered at least five daily
 * challenges" and "answered on five *consecutive* days" are different facts, and an
 * aggregation can answer the first but not the second. Reporting a simple count for
 * a streak achievement would put a number on the page that is not the number it
 * claims to be — precisely the class of quiet invention Milestone 5 spent a
 * follow-up pass deleting.
 *
 * So the streak-based achievements are reported as `holders: null` and the UI says
 * "not counted", rather than a plausible figure nobody can reproduce.
 */
type HolderRule =
  /** At least one activity row of this type. */
  | { kind: 'hasActivity'; activityType: string }
  /** Lifetime XP at or above a threshold. */
  | { kind: 'xpAtLeast'; xp: number }
  /** Level at or above a threshold, using the same table the student's page uses. */
  | { kind: 'levelAtLeast'; level: number }
  /** Active on at least this many distinct competition days. */
  | { kind: 'activeDays'; days: number }
  /** A consecutive-day streak: not answerable by aggregation. Honestly uncounted. */
  | { kind: 'notCounted' };

const HOLDER_RULES: Record<string, HolderRule> = {
  enrolled: { kind: 'hasActivity', activityType: 'account_created' },
  verified: { kind: 'hasActivity', activityType: 'email_verified' },
  challenge_first: { kind: 'hasActivity', activityType: 'daily_challenge_completed' },
  xp_100: { kind: 'xpAtLeast', xp: 100 },
  xp_500: { kind: 'xpAtLeast', xp: 500 },
  level_5: { kind: 'levelAtLeast', level: 5 },
  active_10_days: { kind: 'activeDays', days: 10 },
  streak_3: { kind: 'notCounted' },
  streak_7: { kind: 'notCounted' },
  challenge_streak_5: { kind: 'notCounted' },
};

router.get(
  '/admin/rewards/overview',
  requirePermission('rewards:write'),
  ensureDb,
  async (_req: Request, res: Response) => {
    try {
      const perStudentPipeline: PipelineStage[] = [
        { $group: { _id: '$student', xp: { $sum: '$xpAwarded' } } },
        { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'account' } },
        { $unwind: '$account' },
        { $match: { 'account.role': { $ne: 'superadmin' } } },
      ];

      // Distinct students holding at least one row of each activity type.
      const byTypePipeline: PipelineStage[] = [
        { $group: { _id: { student: '$student', type: '$type' } } },
        { $group: { _id: '$_id.type', students: { $sum: 1 } } },
      ];

      // How many distinct competition days each student has been active on.
      const activeDaysPipeline: PipelineStage[] = [
        { $group: { _id: { student: '$student', day: '$occurredOn' } } },
        { $group: { _id: '$_id.student', days: { $sum: 1 } } },
      ];

      const [earners, byType, activeDays, totalStudents] = await Promise.all([
        StudentActivity.aggregate<{ _id: Types.ObjectId; xp: number }>(perStudentPipeline),
        StudentActivity.aggregate<{ _id: string; students: number }>(byTypePipeline),
        StudentActivity.aggregate<{ _id: Types.ObjectId; days: number }>(activeDaysPipeline),
        Student.countDocuments({ role: { $ne: 'superadmin' } }),
      ]);

      // Level distribution, computed from the same thresholds the student's own page
      // uses, so the two cannot disagree about what level anybody is.
      const byLevel = new Map<number, number>();
      for (const row of earners) {
        const level = levelProgressFor(row.xp).level;
        byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
      }

      const studentsByType = new Map(byType.map((row) => [row._id, row.students]));

      function holdersOf(code: string): number | null {
        const rule = HOLDER_RULES[code];
        if (!rule || rule.kind === 'notCounted') return null;
        switch (rule.kind) {
          case 'hasActivity':
            return studentsByType.get(rule.activityType) ?? 0;
          case 'xpAtLeast':
            return earners.filter((row) => row.xp >= rule.xp).length;
          case 'levelAtLeast':
            return earners.filter((row) => levelProgressFor(row.xp).level >= rule.level).length;
          case 'activeDays':
            return activeDays.filter((row) => row.days >= rule.days).length;
        }
      }

      sendSuccess(res, 200, {
        overview: {
          totalStudents,
          earners: earners.length,
          /** Students with no XP at all — the group worth designing for. */
          neverEarned: Math.max(0, totalStudents - earners.length),
          levels: [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([level, students]) => ({ level, students })),
          achievements: ACHIEVEMENTS.map((achievement) => ({
            code: achievement.code,
            name: achievement.name,
            description: achievement.description,
            // `null` means "this one is a consecutive-day streak and cannot be
            // counted by aggregation", not "zero people have it".
            holders: holdersOf(achievement.code),
          })),
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to build the rewards overview');
      sendError(res, 500, 'Could not load the rewards overview. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Question performance (Milestone 15)
// ---------------------------------------------------------------------------

/**
 * Which questions are working, and which are not.
 *
 * The most useful administrative view the product did not have. A question nobody gets
 * right is usually mis-keyed or mis-tagged rather than genuinely hard, and until now
 * the only way to discover one was for a student to complain. Default sort is
 * `hardest`, because that is the list somebody would actually act on.
 *
 * Counted from every **submitted** attempt across all four surfaces, merged by summing
 * raw counts so a question used in both practice and a mock test reports one combined
 * figure. `minAnswered` keeps a single wrong answer from topping the table for ever;
 * the value in force comes back with the result rather than being an invisible
 * constant.
 */
router.get(
  '/admin/analytics/questions',
  requirePermission('analytics:read:any'),
  validate({ query: questionPerformanceQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const query = req.query as unknown as QuestionPerformanceQuery;
      const result = await getQuestionPerformance(query);

      sendSuccess(res, 200, {
        questions: result.rows,
        questionsWithData: result.questionsWithData,
        minAnswered: result.minAnswered,
        notes: result.notes,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: result.total,
          totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to build question performance');
      sendError(res, 500, 'Could not load question performance. Please try again.');
    }
  },
);

// ---------------------------------------------------------------------------
// Test performance (Milestone 15)
// ---------------------------------------------------------------------------

/**
 * Every paper with at least one attempt, mock tests and official exams together.
 *
 * `testResults()` has always shown one mock test's cohort in detail; what was missing
 * is the comparison across papers — which is how staff notice that one test is far
 * harder than the rest, or that a paper is being started and abandoned.
 *
 * Each row carries a **median** alongside the mean, because on a cohort of a few dozen
 * one student who submitted a blank moves the mean several points, and that is exactly
 * the case an invigilator wants to see rather than have smoothed away. `kind`
 * distinguishes a rehearsal from the Olympiad on every row, so the two can never be
 * read as the same thing.
 */
router.get(
  '/admin/analytics/tests',
  requirePermission('analytics:read:any'),
  ensureDb,
  async (_req: Request, res: Response) => {
    try {
      const { rows, notes } = await getTestPerformance();
      sendSuccess(res, 200, { tests: rows, notes });
    } catch (err) {
      logger.error({ err }, 'Failed to build test performance');
      sendError(res, 500, 'Could not load test performance. Please try again.');
    }
  },
);

export default router;
