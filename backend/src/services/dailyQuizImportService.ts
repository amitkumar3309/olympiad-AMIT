import { ApiError } from '../lib/ApiError';
import { now } from '../lib/clock';
import { CLASS_LEVELS } from '../lib/classLevels';
import { dayKeyOf, daysBetween, type DayKey } from '../lib/competitionDay';
import { classesInRange, classNumber, classRangeLabel, parseClassRange, parseQuizDay, quizQuestionProblem } from '../lib/dailyQuiz';
import type { RejectedCandidate } from '../lib/questionGeneratorTypes';
import type { ParseFailure } from '../lib/importTypes';
import type { QualityWarning } from '../lib/questionQuality';
import { DailyChallenge, type Difficulty, type ImportFileOutcome } from '../models';
import { groupIdOf, scheduleQuiz } from './dailyChallengeService';
import {
  approveImport,
  previewImport,
  type ApprovedImportQuestion,
  type PreviewedQuestion,
} from './questionImportService';
import type { Actor } from './taxonomyService';

/**
 * Loading weeks of Daily Quizzes from one file (Milestone 30, brief §6.5: "bulk import
 * (CSV/JSON) with a dry-run preview and per-row errors; the owner will load weeks of
 * questions at once").
 *
 * ## Not a second path into the question bank
 *
 * CLAUDE.md allows exactly one path from a file to the bank, `questionImportService.ts`, and
 * this does not add one. It is that importer with a calendar on top:
 *
 *  1. **Preview** is `previewImport()` — the same parsers (Excel, and CSV and JSON through the
 *     Excel parser's own row reader), the same chapter resolution and detection, the same
 *     screener, the same `ImportBatch` row for provenance. Then the two columns only a quiz
 *     has, `Day` and `Classes`, are read and checked here: a real date, not in the past, a
 *     class range that parses, no two quizzes for one class on one day (in the file or
 *     already scheduled), and the quiz's own content rules (`quizQuestionProblem()`, shared
 *     with the scheduler). **Nothing is written** except that batch row.
 *  2. **Approve** re-checks every row's schedule from scratch, then hands the questions to
 *     `approveImport()` — the bank's only writer, which re-validates them itself and stamps
 *     provenance from the batch — and schedules each saved question with `scheduleQuiz()`,
 *     which re-checks the content rules against the saved question once more.
 *
 * Saved questions are **drafts**, deliberately: a quiz question must stay out of practice
 * until its answer is revealed (PLAN.md Q4), and the bank refuses to publish it before then.
 *
 * ## What a partial success looks like
 *
 * Normal, and reported per row: one bad row never stops the others, the same as the
 * question bank's bulk actions. A row can end three ways — **scheduled**; **saved but not
 * scheduled** (the question reached the bank, and the day was taken in the seconds between
 * preview and approval — it can be scheduled by hand from the console); or **refused**.
 * Nothing is rolled back, because there is no transaction to roll back with, and a saved
 * draft harms nobody.
 */

/** The formats a quiz file may be: tables. A Word document or a photograph has no columns. */
export const QUIZ_IMPORT_KINDS = ['excel', 'csv', 'json'] as const;
export type QuizImportKind = (typeof QUIZ_IMPORT_KINDS)[number];

/**
 * The most rows one quiz import may carry: nine weeks of three groups, or most of a year of
 * single quizzes. Far below the question importer's ceiling, because every row here is also a
 * promise of a prize on a particular day, and the preview has to be read by one person.
 */
export const QUIZ_IMPORT_MAX_ROWS = 200;

const CLASSES_HELP = 'Write 3-5, 6-8, 9-12, a single class such as 9, or All.';

export interface QuizPlan {
  day: DayKey;
  classMin: number;
  classMax: number;
  label: string;
}

export interface QuizImportRow {
  /** The preview's own id for the question, which approval sends back. */
  clientId: string;
  sourceRef: string;
  /** Where and when it would run — null when the row's Day or Classes cannot be read. */
  plan: QuizPlan | null;
  /** The question as it would be saved, placement included — what approval sends back. */
  question: PreviewedQuestion;
  /** Every reason this row cannot be scheduled. Empty means ready. */
  problems: string[];
  warnings: QualityWarning[];
}

export interface QuizImportPreview {
  batchId: string | null;
  rows: QuizImportRow[];
  /** Rows the question importer itself refused — unparseable answers, unknown chapters, … */
  refused: RejectedCandidate[];
  duplicates: RejectedCandidate[];
  failures: ParseFailure[];
  unknownChapters: string[];
  batchWarnings: QualityWarning[];
  files: ImportFileOutcome[];
  summary: { ready: number; withProblems: number; refused: number };
}

