import { env } from './env';
import { logger } from '../lib/logger';

const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

const INSECURE_DEV_JWT_SECRET = 'dev_insecure_secret_change_me';

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start in production with an insecure default secret. ' +
        'Set JWT_SECRET in your production environment variables (see ENVIRONMENT_VARIABLES.md).',
    );
  }
  logger.warn(
    'JWT_SECRET is not set — using an insecure development-only default. Set it in backend/.env before deploying.',
  );
  jwtSecret = INSECURE_DEV_JWT_SECRET;
}

const LOCAL_FRONTEND_ORIGIN = 'http://localhost:5173';

/**
 * The origins allowed to make credentialed cross-origin requests, and — since the
 * security audit — the same list the CSRF origin check is made against.
 *
 * `http://localhost:5173` is included **only outside production**. It used to be
 * unconditional, which meant a deployed API accepted credentialed requests from any
 * page a visitor happened to be serving on that port of their own machine: a
 * development server left running, or anything a user was talked into starting. That
 * is a genuine cross-origin read of a signed-in student's data, and it also punched a
 * permanent hole in the origin check below, because `localhost:5173` would always be
 * an "allowed" origin for a forged request.
 *
 * Removing it fails **closed**: with `FRONTEND_URL` unset in production the list is
 * empty and no cross-origin request is allowed at all. The deployed site is unaffected
 * either way, because the frontend proxies `/api/*` through a Vercel rewrite and the
 * browser therefore never issues a cross-origin request to this backend.
 */
const corsOrigins = [env.FRONTEND_URL, isProd ? undefined : LOCAL_FRONTEND_ORIGIN].filter(
  (origin): origin is string => Boolean(origin),
);

if (isProd && !env.FRONTEND_URL) {
  // `error`, not `warn`, and it names the consequence that actually bites first.
  //
  // The CORS half of this is survivable: the deployed frontend proxies `/api/*` to this
  // backend through a Vercel rewrite, so the browser sees a same-origin request and no
  // preflight happens — the site keeps working, which is precisely why this went
  // unnoticed. The *email* half is not survivable and is silent: every verification and
  // password-reset link is built from `publicAppUrl`, so with this unset they all point
  // at `http://localhost:5173` and every student who registers receives a dead link.
  // They cannot log in, because login requires a verified address.
  //
  // Deliberately not a throw. A student who registered while this was misconfigured has
  // a real account, and once the variable is set "resend verification" reaches them —
  // refusing to boot, or refusing to register, would take that away for no gain.
  logger.error(
    'FRONTEND_URL is not set in production. Every verification and password-reset email will link to ' +
      `${LOCAL_FRONTEND_ORIGIN}, which is dead for your students, so nobody can verify their address or sign in. ` +
      'No cross-origin request is allowed either, and no browser origin is recognised by the CSRF check. Set ' +
      'FRONTEND_URL to your frontend production URL and redeploy the backend (see ENVIRONMENT_VARIABLES.md). ' +
      'Students who already registered can be recovered with "resend verification" once it is set.',
  );
}

if (isProd && (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD_HASH)) {
  logger.warn('ADMIN_EMAIL / ADMIN_PASSWORD_HASH are not fully set — admin login will be unavailable until both are configured.');
}

const smtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);
if (!smtpConfigured && !isTest) {
  logger.warn(
    'SMTP is not configured — verification and password-reset emails will be written to the log instead of sent. ' +
      'Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS to deliver real email (see ENVIRONMENT_VARIABLES.md).',
  );
}

/**
 * Base URL the emailed links point at. Falls back to the local dev frontend so
 * links are still clickable during development.
 */
const publicAppUrl = env.FRONTEND_URL ?? LOCAL_FRONTEND_ORIGIN;

/** Shared cookie attributes. `sameSite: 'none'` in production because the
 *  frontend and backend are on different Vercel domains (see SECURITY.md). */
const baseCookie = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
};

export const config = {
  env: env.NODE_ENV,
  isProd,
  isTest,
  port: env.PORT,
  mongoUri: env.MONGO_URI,
  mongo: {
    // Mongoose defaults to 30s, which is longer than a Vercel serverless
    // function's own limit — a dead database would hang the request until the
    // platform killed it instead of returning a clean 503. Tests use a very
    // short value so the no-database path fails fast.
    serverSelectionTimeoutMS: isTest ? 300 : 8000,
  },
  jwtSecret,
  publicAppUrl,
  admin: {
    email: env.ADMIN_EMAIL,
    passwordHash: env.ADMIN_PASSWORD_HASH,
  },
  cors: {
    origins: corsOrigins,
  },
  auth: {
    /** Short-lived access token. */
    accessCookieName: 'access_token',
    /** Long-lived, rotating, opaque refresh token. */
    refreshCookieName: 'refresh_token',
    accessTokenTtl: env.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    maxFailedLogins: env.MAX_FAILED_LOGINS,
    accountLockMinutes: env.ACCOUNT_LOCK_MINUTES,
    bcryptRounds: isTest ? 4 : 12,
    accessCookieOptions: {
      ...baseCookie,
      // Deliberately no maxAge: a session cookie. The token's own `exp` claim
      // is the real authority; the cookie should not outlive the browser session.
    },
    refreshCookieOptions: {
      ...baseCookie,
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    },
    /** Verification / password-reset link lifetimes. */
    emailVerifyTtlHours: 24,
    passwordResetTtlMinutes: 30,
  },
  email: {
    configured: smtpConfigured,
    from: env.EMAIL_FROM,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      secure: env.SMTP_SECURE,
    },
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    generalMax: 300,
    authMax: 20,
  },
  recommendations: {
    /**
     * The engine id `services/recommendationService.ts` resolves against its registry.
     * The default engine is statistical and requires nothing external, so this is a
     * knob rather than a dependency — see `lib/recommendationTypes.ts` for the seam.
     */
    engineId: env.RECOMMENDATION_ENGINE,
  },
  ai: {
    /**
     * The only AI credential in the project, and it is optional. Absent means the AI
     * generator page reports itself unconfigured and the route answers 503 naming this
     * variable — it does **not** invent filler; see `services/questionGeneratorService.ts`.
     * Nothing else in the product uses a model.
     */
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    questionGenerator: env.QUESTION_GENERATOR,
    /** Extra attempts for a *transient* provider failure only. */
    geminiMaxRetries: env.GEMINI_MAX_RETRIES,
    /** Cost controls on one generation request, enforced by the zod schema. */
    maxQuestionsPerRequest: env.GENERATION_MAX_QUESTIONS,
    maxInstructionChars: env.GENERATION_MAX_INSTRUCTION_CHARS,
    /** Generation requests per hour per IP, enforced by `generationLimiter`. */
    generationsPerHour: env.GENERATION_RATE_LIMIT_PER_HOUR,
  },
  payments: {
    /** True only when an order can actually be created AND verified. */
    configured: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
    /** Public. Served to the browser by the order endpoint — never bundled. */
    keyId: env.RAZORPAY_KEY_ID,
    /** Secret. Signs orders and verifies checkout signatures. Never leaves this process. */
    keySecret: env.RAZORPAY_KEY_SECRET,
    /** Secret. Verifies webhook bodies. Set separately in the Razorpay dashboard. */
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  },
};
