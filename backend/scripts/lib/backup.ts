import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import mongoose from 'mongoose';

/**
 * The database backup and restore (owner, 2026-10-13: the free Atlas tier takes no backups).
 * Used by `scripts/backup-db.ts` and `scripts/restore-db.ts`; tested by `tests/backup.test.ts`.
 *
 * ## The file
 *
 * One gzipped file of JSON lines. The first line describes the backup — the database, when, and
 * every collection with its document count and its indexes; each line after it is one document,
 * `{ "c": <collection>, "d": <document> }`. Documents are **canonical Extended JSON** (`EJSON`),
 * so an ObjectId, a Date, a Buffer (a photo) or a Decimal comes back as exactly the same type —
 * plain JSON would turn every one of them into a string or a number. Written as a stream, one
 * document at a time, so the size of the database never has to fit in memory.
 *
 * ## What it holds
 *
 * Everything, including every student's name, school, phone numbers and photo. It is
 * personal data about children: it belongs on the owner's own computer or drive, never in the
 * repository (`backend/backups/` is git-ignored), an email, a chat or a shared folder.
 */

const { EJSON } = mongoose.mongo.BSON;
type Db = mongoose.mongo.Db;
type IndexSpec = Record<string, unknown>;

export const BACKUP_FORMAT = 'amit-olympiad-backup';
export const BACKUP_VERSION = 1;

export interface BackupHeader {
  format: typeof BACKUP_FORMAT;
  version: number;
  database: string;
  createdAt: string;
  collections: Array<{ name: string; count: number; indexes: IndexSpec[] }>;
}

/** Writes every collection of `db` to `filePath`. Reads only. */
export async function writeBackup(db: Db, filePath: string): Promise<BackupHeader> {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();

  const collections: BackupHeader['collections'] = [];
  for (const name of names) {
    const collection = db.collection(name);
    collections.push({ name, count: await collection.countDocuments(), indexes: (await collection.indexes()) as IndexSpec[] });
  }
  const header: BackupHeader = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    database: db.databaseName,
    createdAt: new Date().toISOString(),
    collections,
  };

  const gzip = createGzip();
  const out = createWriteStream(filePath);
  gzip.pipe(out);
  const write = async (line: string) => {
    if (!gzip.write(`${line}\n`)) await once(gzip, 'drain');
  };

  await write(JSON.stringify(header));
  for (const { name } of collections) {
    for await (const doc of db.collection(name).find({}).sort({ _id: 1 })) {
      await write(JSON.stringify({ c: name, d: EJSON.serialize(doc, { relaxed: false }) }));
    }
  }
  gzip.end();
  await once(out, 'finish');
  return header;
}

/** Reads a backup's first line, to describe it before anything is written. */
export async function readBackupHeader(filePath: string): Promise<BackupHeader> {
  const lines = createInterface({ input: createReadStream(filePath).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    lines.close();
    const header = JSON.parse(line) as BackupHeader;
    if (header.format !== BACKUP_FORMAT) throw new Error('This is not an A.M.I.T. Olympiad backup file.');
    if (header.version !== BACKUP_VERSION) throw new Error(`Backup version ${header.version} is not one this script can read.`);
    return header;
  }
  throw new Error('The backup file is empty.');
}

export interface RestoreOptions {
  /** Drop a collection that already holds documents before restoring it. Without it, such a collection is refused. */
  replace: boolean;
}

/**
 * Restores a backup into `db`. Refuses before writing anything if a collection it would fill
 * already holds documents and `replace` is false — a restore must never mix two databases.
 */
export async function restoreBackup(db: Db, filePath: string, options: RestoreOptions): Promise<Record<string, number>> {
  const header = await readBackupHeader(filePath);

  const occupied: string[] = [];
  for (const { name } of header.collections) {
    if ((await db.collection(name).estimatedDocumentCount()) > 0) occupied.push(name);
  }
  if (occupied.length > 0 && !options.replace) {
    throw new Error(`These collections already hold documents: ${occupied.join(', ')}. Restore into an empty database, or pass --replace.`);
  }
  for (const name of occupied) await db.collection(name).drop();

  const restored: Record<string, number> = {};
  const batches = new Map<string, unknown[]>();
  const flush = async (name: string) => {
    const batch = batches.get(name);
    if (!batch || batch.length === 0) return;
    await db.collection(name).insertMany(batch as mongoose.mongo.OptionalId<mongoose.mongo.Document>[], { ordered: true });
    restored[name] = (restored[name] ?? 0) + batch.length;
    batches.set(name, []);
  };

  const lines = createInterface({ input: createReadStream(filePath).pipe(createGunzip()), crlfDelay: Infinity });
  let first = true;
  for await (const line of lines) {
    if (first) {
      first = false;
      continue;
    }
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { c: string; d: unknown };
    const doc = EJSON.deserialize(row.d as mongoose.mongo.Document, { relaxed: false });
    const batch = batches.get(row.c) ?? [];
    batch.push(doc);
    batches.set(row.c, batch);
    if (batch.length >= 500) await flush(row.c);
  }
  for (const name of batches.keys()) await flush(name);

  // The indexes — the unique ones above all, which are rules (one quiz per class per day), not speed.
  for (const { name, indexes } of header.collections) {
    if (!(await db.listCollections({ name }, { nameOnly: true }).hasNext())) await db.createCollection(name);
    for (const index of indexes) {
      const { key, v: _v, ns: _ns, ...rest } = index as { key: Record<string, 1 | -1>; v?: unknown; ns?: unknown };
      if ((rest as { name?: string }).name === '_id_') continue;
      await db.collection(name).createIndex(key, rest as mongoose.mongo.CreateIndexesOptions);
    }
    restored[name] = restored[name] ?? 0;
  }
  return restored;
}
