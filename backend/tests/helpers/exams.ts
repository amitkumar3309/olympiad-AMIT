import type { Types } from 'mongoose';
import type { ClassLevel } from '../../src/lib/classLevels';
import type { Express } from 'express';
import { Exam, ExamAttempt, Question, Student, type ExamDocument } from '../../src/models';
import { snapshotOf } from '../../src/services/attemptSnapshot';
import { publishResults } from '../../src/services/examService';
import { gradeEntries } from '../../src/services/grading';
import { issueForExam } from '../../src/services/certificateService';
import { createPublishedQuestion, createTaxonomy } from './questions';

/**
 * Fixtures for the official exam and its certificates.
 *
 * The point of doing it this way rather than inserting `Result` rows directly is that
 * the *real* publication path is what computes ranks, percentiles and tiers — so a test
 * built on these helpers is checking the behaviour the product actually has, not a
 * hand-written approximation of it that could drift.
 */

export interface SeedExamOptions {
  classLevel?: ClassLevel;
  questionCount?: number;
  marksEach?: number;
  /** Defaults to a window that has already **closed**, so results can be published. */
  opensAt?: Date;
  closesAt?: Date;
  meritThresholdPercent?: number;
  distinctionThresholdPercent?: number;
  status?: 'draft' | 'published' | 'archived';
  examCode?: string;
}

let examSequence = 0;

/**
 * An official exam with real published questions on it.
 *
 * The default window is in the **past**, because most tests want an exam whose results
 * can be published. Tests about sitting pass an open window explicitly.
 */
export async function seedExam(
  app: Express,
  adminCookies: Record<string, string>,
  options: SeedExamOptions = {},
): Promise<{ exam: ExamDocument; questionIds: string[] }> {
  examSequence += 1;
  const count = options.questionCount ?? 3;
  const marks = options.marksEach ?? 10;
  const classLevel = options.classLevel ?? 'Class 9';

  const taxonomy = await createTaxonomy(app, adminCookies, {
    subject: `Exam Subject ${examSequence}`,
    topic: `Exam Topic ${examSequence}`,
  });

  const questionIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const question = await createPublishedQuestion(app, adminCookies, taxonomy, { classLevel });
    questionIds.push(question.id);
  }

  const opensAt = options.opensAt ?? new Date(Date.now() - 3 * 60 * 60 * 1000);
  const closesAt = options.closesAt ?? new Date(Date.now() - 60 * 60 * 1000);

  const exam = await Exam.create({
    title: `Olympiad Paper ${examSequence}`,
    examCode: options.examCode ?? `AMIT-TEST-${String(examSequence).padStart(3, '0')}`,
    classLevel,
    durationMinutes: 60,
    totalMarks: count * marks,
    opensAt,
    closesAt,
    status: options.status ?? 'published',
    meritThresholdPercent: options.meritThresholdPercent ?? 60,
    distinctionThresholdPercent: options.distinctionThresholdPercent ?? 85,
    questions: questionIds.map((id, index) => ({
      question: id as unknown as Types.ObjectId,
      order: index + 1,
      marks,
      negativeMarks: 0,
    })),
  });

  return { exam, questionIds };
}

/**
 * A **submitted** attempt for one student, with `correctCount` of the questions right.
 *
 * Built by snapshotting the real questions and then filling in the student's responses
 * from the snapshotted key, so the marks the grader produces are the marks the paper
 * genuinely offered — the same route a real sitting takes.
 */
export async function seedSubmittedAttempt(
  exam: ExamDocument,
  studentId: string,
  correctCount: number,
): Promise<void> {
  const account = await Student.findOne({ studentId });
  if (!account) throw new Error(`No account ${studentId}`);

  const ordered = [...exam.questions].sort((a, b) => a.order - b.order);
  const docs = await Question.find({ _id: { $in: ordered.map((r) => r.question) } });
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

  const entries = ordered.map((ref, index) => {
    const entry = snapshotOf(byId.get(String(ref.question))!, ref);
    if (index < correctCount) {
      // Answer correctly from the snapshotted key.
      if (entry.correctOptionKeys.length > 0) entry.selectedOptionKeys = [...entry.correctOptionKeys];
      else if (entry.booleanAnswer !== null) entry.booleanResponse = entry.booleanAnswer ?? null;
      else entry.numericResponse = entry.numericAnswer ?? null;
      entry.answeredAt = new Date();
    }
    return entry;
  });

  const totals = gradeEntries(entries);

  await ExamAttempt.create({
    exam: exam._id,
    student: account._id,
    status: 'submitted',
    questions: entries,
    totalQuestions: entries.length,
    maxMarks: entries.reduce((sum, e) => sum + e.marks, 0),
    durationMinutes: exam.durationMinutes,
    score: totals.score,
    correctCount: totals.correctCount,
    incorrectCount: totals.incorrectCount,
    unansweredCount: totals.unansweredCount,
    accuracy: totals.accuracy,
    startedAt: new Date(exam.opensAt),
    expiresAt: new Date(exam.closesAt),
    submittedAt: new Date(exam.closesAt.getTime() - 60_000),
    timeTakenSeconds: 600,
    submissionReason: 'manual',
  });
}

/** Runs the real publication + issuance path, exactly as the admin route does. */
export async function publishAndIssue(exam: ExamDocument, by = 'ADMIN_0001') {
  const publication = await publishResults(exam, by);
  const certificates = await issueForExam(exam, by);
  return { publication, certificates };
}
