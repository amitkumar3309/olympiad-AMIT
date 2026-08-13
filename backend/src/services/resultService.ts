import type { PipelineStage } from 'mongoose';
import { shiftDay, todayKey, type DayKey } from '../lib/competitionDay';
import { ExamAttempt, Result, Student, StudentActivity } from '../models';

/**
 * Published results and certificates, read from the real collections.
 *
 * Everything here queries `Result` and `ExamAttempt`, which **no route writes to
 * yet**. So every function truthfully returns "nothing published" today, and the
 * pages that call them render an explicit empty state.
 *
 * They are written as real queries rather than as hardcoded empties for the same
 * reason the dashboard's test panel is: the moment exam submission exists, the
 * result portal, the report and the certificate start working without anyone having
 * to remember to come back and un-fake them. What they replaced was much worse than
 * an empty state — the result portal invented a score, a national rank and a
 * percentile by hashing whatever student ID was typed into it.
 */

export interface PublishedResult {
  studentId: string;
  studentName: string | null;
  examId: string;
  score: number;
  totalMarks: number;
  accuracy: number;
  nationalRank: number | null;
  statewiseRank: number | null;
  percentile: number | null;
  xpEarned: number;
  badges: string[];
  submittedAt: Date | null;
}

export type ResultLookup =
  | { found: true; result: PublishedResult }
  /**
   * `no-account` and `not-published` are deliberately **not** distinguished in what
   * the route sends back to an unauthenticated caller — see the comment in
   * `results.routes.ts`. The distinction exists here so the route can log it.
   */
  | { found: false; reason: 'no-account' | 'not-published' };

/**
 * The published result for one student, or why there isn't one.
 *
 * Only `isPublished` results are ever returned: a result that exists but has not
 * been released must be invisible, or the portal becomes a way to read marks before
 * the organisers announce them.
 */
export async function findPublishedResult(studentId: string): Promise<ResultLookup> {
  const account = await Student.findOne({ studentId }).select('studentId fullName status');
  if (!account || account.status !== 'active') {
    return { found: false, reason: 'no-account' };
  }

  const result = await Result.findOne({ studentId, isPublished: true });
  if (!result) {
    return { found: false, reason: 'not-published' };
  }

  // Marks live on the attempt, ranks and badges on the result. Both are needed for
  // a complete card, and the attempt is the authority on what was actually scored.
  const attempt = await ExamAttempt.findOne({ studentId, status: 'Submitted' }).sort({ endTime: -1 });

  return {
    found: true,
    result: {
      studentId: result.studentId,
      studentName: account.fullName ?? null,
      examId: result.examId,
      score: attempt?.totalScore ?? 0,
      // `answers.length` is the paper's length as actually attempted. There is no
      // Exam entity carrying a total yet, so this is the honest denominator.
      totalMarks: attempt?.answers.length ?? 0,
      accuracy: attempt?.accuracy ?? 0,
      nationalRank: result.nationalRank ?? null,
      statewiseRank: result.stateRank ?? null,
      percentile: result.percentile ?? null,
      xpEarned: result.xpEarned,
      badges: result.badges,
      submittedAt: attempt?.endTime ?? null,
    },
  };
}

export interface EarnedCertificate {
  id: string;
  studentId: string;
  studentName: string | null;
  title: string;
  examId: string;
  issuedAt: Date | null;
  percentile: number | null;
}

/**
 * Certificates a student has actually earned.
 *
 * A certificate requires a **published result**, which is the whole point: the page
 * this feeds used to print "For outstanding participation and achievement" for
 * anybody who was signed in, dated today, with their student ID as the certificate
 * number. Nobody had earned anything.
 */
