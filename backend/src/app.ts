import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { requestLogger } from './middleware/requestLogger';
import { generalLimiter } from './middleware/rateLimiter';
import { verifyRequestOrigin } from './middleware/csrf';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import healthRoutes from './routes/health.routes';
import v1Routes from './routes/v1';
import { MAX_PHOTO_BYTES } from './models/StudentPhoto';

/**
 * Two routes carry a photo as a base64 data URL, which inflates the binary by about
 * a third, so they need a much larger body than any other: registration, and the
 * profile-photo replacement added in Milestone 5.
 *
 * The allowance is granted **only** to those paths rather than by raising the global
 * limit — every other endpoint keeps body-parser's 100 KB default, so a large-payload
 * flood still has exactly two doors to knock on, both of them rate-limited (see
 * `middleware/rateLimiter.ts`). Both prefixes are listed because `/api/*` is a
 * compatibility alias for the same router: a limit that held on only one of them
 * would be trivially bypassed by using the other.
 */
const MAX_PHOTO_BODY_BYTES = Math.ceil(MAX_PHOTO_BYTES * 1.4);
const PHOTO_UPLOAD_PATHS = [
  '/api/v1/auth/register',
  '/api/auth/register',
  '/api/v1/me/photo',
  '/api/me/photo',
];

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestLogger);
  app.use(cors({ origin: config.cors.origins, credentials: true }));
  // Mounted first so it wins for these paths; body-parser marks the request as
  // read, so the general parser below then skips it.
  app.use(PHOTO_UPLOAD_PATHS, express.json({ limit: MAX_PHOTO_BODY_BYTES }));
  /**
   * The default parser, with a copy of the raw bytes kept for webhook verification.
   *
   * Razorpay signs the **exact body it sent**. `JSON.parse` followed by
   * `JSON.stringify` does not reproduce those bytes — key order, whitespace and unicode
   * escaping all differ — so a signature checked against a re-serialised object fails
   * for legitimate webhooks. The predictable "fix" for that is to stop verifying, which
   * is why the raw copy is taken here rather than left to the route.
   *
   * `verify` runs on every request, so the cost is one Buffer reference per call; only
   * the webhook route ever reads it.
   */
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(cookieParser());

  // Mounted before the rate limiter so uptime/monitoring probes are never throttled.
  app.use(healthRoutes);

  app.use(generalLimiter);

  /**
   * The CSRF gate, mounted once for the whole API.
   *
   * Deliberately here rather than on individual routes, for the reason `requireEntry`
   * is mounted rather than called: a per-route defence is one a new route can forget,
   * and a forgotten CSRF check looks exactly like a working one. It sits **before**
   * both prefixes below, because `/api` is an alias for the same router and a gate
   * that held on only one of them would be bypassed by using the other.
   *
   * It only polices state-changing methods, so `/health`, `/ready` and every read are
   * untouched. See `middleware/csrf.ts` for what it does and does not cover.
   */
  app.use(verifyRequestOrigin);

  // /api/v1 is canonical; /api is a backward-compatible alias for the
  // current frontend, which still calls unversioned paths — see DECISIONS.md.
  app.use('/api/v1', v1Routes);
  app.use('/api', v1Routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

const app = createApp();

export default app;
