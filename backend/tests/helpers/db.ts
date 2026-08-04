import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * Spins up a real MongoDB instance in-process for integration tests. This is a
 * genuine database — indexes, unique constraints and TTL definitions all behave
 * as they will in production, which is the whole point: the auth flows depend on
 * unique keys and atomic updates that a mock would not exercise.
 */
let mem: MongoMemoryServer | null = null;

export async function startTestDb(): Promise<void> {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { serverSelectionTimeoutMS: 10_000 });
  await mongoose.connection.asPromise();

  // Unique indexes are only enforced once built, and the models here were
  // compiled before the connection existed (they're imported with the app), so
  // we build them explicitly. `createIndexes` rather than `init` because init
  // also tries to auto-create collections, which races the fresh connection.
  for (const name of mongoose.modelNames()) {
    await mongoose.model(name).createIndexes();
  }
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  await mem?.stop();
  mem = null;
}

/** Wipes every collection so each test starts from a known-empty state. */
export async function clearTestDb(): Promise<void> {
  const { db } = mongoose.connection;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}
