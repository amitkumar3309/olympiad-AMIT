import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { Question } from '../src/models';
import { CLASS_LEVELS } from '../src/lib/classLevels';
import { practiceBanks } from '../scripts/data/practiceMaths';
import { seedClassBanks } from '../scripts/lib/seedQuestions';
import { startTestDb, stopTestDb } from './helpers/db';
import { API, cookieHeader, registerVerifyLogin } from './helpers/auth';

/**
 * The practice bank through the real seed runner, into an in-memory database (2026-10-10): what the
 * owner's `npm run seed:practice -- --write` will do, and what a second run will not.
 */
beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

describe('seed:practice', () => {
  it('publishes 150 questions for every class, and a second run adds none', async () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const banks = practiceBanks();

      const dry = await seedClassBanks(banks, { label: 'seed-practice', write: false });
      expect(dry.every((r) => r.counts.created === 150 && r.counts.failed === 0)).toBe(true);
      expect(await Question.countDocuments()).toBe(0);

      const first = await seedClassBanks(banks, { label: 'seed-practice', write: true });
      expect(first.map((r) => [r.classLevel, r.counts])).toEqual(
        CLASS_LEVELS.map((c) => [c, { created: 150, skipped: 0, failed: 0 }]),
      );
      for (const classLevel of CLASS_LEVELS) {
        expect(await Question.countDocuments({ classLevel, status: 'published' }), classLevel).toBe(150);
      }

      const second = await seedClassBanks(banks, { label: 'seed-practice', write: true });
      expect(second.every((r) => r.counts.created === 0 && r.counts.skipped === 150)).toBe(true);
      expect(await Question.countDocuments()).toBe(1500);
    } finally {
      quiet.mockRestore();
    }
  }, 120_000);

  it('a Class 3 student can start the largest practice test, drawn from Class 3 only', async () => {
    const { cookies } = await registerVerifyLogin(app, { classLevel: 'Class 3' });
    const res = await request(app)
      .post(`${API}/practice/sessions`)
      .set('Cookie', cookieHeader(cookies))
      .send({ questionCount: 40 })
      .expect(201);
    const ids: string[] = res.body.session.questions.map((q: { id: string }) => q.id);
    expect(ids).toHaveLength(40);
    const served = await Question.find({ _id: { $in: ids } }).select('classLevel');
    expect(new Set(served.map((q) => q.classLevel))).toEqual(new Set(['Class 3']));
  });
});
