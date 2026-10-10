import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import app from '../src/app';
import { config } from '../src/config';
import { cached, clearCache, invalidate } from '../src/lib/cache';
import { resetRedisCoolOff } from '../src/lib/redis';
import { SharedRateLimitStore } from '../src/middleware/sharedRateLimitStore';
import { Student, StudentActivity } from '../src/models';
import { getLeaderboardPage, getStandingFor } from '../src/services/leaderboardService';
import { todayKey } from '../src/lib/competitionDay';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import { clearTestInbox, registerVerifyLogin } from './helpers/auth';

/**
 * The read cache and the shared rate-limit store (2026-10-10 — 1,000 students at once).
 *
 * The cache is off under `NODE_ENV=test` everywhere else, because a test writes and reads back at
 * once; here it is switched on, and Redis is a fake Upstash answering `fetch` in memory — so
 * nothing reaches the network, and "another server" is simply this one with its memory emptied.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

const realCache = { ...config.cache };

/** A minimal Upstash REST API: one command, or a pipeline, over an in-memory map. */
function fakeUpstash(options: { down?: boolean } = {}) {
  const data = new Map<string, { value: string; expiresAt: number | null }>();
  const calls: string[][] = [];
  const live = (key: string) => {
    const entry = data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) data.delete(key);
    return data.get(key);
  };
  const run = (command: Array<string | number>): unknown => {
    const [name, key, ...rest] = command.map(String);
    calls.push([name!, key!, ...rest]);
    switch (name) {
      case 'GET':
        return live(key!)?.value ?? null;
      case 'SET': {
        const px = rest.indexOf('PX') >= 0 ? Number(rest[rest.indexOf('PX') + 1]) : null;
        const ex = rest.indexOf('EX') >= 0 ? Number(rest[rest.indexOf('EX') + 1]) * 1000 : null;
        if (rest.includes('NX') && live(key!)) return null;
        const ttl = px ?? ex;
        data.set(key!, { value: rest[0]!, expiresAt: ttl === null ? null : Date.now() + ttl });
        return 'OK';
      }
      case 'INCR': {
        const entry = live(key!);
        const next = Number(entry?.value ?? '0') + 1;
        data.set(key!, { value: String(next), expiresAt: entry?.expiresAt ?? null });
        return next;
      }
      case 'DECR': {
        const entry = live(key!);
        const next = Number(entry?.value ?? '0') - 1;
        data.set(key!, { value: String(next), expiresAt: entry?.expiresAt ?? null });
        return next;
      }
      case 'PTTL': {
        const entry = live(key!);
        return entry ? (entry.expiresAt === null ? -1 : entry.expiresAt - Date.now()) : -2;
      }
      case 'DEL':
        return data.delete(key!) ? 1 : 0;
      default:
        throw new Error(`fake Upstash: ${name} not supported`);
    }
  };
  const fetchImpl = vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
    if (options.down) throw new Error('connect ECONNREFUSED');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    const body = JSON.parse(init.body) as unknown;
    const result = url.endsWith('/pipeline')
      ? (body as Array<Array<string | number>>).map((command) => ({ result: run(command) }))
      : { result: run(body as Array<string | number>) };
    return new Response(JSON.stringify(result), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchImpl);
  config.cache.redis = { url: 'https://fake-upstash.test', token: 'test-token' };
  return { data, calls, fetchImpl };
}

beforeEach(() => {
  config.cache.enabled = true;
  config.cache.redis = null;
  clearCache();
  resetRedisCoolOff();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  config.cache.enabled = realCache.enabled;
  config.cache.redis = realCache.redis;
  clearCache();
  resetRedisCoolOff();
  await clearTestDb();
  clearTestInbox();
});

