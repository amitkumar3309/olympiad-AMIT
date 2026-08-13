import type { PipelineStage } from 'mongoose';
import {
  DailyChallengeAttempt,
  GalleryItem,
  MockTest,
  MockTestAttempt,
  Notification,
  PracticeSession,
  Question,
  Student,
  StudentActivity,
} from '../models';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';
import { shiftDay, todayKey, type DayKey } from '../lib/competitionDay';

/**
 * Platform-wide analytics for the administrator (Milestone 12).
 *
 * ## The rule this file exists to keep
 *
 * **Every number here is counted from a collection.** Not one is estimated,
 * extrapolated, seeded or defaulted to something plausible. Milestone 5 spent an
 * entire follow-up pass deleting invented figures — an accuracy trend for exams
 * nobody had sat, a percentile for results that did not exist — and the lesson was
 * that a labelled invention is still an invention. So where there is no data, this
 * returns **zero or an empty array**, and the page says so.
 *
 * That is why there is no "engagement score", no "growth rate" and no projection:
 * each would be a number the database cannot be asked for.
 *
 * ## What is deliberately absent
 *
 * Nothing here reads `Result` or `ExamAttempt`. They belong to the *official* exam,
 * which is not built and which nothing writes — an "average exam score" panel would
 * be permanently zero at best and fabricated at worst. Scored data that genuinely
 * exists lives in `MockTestAttempt`, and that is what the assessment figures below
 * are drawn from.
 */

export interface DayCount {
  day: DayKey;
  count: number;
}

export interface ClassBreakdownRow {
  classLevel: ClassLevel;
  students: number;
  activeStudents: number;
  xp: number;
}

export interface PlatformAnalytics {
  generatedAt: Date;
  accounts: {
    total: number;
    verified: number;
    unverified: number;
    active: number;
    suspended: number;
    blocked: number;
    deactivated: number;
    admins: number;
  };
  engagement: {
    /** Distinct students with at least one activity row, ever. */
    everActive: number;
    activeLast7: number;
    activeLast30: number;
    registrationsByDay: DayCount[];
    activeStudentsByDay: DayCount[];
  };
  content: {
    questionsTotal: number;
    questionsPublished: number;
    questionsDraft: number;
    mockTestsTotal: number;
    mockTestsPublished: number;
    galleryPublished: number;
    announcementsPublished: number;
  };
  assessment: {
    practiceSessionsSubmitted: number;
    mockAttemptsSubmitted: number;
    /** Mean percentage across submitted mock attempts. `null` when none exist. */
    mockAveragePercent: number | null;
    dailyChallengeAttempts: number;
    dailyChallengeCorrect: number;
  };
  xp: {
    awardedTotal: number;
    /** Students holding any XP at all. The denominator for "average" below. */
    earners: number;
    averagePerEarner: number | null;
  };
  byClass: ClassBreakdownRow[];
}

/** IST midnight for a day key, as the UTC instant the activity log buckets on. */
function startOfDay(day: DayKey): Date {
  const at = new Date(`${day}T00:00:00.000Z`);
  at.setUTCMinutes(at.getUTCMinutes() - (5 * 60 + 30));
  return at;
}

/**
 * Entrants only, everywhere a student is counted.
 *
 * The bootstrap super admin is a `Student` document but never registered for
 * anything, so counting it would report one more competitor than exists — on
 * figures the owner reads as headlines. A *promoted* admin is counted, because it
 * really did register (Milestone 3 ADR).
 */
const ENTRANTS = { role: { $ne: 'superadmin' as const } };

function toSeries(rows: Array<{ _id: string; count: number }>, axis: DayKey[]): DayCount[] {
  const byDay = new Map(rows.map((row) => [row._id, row.count]));
  return axis.map((day) => ({ day, count: byDay.get(day) ?? 0 }));
}

/**
 * Distinct **entrants** with activity, optionally since a day.
 *
 * A plain `distinct('student')` over the activity log is wrong here, and visibly so:
 * it counted 12 active students against 11 registered ones. The log outlives the
 * accounts it points at — a deleted account leaves its rows behind — and it makes no
 * distinction between an entrant and a staff account. Joining to `students` and
 * filtering the same way every other figure on this page does is what keeps the
 * numbers a consistent set rather than several unrelated counts.
 */
