import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { Question } from '../src/models';
import { setGeminiTransport, geminiQuestionGenerator, GEMINI_GENERATOR_ID } from '../src/services/geminiQuestionGenerator';
import { resolveQuestionGenerator, TEMPLATE_GENERATOR_ID } from '../src/services/questionGeneratorService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, cookieHeader, createAdminSession, registerVerifyLogin, clearTestInbox } from './helpers/auth';
import { createTaxonomy, type Taxonomy } from './helpers/questions';

/**
 * Milestone 17 — AI question drafting.
 *
 * The organising idea: **a generator is never trusted, so most of this file feeds the
 * pipeline output a real model could plausibly produce and asserts it is refused.**
 *
 * A language model writing exam questions is a safe feature only because of what
 * happens to its output afterwards, and every link in that chain is asserted here:
 *
 *  1. the taxonomy comes from the request, never from the model;
 *  2. every candidate passes `createQuestionSchema` — the same schema a human author's
 *     question passes, including `validateMathContent()`;
 *  3. a bad candidate is rejected *and reported*, never silently repaired;
 *  4. everything written is a `draft`, so nothing reaches a student unreviewed;
 *  5. no student data is in the request body.
 *
 * Nothing here touches the network. `setGeminiTransport()` is a test-only hook — it
 * throws outside the test environment — and it is what lets the *failure* paths (a
 * spent quota, a timeout, prose instead of JSON) be exercised at all, since none of
 * them can be produced on demand against a real provider.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const ORIGINAL_KEY = config.ai.geminiApiKey;
const ORIGINAL_GENERATOR = config.ai.questionGenerator;

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
  setGeminiTransport(null);
  config.ai.geminiApiKey = ORIGINAL_KEY;
  config.ai.questionGenerator = ORIGINAL_GENERATOR;
});

const ALIAS = '/api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A Gemini reply carrying whatever JSON body the test wants the "model" to produce. */
function geminiReplying(payload: unknown): void {
  setGeminiTransport(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
}

/** Turns the model on, as configuring a real API key would. */
function enableGemini(): void {
  config.ai.geminiApiKey = 'test-key-not-a-real-credential';
  config.ai.questionGenerator = 'auto';
}

function validCandidate(overrides: Record<string, unknown> = {}) {
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
    solution: 'Factorise as $(x-2)(x-3)=0$, so the larger root is $3$.',
    marks: 4,
    negativeMarks: 1,
    tags: ['quadratic'],
    ...overrides,
  };
}

async function generate(
  cookies: Record<string, string>,
  taxonomy: Taxonomy,
  body: Record<string, unknown> = {},
) {
  return request(app)
    .post(`${API}/admin/generate-questions`)
    .set('Cookie', cookieHeader(cookies))
    .send({
      subject: taxonomy.subjectId,
      topic: taxonomy.topicId,
      classLevel: 'Class 9',
      difficulty: 'Medium',
      count: 2,
      ...body,
    });
}

async function staffAndTaxonomy() {
  const { cookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
  const taxonomy = await createTaxonomy(app, cookies, { subject: 'Mathematics', topic: 'Algebra' });
  return { cookies, taxonomy };
}

// ===========================================================================
// Without a key — the supported default
// ===========================================================================

describe('with no API key configured', () => {
  it('still creates drafts, using templates, and says so', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    config.ai.geminiApiKey = undefined;

    const res = await generate(cookies, taxonomy, { count: 3 });

    expect(res.status).toBe(201);
    expect(res.body.questions).toHaveLength(3);
    expect(res.body.generator.id).toBe(TEMPLATE_GENERATOR_ID);
    // The honesty rule: string filling is never described as a model.
    expect(res.body.generator.kind).toBe('template');
    expect(res.body.generator.basis).toContain('not AI');
  });

  it('resolves to templates rather than an unavailable model', () => {
    config.ai.geminiApiKey = undefined;
    config.ai.questionGenerator = 'auto';

    expect(resolveQuestionGenerator().descriptor.id).toBe(TEMPLATE_GENERATOR_ID);
    expect(geminiQuestionGenerator.isAvailable()).toBe(false);
  });
});

// ===========================================================================
// With a model — the happy path
// ===========================================================================

