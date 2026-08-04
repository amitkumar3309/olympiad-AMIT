import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { Question, Subject, Topic, AuditLog, type AuditAction } from '../src/models';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { API, clearTestInbox, cookieHeader, registerVerifyLogin, createAdminSession, otherStudent } from './helpers/auth';
import { createTaxonomy, validQuestion, createQuestionVia, createPublishedQuestion, type Taxonomy } from './helpers/questions';

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** Signed-in admin plus a fresh subject/topic/subtopic to hang questions off. */
async function adminWithTaxonomy(): Promise<{ cookies: Record<string, string>; cookie: string; taxonomy: Taxonomy }> {
  const { cookies } = await createAdminSession(app);
  const taxonomy = await createTaxonomy(app, cookies);
  return { cookies, cookie: cookieHeader(cookies), taxonomy };
}

// ===========================================================================
// Taxonomy: subjects, topics, subtopics
// ===========================================================================

describe('subjects', () => {
  it('creates a subject and derives its slug', async () => {
    const { cookies } = await createAdminSession(app);

    const res = await request(app)
      .post(`${API}/admin/subjects`)
      .set('Cookie', cookieHeader(cookies))
      .send({ name: 'Number Theory', description: 'Divisibility, primes, congruences' })
      .expect(201);

    expect(res.body.subject.name).toBe('Number Theory');
    expect(res.body.subject.slug).toBe('number-theory');
    expect(res.body.subject.status).toBe('active');

    const saved = await Subject.findById(res.body.subject.id);
    expect(saved).not.toBeNull();
    expect(saved!.slug).toBe('number-theory');
  });

  it('refuses a duplicate subject name, case-insensitively', async () => {
    const { cookies } = await createAdminSession(app);
    const cookie = cookieHeader(cookies);

    await request(app).post(`${API}/admin/subjects`).set('Cookie', cookie).send({ name: 'Algebra' }).expect(201);
    const dupe = await request(app).post(`${API}/admin/subjects`).set('Cookie', cookie).send({ name: 'algebra' });

    expect(dupe.status).toBe(409);
    expect(dupe.status).not.toBe(500);
    expect(await Subject.countDocuments({})).toBe(1);
  });

  it('rejects a name containing formula delimiters', async () => {
    const { cookies } = await createAdminSession(app);
    const res = await request(app)
      .post(`${API}/admin/subjects`)
      .set('Cookie', cookieHeader(cookies))
      .send({ name: 'Algebra $x^2$' });

    expect(res.status).toBe(400);
  });

  it('renames a subject and updates the slug with it', async () => {
    const { cookies } = await createAdminSession(app);
    const cookie = cookieHeader(cookies);
    const created = await request(app).post(`${API}/admin/subjects`).set('Cookie', cookie).send({ name: 'Algbra' }).expect(201);

    const fixed = await request(app)
      .patch(`${API}/admin/subjects/${created.body.subject.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Algebra' })
      .expect(200);

    expect(fixed.body.subject.name).toBe('Algebra');
    expect(fixed.body.subject.slug).toBe('algebra');
  });

  it('rejects an empty update body rather than reporting a no-op success', async () => {
    const { cookies } = await createAdminSession(app);
    const cookie = cookieHeader(cookies);
    const created = await request(app).post(`${API}/admin/subjects`).set('Cookie', cookie).send({ name: 'Calculus' }).expect(201);

    const res = await request(app).patch(`${API}/admin/subjects/${created.body.subject.id}`).set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });

  it('refuses to archive a subject that still has published questions', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    await createPublishedQuestion(app, await sessionFor(cookie), taxonomy);

    const res = await request(app).patch(`${API}/admin/subjects/${taxonomy.subjectId}`).set('Cookie', cookie).send({ status: 'archived' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/published question/i);
  });

  it('allows archiving a subject whose questions are only drafts', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();
    await createQuestionVia(app, cookies, taxonomy);

    await request(app).patch(`${API}/admin/subjects/${taxonomy.subjectId}`).set('Cookie', cookie).send({ status: 'archived' }).expect(200);
  });
});

/** Rebuilds a cookie map from a header string, so helpers taking either shape compose. */
async function sessionFor(cookie: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const pair of cookie.split('; ')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

describe('topics and subtopics', () => {
  it('creates a topic at depth 0 and a subtopic at depth 1', async () => {
    const { cookies } = await createAdminSession(app);
    const taxonomy = await createTaxonomy(app, cookies);

    const topic = await Topic.findById(taxonomy.topicId);
    const subtopic = await Topic.findById(taxonomy.subtopicId);

    expect(topic!.depth).toBe(0);
    expect(topic!.parent).toBeNull();
    expect(subtopic!.depth).toBe(1);
    expect(String(subtopic!.parent)).toBe(taxonomy.topicId);
    // Both live in the same collection — that is what makes subtopics possible
    // without a third model.
    expect(await Topic.countDocuments({})).toBe(2);
  });

  it('refuses a third level of nesting', async () => {
    const { cookies } = await createAdminSession(app);
    const cookie = cookieHeader(cookies);
    const taxonomy = await createTaxonomy(app, cookies);

    const res = await request(app)
      .post(`${API}/admin/topics`)
      .set('Cookie', cookie)
      .send({ subject: taxonomy.subjectId, parent: taxonomy.subtopicId, name: 'Too Deep' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nest/i);
  });

  it('refuses a subtopic whose parent belongs to a different subject', async () => {
    const { cookies } = await createAdminSession(app);
    const cookie = cookieHeader(cookies);
    const first = await createTaxonomy(app, cookies, { subject: 'Algebra', topic: 'Polynomials' });
    const second = await createTaxonomy(app, cookies, { subject: 'Geometry', topic: 'Triangles' });

    const res = await request(app)
      .post(`${API}/admin/topics`)
      .set('Cookie', cookie)
      .send({ subject: second.subjectId, parent: first.topicId, name: 'Mismatched' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different subject/i);
  });

  it('allows the same topic name under two different subjects', async () => {
    const { cookies } = await createAdminSession(app);
    const cookie = cookieHeader(cookies);
    const algebra = await createTaxonomy(app, cookies, { subject: 'Algebra', topic: 'Fractions' });
    const arithmetic = await request(app).post(`${API}/admin/subjects`).set('Cookie', cookie).send({ name: 'Arithmetic' }).expect(201);

    await request(app)
      .post(`${API}/admin/topics`)
      .set('Cookie', cookie)
      .send({ subject: arithmetic.body.subject.id, name: 'Fractions' })
      .expect(201);

    expect(algebra.topicId).toBeTruthy();
    expect(await Topic.countDocuments({ slug: 'fractions' })).toBe(2);
  });

  it('refuses a duplicate topic name within the same parent', async () => {
    const { cookies } = await createAdminSession(app);
    const cookie = cookieHeader(cookies);
    const taxonomy = await createTaxonomy(app, cookies);

    const res = await request(app)
      .post(`${API}/admin/topics`)
      .set('Cookie', cookie)
      .send({ subject: taxonomy.subjectId, name: 'Algebra' });

    expect(res.status).toBe(409);
  });

  it('lists only top-level topics when asked for parent=root', async () => {
    const { cookies } = await createAdminSession(app);
    const cookie = cookieHeader(cookies);
    const taxonomy = await createTaxonomy(app, cookies);

    const res = await request(app).get(`${API}/topics?subject=${taxonomy.subjectId}&parent=root`).set('Cookie', cookie).expect(200);

    expect(res.body.topics).toHaveLength(1);
    expect(res.body.topics[0].id).toBe(taxonomy.topicId);
  });

  it('lists a topic\'s subtopics when given its id as the parent', async () => {
    const { cookies } = await createAdminSession(app);
    const cookie = cookieHeader(cookies);
    const taxonomy = await createTaxonomy(app, cookies);

    const res = await request(app).get(`${API}/topics?parent=${taxonomy.topicId}`).set('Cookie', cookie).expect(200);

    expect(res.body.topics).toHaveLength(1);
    expect(res.body.topics[0].id).toBe(taxonomy.subtopicId);
    expect(res.body.topics[0].depth).toBe(1);
  });
});

// ===========================================================================
// The full CRUD flow
// ===========================================================================

describe('question CRUD, end to end', () => {
  it('creates → reads → updates → publishes → archives → restores → deletes', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();

    // --- Create -------------------------------------------------------------
    const created = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy))
      .expect(201);

    const id = created.body.question.id;
    // Everything starts as a draft: "saved" and "visible to students" must never be
    // the same keystroke.
    expect(created.body.question.status).toBe('draft');
    expect(created.body.question.revision).toBe(1);
    expect(created.body.question.options).toHaveLength(4);
    // The server assigns option keys, so answers are recorded against a stable id.
    expect(created.body.question.options.map((o: { key: string }) => o.key)).toEqual(['a', 'b', 'c', 'd']);

    const saved = await Question.findById(id);
    expect(saved).not.toBeNull();
    expect(saved!.questionText).toContain('x^2 - 5x + 6 = 0');
    expect(saved!.tags).toEqual(['quadratic', 'roots']);

    // --- Read ---------------------------------------------------------------
    const read = await request(app).get(`${API}/admin/questions/${id}`).set('Cookie', cookie).expect(200);
    expect(read.body.question.subject.name).toBe('Mathematics');
    expect(read.body.question.topic.name).toBe('Algebra');
    expect(read.body.question.subtopic.name).toBe('Quadratic Equations');

    // --- Update -------------------------------------------------------------
    const updated = await request(app)
      .put(`${API}/admin/questions/${id}`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { marks: 6, difficulty: 'Hard', tags: ['Quadratic', 'quadratic', ' ROOTS '] }))
      .expect(200);

    expect(updated.body.question.marks).toBe(6);
    expect(updated.body.question.difficulty).toBe('Hard');
    expect(updated.body.question.revision).toBe(2);
    // Tags are normalised and de-duplicated, so filtering is predictable.
    expect(updated.body.question.tags).toEqual(['quadratic', 'roots']);

    // --- Publish ------------------------------------------------------------
    const published = await request(app)
      .patch(`${API}/admin/questions/${id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'published' })
      .expect(200);
    expect(published.body.question.status).toBe('published');
    expect(published.body.question.publishedAt).not.toBeNull();

    // --- Archive ------------------------------------------------------------
    const archived = await request(app)
      .patch(`${API}/admin/questions/${id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'archived' })
      .expect(200);
    expect(archived.body.question.status).toBe('archived');
    expect(archived.body.question.archivedAt).not.toBeNull();

    // --- Restore ------------------------------------------------------------
    const restored = await request(app)
      .patch(`${API}/admin/questions/${id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'draft' })
      .expect(200);
    expect(restored.body.question.status).toBe('draft');
    expect(restored.body.question.archivedAt).toBeNull();
    // publishedAt is retained on purpose: it records that this was once live.
    expect(restored.body.question.publishedAt).not.toBeNull();

    // --- Delete is refused, because it has been published before -------------
    const refused = await request(app).delete(`${API}/admin/questions/${id}`).set('Cookie', cookie);
    expect(refused.status).toBe(409);
    expect(await Question.countDocuments({ _id: id })).toBe(1);

    // --- A never-published draft CAN be deleted -----------------------------
    const draft = await createQuestionVia(app, cookies, taxonomy, { questionText: 'A throwaway draft: $1+1=2$' });
    await request(app).delete(`${API}/admin/questions/${draft.id}`).set('Cookie', cookie).expect(200);
    expect(await Question.countDocuments({ _id: draft.id })).toBe(0);
  });

  it('answers 404 for a question id that does not exist', async () => {
    const { cookie } = await adminWithTaxonomy();
    const res = await request(app).get(`${API}/admin/questions/000000000000000000000009`).set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(500);
  });

  it('rejects a malformed question id with 400, not 500', async () => {
    const { cookie } = await adminWithTaxonomy();
    const res = await request(app).get(`${API}/admin/questions/not-an-id`).set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });

  it('refuses to edit an archived question until it is restored', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();
    const question = await createQuestionVia(app, cookies, taxonomy);

    await request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'archived' }).expect(200);

    const res = await request(app).put(`${API}/admin/questions/${question.id}`).set('Cookie', cookie).send(validQuestion(taxonomy));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/archived/i);
  });
});

