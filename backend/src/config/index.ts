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
const corsOrigins = [env.FRONTEND_URL, LOCAL_FRONTEND_ORIGIN].filter((origin): origin is string => Boolean(origin));

if (isProd && !env.FRONTEND_URL) {
  logger.warn(
    'FRONTEND_URL is not set in production — CORS will only allow http://localhost:5173, which will block your ' +
      'real deployed frontend. Set FRONTEND_URL to your frontend production URL (see ENVIRONMENT_VARIABLES.md).',
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
     * The only AI credential in the project, and it is optional. Absent means the
     * question generator falls back to blank templates — see
     * `services/questionGeneratorService.ts`. Nothing else in the product uses a model.
     */
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    questionGenerator: env.QUESTION_GENERATOR,
  },
};
