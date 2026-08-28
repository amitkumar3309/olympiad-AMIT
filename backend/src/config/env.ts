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

  // --- AI question drafting (Milestone 17, extended in Milestone 20) ---
  /**
   * Google Gemini API key. **Optional: every other feature works without it.**
   *
   * With no key the AI generator page says so and refuses with a 503 naming this
   * variable. It does *not* invent filler — the template fallback that used to sit here
   * was removed in Milestone 18, because a blank placeholder is only useful as something
   * to type into and a reviewer who wants one can create a question by hand.
   *
   * This is the only AI credential in the project, and it is used for exactly one thing:
   * drafting questions from a subject, a topic, a class and a difficulty. No student data
   * is ever sent to it.
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
   * `auto` (the default) means "the first configured provider", so adding
   * `GEMINI_API_KEY` is the only step needed to turn AI drafting on and removing it the
   * only step needed to turn it off. Set an explicit id to pin one.
   */
  QUESTION_GENERATOR: z.string().min(1).default('auto'),
  /**
   * How many **extra** attempts a transient provider failure earns. 0 disables retrying.
   *
   * Small on purpose, and capped at 3. Only 429, 5xx and timeouts are retried at all
   * (see `isTransient()` in `services/geminiQuestionGenerator.ts`); an expired key or a
   * retired model name is permanent, and repeating it spends quota to receive the same
   * refusal. Against a metered free tier a failed generation should tell the examiner
   * immediately rather than quietly costing three more requests.
   */
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  /**
   * The most questions one generation request may ask for, and the longest steer an
   * examiner may attach.
   *
   * Both are cost controls rather than correctness rules, which is why they are
   * environment configuration: a deployment on a tighter quota can lower them without a
   * code change. They are enforced in the zod schema, so the browser cannot exceed them
   * whatever the form allows — and the *ceiling* on the ceiling is in code (20 / 2000),
   * because the review screen has to stay reviewable by one human in one sitting.
   */
  GENERATION_MAX_QUESTIONS: z.coerce.number().int().min(1).max(20).default(20),
  GENERATION_MAX_INSTRUCTION_CHARS: z.coerce.number().int().min(50).max(2000).default(500),
  /**
   * Generation requests allowed per hour, per IP. Each one spends provider quota, so
   * this is the same kind of protection `paymentLimiter` gives the Razorpay API call.
   */
  GENERATION_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(60),

  // --- Bulk question import (Milestone 21) ---
  /**
   * The most questions one bulk import may offer for review.
   *
   * A cost and usability control rather than a correctness rule, which is why it is
   * configuration: a deployment on a smaller serverless plan can lower it without a code
   * change. The *ceiling on the ceiling* is `IMPORT_HARD_MAX` in
   * `services/questionImportService.ts`, because a review step nobody can realistically
   * finish is not a review step — the same argument that caps a generated batch at 20, with a
   * much higher number because moving an existing collection is the whole point of importing.
   */
  IMPORT_MAX_QUESTIONS: z.coerce.number().int().min(1).max(500).default(200),
  /**
   * Import requests allowed per hour, per IP.
   *
   * Lower than the general limiter for two different reasons depending on the format. Every
   * import decompresses an archive and validates hundreds of rows, which is the most CPU any
   * route in this product spends; and the **image** path additionally spends provider quota
   * per file, so ten photographs is ten model calls — the same argument that put
   * `generationLimiter` in front of the one metered route.
   */
  IMPORT_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(500).default(20),

  // --- Payments (Milestone 19) ---
  /**
   * Razorpay credentials. **Only these two, plus the webhook secret, are env vars** —
   * the fee amount is business configuration and lives in an admin-editable settings
   * document, not here, so changing a price is not a redeploy.
   *
   * `RAZORPAY_KEY_ID` is public by design (the browser needs it to open the checkout)
   * but is still served from the backend rather than built into the frontend bundle,
   * so the two can never drift apart. `RAZORPAY_KEY_SECRET` must never leave this
   * process.
   *
   * All three optional: with none set, payments are unconfigured and the routes say so
   * rather than half-working.
   */
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  /**
   * Shared secret for webhook signature verification. Deliberately separate from the
   * API secret: Razorpay signs webhooks with this one, it is set independently in their
   * dashboard, and a webhook endpoint that accepted the API secret would be verifying
   * the wrong thing.
   */
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),

  // --- Invoices (Milestone 22, Phase C) ---
  /**
   * What is printed at the top of a student's invoice.
   *
   * These are **not credentials** — by the rule that put the entry fee in an
   * administrator-editable document, business configuration does not belong in the
   * environment. They are here anyway, and the distinction is worth stating: the fee is a
   * *price*, which changes, needs an audit trail, and is decided by someone who should not
   * need a redeploy. An organisation's registered address and tax registration change
   * roughly never, are decided once, and are the kind of thing that must be **absent**
   * rather than wrong. An unset variable prints nothing; an empty settings field would
   * print an empty line on a financial document.
   *
   * The name, email and phone default to what the platform already publishes in its own
   * footer, so an invoice is correct with no configuration at all.
   */
  INVOICE_ORG_NAME: z.string().min(1).default('A.M.I.T Maths Olympiad'),
  /** Address lines separated by `|`. Omitted from the document entirely when unset. */
  INVOICE_ORG_ADDRESS: z.string().min(1).optional(),
  INVOICE_ORG_EMAIL: z.string().min(1).default('support@amitolympiad.com'),
  INVOICE_ORG_PHONE: z.string().min(1).default('+91 9782870716'),
  /**
   * GST registration number. **Optional, and never defaulted to anything.**
   *
   * With it set the document is titled `TAX INVOICE` and the number is printed; with it
   * unset the document is titled `INVOICE` and says nothing about tax at all. Inventing a
   * GSTIN, a tax rate, or the phrase "inclusive of all taxes" would be a legal claim this
   * codebase is in no position to make on the owner's behalf.
   */
  INVOICE_GSTIN: z.string().min(1).optional(),
  /**
   * One line of tax or legal wording, printed verbatim under the total when set — for
   * example a statement that the organisation is not registered for GST. Free text
   * because only the owner's accountant knows what is correct here.
   */
  INVOICE_TAX_NOTE: z.string().min(1).optional(),
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