// ===========================================================================
// Taxonomy consistency
// ===========================================================================

describe('taxonomy consistency on a question', () => {
  it('refuses a topic that belongs to a different subject', async () => {
    const { cookies, cookie } = await adminWithTaxonomy();
    const other = await createTaxonomy(app, cookies, { subject: 'Geometry', topic: 'Circles', subtopic: 'Tangents' });
    const mine = await createTaxonomy(app, cookies, { subject: 'Calculus', topic: 'Limits', subtopic: 'One-sided' });

    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(mine, { topic: other.topicId, subtopic: null }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not belong to the selected subject/i);
    expect(await Question.countDocuments({})).toBe(0);
  });

  it('refuses a subtopic that belongs to a different topic', async () => {
    const { cookies, cookie } = await adminWithTaxonomy();
    const a = await createTaxonomy(app, cookies, { subject: 'Statistics', topic: 'Mean', subtopic: 'Weighted' });
    const b = await createTaxonomy(app, cookies, { subject: 'Probability', topic: 'Events', subtopic: 'Independent' });

    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(a, { subtopic: b.subtopicId }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subtopic does not belong/i);
  });

  it('refuses a subtopic in the topic field', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();

    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { topic: taxonomy.subtopicId, subtopic: null }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/top-level topic/i);
  });

  it('accepts a question with no subtopic', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { subtopic: null }))
      .expect(201);
  });
});

