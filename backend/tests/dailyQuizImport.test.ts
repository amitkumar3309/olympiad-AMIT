import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { DailyChallenge, Question } from '../src/models';
import { dayKeyOf, shiftDay } from '../src/lib/competitionDay';
import { freezeClock, now, resetClock } from '../src/lib/clock';
import { quizWindow } from '../src/lib/dailyQuiz';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession } from './helpers/auth';
import { createQuestionVia, createTaxonomy, type Taxonomy } from './helpers/questions';

/**
 * Milestone 30, Phase 2 — loading weeks of Daily Quizzes from one file (brief §6.5).
 *
 * The import is the question importer with a calendar on top, so these tests are about
 * the calendar half: what a row's `Day` and `Classes` may say, what clashes, and what the
 * approval writes — plus the two new tabular formats, CSV and JSON, read through the
 * Excel parser's own row reader.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
beforeEach(() => freezeClock(new Date(quizWindow(dayKeyOf(new Date())).opensAt.getTime() + 12 * 60 * 60 * 1000)));
afterEach(async () => {
  resetClock();
  await clearTestDb();
  clearTestInbox();
});

const today = (): string => dayKeyOf(now());
const tomorrow = (): string => shiftDay(today(), -1);

async function seedAdmin(): Promise<{ admin: string; taxonomy: Taxonomy; adminCookies: Record<string, string> }> {
  const { cookies: adminCookies } = await createAdminSession(app, {
    firstName: 'Quiz',
    lastName: 'Admin',
    mobile: '9000000001',
    email: 'quiz-admin@example.com',
  });
  const taxonomy = await createTaxonomy(app, adminCookies);
  return { admin: cookieHeader(adminCookies), taxonomy, adminCookies };
}

const dataUrl = (type: string, text: string) => `data:${type};base64,${Buffer.from(text, 'utf8').toString('base64')}`;

/** One CSV line, quoted where it must be. */
const line = (cells: string[]) => cells.map((cell) => (/[",\n]/u.test(cell) ? `"${cell.replace(/"/gu, '""')}"` : cell)).join(',');

const HEADER = ['Day', 'Classes', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer', 'Solution', 'Difficulty'];

function row(overrides: Partial<Record<(typeof HEADER)[number], string>> = {}): string[] {
  const base: Record<string, string> = {
    Day: tomorrow(),
    Classes: '9-12',
    Question: 'What is $12 \\times 12$?',
    'Option A': '124',
    'Option B': '144',
    'Option C': '154',
    'Option D': '164',
    'Correct Answer': 'B',
    Solution: '$12 \\times 12 = 144$.',
    Difficulty: 'Easy',
    ...overrides,
  };
  return HEADER.map((heading) => base[heading] ?? '');
}

const csv = (...rows: string[][]) => [line([...HEADER]), ...rows.map(line)].join('\r\n');

function preview(admin: string, taxonomy: Taxonomy, kind: 'csv' | 'json', name: string, text: string) {
  const type = kind === 'csv' ? 'text/csv' : 'application/json';
  return request(app)
    .post(`${API}/admin/daily-quiz/import/${kind}`)
    .set('Cookie', admin)
    .send({ file: { name, content: dataUrl(type, text) }, topic: taxonomy.topicId });
}

interface PreviewRow {
  clientId: string;
  sourceRef: string;
  plan: { day: string; classMin: number; classMax: number } | null;
  question: Record<string, unknown>;
  problems: string[];
}

function approve(admin: string, batchId: string, rows: PreviewRow[]) {
  return request(app)
    .post(`${API}/admin/daily-quiz/import/approve`)
    .set('Cookie', admin)
    .send({
      batchId,
      rows: rows.map((entry) => ({
        clientId: entry.clientId,
        sourceRef: entry.sourceRef,
        day: entry.plan!.day,
        classMin: entry.plan!.classMin,
        classMax: entry.plan!.classMax,
        question: entry.question,
      })),
    });
}

describe('the template', () => {
  it('downloads as CSV and as JSON, dated from tomorrow, and imports as it stands', async () => {
    const { admin, taxonomy } = await seedAdmin();

    const csvRes = await request(app).get(`${API}/admin/daily-quiz/import/template?format=csv`).set('Cookie', admin).expect(200);
    expect(csvRes.headers['content-type']).toMatch(/text\/csv/);
    expect(csvRes.headers['content-disposition']).toMatch(/amit-daily-quiz-template\.csv/);
    expect(csvRes.text.startsWith('\uFEFFDay,Classes,Question')).toBe(true);
    expect(csvRes.text).toContain(tomorrow());

    const jsonRes = await request(app).get(`${API}/admin/daily-quiz/import/template?format=json`).set('Cookie', admin).expect(200);
    expect(JSON.parse(jsonRes.text)).toHaveLength(3);

    const res = await preview(admin, taxonomy, 'csv', 'template.csv', csvRes.text).expect(200);
    expect(res.body.summary).toEqual({ ready: 3, withProblems: 0, refused: 0 });
    expect(res.body.rows.map((entry: PreviewRow) => entry.plan?.classMin)).toEqual([3, 6, 9]);
  });
});

describe('previewing a quiz file', () => {
  it('writes nothing, and says what each row would become', async () => {
    const { admin, taxonomy } = await seedAdmin();
    const second = row({
      Day: shiftDay(today(), -2),
      Classes: 'All',
      Question: 'How many sides does a hexagon have?',
      'Option A': '5',
      'Option B': '6',
      'Option C': '7',
      'Option D': '8',
      Solution: 'A hexagon has six sides — "hex" means six.',
    });
    // Two different questions: the importer's own screener refuses a repeat within a file.
    const res = await preview(admin, taxonomy, 'csv', 'week.csv', csv(row(), second)).expect(200);

    expect(res.body.summary.ready).toBe(2);
    expect(res.body.rows[0]).toMatchObject({ sourceRef: 'week.csv — Row 2', plan: { day: tomorrow(), classMin: 9, classMax: 12 }, problems: [] });
    expect(res.body.rows[1].plan).toMatchObject({ classMin: 3, classMax: 12 });
    // The bank question takes the first class of the range, and the reviewer is told.
    expect(res.body.rows[0].question.classLevel).toBe('Class 9');
    expect(await Question.countDocuments({})).toBe(0);
    expect(await DailyChallenge.countDocuments({})).toBe(0);
  });

  it('reports every problem on the row it belongs to', async () => {
    const { admin, taxonomy, adminCookies } = await seedAdmin();

    // A quiz already on tomorrow for Class 10.
    const existing = await createQuestionVia(app, adminCookies, taxonomy, { classLevel: 'Class 10', questionText: 'What is $9^2$?', options: [
      { text: '81', isCorrect: true },
      { text: '18', isCorrect: false },
    ], solution: '$9 \\times 9 = 81$.' });
    await request(app)
      .post(`${API}/admin/daily-quiz`)
      .set('Cookie', admin)
      .send({ day: tomorrow(), classMin: 10, classMax: 10, questionId: existing.id })
      .expect(201);

    const res = await preview(
      admin,
      taxonomy,
      'csv',
      'problems.csv',
      csv(
        row({ Day: shiftDay(today(), 3), Question: 'Past day?' }),
        row({ Day: 'next friday', Question: 'Bad day?' }),
        row({ Classes: 'seniors', Day: shiftDay(today(), -4), Question: 'Bad range?' }),
        row({ Question: 'Clashes with the scheduled Class 10 quiz?' }),
        row({ Day: shiftDay(today(), -5), Classes: '6-8', Question: 'First for 6-8?' }),
        row({ Day: shiftDay(today(), -5), Classes: '8', Question: 'Second for class 8, same day?' }),
        row({ Day: shiftDay(today(), -6), Question: 'No solution here?', Solution: '' }),
        row({ Day: shiftDay(today(), -7), Question: 'Two answers?', 'Correct Answer': 'A, B' }),
      ),
    ).expect(200);

    const problemsFor = (text: string) =>
      (res.body.rows as PreviewRow[]).find((entry) => (entry.question.questionText as string).startsWith(text))?.problems.join(' ') ?? '';

    expect(problemsFor('Past day?')).toMatch(/in the past/);
    expect(problemsFor('Bad day?')).toMatch(/"next friday" is not a date/);
    expect(problemsFor('Bad range?')).toMatch(/"seniors" is not a class range/);
    expect(problemsFor('Clashes')).toMatch(/Class 10 already has a Daily Quiz/);
    expect(problemsFor('First for 6-8?')).toBe('');
    expect(problemsFor('Second for class 8')).toMatch(/overlaps problems\.csv — Row 6/);
    expect(problemsFor('No solution here?')).toMatch(/worked solution/);
    // Two correct options is refused by the question importer's own screener, by row.
    expect(res.body.refused.map((entry: { reason: string }) => entry.reason).join(' ')).toMatch(/Row 9.*exactly one correct/);
  });

  it('refuses a question file that has no Day or Classes column', async () => {
    const { admin, taxonomy } = await seedAdmin();
    const text = [line(['Question', 'Option A', 'Option B', 'Correct Answer', 'Solution']), line(['Q?', '1', '2', 'A', 'Because.'])].join('\n');
    const res = await preview(admin, taxonomy, 'csv', 'questions.csv', text);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rather than a Daily Quiz file/);
  });

  it('reads JSON, with an options array and an isCorrect flag', async () => {
    const { admin, taxonomy } = await seedAdmin();
    const json = JSON.stringify([
      {
        day: tomorrow(),
        classes: '6-8',
        question: 'What is 25% of 80?',
        options: [{ text: '15' }, { text: '20', isCorrect: true }, { text: '25' }, { text: '40' }],
        solution: '25% of 80 is $\\frac{1}{4} \\times 80 = 20$.',
      },
    ]);
    const res = await preview(admin, taxonomy, 'json', 'week.json', json).expect(200);
    expect(res.body.summary.ready).toBe(1);
    expect(res.body.rows[0].sourceRef).toBe('week.json — Question 1');
    const options = res.body.rows[0].question.options as Array<{ text: string; isCorrect: boolean }>;
    expect(options.find((option) => option.isCorrect)?.text).toBe('20');
  });

  it('refuses a file that is not text, or not JSON, before parsing it', async () => {
    const { admin, taxonomy } = await seedAdmin();
    const binary = await request(app)
      .post(`${API}/admin/daily-quiz/import/csv`)
      .set('Cookie', admin)
      .send({ file: { name: 'week.csv', content: `data:text/csv;base64,${Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]).toString('base64')}` }, topic: taxonomy.topicId });
    expect(binary.status).toBe(400);

    const notJson = await preview(admin, taxonomy, 'json', 'week.json', 'Day,Classes\n');
    expect(notJson.status).toBe(400);
  });
});

describe('approving a quiz file', () => {
  it('saves each question as a draft from the file, and schedules it', async () => {
    const { admin, taxonomy } = await seedAdmin();
    const previewed = await preview(admin, taxonomy, 'csv', 'week.csv', csv(row(), row({ Day: shiftDay(today(), -2), Classes: '3-5', Question: 'What is $6 + 7$?', 'Option A': '12', 'Option B': '13', 'Option C': '14', 'Option D': '15', Solution: '$6 + 7 = 13$.' }))).expect(200);
    const ready = (previewed.body.rows as PreviewRow[]).filter((entry) => entry.problems.length === 0);
    expect(ready).toHaveLength(2);

    const res = await approve(admin, previewed.body.batchId as string, ready).expect(200);
    expect(res.body.scheduled).toBe(2);
    expect(res.body.rows.map((entry: { status: string }) => entry.status)).toEqual(['scheduled', 'scheduled']);

    const questions = await Question.find({});
    expect(questions.map((question) => question.status)).toEqual(['draft', 'draft']);
    expect(questions.every((question) => question.provenance?.source === 'csv_import')).toBe(true);
    // 9–12 is four classes, 3–5 three.
    expect(await DailyChallenge.countDocuments({})).toBe(7);
  });

  it('re-checks every day at approval, and saves nothing for a row that now clashes', async () => {
    const { admin, taxonomy, adminCookies } = await seedAdmin();
    const previewed = await preview(admin, taxonomy, 'csv', 'week.csv', csv(row())).expect(200);

    // Somebody schedules tomorrow for Class 9 between the preview and the approval.
    const other = await createQuestionVia(app, adminCookies, taxonomy, { questionText: 'What is $5^2$?', options: [
      { text: '25', isCorrect: true },
      { text: '10', isCorrect: false },
    ], solution: '$5 \\times 5 = 25$.' });
    await request(app)
      .post(`${API}/admin/daily-quiz`)
      .set('Cookie', admin)
      .send({ day: tomorrow(), classMin: 9, classMax: 9, questionId: other.id })
      .expect(201);

    const res = await approve(admin, previewed.body.batchId as string, previewed.body.rows as PreviewRow[]).expect(200);
    expect(res.body.rows[0]).toMatchObject({ status: 'refused', reason: expect.stringMatching(/Class 9 already has a Daily Quiz/) });
    expect(await Question.countDocuments({ questionText: 'What is $12 \\times 12$?' })).toBe(0);
  });
});

describe('the question bank’s own import', () => {
  it('reads CSV through the same row reader as a spreadsheet', async () => {
    const { admin, taxonomy } = await seedAdmin();
    const text = [line(['Question', 'Option A', 'Option B', 'Correct Answer', 'Solution']), line(['What is $1 + 1$?', '2', '3', 'A', '$1 + 1 = 2$.'])].join('\n');
    const res = await request(app)
      .post(`${API}/admin/questions/import/csv`)
      .set('Cookie', admin)
      .send({ files: [{ name: 'bank.csv', content: dataUrl('text/csv', text) }], classLevel: 'Class 9', topic: taxonomy.topicId })
      .expect(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].sourceRef).toBe('bank.csv — Row 2');
    expect(res.body.questions[0].schedule).toBeNull();
  });
});
