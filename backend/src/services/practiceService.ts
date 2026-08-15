import { Types, type PipelineStage } from 'mongoose';
import type { ClassLevel } from '../lib/classLevels';
import { ApiError } from '../lib/ApiError';
import {
  PracticeSession,
  Question,
  STUDENT_VISIBLE_STATUSES,
  type Difficulty,
  type PracticeQuestionEntry,
  type PracticeSessionDocument,
  type QuestionDocument,
  type QuestionStatus,
} from '../models';
import { refView, studentQuestionView } from './questionView';
import { gradeEntries, gradeEntry, isAnswered, type GradeOutcome } from './grading';

/**
 * The marking rules moved to `services/grading.ts` in Milestone 7, when mock tests
 * needed the same ones. Re-exported here because this module is where practice code
 * (and the practice suite) already reaches for them, and because there must remain
 * exactly one implementation — not a second copy that could disagree.
 */
export { gradeEntry, isAnswered, type GradeOutcome };

/**
 * The Practice Zone: everything about choosing, serving, grading and reviewing a
 * self-directed practice session.
 *
 * ## Answer integrity
 *
 * This is the security-critical part, and the rule is narrow enough to state in one
 * line: **the correct answer for a question leaves this module only after the session
 * containing it has been submitted.**
 *
 * Three things enforce it rather than one:
 *
 *  1. `sessionInProgressView()` is built from `studentQuestionView` — the same
 *     answer-stripped projection the question endpoints use — and adds only the
 *     student's own responses. There is no code path in it that can read
 *     `correctOptionKeys`, `numericAnswer`, `booleanAnswer` or `solution`.
 *  2. `sessionReviewView()`, the only function that reveals an answer, refuses to run
 *     on a session that is not `submitted`. It throws rather than returning a
 *     partially-revealed shape, so a caller cannot get half of it by accident.
 *  3. Grading happens here, server-side, against the snapshot in the session
 *     document. The browser is never given what it would need to mark itself, so
 *     there is nothing to tamper with — the previous practice page marked answers in
 *     the client and therefore had to ship the whole answer key to do it.
 *
 * Tests assert the forbidden field names are absent from every in-progress response.
 */

// ---------------------------------------------------------------------------
// What is available to practise
// ---------------------------------------------------------------------------

export interface TopicAvailability {
  topicId: string;
  topicName: string;
  questionCount: number;
  difficulties: Difficulty[];
}

export interface SubjectAvailability {
  subjectId: string;
  subjectName: string;
  questionCount: number;
  difficulties: Difficulty[];
  topics: TopicAvailability[];
}

interface AvailabilityRow {
  _id: { subject: Types.ObjectId; topic: Types.ObjectId };
  questionCount: number;
  difficulties: Difficulty[];
  subjectName?: string;
  topicName?: string;
}

/**
 * Real counts of published questions for one class, grouped subject → topic.
 *
 * Every number the picker shows comes from here, so an empty bank produces an empty
 * list and the page says so. Archived subjects and topics are excluded even when
 * published questions still reference them — they are not on offer.
 */
function availabilityPipeline(classLevel: ClassLevel): PipelineStage[] {
  return [
    { $match: { classLevel, status: { $in: [...STUDENT_VISIBLE_STATUSES] } } },
    {
      $group: {
        _id: { subject: '$subject', topic: '$topic' },
        questionCount: { $sum: 1 },
        difficulties: { $addToSet: '$difficulty' },
      },
    },
    { $lookup: { from: 'subjects', localField: '_id.subject', foreignField: '_id', as: 'subjectDoc' } },
    { $unwind: '$subjectDoc' },
    { $match: { 'subjectDoc.status': 'active' } },
    { $lookup: { from: 'topics', localField: '_id.topic', foreignField: '_id', as: 'topicDoc' } },
    { $unwind: '$topicDoc' },
    { $match: { 'topicDoc.status': 'active' } },
    {
      $project: {
        questionCount: 1,
        difficulties: 1,
        subjectName: '$subjectDoc.name',
        topicName: '$topicDoc.name',
      },
    },
  ];
}

