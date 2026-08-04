import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { validStudent } from './helpers/auth';

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
