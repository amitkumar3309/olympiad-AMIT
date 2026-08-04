import dotenv from 'dotenv';
import { z } from 'zod';

// Load backend/.env before anything reads process.env. This module is imported
// (transitively, via config/index.ts) by every other module, so doing it here
// guarantees it happens first.
//
// Skipped under NODE_ENV=test (which vitest sets automatically) so the test
// suite stays hermetic: tests must not silently pick up a developer's real
// Atlas URI or JWT secret. In production, Vercel injects env vars directly and
// there is no .env file to read — dotenv simply no-ops.
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
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
  ADMIN_TOKEN_TTL: z.string().min(1).default('8h'),

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
