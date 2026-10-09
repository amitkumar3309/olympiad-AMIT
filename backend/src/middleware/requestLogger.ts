import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import { logger } from '../lib/logger';

/**
 * One access-log line per request. Credentials in its headers are redacted by the logger it
 * writes through (`LOG_REDACTION` in `lib/logger.ts`), so this must always be given a logger built
 * from `loggerOptions()`.
 */
export function createRequestLogger(base: Logger) {
  return pinoHttp({
    logger: base,
    autoLogging: true,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}

export const requestLogger = createRequestLogger(logger);