describe('the read cache', () => {
  it('computes once for fifty callers asking at the same moment', async () => {
    const compute = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { figure: 42 };
    });

    const answers = await Promise.all(Array.from({ length: 50 }, () => cached('k', 60, compute)));

    expect(compute).toHaveBeenCalledTimes(1);
    expect(answers.every((answer) => answer.figure === 42)).toBe(true);
  });

  it('answers from memory until the time runs out, then computes again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const compute = vi.fn(async () => Date.now());
      const first = await cached('t', 10, compute);
      vi.setSystemTime(Date.now() + 9_000);
      expect(await cached('t', 10, compute)).toBe(first);
      vi.setSystemTime(Date.now() + 2_000);
      await cached('t', 10, compute);
      expect(compute).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands back JSON, so memory and Redis can never disagree about a value', async () => {
    const value = await cached('j', 60, async () => ({ when: new Date('2026-10-10T00:00:00.000Z'), n: 1 }));
    // A Date would come back from Redis as a string; it does from memory too.
    expect(value.when).toBe('2026-10-10T00:00:00.000Z');
  });

  it('is a straight call when switched off, as under the rest of the suite', async () => {
    config.cache.enabled = false;
    const compute = vi.fn(async () => 1);
    await cached('off', 60, compute);
    await cached('off', 60, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('shares one computation between servers through Redis', async () => {
    const redis = fakeUpstash();
    const compute = vi.fn(async () => ({ board: [1, 2, 3] }));

    await cached('shared', 60, compute);
    clearCache(); // "another server": same Redis, empty memory
    const fromRedis = await cached('shared', 60, compute);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(fromRedis).toEqual({ board: [1, 2, 3] });
    // Namespaced by database and versioned, and given the time to live asked for.
    const setCall = redis.calls.find((call) => call[0] === 'SET')!;
    expect(setCall[1]).toMatch(/^amit:.+:v1:shared$/);
    expect(setCall.slice(-2)).toEqual(['EX', '60']);
  });

  it('computes anyway when Redis is down, and stops asking it for a while', async () => {
    const redis = fakeUpstash({ down: true });
    const compute = vi.fn(async () => 'fresh');

    expect(await cached('a', 60, compute)).toBe('fresh');
    clearCache();
    expect(await cached('a', 60, compute)).toBe('fresh');

    expect(compute).toHaveBeenCalledTimes(2);
    // One failed attempt, then the cool-off: the second miss did not try Redis at all.
    expect(redis.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('forgets a key everywhere when asked to', async () => {
    const redis = fakeUpstash();
    const compute = vi.fn(async () => 'v');
    await cached('gone', 60, compute);
    await invalidate('gone');
    expect([...redis.data.keys()].some((key) => key.endsWith(':gone'))).toBe(false);
    await cached('gone', 60, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe('the shared rate-limit store', () => {
  const init = (store: SharedRateLimitStore) =>
    store.init({ windowMs: 60_000 } as Parameters<SharedRateLimitStore['init']>[0]);

  it('counts once for every server', async () => {
    fakeUpstash();
    const serverA = new SharedRateLimitStore('login');
    const serverB = new SharedRateLimitStore('login');
    init(serverA);
    init(serverB);

    await serverA.increment('1.2.3.4');
    await serverB.increment('1.2.3.4');
    const third = await serverA.increment('1.2.3.4');

    expect(third.totalHits).toBe(3);
    expect(third.resetTime!.getTime()).toBeGreaterThan(Date.now());
    expect(third.resetTime!.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('keeps one window from its first request, not a fresh one per hit', async () => {
    const redis = fakeUpstash();
    const store = new SharedRateLimitStore('register');
    init(store);
    await store.increment('k');
    const expiry = redis.data.get('amit:rl:register:k')!.expiresAt;
    await store.increment('k');
    expect(redis.data.get('amit:rl:register:k')!.expiresAt).toBe(expiry);
  });

  it('counts in this server’s memory when Redis is down, so a sign-in is never refused for it', async () => {
    fakeUpstash({ down: true });
    const store = new SharedRateLimitStore('login');
    init(store);
    expect((await store.increment('k')).totalHits).toBe(1);
    expect((await store.increment('k')).totalHits).toBe(2);
  });

  it('counts in memory with no Redis configured at all', async () => {
    const store = new SharedRateLimitStore('login');
    init(store);
    expect((await store.increment('k')).totalHits).toBe(1);
  });
});

describe('a cached leaderboard', () => {
  async function accountOf(studentId: string) {
    const account = await Student.findOne({ studentId });
    return account!._id as mongoose.Types.ObjectId;
  }

  async function earn(student: mongoose.Types.ObjectId, xp: number) {
    await StudentActivity.create({ student, type: 'profile_updated', xpAwarded: xp, occurredOn: todayKey() });
  }

  it('shows a student their own new XP at once, against a board up to a minute old', async () => {
    const a = await registerVerifyLogin(app, { email: 'cache-a@example.com', mobile: '9700000001' });
    const b = await registerVerifyLogin(app, { email: 'cache-b@example.com', mobile: '9700000002' });
    const idA = await accountOf(a.studentId);
    const idB = await accountOf(b.studentId);
    await StudentActivity.deleteMany({});
    await earn(idA, 100);
    await earn(idB, 50);

    const board = { scope: 'overall', period: 'all_time' } as const;
    expect((await getStandingFor(idB, board)).rank).toBe(2);

    // B overtakes A. The board itself is cached, so the page still lists the old order…
    await earn(idB, 100);
    const page = await getLeaderboardPage(board, { page: 1, limit: 10 });
    expect(page.rows.map((row) => row.studentId)).toEqual([a.studentId, b.studentId]);
    // …but B's own standing is worked out from B's fresh XP, so it moves at once.
    expect(await getStandingFor(idB, board)).toEqual({ rank: 1, xp: 150, totalRanked: 2 });
  });

  it('shares a rank between equal totals across the page boundary, from the cached board', async () => {
    // One after another: the sign-up helper reads the newest captured email.
    const students = [];
    for (const n of [1, 2, 3]) {
      students.push(await registerVerifyLogin(app, { email: `tie-${n}@example.com`, mobile: `970000001${n}` }));
    }
    await StudentActivity.deleteMany({});
    const ids = await Promise.all(students.map((s) => accountOf(s.studentId)));
    await earn(ids[0]!, 300);
    await earn(ids[1]!, 200);
    await earn(ids[2]!, 200);

    const second = await getLeaderboardPage({ scope: 'overall', period: 'all_time' }, { page: 2, limit: 2 });
    expect(second.rows.map((row) => row.rank)).toEqual([2]);
    expect(second.pagination.total).toBe(3);
  });
});
