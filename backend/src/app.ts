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

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestLogger);
  app.use(cors({ origin: config.cors.origins, credentials: true }));
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
