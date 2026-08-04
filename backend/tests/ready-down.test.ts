import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/connection', () => ({
  getConnectionState: () => 'disconnected',
  isConnected: () => false,
  getDatabaseName: () => null,
  connectDB: vi.fn(),
  disconnectDB: vi.fn(),
}));

// vi.mock calls above are hoisted by Vitest above this import, so the mock
// is in place before app.ts (and its import of db/connection.ts) loads.
import app from '../src/app';

describe('GET /ready when the DB is down', () => {
  it('returns 503 with success:false', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, db: 'disconnected' });
  });
});
