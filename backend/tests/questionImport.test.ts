import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { ImportBatch, Question } from '../src/models';
import {
  normaliseClassLevel,
  normaliseDifficulty,
  previewImport,
  registerImportParser,
  resetImportParsers,
  IMPORT_HARD_MAX,
} from '../src/services/questionImportService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, cookieHeader, createAdminSession, registerVerifyLogin, clearTestInbox } from './helpers/auth';
import { createTaxonomy, createPublishedQuestion, type Taxonomy } from './helpers/questions';
import type {
  ImportParser,
  ImportedCandidate,
  ParseInput,
  ParseOutcome,
} from '../src/lib/importTypes';

/**
 * Milestone 21, Phase B — the shared bulk-import infrastructure.
 *
 * Three organising ideas, and most of the file serves them:
 *
 * 1. **Nothing is saved by uploading.** Several tests assert the question collection is still
 *    *empty* after a successful preview — the property the whole feature rests on, and the one
 *    that would silently regress into "imported as drafts".
 * 2. **A parser is never trusted, including on the way back.** Approval re-validates, because
 *    what it receives is whatever the review screen sent after the examiner corrected it. A test
 *    sends a candidate that parsed cleanly and was broken by the "correction", and asserts it is
 *    refused rather than saved.
 * 3. **A failure in one file must not lose the others.** The spec's requirement, and the reason
 *    `previewImport()` parses each file in its own `try` rather than letting one rejection take
 *    the batch.
 *
 * Nothing here reads a real spreadsheet: the format parsers arrive in Phases C–E, and this phase
 * is the pipeline they plug into. A **fake parser** registered through the same
 * `registerImportParser()` seam a real one uses is what makes the pipeline testable now — and,
 * more usefully, is what makes the *failure* paths testable at all: a parser that throws, a
 * parser that returns a row naming a class that does not exist, a parser that returns two
 * identical questions. None of those can be produced on demand from a real file.
 *
 * Class 3 and Class 4 are **not** exercised here. They are not valid classes yet — extending
 * `CLASS_LEVELS` is Phase J — and a test asserting today that "3" is refused would have to be
 * inverted then. The classes asserted are the ones that really exist, plus the invalid values
 * (`2`, `13`, `0`, negative) which stay invalid either way.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const ORIGINAL_MAX = config.imports.maxQuestions;

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
  resetImportParsers();
  config.imports.maxQuestions = ORIGINAL_MAX;
});

const ALIAS = '/api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal ZIP local-file-header, which is what an `.xlsx` and a `.docx` really start with. */
const ZIP_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 7)]);
/** A minimal PNG signature. */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function xlsxFile(name = 'questions.xlsx', bytes = ZIP_BYTES) {
  return { name, content: dataUrl(XLSX_MIME, bytes) };
}

/** One candidate as a parser would hand it over: content, a taxonomy hint, and a reference. */
function candidate(overrides: {
  text?: string;
  sourceRef?: string;
  classLevel?: string | null;
  topicName?: string | null;
  subtopicName?: string | null;
  difficulty?: string | null;
  notes?: string[];
  solution?: string | null;
  correctCount?: number;
} = {}): ImportedCandidate {
  const correct = overrides.correctCount ?? 1;
  return {
    content: {
      questionText: overrides.text ?? 'What is $2 + 2$?',
      type: 'single_choice',
      options: [
        { text: '$4$', isCorrect: correct >= 1 },
        { text: '$5$', isCorrect: correct >= 2 },
        { text: '$6$', isCorrect: false },
        { text: '$7$', isCorrect: false },
      ],
      booleanAnswer: null,
      numericAnswer: null,
      tolerance: null,
      acceptedAnswers: [],
      solution: overrides.solution === undefined ? 'Add them: $2 + 2 = 4$.' : overrides.solution,
      marks: 4,
      negativeMarks: 1,
      tags: ['arithmetic'],
    },
    taxonomy: {
      classLevel: overrides.classLevel ?? null,
      topicName: overrides.topicName ?? null,
      subtopicName: overrides.subtopicName ?? null,
      difficulty: overrides.difficulty ?? null,
    },
    sourceRef: overrides.sourceRef ?? 'Row 2',
    notes: overrides.notes ?? [],
  };
}

/**
 * Registers a fake Excel parser.
 *
 * `plan` is keyed by filename so one test can give three files three different fates — which is
 * exactly what the partial-failure property needs.
 */