const DIFFICULTY_ORDER: readonly Difficulty[] = ['Easy', 'Medium', 'Hard'];

function sortDifficulties(values: Difficulty[]): Difficulty[] {
  return DIFFICULTY_ORDER.filter((level) => values.includes(level));
}

export async function getPracticeAvailability(classLevel: ClassLevel): Promise<SubjectAvailability[]> {
  const rows = await Question.aggregate<AvailabilityRow>(availabilityPipeline(classLevel));

  // Folded in memory rather than with a second `$group`, because the shape wanted is
  // nested and the row count here is bounded by subjects × topics.
  const bySubject = new Map<string, SubjectAvailability>();

  for (const row of rows) {
    const subjectId = String(row._id.subject);
    let subject = bySubject.get(subjectId);
    if (!subject) {
      subject = {
        subjectId,
        subjectName: row.subjectName ?? 'Unnamed subject',
        questionCount: 0,
        difficulties: [],
        topics: [],
      };
      bySubject.set(subjectId, subject);
    }

    subject.questionCount += row.questionCount;
    for (const level of row.difficulties) {
      if (!subject.difficulties.includes(level)) subject.difficulties.push(level);
    }
    subject.topics.push({
      topicId: String(row._id.topic),
      topicName: row.topicName ?? 'Unnamed topic',
      questionCount: row.questionCount,
      difficulties: sortDifficulties(row.difficulties),
    });
  }

  const subjects = [...bySubject.values()];
  for (const subject of subjects) {
    subject.difficulties = sortDifficulties(subject.difficulties);
    subject.topics.sort((a, b) => b.questionCount - a.questionCount || a.topicName.localeCompare(b.topicName));
  }
  subjects.sort((a, b) => b.questionCount - a.questionCount || a.subjectName.localeCompare(b.subjectName));

  return subjects;
}

// ---------------------------------------------------------------------------
// Starting a session
// ---------------------------------------------------------------------------

export interface StartPracticeInput {
  student: Types.ObjectId;
  classLevel: ClassLevel;
  subjectId?: string;
  topicId?: string;
  difficulty?: Difficulty;
  questionCount: number;
}

/**
 * Spelled out rather than using a Mongoose helper type, for the same reason
 * `users.routes.ts` does it: this filter is assembled from user-supplied query values,
 * and a narrow type is what guarantees only these fields — never an operator object
 * smuggled in from the request — can reach Mongo. `status` carries the literal union
 * so it cannot widen to an arbitrary string.
 */
interface QuestionFilter {
  classLevel: ClassLevel;
  status: { $in: QuestionStatus[] };
  /**
   * Real `ObjectId`s, **not** strings. This matters: `find()` and `countDocuments()`
   * cast a 24-character hex string to an ObjectId for you, but `$match` inside an
   * `aggregate()` pipeline does **not** — it compares the raw BSON types and silently
   * matches nothing. Passing a string here therefore produced a session with zero
   * questions, which then failed the model's `min: 1` and surfaced as a 500. Caught by
   * the "narrows by topic" test.
   */
  subject?: Types.ObjectId;
  topic?: Types.ObjectId;
  difficulty?: Difficulty;
}

/** The answer-key snapshot for one served question. */
function snapshotOf(question: QuestionDocument): PracticeQuestionEntry {
  return {
    question: question._id as Types.ObjectId,
    revision: question.revision,
    type: question.type,
    marks: question.marks,
    negativeMarks: question.negativeMarks,
    correctOptionKeys: question.options.filter((option) => option.isCorrect).map((option) => option.key),
    booleanAnswer: question.booleanAnswer ?? null,
    numericAnswer: question.numericAnswer ?? null,
    tolerance: question.tolerance ?? null,
    acceptedAnswers: [...(question.acceptedAnswers ?? [])],
    selectedOptionKeys: [],
    numericResponse: null,
    booleanResponse: null,
    answeredAt: null,
    isCorrect: null,
    awardedMarks: null,
  };
}

