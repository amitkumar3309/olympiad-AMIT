import type { PipelineStage, Types } from 'mongoose';
import type { ClassLevel } from '../lib/classLevels';
import { todayKey, type DayKey } from '../lib/competitionDay';
import { Question, STUDENT_VISIBLE_STATUSES, type QuestionDocument } from '../models';

/**
 * What a student can actually practise, derived from the published question bank.
 *
 * This replaces a hardcoded "Rapid Calculus Sprint #42 · reward 150 XP · today's
 * winner Aarav Gupta" mock that had no data behind any of its fields. Everything
 * here is a real count of real published questions for the student's own class, so
 * an empty bank produces an empty list and the dashboard says so, rather than
 * advertising a challenge that does not exist.
 */

export interface SubjectChallenge {
  subjectId: string;
  subjectName: string;
  questionCount: number;
  /** Which difficulties are actually available, not the full enum. */
  difficulties: string[];
  totalMarks: number;
}

interface SubjectChallengeRow {
  _id: Types.ObjectId;
  questionCount: number;
  difficulties: string[];
  totalMarks: number;
  subjectName?: string;
  subjectStatus?: string;
}

/**
 * Published questions for one class, grouped by subject.
 *
 * `STUDENT_VISIBLE_STATUSES` rather than a literal `'published'`, so this can never
 * drift from what the student-facing question endpoints will actually serve.
 */
function availabilityPipeline(classLevel: ClassLevel): PipelineStage[] {
  return [
    { $match: { classLevel, status: { $in: [...STUDENT_VISIBLE_STATUSES] } } },
    {
      $group: {
        _id: '$subject',
        questionCount: { $sum: 1 },
        difficulties: { $addToSet: '$difficulty' },
        totalMarks: { $sum: '$marks' },
      },
    },
    { $lookup: { from: 'subjects', localField: '_id', foreignField: '_id', as: 'subject' } },
    { $unwind: '$subject' },
    // An archived subject is not on offer, even if published questions still
    // reference it.
    { $match: { 'subject.status': 'active' } },
    { $sort: { questionCount: -1, 'subject.name': 1 } },
    { $project: { questionCount: 1, difficulties: 1, totalMarks: 1, subjectName: '$subject.name' } },
  ];
}

export async function getAvailableChallenges(classLevel: ClassLevel): Promise<SubjectChallenge[]> {
  const rows = await Question.aggregate<SubjectChallengeRow>(availabilityPipeline(classLevel));

  return rows.map((row) => ({
    subjectId: String(row._id),
    subjectName: row.subjectName ?? 'Unnamed subject',
    questionCount: row.questionCount,
    // Sorted for a stable display order rather than Mongo's set order.
    difficulties: [...row.difficulties].sort(),
    totalMarks: row.totalMarks,
  }));
}

/**
 * A tiny deterministic hash of the day key.
 *
 * Used only to choose which published question is "today's", so it needs to be
 * stable and well spread, not cryptographic: every student in a class sees the same
 * question all day, and a different one tomorrow, with no state stored anywhere.
 */
function daySeed(day: DayKey): number {
  let hash = 2166136261;
  for (let i = 0; i < day.length; i += 1) {
    hash ^= day.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Today's challenge question for a class, or null when the bank has none published
 * for it.
 *
 * Deterministic rather than random: the same day and class always resolve to the
 * same question, so two devices show one challenge and a page reload cannot be used
 * to shop for an easier one. Sorted by `_id` so the ordering the index is applied
 * to is total and stable, which is what makes `skip` reproducible.
 */
export async function getDailyChallengeQuestion(
  classLevel: ClassLevel,
  day: DayKey = todayKey(),
): Promise<QuestionDocument | null> {
  const filter = { classLevel, status: { $in: [...STUDENT_VISIBLE_STATUSES] } };
  const available = await Question.countDocuments(filter);
  if (available === 0) return null;

  return Question.findOne(filter)
    .sort({ _id: 1 })
    .skip(daySeed(day) % available)
    .populate('subject', 'name slug')
    .populate('topic', 'name slug')
    .populate('subtopic', 'name slug');
}
