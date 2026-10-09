import pino, { type Level, type LoggerOptions } from 'pino';
import { env } from '../config/env';

/**
 * What a log line must never carry (Milestone 30 Phase 7b).
 *
 * `pino-http` serialises every request and response header. Without this the production log
 * held the `cookie` header — the access and the refresh token — and every `set-cookie` the API
 * issued at sign-in and on each refresh: a working session for anybody who can read the logs
 * (CLAUDE.md: never log a raw token). `authorization` carries the scheduled jobs' shared secret.
 * Redacted rather than removed, so a line still shows the header was sent.
 */
export const LOG_REDACTION = {
  paths: [
    'req.headers.cookie',
    'req.headers.authorization',
    'req.headers["proxy-authorization"]',
    'res.headers["set-cookie"]',
  ],
  censor: '[redacted]',
};

/** The options every logger in the app is built from — the test builds its probe from these too. */
export function loggerOptions(level: Level | 'silent'): LoggerOptions {
  return { level, redact: LOG_REDACTION };
}

export const logger = pino({
  ...loggerOptions(env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport:
    env.NODE_ENV === 'production' || env.NODE_ENV === 'test'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
});
