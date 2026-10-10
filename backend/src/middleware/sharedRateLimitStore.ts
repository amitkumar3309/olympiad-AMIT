import { MemoryStore, type IncrementResponse, type Options, type Store } from 'express-rate-limit';
import { redis, redisConfigured, redisPipeline } from '../lib/redis';

/**
 * A rate-limit counter shared by every server, in Redis (2026-10-10 — SCALE_READINESS P0-2).
 *
 * The library's default `MemoryStore` counts per server instance: with twenty warm serverless
 * instances a "10 sign-ins per 15 minutes" limit is really two hundred, and a cold start resets
 * it to zero, so the limits that exist for security (sign-in, registration, emails, payments)
 * were easy to step round by spreading requests. This store counts once for the platform.
 *
 * **It falls back, never fails.** With no Redis configured, or Redis slow or down (`lib/redis.ts`
 * answers `undefined` after 400 ms and then rests), each call counts in the per-server
 * `MemoryStore` instead — exactly the behaviour before this existed. A limiter must never be the
 * reason a sign-in fails.
 *
 * Only the low-volume, security-relevant limiters use it. Each counted request costs three Redis
 * commands, and the free Upstash tier is 500,000 a month — the general limiter (every API call)
 * and the per-account practice, mock-test and quiz limiters stay in memory.
 */
export class SharedRateLimitStore implements Store {
  /** Counted by Redis, so the library must not assume keys are local to this process. */
  localKeys = false;
  readonly prefix: string;

  private windowMs = 60_000;
  private readonly local = new MemoryStore();

  constructor(name: string) {
    this.prefix = `amit:rl:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.local.init(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (!redisConfigured()) return this.local.increment(key);
    const k = this.prefix + key;
    // Start the window if this is the first hit (`NX` keeps an existing window's expiry), then
    // count. `INCR` keeps the key's time to live, so the window is fixed from its first request.
    const reply = await redisPipeline([
      ['SET', k, '0', 'PX', this.windowMs, 'NX'],
      ['INCR', k],
      ['PTTL', k],
    ]);
    if (!reply) return this.local.increment(key);
    const totalHits = Number(reply[1]);
    const ttl = Number(reply[2]);
    return { totalHits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
  }

  async decrement(key: string): Promise<void> {
    if (redisConfigured() && (await redis(['DECR', this.prefix + key])) !== undefined) return;
    await this.local.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    if (redisConfigured()) await redis(['DEL', this.prefix + key]);
    await this.local.resetKey(key);
  }

  /** The browser suite's reset (`/__e2e/reset`), which never has Redis. */
  async resetAll(): Promise<void> {
    await this.local.resetAll();
  }
}
