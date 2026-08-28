import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { ImportBatch, Question } from '../src/models';
import { splitIntoBlocks, docxImportParser, DOCX_CONVENTIONS } from '../src/services/docxImportParser';
import { containsWordEquations, looksLikeWordDocument } from '../src/lib/ooxml';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, cookieHeader, createAdminSession, registerVerifyLogin, clearTestInbox } from './helpers/auth';
import { createTaxonomy, type Taxonomy } from './helpers/questions';
import { buildDocx, docxDataUrl, DOCX_MIME, type DocxParagraph } from './helpers/docx';

/**
 * Milestone 21, Phase D — the DOCX importer.
 *
 * A `.docx` has **no schema**, so this parser is unavoidably a heuristic over document conventions.
 * That makes the tests a different kind of thing from the Excel ones: each is a statement about one
 * convention an examiner might really use, and the fixtures are built inline so the document a test
 * describes is readable next to its assertion.
 *
 * The property the whole suite circles is what the parser does when it is **unsure**:
 *
 *  - anything it had to interpret is a **note**, so a human compares it against the original;
 *  - anything it could not use is a **failure naming where it was**, never a silent drop;
 *  - if it cannot find questions at all, it says what it looked for rather than returning one
 *    enormous candidate containing the file.
 *
 * Two cases matter more than the rest, because both look like success when they go wrong:
 * **Word's automatic numbering**, which does not survive text extraction and would otherwise merge
 * every question into one; and **Word equation objects**, which `mammoth` drops silently, leaving a
 * question that imports looking complete with its formula missing from the middle of a sentence.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const ORIGINAL_MAX = config.imports.maxQuestions;

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
  config.imports.maxQuestions = ORIGINAL_MAX;
});

const DOCX_URL = `${API}/admin/questions/import/docx`;
const ALIAS = '/api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The conventional layout: a numbered question, lettered options, an answer, a solution. */
function conventionalQuestion(number: number, text: string, answer = 'B'): string[] {
  return [
    `Q${number}. ${text}`,
    '(a) $3$',
    '(b) $4$',
    '(c) $5$',
    '(d) $6$',
    `Answer: ${answer}`,
    'Solution: Add the two numbers together.',
  ];
}

interface PreviewBody {
  success: boolean;
  batchId: string;
  questions: Array<Record<string, unknown>>;
  rejected: Array<{ index: number; reason: string }>;
  duplicates: Array<{ index: number; reason: string }>;
  failures: Array<{ sourceRef: string; reason: string }>;
  batchWarnings: Array<{ code: string; message: string }>;
  files: Array<Record<string, unknown>>;
  examined: number;
  truncated: boolean;
}

async function adminSetup(): Promise<{ cookies: Record<string, string>; taxonomy: Taxonomy }> {
  const { cookies } = await createAdminSession(app);
  const taxonomy = await createTaxonomy(app, cookies);
  return { cookies, taxonomy };
}

/** Uploads one document built from these paragraphs and returns the preview. */
async function upload(
  cookies: Record<string, string>,
  taxonomy: Taxonomy,
  paragraphs: Array<string | DocxParagraph>,
  overrides: Record<string, unknown> = {},
): Promise<PreviewBody> {
  const bytes = await buildDocx(paragraphs);
  const res = await request(app)
    .post(DOCX_URL)
    .set('Cookie', cookieHeader(cookies))
    .send({
      topic: taxonomy.topicId,
      classLevel: 'Class 8',
      difficulty: 'Medium',
      marks: 4,
      negativeMarks: 1,
      files: [{ name: 'paper.docx', content: docxDataUrl(bytes) }],
      ...overrides,
    })
    .expect(200);
  return res.body as PreviewBody;
}

function warningTexts(body: PreviewBody): string {
  return body.batchWarnings.map((w) => w.message).join(' || ');
}

function noteTexts(question: Record<string, unknown>): string {
  return (question.warnings as Array<{ message: string }>).map((w) => w.message).join(' || ');
}

// ---------------------------------------------------------------------------
// Block splitting — the pure half
// ---------------------------------------------------------------------------

