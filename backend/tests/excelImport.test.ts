import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { ImportBatch, Question } from '../src/models';
import {
  buildExcelTemplate,
  cellText,
  excelImportParser,
  inferType,
  readAcceptedAnswers,
  readBoolean,
  readCorrectOptions,
  readQuestionType,
} from '../src/services/excelImportParser';
// Format detection moved to `lib/ooxml.ts` in Phase D, when the DOCX parser became a second
// caller — see the note at the top of that file.
import { looksLikeWordDocument, looksLikeWorkbook } from '../src/lib/ooxml';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, cookieHeader, createAdminSession, registerVerifyLogin, clearTestInbox } from './helpers/auth';
import { createTaxonomy, type Taxonomy } from './helpers/questions';
import type { ImportDefaults } from '../src/lib/importTypes';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- see excelImportParser.ts
const exceljs = require('exceljs') as typeof import('exceljs', { with: { 'resolution-mode': 'import' } });

/**
 * Milestone 21, Phase C — the Excel importer.
 *
 * Unlike the Phase B suite, this one builds **real `.xlsx` files** with `exceljs` and pushes them
 * through the real route. That matters: the interesting bugs in a spreadsheet parser are all
 * about what a real workbook actually contains — a number in a text column, a formula, rich
 * text, a title row above the headers, a second sheet, columns in the wrong order — and none of
 * those can be exercised against a hand-written fixture object.
 *
 * The dividing line the tests keep asserting is the one the parser is built around:
 *
 *  - a row that **cannot become a candidate** is a `failure` naming its row number;
 *  - a row that becomes a **bad candidate** is left to the shared screener, which rejects it with
 *    the same words an author would see;
 *  - a row we had to **interpret** carries a note, which never blocks anything.
 *
 * Getting that wrong in either direction is the failure worth guarding: a parser that rejects
 * valid data makes the feature useless, and one that quietly repairs invalid data puts a wrong
 * answer key in front of a child.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const ORIGINAL_MAX = config.imports.maxQuestions;

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
  config.imports.maxQuestions = ORIGINAL_MAX;
});

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXCEL_URL = `${API}/admin/questions/import/excel`;
const ALIAS = '/api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The template's own column order, which most tests use. */
const HEADERS = [
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
];

type CellValue = string | number | boolean | null | undefined | Date | object;

interface SheetSpec {
  name?: string;
  rows: CellValue[][];
  state?: 'visible' | 'hidden';
}

/** Builds a real workbook in memory and returns its bytes. */
async function workbookBytes(sheets: SheetSpec[]): Promise<Buffer> {
  const workbook = new exceljs.Workbook();
  for (const [index, spec] of sheets.entries()) {
    const sheet = workbook.addWorksheet(spec.name ?? `Sheet${index + 1}`);
    for (const row of spec.rows) sheet.addRow(row as never);
    if (spec.state === 'hidden') sheet.state = 'hidden';
  }
  const written = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
  return Buffer.from(written);
}

/** A single-sheet workbook with the template headers and the given data rows. */
function standardSheet(rows: CellValue[][]): Promise<Buffer> {
  return workbookBytes([{ name: 'Questions', rows: [HEADERS, ...rows] }]);
}

/** A valid single-choice row, in template column order. */
function mcqRow(overrides: Partial<Record<string, CellValue>> = {}): CellValue[] {
  const row: Record<string, CellValue> = {
    Question: 'Solve for $x$: $x^2 - 5x + 6 = 0$. What is the larger root?',
    Type: 'single_choice',
    'Option A': '$x = 3$',
    'Option B': '$x = 2$',
    'Option C': '$x = -3$',
    'Option D': '$x = 6$',
    'Correct Answer': 'A',
    Solution: 'Factorise as $(x-2)(x-3)=0$, so the larger root is $3$.',
    Class: '',
    Difficulty: '',
    Marks: '',
    'Negative Marks': '',
    Topic: '',
    Subtopic: '',
    Tags: '',
    Tolerance: '',
    ...overrides,
  };
  return HEADERS.map((heading) => row[heading] ?? '');
}

function dataUrl(bytes: Buffer, mime = XLSX_MIME): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function adminSetup(): Promise<{ cookies: Record<string, string>; taxonomy: Taxonomy }> {
  const { cookies } = await createAdminSession(app);
  const taxonomy = await createTaxonomy(app, cookies);
  return { cookies, taxonomy };
}