/** Reads one row's `Day` and `Classes`, and checks what can be checked without the database. */
function planFor(question: PreviewedQuestion, today: DayKey): { plan: QuizPlan | null; problems: string[] } {
  const problems: string[] = [];
  const hint = question.schedule;

  const dayText = hint?.day ?? null;
  const day = dayText ? parseQuizDay(dayText) : null;
  if (!dayText) problems.push('No Day given. Write the date as 2026-11-08 or 08/11/2026.');
  else if (!day) problems.push(`"${dayText}" is not a date. Write it as 2026-11-08 or 08/11/2026.`);
  else if (daysBetween(today, day) < 0) problems.push(`${day} is in the past.`);

  const classesText = hint?.classes ?? null;
  const range = classesText ? parseClassRange(classesText) : null;
  if (!classesText) problems.push(`No Classes given. ${CLASSES_HELP}`);
  else if (!range) problems.push(`"${classesText}" is not a class range. ${CLASSES_HELP}`);

  if (range) {
    const problem = quizQuestionProblem(question, range);
    if (problem) problems.push(problem);
  }

  const plan = day && range ? { day, classMin: range.min, classMax: range.max, label: classRangeLabel(range.min, range.max) } : null;
  return { plan, problems };
}

/**
 * The clashes a set of plans would make: with quizzes already scheduled, and with each other.
 * The **first** row in the file keeps a contested day; every later row naming one of its
 * classes is told which row got there first.
 */
async function clashesFor(rows: ReadonlyArray<{ plan: QuizPlan | null; sourceRef: string }>): Promise<Map<number, string[]>> {
  const clashes = new Map<number, string[]>();
  const add = (index: number, message: string) => clashes.set(index, [...(clashes.get(index) ?? []), message]);

  const days = [...new Set(rows.flatMap((row) => (row.plan ? [row.plan.day] : [])))];
  const taken = new Map<string, Set<number>>();
  if (days.length > 0) {
    const existing = await DailyChallenge.find({ day: { $in: days } }).select('day classLevel').lean();
    for (const doc of existing) {
      const set = taken.get(doc.day) ?? new Set<number>();
      set.add(classNumber(doc.classLevel));
      taken.set(doc.day, set);
    }
  }

  const claimed = new Map<string, Map<number, string>>();
  rows.forEach((row, index) => {
    if (!row.plan) return;
    const { day, classMin, classMax } = row.plan;
    const classes = classesInRange(classMin, classMax).map(classNumber);

    const scheduled = classes.filter((n) => taken.get(day)?.has(n));
    if (scheduled.length > 0) {
      add(index, `${describeClasses(scheduled)} already ${scheduled.length === 1 ? 'has' : 'have'} a Daily Quiz on ${day}.`);
      return;
    }

    const byClass = claimed.get(day) ?? new Map<number, string>();
    const earlier = classes.find((n) => byClass.has(n));
    if (earlier !== undefined) {
      add(index, `${row.plan.label} overlaps ${byClass.get(earlier)} on ${day} — one quiz per class per day.`);
      return;
    }
    for (const n of classes) byClass.set(n, row.sourceRef);
    claimed.set(day, byClass);
  });

  return clashes;
}

function describeClasses(numbers: readonly number[]): string {
  return numbers.length === 1 ? `Class ${numbers[0]}` : `Classes ${numbers.join(', ')}`;
}

/**
 * Reads a quiz file and says what would happen. **Writes no question and no quiz** — only
 * the importer's own `ImportBatch` row, which approval reads provenance back from.
 */