describe('with Gemini configured', () => {
  it('stores what the model wrote, as drafts, attributed to the model', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([validCandidate(), validCandidate({ questionText: 'What is $2^5$?', options: [
      { text: '$32$', isCorrect: true },
      { text: '$25$', isCorrect: false },
      { text: '$10$', isCorrect: false },
    ] })]);

    const res = await generate(cookies, taxonomy);

    expect(res.status).toBe(201);
    expect(res.body.generator.id).toBe(GEMINI_GENERATOR_ID);
    // The one place in the product where 'model' is the truthful answer.
    expect(res.body.generator.kind).toBe('model');
    expect(res.body.questions).toHaveLength(2);
    expect(res.body.rejected).toHaveLength(0);

    const stored = await Question.find({}).sort({ createdAt: 1 });
    expect(stored).toHaveLength(2);
    // Nothing a generator writes may reach a student without a human publishing it.
    expect(stored.every((question) => question.status === 'draft')).toBe(true);
    expect(stored[0]!.questionText).toContain('x^2 - 5x + 6');
    // Server-assigned option keys, exactly as for a hand-authored question.
    expect(stored[0]!.options.map((option) => option.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('files questions under the requested taxonomy, not one the model chose', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    const elsewhere = await createTaxonomy(app, cookies, { subject: 'Physics', topic: 'Optics' });
    enableGemini();
    // A model trying to set its own taxonomy, class and difficulty. `GeneratedCandidate`
    // has no such fields, so these are simply not read — the request's values win.
    geminiReplying([
      validCandidate({
        subject: elsewhere.subjectId,
        topic: elsewhere.topicId,
        classLevel: 'Class 12 - Science',
        difficulty: 'Hard',
        status: 'published',
      }),
    ]);

    const res = await generate(cookies, taxonomy, { count: 1, classLevel: 'Class 9', difficulty: 'Easy' });

    expect(res.status).toBe(201);
    const stored = (await Question.find({}))[0]!;
    expect(String(stored.subject)).toBe(taxonomy.subjectId);
    expect(String(stored.topic)).toBe(taxonomy.topicId);
    expect(stored.classLevel).toBe('Class 9');
    expect(stored.difficulty).toBe('Easy');
    // Not 'published', whatever the model asked for.
    expect(stored.status).toBe('draft');
  });

  it('sends no student data to the provider', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    await registerVerifyLogin(app);
    enableGemini();

    let sentBody = '';
    setGeminiTransport((_url, init) => {
      sentBody = String(init.body);
      return Promise.resolve(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([validCandidate()]) }] } }] }), {
          status: 200,
        }),
      );
    });

    await generate(cookies, taxonomy, { count: 1 });

    // The whole payload is taxonomy names and the examiner's own words.
    expect(sentBody).toContain('Mathematics');
    expect(sentBody).toContain('Algebra');
    for (const leak of ['student@example.com', 'AMIT_', '9876543210', 'passwordHash', 'studentId']) {
      expect(sentBody).not.toContain(leak);
    }
  });

  it('passes the examiner’s instructions to the model', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();

    let sentBody = '';
    setGeminiTransport((_url, init) => {
      sentBody = String(init.body);
      return Promise.resolve(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([validCandidate()]) }] } }] }), {
          status: 200,
        }),
      );
    });

    await generate(cookies, taxonomy, { count: 1, instructions: 'Prefer word problems about cricket scores.' });

    expect(sentBody).toContain('cricket scores');
  });

  it('sends the key as a header, never in the URL', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();

    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    setGeminiTransport((url, init) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([validCandidate()]) }] } }] }), {
          status: 200,
        }),
      );
    });

    await generate(cookies, taxonomy, { count: 1 });

    // A URL is the thing most likely to reach a log line or a proxy's access log.
    expect(seenUrl).not.toContain('test-key-not-a-real-credential');
    expect(seenUrl).not.toContain('key=');
    expect(seenHeaders['x-goog-api-key']).toBe('test-key-not-a-real-credential');
  });
});

// ===========================================================================
// The model's output is not trusted
// ===========================================================================

describe('a model that returns something unusable', () => {
  it('refuses a question whose maths contains a forbidden LaTeX command', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([
      validCandidate(),
      validCandidate({ questionText: 'Look here: $\\href{http://evil.example}{click}$ and solve $x=1$.' }),
    ]);

    const res = await generate(cookies, taxonomy);

    expect(res.status).toBe(201);
    // The good one is kept; the dangerous one is discarded with its reason, never
    // repaired. There is no model-specific validator — this is `validateMathContent()`,
    // the same check a hand-authored question meets.
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].reason).toContain('href');
    expect(await Question.countDocuments()).toBe(1);
  });

  it('refuses markup smuggled into question text', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([validCandidate({ questionText: 'What is <script>alert(1)</script> worth?' })]);

    const res = await generate(cookies, taxonomy, { count: 1 });

    expect(res.body.questions).toHaveLength(0);
    expect(res.body.rejected).toHaveLength(1);
    expect(await Question.countDocuments()).toBe(0);
  });

  it('refuses a single-choice question with two correct options', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([
      validCandidate({
        options: [
          { text: '$x = 3$', isCorrect: true },
          { text: '$x = 2$', isCorrect: true },
          { text: '$x = 1$', isCorrect: false },
        ],
      }),
    ]);

    const res = await generate(cookies, taxonomy, { count: 1 });

    // An answer key with two right answers is exactly the plausible-looking error a
    // model makes, and the one a reviewer is most likely to skim past.
    expect(res.body.rejected[0].reason).toContain('exactly one correct option');
    expect(await Question.countDocuments()).toBe(0);
  });

  it('refuses a numeric question that carries options', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([
      validCandidate({ type: 'numeric', numericAnswer: 7, tolerance: 0, options: [{ text: '$7$', isCorrect: true }] }),
    ]);

    const res = await generate(cookies, taxonomy, { count: 1 });

    expect(res.body.rejected).toHaveLength(1);
    expect(await Question.countDocuments()).toBe(0);
  });

  it('cannot flood the bank by returning more than was asked for', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying(Array.from({ length: 40 }, (_, i) => validCandidate({ questionText: `Question ${i}: solve $x + ${i} = 0$.` })));

    const res = await generate(cookies, taxonomy, { count: 2 });

    expect(res.body.questions).toHaveLength(2);
    expect(await Question.countDocuments()).toBe(2);
    expect(res.body.notes.some((note: string) => note.startsWith('generator-returned-extra'))).toBe(true);
  });

  it('reports honestly when every candidate is discarded', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying([validCandidate({ questionText: '' }), validCandidate({ marks: 9999 })]);

    const res = await generate(cookies, taxonomy);

    expect(res.status).toBe(201);
    expect(res.body.questions).toHaveLength(0);
    expect(res.body.notes).toContain('every-candidate-was-rejected');
    expect(res.body.message).toContain('discarded');
  });
});

