import type { Cell, Row, Workbook, Worksheet } from 'exceljs' with { 'resolution-mode': 'import' };
import { CLASS_LEVELS } from '../lib/classLevels';
import { DIFFICULTIES, QUESTION_TYPES, type QuestionType } from '../models/Question';
import type {
  ImportDefaults,
  ImportParser,
  ImportedCandidate,
  ParseFailure,
  ParseInput,
  ParseOutcome,
} from '../lib/importTypes';
import {
  inferType,
  normaliseLabel,
  readAcceptedAnswers,
  readBoolean,
  readCorrectOptions,
  readNumber,
  readQuestionType,
} from '../lib/importAnswerText';
import { looksLikeWordDocument, looksLikeWorkbook } from '../lib/ooxml';

/**
 * Reading questions out of an Excel workbook (Milestone 21, Phase C).
 *
 * ## What this is and is not
 *
 * It is a **shape adapter**, deliberately, in exactly the sense `toCandidate()` is in
 * `services/geminiQuestionGenerator.ts`: it turns a row into an `ImportedCandidate` and does
 * **not** decide whether that candidate is acceptable. The real gate is `createQuestionSchema`,
 * applied by `services/questionImportService.ts` — the same schema and the same
 * `validateMathContent()` a hand-authored question passes. Two gates in two places would be two
 * things to disagree, and the file-facing one would be the weaker.
 *
 * So the division of labour here is narrow and worth stating, because it is what keeps the error
 * messages useful:
 *
 *  - **A row that cannot become a candidate at all is a `ParseFailure`**, named by its row
 *    number: no question text, no correct answer, a `Marks` column containing "four".
 *  - **A row that becomes a *bad* candidate is left to the screener**, which rejects it with the
 *    same words an author would see: two correct options on a single-choice question,
 *    unbalanced LaTeX, a negative mark exceeding the marks.
 *  - **A row we had to interpret is a `note`** — advisory, never a rejection, shown beside the
 *    question so the reviewer looks harder at that one.
 *
 * ## The `require`, and why it matches the Gemini one
 *
 * `exceljs` is CommonJS and requires cleanly, but its typings are only reachable as an ESM
 * import from a package compiling to CommonJS — the same shape of problem documented at the top
 * of `geminiQuestionGenerator.ts`. The `import type ... with { 'resolution-mode': 'import' }`
 * above plus a `require` below keeps full type-checking with no `any`.
 *
 * ## Tolerant of the file, strict about the data
 *
 * Column **order does not matter**, header capitalisation and punctuation do not matter, extra
 * columns are ignored, and the header row may sit below a title row. That is not politeness: an
 * examiner exports from whatever they already have, and a parser that demands byte-exact
 * headers is a parser nobody can use. What is *not* tolerant is the data — a class of `13` or a
 * chapter that does not exist is reported with its row number rather than quietly defaulted,
 * because a question filed under the wrong cohort is served to the wrong children.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- see the note above
const exceljs = require('exceljs') as typeof import('exceljs', { with: { 'resolution-mode': 'import' } });

export const EXCEL_PARSER_ID = 'excel';

/**
 * How many rows we will look at, however long the sheet is.
 *
 * Separate from the candidate ceiling because they bound different things: `maxCandidates` stops
 * a *review screen* becoming unreviewable, and this stops a sheet with fifty thousand blank
 * styled rows — which is what a spreadsheet somebody has scrolled through looks like — spending
 * an invocation on nothing.
 */
const MAX_ROWS_SCANNED = 5_000;

/** How far down we will look for the header row, so a title or a note above it is fine. */
const MAX_HEADER_SEARCH_ROWS = 20;

/** The most option columns a row may carry. Matches `Question.options`' own limit. */
const MAX_OPTIONS = 8;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/**
 * The canonical column keys, and every heading that maps onto each.
 *
 * Aliases exist because an examiner's existing sheet says `Chapter` or `Explanation` or `Ans`,
 * and asking them to rename columns before they can import is asking them to do the import
 * twice. Matching is done on a heading reduced to lowercase letters and digits, so `Negative
 * Marks`, `negative_marks` and `NEGATIVE MARKS!` are the same heading.
 */