// ===========================================================================
// Question types and their answer shapes
// ===========================================================================

describe('question types', () => {
  it('accepts each of the four supported types', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();

    const bodies = [
      validQuestion(taxonomy),
      validQuestion(taxonomy, {
        type: 'multiple_choice',
        options: [
          { text: '$2$', isCorrect: true },
          { text: '$3$', isCorrect: true },
          { text: '$4$', isCorrect: false },
        ],
      }),
      validQuestion(taxonomy, { type: 'true_false', options: [], booleanAnswer: true }),
      validQuestion(taxonomy, { type: 'numeric', options: [], numericAnswer: 3.5, tolerance: 0.01 }),
    ];

    for (const body of bodies) {
      await request(app).post(`${API}/admin/questions`).set('Cookie', cookie).send(body).expect(201);
    }
    expect(await Question.countDocuments({})).toBe(4);
  });

  it('requires exactly one correct option for single choice', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();

    const two = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(
        validQuestion(taxonomy, {
          options: [
            { text: '$1$', isCorrect: true },
            { text: '$2$', isCorrect: true },
            { text: '$3$', isCorrect: false },
          ],
        }),
      );
    expect(two.status).toBe(400);
    expect(two.body.error).toMatch(/exactly one correct option/i);

    const none = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(
        validQuestion(taxonomy, {
          options: [
            { text: '$1$', isCorrect: false },
            { text: '$2$', isCorrect: false },
          ],
        }),
      );
    expect(none.status).toBe(400);
  });

  it('requires at least two correct options for multiple choice', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(
        validQuestion(taxonomy, {
          type: 'multiple_choice',
          options: [
            { text: '$1$', isCorrect: true },
            { text: '$2$', isCorrect: false },
          ],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least two correct/i);
  });

  it('rejects a question where every option is correct', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(
        validQuestion(taxonomy, {
          type: 'multiple_choice',
          options: [
            { text: '$1$', isCorrect: true },
            { text: '$2$', isCorrect: true },
          ],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unanswerable/i);
  });

  it('rejects duplicate option text', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(
        validQuestion(taxonomy, {
          options: [
            { text: '$x = 3$', isCorrect: true },
            { text: '$x = 3$', isCorrect: false },
            { text: '$x = 4$', isCorrect: false },
          ],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same text/i);
  });

  it('rejects a single option', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { options: [{ text: 'Only one', isCorrect: true }] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2 options/i);
  });

  it("rejects a choice question carrying a numeric answer it doesn't use", async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { numericAnswer: 42 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must not carry a numeric answer/i);
  });

  it('rejects a numeric question carrying options', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { type: 'numeric', numericAnswer: 7 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must not carry options/i);
  });

  it('rejects a numeric question with no answer', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { type: 'numeric', options: [] }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/numeric answer/i);
  });

  it('rejects a true/false question with no boolean answer', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { type: 'true_false', options: [] }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/true or false/i);
  });

  it('rejects tolerance on a non-numeric question', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app).post(`${API}/admin/questions`).set('Cookie', cookie).send(validQuestion(taxonomy, { tolerance: 0.5 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tolerance only applies/i);
  });
});

