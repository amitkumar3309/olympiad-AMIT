import { config } from '../config';
import { getDatabaseName } from '../db/connection';
import { redis } from './redis';

/**
 * THE read cache (2026-10-10, for 1,000 students at once): a figure that is the same for
 * everybody who asks within a minute is worked out once, not once per visitor.
 *
 * ## Why it exists
 *
 * The free MongoDB Atlas tier allows about 100 operations a second. Before this, one leaderboard
 * request summed every XP row three times over and the dashboard ran 34 operations, so a few
 * dozen students arriving together queued for seconds. A cached board is one aggregation a
 * minute however many students look.
 *
 * ## Three layers, cheapest first
 *
 *  1. **This server's memory**, for up to `MEMORY_TTL_SECONDS`. Free, and on a warm serverless
 *     instance it answers most requests.
 *  2. **Redis** (Upstash, optional), shared by every server — so a cold instance does not redo
 *     work another has just done. Read only on a memory miss, so it costs one command per key
 *     per server per half-minute rather than one per request (the free tier is 500,000 a month).
 *  3. **The computation itself.** Concurrent misses for one key share **one** computation
 *     (`inflight`): fifty students opening the leaderboard in the same second cause one
 *     aggregation, not fifty.
 *
 * ## The rules that travel with it
 *
 *  - **A cache expires; it never becomes a record.** Nothing here is the source of truth — the
 *    collections are, and every value can be recomputed from them. Do not read a cached value
 *    to decide money, a mark, a winner or an entitlement.
 *  - **Only what is the same for every caller of a key** — a public board, a class's board, a
 *    count. Never a student's answers, an answer key, or anything behind a permission the key
 *    does not encode.
 *  - **Values are JSON.** They go through `JSON.stringify` on every path, memory included, so a
 *    value reads back identically from either layer (a `Date` would come back from Redis as a
 *    string and from memory as a `Date`). Store numbers and strings.
 *  - Off under `NODE_ENV=test` unless `CACHE_ENABLED=true`, because a test writes and reads back
 *    in the same breath; `clearCache()` empties this server's layer.
 */

const MEMORY_TTL_SECONDS = 30;
const MAX_ENTRIES = 500;

interface Entry {
  json: string;
  expiresAt: number;
}

const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();

function fullKey(key: string): string {
  // Namespaced by database, so a preview deployment on another database can never read
  // production's figures (or the reverse) from a shared Redis.
  return `amit:${getDatabaseName() ?? 'none'}:v1:${key}`;
}

function remember(key: string, json: string, ttlSeconds: number): void {
  if (memory.size >= MAX_ENTRIES) {
    // Oldest first — a Map iterates in insertion order.
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, { json, expiresAt: Date.now() + Math.min(ttlSeconds, MEMORY_TTL_SECONDS) * 1000 });
}

/**
 * The value under `key`, computed by `compute` at most once per `ttlSeconds` per server (and,
 * with Redis, roughly once per `ttlSeconds` for the whole platform).
 */
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  if (!config.cache.enabled) return compute();

  const k = fullKey(key);
  const hit = memory.get(k);
  if (hit && hit.expiresAt > Date.now()) return JSON.parse(hit.json) as T;

  let pending = inflight.get(k);
  if (!pending) {
    pending = (async () => {
      const shared = await redis(['GET', k]);
      if (typeof shared === 'string') {
        remember(k, shared, ttlSeconds);
        return shared;
      }
      const json = JSON.stringify(await compute());
      remember(k, json, ttlSeconds);
      await redis(['SET', k, json, 'EX', ttlSeconds]);
      return json;
    })().finally(() => inflight.delete(k));
    inflight.set(k, pending);
  }
  return JSON.parse(await pending) as T;
}

/** Drops a key from this server and from Redis — for a write that must be seen at once. */
export async function invalidate(key: string): Promise<void> {
  const k = fullKey(key);
  memory.delete(k);
  if (config.cache.enabled) await redis(['DEL', k]);
}

/** Empties this server's layer (tests, and the browser suite's reset). */
export function clearCache(): void {
  memory.clear();
  inflight.clear();
}
