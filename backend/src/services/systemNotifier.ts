import type { Types } from 'mongoose';
import {
  Certificate,
  Result,
  Student,
  CERTIFICATE_TIER_TITLES,
  type ExamDocument,
  type MockTestDocument,
  type StudentDocument,
} from '../models';
import { logger } from '../lib/logger';
import { postSystemNotification } from './notificationService';
import {
  examPublishedCopy,
  mockTestPublishedCopy,
  passwordChangedCopy,
  resultsPublishedCopy,
  roleChangedCopy,
  statusChangedCopy,
} from '../lib/systemNotifications';

/**
 * Where a domain event becomes a notification.
 *
 * Deliberately a **separate layer** from both sides it joins:
 *
 *  - `notificationService.ts` knows about inboxes, preferences and email, and nothing
 *    about exams or certificates.
 *  - `examService.ts` and the routes know about exams, and nothing about notification
 *    copy or delivery policy.
 *
 * Without this file one of those two would have had to learn the other's job, and the
 * usual outcome is notification copy inlined in six routes. Every function here is
 * "when X happens, tell whom what", and every one of them is best-effort: a
 * notification is a consequence of something that already succeeded.
 */

/** Best-effort wrapper. A failed announcement must never fail the act it describes. */
async function attempt(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error({ err, what }, 'System notification failed');
  }
}

/**
 * Tells the class (or everybody) that an official paper has been scheduled.
 *
 * In-app only — see `SYSTEM_EVENT_DEFINITIONS`. Keyed on the exam id, so re-publishing
 * an exam after unpublishing it does not announce it a second time.
 *
 * Always class-targeted, because `Exam.classLevel` is required: an official paper is
 * set for one class, so an `all` broadcast would tell nine classes about a paper they
 * cannot sit.
 */
export async function notifyExamPublished(exam: ExamDocument): Promise<void> {
  await attempt('exam.published', () =>
    postSystemNotification({
      event: 'exam.published',
      copy: examPublishedCopy({
        title: exam.title,
        opensAt: exam.opensAt,
        closesAt: exam.closesAt,
        durationMinutes: exam.durationMinutes,
      }),
      target: { audience: 'class', classLevel: exam.classLevel },
      dedupeKey: `exam-published:${String(exam._id)}`,
    }),
  );
}

export async function notifyMockTestPublished(test: MockTestDocument): Promise<void> {
  await attempt('mocktest.published', () =>
    postSystemNotification({
      event: 'mocktest.published',
      copy: mockTestPublishedCopy({
        title: test.title,
        questionCount: test.questions.length,
        durationMinutes: test.durationMinutes,
      }),
      target: { audience: 'class', classLevel: test.classLevel },
      dedupeKey: `mocktest-published:${String(test._id)}`,
    }),
  );
}

export interface ResultsNotifyOutcome {
  notified: number;
  emailsQueued: number;
  skipped: number;
}

/**
 * Tells each candidate their result — and, in the same message, about the certificate
 * that was issued with it.
 *
 * **One notification, not two.** Certificates can only be issued by releasing an
 * exam's results, so a separate "your certificate is ready" notice would always
 * arrive in the same second as the result. Two notifications and two emails per
 * student for one event is twice the free-tier email budget for a worse experience,
 * and it invites the question "did I get two results?".
 *
 * It reads back the `Result` rows that were actually **written** rather than taking a
 * list from the caller. That is the whole reason this runs after publication instead
 * of inside it: what a student is told matches what the database will show them when
 * they follow the link. A notification derived from what we *meant* to write is a
 * notification that can disagree with the result portal.
 *
 * Per-student, so `postSystemNotification()` applies the `results` preference and the
 * per-event dedupe key — which is what makes re-releasing results safe.
 */
export async function notifyResultsReleased(exam: ExamDocument): Promise<ResultsNotifyOutcome> {
  const outcome: ResultsNotifyOutcome = { notified: 0, emailsQueued: 0, skipped: 0 };

  const results = await Result.find({ exam: exam._id, isPublished: true });
  if (results.length === 0) return outcome;

  const certificates = await Certificate.find({ exam: exam._id }).select('student tier revokedAt');
  const tierByStudent = new Map(
    certificates
      // A revoked certificate must not be advertised as ready to download.
      .filter((certificate) => !certificate.revokedAt)
      .map((certificate) => [String(certificate.student), certificate.tier]),
  );

  // One query for the cohort rather than one per row: a national sitting is the
  // largest fan-out in the product, and this is the loop it happens in.
  const students = await Student.find({ _id: { $in: results.map((r) => r.student) } }).select(
    'email status notificationPrefs classLevel',
  );
  const studentById = new Map(students.map((student) => [String(student._id), student]));

  for (const result of results) {
    const student = studentById.get(String(result.student));
    if (!student) {
      // The account was deleted between publication and this loop. Nothing to tell.
      outcome.skipped += 1;
      continue;
    }

    const tier = tierByStudent.get(String(result.student));

    try {
      const posted = await postSystemNotification({
        event: 'exam.results_published',
        copy: resultsPublishedCopy({
          examTitle: exam.title,
          score: result.score,
          maxMarks: result.maxMarks,
          percentage: result.percentage,
          rank: result.rank,
          totalCandidates: result.totalCandidates,
          certificateTier: tier ? CERTIFICATE_TIER_TITLES[tier] : null,
        }),
        target: { audience: 'student', student },
        dedupeKey: `results:${String(exam._id)}:${String(result.student)}`,
      });

      if (posted.posted) outcome.notified += 1;
      else outcome.skipped += 1;
      if (posted.emailQueued) outcome.emailsQueued += 1;
    } catch (err) {
      // Unreachable in practice — `postSystemNotification` does not throw — but one
      // student's notification must not abandon the rest of the cohort's.
      logger.error({ err, student: String(result.student) }, 'Failed to notify one candidate of their result');
      outcome.skipped += 1;
    }
  }

  return outcome;
}

/**
 * Account-change notices. All three are `security`, so they reach the student
 * regardless of preferences — see `emailAllowedFor()` for why that asymmetry exists.
 *
 * No `dedupeKey` on any of them: unlike publishing results, these events genuinely
 * recur. An account really can be suspended, reinstated and suspended again, and each
 * of those is news.
 */
export async function notifyAccountStatusChanged(student: StudentDocument, byLabel: string | null): Promise<void> {
  await attempt('account.status_changed', () =>
    postSystemNotification({
      event: 'account.status_changed',
      copy: statusChangedCopy({ status: student.status, byLabel }),
      target: { audience: 'student', student },
    }),
  );
}

export async function notifyAccountRoleChanged(student: StudentDocument): Promise<void> {
  await attempt('account.role_changed', () =>
    postSystemNotification({
      event: 'account.role_changed',
      copy: roleChangedCopy({ role: student.role }),
      target: { audience: 'student', student },
    }),
  );
}

export async function notifyPasswordChanged(student: StudentDocument): Promise<void> {
  await attempt('account.password_changed', () =>
    postSystemNotification({
      event: 'account.password_changed',
      copy: passwordChangedCopy(),
      target: { audience: 'student', student },
    }),
  );
}

/** Narrow helper for callers holding only an id. */
export async function notifyPasswordChangedById(studentId: Types.ObjectId): Promise<void> {
  const student = await Student.findById(studentId);
  if (student) await notifyPasswordChanged(student);
}