// ===========================================================================
// Marks and negative marks
// ===========================================================================

describe('marks', () => {
  it('stores marks and negative marks', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { marks: 8, negativeMarks: 2 }))
      .expect(201);

    expect(res.body.question.marks).toBe(8);
    expect(res.body.question.negativeMarks).toBe(2);
  });

  it('defaults negative marking to zero (disabled)', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const body = validQuestion(taxonomy);
    delete body.negativeMarks;

    const res = await request(app).post(`${API}/admin/questions`).set('Cookie', cookie).send(body).expect(201);
    expect(res.body.question.negativeMarks).toBe(0);
  });

  it('refuses negative marks larger than the marks awarded', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { marks: 2, negativeMarks: 4 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot exceed the marks awarded/i);
  });

  it('refuses a signed negative-marks value, since the field is a magnitude', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app).post(`${API}/admin/questions`).set('Cookie', cookie).send(validQuestion(taxonomy, { negativeMarks: -1 }));
    expect(res.status).toBe(400);
  });

  it('refuses zero or absurd marks', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    for (const marks of [0, -4, 1000]) {
      const res = await request(app).post(`${API}/admin/questions`).set('Cookie', cookie).send(validQuestion(taxonomy, { marks }));
      expect(res.status).toBe(400);
    }
  });
});

// ===========================================================================
// Mathematical content
// ===========================================================================