describe('splitIntoBlocks', () => {
  it('splits on explicit question markers and keeps the document numbering', () => {
    const { blocks, strategy } = splitIntoBlocks([
      'Q1. First question?',
      'Answer: A',
      'Q2. Second question?',
      'Answer: B',
    ]);

    expect(strategy).toBe('markers');
    expect(blocks.map((b) => b.label)).toEqual(['Question 1', 'Question 2']);
    // The document's own numbers, not our positions — so a message names what the examiner sees.
    expect(blocks[0]!.lines).toEqual(['First question?', 'Answer: A']);
  });

  it('accepts the many ways a question is numbered', () => {
    for (const [a, b] of [
      ['1. One?', '2. Two?'],
      ['1) One?', '2) Two?'],
      ['Q1. One?', 'Q2. Two?'],
      ['Q.1 One?', 'Q.2 Two?'],
      ['Question 1: One?', 'Question 2: Two?'],
      ['Ques 1 - One?', 'Ques 2 - Two?'],
    ]) {
      const { blocks, strategy } = splitIntoBlocks([a!, 'Answer: A', b!, 'Answer: B']);
      expect(strategy).toBe('markers');
      expect(blocks).toHaveLength(2);
    }
  });

  it('drops a title above the first question', () => {
    const { blocks } = splitIntoBlocks([
      'CLASS 8 ALGEBRA — PRACTICE PAPER',
      'Prepared March 2026',
      'Q1. First question?',
      'Answer: A',
      'Q2. Second?',
      'Answer: B',
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.lines).toEqual(['First question?', 'Answer: A']);
  });

  it('falls back to answer-terminated blocks when there are no numbers at all', () => {
    // This is what a document numbered with Word's automatic list feature looks like after text
    // extraction: the numbers are simply gone. A marker-only parser would see one question.
    const { blocks, strategy } = splitIntoBlocks([
      'What is $2 + 2$?',
      '(a) $3$',
      '(b) $4$',
      'Answer: B',
      'What is $3 \\times 3$?',
      '(a) $6$',
      '(b) $9$',
      'Answer: B',
    ]);

    expect(strategy).toBe('answers');
    expect(blocks).toHaveLength(2);
  });

  it('keeps a solution with its own question in the fallback strategy', () => {
    const { blocks } = splitIntoBlocks([
      'First question?',
      'Answer: A',
      'Solution: Because of this.',
      'Second question?',
      'Answer: B',
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.lines).toContain('Solution: Because of this.');
  });

  it('reports finding nothing rather than inventing a single giant block', () => {
    const { blocks, strategy } = splitIntoBlocks(['Just some prose.', 'And some more prose.']);
    expect(strategy).toBe('none');
    expect(blocks).toHaveLength(0);
  });

  it('does not mistake a question opening with a number for a marker', () => {
    // "2020 was a leap year" must not be read as question 2020 — the marker needs a terminator.
    const { blocks, strategy } = splitIntoBlocks([
      'Q1. Was 2020 a leap year?',
      'Answer: TRUE',
      'Q2. Is $17$ prime?',
      'Answer: TRUE',
    ]);
    expect(strategy).toBe('markers');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.lines[0]).toBe('Was 2020 a leap year?');
  });
});

// ---------------------------------------------------------------------------
// Reading a real document
// ---------------------------------------------------------------------------

describe('reading a Word document', () => {
  it('imports conventionally-formatted questions', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      ...conventionalQuestion(1, 'What is $2 + 2$?'),
      ...conventionalQuestion(2, 'What is $1 + 3$ exactly?'),
    ]);

    expect(body.questions).toHaveLength(2);
    expect(body.failures).toHaveLength(0);
    expect(body.questions[0]).toMatchObject({ type: 'single_choice', sourceRef: 'paper.docx — Question 1' });
    const options = body.questions[0]!.options as Array<{ text: string; isCorrect: boolean }>;
    expect(options.map((o) => o.text)).toEqual(['$3$', '$4$', '$5$', '$6$']);
    expect(options.map((o) => o.isCorrect)).toEqual([false, true, false, false]);
    // Nothing is saved by uploading — the property every phase re-asserts.
    expect(await Question.countDocuments({})).toBe(0);
  });

  it('reads all five question types', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. Which of these is even?',
      '(a) $3$',
      '(b) $4$',
      'Answer: B',
      'Solution: $4$ is divisible by two.',
      'Q2. Which of these are prime?',
      'Type: multiple_choice',
      '(a) $17$',
      '(b) $21$',
      '(c) $23$',
      'Answer: A, C',
      'Solution: Neither has another divisor.',
      'Q3. The angle sum of a triangle is $180$ degrees.',
      'Type: true_false',
      'Answer: TRUE',
      'Solution: True in Euclidean geometry.',
      'Q4. A train covers $180$ km in $3$ hours. Find its speed in km/h.',
      'Type: numeric',
      'Answer: 60',
      'Solution: $180 \\div 3 = 60$.',
      'Q5. The value of $\\pi$ to two decimal places is ____.',
      'Type: fill_blank',
      'Answer: 3.14 | 3.14 approx',
      'Solution: $\\pi = 3.14159\\ldots$',
    ]);

    expect(body.failures).toHaveLength(0);
    expect(body.questions.map((q) => q.type)).toEqual([
      'single_choice',
      'multiple_choice',
      'true_false',
      'numeric',
      'fill_blank',
    ]);
    expect(body.questions[2]!.booleanAnswer).toBe(true);
    expect(body.questions[3]!.numericAnswer).toBe(60);
    expect(body.questions[4]!.acceptedAnswers).toEqual(['3.14', '3.14 approx']);
  });

  it('accepts the option styles a real paper uses', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. First question about $2+2$?',
      'a) $3$',
      'b) $4$',
      'Answer: b',
      'Solution: Add them.',
      'Q2. Second question about $3+3$?',
      '(1) $5$',
      '(2) $6$',
      'Answer: 2',
      'Solution: Add them.',
      'Q3. Third question about $4+4$?',
      'A. $7$',
      'B. $8$',
      'Answer: B',
      'Solution: Add them.',
    ]);

    expect(body.failures).toHaveLength(0);
    expect(body.questions).toHaveLength(3);
    for (const question of body.questions) {
      const options = question.options as Array<{ isCorrect: boolean }>;
      // In every style the second option is the correct one.
      expect(options.map((o) => o.isCorrect)).toEqual([false, true]);
    }
  });

  it('accepts the answer and solution labels a real paper uses', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. First question about $2+2$?',
      '(a) $3$',
      '(b) $4$',
      'Ans - B',
      'Explanation: Add them.',
      'Q2. Second question about $9+9$?',
      '(a) $17$',
      '(b) $18$',
      'Correct option: (b)',
      'Working: Add them.',
    ]);

    expect(body.failures).toHaveLength(0);
    expect(body.questions).toHaveLength(2);
    expect(body.questions[0]!.solution).toBe('Add them.');
  });

  it('joins a stem and an option that Word wrapped across paragraphs', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. A shopkeeper buys $12$ apples for $60$ rupees',
      'and sells them at $6$ rupees each. What is the profit?',
      '(a) $12$ rupees, which is a',
      'twenty per cent margin',
      '(b) $6$ rupees',
      'Answer: A',
      'Solution: Cost is $60$, revenue is $72$.',
    ]);

    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]!.questionText).toContain('sells them at');
    const options = body.questions[0]!.options as Array<{ text: string }>;
    expect(options[0]!.text).toBe('$12$ rupees, which is a twenty per cent margin');
  });

  it('reads metadata lines and uses them per question', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(
      cookies,
      taxonomy,
      [
        'Q1. What is $2 + 2$?',
        'Class: 10',
        'Difficulty: Hard',
        'Marks: 6',
        'Negative Marks: 2',
        'Topic: Algebra',
        'Tags: arithmetic, addition',
        '(a) $3$',
        '(b) $4$',
        'Answer: B',
        'Solution: Add them.',
      ],
      { classLevel: 'Class 8', difficulty: 'Medium' },
    );

    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]).toMatchObject({
      classLevel: 'Class 10',
      difficulty: 'Hard',
      marks: 6,
      negativeMarks: 2,
      topicName: 'Algebra',
    });
    expect(body.questions[0]!.tags).toEqual(['arithmetic', 'addition']);
    // A metadata line must not end up in the question text.
    expect(body.questions[0]!.questionText).toBe('What is $2 + 2$?');
  });

  it('leaves an unrecognised label in the question text rather than swallowing it', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. Ravi says: the answer is four. Is he right about $2+2$?',
      '(a) Yes',
      '(b) No',
      'Answer: A',
      'Solution: He is right.',
    ]);

    // "Ravi says:" matches the metadata *shape* but not a known key, so it must stay part of the
    // question. Swallowing it would silently truncate the stem.
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0]!.questionText).toContain('Ravi says');
  });
});

