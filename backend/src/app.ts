import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { requestLogger } from './middleware/requestLogger';
import { generalLimiter } from './middleware/rateLimiter';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import healthRoutes from './routes/health.routes';
import v1Routes from './routes/v1';
import { MAX_PHOTO_BYTES } from './models/StudentPhoto';

/**
 * Registration carries a photo as a base64 data URL, which inflates the binary
 * by about a third, so that one route needs a much larger body than any other.
 * The allowance is granted **only** to registration rather than by raising the
 * global limit — every other endpoint keeps body-parser's 100 KB default, so a
 * large-payload flood still has exactly one (rate-limited) door to knock on.
 */
const MAX_REGISTER_BODY_BYTES = Math.ceil(MAX_PHOTO_BYTES * 1.4);
const REGISTER_PATHS = ['/api/v1/auth/register', '/api/auth/register'];

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestLogger);
  app.use(cors({ origin: config.cors.origins, credentials: true }));
  // Mounted first so it wins for these paths; body-parser marks the request as
  // read, so the general parser below then skips it.
  app.use(REGISTER_PATHS, express.json({ limit: MAX_REGISTER_BODY_BYTES }));
  app.use(express.json());
  app.use(cookieParser());

  // Mounted before the rate limiter so uptime/monitoring probes are never throttled.
  app.use(healthRoutes);

  app.use(generalLimiter);

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