interface PreviewBody {
  success: boolean;
  batchId: string;
  questions: Array<Record<string, unknown>>;
  rejected: Array<{ index: number; reason: string }>;
  duplicates: Array<{ index: number; reason: string }>;
  failures: Array<{ sourceRef: string; reason: string }>;
  files: Array<Record<string, unknown>>;
  examined: number;
  truncated: boolean;
}

/** Uploads one workbook and returns the preview. */
async function upload(
  cookies: Record<string, string>,
  taxonomy: Taxonomy,
  bytes: Buffer,
  overrides: Record<string, unknown> = {},
  expectStatus = 200,
): Promise<PreviewBody> {
  const res = await request(app)
    .post(EXCEL_URL)
    .set('Cookie', cookieHeader(cookies))
    .send({
      topic: taxonomy.topicId,
      classLevel: 'Class 8',
      difficulty: 'Medium',
      marks: 4,
      negativeMarks: 1,
      files: [{ name: 'questions.xlsx', content: dataUrl(bytes) }],
      ...overrides,
    })
    .expect(expectStatus);
  return res.body as PreviewBody;
}

const DEFAULTS: ImportDefaults = {
  classLevel: 'Class 8',
  difficulty: 'Medium',
  questionType: null,
  marks: 4,
  negativeMarks: 1,
  topicName: null,
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('cellText', () => {
  it('reads every shape a real workbook produces', async () => {
    // Each of these is a shape exceljs really returns, and missing one makes the cell read as
    // empty — which surfaces as "no question text" for a row that plainly has some.
    const bytes = await workbookBytes([
      {
        rows: [
          ['plain string'],
          [42.5],
          [true],
          [{ richText: [{ text: 'rich ' }, { text: 'text' }] }],
          [{ formula: 'A1', result: 'formula result' }],
          [{ text: 'link text', hyperlink: 'https://example.com' }],
          [{ error: '#REF!' }],
          [null],
        ],
      },
    ]);

    const workbook = new exceljs.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;

    expect(cellText(sheet.getRow(1).getCell(1))).toBe('plain string');
    expect(cellText(sheet.getRow(2).getCell(1))).toBe('42.5');
    expect(cellText(sheet.getRow(3).getCell(1))).toBe('true');
    expect(cellText(sheet.getRow(4).getCell(1))).toBe('rich text');
    expect(cellText(sheet.getRow(5).getCell(1))).toBe('formula result');
    expect(cellText(sheet.getRow(6).getCell(1))).toBe('link text');
    // An error cell reads as empty, so the row fails on the field that is missing rather than on
    // a baffling "#REF!" value.
    expect(cellText(sheet.getRow(7).getCell(1))).toBe('');
    expect(cellText(sheet.getRow(8).getCell(1))).toBe('');
    expect(cellText(undefined)).toBe('');
  });
});

describe('readCorrectOptions', () => {
  const options = ['$x = 3$', '$x = 2$', '$x = -3$', '$x = 6$'];

  it('reads a single letter in every spelling a sheet uses', () => {
    for (const value of ['A', 'a', '(a)', 'a)', 'Option A', 'A.']) {
      expect(readCorrectOptions(value, options).positions).toEqual([0]);
    }
  });

  it('reads several letters on any of the separators people use', () => {
    for (const value of ['A, C', 'A;C', 'A/C', 'A + C', 'A and C']) {
      expect(readCorrectOptions(value, options).positions).toEqual([0, 2]);
    }
  });

  it('matches option text case-insensitively, for sheets exported from elsewhere', () => {
    expect(readCorrectOptions('$X = 2$', options).positions).toEqual([1]);
  });

  it('reports a letter beyond the options rather than hunting for a text match', () => {
    // `D` on a three-option row is a real mistake; guessing would file a wrong answer key.
    const outcome = readCorrectOptions('D', options.slice(0, 3));
    expect(outcome.positions).toEqual([]);
    expect(outcome.unresolved).toEqual(['D']);
  });

  it('reports only what it could not resolve', () => {
    const outcome = readCorrectOptions('A, Z', options);
    expect(outcome.positions).toEqual([0]);
    expect(outcome.unresolved).toEqual(['Z']);
  });

  it('de-duplicates a repeated answer', () => {
    expect(readCorrectOptions('A, a, A', options).positions).toEqual([0]);
  });
});

describe('readBoolean and readAcceptedAnswers', () => {
  it('reads the yes/no spellings a spreadsheet contains', () => {
    for (const value of ['TRUE', 'true', 'T', 'Yes', 'y', '1']) expect(readBoolean(value)).toBe(true);
    for (const value of ['FALSE', 'false', 'F', 'No', 'n', '0']) expect(readBoolean(value)).toBe(false);
    expect(readBoolean('maybe')).toBeNull();
    expect(readBoolean('')).toBeNull();
  });

  it('splits accepted answers on a bar, never a comma', () => {
    // The decisive case: `1,000` is one answer, and a comma-separated list would split it into
    // two wrong ones.
    expect(readAcceptedAnswers('1,000')).toEqual(['1,000']);
    expect(readAcceptedAnswers('3.14 | 3.14 approx')).toEqual(['3.14', '3.14 approx']);
    expect(readAcceptedAnswers(' a || b ')).toEqual(['a', 'b']);
  });
});

describe('readQuestionType', () => {
  it('reads the canonical names', () => {
    expect(readQuestionType('single_choice')).toBe('single_choice');
    expect(readQuestionType('Single Choice')).toBe('single_choice');
    expect(readQuestionType('FILL_BLANK')).toBe('fill_blank');
  });

  it('reads the names an examiner actually writes', () => {
    expect(readQuestionType('MCQ')).toBe('single_choice');
    expect(readQuestionType('Multiple Correct')).toBe('multiple_choice');
    expect(readQuestionType('T/F')).toBe('true_false');
    expect(readQuestionType('Numerical')).toBe('numeric');
    expect(readQuestionType('Fill in the blank')).toBe('fill_blank');
  });

  it('refuses something that is not a type', () => {
    expect(readQuestionType('essay')).toBeNull();
    expect(readQuestionType('short answer')).toBeNull();
  });
});

describe('inferType', () => {
  it('treats options as decisive', () => {
    expect(inferType(4, 'A').type).toBe('single_choice');
    expect(inferType(4, 'A, C').type).toBe('multiple_choice');
  });

  it('prefers true/false over numeric for a bare 1, because 1 is a boolean spelling', () => {
    expect(inferType(0, '1').type).toBe('true_false');
    expect(inferType(0, 'TRUE').type).toBe('true_false');
  });

  it('reads a number as numeric and anything else as fill-in-the-blank', () => {
    expect(inferType(0, '60').type).toBe('numeric');
    expect(inferType(0, '3.14 | 3.14 approx').type).toBe('fill_blank');
  });

  it('always explains itself, because an inference is what a reviewer should check', () => {
    // Worded for every format since Phase D moved this to `lib/importAnswerText.ts` — a Word
    // document has no "Type column" to be blank.
    expect(inferType(4, 'A').note).toMatch(/no question type was given/i);
  });
});

describe('format detection', () => {
  it('recognises a real workbook, and a Word document that is not one', async () => {
    const bytes = await standardSheet([mcqRow()]);
    expect(looksLikeWorkbook(bytes)).toBe(true);
    expect(looksLikeWordDocument(bytes)).toBe(false);
  });

  it('refuses a zip that is not a workbook', async () => {
    // Both formats begin `PK\x03\x04`, so the magic-byte check in `uploadSchemas.ts` cannot tell
    // them apart — this is the authoritative check, and it inflates nothing to make it.
    const notAWorkbook = await workbookBytes([{ rows: [['x']] }]);
    // `split/join` rather than `replace`: a zip names each entry **twice** (the local header and
    // the central directory), and a string-pattern `replace` rewrites only the first — leaving
    // the marker still present and this test asserting nothing.
    const mangled = Buffer.from(
      notAWorkbook.toString('latin1').split('xl/workbook.xml').join('xl/notabook.xml'),
      'latin1',
    );
    expect(looksLikeWorkbook(mangled)).toBe(false);

    await expect(
      excelImportParser.parse({
        file: { name: 'q.xlsx', kind: 'excel', declaredType: XLSX_MIME, bytes: mangled },
        defaults: DEFAULTS,
        maxCandidates: 10,
      }),
    ).rejects.toThrow(/not an Excel workbook/i);
  });
});

// ---------------------------------------------------------------------------
// Reading a workbook end to end
// ---------------------------------------------------------------------------

describe('reading a workbook', () => {
  it('imports the five question types from one sheet', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([
      mcqRow(),
      mcqRow({
        Question: 'Which of the following are prime numbers?',
        Type: 'multiple_choice',
        'Option A': '$17$',
        'Option B': '$21$',
        'Option C': '$23$',
        'Option D': '$27$',
        'Correct Answer': 'A, C',
        Solution: '$17$ and $23$ have no other divisors.',
      }),
      mcqRow({
        Question: 'The sum of the angles of a triangle is $180$ degrees.',
        Type: 'true_false',
        'Option A': '',
        'Option B': '',
        'Option C': '',
        'Option D': '',
        'Correct Answer': 'TRUE',
        Solution: 'The angle sum of any Euclidean triangle is $180$ degrees.',
      }),
      mcqRow({
        Question: 'A train travels $180$ km in $3$ hours. What is its average speed in km/h?',
        Type: 'numeric',
        'Option A': '',
        'Option B': '',
        'Option C': '',
        'Option D': '',
        'Correct Answer': '60',
        Solution: 'Average speed is $\\frac{180}{3} = 60$ km/h.',
        Tolerance: 0,
      }),
      mcqRow({
        Question: 'The value of $\\pi$ to two decimal places is ____.',
        Type: 'fill_blank',
        'Option A': '',
        'Option B': '',
        'Option C': '',
        'Option D': '',
        'Correct Answer': '3.14 | 3.14 approx',
        Solution: '$\\pi$ is $3.14159\\ldots$, so $3.14$ to two places.',
      }),
    ]);

    const body = await upload(cookies, taxonomy, bytes);

    expect(body.questions).toHaveLength(5);
    expect(body.questions.map((q) => q.type)).toEqual([
      'single_choice',
      'multiple_choice',
      'true_false',
      'numeric',
      'fill_blank',
    ]);
    expect(body.rejected).toHaveLength(0);
    expect(body.failures).toHaveLength(0);
    // Uploading still writes nothing — the Phase B property, re-asserted with a real file.
    expect(await Question.countDocuments({})).toBe(0);
  });

  it('records the answer key correctly for each type', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([
      mcqRow({ 'Correct Answer': 'C' }),
      mcqRow({
        Question: 'Which of these are even?',
        Type: 'multiple_choice',
        'Option A': '$2$',
        'Option B': '$3$',
        'Option C': '$4$',
        'Option D': '$5$',
        'Correct Answer': 'A and C',
      }),
    ]);

    const body = await upload(cookies, taxonomy, bytes);

    const first = body.questions[0] as { options: Array<{ text: string; isCorrect: boolean }> };
    expect(first.options.map((o) => o.isCorrect)).toEqual([false, false, true, false]);

    const second = body.questions[1] as { options: Array<{ isCorrect: boolean }> };
    expect(second.options.map((o) => o.isCorrect)).toEqual([true, false, true, false]);
  });

  it('does not care about column order', async () => {
    const { cookies, taxonomy } = await adminSetup();
    // An examiner exports from whatever they already have; demanding an order would mean doing
    // the import twice.
    const bytes = await workbookBytes([
      {
        name: 'Questions',
        rows: [
          ['Solution', 'Correct Answer', 'Option B', 'Option A', 'Question'],
          ['Because $2+2=4$.', 'B', '$5$', '$4$', 'What is $2 + 2$?'],
        ],
      },
    ]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    const question = body.questions[0] as { options: Array<{ text: string; isCorrect: boolean }> };
    expect(question.options.map((o) => o.text)).toEqual(['$4$', '$5$']);
    expect(question.options[1]!.isCorrect).toBe(true);
  });

  it('matches headings loosely, and ignores extra columns', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await workbookBytes([
      {
        name: 'Questions',
        rows: [
          ['Q', 'A', 'B', 'Ans', 'Explanation', 'Chapter', 'Penalty', 'Reviewer initials'],
          ['What is $3 + 3$?', '$6$', '$7$', 'A', 'Add them.', 'Algebra', 2, 'RK'],
        ],
      },
    ]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]).toMatchObject({ negativeMarks: 2, topicName: 'Algebra' });
  });

  it('finds a header row below a title row', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await workbookBytes([
      {
        name: 'Questions',
        rows: [
          ['Class 8 Algebra — prepared March 2026'],
          [],
          HEADERS,
          mcqRow(),
        ],
      },
    ]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    // The row number is the real one in the file, so an examiner can find it.
    expect(body.questions[0]!.sourceRef).toBe('questions.xlsx — Row 4');
  });

  it('reads every sheet, and names the sheet when there is more than one', async () => {
    const { cookies, taxonomy } = await adminSetup();
    // A sheet per class is a normal way to organise questions; reading only the first would
    // silently import a fraction of the file.
    const bytes = await workbookBytes([
      { name: 'Class 8', rows: [HEADERS, mcqRow({ Question: 'What is $4 + 4$?', 'Correct Answer': 'A', 'Option A': '$8$', 'Option B': '$9$' })] },
      { name: 'Class 9', rows: [HEADERS, mcqRow({ Question: 'What is $\\sqrt{81}$?', 'Correct Answer': 'A', 'Option A': '$9$', 'Option B': '$8$' })] },
    ]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(2);
    expect(body.questions.map((q) => q.sourceRef)).toEqual([
      'questions.xlsx — Sheet "Class 8" row 2',
      'questions.xlsx — Sheet "Class 9" row 2',
    ]);
  });

  it('skips a sheet with no Question column without losing the workbook', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await workbookBytes([
      { name: 'Read me first', rows: [['These questions came from the 2025 paper.']] },
      { name: 'Questions', rows: [HEADERS, mcqRow()] },
    ]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    expect(body.failures[0]!.sourceRef).toContain('Read me first');
    expect(body.failures[0]!.reason).toMatch(/no question table was found/i);
  });

  it('ignores trailing blank rows rather than reporting fifty failures', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow(), [], [], ['', '', '', ''], []]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    expect(body.failures).toHaveLength(0);
    // `examined` counts rows that looked like questions, so the totals add up for a human.
    expect(body.examined).toBe(1);
  });

  it('reads a number, a boolean and a formula where text was expected', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await workbookBytes([
      {
        name: 'Questions',
        rows: [
          ['Question', 'Correct Answer', 'Solution', 'Marks'],
          // A numeric answer typed as a number, and marks as a number: both normal.
          ['A rope is $12$ m long. How many $3$ m pieces can be cut from it?', 4, { formula: 'X1', result: 'Divide $12$ by $3$.' }, 5],
        ],
      },
    ]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]).toMatchObject({ type: 'numeric', numericAnswer: 4, marks: 5 });
    expect(body.questions[0]!.solution).toBe('Divide $12$ by $3$.');
  });
});