const COLUMN_ALIASES: Record<string, readonly string[]> = {
  question: ['question', 'questiontext', 'questions', 'problem', 'q'],
  type: ['type', 'questiontype', 'answertype', 'format'],
  correct: ['correctanswer', 'answer', 'correct', 'ans', 'correctoption', 'key', 'answerkey'],
  solution: ['solution', 'explanation', 'explanationsolution', 'solutionexplanation', 'workedsolution', 'reason'],
  class: ['class', 'classlevel', 'grade', 'standard', 'std'],
  difficulty: ['difficulty', 'level', 'difficultylevel'],
  marks: ['marks', 'mark', 'score', 'points'],
  negativeMarks: ['negativemarks', 'negativemark', 'negative', 'negativemarking', 'penalty'],
  topic: ['topic', 'chapter', 'topicname', 'chaptername'],
  subtopic: ['subtopic', 'subtopicname', 'subchapter', 'concept'],
  tags: ['tags', 'tag', 'keywords'],
  tolerance: ['tolerance', 'tol', 'margin'],
};

/** `Option A`, `OptionA`, `A`, `Option 1`, `Choice A` — all the first option column. */
function optionIndexFor(normalised: string): number | null {
  const letter = /^(?:option|choice|opt)?([a-h])$/u.exec(normalised);
  if (letter?.[1]) return letter[1].charCodeAt(0) - 'a'.charCodeAt(0);

  const number = /^(?:option|choice|opt)([1-8])$/u.exec(normalised);
  if (number?.[1]) return Number(number[1]) - 1;

  return null;
}

/**
 * A heading reduced to comparable form.
 *
 * The same reduction the shared answer readers use, so a heading and a type name are compared by
 * one rule — see `lib/importAnswerText.ts` for why those readers are shared rather than copied.
 */
const normaliseHeading = normaliseLabel;

interface ColumnMap {
  /** Canonical key → 1-based column number. */
  fields: Map<string, number>;
  /** Option position (0-based) → 1-based column number. */
  options: Map<number, number>;
}

/**
 * The columns that, alongside `question`, make a row a header rather than prose.
 *
 * A header needs **two** matches, not one, and that is not fussiness — it is the fix for a real
 * misdetection. This project's own template has an *Instructions* sheet whose second row begins
 * with the literal word `Question` (it is the glossary entry for that column), and a
 * one-match rule read that row as a header and then imported the twelve rows of prose beneath it
 * as questions. Any workbook with a "what each column means" sheet has the same shape.
 *
 * Requiring a second question-ish column is a reliable discriminator, because a sheet of
 * questions always has somewhere to put the answer and a glossary never does.
 */
const HEADER_COMPANIONS = ['correct', 'solution', 'type', 'class', 'marks', 'difficulty'] as const;

/**
 * Finds the header row and maps its headings to columns.
 *
 * The header is identified by a **question** column plus at least one option column or one
 * companion from the list above. Searching rather than assuming row 1 is what lets a file with a
 * title, a date or an instruction line above the table import without editing.
 */
