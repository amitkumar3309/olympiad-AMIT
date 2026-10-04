import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { CLASS_LEVELS, type ClassLevel } from '../lib/classLevels';
import type { DayKey } from '../lib/competitionDay';
import { DIFFICULTIES, type Difficulty } from './Question';

/**
 * One day's challenge question for one class.
 *
 * ## Why this collection exists at all
 *
 * Before Milestone 8 the daily challenge was computed on the fly: hash the day key,
 * `skip` that many questions into the published bank, serve whatever came out. That
 * is deterministic *given a fixed bank* — and the bank is not fixed. Publishing a
 * single new question changes the total the modulus is taken against, so it silently
 * changes which question "today" resolves to, mid-day, for everybody. It also made
 * "what was the challenge on the 10th?" unanswerable, because the answer depended on
 * a bank that had since moved.
 *
 * A challenge is therefore **pinned to a document** the first time it is needed, and
 * every later read — and every attempt — refers to that document. The consequences
 * are the point: today's question cannot change under a student who is looking at it,
 * two students in the same class are provably answering the same thing, and the
 * history is a record rather than a re-derivation.
 *
 * ## Scheduled versus automatic
 *
 * `source` records how the day got its question:
 *
 *  - `scheduled` — staff chose it in advance through the admin UI. This is the
 *    intended path for a competition that wants to curate the run-up to an exam.
 *  - `automatic` — nobody scheduled one, so the deterministic pick was materialised
 *    on first request. This keeps the feature working every day without requiring
 *    somebody to sit down and schedule 365 questions, which is the realistic
 *    alternative to it quietly not working on a Sunday.
 *
 * Both are the same shape, because from the student's side they are the same thing.
 *
 * ## Since Milestone 30 this is the Daily Quiz
 *
 * The launch brief's Daily Quiz **is** this collection, upgraded rather than duplicated:
 *
 *  - **One document per class per day, still** — the unique index below is untouched. A
 *    quiz for a *range* of classes ("Classes 9–12") is one document per class in the
 *    range, all sharing a `groupId` and identical `content`. That is why overlapping
 *    ranges on one day are impossible without a single extra line of code: the index
 *    that has always refused a second challenge for one class on one day refuses them.
 *  - **`content` is a snapshot of the question**, taken when the quiz was scheduled, with
 *    each option given an opaque id. The quiz is served, marked and revealed from it, so
 *    an author editing the bank question afterwards changes nothing about a quiz already
 *    set — and the bank question itself is never published to practice until the answer
 *    has been revealed (see `questionService`).
 *  - **No more automatic days.** A day nobody scheduled has no quiz (PLAN.md Q4): an
 *    automatic pick came from the published practice bank, whose solutions a student can
 *    already read, which is not acceptable once a day carries a prize. `source:
 *    'automatic'` survives on documents written before that, as a record.
 *
 * Documents from before Milestone 30 have no `groupId`, range or `content`; a reader
 * treats such a document as its own one-class group and does not serve it as a quiz.
 */

export const CHALLENGE_SOURCES = ['scheduled', 'automatic'] as const;
export type ChallengeSource = (typeof CHALLENGE_SOURCES)[number];

/** One option as the quiz serves it: the bank's key (for grading), an opaque id, the text. */
export interface QuizOption {
  /** The bank option's key — what the shared grader compares. Never sent to a student. */
  key: string;
  /** Opaque, random per quiz. The only identifier a student ever sees or sends. */
  id: string;
  text: string;
}

/**
 * The question as it was when the quiz was scheduled. The answer key lives here
 * (`correctOptionKey`) and in each submission's own snapshot; **no student view may read
 * either before the reveal** — `services/dailyChallengeService.ts` is the only reader.
 */
export interface QuizContent {
  questionText: string;
  options: QuizOption[];
  correctOptionKey: string;
  /** The worked solution — required, because unlocking it the next day is the point (R6). */
  solution: string;
  difficulty: Difficulty;
  /** The chapter's name at scheduling time, for display. */
  topicName: string | null;
  /** Which revision of the bank question was copied. */
  revision: number;
}

export interface DailyChallengeDocument extends Document {
  /** Competition-local calendar day (`YYYY-MM-DD`) — see `lib/competitionDay.ts`. */
  day: DayKey;
  classLevel: ClassLevel;
  question: Types.ObjectId;
  source: ChallengeSource;
  /** Shared by every class document of one quiz. Absent before Milestone 30. */
  groupId?: Types.ObjectId | null;
  /** The quiz's class range, as class numbers (3–12). Absent before Milestone 30. */
  classMin?: number | null;
  classMax?: number | null;
  /** The question snapshot the quiz is served from. Absent before Milestone 30. */
  content?: QuizContent | null;
  /**
   * The marks on offer, snapshotted when the day was pinned.
   *
   * Copied rather than read from the live `Question` for the same reason the attempt
   * snapshots its answer key: re-pricing a question must not change what a challenge
   * was worth to the students who already answered it, nor make two students on the
   * same day disagree about the score they were playing for.
   */
  marks: number;
  createdBy?: Types.ObjectId | null;
  createdByLabel?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const quizOptionSchema = new Schema<QuizOption>(
  {
    key: { type: String, required: true },
    id: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false },
);

const quizContentSchema = new Schema<QuizContent>(
  {
    questionText: { type: String, required: true },
    options: { type: [quizOptionSchema], default: [] },
    correctOptionKey: { type: String, required: true },
    solution: { type: String, required: true },
    difficulty: { type: String, enum: DIFFICULTIES, required: true },
    topicName: { type: String, default: null },
    revision: { type: Number, default: 1 },
  },
  { _id: false },
);

const dailyChallengeSchema = new Schema<DailyChallengeDocument>(
  {
    day: { type: String, required: true },
    classLevel: { type: String, enum: CLASS_LEVELS, required: true },
    question: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    source: { type: String, enum: CHALLENGE_SOURCES, required: true, default: 'scheduled' },
    marks: { type: Number, required: true, min: 0 },
    // Milestone 30 — all three optional, so a document from before them still loads.
    groupId: { type: Schema.Types.ObjectId, default: null },
    classMin: { type: Number, default: null, min: 3, max: 12 },
    classMax: { type: Number, default: null, min: 3, max: 12 },
    content: { type: quizContentSchema, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    createdByLabel: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * **One challenge per day per class**, enforced by the database rather than by the
 * code that looks first.
 *
 * This is what makes the automatic path safe: two students opening the dashboard at
 * the same moment both compute the same question (the pick is deterministic) and both
 * try to pin it. One insert wins, the other gets a duplicate-key error and re-reads
 * the winner's document — so the day still ends up with exactly one challenge, with
 * no transaction and no lock.
 */
dailyChallengeSchema.index({ day: 1, classLevel: 1 }, { unique: true });

// The admin listing reads a date range for one class, newest day first.
dailyChallengeSchema.index({ classLevel: 1, day: -1 });

// A quiz is addressed by its group: every class document of it, at once.
dailyChallengeSchema.index({ groupId: 1 });

// "Is this bank question already a quiz?" — asked before scheduling and before publishing.
dailyChallengeSchema.index({ question: 1, day: 1 });

/**
 * No TTL. A challenge is the question a cohort was actually set on a given day, and
 * an attempt refers to it — expiring it would orphan the attempts and erase what the
 * student was answering. Same reasoning as `AuditLog` and the attempt collections.
 */
export const DailyChallenge = mongoose.model<DailyChallengeDocument>('DailyChallenge', dailyChallengeSchema);