export async function findEarnedCertificates(studentId: string): Promise<EarnedCertificate[]> {
  const account = await Student.findOne({ studentId }).select('fullName status');
  if (!account || account.status !== 'active') return [];

  const results = await Result.find({ studentId, isPublished: true });

  return results.map((result) => ({
    id: `${result.studentId}-${result.examId}`,
    studentId: result.studentId,
    studentName: account.fullName ?? null,
    title: 'A.M.I.T Maths Olympiad — Participation & Achievement',
    examId: result.examId,
    // No issue date is stored on a Result yet; null rather than today's date, which
    // is what made the old certificate look genuine when it was not.
    issuedAt: null,
    percentile: result.percentile ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Administrative platform statistics
// ---------------------------------------------------------------------------

export interface DayCount {
  day: DayKey;
  count: number;
}

export interface AdminStats {
  registrationsByDay: DayCount[];
  activeStudentsByDay: DayCount[];
  totalStudents: number;
  totalActiveToday: number;
}

interface DayCountRow {
  _id: string;
  count: number;
}

/**
 * Real platform activity for the admin dashboard chart.
 *
 * This replaced a hardcoded "Weekly Accuracy Trend" of `[72, 78, 75, 82, 88, 90, 92]`
 * against Mon–Sun. It was at least labelled as sample data, but a labelled invention
 * is still an invention, and an accuracy trend cannot exist while no answer has ever
 * been scored. What an administrator can actually be shown, truthfully, is how many
 * accounts were created each day and how many students turned up each day — both of
 * which are real counts this platform holds.
 *
 * Days with no activity **are** zero-filled here, unlike the student-facing XP
 * chart. The difference is deliberate: for a platform-wide operational chart, "no
 * registrations on Tuesday" is itself a real, measured observation about the day,
 * whereas for one student a gap means only that nothing was recorded.
 */
export async function getAdminStats(days = 14, today: DayKey = todayKey()): Promise<AdminStats> {
  const firstDay = shiftDay(today, days - 1);
  const since = new Date(`${firstDay}T00:00:00.000Z`);
  since.setUTCMinutes(since.getUTCMinutes() - (5 * 60 + 30));

  /**
   * Entrants only. The bootstrap super administrator is a `Student` document
   * because that is where accounts live, but it never registered for anything —
   * it has no class, no school and no photo, and counting it would report one
   * more competitor than exists on a figure the owner reads as a headline.
   *
   * A *promoted* admin is deliberately still counted: it really did register as a
   * student and can still sit a paper (see the Milestone 3 ADR).
   */
  const entrantsOnly = { role: { $ne: 'superadmin' as const } };

  const registrationPipeline: PipelineStage[] = [
    { $match: { ...entrantsOnly, status: 'active', registeredAt: { $gte: since } } },
    {
      $group: {
        // Bucket by IST calendar day, matching `lib/competitionDay.ts`, so this
        // chart's days line up with the streak and XP days everywhere else.
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$registeredAt', timezone: '+05:30' },
        },
        count: { $sum: 1 },
      },
    },
  ];

  const activityPipeline: PipelineStage[] = [
    { $match: { occurredOn: { $gte: firstDay } } },
    { $group: { _id: { day: '$occurredOn', student: '$student' } } },
    { $group: { _id: '$_id.day', count: { $sum: 1 } } },
  ];

  const [registrationRows, activityRows, totalStudents] = await Promise.all([
    Student.aggregate<DayCountRow>(registrationPipeline),
    StudentActivity.aggregate<DayCountRow>(activityPipeline),
    Student.countDocuments({ ...entrantsOnly, status: 'active' }),
  ]);

  const axis: DayKey[] = Array.from({ length: days }, (_, i) => shiftDay(today, days - 1 - i));
  const toSeries = (rows: DayCountRow[]): DayCount[] => {
    const byDay = new Map(rows.map((row) => [row._id, row.count]));
    return axis.map((day) => ({ day, count: byDay.get(day) ?? 0 }));
  };

  const activeSeries = toSeries(activityRows);

  return {
    registrationsByDay: toSeries(registrationRows),
    activeStudentsByDay: activeSeries,
    totalStudents,
    totalActiveToday: activeSeries[activeSeries.length - 1]?.count ?? 0,
  };
}