export function findHeaderRow(sheet: Worksheet): { rowNumber: number; columns: ColumnMap } | null {
  const limit = Math.min(sheet.rowCount, MAX_HEADER_SEARCH_ROWS);

  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const fields = new Map<string, number>();
    const options = new Map<number, number>();

    row.eachCell({ includeEmpty: false }, (cell: Cell, columnNumber: number) => {
      const heading = normaliseHeading(cellText(cell));
      if (heading.length === 0) return;

      const optionIndex = optionIndexFor(heading);
      if (optionIndex !== null && optionIndex < MAX_OPTIONS) {
        // First column wins, so a duplicated heading cannot silently shadow the earlier one.
        if (!options.has(optionIndex)) options.set(optionIndex, columnNumber);
        return;
      }

      for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.includes(heading) && !fields.has(key)) {
          fields.set(key, columnNumber);
          return;
        }
      }
    });

    const hasAnswerColumn = options.size > 0 || HEADER_COMPANIONS.some((key) => fields.has(key));
    if (fields.has('question') && hasAnswerColumn) {
      return { rowNumber, columns: { fields, options } };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * One cell as text, whatever exceljs decided it was.
 *
 * Every branch here is a shape a real workbook produces: a number where a string was expected
 * (`Marks`), a boolean (`Correct Answer` typed as `TRUE`), rich text (any cell somebody
 * bold-faced part of), a formula (a sheet that computes its answer key), a hyperlink (a pasted
 * URL), and a date (Excel's opinion of anything that looks remotely like one). Missing one of
 * these does not fail loudly — it silently reads as empty, and the row becomes "no question
 * text" for a row that plainly has some.
 */
export function cellText(cell: Cell | undefined): string {
  const value: unknown = cell?.value;
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const row = value as Record<string, unknown>;

    if (Array.isArray(row.richText)) {
      return (row.richText as Array<{ text?: unknown }>)
        .map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('')
        .trim();
    }
    // A formula cell: the cached result is what a human reading the sheet sees.
    if ('result' in row) return cellText({ value: row.result } as Cell);
    if (typeof row.text === 'string') return row.text.trim();
    // An error cell (`#REF!`) has `{ error }`. Reported as empty, so the row fails on the
    // field that is missing rather than on a confusing "#REF!" value.
    if ('error' in row) return '';
  }

  return '';
}

/** A cell as a finite number, or `null` when it is blank, or `undefined` when it is nonsense. */
function cellNumber(cell: Cell | undefined): number | null | undefined {
  return readNumber(cellText(cell));
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/**
 * Reading an answer is **shared with every other import format** — see
 * `lib/importAnswerText.ts`. It moved out of this file in Phase D, when the DOCX parser became a
 * second reader of the same human statement: "the answer is B" has to mean the same thing whether
 * it was written in a spreadsheet cell or on an `Answer: B` line, and two implementations would
 * eventually disagree about a question's answer key.
 *
 * Re-exported here because this module's own tests and readers reach for them alongside the
 * spreadsheet-specific code, exactly as `practiceService.ts` re-exports the shared grader.
 */
export { readBoolean, readCorrectOptions, readAcceptedAnswers, readQuestionType, inferType };



// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

/** What a row became: a candidate, a named failure, or nothing at all (a blank row). */
type RowOutcome =
  | { kind: 'candidate'; candidate: ImportedCandidate }
  | { kind: 'failure'; failure: ParseFailure }
  | { kind: 'blank' };

/**
 * Reads one row.
 *
 * Note what it does **not** do: reject a candidate for being a bad question. Everything that
 * `createQuestionSchema` can say better is left to it, so an examiner reads one dialect of error
 * message rather than two.
 */
export function readRow(row: Row, columns: ColumnMap, defaults: ImportDefaults): RowOutcome {
  const sourceRef = `Row ${row.number}`;
  const at = (key: string): Cell | undefined => {
    const column = columns.fields.get(key);
    return column === undefined ? undefined : row.getCell(column);
  };
  const fail = (reason: string): RowOutcome => ({ kind: 'failure', failure: { sourceRef, reason } });

  const questionText = cellText(at('question'));

  // Option text is read before the blank check, because a row with options but no question is a
  // real mistake worth naming rather than a blank row to skip past.
  const optionTexts: string[] = [];
  for (let index = 0; index < MAX_OPTIONS; index += 1) {
    const column = columns.options.get(index);
    optionTexts.push(column === undefined ? '' : cellText(row.getCell(column)));
  }
  const presentOptions = optionTexts.filter((text) => text.length > 0);
  const correctRaw = cellText(at('correct'));

  if (questionText.length === 0) {
    // A genuinely empty row is not an error — a sheet has trailing rows, and reporting fifty of
    // them would bury the two rows that are really wrong.
    const hasAnythingElse = presentOptions.length > 0 || correctRaw.length > 0 || cellText(at('solution')).length > 0;
    return hasAnythingElse ? fail('No question text, but the row has other values. Did a column shift?') : { kind: 'blank' };
  }

  const notes: string[] = [];

  // ---- Type: stated, or inferred from the row's own shape ------------------
  const statedType = cellText(at('type'));
  let type: QuestionType;

  if (statedType.length > 0) {
    const resolved = readQuestionType(statedType);
    if (!resolved) {
      return fail(
        `"${statedType}" is not a question type. Use one of: ${QUESTION_TYPES.join(', ')} — or leave the column blank and it will be worked out from the row.`,
      );
    }
    type = resolved;
  } else if (defaults.questionType) {
    type = defaults.questionType;
  } else {
    const inferred = inferType(presentOptions.length, correctRaw);
    type = inferred.type;
    notes.push(inferred.note);
  }

  // ---- Marks ---------------------------------------------------------------
  const marksCell = cellNumber(at('marks'));
  if (marksCell === undefined) {
    // A price that cannot be read is not something to default: the paper's marks are the one
    // number a student's score is computed from.
    return fail(`"${cellText(at('marks'))}" is not a number of marks.`);
  }
  const negativeCell = cellNumber(at('negativeMarks'));
  if (negativeCell === undefined) {
    return fail(`"${cellText(at('negativeMarks'))}" is not a number of negative marks.`);
  }

  const marks = marksCell ?? defaults.marks;
  const negativeMarks = negativeCell ?? defaults.negativeMarks;

  // ---- The answer, per type ------------------------------------------------
  const answer = readAnswerFor(type, correctRaw, optionTexts, notes);
  if ('reason' in answer) return fail(answer.reason);

  const solution = cellText(at('solution'));
  if (solution.length === 0) {
    // Not a failure: a draft may lack a solution. But it cannot be *published* without one, and
    // an examiner who imports two hundred of these should be told now rather than at publish time.
    notes.push('No solution given. The question can be saved as a draft but cannot be published until one is added.');
  }

  const toleranceCell = cellNumber(at('tolerance'));
  if (toleranceCell === undefined) {
    return fail(`"${cellText(at('tolerance'))}" is not a number.`);
  }

  const tags = cellText(at('tags'))
    .split(/[,;|]/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 20);

  return {
    kind: 'candidate',
    candidate: {
      content: {
        questionText,
        type,
        options: answer.options,
        booleanAnswer: answer.booleanAnswer,
        numericAnswer: answer.numericAnswer,
        // Only meaningful for `numeric`; the validator refuses it elsewhere, which is why it is
        // read as null rather than passed through for other types.
        tolerance: type === 'numeric' ? toleranceCell : null,
        acceptedAnswers: answer.acceptedAnswers,
        solution: solution.length > 0 ? solution : null,
        marks,
        negativeMarks,
        tags,
      },
      /**
       * Names as the file wrote them. **Never ids** — resolving a name against the live taxonomy
       * is the service's job, so a spreadsheet cannot file a question anywhere by asserting an
       * id, and cannot create a chapter by naming one. An empty cell is `null`, meaning "the file
       * did not say", which takes the examiner's default.
       */
      taxonomy: {
        classLevel: emptyToNull(cellText(at('class'))),
        topicName: emptyToNull(cellText(at('topic'))),
        subtopicName: emptyToNull(cellText(at('subtopic'))),
        difficulty: emptyToNull(cellText(at('difficulty'))),
      },
      sourceRef,
      notes,
    },
  };
}

function emptyToNull(value: string): string | null {
  return value.length === 0 ? null : value;
}



/** The answer fields for one type, or the reason the row could not supply them. */
function readAnswerFor(
  type: QuestionType,
  correctRaw: string,
  optionTexts: readonly string[],
  notes: string[],
): { reason: string } | {
  options: Array<{ text: string; isCorrect: boolean }>;
  booleanAnswer: boolean | null;
  numericAnswer: number | null;
  acceptedAnswers: string[];
} {
  const empty = { options: [], booleanAnswer: null, numericAnswer: null, acceptedAnswers: [] };

  if (correctRaw.length === 0) {
    // The spec's own example of a message worth giving: "Row 14: Missing correct answer".
    return { reason: 'No correct answer given.' };
  }

  if (type === 'single_choice' || type === 'multiple_choice') {
    const present = optionTexts.filter((text) => text.length > 0);
    if (present.length === 0) {
      return { reason: 'A choice question needs option columns, and this row has none filled in.' };
    }

    // Trailing blanks are dropped, but a *gap* is kept as a mistake worth seeing: if B is empty
    // and C is filled, dropping B would silently turn "the answer is C" into "the answer is B".
    const lastFilled = optionTexts.reduce((last, text, index) => (text.length > 0 ? index : last), -1);
    const kept = optionTexts.slice(0, lastFilled + 1);
    if (kept.some((text) => text.length === 0)) {
      return { reason: 'One of the option columns is empty with a later one filled in. Fill the gap or move the options up.' };
    }

    const { positions, unresolved } = readCorrectOptions(correctRaw, kept);
    if (unresolved.length > 0) {
      return {
        reason: `The correct answer "${unresolved.join('", "')}" does not match any option. Use the option letter (A, B, C…) or the exact option text.`,
      };
    }
    if (positions.length === 0) {
      return { reason: 'No correct answer given.' };
    }

    return {
      ...empty,
      options: kept.map((text, index) => ({ text, isCorrect: positions.includes(index) })),
    };
  }

  if (optionTexts.some((text) => text.length > 0)) {
    // Not fatal — the options are simply not part of this kind of question, and the validator
    // would refuse them. Dropping them with a note is the honest middle: the examiner is told.
    notes.push(`Option columns were filled in but a ${type.replace('_', '/')} question has no options, so they were ignored.`);
  }

  if (type === 'true_false') {
    const booleanAnswer = readBoolean(correctRaw);
    if (booleanAnswer === null) {
      return { reason: `"${correctRaw}" is not a true/false answer. Use TRUE or FALSE.` };
    }
    return { ...empty, booleanAnswer };
  }

  if (type === 'numeric') {
    const numericAnswer = Number(correctRaw.replace(/[\s,]/gu, ''));
    if (!Number.isFinite(numericAnswer)) {
      return { reason: `"${correctRaw}" is not a number. A numeric question needs a plain number, with the unit stated in the question text.` };
    }
    return { ...empty, numericAnswer };
  }

  const acceptedAnswers = readAcceptedAnswers(correctRaw);
  if (acceptedAnswers.length === 0) {
    return { reason: 'No correct answer given.' };
  }
  return { ...empty, acceptedAnswers };
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------



async function loadWorkbook(bytes: Buffer): Promise<Workbook> {
  if (!looksLikeWorkbook(bytes)) {
    throw new Error(
      looksLikeWordDocument(bytes)
        ? 'That is a Word document, not an Excel workbook. Use the Word import instead.'
        : 'That file is a zip archive but not an Excel workbook. Open it in Excel and use "Save As → .xlsx".',
    );
  }

  const workbook = new exceljs.Workbook();
  try {
    /**
     * `load()` is typed against exceljs's own `Buffer` alias, which under this project's
     * `@types/node` is structurally `ArrayBuffer` and so rejects Node's
     * `Buffer<ArrayBufferLike>`. At runtime it wants bytes and a `Buffer` is bytes, so the cast
     * is describing what is already true rather than forcing anything — the same shape of
     * declaration mismatch documented for `@google/genai` at the top of
     * `geminiQuestionGenerator.ts`.
     */
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch (err) {
    // exceljs's own message here is usually about zip internals and means nothing to an
    // examiner; the two things that really cause it are worth naming instead. `cause` is
    // assigned rather than passed to the constructor because this package targets ES2020, where
    // `new Error(message, options)` is not yet in the lib.
    const failure: Error & { cause?: unknown } = new Error(
      `That workbook could not be opened. It may be password-protected or damaged. (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'})`,
    );
    failure.cause = err;
    throw failure;
  }
  return workbook;
}

export const excelImportParser: ImportParser = {
  descriptor: {
    id: EXCEL_PARSER_ID,
    label: 'Excel workbook',
    kind: 'excel',
    // No model is called and no third party sees the file: the same workbook parses to the same
    // questions every time. A statement of fact, and what `Question.provenance.generatorKind`
    // inherits.
    extraction: 'deterministic',
    basis:
      'Read directly from the columns of your .xlsx file. Column order and heading capitalisation ' +
      'do not matter. Every question is then checked by the same rules as a hand-written one, and ' +
      'nothing is saved until you approve it.',
  },

  // Nothing to configure: no credential, no network.
  isAvailable: () => true,

  async parse(input: ParseInput): Promise<ParseOutcome> {
    const workbook = await loadWorkbook(input.file.bytes);

    const candidates: ImportedCandidate[] = [];
    const failures: ParseFailure[] = [];
    let examined = 0;

    // Every sheet, not just the first: a workbook with a sheet per class is a normal way to
    // organise questions, and reading only one would silently import a fraction of the file.
    for (const sheet of workbook.worksheets) {
      if (candidates.length >= input.maxCandidates) break;
      if (sheet.state === 'veryHidden' || sheet.state === 'hidden') continue;

      const header = findHeaderRow(sheet);
      if (!header) {
        // Named per sheet rather than thrown, so one stray sheet ("Notes", "Instructions") does
        // not lose the workbook.
        failures.push({
          sourceRef: workbook.worksheets.length > 1 ? `Sheet "${sheet.name}"` : 'This sheet',
          reason:
            'No question table was found in the first 20 rows, so this sheet was skipped. A sheet of ' +
            'questions needs a "Question" column and somewhere for the answer — option columns, or a ' +
            '"Correct Answer" column.',
        });
        continue;
      }

      const lastRow = Math.min(sheet.rowCount, header.rowNumber + MAX_ROWS_SCANNED);

      for (let rowNumber = header.rowNumber + 1; rowNumber <= lastRow; rowNumber += 1) {
        if (candidates.length >= input.maxCandidates) break;

        const outcome = readRow(sheet.getRow(rowNumber), header.columns, input.defaults);
        if (outcome.kind === 'blank') continue;

        // Counted only for a row that had something in it, so `examined` means "rows that looked
        // like questions" and the totals on the review screen add up for a human.
        examined += 1;

        if (outcome.kind === 'failure') {
          failures.push(prefixSheet(outcome.failure, sheet, workbook.worksheets.length));
        } else {
          candidates.push(prefixSheetRef(outcome.candidate, sheet, workbook.worksheets.length));
        }
      }
    }

    return { candidates, failures, examined };
  },
};

/** `Row 14` becomes `Sheet "Class 8" row 14` only when there is more than one sheet. */
function sheetRef(sourceRef: string, sheet: Worksheet, sheetCount: number): string {
  return sheetCount > 1 ? `Sheet "${sheet.name}" ${sourceRef.toLowerCase()}` : sourceRef;
}

function prefixSheet(failure: ParseFailure, sheet: Worksheet, sheetCount: number): ParseFailure {
  return { ...failure, sourceRef: sheetRef(failure.sourceRef, sheet, sheetCount) };
}

function prefixSheetRef(candidate: ImportedCandidate, sheet: Worksheet, sheetCount: number): ImportedCandidate {
  return { ...candidate, sourceRef: sheetRef(candidate.sourceRef, sheet, sheetCount) };
}

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

/** The template's columns, in the order an examiner reads them. */
const TEMPLATE_HEADINGS = [
  'Question',
  'Type',
  'Option A',
  'Option B',
  'Option C',
  'Option D',
  'Correct Answer',
  'Solution',
  'Class',
  'Difficulty',
  'Marks',
  'Negative Marks',
  'Topic',
  'Subtopic',
  'Tags',
  'Tolerance',
] as const;

/**
 * The downloadable template.
 *
 * Every column maps to a field `Question` really has — there is no invented column, because a
 * column the application cannot use is a column an examiner will fill in and then lose. Two
 * sheets: the table to fill in, and an Instructions sheet explaining each column, because a
 * template whose rules are only in the API documentation is a template nobody follows.
 *
 * Built with `exceljs` rather than served as a static file so the **class and difficulty
 * dropdowns are generated from `CLASS_LEVELS` and `DIFFICULTIES`**. A checked-in file would go
 * stale the moment the class range changes — which it is about to, in Phase J.
 */
export async function buildExcelTemplate(): Promise<Buffer> {
  const workbook = new exceljs.Workbook();
  workbook.creator = 'AMIT Maths Olympiad';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Questions', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = TEMPLATE_HEADINGS.map((heading) => ({
    header: heading,
    width: heading === 'Question' || heading === 'Solution' ? 52 : heading.length + 8,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };

  /** One worked example per question type, so the answer conventions are shown rather than told. */
  const examples: Array<Array<string | number>> = [
    [
      'Solve for $x$: $x^2 - 5x + 6 = 0$. What is the larger root?',
      'single_choice',
      '$x = 3$',
      '$x = 2$',
      '$x = -3$',
      '$x = 6$',
      'A',
      'Factorise as $(x-2)(x-3)=0$, so the roots are $2$ and $3$ and the larger is $3$.',
      'Class 9',
      'Medium',
      4,
      1,
      '',
      '',
      'quadratic, roots',
      '',
    ],
    [
      'Which of the following are prime numbers?',
      'multiple_choice',
      '$17$',
      '$21$',
      '$23$',
      '$27$',
      'A, C',
      '$17$ and $23$ have no divisors other than $1$ and themselves.',
      'Class 6',
      'Easy',
      4,
      0,
      '',
      '',
      'primes',
      '',
    ],
    [
      'The sum of the angles of a triangle is $180^\\circ$.',
      'true_false',
      '',
      '',
      '',
      '',
      'TRUE',
      'The angle sum of any Euclidean triangle is $180^\\circ$.',
      'Class 7',
      'Easy',
      2,
      0,
      '',
      '',
      '',
      '',
    ],
    [
      'A train travels $180$ km in $3$ hours. What is its average speed in km/h?',
      'numeric',
      '',
      '',
      '',
      '',
      '60',
      'Average speed is $\\frac{180}{3} = 60$ km/h.',
      'Class 8',
      'Easy',
      4,
      1,
      '',
      '',
      'speed',
      0,
    ],
    [
      'The value of $\\pi$ correct to two decimal places is ____.',
      'fill_blank',
      '',
      '',
      '',
      '',
      '3.14 | 3.14 approx',
      '$\\pi = 3.14159\\ldots$, which is $3.14$ to two decimal places.',
      'Class 8',
      'Medium',
      2,
      0,
      '',
      '',
      'pi',
      '',
    ],
  ];

  for (const example of examples) sheet.addRow(example);

  // Dropdowns on the three enum columns, generated from the backend's own lists so the template
  // cannot offer a value the API would refuse.
  const columnOf = (heading: (typeof TEMPLATE_HEADINGS)[number]) => TEMPLATE_HEADINGS.indexOf(heading) + 1;
  const listValidation = (heading: (typeof TEMPLATE_HEADINGS)[number], values: readonly string[]) => {
    const letter = sheet.getColumn(columnOf(heading)).letter;
    for (let rowNumber = 2; rowNumber <= 500; rowNumber += 1) {
      sheet.getCell(`${letter}${rowNumber}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        // Excel needs the list quoted as a single formula string.
        formulae: [`"${values.join(',')}"`],
      };
    }
  };

  listValidation('Type', QUESTION_TYPES);
  listValidation('Difficulty', DIFFICULTIES);
  // Excel's inline list has a 255-character limit; the class list fits today and would not if it
  // grew a great deal, so it degrades to a free-text cell rather than a broken dropdown.
  if (CLASS_LEVELS.join(',').length < 250) listValidation('Class', CLASS_LEVELS);

  // ---- Instructions -------------------------------------------------------

  const help = workbook.addWorksheet('Instructions');
  help.columns = [
    { header: 'Column', width: 20 },
    { header: 'Required?', width: 14 },
    { header: 'What to put in it', width: 96 },
  ];
  help.getRow(1).font = { bold: true };

  const rows: Array<[string, string, string]> = [
    ['Question', 'Yes', 'The question exactly as a student will read it. Write all mathematics as LaTeX between single dollar signs, e.g. $x^2 + 5x + 6 = 0$. Do not refer to a diagram or figure — the question bank stores text only.'],
    ['Type', 'No', `One of: ${QUESTION_TYPES.join(', ')}. Leave it blank and it will be worked out from the row — filled option columns mean a choice question, TRUE/FALSE means true_false, a plain number means numeric.`],
    ['Option A–D', 'For choice questions', 'One option per column. Leave them empty for true_false, numeric and fill_blank. Do not leave a gap (A and C filled, B empty) — fill the gap or move the options up.'],
    ['Correct Answer', 'Yes', 'For a choice question: the option letter (A) or letters (A, C), or the exact option text. For true_false: TRUE or FALSE. For numeric: a plain number, with the unit stated in the question itself. For fill_blank: every spelling that counts as correct, separated by a vertical bar — 3.14 | 3.14 approx. A bar rather than a comma, because answers legitimately contain commas.'],
    ['Solution', 'To publish', 'A worked explanation showing HOW the answer is reached. A question with no solution can be imported as a draft but cannot be published.'],
    ['Class', 'No', `One of: ${CLASS_LEVELS.join(', ')}. A bare number (8), an ordinal (8th) or "Grade 8" is also understood. Leave it blank to use the class you choose when uploading. A value that is not a real class is reported, not guessed at.`],
    ['Difficulty', 'No', `One of: ${DIFFICULTIES.join(', ')}. Blank uses the difficulty you choose when uploading.`],
    ['Marks', 'No', 'Awarded for a correct answer. Blank uses the value you choose when uploading. Must be a number.'],
    ['Negative Marks', 'No', 'The amount DEDUCTED for a wrong answer, as a positive number. 0 means no negative marking. It cannot exceed Marks.'],
    ['Topic', 'No', 'The chapter name, exactly as it appears under Chapters. Blank uses the chapter you choose when uploading. A chapter that does not exist is reported — importing never creates one.'],
    ['Subtopic', 'No', 'A subtopic of that chapter, if you use them.'],
    ['Tags', 'No', 'Free-text labels for searching, separated by commas. At most 20.'],
    ['Tolerance', 'For numeric', 'How far from the exact answer still counts as correct. Use 0, or leave blank, when the answer is exact. Only applies to numeric questions.'],
  ];

  for (const row of rows) help.addRow(row);
  help.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

  const notes = help.addRow(['', '', '']);
  notes.getCell(1).value = 'Also';
  notes.getCell(1).font = { bold: true };
  help.addRow([
    '',
    '',
    'Column order does not matter, and headings are matched loosely — "Negative Marks", "negative_marks" and "Penalty" are all understood. Extra columns are ignored. The header row may sit below a title row. Every sheet in the workbook is read, so a sheet per class works.',
  ]);
  help.addRow([
    '',
    '',
    'Nothing is saved when you upload. You will see every question that was read, every row that could not be read and why, and any duplicates, and you correct and approve them before anything reaches the question bank. Imported questions arrive as drafts.',
  ]);

  /**
   * `writeBuffer()` is typed as exceljs's own `Buffer` alias, which under this project's
   * `@types/node` is structurally `ArrayBuffer` rather than Node's `Buffer<ArrayBufferLike>` —
   * so a bare `Buffer.from(...)` does not type-check against either overload. Going via
   * `Uint8Array` is the one conversion that is true of both at runtime: exceljs really does hand
   * back bytes, and `Buffer.from(Uint8Array)` copies them.
   */
  const written = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
  return Buffer.from(written);
}

/** The filename the browser saves it as. */
export const EXCEL_TEMPLATE_FILENAME = 'amit-question-import-template.xlsx';