// ===========================================================================
// Provider failure falls back rather than failing
// ===========================================================================

describe('when the provider fails', () => {
  it('falls back to templates and reports the provider’s own reason', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    setGeminiTransport(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Quota exceeded for generate_content_free_tier_requests' } }), {
          status: 429,
        }),
      ),
    );

    const res = await generate(cookies, taxonomy, { count: 2 });

    // An examiner who wanted drafts still gets drafts.
    expect(res.status).toBe(201);
    expect(res.body.questions).toHaveLength(2);
    expect(res.body.generator.id).toBe(TEMPLATE_GENERATOR_ID);
    // "It failed" is not actionable: an expired key, a spent quota and an unknown model
    // need three different fixes, so the provider's words are kept.
    expect(res.body.message).toContain('Quota exceeded');
  });

  it('falls back when the model returns prose instead of JSON', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying('Certainly! Here are some questions for you:');

    const res = await generate(cookies, taxonomy, { count: 1 });

    expect(res.status).toBe(201);
    expect(res.body.generator.id).toBe(TEMPLATE_GENERATOR_ID);
    expect(res.body.questions).toHaveLength(1);
  });

  it('falls back when the network is unreachable', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    setGeminiTransport(() => Promise.reject(new Error('getaddrinfo ENOTFOUND')));

    const res = await generate(cookies, taxonomy, { count: 1 });

    expect(res.status).toBe(201);
    expect(res.body.generator.id).toBe(TEMPLATE_GENERATOR_ID);
  });

  it('reads a fenced JSON reply rather than discarding it', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();
    enableGemini();
    geminiReplying('```json\n' + JSON.stringify([validCandidate()]) + '\n```');

    const res = await generate(cookies, taxonomy, { count: 1 });

    expect(res.body.generator.id).toBe(GEMINI_GENERATOR_ID);
    expect(res.body.questions).toHaveLength(1);
  });
});

// ===========================================================================
// Authorization — unchanged by the milestone, and asserted on both prefixes
// ===========================================================================

describe('authorization', () => {
  it('refuses a guest and a plain student on both URL prefixes', async () => {
    const { cookies: adminCookies } = await createAdminSession(app, { email: 'staff@example.com', mobile: '9000000001' });
    const taxonomy = await createTaxonomy(app, adminCookies, { subject: 'Mathematics', topic: 'Algebra' });
    const { cookies: studentCookies } = await registerVerifyLogin(app);

    for (const prefix of [API, ALIAS]) {
      const guest = await request(app)
        .post(`${prefix}/admin/generate-questions`)
        .send({ subject: taxonomy.subjectId, topic: taxonomy.topicId, classLevel: 'Class 9', count: 1 });
      expect(guest.status).toBe(401);

      const student = await request(app)
        .post(`${prefix}/admin/generate-questions`)
        .set('Cookie', cookieHeader(studentCookies))
        .send({ subject: taxonomy.subjectId, topic: taxonomy.topicId, classLevel: 'Class 9', count: 1 });
      expect(student.status).toBe(403);
      expect(student.status).not.toBe(201);
    }

    expect(await Question.countDocuments()).toBe(0);
  });

  it('refuses instructions longer than the cap', async () => {
    const { cookies, taxonomy } = await staffAndTaxonomy();

    const res = await generate(cookies, taxonomy, { count: 1, instructions: 'x'.repeat(501) });

    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// The test hook itself
// ===========================================================================

describe('the transport hook', () => {
  it('cannot be used outside the test environment', () => {
    const wasTest = config.isTest;
    try {
      (config as { isTest: boolean }).isTest = false;
      expect(() => setGeminiTransport(null)).toThrow(/test-only/);
    } finally {
      (config as { isTest: boolean }).isTest = wasTest;
    }
  });
});
