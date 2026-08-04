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