// ---------------------------------------------------------------------------
// Word's automatic numbering
// ---------------------------------------------------------------------------

describe("Word's automatic numbering", () => {
  it('recovers a document whose numbers live in the list definitions, and says so', async () => {
    const { cookies, taxonomy } = await adminSetup();

    // The numbers are not in the text at all — this is what the toolbar produces.
    const body = await upload(cookies, taxonomy, [
      { text: 'What is $2 + 2$?', numbered: true },
      '(a) $3$',
      '(b) $4$',
      'Answer: B',
      'Solution: Add them.',
      { text: 'What is $5 \\times 5$?', numbered: true },
      '(a) $20$',
      '(b) $25$',
      'Answer: B',
      'Solution: Multiply.',
    ]);

    expect(body.questions).toHaveLength(2);
    // And the reviewer is told why the boundaries might be wrong, and how to fix the cause.
    expect(warningTexts(body)).toMatch(/no question numbers were found/i);
    expect(warningTexts(body)).toMatch(/automatic numbering does not survive/i);
  });

  it('does not warn about numbering when the document really is numbered', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      ...conventionalQuestion(1, 'What is $2 + 2$?'),
      ...conventionalQuestion(2, 'What is $1 + 3$ exactly?'),
    ]);

    expect(warningTexts(body)).not.toMatch(/no question numbers were found/i);
  });
});

