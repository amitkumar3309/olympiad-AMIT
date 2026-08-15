import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { GenerationLog, Question } from '../src/models';
import { setGeminiTransport, GEMINI_GENERATOR_ID } from '../src/services/geminiQuestionGenerator';
import { similarity, DUPLICATE_SIMILARITY_THRESHOLD } from '../src/services/questionGeneratorService';
import { gradeEntry, normalizeAnswerText } from '../src/services/grading';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, cookieHeader, createAdminSession, registerVerifyLogin, clearTestInbox } from './helpers/auth';
import { createTaxonomy, type Taxonomy } from './helpers/questions';

/**
 * Milestone 18 — AI question generation with review before approval.
 *
 * Two organising ideas, and most of the file serves them:
 *
 * 1. **Nothing is saved until a human approves it.** Several tests assert the question
 *    collection is still *empty* after generating — the property the whole milestone
 *    exists for, and the one that would silently regress into "saved as a draft".
 * 2. **A generator is never trusted, including on the way back.** The approval route
 *    re-validates, because what it receives is whatever the review screen sent after the
 *    examiner edited it. A test sends a candidate that was valid when generated and
 *    broken by the "edit", and asserts it is refused.
 *
 * Nothing touches the network: `setGeminiTransport()` is a test-only hook that throws
 * outside the test environment, and it is what makes the failure paths — a spent quota,
 * prose instead of JSON, a model ignoring the requested count — testable at all.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const ORIGINAL_KEY = config.ai.geminiApiKey;

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
  setGeminiTransport(null);
  config.ai.geminiApiKey = ORIGINAL_KEY;
});

const ALIAS = '/api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function geminiReplying(payload: unknown): void {
  setGeminiTransport(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] } }],
        }),
        { status: 200 },
      ),
    ),
  );
}

function enableGemini(): void {
  config.ai.geminiApiKey = 'test-key-not-a-real-credential';
}

/** A candidate that will pass validation, so a test can break one field at a time. */
function candidate(overrides: Record<string, unknown> = {}) {
  return {
    questionText: 'Solve for $x$: $x^2 - 5x + 6 = 0$. What is the larger root?',
    type: 'single_choice',
    options: [
      { text: '$x = 3$', isCorrect: true },
      { text: '$x = 2$', isCorrect: false },
      { text: '$x = 1$', isCorrect: false },
      { text: '$x = 6$', isCorrect: false },
    ],
    booleanAnswer: null,
    numericAnswer: null,
    tolerance: null,
    acceptedAnswers: [],
    solution: 'Factorise as $(x-2)(x-3)=0$, so the roots are $2$ and $3$; the larger is $3$.',
    marks: 4,
    negativeMarks: 1,
    tags: ['quadratic'],
    ...overrides,
  };
}

async function staffAndTaxonomy() {
  const { cookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
  const taxonomy = await createTaxonomy(app, cookies, { subject: 'Mathematics', topic: 'Algebra' });
  return { cookies, taxonomy };
}

async function generate(cookies: Record<string, string>, taxonomy: Taxonomy, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`${API}/admin/generate-questions`)
    .set('Cookie', cookieHeader(cookies))
    .send({
      subject: taxonomy.subjectId,
      chapters: [taxonomy.topicId],
      classLevel: 'Class 9',
      difficulty: 'Medium',
      questionType: 'single_choice',
      count: 2,
      marks: 4,
      negativeMarks: 1,
      optionCount: 4,
      ...body,
    });
}

async function approve(cookies: Record<string, string>, taxonomy: Taxonomy, questions: unknown[], body: Record<string, unknown> = {}) {
  return request(app)
    .post(`${API}/admin/generate-questions/approve`)
    .set('Cookie', cookieHeader(cookies))
    .send({
      subject: taxonomy.subjectId,
      topic: taxonomy.topicId,
      classLevel: 'Class 9',
      difficulty: 'Medium',
      questions,
      ...body,
    });
}

// ===========================================================================
// Nothing is saved without approval — the property the milestone exists for
// ===========================================================================

