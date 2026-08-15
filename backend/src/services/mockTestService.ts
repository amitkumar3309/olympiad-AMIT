import { Types } from 'mongoose';
import { ApiError } from '../lib/ApiError';
import { logger } from '../lib/logger';
import type { ClassLevel } from '../lib/classLevels';
import {
  MockTest,
  MockTestAttempt,
  Question,
  STUDENT_VISIBLE_TEST_STATUSES,
  type AttemptAnswerEntry,
  type MockTestAttemptDocument,
  type MockTestDocument,
  type MockTestQuestionRef,
  type MockTestStatus,
  type QuestionDocument,
  type SubmissionReason,
} from '../models';
import type { Actor } from './taxonomyService';
import { snapshotOf } from './attemptSnapshot';
import { gradeEntries, isAnswered } from './grading';
import { refView, studentQuestionView } from './questionView';

/**
 * Mock tests: authoring the paper, and sitting it.
 *
 * ## The two properties this module exists to hold
 *
 * **1. The server owns the clock.** A client is told when its attempt expires so it
 * can show a countdown, and that is the only role it has in timing. `deadlineFor()`
 * computes `expiresAt` once, when the attempt is created; every later decision —
 * whether an answer may be saved, when the attempt is graded, what time is recorded —
 * reads that stored value and the server's own `Date`. No request body anywhere in
 * this module carries a time. A student whose clock is wrong, or who edits the
 * countdown in a debugger, gains nothing: their late answer is refused by
 * `applyAttemptAnswer()` and their paper is graded as at the deadline, not as at the
 * moment the server noticed it had passed.
 *
 * **2. An attempt is graded exactly once.** `finalizeAttempt()` closes it with an
 * update conditional on `status: 'in_progress'`, so two concurrent submissions cannot
 * both grade it — one wins, and the other is answered with the stored result. It
 * reports which of those happened (`graded`), which is what lets the route award XP
 * and write an audit entry only for the submission that really did something.
 *
 * ## Disclosure
 *
 * A mock test decides for itself when a student may see a score and when they may see
 * the answer key (`resultDisplay` / `reviewPolicy`). `disclosureFor()` is the only
 * place those settings are interpreted, and `attemptReviewView()` — the only function
 * in this module that reveals a correct answer — refuses to run unless it says so.
 * That mirrors the Practice Zone's `sessionReviewView()`: the check lives next to the
 * data it protects, not only in the route, so a second caller cannot leak an answer
 * key by forgetting to ask first.
 */

// ---------------------------------------------------------------------------
// Authoring: assembling a paper
// ---------------------------------------------------------------------------

export interface MockTestContentInput {
  title: string;
  description?: string | null;
  instructions?: string | null;
  classLevel: ClassLevel;
  questions: Array<{ question: string; marks: number; negativeMarks: number }>;
  durationMinutes: number;
  availableFrom?: string | null;
  availableTo?: string | null;
  maxAttempts: number;
  resultDisplay: MockTestDocument['resultDisplay'];
  reviewPolicy: MockTestDocument['reviewPolicy'];
}

/**
 * Resolves the chosen questions against the bank and prices them for this paper.
 *
 * Three rules, all of which would otherwise be silent data problems discovered by a
 * student mid-test:
 *
 *  - **Every question must exist.** A dangling id would produce a paper that cannot
 *    be served, and the failure would surface at start time rather than authoring time.
 *  - **Every question must be for the test's own class.** A Class 9 paper containing
 *    a Class 12 question is not a thing anybody meant to build, and the bank's
 *    `classLevel` is the only thing that says who a question is for.
 *  - **Negative marking cannot exceed the marks on offer**, per question. The bank
 *    enforces this for a question's own values; a test may override both, so it has to
 *    be re-checked against the overridden pair rather than the original.
 *
 * `requirePublished` is imposed when a test is *published*, not when it is drafted:
 * assembling a paper from questions still in review is a legitimate way to work, but
 * offering it to students is not.
 */