export async function previewQuizImport(
  input: {
    kind: QuizImportKind;
    file: { name: string; declaredType: string; data: Buffer };
    /** The chapter for rows that name none and whose chapter cannot be detected. */
    topic: string | null;
    difficulty: Difficulty;
  },
  actor: Actor,
  at: Date = now(),
): Promise<QuizImportPreview> {
  const preview = await previewImport(
    {
      kind: input.kind,
      files: [input.file],
      topic: input.topic,
      subtopic: null,
      // Only reached by a row with no `Classes` and no `Class`, which is refused below for
      // the missing range — so this placeholder can never become a saved question's class.
      classLevel: CLASS_LEVELS[0],
      difficulty: input.difficulty,
      // The quiz pays XP, not marks, and never penalises. The bank still requires a price.
      marks: 1,
      negativeMarks: 0,
      questionType: 'single_choice',
    },
    actor,
  );

  const total = preview.questions.length + preview.rejected.length + preview.duplicates.length + preview.failures.length;
  if (total > QUIZ_IMPORT_MAX_ROWS) {
    throw ApiError.badRequest(
      `That file holds ${total} rows. Import at most ${QUIZ_IMPORT_MAX_ROWS} quizzes at a time — split it by month.`,
    );
  }

  const hasScheduleColumns = preview.questions.some((question) => question.schedule !== null);
  if (preview.questions.length > 0 && !hasScheduleColumns) {
    throw ApiError.badRequest(
      'This file has no "Day" or "Classes" column, so it is a question file rather than a Daily Quiz file. ' +
        'Download the Daily Quiz template to see the columns, or import it into the Question Bank instead.',
    );
  }

  const today = dayKeyOf(at);
  const planned = preview.questions.map((question) => ({ question, ...planFor(question, today) }));
  const clashes = await clashesFor(planned.map((row) => ({ plan: row.plan, sourceRef: row.question.sourceRef })));

  const rows: QuizImportRow[] = planned.map((row, index) => ({
    clientId: row.question.clientId,
    sourceRef: row.question.sourceRef,
    plan: row.plan,
    question: row.question,
    problems: [...row.problems, ...(clashes.get(index) ?? [])],
    warnings: row.question.warnings,
  }));

  const ready = rows.filter((row) => row.problems.length === 0).length;
  return {
    batchId: preview.batchId,
    rows,
    refused: preview.rejected,
    duplicates: preview.duplicates,
    failures: preview.failures,
    unknownChapters: preview.unknownChapters,
    batchWarnings: preview.batchWarnings,
    files: preview.files,
    summary: {
      ready,
      withProblems: rows.length - ready,
      refused: preview.rejected.length + preview.duplicates.length + preview.failures.length,
    },
  };
}

/** One row as the console sends it back to be scheduled. */
export interface ApproveQuizRow {
  clientId: string;
  sourceRef: string;
  day: DayKey;
  classMin: number;
  classMax: number;
  question: ApprovedImportQuestion;
}

export type QuizImportOutcomeRow =
  | { clientId: string; sourceRef: string; status: 'scheduled'; day: DayKey; label: string; groupId: string; questionId: string }
  | { clientId: string; sourceRef: string; status: 'saved-not-scheduled'; day: DayKey; label: string; questionId: string; reason: string }
  | { clientId: string; sourceRef: string; status: 'refused'; reason: string };

/**
 * Saves and schedules the approved rows, re-checking everything first: the preview an
 * administrator approved may be minutes old, and another administrator may have scheduled
 * one of its days since.
 */
export async function approveQuizImport(
  input: { batchId: string; rows: ApproveQuizRow[] },
  actor: Actor,
  at: Date = now(),
): Promise<{ rows: QuizImportOutcomeRow[]; scheduled: number }> {
  const today = dayKeyOf(at);
  const outcome = new Map<string, QuizImportOutcomeRow>();

  // ---- Schedules, re-checked from scratch ---------------------------------
  const checked = input.rows.map((row) => {
    const range = { min: row.classMin, max: row.classMax };
    const problems: string[] = [];
    if (daysBetween(today, row.day) < 0) problems.push(`${row.day} is in the past.`);
    const problem = quizQuestionProblem(row.question, range);
    if (problem) problems.push(problem);
    const plan: QuizPlan = { day: row.day, classMin: row.classMin, classMax: row.classMax, label: classRangeLabel(row.classMin, row.classMax) };
    return { row, plan, problems };
  });
  const clashes = await clashesFor(checked.map((entry) => ({ plan: entry.plan, sourceRef: entry.row.sourceRef })));

  const ready = checked.filter((entry, index) => {
    const problems = [...entry.problems, ...(clashes.get(index) ?? [])];
    if (problems.length === 0) return true;
    outcome.set(entry.row.clientId, {
      clientId: entry.row.clientId,
      sourceRef: entry.row.sourceRef,
      status: 'refused',
      reason: problems.join(' '),
    });
    return false;
  });

  // ---- The bank's only writer ---------------------------------------------
  if (ready.length > 0) {
    const saved = await approveImport({ batchId: input.batchId, questions: ready.map((entry) => entry.row.question) }, actor);
    const refusedAt = new Map(saved.rejected.map((entry) => [entry.index, entry.reason]));

    // `created` holds the saved questions in the order they were sent, skipping the refused.
    let next = 0;
    for (const [position, entry] of ready.entries()) {
      const { row, plan } = entry;
      const reason = refusedAt.get(position + 1);
      if (reason !== undefined) {
        outcome.set(row.clientId, { clientId: row.clientId, sourceRef: row.sourceRef, status: 'refused', reason });
        continue;
      }
      const question = saved.created[next];
      next += 1;
      if (!question) continue;

      try {
        const docs = await scheduleQuiz(
          { day: plan.day, classMin: plan.classMin, classMax: plan.classMax, questionId: String(question._id) },
          actor,
          at,
        );
        outcome.set(row.clientId, {
          clientId: row.clientId,
          sourceRef: row.sourceRef,
          status: 'scheduled',
          day: plan.day,
          label: plan.label,
          groupId: String(groupIdOf(docs[0]!)),
          questionId: String(question._id),
        });
      } catch (err) {
        outcome.set(row.clientId, {
          clientId: row.clientId,
          sourceRef: row.sourceRef,
          status: 'saved-not-scheduled',
          day: plan.day,
          label: plan.label,
          questionId: String(question._id),
          reason: err instanceof ApiError ? err.message : 'The quiz could not be scheduled.',
        });
      }
    }
  }

  const rows = input.rows.map(
    (row) =>
      outcome.get(row.clientId) ?? {
        clientId: row.clientId,
        sourceRef: row.sourceRef,
        status: 'refused' as const,
        reason: 'This row could not be saved.',
      },
  );
  return { rows, scheduled: rows.filter((row) => row.status === 'scheduled').length };
}

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