// ---------------------------------------------------------------------------
// Failures — rows that cannot become a candidate
// ---------------------------------------------------------------------------

describe('row failures', () => {
  it('reports a missing correct answer with its row number', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow(), mcqRow({ Question: 'What is $7 \\times 8$?', 'Correct Answer': '' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    expect(body.failures).toHaveLength(1);
    // The spec's own example of a message worth giving.
    expect(body.failures[0]!.sourceRef).toBe('questions.xlsx — Row 3');
    expect(body.failures[0]!.reason).toMatch(/no correct answer/i);
  });

  it('reports an answer letter that matches no option', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ 'Correct Answer': 'E' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.failures[0]!.reason).toMatch(/does not match any option/i);
  });

  it('reports an unsupported question type by name', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ Type: 'short_answer' })]);

    const body = await upload(cookies, taxonomy, bytes);
    // There is deliberately no short-answer type — see the Milestone 18 ADR — so the message has
    // to say what *is* available rather than just refusing.
    expect(body.failures[0]!.reason).toMatch(/is not a question type/i);
    expect(body.failures[0]!.reason).toContain('fill_blank');
  });

  it('reports a Marks column containing a word instead of defaulting it', async () => {
    const { cookies, taxonomy } = await adminSetup();
    // A price that cannot be read is not something to default: marks are what a score is
    // computed from.
    const bytes = await standardSheet([mcqRow({ Marks: 'four' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.failures[0]!.reason).toMatch(/is not a number of marks/i);
  });

  it('reports a gap in the option columns rather than closing it', async () => {
    const { cookies, taxonomy } = await adminSetup();
    // Closing the gap would silently turn "the answer is C" into "the answer is B".
    const bytes = await standardSheet([mcqRow({ 'Option B': '', 'Correct Answer': 'C' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(0);
    expect(body.failures[0]!.reason).toMatch(/empty with a later one filled/i);
  });

  it('accepts trailing blank option columns, which are just unused', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ 'Option C': '', 'Option D': '', 'Correct Answer': 'A' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    expect((body.questions[0] as { options: unknown[] }).options).toHaveLength(2);
  });

  it('reports a row whose question is missing but which has other values', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ Question: '' })]);

    const body = await upload(cookies, taxonomy, bytes);
    // Not treated as a blank row: options with no question is a shifted column, worth naming.
    expect(body.failures[0]!.reason).toMatch(/did a column shift/i);
  });

  it('reports a true/false row whose answer is neither', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([
      mcqRow({
        Type: 'true_false',
        'Option A': '',
        'Option B': '',
        'Option C': '',
        'Option D': '',
        'Correct Answer': 'sometimes',
      }),
    ]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.failures[0]!.reason).toMatch(/not a true\/false answer/i);
  });

  it('rejects a corrupt or password-protected workbook by name, not by 500', async () => {
    const { cookies, taxonomy } = await adminSetup();
    /**
     * A buffer that passes every cheap check and still cannot be opened: the zip signature, and
     * the `xl/workbook.xml` entry name, followed by junk. That is the path worth testing —
     * truncating a real workbook at its midpoint removes the marker and exercises the *other*
     * branch, which is what the first version of this test did.
     */
    const unreadable = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('xl/workbook.xml'),
      Buffer.alloc(256, 9),
    ]);

    const body = await upload(cookies, taxonomy, unreadable);
    // A file that cannot be read is a named failure on that file, never a 500 and never a lost
    // batch.
    expect(body.success).toBe(true);
    expect(body.questions).toHaveLength(0);
    expect(body.files[0]!.error).toMatch(/could not be opened|password-protected|damaged/i);
  });
});