function fakeExcelParser(
  plan: Record<string, ParseOutcome | Error> | ((input: ParseInput) => ParseOutcome | Error),
  options: { available?: boolean } = {},
): { calls: ParseInput[] } {
  const calls: ParseInput[] = [];

  const parser: ImportParser = {
    descriptor: {
      id: 'fake-excel',
      label: 'Fake Excel',
      kind: 'excel',
      extraction: 'deterministic',
      basis: 'A test double.',
    },
    isAvailable: () => options.available !== false,
    parse: (input) => {
      calls.push(input);
      const result = typeof plan === 'function' ? plan(input) : plan[input.file.name];
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result ?? { candidates: [], failures: [], examined: 0 });
    },
  };

  registerImportParser(parser);
  return { calls };
}

async function adminSetup(): Promise<{ cookies: Record<string, string>; taxonomy: Taxonomy }> {
  const { cookies } = await createAdminSession(app);
  const taxonomy = await createTaxonomy(app, cookies);
  return { cookies, taxonomy };
}

function importBody(taxonomy: Taxonomy, overrides: Record<string, unknown> = {}) {
  return {
    topic: taxonomy.topicId,
    classLevel: 'Class 8',
    difficulty: 'Medium',
    marks: 4,
    negativeMarks: 1,
    files: [xlsxFile()],
    ...overrides,
  };
}

const EXCEL_URL = `${API}/admin/questions/import/excel`;

// ---------------------------------------------------------------------------
// Class validation — the centralised list, read as a spreadsheet would write it
// ---------------------------------------------------------------------------

describe('class normalisation', () => {
  it('accepts a class exactly as the platform spells it', () => {
    expect(normaliseClassLevel('Class 8')).toBe('Class 8');
    expect(normaliseClassLevel('Class 12 - Science')).toBe('Class 12 - Science');
  });

  it('forgives capitalisation and spacing, which is what a spreadsheet really contains', () => {
    expect(normaliseClassLevel('  class 10  ')).toBe('Class 10');
    expect(normaliseClassLevel('CLASS 5')).toBe('Class 5');
  });

  it('reads a bare number, an ordinal and a "Grade" prefix', () => {
    // A `Class` column in a real workbook is very often just the digit.
    expect(normaliseClassLevel('8')).toBe('Class 8');
    expect(normaliseClassLevel('10th')).toBe('Class 10');
    expect(normaliseClassLevel('Grade 7')).toBe('Class 7');
    expect(normaliseClassLevel('std 6')).toBe('Class 6');
  });

  it.each(['13', '0', '-5', '2', '99', 'Class 13', 'Class 0', 'nursery', '', '   '])(
    'refuses %j rather than guessing at it',
    (value) => {
      // A class silently replaced by a default is a question served to the wrong children,
      // which is why an unrecognised value is reported instead of coerced.
      expect(normaliseClassLevel(value)).toBeNull();
    },
  );

  it('is not fuzzy beyond case and spacing', () => {
    expect(normaliseClassLevel('Clss 8')).toBeNull();
    expect(normaliseClassLevel('eight')).toBeNull();
  });

  it('reads a difficulty case-insensitively and nothing more', () => {
    expect(normaliseDifficulty('easy')).toBe('Easy');
    expect(normaliseDifficulty('  HARD ')).toBe('Hard');
    expect(normaliseDifficulty('medium-ish')).toBeNull();
    expect(normaliseDifficulty('impossible')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------

describe('upload validation', () => {
  it('accepts a real .xlsx and reports what was read', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': { candidates: [candidate()], failures: [], examined: 1 },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.examined).toBe(1);
    expect(res.body.files[0]).toMatchObject({ name: 'questions.xlsx', extracted: 1, failed: 0 });
  });

  it('refuses a file whose bytes are not really a workbook, however it is labelled', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    // The MIME type and the extension both say .xlsx; the bytes say plain text. The bytes win,
    // which is the whole point of checking them — a browser or a script controls the other two.
    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(
        importBody(taxonomy, {
          files: [{ name: 'evil.xlsx', content: dataUrl(XLSX_MIME, Buffer.from('not a zip at all')) }],
        }),
      )
      .expect(400);

    expect(res.body.error).toMatch(/not a valid Excel workbook/i);
  });

  it('refuses an unsupported extension', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [{ name: 'legacy.xls', content: dataUrl(XLSX_MIME, ZIP_BYTES) }] }))
      .expect(400);

    expect(res.body.error).toMatch(/not an Excel workbook/i);
  });

  it('refuses a Word document posted to the Excel endpoint, by name', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    // Both are ZIPs, so the signature cannot tell them apart — the per-format route is what
    // turns this into a message the examiner can act on.
    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [{ name: 'paper.docx', content: dataUrl(XLSX_MIME, ZIP_BYTES) }] }))
      .expect(400);

    expect(res.body.error).toMatch(/not an Excel workbook/i);
  });

  it('refuses a declared MIME type that is not a workbook at all', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [{ name: 'q.xlsx', content: dataUrl('text/html', ZIP_BYTES) }] }))
      .expect(400);
  });

  it('refuses a filename carrying a path separator', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    // Nothing here opens a file, so this is not what stops traversal — not writing to disk is.
    // It is refused because the name is echoed into reports and stored on the batch.
    for (const name of ['../../etc/passwd.xlsx', 'a/b.xlsx', 'a\\b.xlsx']) {
      const res = await request(app)
        .post(EXCEL_URL)
        .set('Cookie', cookieHeader(cookies))
        .send(importBody(taxonomy, { files: [{ name, content: dataUrl(XLSX_MIME, ZIP_BYTES) }] }))
        .expect(400);
      expect(res.body.error).toMatch(/filename/i);
    }
  });

  it('refuses an oversized file', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    const tooBig = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(6 * 1024 * 1024, 7)]);
    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [{ name: 'huge.xlsx', content: dataUrl(XLSX_MIME, tooBig) }] }))
      .expect(400);

    expect(res.body.error).toMatch(/larger than/i);
  });

  it('refuses more files than one batch may carry', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    const files = Array.from({ length: 21 }, (_v, i) => xlsxFile(`q${i}.xlsx`));
    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files }))
      .expect(400);

    expect(res.body.error).toMatch(/at most 20 files/i);
  });

  it('refuses two files of the same name, because every message would be ambiguous', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [xlsxFile('same.xlsx'), xlsxFile('same.xlsx')] }))
      .expect(400);

    expect(res.body.error).toMatch(/same name/i);
  });

  it('refuses an empty file list', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [] }))
      .expect(400);
  });

  it('accepts an image only on the image route', async () => {
    const { cookies, taxonomy } = await adminSetup();

    /**
     * A **503 about the deployment**, not a 400 about the file — the file was fine.
     *
     * Which 503 changed in Phase E and the difference is worth keeping: before it, no image parser
     * existed and the message was "not available in this deployment". Now one is registered and
     * reports itself unconfigured, so the message names what to set instead. Both are the same
     * answer to the same question ("the examiner is not at fault"), and this asserts the current,
     * more useful one. `GEMINI_API_KEY` is absent in the test environment, which is the point:
     * **no other format may depend on a model credential**, and the sibling assertions in
     * `imageImport.test.ts` pin that Excel and DOCX stay available without one.
     */
    const res = await request(app)
      .post(`${API}/admin/questions/import/image`)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [{ name: 'page.png', content: dataUrl('image/png', PNG_BYTES) }] }))
      .expect(503);

    expect(res.body.error).toMatch(/not configured/i);
  });
});

