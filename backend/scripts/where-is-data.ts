import mongoose from 'mongoose';
import { config } from '../src/config';
import { connectDB, disconnectDB } from '../src/db/connection';
import * as models from '../src/models';

/**
 * Answers "where did my data actually go?".
 *
 * Prints the database the app is really connected to, the true collection name behind
 * each Mongoose model, and how many documents each holds. That combination is what
 * you need to find anything in the Atlas UI, because the collection names are **not**
 * the model names — Mongoose lowercases and pluralises them, so `PracticeSession`
 * becomes `practicesessions`, which is easy to miss when scanning a list.
 *
 * Strictly read-only. Safe to run against production.
 *
 *   cd backend && npx tsx scripts/where-is-data.ts
 */
async function main(): Promise<void> {
  // Credentials redacted so the output can be pasted into a chat or an issue.
  console.log('MONGO_URI:', config.mongoUri.replace(/\/\/[^@]*@/, '//***:***@'));
  await connectDB();

  const db = mongoose.connection.db;
  console.log('\nConnected to database:', mongoose.connection.name);
  console.log('^ this is the database you must select in the Atlas UI.\n');

  const rows: Array<[string, string, number]> = [];
  for (const [name, value] of Object.entries(models)) {
    const model = value as { collection?: { name: string }; countDocuments?: () => Promise<number> };
    if (!model?.collection?.name || typeof model.countDocuments !== 'function') continue;
    rows.push([name, model.collection.name, await model.countDocuments()]);
  }

  console.log('MODEL'.padEnd(18) + 'COLLECTION'.padEnd(24) + 'DOCUMENTS');
  for (const [name, coll, count] of rows.sort((a, b) => a[1].localeCompare(b[1]))) {
    console.log(name.padEnd(18) + coll.padEnd(24) + String(count));
  }

  const published = await models.Question.countDocuments({ status: 'published' });
  const class12 = await models.Question.countDocuments({
    classLevel: 'Class 12 - Science',
    status: 'published',
  });
  console.log('\nPublished questions, all classes :', published);
  console.log('Published for Class 12 - Science  :', class12);

  const existing = (await db?.listCollections().toArray()) ?? [];
  console.log('\nCollections that exist in this database:');
  console.log(
    existing
      .map((collection) => collection.name)
      .sort()
      .join(', ') || '(none — this database is empty)',
  );

  await disconnectDB();
}

void main();
