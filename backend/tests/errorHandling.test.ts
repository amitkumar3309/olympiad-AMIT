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

describe('the unversioned /api compatibility alias', () => {
  it('serves the same route as /api/v1 so the existing frontend keeps working', async () => {
    const versioned = await request(app).get('/api/v1/analytics/AMIT_1234');
    const alias = await request(app).get('/api/analytics/AMIT_1234');
    expect(alias.status).toBe(versioned.status);
  });
});