// ---------------------------------------------------------------------------
// Nothing is stored by uploading
// ---------------------------------------------------------------------------

describe('previewing writes no questions', () => {
  it('returns candidates and leaves the bank empty', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': {
        candidates: [candidate({ text: 'What is $3 + 3$?' }), candidate({ text: 'What is $9 \\times 9$?' })],
        failures: [],
        examined: 2,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.questions).toHaveLength(2);
    // The property the whole feature rests on.
    expect(await Question.countDocuments({})).toBe(0);
  });

  it('writes exactly one ImportBatch row, and no audit entry', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': { candidates: [candidate()], failures: [], examined: 1 },
    });

    await request(app).post(EXCEL_URL).set('Cookie', cookieHeader(cookies)).send(importBody(taxonomy)).expect(200);

    const batches = await ImportBatch.find({});
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ kind: 'excel', parserId: 'fake-excel', status: 'succeeded', accepted: 1 });
    // Diagnostic, not administrative: nothing about the bank changed, so there is nothing to
    // audit. The same division `GenerationLog` draws.
    expect(batches[0]!.modelName).toBeNull();
  });

  it('records a deterministic parser as deterministic, never as a model', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({ 'questions.xlsx': { candidates: [candidate()], failures: [], examined: 1 } });

    await request(app).post(EXCEL_URL).set('Cookie', cookieHeader(cookies)).send(importBody(taxonomy)).expect(200);

    const batch = await ImportBatch.findOne({});
    expect(batch!.extraction).toBe('deterministic');
  });
});

// ---------------------------------------------------------------------------
// Taxonomy resolution — per row, from names, never creating anything
// ---------------------------------------------------------------------------

