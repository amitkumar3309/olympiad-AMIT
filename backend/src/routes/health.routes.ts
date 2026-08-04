import { Router } from 'express';
import { getConnectionState, isConnected } from '../db/connection';
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
  sendSuccess(res, 200, { status: 'ready', db });
});

export default router;