async function assembleQuestions(
  input: MockTestContentInput,
  options: { requirePublished: boolean },
): Promise<{ refs: MockTestQuestionRef[]; totalMarks: number }> {
  const ids = input.questions.map((entry) => entry.question);
  const docs = await Question.find({ _id: { $in: ids } }).select('classLevel status');
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

  const refs: MockTestQuestionRef[] = [];
  let totalMarks = 0;

  input.questions.forEach((entry, index) => {
    const question = byId.get(entry.question);
    if (!question) {
      throw ApiError.badRequest('One of the selected questions no longer exists in the bank.');
    }
    if (question.classLevel !== input.classLevel) {
      throw ApiError.badRequest(
        `A question for ${question.classLevel} cannot be used on a ${input.classLevel} test.`,
      );
    }
    if (options.requirePublished && question.status !== 'published') {
      throw ApiError.conflict(
        'Every question on the test must be published before the test itself can be published.',
      );
    }
    if (entry.negativeMarks > entry.marks) {
      throw ApiError.badRequest('Negative marking cannot exceed the marks a question is worth.');
    }

    refs.push({
      question: new Types.ObjectId(entry.question),
      // Order is the order the author sent them in. Stored explicitly so the paper is
      // reproducible even if the array is later rewritten by a partial update.
      order: index + 1,
      marks: entry.marks,
      negativeMarks: entry.negativeMarks,
    });
    totalMarks += entry.marks;
  });

  return { refs, totalMarks };
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

// ---------------------------------------------------------------------------
// Authoring: listing
// ---------------------------------------------------------------------------

export interface ListMockTestsOptions {
  page: number;
  limit: number;
  status?: MockTestStatus;
  classLevel?: ClassLevel;
  search?: string;
}

/**
 * Escapes a user-supplied string so a title search is matched literally.
 *
 * Same reason as the question bank and the admin student search: an unescaped `.*`
 * would match every test rather than none, and a pathological pattern is a cheap way
 * to make the database do expensive work.
 */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface MockTestFilter {
  status?: MockTestStatus;
  classLevel?: ClassLevel;
  title?: RegExp;
}

export async function listMockTests(
  options: ListMockTestsOptions,
): Promise<{ tests: MockTestDocument[]; total: number }> {
  const filter: MockTestFilter = {};
  if (options.status) filter.status = options.status;
  if (options.classLevel) filter.classLevel = options.classLevel;
  if (options.search) filter.title = new RegExp(escapeRegex(options.search), 'i');

  const [tests, total] = await Promise.all([
    MockTest.find(filter)
      // `_id` breaks ties so pagination is stable: without it two tests created in the
      // same millisecond can swap pages, showing one twice and the other never.
      .sort({ createdAt: -1, _id: -1 })
      .skip((options.page - 1) * options.limit)
      .limit(options.limit),
    MockTest.countDocuments(filter),
  ]);

  return { tests, total };
}

export async function createMockTest(input: MockTestContentInput, actor: Actor): Promise<MockTestDocument> {
  const { refs, totalMarks } = await assembleQuestions(input, { requirePublished: false });

  return MockTest.create({
    title: input.title,
    description: input.description ?? null,
    instructions: input.instructions ?? null,
    classLevel: input.classLevel,
    questions: refs,
    durationMinutes: input.durationMinutes,
    totalMarks,
    availableFrom: toDate(input.availableFrom),
    availableTo: toDate(input.availableTo),
    maxAttempts: input.maxAttempts,
    resultDisplay: input.resultDisplay,
    reviewPolicy: input.reviewPolicy,
    status: 'draft',
    createdBy: actor.id,
    createdByLabel: actor.label,
    updatedBy: actor.id,
    updatedByLabel: actor.label,
  });
}

export async function findMockTestById(id: string): Promise<MockTestDocument> {
  const test = await MockTest.findById(id);
  if (!test) throw ApiError.notFound('No mock test exists with that id.');
  return test;
}

/**
 * Edits a test.
 *
 * **The paper and the clock are frozen once somebody has sat it.** Everything else —
 * the title, the description, the instructions, the availability window, the
 * disclosure settings, the attempt limit — stays editable for the whole life of the
 * test, because those are exactly the things an administrator legitimately needs to
 * change after publishing (extend a window, release results, fix a typo in the
 * instructions).
 *
 * Changing the questions or the duration is different. Existing attempts snapshot
 * their own paper, so their marks would remain correct — but the test's `totalMarks`
 * and the meaning of "this test" would silently change underneath results already
 * recorded against it, and two students' scores would no longer be comparable even
 * though they sit in the same results table. Refusing is the honest answer: to change
 * the paper, publish a new test.
 */
export async function updateMockTest(
  id: string,
  input: MockTestContentInput,
  actor: Actor,
): Promise<MockTestDocument> {
  const test = await findMockTestById(id);
  const attempts = await MockTestAttempt.countDocuments({ test: test._id });

  const paperChanged =
    input.questions.length !== test.questions.length ||
    input.questions.some((entry, index) => {
      const existing = test.questions[index];
      return (
        !existing ||
        String(existing.question) !== entry.question ||
        existing.marks !== entry.marks ||
        existing.negativeMarks !== entry.negativeMarks
      );
    });

  if (attempts > 0 && paperChanged) {
    throw ApiError.conflict(
      'Students have already sat this test, so its questions and marks can no longer be changed. Publish a new test instead.',
    );
  }
  if (attempts > 0 && input.durationMinutes !== test.durationMinutes) {
    throw ApiError.conflict(
      'Students have already sat this test, so its duration can no longer be changed. Publish a new test instead.',
    );
  }

  const { refs, totalMarks } = await assembleQuestions(input, {
    // A published test must keep meeting the publishing rules through an edit.
    requirePublished: test.status === 'published',
  });

  test.title = input.title;
  test.description = input.description ?? null;
  test.instructions = input.instructions ?? null;
  test.classLevel = input.classLevel;
  test.questions = refs;
  test.durationMinutes = input.durationMinutes;
  test.totalMarks = totalMarks;
  test.availableFrom = toDate(input.availableFrom);
  test.availableTo = toDate(input.availableTo);
  test.maxAttempts = input.maxAttempts;
  test.resultDisplay = input.resultDisplay;
  test.reviewPolicy = input.reviewPolicy;
  test.updatedBy = actor.id;
  test.updatedByLabel = actor.label;

  await test.save();
  return test;
}

/**
 * Publishes, unpublishes or archives a test.
 *
 * Publishing is the moment a paper becomes sittable, so it is the moment the stricter
 * rules apply: every question must be published, and a disclosure setting of
 * `after_close` must have a closing time to be relative to (otherwise the author has
 * scheduled a release that can never arrive).
 *
 * Unpublishing back to `draft` withdraws it from the student listing and refuses new
 * attempts, but deliberately does **not** interfere with an attempt already under way:
 * a student half-way through a paper when an administrator pulls it still gets to
 * finish and be marked. Discarding their work because of an editorial decision taken
 * while they were writing would be the worse failure.
 */
export async function changeMockTestStatus(
  id: string,
  status: MockTestStatus,
  actor: Actor,
): Promise<MockTestDocument> {
  const test = await findMockTestById(id);

  if (status === 'published') {
    if (test.questions.length === 0) {
      throw ApiError.conflict('A test needs at least one question before it can be published.');
    }
    if (test.resultDisplay === 'after_close' && !test.availableTo) {
      throw ApiError.conflict('This test shows results after it closes, so it needs a closing time.');
    }
    if (test.reviewPolicy === 'after_close' && !test.availableTo) {
      throw ApiError.conflict('This test releases answers after it closes, so it needs a closing time.');
    }

    const unpublished = await Question.countDocuments({
      _id: { $in: test.questions.map((entry) => entry.question) },
      status: { $ne: 'published' },
    });
    if (unpublished > 0) {
      throw ApiError.conflict(
        `${unpublished} question(s) on this test are not published yet. Publish them first, or remove them from the test.`,
      );
    }
  }

  test.status = status;
  test.publishedAt = status === 'published' ? new Date() : test.publishedAt ?? null;
  test.archivedAt = status === 'archived' ? new Date() : null;
  test.updatedBy = actor.id;
  test.updatedByLabel = actor.label;

  await test.save();
  return test;
}

/**
 * Hard-deletes a test.
 *
 * Only ever permitted for one that has never been published and that nobody has sat —
 * the same rule the question bank applies, for the same reason: once a paper has been
 * offered to students, the record that it existed is part of the record of their
 * results. Unpublishing and archiving are the removal paths for everything else.
 */
export async function deleteMockTest(id: string): Promise<void> {
  const test = await findMockTestById(id);

  if (test.publishedAt) {
    throw ApiError.conflict('This test has been published before, so it can be archived but not deleted.');
  }
  const attempts = await MockTestAttempt.countDocuments({ test: test._id });
  if (attempts > 0) {
    throw ApiError.conflict('Students have attempted this test, so it can be archived but not deleted.');
  }

  await MockTest.deleteOne({ _id: test._id });
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type UnavailableReason = 'not-published' | 'not-open-yet' | 'closed' | 'attempts-used' | 'wrong-class';

export interface Availability {
  open: boolean;
  reason: UnavailableReason | null;
  opensAt: Date | null;
  closesAt: Date | null;
}

/**
 * Whether a test may be *started* right now, ignoring the student.
 *
 * A published test with no window is open indefinitely, which is the sensible reading
 * of "no window" and what makes the two date fields optional in the first place.
 */
export function availabilityOf(test: MockTestDocument, now = new Date()): Availability {
  const opensAt = test.availableFrom ?? null;
  const closesAt = test.availableTo ?? null;

  let reason: UnavailableReason | null = null;
  if (!STUDENT_VISIBLE_TEST_STATUSES.includes(test.status)) reason = 'not-published';
  else if (opensAt && now < opensAt) reason = 'not-open-yet';
  else if (closesAt && now >= closesAt) reason = 'closed';

  return { open: reason === null, reason, opensAt, closesAt };
}

/**
 * The least time worth starting a paper with.
 *
 * Without this, a student arriving 20 seconds before the window shuts would be handed
 * an attempt that expires almost immediately and counts against their attempt limit —
 * a worse outcome than being told plainly that they are too late.
 */
const MIN_START_SECONDS = 60;

/**
 * The hard deadline for an attempt started now.
 *
 * The lower of "the duration the author set" and "when the test closes". The clamp is
 * what stops a paper started five minutes before closing from running an hour past the
 * end of the window; the trade-off is that a late starter gets less time, which is
 * why `MIN_START_SECONDS` refuses the degenerate case rather than serving it.
 */
export function deadlineFor(test: MockTestDocument, startedAt: Date): Date {
  const byDuration = new Date(startedAt.getTime() + test.durationMinutes * 60_000);
  if (test.availableTo && test.availableTo < byDuration) return test.availableTo;
  return byDuration;
}

// ---------------------------------------------------------------------------
// Starting an attempt
// ---------------------------------------------------------------------------

export interface StartAttemptInput {
  test: MockTestDocument;
  student: Types.ObjectId;
  studentClassLevel: ClassLevel;
  now?: Date;
}

export interface StartAttemptResult {
  attempt: MockTestAttemptDocument;
  /** False when an unfinished attempt was resumed rather than a new one created. */
  created: boolean;
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Starts a new attempt, or resumes the one already open.
 *
 * Resuming is checked first and on purpose: a student who reloads, loses their
 * connection or closes the tab must come back to the *same* attempt with the same
 * deadline, not be handed a fresh clock. That is also what stops "start again" from
 * being a way to buy more time.
 *
 * The attempt number is derived from a count, which two simultaneous requests could
 * read identically — so the unique index on `{test, student, attemptNumber}` is what
 * actually decides, and a duplicate-key error here means the other request won and its
 * attempt is the one to resume.
 */
export async function startAttempt(input: StartAttemptInput): Promise<StartAttemptResult> {
  const now = input.now ?? new Date();
  const { test } = input;

  if (test.classLevel !== input.studentClassLevel) {
    throw ApiError.forbidden(`This test is set for ${test.classLevel}, so you cannot sit it.`);
  }

  // An attempt already under way is resumed whatever the window now says: the student
  // was admitted legitimately, and closing the test mid-paper must not void their work.
  const open = await MockTestAttempt.findOne({ test: test._id, student: input.student, status: 'in_progress' });
  if (open) return { attempt: open, created: false };

  const availability = availabilityOf(test, now);
  if (!availability.open) {
    throw ApiError.conflict(
      availability.reason === 'not-open-yet'
        ? 'This test has not opened yet.'
        : availability.reason === 'closed'
          ? 'This test has closed.'
          : 'This test is not available.',
    );
  }

  if (availability.closesAt) {
    const secondsLeft = Math.floor((availability.closesAt.getTime() - now.getTime()) / 1000);
    if (secondsLeft < MIN_START_SECONDS) {
      throw ApiError.conflict('There is not enough time left in the window to start this test.');
    }
  }

  const used = await MockTestAttempt.countDocuments({ test: test._id, student: input.student });
  if (used >= test.maxAttempts) {
    throw ApiError.conflict(
      test.maxAttempts === 1
        ? 'You have already used your attempt at this test.'
        : `You have used all ${test.maxAttempts} attempts at this test.`,
    );
  }

  // Serve the paper in the author's order.
  const ordered = [...test.questions].sort((a, b) => a.order - b.order);
  const docs = await Question.find({ _id: { $in: ordered.map((ref) => ref.question) } });
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));

  const questions: AttemptAnswerEntry[] = [];
  for (const ref of ordered) {
    const question = byId.get(String(ref.question));
    // Everyone sitting a test must sit the same paper, so a missing question is a
    // refusal rather than a short paper. Hard-deleting a published question is already
    // blocked by the question service, so this is a belt-and-braces path.
    if (!question) {
      logger.error({ testId: String(test._id), questionId: String(ref.question) }, 'Mock test references a missing question');
      throw ApiError.conflict('This test is not ready to be sat. Please tell your administrator.');
    }
    questions.push(snapshotOf(question, ref));
  }

  try {
    const attempt = await MockTestAttempt.create({
      test: test._id,
      student: input.student,
      attemptNumber: used + 1,
      status: 'in_progress',
      questions,
      totalQuestions: questions.length,
      maxMarks: questions.reduce((sum, entry) => sum + entry.marks, 0),
      durationMinutes: test.durationMinutes,
      startedAt: now,
      expiresAt: deadlineFor(test, now),
    });
    return { attempt, created: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const raced = await MockTestAttempt.findOne({ test: test._id, student: input.student, status: 'in_progress' });
      if (raced) return { attempt: raced, created: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

export interface AttemptAnswerInput {
  selectedOptionKeys?: string[];
  numericResponse?: number | null;
  textResponse?: string | null;
  booleanResponse?: boolean | null;
}

/**
 * Writes one response into an open attempt.
 *
 * Refuses on two grounds, and the second is the point of the whole design: the attempt
 * must still be `in_progress`, **and the deadline must not have passed**. An answer
 * arriving one second after `expiresAt` is not stored — not stored late, not stored
 * quietly, not stored and then ignored at grading. That is what "the backend enforces
 * timing" has to mean to be worth anything, because a client is free to keep its
 * countdown running as long as it likes.
 *
 * Only the field belonging to the question's own type is written, so a numeric
 * response cannot be smuggled onto a multiple-choice question and silently ignored at
 * grading time. Unknown option keys are rejected rather than dropped: silently
 * discarding one would let a student believe they had answered while nothing was
 * stored.
 */
export function applyAttemptAnswer(
  attempt: MockTestAttemptDocument,
  questionId: string,
  answer: AttemptAnswerInput,
  servedOptionKeys: readonly string[],
  now = new Date(),
): void {
  if (attempt.status !== 'in_progress') {
    throw ApiError.conflict('This attempt has already been submitted.');
  }
  if (now >= attempt.expiresAt) {
    throw ApiError.conflict('Your time for this test is up, so this answer was not saved.');
  }

  const entry = attempt.questions.find((candidate) => String(candidate.question) === questionId);
  if (!entry) {
    throw ApiError.notFound('That question is not part of this attempt.');
  }

  if (entry.type === 'single_choice' || entry.type === 'multiple_choice') {
    const keys = answer.selectedOptionKeys ?? [];
    const unknown = keys.filter((key) => !servedOptionKeys.includes(key));
    if (unknown.length > 0) {
      throw ApiError.badRequest('That option does not belong to this question.');
    }
    if (entry.type === 'single_choice' && keys.length > 1) {
      throw ApiError.badRequest('This question takes a single answer.');
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

  // Clearing an answer is legitimate, so this tracks whether a response currently
  // stands rather than whether one was ever given.
  entry.answeredAt = isAnswered(entry) ? now : null;
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

export interface FinalizeResult {
  attempt: MockTestAttemptDocument;
  /** True only for the call that actually transitioned the attempt to `submitted`. */
  graded: boolean;
}

/**
 * Grades and closes an attempt. Idempotent, and safe against a race.
 *
 * The write is conditional on the attempt still being `in_progress`, so of two
 * concurrent submissions — the student pressing Submit at the same moment their
 * countdown hits zero, say — exactly one transitions it. The other gets `graded:
 * false` and the stored result, so it cannot award a second lot of XP, write a second
 * audit entry, or re-grade answers that have already been marked.
 *
 * `submittedAt` is clamped to the deadline. Grading a paper submitted (or noticed)
 * after time as though it had been handed in late would record a time taken longer
 * than the test allowed; the deadline is the latest anything can have happened.
 */
export async function finalizeAttempt(
  attempt: MockTestAttemptDocument,
  reason: SubmissionReason,
  at = new Date(),
): Promise<FinalizeResult> {
  if (attempt.status !== 'in_progress') {
    return { attempt, graded: false };
  }

  const totals = gradeEntries(attempt.questions);
  const submittedAt = at < attempt.expiresAt ? at : attempt.expiresAt;
  const timeTakenSeconds = Math.max(0, Math.round((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000));

  const updated = await MockTestAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'in_progress' },
    {
      $set: {
        questions: attempt.questions,
        score: totals.score,
        correctCount: totals.correctCount,
        incorrectCount: totals.incorrectCount,
        unansweredCount: totals.unansweredCount,
        accuracy: totals.accuracy,
        status: 'submitted',
        submittedAt,
        timeTakenSeconds,
        submissionReason: reason,
      },
    },
    { returnDocument: 'after' },
  );

  if (updated) return { attempt: updated, graded: true };

  // Lost the race. The stored document is the authority — never the in-memory copy,
  // whose grades were computed by a call that did not win.
  const stored = await MockTestAttempt.findById(attempt._id);
  if (!stored) throw ApiError.notFound('That attempt no longer exists.');
  return { attempt: stored, graded: false };
}

/**
 * Closes an attempt whose time has run out.
 *
 * This is the automatic submission, and it is deliberately **lazy**: it runs when
 * something touches the attempt (the student returning to it, the student listing
 * their attempts, an administrator opening the results table) rather than from a
 * scheduler, because the deployment target is Vercel's free tier and there is no cron
 * to run one (see DECISIONS.md).
 *
 * Laziness costs nothing that matters, because grading uses `expiresAt` and not the
 * moment of discovery: an attempt finalised a week late is marked exactly as it would
 * have been marked the second the clock ran out. What it does mean is that an attempt
 * abandoned by a student who never comes back stays `in_progress` until somebody
 * looks — so the two surfaces that report on attempts sweep before they read.
 */
export async function finalizeIfExpired(
  attempt: MockTestAttemptDocument,
  now = new Date(),
): Promise<FinalizeResult> {
  if (attempt.status !== 'in_progress' || now < attempt.expiresAt) {
    return { attempt, graded: false };
  }
  return finalizeAttempt(attempt, 'time_expired', attempt.expiresAt);
}

/**
 * Finalises every expired attempt for one test, so a results table cannot show a
 * paper as still in progress hours after it could possibly have been written.
 *
 * Scoped to a single test, which bounds the work to that test's cohort. Failures are
 * logged rather than thrown: a sweep is housekeeping, and it must not stop an
 * administrator from reading the results that *are* complete.
 */
export async function sweepExpiredAttempts(testId: Types.ObjectId | string, now = new Date()): Promise<number> {
  const stale = await MockTestAttempt.find({ test: testId, status: 'in_progress', expiresAt: { $lte: now } });

  let closed = 0;
  for (const attempt of stale) {
    try {
      const result = await finalizeAttempt(attempt, 'time_expired', attempt.expiresAt);
      if (result.graded) closed += 1;
    } catch (err) {
      logger.error({ err, attemptId: String(attempt._id) }, 'Could not finalise an expired mock-test attempt');
    }
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Disclosure: what a student may see, and when
// ---------------------------------------------------------------------------

export type DisclosureReason = 'in-progress' | 'awaiting-close' | 'withheld' | null;

export interface Disclosure {
  /** May the student see their score and the summary figures? */
  showResult: boolean;
  /** May the student see the correct answers and explanations? */
  showReview: boolean;
  reason: DisclosureReason;
}

/**
 * Interprets the test's two disclosure settings for one attempt. **The only place
 * either setting is read.**
 *
 * Nothing is disclosed for an unsubmitted attempt, whatever the settings say — that is
 * the floor, and it is checked first. Above it, `after_close` means exactly what it
 * says: the window has to have closed, so that no one who is still entitled to sit the
 * paper can be handed its answers by someone who already has.
 */
export function disclosureFor(
  test: MockTestDocument,
  attempt: Pick<MockTestAttemptDocument, 'status'>,
  now = new Date(),
): Disclosure {
  if (attempt.status !== 'submitted') {
    return { showResult: false, showReview: false, reason: 'in-progress' };
  }

  const closed = test.availableTo !== null && test.availableTo !== undefined && now >= test.availableTo;

  const showResult =
    test.resultDisplay === 'immediate' ? true : test.resultDisplay === 'after_close' ? closed : false;
  const showReview =
    test.reviewPolicy === 'immediate' ? true : test.reviewPolicy === 'after_close' ? closed : false;

  const reason: DisclosureReason = showResult
    ? null
    : (test.resultDisplay === 'after_close' && !closed) || (test.reviewPolicy === 'after_close' && !closed)
      ? 'awaiting-close'
      : 'withheld';

  return { showResult, showReview, reason };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type QuestionsById = Map<string, QuestionDocument>;

/** Loads the questions an attempt served, keyed by id, with taxonomy names populated. */
export async function loadAttemptQuestions(attempt: MockTestAttemptDocument): Promise<QuestionsById> {
  const docs = await Question.find({ _id: { $in: attempt.questions.map((entry) => entry.question) } })
    .populate('subject', 'name slug')
    .populate('topic', 'name slug')
    .populate('subtopic', 'name slug');

  return new Map(docs.map((doc) => [String(doc._id), doc]));
}

/**
 * Loads one attempt **owned by this student**.
 *
 * Ownership is part of the query rather than checked afterwards, so another student's
 * attempt is indistinguishable from one that does not exist and an attempt id cannot
 * be used to probe for other people's work. Same rule as the Practice Zone.
 */
export async function findOwnAttempt(
  attemptId: string,
  student: Types.ObjectId,
): Promise<MockTestAttemptDocument | null> {
  return MockTestAttempt.findOne({ _id: attemptId, student });
}

// ---------------------------------------------------------------------------
// Views — student
// ---------------------------------------------------------------------------

/**
 * A test as it appears in the student's list, with their own attempt state.
 *
 * Carries **no questions**, which is what makes it safe to serve a test that has not
 * opened yet: a student can see that a paper exists, what it covers and when it runs,
 * without being able to read it early.
 */
export function studentTestSummaryView(
  test: MockTestDocument,
  attempts: MockTestAttemptDocument[],
  now = new Date(),
) {
  const availability = availabilityOf(test, now);
  const inProgress = attempts.find((attempt) => attempt.status === 'in_progress') ?? null;
  const used = attempts.length;

  return {
    id: String(test._id),
    title: test.title,
    description: test.description ?? null,
    classLevel: test.classLevel,
    totalQuestions: test.questions.length,
    totalMarks: test.totalMarks,
    durationMinutes: test.durationMinutes,
    opensAt: availability.opensAt,
    closesAt: availability.closesAt,
    available: availability.open,
    unavailableReason: availability.reason,
    maxAttempts: test.maxAttempts,
    attemptsUsed: used,
    attemptsLeft: Math.max(0, test.maxAttempts - used),
    /** The attempt to resume, if the student walked away from one. */
    resumeAttemptId: inProgress ? String(inProgress._id) : null,
    /** Their attempts on this test, newest first, without any per-question detail. */
    attempts: attempts.map((attempt) => attemptHistoryView(attempt, test, now)),
  };
}

/** The full pre-start briefing: everything except the paper itself. */
export function studentTestDetailView(
  test: MockTestDocument,
  attempts: MockTestAttemptDocument[],
  now = new Date(),
) {
  return {
    ...studentTestSummaryView(test, attempts, now),
    instructions: test.instructions ?? null,
    resultDisplay: test.resultDisplay,
    reviewPolicy: test.reviewPolicy,
  };
}

function summaryOf(attempt: MockTestAttemptDocument, test: MockTestDocument | null) {
  return {
    id: String(attempt._id),
    testId: String(attempt.test),
    testTitle: test?.title ?? null,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    totalQuestions: attempt.totalQuestions,
    maxMarks: attempt.maxMarks,
    answeredCount: attempt.questions.filter(isAnswered).length,
    durationMinutes: attempt.durationMinutes,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt ?? null,
  };
}

/** How the student's own response reads. Carries nothing about correctness. */
function responseOf(entry: AttemptAnswerEntry) {
  return {
    selectedOptionKeys: entry.selectedOptionKeys,
    numericResponse: entry.numericResponse ?? null,
    textResponse: entry.textResponse ?? null,
    booleanResponse: entry.booleanResponse ?? null,
    answered: isAnswered(entry),
  };
}

/**
 * The **in-progress** view: what the student may see while still writing.
 *
 * Question content comes from `studentQuestionView`, the same answer-stripped
 * projection the question endpoints use, so the options carry no `isCorrect` and there
 * is no `solution`, `numericAnswer` or `booleanAnswer` anywhere. The only additions
 * are the student's own saved responses and the clock. Nothing here reads the
 * answer-key snapshot — that is why this is a separate function from the review view
 * rather than one with a flag.
 *
 * `secondsRemaining` is computed from the stored deadline so the client has something
 * to count down from without ever being the authority on it.
 */
export function attemptInProgressView(
  attempt: MockTestAttemptDocument,
  questions: QuestionsById,
  test: MockTestDocument | null = null,
  now = new Date(),
) {
  return {
    ...summaryOf(attempt, test),
    secondsRemaining: Math.max(0, Math.floor((attempt.expiresAt.getTime() - now.getTime()) / 1000)),
    questions: attempt.questions.map((entry, index) => {
      const question = questions.get(String(entry.question));
      return {
        order: index + 1,
        ...(question ? studentQuestionView(question) : { id: String(entry.question), unavailable: true }),
        // The marks as this test prices them, which may differ from the bank's.
        marks: entry.marks,
        negativeMarks: entry.negativeMarks,
        response: responseOf(entry),
      };
    }),
  };
}

/**
 * The **result** view: the score and the summary figures, and no answer key.
 *
 * The middle of the three disclosure tiers, and the reason there are three. A test may
 * legitimately want to tell a student what they scored while keeping the paper's
 * answers back until the window closes — so "you may see your mark" and "you may see
 * the answers" have to be separately expressible, and a shape that carries the mark
 * without the answers has to exist.
 */
export function attemptResultView(attempt: MockTestAttemptDocument, test: MockTestDocument | null = null) {
  return {
    ...summaryOf(attempt, test),
    score: attempt.score,
    correctCount: attempt.correctCount,
    incorrectCount: attempt.incorrectCount,
    unansweredCount: attempt.unansweredCount,
    accuracy: attempt.accuracy,
    timeTakenSeconds: attempt.timeTakenSeconds,
    submissionReason: attempt.submissionReason ?? null,
    autoSubmitted: attempt.submissionReason === 'time_expired',
  };
}

/**
 * The **review** view: the graded paper with correct answers and explanations.
 *
 * The only function in this module that reveals a correct answer, and it refuses
 * unless the attempt is submitted *and* the test's own review policy permits it right
 * now. Both checks live here, next to the data they protect, rather than only in the
 * route — a future second caller cannot leak the key by forgetting to ask.
 */
export function attemptReviewView(
  attempt: MockTestAttemptDocument,
  questions: QuestionsById,
  test: MockTestDocument,
  now = new Date(),
) {
  if (attempt.status !== 'submitted') {
    throw ApiError.conflict('This attempt has not been submitted yet.');
  }
  const disclosure = disclosureFor(test, attempt, now);
  if (!disclosure.showReview) {
    throw ApiError.forbidden('The answers for this test have not been released yet.');
  }

  return {
    ...attemptResultView(attempt, test),
    questions: attempt.questions.map((entry, index) => {
      const question = questions.get(String(entry.question));
      return {
        order: index + 1,
        ...(question ? studentQuestionView(question) : { id: String(entry.question), unavailable: true }),
        marks: entry.marks,
        negativeMarks: entry.negativeMarks,
        response: responseOf(entry),
        // --- Revealed only here, only once the policy allows it. ---
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

/**
 * A one-line history entry.
 *
 * Carries no per-question detail and no answers, and honours the test's result policy:
 * a score the student is not yet allowed to see is `null` here too, not merely hidden
 * by the page that renders it.
 */
export function attemptHistoryView(
  attempt: MockTestAttemptDocument,
  test: MockTestDocument | null,
  now = new Date(),
) {
  const disclosure = test
    ? disclosureFor(test, attempt, now)
    : { showResult: false, showReview: false, reason: 'withheld' as DisclosureReason };

  return {
    id: String(attempt._id),
    testId: String(attempt.test),
    testTitle: test?.title ?? null,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    totalQuestions: attempt.totalQuestions,
    maxMarks: attempt.maxMarks,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt ?? null,
    autoSubmitted: attempt.submissionReason === 'time_expired',
    resultAvailable: disclosure.showResult,
    reviewAvailable: disclosure.showReview,
    disclosureReason: disclosure.reason,
    score: disclosure.showResult ? attempt.score : null,
    accuracy: disclosure.showResult ? attempt.accuracy : null,
    correctCount: disclosure.showResult ? attempt.correctCount : null,
    timeTakenSeconds: attempt.status === 'submitted' ? attempt.timeTakenSeconds : null,
  };
}

// ---------------------------------------------------------------------------
// Views — admin
// ---------------------------------------------------------------------------

/**
 * The author's view of a test.
 *
 * Includes the question ids and their per-test marks, and — when the questions have
 * been loaded — enough of each question's text to identify it in a list. It does not
 * assemble the answer key: an author who needs that reads the question bank, where the
 * gate is `questions:write` and the projection is the bank's own author view.
 */
export function adminTestView(test: MockTestDocument, questions?: QuestionsById) {
  return {
    id: String(test._id),
    title: test.title,
    description: test.description ?? null,
    instructions: test.instructions ?? null,
    classLevel: test.classLevel,
    durationMinutes: test.durationMinutes,
    totalMarks: test.totalMarks,
    totalQuestions: test.questions.length,
    availableFrom: test.availableFrom ?? null,
    availableTo: test.availableTo ?? null,
    maxAttempts: test.maxAttempts,
    resultDisplay: test.resultDisplay,
    reviewPolicy: test.reviewPolicy,
    status: test.status,
    questions: [...test.questions]
      .sort((a, b) => a.order - b.order)
      .map((ref) => {
        const question = questions?.get(String(ref.question));
        return {
          id: String(ref.question),
          order: ref.order,
          marks: ref.marks,
          negativeMarks: ref.negativeMarks,
          questionText: question?.questionText ?? null,
          type: question?.type ?? null,
          difficulty: question?.difficulty ?? null,
          status: question?.status ?? null,
          subject: question ? refView(question.subject) : null,
          topic: question ? refView(question.topic) : null,
        };
      }),
    createdByLabel: test.createdByLabel ?? null,
    updatedByLabel: test.updatedByLabel ?? null,
    publishedAt: test.publishedAt ?? null,
    archivedAt: test.archivedAt ?? null,
    createdAt: test.createdAt,
    updatedAt: test.updatedAt,
  };
}

/** Loads the questions a *test* lists (as opposed to the ones an attempt served). */
export async function loadTestQuestions(test: MockTestDocument): Promise<QuestionsById> {
  const docs = await Question.find({ _id: { $in: test.questions.map((ref) => ref.question) } })
    .populate('subject', 'name slug')
    .populate('topic', 'name slug');
  return new Map(docs.map((doc) => [String(doc._id), doc]));
}

/** A populated `student` ref on an attempt, once `.populate(...)` has run. */
interface PopulatedStudent {
  _id: unknown;
  studentId?: string;
  fullName?: string;
  schoolName?: string;
}

function attemptStudentView(value: unknown): { id: string; studentId: string | null; fullName: string | null; schoolName: string | null } {
  if (value && typeof value === 'object' && 'studentId' in (value as PopulatedStudent)) {
    const student = value as PopulatedStudent;
    return {
      id: String(student._id),
      studentId: student.studentId ?? null,
      fullName: student.fullName ?? null,
      schoolName: student.schoolName ?? null,
    };
  }
  return { id: String(value), studentId: null, fullName: null, schoolName: null };
}

/**
 * Every student's results for one test, with the aggregate figures an author actually
 * wants: how the cohort did overall, and which questions it fell over.
 *
 * Sweeps expired attempts first, so a paper whose time ran out is reported as the
 * finished, graded thing it is rather than as "in progress" for ever.
 *
 * Ranking is standard competition ranking — ties share a rank and the next rank skips
 * — computed in memory. That is correct at the scale this product is built for (a
 * cohort of a few hundred sitting one test) and is isolated here, which is where a
 * `$setWindowFields` aggregation would go if a test ever outgrew it. Only *submitted*
 * attempts are ranked: an in-progress paper has no score to place.
 */
export async function testResults(test: MockTestDocument, now = new Date()) {
  await sweepExpiredAttempts(test._id as Types.ObjectId, now);

  const attempts = await MockTestAttempt.find({ test: test._id })
    .populate('student', 'studentId fullName schoolName')
    .sort({ score: -1, timeTakenSeconds: 1, startedAt: 1 });

  const submitted = attempts.filter((attempt) => attempt.status === 'submitted');

  // Standard competition ranking over the submitted attempts, which are already in
  // score order from the query.
  const rankByAttemptId = new Map<string, number>();
  let lastScore: number | null = null;
  let lastRank = 0;
  submitted.forEach((attempt, index) => {
    const rank = lastScore !== null && attempt.score === lastScore ? lastRank : index + 1;
    rankByAttemptId.set(String(attempt._id), rank);
    lastScore = attempt.score;
    lastRank = rank;
  });

  const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
  const scores = submitted.map((attempt) => attempt.score);
  const round1 = (value: number): number => Math.round(value * 10) / 10;

  // Per-question outcomes across every submitted attempt, keyed by question id so a
  // test whose paper was reordered still lines up.
  const perQuestion = new Map<string, { served: number; answered: number; correct: number }>();
  for (const attempt of submitted) {
    for (const entry of attempt.questions) {
      const key = String(entry.question);
      const row = perQuestion.get(key) ?? { served: 0, answered: 0, correct: 0 };
      row.served += 1;
      if (isAnswered(entry)) {
        row.answered += 1;
        if (entry.isCorrect) row.correct += 1;
      }
      perQuestion.set(key, row);
    }
  }

  const questions = await loadTestQuestions(test);

  return {
    stats: {
      attemptsStarted: attempts.length,
      attemptsSubmitted: submitted.length,
      attemptsInProgress: attempts.length - submitted.length,
      autoSubmittedCount: submitted.filter((attempt) => attempt.submissionReason === 'time_expired').length,
      distinctStudents: new Set(attempts.map((attempt) => String(attempt.student))).size,
      averageScore: submitted.length > 0 ? round1(sum(scores) / submitted.length) : null,
      highestScore: submitted.length > 0 ? Math.max(...scores) : null,
      lowestScore: submitted.length > 0 ? Math.min(...scores) : null,
      averageAccuracy:
        submitted.length > 0 ? Math.round(sum(submitted.map((a) => a.accuracy)) / submitted.length) : null,
      averageTimeSeconds:
        submitted.length > 0 ? Math.round(sum(submitted.map((a) => a.timeTakenSeconds)) / submitted.length) : null,
    },
    rows: attempts.map((attempt) => ({
      id: String(attempt._id),
      student: attemptStudentView(attempt.student),
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      // Staff see the real figures whatever the student-facing disclosure setting says:
      // `resultDisplay` governs what the *student* is told, not whether the person who
      // set the test may read their own cohort's marks.
      score: attempt.status === 'submitted' ? attempt.score : null,
      maxMarks: attempt.maxMarks,
      accuracy: attempt.status === 'submitted' ? attempt.accuracy : null,
      correctCount: attempt.correctCount,
      incorrectCount: attempt.incorrectCount,
      unansweredCount: attempt.unansweredCount,
      timeTakenSeconds: attempt.status === 'submitted' ? attempt.timeTakenSeconds : null,
      autoSubmitted: attempt.submissionReason === 'time_expired',
      rank: rankByAttemptId.get(String(attempt._id)) ?? null,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt ?? null,
    })),
    questionStats: [...test.questions]
      .sort((a, b) => a.order - b.order)
      .map((ref) => {
        const key = String(ref.question);
        const row = perQuestion.get(key) ?? { served: 0, answered: 0, correct: 0 };
        return {
          id: key,
          order: ref.order,
          questionText: questions.get(key)?.questionText ?? null,
          served: row.served,
          answered: row.answered,
          correct: row.correct,
          // Of those who answered it, not of those who were served it: a question
          // everybody skipped has no accuracy, and reporting 0% would read as
          // "everyone got it wrong".
          correctPercent: row.answered > 0 ? Math.round((row.correct / row.answered) * 100) : null,
        };
      }),
  };
}
