import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';
import { DIFFICULTIES, type Difficulty } from './Question';
import { attemptAnswerSchema, type AttemptAnswerEntry } from './attemptAnswer';

/**
 * A student's self-directed practice attempt.
 *
 * ## Why this is not `ExamAttempt`
 *
 * `ExamAttempt` and `Result` describe **the official Olympiad**: one sitting, marked
 * and ranked, producing a published result and a certificate. Practice is unlimited,
 * self-selected by subject and topic, and must never influence a ranking. Reusing one
 * collection for both would mean every query about official performance had to
 * remember to exclude practice — and the first place that forgot would quietly award
 * a national rank for a practice run. They are separate collections on purpose (see
 * the ADR in DECISIONS.md).
 *
 * ## The answer-key snapshot
 *
 * Each served question carries a **copy** of what counts as correct, taken at the
 * moment it was served. That duplication is deliberate:
 *
 *  - An author may edit or archive a question while a session is open. Grading
 *    against the live document would then mark a student against a question they were
 *    never shown, or fail outright if the answer shape changed.
 *  - `revision` is recorded alongside it, so a review can tell the student the
 *    question has since been updated rather than silently showing new text.
 *
 * The cost is that the answer key now exists in a second collection, so the
 * projection discipline matters even more than for `Question`: **nothing in this
 * document may reach a client until the session is submitted.** `practiceService.ts`
 * builds two explicit views for that reason and never returns a raw document — the
 * same rule CLAUDE.md sets for the question endpoints.
 */

export const PRACTICE_STATUSES = ['in_progress', 'submitted', 'abandoned'] as const;
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number];

/**
 * One served question in a practice session.
 *
 * The shape moved to `models/attemptAnswer.ts` in Milestone 7, when mock-test
 * attempts needed exactly the same thing — one definition, so the shared grader in
 * `services/grading.ts` cannot disagree with either collection's answer key. This
 * alias is kept because "a practice question entry" is what the practice code calls
 * it, and renaming it would churn a working, tested module for nothing.
 */
export type PracticeQuestionEntry = AttemptAnswerEntry;

export interface PracticeSessionDocument extends Document {
  student: Types.ObjectId;
  status: PracticeStatus;
  /** What the student asked for. Kept so a history entry can describe itself. */
  filters: {
    subject?: Types.ObjectId | null;
    topic?: Types.ObjectId | null;
    difficulty?: Difficulty | null;
    /** The class the paper was drawn for — the student's own at start time. */
    classLevel: ClassLevel;
  };
  questions: PracticeQuestionEntry[];
  totalQuestions: number;
  /** Sum of `marks` across the served questions: the best possible score. */
  maxMarks: number;

  // --- Set at submission. ---
  /** Sum of `awardedMarks`. **May be negative** where negative marking applies. */
  score: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  /** Correct as a percentage of *answered*, not of served. 0 when none answered. */
  accuracy: number;

  startedAt: Date;
  submittedAt?: Date | null;
  /** Wall-clock seconds from start to submission. */
  timeTakenSeconds: number;
}

const practiceSessionSchema = new Schema<PracticeSessionDocument>({
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  status: { type: String, enum: PRACTICE_STATUSES, default: 'in_progress', index: true },
  filters: {
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    topic: { type: Schema.Types.ObjectId, ref: 'Topic', default: null },
    difficulty: { type: String, enum: DIFFICULTIES, default: null },
    classLevel: { type: String, enum: CLASS_LEVELS, required: true },
  },
  questions: { type: [attemptAnswerSchema], default: [] },
  totalQuestions: { type: Number, required: true, min: 1 },
  maxMarks: { type: Number, required: true, min: 0 },

  score: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  incorrectCount: { type: Number, default: 0 },
  unansweredCount: { type: Number, default: 0 },
  accuracy: { type: Number, default: 0 },

  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date, default: null },
  timeTakenSeconds: { type: Number, default: 0 },
});

// The history listing reads one student's sessions newest-first; the compound index
// covers both that and the "resume my open session" lookup.
practiceSessionSchema.index({ student: 1, startedAt: -1 });
practiceSessionSchema.index({ student: 1, status: 1, startedAt: -1 });
/**
 * Added in Milestone 15 for analytics, which reads one student's **submitted** sessions
 * in submission order.
 *
 * The `{student, status, startedAt}` index above narrows correctly but sorts by *start*
 * time, so a progress trend built on it would order sessions by when they were opened
 * rather than when they were finished — which for a session left open overnight is a
 * genuinely different sequence.
 */
practiceSessionSchema.index({ student: 1, status: 1, submittedAt: 1 });

/**
 * Deliberately **no TTL**, for the same reason as `StudentActivity`: a practice
 * history is a record of work the student did, and expiring it would erase evidence
 * of progress they can see on their dashboard.
 */
export const PracticeSession = mongoose.model<PracticeSessionDocument>('PracticeSession', practiceSessionSchema);
