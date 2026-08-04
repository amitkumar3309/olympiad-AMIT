import { env } from './env';
import { logger } from '../lib/logger';

const isProd = env.NODE_ENV === 'production';

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

export const config = {
  env: env.NODE_ENV,
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  mongoUri: env.MONGO_URI,
  mongo: {
    // Mongoose defaults to 30s, which is longer than a Vercel serverless
    // function's own limit — a dead database would hang the request until the
    // platform killed it instead of returning a clean 503. Tests use a very
    // short value so the no-database path fails fast.
    serverSelectionTimeoutMS: env.NODE_ENV === 'test' ? 300 : 8000,
  },
  jwtSecret,
  admin: {
    email: env.ADMIN_EMAIL,
    passwordHash: env.ADMIN_PASSWORD_HASH,
  },
  cors: {
    origins: corsOrigins,
  },
  auth: {
    cookieName: 'token',
    cookieOptions: {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    generalMax: 300,
    authMax: 20,
  },
};
