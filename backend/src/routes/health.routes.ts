import { Router } from 'express';
import { getConnectionState, isConnected, getDatabaseName } from '../db/connection';
import { sendSuccess, sendError } from '../lib/apiResponse';

const router = Router();

/** Liveness: process is up. Deliberately does not depend on the DB. */
router.get('/health', (_req, res) => {
  sendSuccess(res, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

/** Readiness: process is up AND its dependencies (MongoDB) are reachable. */
router.get('/ready', (_req, res) => {
  const db = getConnectionState();
  if (!isConnected()) {
    sendError(res, 503, 'Not ready', { db });
    return;
  }
  // `dbName` is included deliberately: a MONGO_URI without a database path
  // connects fine but writes into MongoDB's default `test` database, which
  // looks like data silently disappearing. Seeing the name here catches it.
  sendSuccess(res, 200, { status: 'ready', db, dbName: getDatabaseName() });
});

export default router;