describe('generating', () => {
  it('returns candidates and saves absolutely nothing', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([candidate(), candidate({ questionText: 'What is $2^5$?', options: [
      { text: '$32$', isCorrect: true },
      { text: '$25$', isCorrect: false },
      { text: '$16$', isCorrect: false },
      { text: '$64$', isCorrect: false },
    ] })]);

    const res = await generate(cookies, taxonomy);

    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(2);
    expect(res.body.generator.id).toBe(GEMINI_GENERATOR_ID);
    expect(res.body.generator.kind).toBe('model');
    // The whole point. Milestone 17 would have written two drafts here.
    expect(await Question.countDocuments()).toBe(0);
  });

  it('refuses clearly when no API key is configured, and saves nothing', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    config.ai.geminiApiKey = undefined;

    const res = await generate(cookies, taxonomy);

    expect(res.status).toBe(503);
    // Actionable: this is nearly always an unset key, and the examiner can fix it.
    expect(res.body.error).toContain('GEMINI_API_KEY');
    expect(await Question.countDocuments()).toBe(0);
  });

  it('reports the provider’s own words when it fails, and saves nothing', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    setGeminiTransport(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Quota exceeded for generate_content_free_tier_requests' } }), { status: 429 }),
      ),
    );

    const res = await generate(cookies, taxonomy);

    // 502, not 500: this backend is fine, its provider is not.
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Quota exceeded');
    expect(await Question.countDocuments()).toBe(0);
  });

  it('records a log row on success and on failure', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([candidate()]);
    await generate(cookies, taxonomy, { count: 1 });

    setGeminiTransport(() => Promise.resolve(new Response(JSON.stringify({ error: { message: 'API key expired' } }), { status: 400 })));
    await generate(cookies, taxonomy, { count: 1 });

    const logs = await GenerationLog.find({}).sort({ createdAt: 1 });
    expect(logs).toHaveLength(2);
    expect(logs[0]!.status).toBe('succeeded');
    expect(logs[0]!.accepted).toBe(1);
    expect(logs[1]!.status).toBe('failed');
    expect(logs[1]!.error).toContain('API key expired');
    // Parameters and counts, never question text.
    expect(JSON.stringify(logs[0]!.toObject())).not.toContain('x^2 - 5x + 6');
  });

  it('sends no student data to the provider', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    await registerVerifyLogin(app);
    enableGemini();

    let sentBody = '';
    setGeminiTransport((_url, init) => {
      sentBody = String(init.body);
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([candidate()]) }] } }] }), { status: 200 }));
    });

    await generate(cookies, taxonomy, { count: 1 });

    expect(sentBody).toContain('Algebra');
    for (const leak of ['student@example.com', 'AMIT_', '9876543210', 'passwordHash']) {
      expect(sentBody).not.toContain(leak);
    }
  });

  it('passes every configured parameter into the prompt', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();

    let prompt = '';
    setGeminiTransport((_url, init) => {
      prompt = String(init.body);
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }), { status: 200 }));
    });

    await generate(cookies, taxonomy, {
      count: 3,
      difficulty: 'Hard',
      questionType: 'true_false',
      language: 'Hindi',
      bloomLevel: 'Analyse',
      marks: 6,
      instructions: 'Focus on word problems about cricket.',
    });

    for (const expected of ['Hard', 'true_false', 'Hindi', 'Analyse', 'cricket', 'Class 9', 'Algebra']) {
      expect(prompt).toContain(expected);
    }
  });
});

// ===========================================================================
// The model's output is not trusted
// ===========================================================================