/** The template's columns, in the order the owner fills them in. */
export const QUIZ_TEMPLATE_HEADINGS = [
  'Day',
  'Classes',
  'Question',
  'Option A',
  'Option B',
  'Option C',
  'Option D',
  'Correct Answer',
  'Solution',
  'Topic',
  'Difficulty',
] as const;

/**
 * Three example rows, one per class group, dated from tomorrow so the template imports as
 * it stands. Each answer is checked by hand and stated in its solution; `Topic` is left
 * blank on purpose, for the reason the Excel template gives (a chapter that exists only in
 * one database makes every other database's first import open with refusals) — the
 * importer detects a chapter from the question, or uses the fallback chosen on screen.
 */
export function quizTemplateRows(at: Date = now()): string[][] {
  const day = (offset: number) => dayKeyOf(new Date(at.getTime() + offset * 24 * 60 * 60 * 1000));
  return [
    [
      day(1),
      '3-5',
      'Riya has 3 boxes with 8 pencils in each box. She gives away 5 pencils. How many pencils does she have left?',
      '16',
      '19',
      '21',
      '29',
      'B',
      '3 boxes of 8 pencils make $3 \\times 8 = 24$ pencils. After giving away 5, she has $24 - 5 = 19$ pencils.',
      '',
      'Easy',
    ],
    [
      day(1),
      '6-8',
      'What is 15% of 240?',
      '32',
      '36',
      '38',
      '40',
      'B',
      '15% of 240 is $\\frac{15}{100} \\times 240 = 36$.',
      '',
      'Easy',
    ],
    [
      day(1),
      '9-12',
      'If $x + \\frac{1}{x} = 3$, what is the value of $x^2 + \\frac{1}{x^2}$?',
      '7',
      '9',
      '11',
      '5',
      'A',
      'Square both sides: $\\left(x + \\frac{1}{x}\\right)^2 = x^2 + 2 + \\frac{1}{x^2} = 9$, so $x^2 + \\frac{1}{x^2} = 9 - 2 = 7$.',
      '',
      'Medium',
    ],
  ];
}

/** A CSV cell, quoted when it must be. */
function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

/** The template as CSV — with a byte-order mark, so Excel opens the ₹ and the maths as UTF-8. */
export function quizTemplateCsv(at: Date = now()): string {
  const lines = [QUIZ_TEMPLATE_HEADINGS, ...quizTemplateRows(at)].map((row) => row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** The template as JSON: an array of objects keyed by the same headings. */
export function quizTemplateJson(at: Date = now()): string {
  const items = quizTemplateRows(at).map((row) =>
    Object.fromEntries(QUIZ_TEMPLATE_HEADINGS.map((heading, index) => [heading, row[index] ?? ''])),
  );
  return `${JSON.stringify(items, null, 2)}\n`;
}
