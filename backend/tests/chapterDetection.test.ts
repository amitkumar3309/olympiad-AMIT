import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { detectChapter, stem, topicalWords, type DetectableChapter } from '../src/lib/chapterDetection';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, createAdminSession, registerVerifyLogin } from './helpers/auth';
import { createTaxonomy, createPublishedQuestion, createQuestionVia, type Taxonomy } from './helpers/questions';

/**
 * Chapter detection, and the two authoring endpoints built on it.
 *
 * The detector is a **pure function**, so most of this file needs no database at all — which is the
 * point of keeping it pure. The tests that matter are the ones about *refusing to guess*: a wrong
 * chapter is not a cosmetic problem, because the question is then served to a student practising
 * something else and the topic analytics the recommendation engine reads are corrupted.
 *
 * So the balance asserted throughout is: **detect the obvious, and say so; refuse the ambiguous, and
 * name the alternatives.** A detector that silently picked between "Integrals" and "Applications of
 * Integrals" would be worse than one that asked.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

const CHAPTERS: DetectableChapter[] = [
  { id: 'c1', name: 'Matrices' },
  { id: 'c2', name: 'Determinants' },
  { id: 'c3', name: 'Applications of Derivatives' },
  { id: 'c4', name: 'Probability' },
  { id: 'c5', name: 'Three-Dimensional Geometry' },
  { id: 'c6', name: 'Vector Algebra' },
];

// ---------------------------------------------------------------------------
// The pure half
// ---------------------------------------------------------------------------

describe('stem', () => {
  it('handles the plural endings a chapter name really uses', () => {
    expect(stem('Integrals')).toBe('integral');
    expect(stem('Derivatives')).toBe('derivative');
    expect(stem('Properties')).toBe('property');
  });

  it('knows the irregular mathematical plurals', () => {
    // No suffix rule gets these right, and they are exactly the words chapter names use.
    expect(stem('Matrices')).toBe('matrix');
    expect(stem('matrix')).toBe('matrix');
    expect(stem('indices')).toBe('index');
    expect(stem('vertices')).toBe('vertex');
  });

  it('leaves a short or double-s word alone', () => {
    expect(stem('sum')).toBe('sum');
    expect(stem('mass')).toBe('mass');
  });
});

describe('topicalWords', () => {
  it('drops stop words and the noise around a question', () => {
    const words = topicalWords('What is the value of the following determinant?');
    // "what", "is", "the", "value", "of", "following" are all noise; only the topic survives.
    expect([...words]).toEqual(['determinant']);
  });

  it('drops LaTeX islands, keeping the prose around them', () => {
    const words = topicalWords('Find the inverse of the matrix $\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$');
    expect(words.has('matrix')).toBe(true);
    // The LaTeX would otherwise contribute "pmatrix", "begin" and "end" as if they were topics.
    expect(words.has('pmatrix')).toBe(false);
    expect(words.has('begin')).toBe(false);
  });
});

describe('detectChapter', () => {
  it('matches a chapter named in the question, through a plural', () => {
    const outcome = detectChapter('Find the inverse of the given matrix.', CHAPTERS);
    expect(outcome.kind).toBe('matched');
    if (outcome.kind !== 'matched') return;
    expect(outcome.match.topicName).toBe('Matrices');
    // It says *why*, so a reviewer can judge the suggestion rather than trust it.
    expect(outcome.match.matchedWords).toContain('matrix');
  });

  it('matches a multi-word chapter on half its words', () => {
    // "Applications of Derivatives" should match a question about derivatives without also
    // demanding the word "applications".
    const outcome = detectChapter('Find the derivative of $x^3 - 2x$ and its maximum value.', CHAPTERS);
    expect(outcome.kind).toBe('matched');
    if (outcome.kind !== 'matched') return;
    expect(outcome.match.topicName).toBe('Applications of Derivatives');
  });

  it('matches a related word form, not only the exact one', () => {
    const outcome = detectChapter('Two dice are thrown. What is the probable outcome?', CHAPTERS);
    expect(outcome.kind).toBe('matched');
    if (outcome.kind !== 'matched') return;
    expect(outcome.match.topicName).toBe('Probability');
  });

  it('finds nothing rather than guessing when the question names no chapter', () => {
    // The decisive case. A question with no topical overlap must not be filed anywhere.
    const outcome = detectChapter('A shopkeeper buys twelve apples for sixty rupees. Find the profit.', CHAPTERS);
    expect(outcome.kind).toBe('none');
  });

  it('refuses to choose between two chapters that fit equally well', () => {
    const ambiguous: DetectableChapter[] = [
      { id: 'a', name: 'Integrals' },
      { id: 'b', name: 'Integrals' },
    ];
    const outcome = detectChapter('Evaluate the integral of $x^2$.', ambiguous);
    // Picking one would be a coin toss presented as a decision, and both look reasonable to a
    // reviewer skimming — so it names them instead.
    expect(outcome.kind).toBe('ambiguous');
    if (outcome.kind !== 'ambiguous') return;
    expect(outcome.between).toHaveLength(2);
  });

  it('prefers the chapter with more of its words matched', () => {
    const outcome = detectChapter(
      'Find the equation of a line in three-dimensional geometry passing through two points.',
      CHAPTERS,
    );
    expect(outcome.kind).toBe('matched');
    if (outcome.kind !== 'matched') return;
    expect(outcome.match.topicName).toBe('Three-Dimensional Geometry');
  });

  it('uses the tags an author wrote, which are often more explicit than the prose', () => {
    // The importer passes text and tags together for exactly this reason.
    const outcome = detectChapter('Evaluate the expression below. probability', CHAPTERS);
    expect(outcome.kind).toBe('matched');
    if (outcome.kind !== 'matched') return;
    expect(outcome.match.topicName).toBe('Probability');
  });

  it('finds nothing when there are no chapters, rather than throwing', () => {
    expect(detectChapter('Find the inverse of the matrix.', []).kind).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

async function adminSetup(): Promise<{ cookies: Record<string, string>; taxonomy: Taxonomy }> {
  const { cookies } = await createAdminSession(app);
  const taxonomy = await createTaxonomy(app, cookies);
  return { cookies, taxonomy };
}

describe('GET /admin/questions/detect-chapter', () => {
  it('suggests the chapter and says what it matched on', async () => {
    const { cookies } = await adminSetup();

    const res = await request(app)
      .get(`${API}/admin/questions/detect-chapter?text=${encodeURIComponent('Solve this algebra problem for $x$.')}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.outcome).toBe('matched');
    expect(res.body.match.topicName).toBe('Algebra');
    expect(res.body.match.matchedWords).toContain('algebra');
  });

  it('reports finding nothing rather than picking a chapter', async () => {
    const { cookies } = await adminSetup();

    const res = await request(app)
      .get(`${API}/admin/questions/detect-chapter?text=${encodeURIComponent('A train covers 180 km in 3 hours.')}`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.outcome).toBe('none');
    expect(res.body.match).toBeNull();
  });

  it('is not swallowed by the /:id route', async () => {
    const { cookies } = await adminSetup();
    const res = await request(app)
      .get(`${API}/admin/questions/detect-chapter?text=algebra`)
      .set('Cookie', cookieHeader(cookies));
    // The ordering trap: `/:id` declared first would match "detect-chapter" as an id and 400.
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(400);
  });

  it('refuses a student on both URL prefixes', async () => {
    const { cookies } = await registerVerifyLogin(app, { email: 'nodetect@example.com', mobile: '9800000951' });
    for (const prefix of [API, '/api']) {
      const res = await request(app)
        .get(`${prefix}/admin/questions/detect-chapter?text=algebra`)
        .set('Cookie', cookieHeader(cookies));
      expect(res.status).toBe(403);
      expect(res.status).not.toBe(500);
    }
  });
});

describe('GET /admin/questions/paper-suggestion', () => {
  /** Publishes `count` distinct questions under `taxonomy`, all one class. */
  async function seed(
    cookies: Record<string, string>,
    taxonomy: Taxonomy,
    count: number,
    prefix: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await createPublishedQuestion(app, cookies, taxonomy, {
        questionText: `${prefix} question about compound interest number ${i + 1}: what is $${i + 2} \\times ${i + 3}$?`,
        classLevel: 'Class 9',
        ...overrides,
      });
    }
  }

  it('draws a chapter-wise paper from one chapter', async () => {
    const { cookies, taxonomy } = await adminSetup();
    await seed(cookies, taxonomy, 4, 'Alpha');

    const res = await request(app)
      .get(`${API}/admin/questions/paper-suggestion?classLevel=Class%209&topic=${taxonomy.topicId}&count=3`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.questions).toHaveLength(3);
    for (const question of res.body.questions) {
      expect(question.classLevel).toBe('Class 9');
      // The chapter name travels, because on a spread paper the author needs to see it.
      expect(question.topicName).toBe('Algebra');
    }
  });

  it('spreads a whole-syllabus paper across chapters instead of taking the newest', async () => {
    const { cookies, taxonomy } = await adminSetup();

    // A second chapter, seeded *after* the first, so "the most recent N" would be all of it.
    const second = await request(app)
      .post(`${API}/admin/topics`)
      .set('Cookie', cookieHeader(cookies))
      .send({ subject: taxonomy.subjectId, name: 'Geometry' })
      .expect(201);
    const geometry: Taxonomy = { ...taxonomy, topicId: second.body.topic.id, subtopicId: '' };

    await seed(cookies, taxonomy, 5, 'Alpha');
    // `subtopic: null` explicitly: the fixture's subtopic belongs to *Algebra*, and the write path
    // rightly refuses a subtopic that is not under the chosen chapter.
    await seed(cookies, geometry, 5, 'Beta', { subtopic: null });

    const res = await request(app)
      .get(`${API}/admin/questions/paper-suggestion?classLevel=Class%209&count=4`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.questions).toHaveLength(4);
    const chapters = new Set(res.body.questions.map((q: { topicName: string }) => q.topicName));
    /**
     * The reason this endpoint exists. A `find().limit(4)` would return four questions from
     * whichever chapter was seeded last; a syllabus paper has to touch both.
     */
    expect(chapters).toEqual(new Set(['Algebra', 'Geometry']));
  });

  it('returns fewer than asked for rather than failing, when the bank is thin', async () => {
    const { cookies, taxonomy } = await adminSetup();
    await seed(cookies, taxonomy, 2, 'Alpha');

    const res = await request(app)
      .get(`${API}/admin/questions/paper-suggestion?classLevel=Class%209&count=20`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    // Not an error: the bank has what it has, and the response reports what was asked for so the
    // page can say "2 of 20 found".
    expect(res.body.questions).toHaveLength(2);
    expect(res.body.requested).toBe(20);
  });

  it('never suggests an unpublished question', async () => {
    const { cookies, taxonomy } = await adminSetup();
    await createQuestionVia(app, cookies, taxonomy, {
      questionText: 'A draft question about compound interest that is not published.',
      classLevel: 'Class 9',
    });

    const res = await request(app)
      .get(`${API}/admin/questions/paper-suggestion?classLevel=Class%209&count=10`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    // A mock test may only be *published* with published questions, so suggesting drafts would set
    // the author up to fail at the last step.
    expect(res.body.questions).toHaveLength(0);
  });

  it('is scoped to the class asked for', async () => {
    const { cookies, taxonomy } = await adminSetup();
    await seed(cookies, taxonomy, 3, 'Alpha');

    const res = await request(app)
      .get(`${API}/admin/questions/paper-suggestion?classLevel=Class%206&count=10`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.body.questions).toHaveLength(0);
  });

  it('refuses a count beyond what a paper can hold, and an invalid class', async () => {
    const { cookies } = await adminSetup();

    await request(app)
      .get(`${API}/admin/questions/paper-suggestion?classLevel=Class%209&count=500`)
      .set('Cookie', cookieHeader(cookies))
      .expect(400);

    await request(app)
      .get(`${API}/admin/questions/paper-suggestion?classLevel=Class%2013&count=10`)
      .set('Cookie', cookieHeader(cookies))
      .expect(400);
  });

  it('refuses a student', async () => {
    const { cookies } = await registerVerifyLogin(app, { email: 'nopaper@example.com', mobile: '9800000952' });
    const res = await request(app)
      .get(`${API}/admin/questions/paper-suggestion?classLevel=Class%209&count=5`)
      .set('Cookie', cookieHeader(cookies));
    expect(res.status).toBe(403);
  });
});
