import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('GET /health', () => {
  it('returns 200 and an ok status without needing a DB connection', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'ok' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });
});
