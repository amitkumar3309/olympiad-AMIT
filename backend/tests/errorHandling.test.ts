import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('unknown routes', () => {
  it('returns a 404 with the standard error envelope', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });
});

describe('unauthenticated access to a protected route', () => {
  it('returns 401 before ever touching the database', async () => {
    const res = await request(app).get('/api/v1/analytics/AMIT_1234');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false });
  });
});

describe('a body the parser refuses (Milestone 30 Phase 7b)', () => {
  it('answers an over-limit body with a 413 that says how much the form takes — never a 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'x'.repeat(150 * 1024), password: 'irrelevant' });
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    // The default parser's 100 KB, described as the file it would be: about 71 KB.
    expect(res.body.error).toContain('71 KB');
  });

  it('answers a body that is not JSON with a 400 — never a 500', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"identifier": ');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: expect.stringContaining('not valid JSON') });
  });
});

describe('the unversioned /api compatibility alias', () => {
  it('serves the same route as /api/v1 so the existing frontend keeps working', async () => {
    const versioned = await request(app).get('/api/v1/analytics/AMIT_1234');
    const alias = await request(app).get('/api/analytics/AMIT_1234');
    expect(alias.status).toBe(versioned.status);
  });
});