describe('taxonomy resolution', () => {
  it('falls back to the examiner defaults when a row says nothing', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({ 'questions.xlsx': { candidates: [candidate()], failures: [], examined: 1 } });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { classLevel: 'Class 10', difficulty: 'Hard' }))
      .expect(200);

    expect(res.body.questions[0]).toMatchObject({
      classLevel: 'Class 10',
      difficulty: 'Hard',
      topic: taxonomy.topicId,
    });
  });

  it("honours a row's own class, topic and difficulty over the defaults", async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': {
        // `10` rather than `12`: there is no plain "Class 12" until Phase J collapses the
        // three Class-12 streams, and a test asserting today's list is the honest one.
        candidates: [candidate({ classLevel: '10', topicName: 'Algebra', difficulty: 'easy' })],
        failures: [],
        examined: 1,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { classLevel: 'Class 8' }))
      .expect(200);

    expect(res.body.questions[0]).toMatchObject({
      classLevel: 'Class 10',
      difficulty: 'Easy',
      topicName: 'Algebra',
    });
  });

  it('reports a row naming a class that does not exist, rather than defaulting it', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': {
        candidates: [candidate({ classLevel: '13', sourceRef: 'Row 21' })],
        failures: [],
        examined: 1,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.questions).toHaveLength(0);
    expect(res.body.rejected).toHaveLength(1);
    // The reason names the row *and* what was wrong, which is what makes it fixable.
    expect(res.body.rejected[0].reason).toContain('Row 21');
    expect(res.body.rejected[0].reason).toMatch(/not a class this platform runs/i);
  });

  it('reports an unknown chapter and does not create it', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': {
        candidates: [candidate({ topicName: 'Astrophysics', sourceRef: 'Row 9' })],
        failures: [],
        examined: 1,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.rejected[0].reason).toMatch(/no chapter called "Astrophysics"/i);

    // An importer that could add taxonomy rows would let one bad spreadsheet reshape the
    // syllabus, so the chapter must still not exist.
    const topics = await request(app)
      .get(`${API}/topics?subject=${taxonomy.subjectId}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(topics.body.topics.map((t: { name: string }) => t.name)).not.toContain('Astrophysics');
  });

  it('refuses a subtopic that belongs to a different chapter', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': {
        candidates: [candidate({ subtopicName: 'Not A Real Subtopic' })],
        failures: [],
        examined: 1,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.rejected[0].reason).toMatch(/not a subtopic/i);
  });

  it('refuses a subtopic in the chapter field', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { topic: taxonomy.subtopicId }))
      .expect(400);

    expect(res.body.error).toMatch(/chapter, not a subtopic/i);
  });
});

// ---------------------------------------------------------------------------
// Validation and duplicate detection — the ONE shared screener
// ---------------------------------------------------------------------------

describe('screening', () => {
  it('refuses a candidate that fails the same schema a hand-authored question faces', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': {
        // Two correct options on a single-choice question: exactly what `refineQuestionAnswers`
        // rejects for an author, and it must reject it here too.
        candidates: [candidate({ correctCount: 2, sourceRef: 'Row 14' })],
        failures: [],
        examined: 1,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.questions).toHaveLength(0);
    expect(res.body.rejected[0].reason).toMatch(/exactly one correct option/i);
  });

  it('refuses unbalanced LaTeX through the shared math validator', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': {
        candidates: [candidate({ text: 'What is $2 + 2 ?' })],
        failures: [],
        examined: 1,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.questions).toHaveLength(0);
    expect(res.body.rejected).toHaveLength(1);
  });

  it('detects a duplicate within the uploaded file', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const text = 'A shopkeeper sells $12$ apples for $rupees 60$. What is the cost of one apple?';
    fakeExcelParser({
      'questions.xlsx': {
        candidates: [candidate({ text, sourceRef: 'Row 2' }), candidate({ text, sourceRef: 'Row 3' })],
        failures: [],
        examined: 2,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.questions).toHaveLength(1);
    expect(res.body.duplicates).toHaveLength(1);
  });

  it('detects a duplicate across two uploaded files', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const text = 'A train travels $180$ km in $3$ hours. What is its average speed in km/h?';
    fakeExcelParser({
      'a.xlsx': { candidates: [candidate({ text })], failures: [], examined: 1 },
      'b.xlsx': { candidates: [candidate({ text })], failures: [], examined: 1 },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [xlsxFile('a.xlsx'), xlsxFile('b.xlsx')] }))
      .expect(200);

    expect(res.body.questions).toHaveLength(1);
    expect(res.body.duplicates).toHaveLength(1);
  });

  it('detects a duplicate of a question already in the bank', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const existing = await createPublishedQuestion(app, cookies, taxonomy, { classLevel: 'Class 8' });
    expect(existing.id).toBeTruthy();

    fakeExcelParser({
      'questions.xlsx': {
        candidates: [
          candidate({ text: 'Solve for $x$: $x^2 - 5x + 6 = 0$. What is the larger root?' }),
        ],
        failures: [],
        examined: 1,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { classLevel: 'Class 8' }))
      .expect(200);

    expect(res.body.questions).toHaveLength(0);
    expect(res.body.duplicates).toHaveLength(1);
    expect(res.body.duplicates[0].reason).toMatch(/too similar/i);
  });

  it('carries a parser note through as an advisory warning, not a rejection', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': {
        candidates: [candidate({ notes: ['The answer column was blank; the first option was assumed.'] })],
        failures: [],
        examined: 1,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    // Still a candidate. A note tells the reviewer to look harder; it never throws a question
    // away, exactly as `lib/questionQuality.ts` annotates and never rejects.
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].warnings.map((w: { code: string }) => w.code)).toContain('extraction_uncertain');
  });
});

// ---------------------------------------------------------------------------
// Partial failure
// ---------------------------------------------------------------------------

describe('partial failure', () => {
  it('keeps every other file when one cannot be read at all', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'good1.xlsx': { candidates: [candidate({ text: 'What is $5 + 5$?' })], failures: [], examined: 1 },
      'broken.xlsx': new Error('That workbook is password-protected.'),
      'good2.xlsx': { candidates: [candidate({ text: 'What is $6 \\times 7$?' })], failures: [], examined: 1 },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(
        importBody(taxonomy, {
          files: [xlsxFile('good1.xlsx'), xlsxFile('broken.xlsx'), xlsxFile('good2.xlsx')],
        }),
      )
      .expect(200);

    // The spec's requirement: one failure must not discard the valid imports.
    expect(res.body.questions).toHaveLength(2);

    const broken = res.body.files.find((f: { name: string }) => f.name === 'broken.xlsx');
    // The parser's own words are kept: "corrupt", "encrypted" and "not really a workbook" need
    // three different fixes and only the parser knows which happened.
    expect(broken.error).toMatch(/password-protected/i);
    expect(broken.extracted).toBe(0);
  });

  it('reports a row the parser could not use, named by where it was', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'questions.xlsx': {
        candidates: [candidate()],
        failures: [{ sourceRef: 'Row 45', reason: 'No question text in column A.' }],
        examined: 2,
      },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.failures).toHaveLength(1);
    // Prefixed with the filename, because ten photographs all report "Question 1".
    expect(res.body.failures[0].sourceRef).toBe('questions.xlsx — Row 45');
  });

  it('prefixes every source reference with its filename', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({
      'sheet-one.xlsx': { candidates: [candidate({ sourceRef: 'Row 2' })], failures: [], examined: 1 },
    });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [xlsxFile('sheet-one.xlsx')] }))
      .expect(200);

    expect(res.body.questions[0].sourceRef).toBe('sheet-one.xlsx — Row 2');
  });
});

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

describe('import limits', () => {
  it('stops at the configured ceiling and says the batch was truncated', async () => {
    const { cookies, taxonomy } = await adminSetup();
    config.imports.maxQuestions = 3;

    /**
     * Distinct *vocabulary*, not just distinct numbers.
     *
     * The first version of this test generated "Question number 0 asks about $0 + 0$" and so on,
     * and got one question back rather than three — `fingerprint()` drops single-character
     * tokens, so every row reduced to the same five words and the de-duplicator was right to
     * refuse them. A reminder that the duplicate threshold is about wording, not digits.
     */
    const SUBJECTS = ['triangle perimeter', 'compound interest', 'prime factorisation', 'vector projection', 'matrix determinant'];
    fakeExcelParser((input) => ({
      // A real parser honours `maxCandidates`; this asserts the ceiling reaches it.
      candidates: Array.from({ length: input.maxCandidates }, (_v, i) =>
        candidate({ text: `Compute the ${SUBJECTS[i % SUBJECTS.length]} described here: $${i + 2} \\cdot ${i + 3}$` }),
      ),
      failures: [],
      examined: 50,
    }));

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(200);

    expect(res.body.questions).toHaveLength(3);
    expect(res.body.truncated).toBe(true);
  });

  it('passes the remaining allowance to each successive file', async () => {
    const { cookies, taxonomy } = await adminSetup();
    config.imports.maxQuestions = 5;

    const spy = fakeExcelParser({
      'a.xlsx': {
        candidates: [candidate({ text: 'What is $11 + 11$?' }), candidate({ text: 'What is $12 + 12$?' })],
        failures: [],
        examined: 2,
      },
      'b.xlsx': { candidates: [candidate({ text: 'What is $13 + 13$?' })], failures: [], examined: 1 },
    });

    await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy, { files: [xlsxFile('a.xlsx'), xlsxFile('b.xlsx')] }))
      .expect(200);

    expect(spy.calls[0]!.maxCandidates).toBe(5);
    // Two were taken by the first file, so the second may return at most three.
    expect(spy.calls[1]!.maxCandidates).toBe(3);
  });

  it('caps the ceiling in code, not only in configuration', async () => {
    // A review step nobody can realistically finish is not a review step, so the environment
    // may lower the limit but never raise it past the hard maximum.
    config.imports.maxQuestions = 100_000;
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser((input) => {
      expect(input.maxCandidates).toBeLessThanOrEqual(IMPORT_HARD_MAX);
      return { candidates: [], failures: [], examined: 0 };
    });

    await request(app).post(EXCEL_URL).set('Cookie', cookieHeader(cookies)).send(importBody(taxonomy)).expect(200);
  });
});

// ---------------------------------------------------------------------------
// Approval — the only writer
// ---------------------------------------------------------------------------

/** Uploads, then returns the batch id and the candidates the review screen would hold. */
async function previewVia(
  cookies: Record<string, string>,
  taxonomy: Taxonomy,
  candidates: ImportedCandidate[],
  overrides: Record<string, unknown> = {},
): Promise<{ batchId: string; questions: Array<Record<string, unknown>> }> {
  fakeExcelParser({ 'questions.xlsx': { candidates, failures: [], examined: candidates.length } });
  const res = await request(app)
    .post(EXCEL_URL)
    .set('Cookie', cookieHeader(cookies))
    .send(importBody(taxonomy, overrides))
    .expect(200);
  return { batchId: res.body.batchId, questions: res.body.questions };
}

describe('approval', () => {
  it('saves approved questions as drafts, never straight to published', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    const res = await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions: preview.questions })
      .expect(201);

    expect(res.body.questions).toHaveLength(1);
    // Importing is not publishing. The spec's requirement, and the editor's own rule.
    expect(res.body.questions[0].status).toBe('draft');
    expect(res.body.published).toBe(0);
  });

  it('stamps provenance from our own batch row, not from the request', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({
        batchId: preview.batchId,
        // A client claiming to be a human author. `source` is the one field worth lying about,
        // and it must not be readable from the body at all.
        questions: preview.questions.map((q) => ({ ...q, provenance: { source: 'human' }, source: 'human' })),
      })
      .expect(201);

    const saved = await Question.findOne({});
    expect(saved!.provenance.source).toBe('excel_import');
    expect(saved!.provenance.generatorId).toBe('fake-excel');
    expect(saved!.provenance.generatorKind).toBe('deterministic');
    // No model read a spreadsheet, so nothing may claim one did.
    expect(saved!.provenance.modelName).toBeNull();
    expect(saved!.provenance.reviewedByLabel).toBeTruthy();
  });

  it('re-validates on the way back, so a broken correction is refused', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    // The reviewer "corrected" the question by unticking the only correct option — the
    // commonest real edit mistake, and one that was valid when parsed.
    const broken = preview.questions.map((q) => ({
      ...q,
      options: (q.options as Array<{ text: string; isCorrect: boolean }>).map((o) => ({ ...o, isCorrect: false })),
    }));

    /**
     * 201 with an empty `questions` and a populated `rejected`, which is exactly what the
     * generator's approval route answers for the same situation. The status is about the request
     * having been processed; what matters — and what is asserted — is that **nothing was saved**
     * and the examiner is told which one failed and why.
     */
    const res = await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions: broken })
      .expect(201);

    expect(res.body.questions).toHaveLength(0);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].reason).toMatch(/correct option/i);
    expect(await Question.countDocuments({})).toBe(0);
  });

  it('saves the good ones and reports the bad ones in a mixed batch', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [
      candidate({ text: 'What is $8 + 8$?' }),
      candidate({ text: 'What is $9 + 9$?' }),
    ]);

    /**
     * The second one is broken in a way the *request* schema cannot see — an empty options array
     * is a perfectly well-formed body, and only `refineQuestionAnswers` knows a choice question
     * needs two. So it reaches the per-question gate inside `approveImport()`, which is the
     * partial-approval path this test exists for.
     */
    const questions = [preview.questions[0]!, { ...preview.questions[1]!, options: [] }];

    const res = await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions })
      .expect(201);

    // The good one is saved and the bad one is reported. Never all-or-nothing, and never
    // silently dropped.
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].index).toBe(2);
    expect(await Question.countDocuments({})).toBe(1);
  });

  it('refuses an approval naming a batch that does not exist', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    const res = await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: '0'.repeat(24), questions: preview.questions })
      .expect(400);

    // A missing batch is fatal here, unlike the generator's degraded stamp: the batch is also
    // where the subject comes from, so there is nothing to fall back to that would not be a guess.
    expect(res.body.error).toMatch(/expired or was never started/i);
    expect(await Question.countDocuments({})).toBe(0);
  });

  it('counts approvals against the batch', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [
      candidate({ text: 'What is $14 + 14$?' }),
      candidate({ text: 'What is $15 + 15$?' }),
    ]);

    await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions: preview.questions })
      .expect(201);

    const batch = await ImportBatch.findById(preview.batchId);
    expect(batch!.approved).toBe(2);
  });

  it('publishes through the editorial rule, so a question with no solution is refused', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate({ solution: null })]);

    const res = await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, publish: true, questions: preview.questions })
      .expect(201);

    // Saved as a draft, but not published: `changeQuestionStatus()` owns "a published question
    // must be explainable to a student", and an import must not be able to route around it.
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.published).toBe(0);
    expect(res.body.publishFailures[0].reason).toMatch(/solution/i);
  });

  it('publishes when asked and the question is publishable', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    const res = await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, publish: true, questions: preview.questions })
      .expect(201);

    expect(res.body.published).toBe(1);
    expect(res.body.questions[0].status).toBe('published');
  });

  it('writes an audit entry for an approval, describing the batch', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions: preview.questions })
      .expect(201);

    const audit = await request(app)
      .get(`${API}/admin/audit-logs?action=questions.imported`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(audit.body.entries).toHaveLength(1);
    expect(audit.body.entries[0].metadata.created).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

describe('the dry run', () => {
  it('says a clean batch would save, using the same screener approval uses', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    const res = await request(app)
      .post(`${API}/admin/questions/import/validate`)
      .set('Cookie', cookieHeader(cookies))
      .send({ questions: preview.questions })
      .expect(200);

    expect(res.body.wouldSave).toBe(1);
    expect(res.body.verdicts).toHaveLength(1);
    expect(res.body.verdicts[0]).toMatchObject({ index: 1, ok: true, reason: null });
  });

  /**
   * The property that makes the check worth having: **its answer is the answer approval gives.**
   *
   * A check that passed where the save would fail would be worse than no check at all, so this
   * sends one batch to both endpoints and asserts they agree — rather than asserting each in
   * isolation against a hand-written expectation, which is how two gates drift apart.
   */
  it('agrees with approval about a batch approval would refuse', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    // The commonest real edit mistake: unticking the only correct option.
    const broken = preview.questions.map((q) => ({
      ...q,
      options: (q.options as Array<{ text: string; isCorrect: boolean }>).map((o) => ({ ...o, isCorrect: false })),
    }));

    const dryRun = await request(app)
      .post(`${API}/admin/questions/import/validate`)
      .set('Cookie', cookieHeader(cookies))
      .send({ questions: broken })
      .expect(200);

    const approval = await request(app)
      .post(`${API}/admin/questions/import/approve`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions: broken })
      .expect(201);

    expect(dryRun.body.wouldSave).toBe(0);
    expect(dryRun.body.verdicts[0].ok).toBe(false);
    expect(approval.body.questions).toHaveLength(0);
    // Same rule, same words, from both endpoints.
    expect(dryRun.body.verdicts[0].reason).toBe(approval.body.rejected[0].reason);
  });

  it('writes nothing at all — not a question, and not a batch row', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);
    const batchesBefore = await ImportBatch.countDocuments({});

    await request(app)
      .post(`${API}/admin/questions/import/validate`)
      .set('Cookie', cookieHeader(cookies))
      .send({ questions: preview.questions })
      .expect(200);

    expect(await Question.countDocuments({})).toBe(0);
    // Not even a diagnostic row: an examiner may press this on every keystroke, and a row per
    // press would bury the imports that matter.
    expect(await ImportBatch.countDocuments({})).toBe(batchesBefore);
  });

  it('catches a question added to the bank since the preview', async () => {
    const { cookies, taxonomy } = await adminSetup();

    /**
     * The text has to carry real topical words, and that is a property of the shared
     * `similarity()` rather than of this test.
     *
     * Its fingerprint drops stop words and single characters, so the default fixture
     * `"What is $2 + 2$?"` reduces to the **empty set** — every word is either a stop word or a
     * lone digit — and an empty fingerprint scores 0 against everything. Very short questions are
     * therefore not duplicate-checked at all, which is a real and acceptable limitation (the
     * failure this exists for is a model or a spreadsheet re-emitting the *same worded* question),
     * but it makes a two-digit arithmetic question a useless fixture for asserting it.
     */
    const text = 'A shopkeeper buys twelve apples for sixty rupees and sells them at six rupees each. Find the profit.';
    const preview = await previewVia(cookies, taxonomy, [candidate({ text })]);

    // Somebody else authored the same question in the meantime. The bank is re-read rather than
    // trusted from the earlier preview, which is what makes this catchable at all.
    await createPublishedQuestion(app, cookies, taxonomy, { questionText: text, classLevel: 'Class 8' });

    const res = await request(app)
      .post(`${API}/admin/questions/import/validate`)
      .set('Cookie', cookieHeader(cookies))
      .send({ questions: preview.questions })
      .expect(200);

    expect(res.body.wouldSave).toBe(0);
    expect(res.body.verdicts[0].reason).toMatch(/too similar/i);
  });

  it('takes no batchId, because nothing is attributed to a batch', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    // A stray `batchId` is simply not in the schema, so it cannot reach the handler — the same
    // property every other schema in this feature relies on.
    const res = await request(app)
      .post(`${API}/admin/questions/import/validate`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, questions: preview.questions })
      .expect(200);

    expect(res.body.wouldSave).toBe(1);
  });

  it('refuses a student on both URL prefixes', async () => {
    const { cookies } = await registerVerifyLogin(app, { email: 'novalidate@example.com', mobile: '9800000931' });

    for (const prefix of [API, '/api']) {
      const res = await request(app)
        .post(`${prefix}/admin/questions/import/validate`)
        .set('Cookie', cookieHeader(cookies))
        .send({ questions: [] });
      expect(res.status).toBe(403);
      expect(res.status).not.toBe(500);
    }
  });
});

describe('rejection', () => {
  it('records what the examiner discarded and deletes nothing', async () => {
    const { cookies, taxonomy } = await adminSetup();
    const preview = await previewVia(cookies, taxonomy, [candidate()]);

    await request(app)
      .post(`${API}/admin/questions/import/reject`)
      .set('Cookie', cookieHeader(cookies))
      .send({ batchId: preview.batchId, count: 1 })
      .expect(200);

    const batch = await ImportBatch.findById(preview.batchId);
    expect(batch!.rejectedByReviewer).toBe(1);
    // Nothing was stored, so rejecting is genuinely just not approving.
    expect(await Question.countDocuments({})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('authorization', () => {
  it('refuses a student on every import route, on both URL prefixes', async () => {
    const { cookies: adminCookies, taxonomy } = await adminSetup();
    expect(taxonomy.topicId).toBeTruthy();
    const { cookies: studentCookies } = await registerVerifyLogin(app, {
      email: 'pupil@example.com',
      mobile: '9800000123',
    });

    const routes = [
      'import/excel',
      'import/docx',
      'import/image',
      'import/approve',
      'import/reject',
    ];

    for (const prefix of [API, ALIAS]) {
      for (const route of routes) {
        // `/api` is an alias for the same router, so a gate that held on only one prefix would
        // be bypassed by using the other.
        const res = await request(app)
          .post(`${prefix}/admin/questions/${route}`)
          .set('Cookie', cookieHeader(studentCookies))
          .send({});
        expect(res.status).toBe(403);
        expect(res.status).not.toBe(500);
      }

      const status = await request(app)
        .get(`${prefix}/admin/questions/import`)
        .set('Cookie', cookieHeader(studentCookies));
      expect(status.status).toBe(403);
    }

    // And the admin really can reach it, so the assertions above are about the gate rather than
    // about a route that does not exist.
    await request(app)
      .get(`${API}/admin/questions/import`)
      .set('Cookie', cookieHeader(adminCookies))
      .expect(200);
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(app).post(EXCEL_URL).send({});
    expect(res.status).toBe(401);
  });

  it('reports which formats this deployment can read', async () => {
    const { cookies } = await adminSetup();
    fakeExcelParser({});

    const res = await request(app)
      .get(`${API}/admin/questions/import`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    // Asserted on the Excel entry rather than on how many parsers exist: the registry gained DOCX
    // in Phase D and gains images in Phase E, and a count would have to be edited each time
    // without ever having said anything useful.
    const excel = (res.body.parsers as Array<{ kind: string }>).find((p) => p.kind === 'excel');
    expect(excel).toMatchObject({ kind: 'excel', available: true, extraction: 'deterministic' });
    expect(res.body.limits.maxFiles).toBe(20);
  });

  it('reports a registered but unconfigured parser as unavailable', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({}, { available: false });

    const res = await request(app)
      .post(EXCEL_URL)
      .set('Cookie', cookieHeader(cookies))
      .send(importBody(taxonomy))
      .expect(503);

    expect(res.body.error).toMatch(/not configured/i);
  });
});

// ---------------------------------------------------------------------------
// The service directly — the paths a route cannot reach
// ---------------------------------------------------------------------------

describe('previewImport() directly', () => {
  it('refuses an archived chapter', async () => {
    const { cookies, taxonomy } = await adminSetup();
    fakeExcelParser({});

    await request(app)
      .patch(`${API}/admin/topics/${taxonomy.topicId}`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'archived' })
      .expect(200);

    await expect(
      previewImport(
        {
          kind: 'excel',
          files: [{ name: 'q.xlsx', declaredType: XLSX_MIME, data: ZIP_BYTES }],
          topic: taxonomy.topicId,
          classLevel: 'Class 8',
          difficulty: 'Medium',
          marks: 4,
          negativeMarks: 1,
          questionType: null,
        },
        { id: null, label: 'Tester' },
      ),
    ).rejects.toThrow(/archived/i);
  });
});
