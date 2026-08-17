import type { PipelineStage } from 'mongoose';
import { shiftDay, todayKey, type DayKey } from '../lib/competitionDay';
import { displayNameFor } from './leaderboardService';
import {
  Certificate,
  CERTIFICATE_TIER_TITLES,
  ExamAttempt,
  Result,
  Student,
  StudentActivity,
  type CertificateTier,
} from '../models';

/**
 * Published results and certificates, read from the real collections.
 *
 * **Real as of Milestone 13.** These used to query collections nothing wrote to, and
 * were written as live queries rather than hardcoded empties precisely so they would
 * start working the moment exam submission existed. That has now happened, and this
 * file was rewritten for the new shapes at the same time.
 *
 * What they replaced was much worse than an empty state: the result portal invented a
 * score, a national rank and a percentile by hashing whatever student ID was typed
 * into it. Everything below is now a real join over a **published** `Result`.
 *
 * ## Names are masked here, as they are everywhere else public (security audit)
 *
 * Both lookups are **unauthenticated by design** — a parent or a school checking a
 * child's result should not need an account — and both are keyed on `AMIT_xxxx`, of
 * which there are only ten thousand. They therefore had the shape the leaderboard was
 * carefully given a cap to avoid: anybody could walk the numbering and harvest every
 * entrant's **full legal name** beside their score and national rank. That the
 * leaderboard publishes "Ishaan V." while this published "Ishaan Verma" was not a
 * decision anybody took; it was two surfaces answering the same question differently.
 *
 * So both now publish through `displayNameFor()`, the single place this product
 * decides how much of a child's name goes on a public page. A parent still gets enough
 * to confirm they are looking at the right result — first name, last initial, the
 * student ID they typed in, and the marks. Widening it stays a one-line change and the
 * owner's call, exactly as it is for the leaderboard.
 *
 * A signed-in student's **own** certificate is unaffected: `GET /me/certificates` and
 * the PDF render from the certificate's own snapshot and carry the full name, because
 * that is the document in their hand.
 */

export interface PublishedResult {
  studentId: string;
  studentName: string | null;
  examId: string;
  examTitle: string;
  score: number;
  totalMarks: number;
  percentage: number;
  accuracy: number;
  rank: number;
  totalCandidates: number;
  percentile: number;
  submittedAt: Date | null;
  publishedAt: Date | null;
}

export type ResultLookup =
  | { found: true; result: PublishedResult }
  /**
   * `no-account` and `not-published` are deliberately **not** distinguished in what
   * the route sends back to an unauthenticated caller — see the comment in
   * `misc.routes.ts`. The distinction exists here so the route can log it.
   */
  | { found: false; reason: 'no-account' | 'not-published' };

/**
 * The published result for one student, or why there isn't one.
 *
 * Only `isPublished` rows are ever returned. A result that exists but has not been
 * released must be invisible, or the portal becomes a way to read marks before the
 * organisers announce them — and since a `Result` row is only created *by* the
 * publication step, an unpublished one is a deliberate state rather than an accident.
 */
export async function findPublishedResult(studentId: string): Promise<ResultLookup> {
  const account = await Student.findOne({ studentId }).select('_id studentId firstName lastName fullName status');
  if (!account || account.status !== 'active') {
    return { found: false, reason: 'no-account' };
  }

  const result = await Result.findOne({ student: account._id, isPublished: true })
    .sort({ publishedAt: -1 })
    .populate<{ exam: { _id: unknown; title: string; examCode: string } }>('exam', 'title examCode');

  if (!result) {
    return { found: false, reason: 'not-published' };
  }

  // The attempt is the authority on when the paper was actually sat.
  const attempt = await ExamAttempt.findById(result.attempt).select('submittedAt');

  return {
    found: true,
    result: {
      studentId: account.studentId,
      // Masked, like every other public surface. See the note at the top of this file.
      studentName: displayNameFor(account),
      examId: result.exam?.examCode ?? '',
      examTitle: result.exam?.title ?? '',
      score: result.score,
      totalMarks: result.maxMarks,
      percentage: result.percentage,
      accuracy: result.accuracy,
      rank: result.rank,
      totalCandidates: result.totalCandidates,
      percentile: result.percentile,
      submittedAt: attempt?.submittedAt ?? null,
      publishedAt: result.publishedAt ?? null,
    },
  };
}

export interface EarnedCertificate {
  id: string;
  certificateId: string;
  studentId: string;
  studentName: string | null;
  tier: CertificateTier;
  title: string;
  examTitle: string;
  examCode: string;
  percentage: number;
  rank: number;
  issuedAt: Date;
  revoked: boolean;
}

/**
 * Certificates a student has actually earned.
 *
 * A certificate requires a **published result for an official exam**, which is the
 * whole point: the page this feeds used to print "For outstanding participation and
 * achievement" for anybody who was signed in, dated today, with their student ID as
 * the certificate number. Nobody had earned anything.
 *
 * Every printable field is read from the certificate's own **snapshot**, not joined
 * from live documents — see `models/Certificate.ts` for why that matters.
 */
export async function findEarnedCertificates(studentId: string): Promise<EarnedCertificate[]> {
  // Only the id and the status are needed: the printable fields all come from each
  // certificate's own snapshot, which is the rule certificates were built on.
  const account = await Student.findOne({ studentId }).select('_id status');
  if (!account || account.status !== 'active') return [];

  const certificates = await Certificate.find({ student: account._id }).sort({ issuedAt: -1 });

  return certificates.map((certificate) => ({
    id: String(certificate._id),
    certificateId: certificate.certificateId,
    studentId,
    /**
     * Masked, because this listing is public. The certificate's own **snapshot** is
     * still the source — masking it here rather than reading the live account keeps
     * this listing agreeing with the PDF about *who* it belongs to, and a later name
     * correction cannot change a certificate already in somebody's hands.
     *
     * The full name is served by `GET /me/certificates` and printed on the PDF, both
     * of which require being the holder.
     */
    studentName: displayNameFor({ fullName: certificate.studentName }),
    tier: certificate.tier,
    title: CERTIFICATE_TIER_TITLES[certificate.tier],
    examTitle: certificate.examTitle,
    examCode: certificate.examCode,
    percentage: certificate.percentage,
    rank: certificate.rank,
    issuedAt: certificate.issuedAt,
    revoked: certificate.revokedAt !== null && certificate.revokedAt !== undefined,
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