describe('mathematical content', () => {
  it('stores LaTeX verbatim, without escaping or mangling it', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const text = 'Evaluate $$\\int_0^1 x^2 \\, dx$$ and simplify $\\frac{a}{b} + \\sqrt{c}$.';

    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { questionText: text }))
      .expect(201);

    expect(res.body.question.questionText).toBe(text);
    const saved = await Question.findById(res.body.question.id);
    expect(saved!.questionText).toBe(text);
  });

  it('accepts a literal dollar sign when it is escaped', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { questionText: 'A book costs \\$5. What is $2 \\times 5$?' }))
      .expect(201);
  });

  it('rejects unbalanced math delimiters', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { questionText: 'What is $x^2 + 1 equal to?' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unclosed math/i);
  });

  it('rejects an empty math expression', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const res = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { questionText: 'Nothing to see here: $  $ really.' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empty math/i);
  });

  it('rejects LaTeX macro definitions, which are an expansion-bomb vector', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    for (const attack of ['$\\def\\x{\\x\\x}\\x$', '$\\newcommand{\\a}{\\a\\a}\\a$', '$\\csname relax\\endcsname$']) {
      const res = await request(app)
        .post(`${API}/admin/questions`)
        .set('Cookie', cookie)
        .send(validQuestion(taxonomy, { questionText: `Compute ${attack}` }));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not permitted/i);
    }
  });

  it('rejects link and file-inclusion commands inside math', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    for (const attack of ['$\\href{https://evil.example}{click}$', '$\\includegraphics{/etc/passwd}$', '$\\input{/etc/passwd}$']) {
      const res = await request(app)
        .post(`${API}/admin/questions`)
        .set('Cookie', cookie)
        .send(validQuestion(taxonomy, { questionText: `See ${attack}` }));

      expect(res.status).toBe(400);
    }
  });

  it('rejects embedded markup and event handlers', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();
    const attacks = [
      '<script>alert(1)</script> What is $x$?',
      'Click <img src=x onerror=alert(1)> for $x$',
      '<iframe src="javascript:alert(1)"></iframe> $x$',
    ];
    for (const questionText of attacks) {
      const res = await request(app).post(`${API}/admin/questions`).set('Cookie', cookie).send(validQuestion(taxonomy, { questionText }));
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(201);
    }
    expect(await Question.countDocuments({})).toBe(0);
  });

  it('applies the same math rules to options and the solution', async () => {
    const { cookie, taxonomy } = await adminWithTaxonomy();

    const badOption = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(
        validQuestion(taxonomy, {
          options: [
            { text: 'unclosed $x^2', isCorrect: true },
            { text: 'fine', isCorrect: false },
          ],
        }),
      );
    expect(badOption.status).toBe(400);

    const badSolution = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookie)
      .send(validQuestion(taxonomy, { solution: 'Because $\\def\\a{\\a}\\a$.' }));
    expect(badSolution.status).toBe(400);
  });
});

// ===========================================================================
// The editorial workflow
// ===========================================================================

describe('editorial workflow', () => {
  it('refuses to publish a question with no solution', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();
    const question = await createQuestionVia(app, cookies, taxonomy, { solution: null });

    const res = await request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'published' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/solution/i);
    expect((await Question.findById(question.id))!.status).toBe('draft');
  });

  it('supports the draft → in_review → published path', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();
    const question = await createQuestionVia(app, cookies, taxonomy);

    await request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'in_review' }).expect(200);
    await request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'published' }).expect(200);

    expect((await Question.findById(question.id))!.status).toBe('published');
  });

  it('refuses an illegal transition from archived straight to published', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();
    const question = await createQuestionVia(app, cookies, taxonomy);
    await request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'archived' }).expect(200);

    const res = await request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'published' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot become/i);
  });

  it('refuses a transition to the status it already has', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();
    const question = await createQuestionVia(app, cookies, taxonomy);

    const res = await request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'draft' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  it('rejects an unknown status value', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();
    const question = await createQuestionVia(app, cookies, taxonomy);

    const res = await request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'deleted' });
    expect(res.status).toBe(400);
  });

  it('refuses to delete a published question', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();
    const published = await createPublishedQuestion(app, cookies, taxonomy);

    const res = await request(app).delete(`${API}/admin/questions/${published.id}`).set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/archive it instead/i);
    expect(await Question.countDocuments({ _id: published.id })).toBe(1);
  });
});

// ===========================================================================
// Search, filter, sort, paginate
// ===========================================================================