/**
 * Draws a paper and opens a session.
 *
 * Questions are picked with `$sample`, so two sessions over the same filters are not
 * the same paper — the opposite of the daily challenge, which is deliberately
 * deterministic. Practice is meant to be repeatable with fresh questions.
 *
 * Throws `409` when the filters match nothing published, rather than opening an empty
 * session the student could not do anything with.
 */
export async function startPracticeSession(input: StartPracticeInput): Promise<PracticeSessionDocument> {
  const filter: QuestionFilter = {
    classLevel: input.classLevel,
    status: { $in: [...STUDENT_VISIBLE_STATUSES] },
  };
  // Safe to construct: the request schema has already required 24-character hex.
  if (input.subjectId) filter.subject = new Types.ObjectId(input.subjectId);
  if (input.topicId) filter.topic = new Types.ObjectId(input.topicId);
  if (input.difficulty) filter.difficulty = input.difficulty;

  const available = await Question.countDocuments(filter);
  if (available === 0) {
    throw new ApiError(409, 'No published questions match that selection yet. Try a different subject or topic.');
  }

  // Fewer questions than asked for is fine and is not an error: the student gets
  // however many really exist, and the response reports the count.
  const size = Math.min(input.questionCount, available);
  const sampled = await Question.aggregate<QuestionDocument>([{ $match: filter }, { $sample: { size } }]);

  const questions = sampled.map(snapshotOf);

  // Belt and braces. `countDocuments` just said there were some, so an empty sample
  // means the two queries disagreed — which is exactly what the ObjectId-casting bug
  // noted above did. Refusing here keeps that class of mistake a clear 409 rather than
  // a confusing 500 out of the model's `min: 1` validator.
  if (questions.length === 0) {
    throw new ApiError(409, 'No published questions match that selection yet. Try a different subject or topic.');
  }

  return PracticeSession.create({
    student: input.student,
    status: 'in_progress',
    filters: {
      subject: input.subjectId ?? null,
      topic: input.topicId ?? null,
      difficulty: input.difficulty ?? null,
      classLevel: input.classLevel,
    },
    questions,
    totalQuestions: questions.length,
    maxMarks: questions.reduce((sum, entry) => sum + entry.marks, 0),
    startedAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Recording an answer
// ---------------------------------------------------------------------------

export interface AnswerInput {
  selectedOptionKeys?: string[];
  numericResponse?: number | null;
  textResponse?: string | null;
  booleanResponse?: boolean | null;
}

/**
 * Writes one response into an open session.
 *
 * Only the field belonging to the question's own type is stored, so a `numeric`
 * response cannot be smuggled onto a multiple-choice question and quietly ignored at
 * grading time. Unknown option keys are rejected: silently dropping them would let a
 * student appear to have answered while storing nothing.
 */
export function applyAnswer(
  session: PracticeSessionDocument,
  questionId: string,
  answer: AnswerInput,
  servedOptionKeys: readonly string[],
  at = new Date(),
): void {
  if (session.status !== 'in_progress') {
    throw new ApiError(409, 'This practice session has already been submitted.');
  }

  const entry = session.questions.find((candidate) => String(candidate.question) === questionId);
  if (!entry) {
    throw new ApiError(404, 'That question is not part of this practice session.');
  }

  if (entry.type === 'single_choice' || entry.type === 'multiple_choice') {
    const keys = answer.selectedOptionKeys ?? [];
    const unknown = keys.filter((key) => !servedOptionKeys.includes(key));
    if (unknown.length > 0) {
      throw new ApiError(400, 'That option does not belong to this question.');
    }
    if (entry.type === 'single_choice' && keys.length > 1) {
      throw new ApiError(400, 'This question takes a single answer.');
    }
    // De-duplicated so a repeated key cannot make a set comparison fail at grading.
    entry.selectedOptionKeys = [...new Set(keys)];
  } else if (entry.type === 'true_false') {
    entry.booleanResponse = answer.booleanResponse ?? null;
  } else if (entry.type === 'fill_blank') {
    // Stored exactly as typed. Normalisation belongs to the grader, so what the
    // student wrote stays readable on review — including when it was marked wrong.
    entry.textResponse = answer.textResponse ?? null;
  } else {
    entry.numericResponse = answer.numericResponse ?? null;
  }

  // Clearing an answer is legitimate — a student may un-answer a question — so
  // `answeredAt` tracks whether a response currently stands, not whether one was
  // ever given.
  entry.answeredAt = isAnswered(entry) ? at : null;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grades and closes a session.
 *
 * Refuses a session that is not open, so a second submission cannot re-roll the
 * score, and — more importantly — cannot be used to change an answer after the
 * correct one has already been revealed by the review view.
 */
export function gradeSession(session: PracticeSessionDocument, at = new Date()): void {
  if (session.status !== 'in_progress') {
    throw new ApiError(409, 'This practice session has already been submitted.');
  }

  const totals = gradeEntries(session.questions);

  session.score = totals.score;
  session.correctCount = totals.correctCount;
  session.incorrectCount = totals.incorrectCount;
  session.unansweredCount = totals.unansweredCount;
  session.accuracy = totals.accuracy;
  session.status = 'submitted';
  session.submittedAt = at;
  session.timeTakenSeconds = Math.max(0, Math.round((at.getTime() - session.startedAt.getTime()) / 1000));
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** The question ids a session served, in order. */
export function servedQuestionIds(session: PracticeSessionDocument): string[] {
  return session.questions.map((entry) => String(entry.question));
}

type QuestionsById = Map<string, QuestionDocument>;

function summaryOf(session: PracticeSessionDocument) {
  return {
    id: String(session._id),
    status: session.status,
    totalQuestions: session.totalQuestions,
    maxMarks: session.maxMarks,
    answeredCount: session.questions.filter(isAnswered).length,
    startedAt: session.startedAt,
    submittedAt: session.submittedAt ?? null,
    filters: {
      subject: refView(session.filters.subject),
      topic: refView(session.filters.topic),
      difficulty: session.filters.difficulty ?? null,
      classLevel: session.filters.classLevel,
    },
  };
}

/**
 * The **in-progress** view: what the student may see while still working.
 *
 * Question content comes from `studentQuestionView`, so the options carry no
 * `isCorrect` and there is no `solution`, `numericAnswer` or `booleanAnswer`
 * anywhere. The only things added are the student's own saved responses. Nothing
 * here reads the answer-key snapshot — that is the point, and it is why this is a
 * separate function from the review view rather than one with a flag.
 */
export function sessionInProgressView(session: PracticeSessionDocument, questions: QuestionsById) {
  return {
    ...summaryOf(session),
    questions: session.questions.map((entry, index) => {
      const question = questions.get(String(entry.question));
      return {
        order: index + 1,
        ...(question ? studentQuestionView(question) : { id: String(entry.question), unavailable: true }),
        // The student's own answer, echoed back so a resumed session is not blank.
        response: {
          selectedOptionKeys: entry.selectedOptionKeys,
          numericResponse: entry.numericResponse ?? null,
          textResponse: entry.textResponse ?? null,
          booleanResponse: entry.booleanResponse ?? null,
          answered: isAnswered(entry),
        },
      };
    }),
  };
}

/**
 * The **review** view: the graded session, with correct answers and explanations.
 *
 * Throws unless the session has been submitted. That check lives here, next to the
 * data it protects, rather than only in the route — a future second caller cannot
 * reveal an answer by forgetting to check the status first.
 *
 * `solution` is the author's worked explanation and is shown when the question has
 * one; publishing requires it, so in practice it is always present for a question a
 * student could have been served. `revisionChanged` tells the student the question has
 * been edited since they answered it, rather than silently showing different text.
 */
export function sessionReviewView(session: PracticeSessionDocument, questions: QuestionsById) {
  if (session.status !== 'submitted') {
    throw new ApiError(409, 'This practice session has not been submitted yet.');
  }

  return {
    ...summaryOf(session),
    score: session.score,
    correctCount: session.correctCount,
    incorrectCount: session.incorrectCount,
    unansweredCount: session.unansweredCount,
    accuracy: session.accuracy,
    timeTakenSeconds: session.timeTakenSeconds,
    questions: session.questions.map((entry, index) => {
      const question = questions.get(String(entry.question));
      return {
        order: index + 1,
        ...(question ? studentQuestionView(question) : { id: String(entry.question), unavailable: true }),
        response: {
          selectedOptionKeys: entry.selectedOptionKeys,
          numericResponse: entry.numericResponse ?? null,
          textResponse: entry.textResponse ?? null,
          booleanResponse: entry.booleanResponse ?? null,
          answered: isAnswered(entry),
        },
        // --- Revealed only here, only after submission. ---
        outcome: {
          isCorrect: entry.isCorrect ?? null,
          awardedMarks: entry.awardedMarks ?? 0,
          marks: entry.marks,
          negativeMarks: entry.negativeMarks,
        },
        correctAnswer: {
          optionKeys: entry.correctOptionKeys,
          booleanAnswer: entry.booleanAnswer ?? null,
          numericAnswer: entry.numericAnswer ?? null,
          tolerance: entry.tolerance ?? null,
          acceptedAnswers: entry.acceptedAnswers ?? [],
        },
        explanation: question?.solution ?? null,
        revisionChanged: question ? question.revision !== entry.revision : false,
      };
    }),
  };
}

/** A one-line history entry. Carries no answers and no per-question detail. */
export function sessionHistoryView(session: PracticeSessionDocument) {
  return {
    id: String(session._id),
    status: session.status,
    totalQuestions: session.totalQuestions,
    maxMarks: session.maxMarks,
    score: session.status === 'submitted' ? session.score : null,
    accuracy: session.status === 'submitted' ? session.accuracy : null,
    correctCount: session.status === 'submitted' ? session.correctCount : null,
    timeTakenSeconds: session.status === 'submitted' ? session.timeTakenSeconds : null,
    startedAt: session.startedAt,
    submittedAt: session.submittedAt ?? null,
    filters: {
      subject: refView(session.filters.subject),
      topic: refView(session.filters.topic),
      difficulty: session.filters.difficulty ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Loads the served questions for a session, keyed by id.
 *
 * Populated for the taxonomy names the views display. A question that has since been
 * hard-deleted simply goes missing from the map and the views mark it `unavailable`
 * rather than throwing — deleting a published question is already blocked, so this is
 * a belt-and-braces path, not an expected one.
 */
export async function loadSessionQuestions(session: PracticeSessionDocument): Promise<QuestionsById> {
  const docs = await Question.find({ _id: { $in: session.questions.map((entry) => entry.question) } })
    .populate('subject', 'name slug')
    .populate('topic', 'name slug')
    .populate('subtopic', 'name slug');

  return new Map(docs.map((doc) => [String(doc._id), doc]));
}

/**
 * Loads one session **owned by this student**.
 *
 * Ownership is part of the query rather than checked afterwards, so there is no
 * window in which another student's session document is in hand. A session belonging
 * to someone else is indistinguishable from one that does not exist, which is also
 * what stops the id from being used to probe for other people's sessions.
 */
export async function findOwnSession(
  sessionId: string,
  student: Types.ObjectId,
): Promise<PracticeSessionDocument | null> {
  return PracticeSession.findOne({ _id: sessionId, student });
}
