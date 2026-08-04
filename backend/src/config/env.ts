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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  MONGO_URI: z.string().min(1).default('mongodb://localhost:27017/amit-olympiad'),
  JWT_SECRET: z.string().min(1).optional(),
  ADMIN_EMAIL: z.string().min(1).optional(),
  ADMIN_PASSWORD_HASH: z.string().min(1).optional(),
  FRONTEND_URL: z.string().url().optional(),
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