// ---------------------------------------------------------------------------
// Word equations — the silent loss
// ---------------------------------------------------------------------------

describe('Word equation objects', () => {
  it('warns that equations were dropped, naming the fix', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      { text: 'Q1. Solve the following: ', equation: true },
      '(a) $3$',
      '(b) $4$',
      'Answer: B',
      'Solution: Solve it.',
      ...conventionalQuestion(2, 'What is $7 + 7$ exactly?'),
    ]);

    // The question still imports — a document may have one equation in a heading and a hundred
    // readable questions, so refusing the file would help nobody.
    expect(body.questions.length).toBeGreaterThan(0);
    // But the loss is stated, because otherwise it looks like success with a formula missing.
    expect(warningTexts(body)).toMatch(/equation editor/i);
    expect(warningTexts(body)).toMatch(/retype the mathematics/i);
  });

  it('detects the markup itself', async () => {
    const withEquation = await buildDocx([{ text: 'Solve: ', equation: true }]);
    const without = await buildDocx(['Solve $x^2 = 4$']);

    expect(containsWordEquations(withEquation)).toBe(true);
    expect(containsWordEquations(without)).toBe(false);
    expect(looksLikeWordDocument(withEquation)).toBe(true);
  });

  it('says it once for ten documents, not ten times', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await buildDocx([
      { text: 'Q1. Solve: ', equation: true },
      '(a) $3$',
      '(b) $4$',
      'Answer: B',
      'Solution: Solve it.',
    ]);

    const res = await request(app)
      .post(DOCX_URL)
      .set('Cookie', cookieHeader(cookies))
      .send({
        topic: taxonomy.topicId,
        classLevel: 'Class 8',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        files: [
          { name: 'a.docx', content: docxDataUrl(bytes) },
          { name: 'b.docx', content: docxDataUrl(bytes) },
        ],
      })
      .expect(200);

    const equationWarnings = (res.body as PreviewBody).batchWarnings.filter((w) =>
      /equation editor/i.test(w.message),
    );
    expect(equationWarnings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Failures and notes
// ---------------------------------------------------------------------------

describe('when the document cannot be interpreted', () => {
  it('reports finding no questions, and says what it looked for', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Minutes of the syllabus committee, March 2026.',
      'The committee agreed to review the algebra chapter.',
    ]);

    expect(body.questions).toHaveLength(0);
    expect(body.failures).toHaveLength(1);
    // Actionable, not "could not parse": the examiner is told the conventions.
    expect(body.failures[0]!.reason).toMatch(/number each question/i);
    expect(body.failures[0]!.reason).toMatch(/answer/i);
  });

  it('reports a question with no answer, naming it', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      ...conventionalQuestion(1, 'What is $2 + 2$?'),
      'Q2. What is $8 \\times 8$?',
      '(a) $63$',
      '(b) $64$',
      'Q3. What is $9 \\times 9$ exactly?',
      '(a) $80$',
      '(b) $81$',
      'Answer: B',
      'Solution: Multiply.',
    ]);

    expect(body.questions).toHaveLength(2);
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0]!.sourceRef).toBe('paper.docx — Question 2');
    expect(body.failures[0]!.reason).toMatch(/no answer was found/i);
  });

  it('reports an answer that matches no option', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. What is $2 + 2$?',
      '(a) $3$',
      '(b) $4$',
      'Answer: D',
      'Solution: Add them.',
      'Q2. What is $6 + 6$?',
      '(a) $11$',
      '(b) $12$',
      'Answer: B',
      'Solution: Add them.',
    ]);

    expect(body.failures[0]!.reason).toMatch(/does not match any option/i);
  });

  it('notes an inferred type', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. What is $2 + 2$?',
      '(a) $3$',
      '(b) $4$',
      'Answer: B',
      'Solution: Add them.',
    ]);

    expect(body.questions).toHaveLength(1);
    expect(noteTexts(body.questions[0]!)).toMatch(/no question type was given/i);
  });

  it('notes a missing solution rather than refusing the question', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. What is $2 + 2$?',
      '(a) $3$',
      '(b) $4$',
      'Answer: B',
      'Q2. What is $5 + 5$?',
      '(a) $9$',
      '(b) $10$',
      'Answer: B',
    ]);

    expect(body.questions).toHaveLength(2);
    expect(noteTexts(body.questions[0]!)).toMatch(/cannot be published/i);
  });

  it('notes an unusually long question, the symptom of a bad boundary', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const long = `Q1. ${'A very long preamble about a shopkeeper and his apples. '.repeat(30)}What is the profit?`;

    const body = await upload(cookies, taxonomy, [
      long,
      '(a) $12$',
      '(b) $6$',
      'Answer: A',
      'Solution: Work it out.',
      ...conventionalQuestion(2, 'What is $4 + 4$ exactly?'),
    ]);

    const long1 = body.questions.find((q) => (q.questionText as string).length > 1200);
    expect(long1).toBeTruthy();
    expect(noteTexts(long1!)).toMatch(/two questions were run together/i);
  });

  it('rejects an Excel workbook posted to the Word route, by name', async () => {
    const { cookies, taxonomy } = await adminSetup();
    // Both are ZIPs, so only the OOXML part inside distinguishes them.
    const notADocument = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('xl/workbook.xml'),
      Buffer.alloc(64, 7),
    ]);

    const res = await request(app)
      .post(DOCX_URL)
      .set('Cookie', cookieHeader(cookies))
      .send({
        topic: taxonomy.topicId,
        classLevel: 'Class 8',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        files: [{ name: 'sheet.docx', content: `data:${DOCX_MIME};base64,${notADocument.toString('base64')}` }],
      })
      .expect(200);

    expect((res.body as PreviewBody).files[0]!.error).toMatch(/Excel workbook.*use the Excel import/i);
  });

  it('keeps a good document when another in the same upload is unreadable', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const good = await buildDocx(conventionalQuestion(1, 'What is $2 + 2$?'));
    const broken = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('word/document.xml'),
      Buffer.alloc(128, 9),
    ]);

    const res = await request(app)
      .post(DOCX_URL)
      .set('Cookie', cookieHeader(cookies))
      .send({
        topic: taxonomy.topicId,
        classLevel: 'Class 8',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        files: [
          { name: 'broken.docx', content: docxDataUrl(broken) },
          { name: 'good.docx', content: docxDataUrl(good) },
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
// The shared gates still apply
// ---------------------------------------------------------------------------

describe('the shared screener and taxonomy rules still apply', () => {
  it('rejects two correct options on a single-choice question', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. What is $2 + 2$?',
      'Type: single_choice',
      '(a) $3$',
      '(b) $4$',
      'Answer: A, B',
      'Solution: Add them.',
    ]);

    expect(body.questions).toHaveLength(0);
    // Refused by the one shared gate, in the words a hand-authoring examiner would read.
    expect(body.rejected[0]!.reason).toMatch(/exactly one correct option/i);
  });

  it('reports a class the platform does not run, with the question number', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. What is $2 + 2$?',
      'Class: 13',
      '(a) $3$',
      '(b) $4$',
      'Answer: B',
      'Solution: Add them.',
      ...conventionalQuestion(2, 'What is $6 + 6$ exactly?'),
    ]);

    expect(body.questions).toHaveLength(1);
    expect(body.rejected[0]!.reason).toContain('Question 1');
    expect(body.rejected[0]!.reason).toMatch(/not a class this platform runs/i);
  });

  it('reports an unknown chapter and creates nothing', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      'Q1. What is $2 + 2$?',
      'Topic: Thermodynamics',
      '(a) $3$',
      '(b) $4$',
      'Answer: B',
      'Solution: Add them.',
    ]);

    expect(body.rejected[0]!.reason).toMatch(/no chapter called "Thermodynamics"/i);

    const topics = await request(app)
      .get(`${API}/topics?subject=${taxonomy.subjectId}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(topics.body.topics.map((t: { name: string }) => t.name)).not.toContain('Thermodynamics');
  });

  it('detects a duplicate against the same document', async () => {
    const { cookies, taxonomy } = await adminSetup();

    const body = await upload(cookies, taxonomy, [
      ...conventionalQuestion(1, 'A shopkeeper sells $12$ apples for $60$ rupees. Find the cost of one apple.'),
      ...conventionalQuestion(2, 'A shopkeeper sells $12$ apples for $60$ rupees. Find the cost of one apple.'),
    ]);

    expect(body.questions).toHaveLength(1);
    expect(body.duplicates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Approval and provenance
// ---------------------------------------------------------------------------

describe('approving what a document produced', () => {
  it('saves as drafts and stamps docx_import provenance', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await upload(cookies, taxonomy, conventionalQuestion(1, 'What is $2 + 2$?'));

    const res = await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions: preview.questions })
      .expect(201);

    expect(res.body.questions[0].status).toBe('draft');

    const saved = await Question.findOne({});
    expect(saved!.provenance.source).toBe('docx_import');
    expect(saved!.provenance.generatorId).toBe('docx');
    // No model read a Word file, so nothing may claim one did.
    expect(saved!.provenance.generatorKind).toBe('deterministic');
    expect(saved!.provenance.modelName).toBeNull();
  });

  it('records the batch as a docx import', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await upload(cookies, taxonomy, conventionalQuestion(1, 'What is $2 + 2$?'));

    const batch = await ImportBatch.findById(preview.batchId);
    expect(batch).toMatchObject({ kind: 'docx', parserId: 'docx', extraction: 'deterministic', accepted: 1 });
  });
});

// ---------------------------------------------------------------------------
// Availability and authorization
// ---------------------------------------------------------------------------

describe('availability and authorization', () => {
  it('is reported as available by the status route', async () => {
    const { cookies } = await adminSetup();

    const res = await request(app)
      .get(`${API}/admin/questions/import`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    const docx = (res.body.parsers as Array<{ kind: string; available: boolean; extraction: string }>).find(
      (p) => p.kind === 'docx',
    );
    expect(docx).toMatchObject({ available: true, extraction: 'deterministic' });
  });

  it('publishes the conventions it understands, as data rather than prose in a page', async () => {
    // Exported so the upload page and the parser cannot drift apart — the same reasoning as
    // generating the Excel template from `CLASS_LEVELS`.
    expect(DOCX_CONVENTIONS.join(' ')).toMatch(/Answer: B/);
    expect(DOCX_CONVENTIONS.join(' ')).toMatch(/Word equation objects/i);
  });

  it('refuses a student on both URL prefixes', async () => {
    const { cookies } = await registerVerifyLogin(app, { email: 'nodocx@example.com', mobile: '9800000789' });

    for (const prefix of [API, ALIAS]) {
      const res = await request(app)
        .post(`${prefix}/admin/questions/import/docx`)
        .set('Cookie', cookieHeader(cookies))
        .send({});
      expect(res.status).toBe(403);
      expect(res.status).not.toBe(500);
    }
  });

  it('refuses a .docx sent to the image route by extension', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const bytes = await buildDocx(conventionalQuestion(1, 'What is $2 + 2$?'));

    const res = await request(app)
      .post(`${API}/admin/questions/import/image`)
      .set('Cookie', cookieHeader(cookies))
      .send({
        topic: taxonomy.topicId,
        classLevel: 'Class 8',
        difficulty: 'Medium',
        marks: 4,
        negativeMarks: 1,
        files: [{ name: 'paper.docx', content: docxDataUrl(bytes) }],
      })
      .expect(400);

    expect(res.body.error).toMatch(/not an image/i);
  });

  it('exercises the parser directly for a file that is not OOXML at all', async () => {
    await expect(
      docxImportParser.parse({
        file: {
          name: 'x.docx',
          kind: 'docx',
          declaredType: DOCX_MIME,
          bytes: Buffer.from('PK not really anything'),
        },
        defaults: {
          classLevel: 'Class 8',
          difficulty: 'Medium',
          questionType: null,
          marks: 4,
          negativeMarks: 1,
          topicName: null,
        },
        maxCandidates: 10,
      }),
    ).rejects.toThrow(/not a Word document/i);
  });
});