async function activeEntrantCount(since?: DayKey): Promise<number> {
  const pipeline: PipelineStage[] = [
    ...(since ? [{ $match: { occurredOn: { $gte: since } } } as PipelineStage] : []),
    { $group: { _id: '$student' } },
    { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'account' } },
    // `$unwind` without `preserveNullAndEmptyArrays` is what drops orphaned rows
    // whose account no longer exists.
    { $unwind: '$account' },
    { $match: { 'account.role': { $ne: 'superadmin' } } },
    { $count: 'total' },
  ];
  const rows = await StudentActivity.aggregate<{ total: number }>(pipeline);
  return rows[0]?.total ?? 0;
}

export async function getPlatformAnalytics(days = 30, today: DayKey = todayKey()): Promise<PlatformAnalytics> {
  const firstDay = shiftDay(today, days - 1);
  const since = startOfDay(firstDay);
  const axis: DayKey[] = Array.from({ length: days }, (_, i) => shiftDay(today, days - 1 - i));

  // `shiftDay(key, n)` returns the key **n days before** `key` — a negative value
  // moves *forward*. Getting that backwards silently produced a future cut-off that
  // matched nothing, so both windows read zero however busy the platform was.
  const last7 = shiftDay(today, 6);
  const last30 = shiftDay(today, 29);

  const registrationPipeline: PipelineStage[] = [
    { $match: { ...ENTRANTS, registeredAt: { $gte: since } } },
    {
      $group: {
        // Bucketed by IST calendar day, matching `lib/competitionDay.ts`, so this
        // axis lines up with the streak and XP days everywhere else in the product.
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$registeredAt', timezone: '+05:30' } },
        count: { $sum: 1 },
      },
    },
  ];

  const activityByDayPipeline: PipelineStage[] = [
    { $match: { occurredOn: { $gte: firstDay } } },
    { $group: { _id: { day: '$occurredOn', student: '$student' } } },
    { $group: { _id: '$_id.day', count: { $sum: 1 } } },
  ];

  const xpPipeline: PipelineStage[] = [
    { $group: { _id: '$student', xp: { $sum: '$xpAwarded' } } },
    { $match: { xp: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: '$xp' }, earners: { $sum: 1 } } },
  ];

  const mockScorePipeline: PipelineStage[] = [
    // `maxMarks` is the best possible score for that attempt, and `> 0` guards the
    // division — a paper worth nothing would otherwise divide by zero. `score` may
    // be negative where negative marking applies, which is a real average and is
    // reported as such rather than clamped.
    { $match: { status: 'submitted', maxMarks: { $gt: 0 } } },
    { $group: { _id: null, avg: { $avg: { $multiply: [{ $divide: ['$score', '$maxMarks'] }, 100] } } } },
  ];

  const byClassStudentsPipeline: PipelineStage[] = [
    { $match: { ...ENTRANTS, classLevel: { $ne: null } } },
    { $group: { _id: '$classLevel', students: { $sum: 1 } } },
  ];

  const byClassActivityPipeline: PipelineStage[] = [
    // The activity log carries no class, so it is joined to the account that owns
    // it. Bounded by the cohort this product is designed for (a few hundred);
    // carries the same scale note as the leaderboard.
    { $group: { _id: '$student', xp: { $sum: '$xpAwarded' } } },
    { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'account' } },
    { $unwind: '$account' },
    { $match: { 'account.role': { $ne: 'superadmin' }, 'account.classLevel': { $ne: null } } },
    { $group: { _id: '$account.classLevel', activeStudents: { $sum: 1 }, xp: { $sum: '$xp' } } },
  ];

  const [
    total,
    verified,
    active,
    suspended,
    blocked,
    deactivated,
    admins,
    everActive,
    activeLast7,
    activeLast30,
    registrationRows,
    activityRows,
    questionsTotal,
    questionsPublished,
    questionsDraft,
    mockTestsTotal,
    mockTestsPublished,
    galleryPublished,
    announcementsPublished,
    practiceSessionsSubmitted,
    mockAttemptsSubmitted,
    mockScoreRows,
    dailyChallengeAttempts,
    dailyChallengeCorrect,
    xpRows,
    classStudentRows,
    classActivityRows,
  ] = await Promise.all([
    Student.countDocuments(ENTRANTS),
    Student.countDocuments({ ...ENTRANTS, isEmailVerified: true }),
    Student.countDocuments({ ...ENTRANTS, status: 'active' }),
    Student.countDocuments({ ...ENTRANTS, status: 'suspended' }),
    Student.countDocuments({ ...ENTRANTS, status: 'blocked' }),
    Student.countDocuments({ ...ENTRANTS, status: 'deactivated' }),
    Student.countDocuments({ role: 'admin' }),
    activeEntrantCount(),
    activeEntrantCount(last7),
    activeEntrantCount(last30),
    Student.aggregate<{ _id: string; count: number }>(registrationPipeline),
    StudentActivity.aggregate<{ _id: string; count: number }>(activityByDayPipeline),
    Question.countDocuments({}),
    Question.countDocuments({ status: 'published' }),
    Question.countDocuments({ status: 'draft' }),
    MockTest.countDocuments({}),
    MockTest.countDocuments({ status: 'published' }),
    GalleryItem.countDocuments({ status: 'published' }),
    Notification.countDocuments({ isPublished: true }),
    PracticeSession.countDocuments({ status: 'submitted' }),
    MockTestAttempt.countDocuments({ status: 'submitted' }),
    MockTestAttempt.aggregate<{ _id: null; avg: number }>(mockScorePipeline),
    DailyChallengeAttempt.countDocuments({}),
    // Correctness lives on the embedded served-question snapshot, not on the
    // attempt — `answer` is one `attemptAnswer` subdocument, so this is a dotted
    // path rather than a top-level field.
    DailyChallengeAttempt.countDocuments({ 'answer.isCorrect': true }),
    StudentActivity.aggregate<{ _id: null; total: number; earners: number }>(xpPipeline),
    Student.aggregate<{ _id: ClassLevel; students: number }>(byClassStudentsPipeline),
    StudentActivity.aggregate<{ _id: ClassLevel; activeStudents: number; xp: number }>(byClassActivityPipeline),
  ]);

  const xpTotals = xpRows[0] ?? { total: 0, earners: 0 };
  const studentsByClass = new Map(classStudentRows.map((row) => [row._id, row.students]));
  const activityByClass = new Map(classActivityRows.map((row) => [row._id, row]));

  return {
    generatedAt: new Date(),
    accounts: {
      total,
      verified,
      unverified: total - verified,
      active,
      suspended,
      blocked,
      deactivated,
      admins,
    },
    engagement: {
      everActive,
      activeLast7,
      activeLast30,
      registrationsByDay: toSeries(registrationRows, axis),
      activeStudentsByDay: toSeries(activityRows, axis),
    },
    content: {
      questionsTotal,
      questionsPublished,
      questionsDraft,
      mockTestsTotal,
      mockTestsPublished,
      galleryPublished,
      announcementsPublished,
    },
    assessment: {
      practiceSessionsSubmitted,
      mockAttemptsSubmitted,
      // `null`, not 0: "no papers have been sat" and "everybody scored zero" are
      // different facts, and a 0% average would read as the second.
      mockAveragePercent: mockScoreRows[0] ? Math.round(mockScoreRows[0].avg * 10) / 10 : null,
      dailyChallengeAttempts,
      dailyChallengeCorrect,
    },
    xp: {
      awardedTotal: xpTotals.total,
      earners: xpTotals.earners,
      averagePerEarner: xpTotals.earners > 0 ? Math.round(xpTotals.total / xpTotals.earners) : null,
    },
    // Every offered class appears, including those with nobody in them — an absent
    // row reads as missing data, whereas a zero is a fact about the cohort.
    byClass: CLASS_LEVELS.map((classLevel) => ({
      classLevel,
      students: studentsByClass.get(classLevel) ?? 0,
      activeStudents: activityByClass.get(classLevel)?.activeStudents ?? 0,
      xp: activityByClass.get(classLevel)?.xp ?? 0,
    })),
  };
}
