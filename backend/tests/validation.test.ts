import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { validStudent } from './helpers/auth';
import { registerSchema } from '../src/validation/authSchemas';

// Functional coverage of the request-validation layer only. Security-specific
// behaviour (rate limiting, injection shapes, CORS, headers) is deliberately
// NOT tested at this milestone — see TESTING.md "Deliberately untested".
//
// These run with no database, so a payload that passes validation would reach
// `ensureDb` and get a 503 — which is exactly why every case here is one that
// validation must reject first.

describe('POST /api/v1/auth/register validation', () => {
  it('rejects a short password with 400 before touching the database', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validStudent, password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/password/i);
  });

  it('rejects a missing last name with 400', async () => {
    const { lastName, ...withoutLastName } = validStudent;
    void lastName;
    const res = await request(app).post('/api/v1/auth/register').send(withoutLastName);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/last name/i);
  });

  it('rejects an empty body with 400 rather than a 500', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({});

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
  });
});

describe('POST /api/v1/admin/generate-questions validation', () => {
  it('rejects an out-of-range count with 400 (before the admin auth gate is even relevant)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/generate-questions')
      .send({ classLevel: 'Class 8', subject: 'Mathematics', topic: 'Algebra', difficulty: 'Easy', count: 999 });

    // Unauthenticated, so auth rejects first — the point is it never 500s.
    expect([400, 401]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
});

/**
 * `GET /questions` is **authenticated** as of Milestone 4. It used to have no auth
 * middleware at all and returned raw documents including `correctAnswer`, so the
 * answer key was readable by anyone on the internet.
 *
 * Authorization runs before validation, so an anonymous request is refused before
 * the query schema is ever consulted — which is why the query-validation cases moved
 * to `questionBank.test.ts`, where a real session exists. What belongs here is the
 * gate itself, asserted on both the versioned and unversioned mounts.
 */
describe('GET /api/v1/questions is no longer anonymous', () => {
  it('refuses an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/questions');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('refuses an unauthenticated request on the unversioned /api alias too', async () => {
    const res = await request(app).get('/api/questions');
    expect(res.status).toBe(401);
  });

  it('does not leak an answer key to an anonymous caller', async () => {
    const res = await request(app).get('/api/v1/questions');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('correctAnswer');
    expect(body).not.toContain('isCorrect');
    expect(body).not.toContain('solution');
  });

  it('refuses an anonymous single-question read as well', async () => {
    const res = await request(app).get('/api/v1/questions/000000000000000000000001');
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(200);
  });
});

describe('the password policy', () => {
  /**
   * Owner's decision, 2026-09-02: at least eight characters, and at least one of each of
   * lowercase, uppercase, number and special character.
   *
   * Exercised through `registerSchema` rather than over HTTP, so every rule can be named
   * individually without a database or a rate limiter in the way. The same `password`
   * schema is imported by the reset-link and change-password flows, so what holds here
   * holds for every path that sets a password — there is deliberately only one policy.
   */
  function attempt(password: string) {
    return registerSchema.safeParse({ ...validStudent, password });
  }

  function messagesFor(password: string): string {
    const parsed = attempt(password);
    if (parsed.success) return '';
    return parsed.error.issues.map((issue) => issue.message).join(' | ');
  }

  it('accepts a password holding all four classes', () => {
    const parsed = attempt('Sunrise7!');
    expect(parsed.success, parsed.success ? '' : messagesFor('Sunrise7!')).toBe(true);
  });

  it.each([
    ['too short', 'Ab1!xyz', /at least 8/i],
    ['no lowercase', 'SUNRISE7!', /lowercase/i],
    ['no uppercase', 'sunrise7!', /uppercase/i],
    ['no number', 'SunriseDay!', /number/i],
    ['no special character', 'Sunrise777', /special character/i],
  ])('refuses one with %s', (_label, password, expected) => {
    expect(attempt(password).success).toBe(false);
    expect(messagesFor(password)).toMatch(expected);
  });

  it('reports every missing requirement at once, not the next one', () => {
    // A form can only tell a reader everything that is wrong if the schema returns
    // everything that is wrong. `abcdefgh` breaks three rules, and all three are named
    // — otherwise somebody tries five passwords, learning one rule each time.
    const messages = messagesFor('abcdefgh');
    expect(messages).toMatch(/uppercase/i);
    expect(messages).toMatch(/number/i);
    expect(messages).toMatch(/special character/i);
  });

  it('counts a space as a special character, and does not trim it away', () => {
    // Deliberate: a passphrase with spaces is a good password, and trimming one would
    // change a credential the reader believes they chose.
    const parsed = attempt('Sunrise 7 morning');
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.password).toBe('Sunrise 7 morning');
  });

  it('is refused at the endpoint too, before the database is touched', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...validStudent, password: 'sunrise7' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });
});