describe('validation of candidates', () => {
  it('discards a forbidden LaTeX command and keeps the good one', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([candidate(), candidate({ questionText: 'See $\\href{http://evil.example}{here}$ and solve $x=1$.' })]);

    const res = await generate(cookies, taxonomy);

    expect(res.body.questions).toHaveLength(1);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].reason).toContain('href');
  });

  it('discards a single-choice question with two correct options', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([
      candidate({
        options: [
          { text: '$x = 3$', isCorrect: true },
          { text: '$x = 2$', isCorrect: true },
          { text: '$x = 1$', isCorrect: false },
        ],
      }),
    ]);

    const res = await generate(cookies, taxonomy, { count: 1 });

    // The plausible-looking error a model actually makes, and the one a reviewer is
    // most likely to skim past.
    expect(res.body.questions).toHaveLength(0);
    expect(res.body.rejected[0].reason).toContain('exactly one correct option');
  });

  it('files questions under the requested taxonomy, not one the model chose', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    const elsewhere = await createTaxonomy(app, cookies, { subject: 'Physics', topic: 'Optics' });
    enableGemini();
    geminiReplying([candidate({ subject: elsewhere.subjectId, topic: elsewhere.topicId, classLevel: 'Class 12 - Science' })]);

    const res = await generate(cookies, taxonomy, { count: 1 });
    await approve(cookies, taxonomy, res.body.questions);

    const stored = (await Question.find({}))[0]!;
    expect(String(stored.subject)).toBe(taxonomy.subjectId);
    expect(String(stored.topic)).toBe(taxonomy.topicId);
    expect(stored.classLevel).toBe('Class 9');
  });

  it('cannot return more questions than were asked for', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    // Genuinely unrelated wording, so duplicate detection is not what limits the
    // count — the cap is.
    const varied = ['Factorise $x^2+7x+12$.', 'A cyclist covers 30 km in 90 minutes; state the speed.',
      'Simplify $\frac{3}{4}+\frac{5}{6}$.', 'How many diagonals has a regular octagon?',
      'Convert 0.375 into its lowest-terms fraction.', 'The mean of 4, 9 and 14 is what?'];
    geminiReplying(varied.map((text) => candidate({ questionText: text })));

    const res = await generate(cookies, taxonomy, { count: 2 });

    expect(res.body.questions).toHaveLength(2);
  });
});

// ===========================================================================
// Duplicate detection
// ===========================================================================

describe('duplicate detection', () => {
  it('scores a renumbered question as near-identical and unrelated ones as far apart', () => {
    const original = 'A train travels 120 km in 2 hours. What is its average speed in km per hour?';
    const renumbered = 'A train travels 150 km in 3 hours. What is its average speed in km per hour?';
    const different = 'Factorise the quadratic expression $x^2 + 7x + 12$ completely.';

    // The failure mode is *rewording with new numbers*, which is why word overlap is
    // used rather than an edit distance.
    expect(similarity(original, renumbered)).toBeGreaterThanOrEqual(DUPLICATE_SIMILARITY_THRESHOLD);
    expect(similarity(original, different)).toBeLessThan(0.2);
  });

  it('refuses a candidate that repeats another candidate in the same batch', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    const text = 'A train travels 120 km in 2 hours. What is its average speed in km per hour?';
    geminiReplying([
      candidate({ questionText: text, options: [
        { text: '$60$', isCorrect: true }, { text: '$50$', isCorrect: false }, { text: '$70$', isCorrect: false },
      ] }),
      candidate({ questionText: text.replace('120', '150').replace('2 hours', '3 hours'), options: [
        { text: '$50$', isCorrect: true }, { text: '$60$', isCorrect: false }, { text: '$70$', isCorrect: false },
      ] }),
    ]);

    const res = await generate(cookies, taxonomy);

    expect(res.body.questions).toHaveLength(1);
    expect(res.body.duplicates).toHaveLength(1);
    expect(res.body.duplicates[0].reason).toContain('Too similar');
  });
});

// ===========================================================================
// Approval — the only path that writes
// ===========================================================================

describe('approving', () => {
  it('saves as drafts by default, and publishes only when asked', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([candidate()]);
    const proposed = await generate(cookies, taxonomy, { count: 1 });

    const asDraft = await approve(cookies, taxonomy, proposed.body.questions);
    expect(asDraft.status).toBe(201);
    expect(asDraft.body.questions[0].status).toBe('draft');
    expect(asDraft.body.published).toBe(0);

    const published = await approve(cookies, taxonomy, proposed.body.questions, { publish: true });
    expect(published.body.published).toBe(1);
    expect(published.body.questions[0].status).toBe('published');
  });

  it('re-validates what the review screen sends, so an edit cannot bypass the rules', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();

    // Exactly the shape the review screen posts, with the examiner having "edited" the
    // text into something the rules forbid. It never went near the generator.
    const res = await approve(cookies, taxonomy, [candidate({ questionText: 'Edited: <script>alert(1)</script>' })]);

    // Refused by the request schema itself, before the service is even reached — the
    // approval body runs the same `validateMathContent()` the question editor does.
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(201);
    expect(await Question.countDocuments()).toBe(0);
  });

  it('saves an examiner’s legitimate edit', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();

    const res = await approve(cookies, taxonomy, [candidate({ questionText: 'Rewritten by hand: solve $x + 1 = 4$.' })]);

    expect(res.status).toBe(201);
    const stored = (await Question.find({}))[0]!;
    expect(stored.questionText).toBe('Rewritten by hand: solve $x + 1 = 4$.');
    // Server-assigned option keys, exactly as for a hand-authored question.
    expect(stored.options.map((option) => option.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('counts approvals against the generation log', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([candidate()]);
    const proposed = await generate(cookies, taxonomy, { count: 1 });

    await approve(cookies, taxonomy, proposed.body.questions, { logId: proposed.body.logId });

    const log = await GenerationLog.findById(proposed.body.logId);
    expect(log!.approved).toBe(1);
  });
});

