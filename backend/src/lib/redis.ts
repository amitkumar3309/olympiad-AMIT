import { config } from '../config';
import { logger } from './logger';

/**
 * THE Redis client (2026-10-10): Upstash, over its REST API, with `fetch` — no package and no
 * socket. A serverless function is frozen between requests, so a held-open Redis connection is
 * the same trap as an unbounded MongoDB pool; one HTTPS request per command is not.
 *
 * ## It never throws, and it never waits long
 *
 * Redis makes the site faster; it must never make it slower or broken. Every call:
 *  - gives up after `TIMEOUT_MS` and answers `undefined`;
 *  - answers `undefined` when Redis is not configured (`config.cache.redis` is null);
 *  - after a failure, **stops trying for `COOL_OFF_MS`**, so an outage costs one timeout per
 *    server per half-minute rather than one per request.
 *
 * Callers treat `undefined` as "Redis had nothing to say" and carry on — the cache computes,
 * the rate limiter counts in memory. The token is a credential: it is sent only as a header,
 * and never logged.
 */

const TIMEOUT_MS = 400;
const COOL_OFF_MS = 30_000;

let coolingOffUntil = 0;

export function redisConfigured(): boolean {
  return config.cache.redis !== null;
}

type Command = Array<string | number>;

async function send(path: '' | '/pipeline', body: Command | Command[]): Promise<unknown> {
  const redis = config.cache.redis;
  if (!redis || Date.now() < coolingOffUntil) return undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${redis.url}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Redis answered ${res.status}`);
    return await res.json();
  } catch (err) {
    coolingOffUntil = Date.now() + COOL_OFF_MS;
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Redis unavailable — falling back for 30 s');
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** One command, e.g. `['GET', key]`. `undefined` when Redis is absent, slow or failing. */
export async function redis(command: Command): Promise<unknown> {
  const reply = (await send('', command)) as { result?: unknown; error?: string } | undefined;
  if (!reply || reply.error !== undefined) return undefined;
  return reply.result;
}

/** Several commands in one round trip. `undefined` unless every one of them succeeded. */
export async function redisPipeline(commands: Command[]): Promise<unknown[] | undefined> {
  const reply = (await send('/pipeline', commands)) as Array<{ result?: unknown; error?: string }> | undefined;
  if (!Array.isArray(reply) || reply.some((entry) => entry.error !== undefined)) return undefined;
  return reply.map((entry) => entry.result);
}

/** For tests: forget a failure so the next call tries again. */
export function resetRedisCoolOff(): void {
  coolingOffUntil = 0;
}
