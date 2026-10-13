import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { readBackupHeader, restoreBackup, writeBackup } from '../scripts/lib/backup';
import { startTestDb, stopTestDb } from './helpers/db';

/**
 * The database backup (2026-10-13): what is written comes back exactly — the same ids, dates,
 * photo bytes and nested fields — with its unique indexes, and a restore never mixes into a
 * database that already holds data unless told to replace it.
 */
const { EJSON } = mongoose.mongo.BSON;
let dir: string;

beforeAll(async () => {
  await startTestDb();
  dir = mkdtempSync(path.join(tmpdir(), 'amit-backup-test-'));
}, 60_000);
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await stopTestDb();
});

describe('backup and restore', () => {
  it('restores every document exactly, with its indexes', async () => {
    const source = mongoose.connection.useDb('backup-source').db!;
    const students = Array.from({ length: 1203 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      studentId: `AMIT_${String(i).padStart(4, '0')}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)),
      prefs: { dailyQuizReminders: i % 2 === 0, tags: ['a', 'b'] },
      score: i / 7,
    }));
    await source.collection('students').insertMany(students);
    await source.collection('students').createIndex({ studentId: 1 }, { unique: true });
    await source.collection('studentphotos').insertOne({ student: students[0]!._id, data: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]) });
    await source.collection('emptyones').insertOne({ x: 1 });
    await source.collection('emptyones').deleteMany({});

    const file = path.join(dir, 'full.backup.json.gz');
    const header = await writeBackup(source, file);
    expect(header.collections.map((c) => [c.name, c.count])).toEqual([
      ['emptyones', 0],
      ['studentphotos', 1],
      ['students', 1203],
    ]);
    expect((await readBackupHeader(file)).database).toBe('backup-source');

    const target = mongoose.connection.useDb('backup-target').db!;
    const restored = await restoreBackup(target, file, { replace: false });
    expect(restored).toMatchObject({ students: 1203, studentphotos: 1, emptyones: 0 });

    const before = await source.collection('students').find({}).sort({ _id: 1 }).toArray();
    const after = await target.collection('students').find({}).sort({ _id: 1 }).toArray();
    expect(EJSON.stringify(after, { relaxed: false })).toBe(EJSON.stringify(before, { relaxed: false }));
    const photo = await target.collection('studentphotos').findOne({});
    expect(photo?.student).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(Buffer.from((photo!.data as { buffer: Uint8Array }).buffer)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));

    // The unique index came back as a rule, not just a speed-up.
    await expect(target.collection('students').insertOne({ studentId: 'AMIT_0000' })).rejects.toThrow(/duplicate key/);
  });

  it('refuses to restore into a database that already holds data, unless told to replace it', async () => {
    const source = mongoose.connection.useDb('backup-source-2').db!;
    await source.collection('things').insertMany([{ n: 1 }, { n: 2 }]);
    const file = path.join(dir, 'things.backup.json.gz');
    await writeBackup(source, file);

    const target = mongoose.connection.useDb('backup-target-2').db!;
    await target.collection('things').insertOne({ n: 99 });
    await expect(restoreBackup(target, file, { replace: false })).rejects.toThrow(/already hold documents: things/);
    expect(await target.collection('things').countDocuments()).toBe(1);

    await restoreBackup(target, file, { replace: true });
    expect((await target.collection('things').find({}).sort({ n: 1 }).toArray()).map((d) => d.n)).toEqual([1, 2]);
  });
});
