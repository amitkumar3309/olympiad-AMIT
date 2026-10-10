import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { PRACTICE_PER_CLASS, practiceBanks } from '../scripts/data/practiceMaths';
import { CLASS_LEVELS } from '../src/lib/classLevels';
import { validateMathContent } from '../src/lib/mathContent';
import { createQuestionSchema } from '../src/validation/questionSchemas';

/**
 * The generated practice bank (2026-10-10): 150 questions for every class, each one a question the
 * API itself would accept. The seed runner checks the same things at write time; checking them here
 * means a template that breaks fails the suite, not the owner's run against production.
 */
describe('practice bank', () => {
  const banks = practiceBanks();

  it('covers every class from 3 to 12', () => {
    expect(banks.map((b) => b.classLevel)).toEqual([...CLASS_LEVELS]);
  });

  it('is the same every time it is built (the seed identifies a question by its text)', () => {
    const again = practiceBanks();
    expect(JSON.stringify(again)).toBe(JSON.stringify(banks));
  });

  for (const { classLevel, data } of banks) {
    describe(classLevel, () => {
      const questions = data.topics.flatMap((t) => t.questions);

      it(`has exactly ${PRACTICE_PER_CLASS} distinct questions, all Mathematics`, () => {
        expect(data.subject).toBe('Mathematics');
        expect(questions).toHaveLength(PRACTICE_PER_CLASS);
        expect(new Set(questions.map((q) => q.questionText)).size).toBe(PRACTICE_PER_CLASS);
      });

      it('every question has four distinct options, exactly one correct, and a solution', () => {
        for (const q of questions) {
          expect(q.options, q.questionText).toHaveLength(4);
          expect(new Set(q.options.map((o) => o.text)).size, q.questionText).toBe(4);
          expect(q.options.filter((o) => o.isCorrect), q.questionText).toHaveLength(1);
          expect(q.solution.length, q.questionText).toBeGreaterThan(10);
          expect(q.questionText, 'no undefined/NaN leaked into the text').not.toMatch(/undefined|NaN|Infinity/);
          for (const o of q.options) expect(o.text, q.questionText).not.toMatch(/undefined|NaN|Infinity/);
          expect(q.solution, q.questionText).not.toMatch(/undefined|NaN|Infinity/);
          // All four options in maths, or none: one odd one out gives the answer away.
          expect(new Set(q.options.map((o) => o.text.includes('$'))).size, q.questionText).toBe(1);
          // No number a child could not read: a stray decimal shows up as a 16-digit fraction.
          for (const o of q.options) expect(o.text, q.questionText).not.toMatch(/\d{8,}/);
        }
      });

      it('every question passes the API’s own validation', () => {
        const id = String(new mongoose.Types.ObjectId());
        for (const q of questions) {
          for (const [label, value] of [
            ['questionText', q.questionText],
            ['solution', q.solution],
            ...q.options.map((o, i) => [`option ${i + 1}`, o.text] as const),
          ]) {
            expect(validateMathContent(value, label), `${label} of: ${q.questionText}`).toBeNull();
          }
          const parsed = createQuestionSchema.safeParse({
            questionText: q.questionText,
            type: q.type,
            options: q.options,
            booleanAnswer: q.booleanAnswer,
            numericAnswer: q.numericAnswer,
            tolerance: q.tolerance,
            solution: q.solution,
            subject: id,
            topic: id,
            subtopic: null,
            classLevel,
            difficulty: q.difficulty,
            marks: q.marks,
            negativeMarks: q.negativeMarks,
            tags: q.tags,
          });
          expect(parsed.success ? null : parsed.error.issues, q.questionText).toBeNull();
        }
      });
    });
  }
});
