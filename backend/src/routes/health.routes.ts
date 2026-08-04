import { Router } from 'express';
import { connectDB, getConnectionState, isConnected, getDatabaseName } from '../db/connection';
import { sendSuccess, sendError } from '../lib/apiResponse';
import { logger } from '../lib/logger';

const router = Router();

/** Liveness: process is up. Deliberately does not depend on the DB. */
router.get('/health', (_req, res) => {
  sendSuccess(res, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

/**
 * Readiness: the process is up AND MongoDB is actually reachable.
 *
 * This *attempts* a connection rather than only inspecting the current state.
 * On Vercel each request may land on a freshly started container that has not
 * opened a connection yet, so a passive state check reported "disconnected"
 * even when the database was perfectly healthy — useless for a monitor, and
 * misleading during a deploy. `connectDB()` caches and de-duplicates, so on a
 * warm container this costs nothing.
 */
router.get('/ready', async (_req, res) => {
  if (!isConnected()) {
    try {
      await connectDB();
    } catch (err) {
      logger.warn({ err }, 'Readiness check could not reach MongoDB');
    }
  }

  const db = getConnectionState();
  if (!isConnected()) {
    sendError(res, 503, 'Not ready', { db });
    return;
  }

  // `dbName` is reported deliberately: a MONGO_URI without a database path
  // connects fine but writes into MongoDB's default `test` database, which
  // looks like data silently disappearing. Seeing the name here catches it.
  sendSuccess(res, 200, { status: 'ready', db, dbName: getDatabaseName() });
});

export default router;
