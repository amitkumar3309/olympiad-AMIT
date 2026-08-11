import mongoose from 'mongoose';
import { config } from '../config';
import { logger } from '../lib/logger';

export type ConnectionState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'uninitialized';

const STATE_MAP: Record<number, ConnectionState> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

let connectingPromise: Promise<typeof mongoose> | null = null;

/**
 * Turns the two connection failures that are actually *environmental* into advice.
 *
 * A raw `querySrv ECONNREFUSED _mongodb._tcp.…` is genuinely misleading: it reads
 * like Atlas refused the connection, when in fact nothing ever reached Atlas. The
 * `mongodb+srv://` scheme has to resolve a DNS **SRV** record first, and some
 * resolvers — several ISPs, corporate networks, VPNs and ad-blocking DNS servers —
 * refuse or drop SRV queries. The database is fine; the name lookup failed.
 *
 * This distinction matters because the obvious guesses (wrong password, missing IP
 * allowlist entry) are both wrong here and both waste time: those fail *later*, with
 * an authentication error or a server-selection timeout.
 */
function connectionHint(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err);

  if (/querySrv|ENOTFOUND|EAI_AGAIN/.test(message)) {
    return [
      'This is a DNS failure, not a database or credentials problem — nothing reached Atlas.',
      'The mongodb+srv:// scheme needs a DNS SRV lookup, which your resolver refused.',
      'Fixes, easiest first:',
      '  1. Change your DNS to 1.1.1.1 or 8.8.8.8 and retry.',
      '  2. Disconnect from any VPN, or try a different network (a phone hotspot is a quick test).',
      '  3. Use the non-SRV connection string, which needs no SRV lookup at all:',
      '     Atlas → Connect → Drivers → "Node.js 2.2.12 or later" gives a mongodb:// URI',
      '     listing the hosts explicitly. Put that in MONGO_URI, keeping the /amit-olympiad path.',
    ].join('\n  ');
  }

  if (/Authentication failed|bad auth/i.test(message)) {
    return 'Check the username and password in MONGO_URI (Atlas → Database Access). A password containing @ : / ? # must be percent-encoded.';
  }

  if (/IP address|not whitelisted|ServerSelectionError|server selection/i.test(message)) {
    return 'DNS resolved but no server could be reached — usually the Atlas IP allowlist. Atlas → Network Access → Add IP Address → Add Current IP Address.';
  }

  return null;
}

/**
 * Safe to call on every request in a serverless environment: no-ops if already
 * connected/connecting instead of opening a duplicate connection.
 */
export async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  if (connectingPromise) {
    await connectingPromise;
    return;
  }

  connectingPromise = mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS,
  });
  try {
    await connectingPromise;
    logger.info('MongoDB connected successfully');
  } catch (err) {
    const hint = connectionHint(err);
    // The hint goes to stderr rather than through pino, because the whole point is
    // that a human reads it. A structured log line buries it under a stack trace.
    if (hint) console.error(`\nMongoDB connection failed.\n  ${hint}\n`);
    logger.error({ err }, 'MongoDB connection failed');
    throw err;
  } finally {
    connectingPromise = null;
  }
}

export async function disconnectDB(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}

export function getConnectionState(): ConnectionState {
  return STATE_MAP[mongoose.connection.readyState] ?? 'disconnected';
}

export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Which database the connection actually landed in.
 *
 * Worth surfacing: a MONGO_URI with no path (…mongodb.net with no `/name`)
 * connects successfully but silently uses MongoDB's default database, `test`.
 * Writes then succeed while appearing to vanish, because you're looking at the
 * wrong database in Atlas. Exposing the name on /ready makes that obvious.
 */
export function getDatabaseName(): string | null {
  return mongoose.connection.db?.databaseName ?? null;
}