// ===========================================================================
// Fill in the blanks — the new question type
// ===========================================================================

describe('fill-in-the-blank questions', () => {
  it('generates, validates and stores its accepted answers', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([
      candidate({
        questionText: 'The value of $\\pi$ to two decimal places is ____.',
        type: 'fill_blank',
        options: [],
        acceptedAnswers: ['3.14', '3·14'],
        solution: '$\\pi = 3.14159...$, which is $3.14$ to two decimal places.',
      }),
    ]);

    const proposed = await generate(cookies, taxonomy, { count: 1, questionType: 'fill_blank' });
    expect(proposed.body.questions).toHaveLength(1);

    await approve(cookies, taxonomy, proposed.body.questions);
    const stored = (await Question.find({}))[0]!;
    expect(stored.type).toBe('fill_blank');
    expect(stored.acceptedAnswers).toEqual(['3.14', '3·14']);
  });

  it('marks a typed answer, forgiving case and spacing but nothing else', () => {
    const base = {
      question: '000000000000000000000000' as never,
      revision: 1,
      type: 'fill_blank' as const,
      marks: 4,
      negativeMarks: 1,
      correctOptionKeys: [],
      acceptedAnswers: ['12 cm'],
      selectedOptionKeys: [],
    };

    expect(gradeEntry({ ...base, textResponse: '12 cm' }).isCorrect).toBe(true);
    expect(gradeEntry({ ...base, textResponse: '  12   CM ' }).isCorrect).toBe(true);
    expect(gradeEntry({ ...base, textResponse: '12 cm.' }).isCorrect).toBe(true);
    // Not a spelling corrector: a different answer is wrong, not "close enough".
    expect(gradeEntry({ ...base, textResponse: '13 cm' }).isCorrect).toBe(false);
    // A blank is never penalised.
    expect(gradeEntry({ ...base, textResponse: '   ' })).toMatchObject({ answered: false, awardedMarks: 0 });
  });

  it('keeps an internal decimal point while stripping a trailing full stop', () => {
    // The rule that would silently turn "3.5" into "35" if written carelessly.
    expect(normalizeAnswerText('3.5')).toBe('3.5');
    expect(normalizeAnswerText('3.5.')).toBe('3.5');
  });

  it('refuses accepted answers that collide once normalised', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();

    const res = await approve(cookies, taxonomy, [
      candidate({
        questionText: 'Two plus two is ____.',
        type: 'fill_blank',
        options: [],
        acceptedAnswers: ['four', 'Four.'],
      }),
    ]);

    expect(res.body.rejected[0].reason).toContain('the same once spacing');
    expect(await Question.countDocuments()).toBe(0);
  });
});

// ===========================================================================
// Authorization
// ===========================================================================

describe('authorization', () => {
  it('refuses a guest and a plain student on both prefixes, for both routes', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const { cookies: studentCookies } = await registerVerifyLogin(app);

    for (const prefix of [API, ALIAS]) {
      for (const path of ['/admin/generate-questions', '/admin/generate-questions/approve']) {
        const guest = await request(app).post(`${prefix}${path}`).send({});
        expect(guest.status).toBe(401);

        const student = await request(app).post(`${prefix}${path}`).set('Cookie', cookieHeader(studentCookies)).send({});
        expect(student.status).toBe(403);
        expect(student.status).not.toBe(201);
      }
    }

    expect(await Question.countDocuments()).toBe(0);
    expect(taxonomy.subjectId).toBeTruthy();
  });
});
