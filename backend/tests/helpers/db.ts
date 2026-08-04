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

/**
 * Wipes every collection so each test starts from a known-empty state.
 *
 * Throws rather than returning quietly when there is no connection. It used to
 * no-op in that case, which meant a harness problem presented as a pile of
 * unrelated assertion failures further down the file: the next test would find the
 * previous test's data and report a duplicate-key 409, rather than "the database was
 * never cleared". Failing here names the actual cause.
 */
export async function clearTestDb(): Promise<void> {
  const { db } = mongoose.connection;
  if (!db) {
    throw new Error(
      `clearTestDb(): no database connection (mongoose readyState=${mongoose.connection.readyState}). ` +
        'startTestDb() must have run for this file, and no other file may have disconnected the shared instance.',
    );
  }
  const collections = await db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}