describe('search, filtering, sorting and pagination', () => {
  /** Seven questions spread across two subjects, three classes and two difficulties. */
  async function seed(): Promise<{ cookie: string; taxonomy: Taxonomy; other: Taxonomy }> {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();
    const other = await createTaxonomy(app, cookies, { subject: 'Geometry', topic: 'Circles', subtopic: 'Chords' });

    const specs = [
      { questionText: 'Find the roots of $x^2-1=0$', classLevel: 'Class 9', difficulty: 'Easy', marks: 2, tags: ['roots'] },
      { questionText: 'Expand $(a+b)^2$', classLevel: 'Class 9', difficulty: 'Medium', marks: 4, tags: ['identity'] },
      { questionText: 'Factorise $x^2-9$', classLevel: 'Class 10', difficulty: 'Hard', marks: 6, tags: ['roots', 'identity'] },
      { questionText: 'Simplify $\\frac{2}{4}$', classLevel: 'Class 10', difficulty: 'Easy', marks: 1, tags: ['fractions'] },
      { questionText: 'Solve $2x=10$', classLevel: 'Class 11', difficulty: 'Medium', marks: 3, tags: ['linear'] },
    ];
    for (const spec of specs) {
      await request(app).post(`${API}/admin/questions`).set('Cookie', cookie).send(validQuestion(taxonomy, spec)).expect(201);
    }
    // Two under the other subject, to prove the subject filter narrows. Their tags
    // and solution are overridden so they cannot contribute to the tag and search
    // counts asserted below — the default fixture shares both across every question.
    for (const questionText of ['Area of a circle of radius $r$', 'A chord subtends $60^\\circ$']) {
      await request(app)
        .post(`${API}/admin/questions`)
        .set('Cookie', cookie)
        .send(validQuestion(other, { questionText, tags: ['geometry'], solution: 'By the standard circle results.' }))
        .expect(201);
    }
    return { cookie, taxonomy, other };
  }

  it('paginates with a stable total and page count', async () => {
    const { cookie } = await seed();

    const first = await request(app).get(`${API}/admin/questions?page=1&limit=3`).set('Cookie', cookie).expect(200);
    expect(first.body.questions).toHaveLength(3);
    expect(first.body.pagination).toMatchObject({ page: 1, limit: 3, total: 7, totalPages: 3 });

    const last = await request(app).get(`${API}/admin/questions?page=3&limit=3`).set('Cookie', cookie).expect(200);
    expect(last.body.questions).toHaveLength(1);

    // No question appears on two pages — the _id tiebreaker is what guarantees this.
    const second = await request(app).get(`${API}/admin/questions?page=2&limit=3`).set('Cookie', cookie).expect(200);
    const ids = [...first.body.questions, ...second.body.questions, ...last.body.questions].map((q: { id: string }) => q.id);
    expect(new Set(ids).size).toBe(7);
  });

  it('returns an empty page rather than an error when the page is past the end', async () => {
    const { cookie } = await seed();
    const res = await request(app).get(`${API}/admin/questions?page=99&limit=10`).set('Cookie', cookie).expect(200);
    expect(res.body.questions).toEqual([]);
    expect(res.body.pagination.total).toBe(7);
  });

  it('filters by subject, class, difficulty and tag', async () => {
    const { cookie, taxonomy, other } = await seed();

    const bySubject = await request(app).get(`${API}/admin/questions?subject=${other.subjectId}`).set('Cookie', cookie).expect(200);
    expect(bySubject.body.pagination.total).toBe(2);

    const byClass = await request(app).get(`${API}/admin/questions?classLevel=Class%2010`).set('Cookie', cookie).expect(200);
    expect(byClass.body.pagination.total).toBe(2);

    const byDifficulty = await request(app).get(`${API}/admin/questions?difficulty=Easy`).set('Cookie', cookie).expect(200);
    expect(byDifficulty.body.pagination.total).toBe(2);

    const byTag = await request(app).get(`${API}/admin/questions?tag=roots`).set('Cookie', cookie).expect(200);
    expect(byTag.body.pagination.total).toBe(2);

    const byTopic = await request(app).get(`${API}/admin/questions?topic=${taxonomy.topicId}`).set('Cookie', cookie).expect(200);
    expect(byTopic.body.pagination.total).toBe(5);
  });

  it('combines filters as AND, not OR', async () => {
    const { cookie } = await seed();
    const res = await request(app).get(`${API}/admin/questions?classLevel=Class%2010&difficulty=Easy`).set('Cookie', cookie).expect(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.questions[0].questionText).toContain('frac');
  });

  it('searches question text, tags and solutions', async () => {
    const { cookie } = await seed();

    // "Expand" appears in exactly one question's text and in no solution.
    const byText = await request(app).get(`${API}/admin/questions?search=Expand`).set('Cookie', cookie).expect(200);
    expect(byText.body.pagination.total).toBe(1);

    const byTag = await request(app).get(`${API}/admin/questions?search=fractions`).set('Cookie', cookie).expect(200);
    expect(byTag.body.pagination.total).toBe(1);

    // The shared fixture solution contains "Factorise", so a solution search
    // legitimately matches every question that uses it — which is what proves the
    // solution field is searched at all.
    const bySolution = await request(app).get(`${API}/admin/questions?search=Factorise&limit=100`).set('Cookie', cookie).expect(200);
    expect(bySolution.body.pagination.total).toBe(5);
  });

  it('treats the search term literally, so regex metacharacters match nothing', async () => {
    const { cookie } = await seed();
    const res = await request(app).get(`${API}/admin/questions?search=.*`).set('Cookie', cookie).expect(200);
    // An unescaped `.*` would match every question; escaped, it matches none.
    expect(res.body.pagination.total).toBe(0);
  });

  it('searches LaTeX source, so an author can find a formula', async () => {
    const { cookie } = await seed();
    const res = await request(app).get(`${API}/admin/questions?search=${encodeURIComponent('x^2-9')}`).set('Cookie', cookie).expect(200);
    expect(res.body.pagination.total).toBe(1);
  });

  it('sorts by marks in both directions', async () => {
    const { cookie } = await seed();

    const asc = await request(app).get(`${API}/admin/questions?sort=marks&order=asc&limit=100`).set('Cookie', cookie).expect(200);
    const ascMarks = asc.body.questions.map((q: { marks: number }) => q.marks);
    expect([...ascMarks]).toEqual([...ascMarks].sort((a: number, b: number) => a - b));

    const desc = await request(app).get(`${API}/admin/questions?sort=marks&order=desc&limit=100`).set('Cookie', cookie).expect(200);
    const descMarks = desc.body.questions.map((q: { marks: number }) => q.marks);
    expect([...descMarks]).toEqual([...descMarks].sort((a: number, b: number) => b - a));
  });

  it('rejects a sort key that is not on the allow-list', async () => {
    const { cookie } = await seed();
    const res = await request(app).get(`${API}/admin/questions?sort=questionText`).set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('rejects an over-large page size', async () => {
    const { cookie } = await seed();
    const res = await request(app).get(`${API}/admin/questions?limit=5000`).set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('filters by status', async () => {
    const { cookie } = await seed();
    const all = await request(app).get(`${API}/admin/questions?limit=100`).set('Cookie', cookie).expect(200);
    const target = all.body.questions[0].id;
    await request(app).patch(`${API}/admin/questions/${target}/status`).set('Cookie', cookie).send({ status: 'published' }).expect(200);

    const published = await request(app).get(`${API}/admin/questions?status=published`).set('Cookie', cookie).expect(200);
    expect(published.body.pagination.total).toBe(1);

    const drafts = await request(app).get(`${API}/admin/questions?status=draft`).set('Cookie', cookie).expect(200);
    expect(drafts.body.pagination.total).toBe(6);
  });

  it('reports an empty bank as an empty list, not an error', async () => {
    const { cookie } = await adminWithTaxonomy();
    const res = await request(app).get(`${API}/admin/questions`).set('Cookie', cookie).expect(200);
    expect(res.body.questions).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });
});

// ===========================================================================
// Authorization — the answer key must never reach a student
// ===========================================================================

describe('authorization and answer-key protection', () => {
  it('never sends the answer key on the student-facing listing', async () => {
    const { cookies, taxonomy } = await adminWithTaxonomy();
    await createPublishedQuestion(app, cookies, taxonomy);

    const student = await registerVerifyLogin(app, otherStudent);
    const res = await request(app).get(`${API}/questions`).set('Cookie', cookieHeader(student.cookies)).expect(200);

    expect(res.body.questions).toHaveLength(1);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('isCorrect');
    expect(body).not.toContain('solution');
    expect(body).not.toContain('numericAnswer');
    expect(body).not.toContain('booleanAnswer');
    // The options themselves must still be there — a student needs to answer.
    expect(res.body.questions[0].options).toHaveLength(4);
    expect(res.body.questions[0].options[0]).toHaveProperty('key');
    expect(res.body.questions[0].options[0]).not.toHaveProperty('isCorrect');
  });

  it('never sends the answer key on a single student-facing read', async () => {
    const { cookies, taxonomy } = await adminWithTaxonomy();
    const published = await createPublishedQuestion(app, cookies, taxonomy);

    const student = await registerVerifyLogin(app, otherStudent);
    const res = await request(app).get(`${API}/questions/${published.id}`).set('Cookie', cookieHeader(student.cookies)).expect(200);

    expect(JSON.stringify(res.body)).not.toContain('isCorrect');
    expect(res.body.question).not.toHaveProperty('solution');
  });

  it('hides unpublished questions from students entirely', async () => {
    const { cookies, taxonomy } = await adminWithTaxonomy();
    await createQuestionVia(app, cookies, taxonomy); // draft

    const student = await registerVerifyLogin(app, otherStudent);
    const res = await request(app).get(`${API}/questions`).set('Cookie', cookieHeader(student.cookies)).expect(200);

    expect(res.body.questions).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('answers 404, not 403, for a draft a student asks for by id', async () => {
    const { cookies, taxonomy } = await adminWithTaxonomy();
    const draft = await createQuestionVia(app, cookies, taxonomy);

    const student = await registerVerifyLogin(app, otherStudent);
    const res = await request(app).get(`${API}/questions/${draft.id}`).set('Cookie', cookieHeader(student.cookies));

    // 403 would confirm a draft with this id exists, which is not a student's business.
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it('refuses a student every admin question-bank endpoint', async () => {
    const { cookies, taxonomy } = await adminWithTaxonomy();
    const question = await createQuestionVia(app, cookies, taxonomy);
    const student = await registerVerifyLogin(app, otherStudent);
    const cookie = cookieHeader(student.cookies);

    const calls = [
      request(app).get(`${API}/admin/questions`).set('Cookie', cookie),
      request(app).get(`${API}/admin/questions/${question.id}`).set('Cookie', cookie),
      request(app).post(`${API}/admin/questions`).set('Cookie', cookie).send(validQuestion(taxonomy)),
      request(app).put(`${API}/admin/questions/${question.id}`).set('Cookie', cookie).send(validQuestion(taxonomy)),
      request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'published' }),
      request(app).delete(`${API}/admin/questions/${question.id}`).set('Cookie', cookie),
      request(app).post(`${API}/admin/subjects`).set('Cookie', cookie).send({ name: 'Sneaky' }),
      request(app).post(`${API}/admin/topics`).set('Cookie', cookie).send({ subject: taxonomy.subjectId, name: 'Sneaky' }),
    ];

    for (const call of calls) {
      const res = await call;
      expect(res.status).toBe(403);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(201);
    }
  });

  it('refuses a guest every admin question-bank endpoint', async () => {
    const { cookies, taxonomy } = await adminWithTaxonomy();
    const question = await createQuestionVia(app, cookies, taxonomy);

    const calls = [
      request(app).get(`${API}/admin/questions`),
      request(app).post(`${API}/admin/questions`).send(validQuestion(taxonomy)),
      request(app).delete(`${API}/admin/questions/${question.id}`),
      request(app).post(`${API}/admin/subjects`).send({ name: 'Sneaky' }),
    ];

    for (const call of calls) {
      const res = await call;
      expect(res.status).toBe(401);
    }
  });

  it('holds the same gate on the unversioned /api alias', async () => {
    const { cookies, taxonomy } = await adminWithTaxonomy();
    await createQuestionVia(app, cookies, taxonomy);
    const student = await registerVerifyLogin(app, otherStudent);

    const res = await request(app).get('/api/admin/questions').set('Cookie', cookieHeader(student.cookies));
    expect(res.status).toBe(403);
  });

  it('lets a student read the taxonomy, which carries no answers', async () => {
    const { cookies } = await adminWithTaxonomy();
    void cookies;
    const student = await registerVerifyLogin(app, otherStudent);

    const subjects = await request(app).get(`${API}/subjects`).set('Cookie', cookieHeader(student.cookies)).expect(200);
    expect(subjects.body.subjects.length).toBeGreaterThan(0);

    await request(app).get(`${API}/topics`).set('Cookie', cookieHeader(student.cookies)).expect(200);
  });

  it('validates the student listing query once a session exists', async () => {
    const student = await registerVerifyLogin(app);
    const cookie = cookieHeader(student.cookies);

    const bad = await request(app).get(`${API}/questions?difficulty=Impossible`).set('Cookie', cookie);
    expect(bad.status).toBe(400);

    const good = await request(app).get(`${API}/questions?difficulty=Easy`).set('Cookie', cookie);
    expect(good.status).toBe(200);
    expect(good.status).not.toBe(500);
  });

  it('ignores a status parameter on the student listing instead of honouring it', async () => {
    const { cookies, taxonomy } = await adminWithTaxonomy();
    await createQuestionVia(app, cookies, taxonomy); // a draft
    const student = await registerVerifyLogin(app, otherStudent);

    // The public schema has no `status` key, so an unknown param is stripped rather
    // than used — the draft must stay hidden either way.
    const res = await request(app).get(`${API}/questions?status=draft`).set('Cookie', cookieHeader(student.cookies));
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([]);
  });
});

// ===========================================================================
// The audit trail
// ===========================================================================

describe('audit trail', () => {
  it('records creation, edits, status changes and deletion', async () => {
    const { cookies, cookie, taxonomy } = await adminWithTaxonomy();

    const question = await createQuestionVia(app, cookies, taxonomy);
    await request(app).put(`${API}/admin/questions/${question.id}`).set('Cookie', cookie).send(validQuestion(taxonomy, { marks: 5 })).expect(200);
    await request(app).patch(`${API}/admin/questions/${question.id}/status`).set('Cookie', cookie).send({ status: 'in_review' }).expect(200);
    await request(app).delete(`${API}/admin/questions/${question.id}`).set('Cookie', cookie).expect(200);

    const actions: AuditAction[] = ['question.created', 'question.updated', 'question.status.changed', 'question.deleted'];
    for (const action of actions) {
      const entry = await AuditLog.findOne({ action });
      expect(entry, `expected an audit entry for ${action}`).not.toBeNull();
      expect(entry!.targetType).toBe('question');
    }

    // The deletion entry still names what was destroyed, which is only possible
    // because the route reads the question before deleting it.
    const deleted = await AuditLog.findOne({ action: 'question.deleted' });
    expect(deleted!.targetLabel).toContain('x^2 - 5x + 6');
  });

  it('records subject and topic changes', async () => {
    const { cookies } = await createAdminSession(app);
    await createTaxonomy(app, cookies);

    expect(await AuditLog.countDocuments({ action: 'subject.changed' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'topic.changed' })).toBe(2);
  });
});
