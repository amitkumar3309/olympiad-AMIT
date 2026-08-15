import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Where `backend/.env` is, resolved from **this file's own location** rather than
 * from `process.cwd()`.
 *
 * This matters more than it looks. `dotenv.config()` with no argument searches the
 * current working directory, so running a script from `backend/scripts/` instead of
 * `backend/` found no `.env`, loaded **zero** variables, and silently fell through to
 * the `MONGO_URI` default below — `mongodb://localhost:27017/...`. The script then
 * reported success while writing 208 questions into a local database nobody was
 * looking at, and the production site stayed empty. Nothing warned, because every
 * value has a plausible default.
 *
 * Resolving from this module's own directory makes the load independent of where the
 * process was started: `src/config/env.ts` → up two levels → the backend package root.
 *
 * `__dirname` rather than `import.meta.url`, because this package compiles to
 * CommonJS (`tsconfig.json`), where `import.meta` is a syntax error. `tsx` accepts
 * both, so the failure would only have appeared at `npm run compile` — i.e. on the
 * Vercel build, which is the worst place to find it.
 */
function backendEnvPath(): string {
  return path.resolve(__dirname, '..', '..', '.env');
}

/**
 * True when a `.env` file was actually read. Scripts that write to the database use
 * this to refuse to run when they have clearly not been given real configuration —
 * see `assertConfiguredForWrites()` in `lib/envGuard.ts`.
 */
export let envFileLoaded = false;

// Skipped under NODE_ENV=test (which vitest sets automatically) so the test suite
// stays hermetic: tests must not silently pick up a developer's real Atlas URI or
// JWT secret. In production, Vercel injects env vars directly and there is no .env
// file to read — dotenv simply reports none found, which is correct there.
if (process.env.NODE_ENV !== 'test') {
  const result = dotenv.config({ path: backendEnvPath() });
  envFileLoaded = !result.error && Object.keys(result.parsed ?? {}).length > 0;
}

/**
 * Accepts 'true'/'false'/'1'/'0' — env vars are always strings, so a plain
 * z.boolean() would reject every real value. `.default()` sits after the
 * transform, so it takes the already-decoded boolean.
 */
const booleanish = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .default(defaultValue);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  MONGO_URI: z.string().min(1).default('mongodb://localhost:27017/amit-olympiad'),
  JWT_SECRET: z.string().min(1).optional(),
  ADMIN_EMAIL: z.string().min(1).optional(),
  ADMIN_PASSWORD_HASH: z.string().min(1).optional(),
  FRONTEND_URL: z.string().url().optional(),

  // --- Token lifetimes ---
  /** Access-token lifetime, as an ms/jsonwebtoken duration string ('15m', '1h'). */
  ACCESS_TOKEN_TTL: z.string().min(1).default('15m'),
  /** Refresh-token lifetime in days. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
  /** Admin access-token lifetime (admins have no refresh token — see DECISIONS.md). */

  // --- Auth policy ---
  REQUIRE_EMAIL_VERIFICATION: booleanish(true),
  /** Failed logins before the account is temporarily locked. */
  MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  /** How long an account stays locked, in minutes. */
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  // --- Email (SMTP; any free-tier provider works — see ENVIRONMENT_VARIABLES.md) ---
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_SECURE: booleanish(false),
  EMAIL_FROM: z.string().min(1).default('AMIT Olympiad <no-reply@amitolympiad.local>'),

  // --- Performance recommendations (Milestone 16) ---
  /**
   * Which registered recommendation engine to use. Defaults to the statistical one,
   * which needs no credentials, no network and no paid service — the MVP runs on it.
   *
   * An unknown value is a misconfiguration rather than a fatal error: the service logs
   * once and falls back, because a typo here should not take the advice panel down.
   * Deliberately not an enum, since the whole point of the seam is that an engine can
   * be added without editing this schema.
   */
  RECOMMENDATION_ENGINE: z.string().min(1).default('statistical-v1'),

  // --- AI question drafting (Milestone 17) ---
  /**
   * Google Gemini API key. **Optional, and the product is complete without it** — with
   * no key the admin generator falls back to blank templates, exactly as before.
   *
   * This is the only AI credential in the project, and it is used for exactly one
   * thing: drafting questions from a subject, a topic, a class and a difficulty. No
   * student data is ever sent to it.
   */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /**
   * Which Gemini model to call. Configurable because model names are renamed and
   * retired on the provider's schedule rather than ours, and a rename should be an
   * environment change rather than a deploy.
   */
  /**
   * Defaults to the **rolling alias** rather than a pinned version, deliberately.
   *
   * `gemini-2.0-flash` was the original default and Google retired it, which broke
   * generation with "this model is no longer available" — a failure that arrives
   * without warning, on their schedule, in production. An alias tracks whatever the
   * current flash model is, so a retirement is invisible instead of an outage.
   *
   * Pin an exact version here if you ever need reproducible output; the cost of doing
   * so is that you own the retirement. `GET /admin/question-generator/models` lists
   * exactly what your key can use, so the name never has to be guessed.
   */
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-pro'),
  /**
   * Which registered generator the admin button uses.
   *
   * `auto` (the default) means "a model if one is configured, otherwise templates", so
   * adding `GEMINI_API_KEY` is the only step needed to turn AI drafting on and removing
   * it the only step needed to turn it off. Set an explicit id to pin one.
   */
  QUESTION_GENERATOR: z.string().min(1).default('auto'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export const env = parseEnv();
