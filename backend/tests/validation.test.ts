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

describe('GET /api/v1/questions query validation', () => {
  it('accepts a request with no query filters (schema treats all filters as optional)', async () => {
    const res = await request(app).get('/api/v1/questions');
    expect(res.status).not.toBe(400);
  });

  it('passes a VALID query through without a 500 (regression: Express 5 req.query is getter-only)', async () => {
    // Assigning to req.query throws in Express 5, which surfaced as a 500 only
    // on the success path — a weaker `not.toBe(400)` assertion hid it. With no
    // database reachable the DB gate answers 503, so the one status this must
    // never be is 500.
    const res = await request(app).get('/api/v1/questions').query({ difficulty: 'Easy' });
    expect(res.status).not.toBe(500);
  });

  it('rejects an unsupported difficulty value with 400', async () => {
    const res = await request(app).get('/api/v1/questions').query({ difficulty: 'Impossible' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