// ---------------------------------------------------------------------------
// Notes — things we interpreted, which never block anything
// ---------------------------------------------------------------------------

describe('notes', () => {
  it('notes an inferred type but still offers the question', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ Type: '' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]!.type).toBe('single_choice');
    const warnings = body.questions[0]!.warnings as Array<{ code: string; message: string }>;
    expect(warnings.some((w) => w.code === 'extraction_uncertain' && /no question type was given/i.test(w.message))).toBe(true);
  });

  it('notes a missing solution rather than refusing the row', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ Solution: '' })]);

    const body = await upload(cookies, taxonomy, bytes);
    // A draft may lack a solution; publishing may not. Telling the examiner now beats telling
    // them at publish time, two hundred questions later.
    expect(body.questions).toHaveLength(1);
    const warnings = body.questions[0]!.warnings as Array<{ message: string }>;
    expect(warnings.some((w) => /cannot be published/i.test(w.message))).toBe(true);
  });

  it('notes that options on a numeric row were ignored', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([
      mcqRow({
        Question: 'What is $9 \\times 9$?',
        Type: 'numeric',
        'Correct Answer': '81',
        Solution: 'Nine nines are eighty-one.',
      }),
    ]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    const warnings = body.questions[0]!.warnings as Array<{ message: string }>;
    expect(warnings.some((w) => /has no options, so they were ignored/i.test(w.message))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The screener still owns "is this a good question?"
// ---------------------------------------------------------------------------

describe('the shared screener, not the parser, judges the question', () => {
  it('rejects two correct options on a single-choice row with the author-facing message', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ 'Correct Answer': 'A, B' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(0);
    // The parser built the candidate faithfully; the one shared gate refused it, in the same
    // words a hand-authoring examiner would read.
    expect(body.rejected[0]!.reason).toMatch(/exactly one correct option/i);
  });

  it('rejects unbalanced LaTeX through the shared math validator', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ Question: 'What is $2 + 2 ?' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(0);
    expect(body.rejected).toHaveLength(1);
  });

  it('rejects negative marks above the marks awarded', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ Marks: 2, 'Negative Marks': 5 })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.rejected[0]!.reason).toMatch(/cannot exceed the marks/i);
  });

  it('detects duplicate rows within the workbook', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow(), mcqRow()]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    expect(body.duplicates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Per-row taxonomy, from a real file
// ---------------------------------------------------------------------------

describe('per-row taxonomy from a spreadsheet', () => {
  it('honours a Class column written as a bare number', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([
      mcqRow({ Class: 10 }),
      mcqRow({ Question: 'What is $6 \\times 6$?', 'Option A': '$36$', 'Option B': '$30$', 'Correct Answer': 'A', Class: '9th' }),
    ]);

    const body = await upload(cookies, taxonomy, bytes, { classLevel: 'Class 8' });
    expect(body.questions.map((q) => q.classLevel)).toEqual(['Class 10', 'Class 9']);
  });

  it('reports a Class of 13 with its row number, and imports the rest', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([
      mcqRow(),
      mcqRow({ Question: 'What is $5 \\times 5$?', 'Option A': '$25$', 'Option B': '$20$', 'Correct Answer': 'A', Class: 13 }),
    ]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]!.reason).toContain('Row 3');
    expect(body.rejected[0]!.reason).toMatch(/not a class this platform runs/i);
  });

  it('reports an unknown chapter and creates nothing', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ Topic: 'Thermodynamics' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.rejected[0]!.reason).toMatch(/no chapter called "Thermodynamics"/i);

    const topics = await request(app)
      .get(`${API}/topics?subject=${taxonomy.subjectId}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(topics.body.topics.map((t: { name: string }) => t.name)).not.toContain('Thermodynamics');
  });

  it('matches a chapter name case-insensitively', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ Topic: 'ALGEBRA' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions).toHaveLength(1);
    // The chapter's own spelling is shown back, not our lowercased lookup key.
    expect(body.questions[0]!.topicName).toBe('Algebra');
  });

  it('reads tags from a comma-separated column', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow({ Tags: 'quadratic, roots , factorising' })]);

    const body = await upload(cookies, taxonomy, bytes);
    expect(body.questions[0]!.tags).toEqual(['quadratic', 'roots', 'factorising']);
  });
});

// ---------------------------------------------------------------------------
// Limits and multiple files
// ---------------------------------------------------------------------------

describe('limits and multiple workbooks', () => {
  it('honours the configured ceiling across two workbooks and reports truncation', async () => {
    const { cookies, taxonomy } = await adminSetup();
    config.imports.maxQuestions = 2;

    const distinct = (n: number) =>
      mcqRow({
        Question: `Question about ${['perimeter', 'interest', 'factorisation', 'projection', 'determinant'][n % 5]} number ${n + 2}: what is $${n + 2} \\times ${n + 3}$?`,
        'Option A': `$${(n + 2) * (n + 3)}$`,
        'Option B': `$${(n + 2) * (n + 3) + 1}$`,
        'Option C': '',
        'Option D': '',
        'Correct Answer': 'A',
      });

    const a = await standardSheet([distinct(0), distinct(1), distinct(2)]);
    const b = await standardSheet([distinct(3), distinct(4)]);

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send({
        topic: taxonomy.topicId,
        classLevel: 'Class 8',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        files: [
          { name: 'a.xlsx', content: dataUrl(a) },
          { name: 'b.xlsx', content: dataUrl(b) },
        ],
      })
      .expect(200);

    const body = res.body as PreviewBody;
    expect(body.questions).toHaveLength(2);
    expect(body.truncated).toBe(true);
    // The second workbook was never read, and the record says so rather than pretending it was
    // empty.
    expect(body.files[1]!.error).toMatch(/reached its limit/i);
  });

  it('keeps a good workbook when another in the same upload is unreadable', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const good = await standardSheet([mcqRow()]);
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml'), Buffer.alloc(64, 9)]);

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send({
        topic: taxonomy.topicId,
        classLevel: 'Class 8',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        files: [
          { name: 'broken.xlsx', content: dataUrl(broken) },
          { name: 'good.xlsx', content: dataUrl(good) },
        ],
      })
      .expect(200);

    const body = res.body as PreviewBody;
    expect(body.questions).toHaveLength(1);
    expect(body.files[0]!.error).toBeTruthy();
    expect(body.files[1]!.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Approval, from a real file
// ---------------------------------------------------------------------------

describe('approving what a workbook produced', () => {
  it('saves as drafts and stamps excel_import provenance', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow()]);
    const preview = await upload(cookies, taxonomy, bytes);

    const res = await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions: preview.questions })
      .expect(201);

    expect(res.body.questions[0].status).toBe('draft');

    const saved = await Question.findOne({});
    expect(saved!.provenance.source).toBe('excel_import');
    expect(saved!.provenance.generatorId).toBe('excel');
    // No model read a spreadsheet, so nothing may claim one did.
    expect(saved!.provenance.generatorKind).toBe('deterministic');
    expect(saved!.provenance.modelName).toBeNull();
  });

  it('records the batch against the real parser', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow()]);
    const preview = await upload(cookies, taxonomy, bytes);

    const batch = await ImportBatch.findById(preview.batchId);
    expect(batch).toMatchObject({ kind: 'excel', parserId: 'excel', extraction: 'deterministic', accepted: 1 });
    expect(batch!.files[0]!.name).toBe('questions.xlsx');
    expect(batch!.files[0]!.size).toBe(bytes.length);
  });

  it('makes an imported question usable for practice once published', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await standardSheet([mcqRow()]);
    const preview = await upload(cookies, taxonomy, bytes);

    await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, publish: true, questions: preview.questions })
      .expect(201);

    // The point of the whole feature: an imported question is an ordinary question. Practice
    // availability is derived from published questions, so it appearing there is the proof that
    // nothing about the import made it a second-class row.
    const { cookies: studentCookies } = await registerVerifyLogin(app, {
      email: 'pupil.excel@example.com',
      mobile: '9800000456',
      classLevel: 'Class 8',
    });

    const options = await request(app)
      .get(`${API}/practice/options`)
      .set('Cookie', cookieHeader(studentCookies))
      .expect(200);

    const total = (options.body.subjects as Array<{ questionCount: number }>).reduce(
      (sum, entry) => sum + entry.questionCount,
      0,
    );
    expect(total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

describe('the Excel template', () => {
  it('is a real workbook that this importer can read back', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const template = await buildExcelTemplate();

    expect(looksLikeWorkbook(template)).toBe(true);

    /**
     * The strongest thing worth asserting about a template: **its own example rows import
     * cleanly into a deployment that has had nothing set up but one chapter.** A template whose
     * examples the parser refuses is worse than no template.
     *
     * That is why the examples leave `Topic` blank rather than naming 'Algebra' and 'Geometry' as
     * the first draft did — those chapters exist in this project's seed data and in nobody
     * else's, so every examiner's first import would have opened with five rejected rows telling
     * them a chapter did not exist. Blank means "use the chapter I chose when uploading", which
     * is what somebody trying the template out actually wants.
     */
    const body = await upload(cookies, taxonomy, template);

    // Every example row imports cleanly. The one failure is the template's own **Instructions**
    // sheet being skipped, which is the right outcome and the reason `findHeaderRow()` requires a
    // second question-ish column: that sheet's glossary begins with the literal word "Question",
    // and a one-match rule read its twelve rows of prose as questions.
    expect(body.rejected).toHaveLength(0);
    expect(body.questions).toHaveLength(5);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]!.sourceRef).toContain('Instructions');
    expect(body.questions.map((q) => q.type)).toEqual([
      'single_choice',
      'multiple_choice',
      'true_false',
      'numeric',
      'fill_blank',
    ]);
  });

  it('is served as a downloadable .xlsx to an administrator', async () => {
    const { cookies } = await adminSetup();

    const res = await request(app)
      .get(`${API}/admin/questions/import/excel/template`)
      .set('Cookie', cookieHeader(cookies))
      // Without this, supertest parses the body as text and `res.body` is not a Buffer.
      .responseType('blob')
      .expect(200);

    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
    expect(looksLikeWorkbook(Buffer.from(res.body as Uint8Array))).toBe(true);
  });

  it('is refused to a student on both URL prefixes', async () => {
    const { cookies } = await registerVerifyLogin(app, { email: 'nope@example.com', mobile: '9800000457' });

    for (const prefix of [API, ALIAS]) {
      const res = await request(app)
        .get(`${prefix}/admin/questions/import/excel/template`)
        .set('Cookie', cookieHeader(cookies));
      expect(res.status).toBe(403);
      expect(res.status).not.toBe(500);
    }
  });

  it('is advertised by the status route rather than hardcoded by the page', async () => {
    const { cookies } = await adminSetup();

    const res = await request(app)
      .get(`${API}/admin/questions/import`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.templates.excel).toBe('/admin/questions/import/excel/template');
    // Excel is registered now, which is the Phase C change to this route's answer.
    expect(res.body.parsers.some((p: { kind: string; available: boolean }) => p.kind === 'excel' && p.available)).toBe(true);
  });
});
