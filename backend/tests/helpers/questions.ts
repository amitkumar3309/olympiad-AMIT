import request from 'supertest';
import type { Express } from 'express';
import { API, cookieHeader } from './auth';

/**
 * Helpers for the question-bank suites.
 *
 * Questions cannot be created in isolation — every one needs a real subject and
 * topic, because the service refuses a taxonomy triplet it cannot resolve. These
 * helpers build that scaffolding through the **API** rather than by inserting
 * documents directly, so the tests exercise the same validation and authorization a
 * real author would hit.
 */

export interface Taxonomy {
  subjectId: string;
  topicId: string;
  subtopicId: string;
}

/** Creates a subject, a topic under it, and a subtopic under that topic. */
export async function createTaxonomy(
  app: Express,
  cookies: Record<string, string>,
  names: { subject?: string; topic?: string; subtopic?: string } = {},
): Promise<Taxonomy> {
  const cookie = cookieHeader(cookies);

  const subjectName = names.subject ?? 'Mathematics';

  /**
   * Reuses the subject when it already exists, rather than insisting on a 201.
   *
   * A test that wants **two chapters of the same subject** has to call this twice, and since
   * Milestone 21 Phase J that is the ordinary case: practice, the daily challenge and the
   * recommendations are all scoped to the one implicit subject, so reaching for a second subject
   * name to get a distinct chapter now means testing something a student can never reach. Without
   * this the second call died on the subject's unique name with a bare 409.
   */
  const created = await request(app)
    .post(`${API}/admin/subjects`)
    .set('Cookie', cookie)
    .send({ name: subjectName });

  let subjectId: string;
  if (created.status === 201) {
    subjectId = created.body.subject.id;
  } else {
    const existing = await request(app).get(`${API}/subjects`).set('Cookie', cookie).expect(200);
    const match = existing.body.subjects.find((entry: { name: string }) => entry.name === subjectName);
    if (!match) throw new Error(`createTaxonomy: could not create or find the subject "${subjectName}"`);
    subjectId = match.id;
  }

  const topic = await request(app)
    .post(`${API}/admin/topics`)
    .set('Cookie', cookie)
    .send({ subject: subjectId, name: names.topic ?? 'Algebra' })
    .expect(201);

  const subtopic = await request(app)
    .post(`${API}/admin/topics`)
    .set('Cookie', cookie)
    .send({
      subject: subjectId,
      parent: topic.body.topic.id,
      name: names.subtopic ?? 'Quadratic Equations',
    })
    .expect(201);

  return {
    subjectId,
    topicId: topic.body.topic.id,
    subtopicId: subtopic.body.topic.id,
  };
}

/**
 * A valid single-choice question body, including real LaTeX so the math path is
 * exercised by the ordinary happy-path tests rather than only by the math suite.
 */
export function validQuestion(taxonomy: Taxonomy, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    questionText: 'Solve for $x$: $x^2 - 5x + 6 = 0$. What is the larger root?',
    type: 'single_choice',
    options: [
      { text: '$x = 3$', isCorrect: true },
      { text: '$x = 2$', isCorrect: false },
      { text: '$x = -3$', isCorrect: false },
      { text: '$x = 6$', isCorrect: false },
    ],
    solution: 'Factorise as $(x-2)(x-3)=0$, so $x \\in \\{2, 3\\}$ and the larger root is $3$.',
    subject: taxonomy.subjectId,
    topic: taxonomy.topicId,
    subtopic: taxonomy.subtopicId,
    classLevel: 'Class 9',
    difficulty: 'Medium',
    marks: 4,
    negativeMarks: 1,
    tags: ['quadratic', 'roots'],
    ...overrides,
  };
}

/** Creates a question through the API and returns its admin view. */
export async function createQuestionVia(
  app: Express,
  cookies: Record<string, string>,
  taxonomy: Taxonomy,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, never> & { id: string; status: string }> {
  const res = await request(app)
    .post(`${API}/admin/questions`)
    .set('Cookie', cookieHeader(cookies))
    .send(validQuestion(taxonomy, overrides))
    .expect(201);
  return res.body.question;
}

/** Creates a question and publishes it, which is what makes it student-visible. */
export async function createPublishedQuestion(
  app: Express,
  cookies: Record<string, string>,
  taxonomy: Taxonomy,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const question = await createQuestionVia(app, cookies, taxonomy, overrides);
  await request(app)
    .patch(`${API}/admin/questions/${question.id}/status`)
    .set('Cookie', cookieHeader(cookies))
    .send({ status: 'published' })
    .expect(200);
  return { id: question.id };
}
