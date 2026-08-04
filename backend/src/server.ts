import { createServer } from 'http';
import app from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { connectDB, disconnectDB } from './db/connection';

/**
 * Local/standalone process bootstrap: connect to MongoDB, start listening,
 * and shut down gracefully on SIGTERM/SIGINT. NOT used by the Vercel
 * serverless entry (backend/api/index.ts), which imports `app` directly and
 * has its own request-scoped lifecycle — see SYSTEM_ARCHITECTURE.md.
 */
async function main(): Promise<void> {
  // Connect eagerly so a healthy start is the common case, but don't die if the
  // database is unreachable: the server still boots, /health reports the process
  // is alive, /ready reports 503, and the per-request `ensureDb` middleware
  // retries the connection. A transient Atlas/network problem at boot therefore
  // doesn't require a manual restart.
  await connectDB().catch((err) => {
    logger.error({ err }, 'Initial MongoDB connection failed — starting anyway; /ready will report not-ready until it recovers');
  });

  const server = createServer(app);

  server.listen(config.port, () => {
    logger.info(`AMIT Olympiad backend listening on port ${config.port} (${config.env})`);
  });

  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    server.close(() => {
      disconnectDB()
        .catch((err) => logger.error({ err }, 'Error while disconnecting MongoDB during shutdown'))
        .finally(() => {
          logger.info('Shutdown complete.');
          process.exit(0);
        });
    });

    setTimeout(() => {
      logger.error('Forced shutdown after 10s timeout.');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (!config.isTest) {
  main().catch((err) => {
    logger.error({ err }, 'Fatal startup error');
    process.exit(1);
  });
}

export default app;
