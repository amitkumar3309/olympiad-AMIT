import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/connection', () => ({
  getConnectionState: () => 'connected',
  isConnected: () => true,
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));

// vi.mock calls above are hoisted by Vitest above this import, so the mock
// is in place before app.ts (and its import of db/connection.ts) loads.
import app from '../src/app';

describe('GET /ready', () => {
  it('returns 200 when the DB reports connected', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'ready', db: 'connected' });
  });
});
