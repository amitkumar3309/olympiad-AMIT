import type { PipelineStage, Types } from 'mongoose';
import type { ClassLevel } from '../lib/classLevels';
import { Question, STUDENT_VISIBLE_STATUSES } from '../models';

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
 * The daily-challenge *question picker* used to live here, and moved to
 * `services/dailyChallengeService.ts` in Milestone 8 when the challenge stopped being
 * recomputed on every request and started being pinned to a document.
 *
 * The move fixed a real defect rather than merely relocating code: the old version took
 * a hash of the day modulo the *current* number of published questions, so publishing
 * anything changed which question "today" resolved to — mid-day, for every student —
 * and made a past day's challenge unrecoverable. What is left in this file is the
 * dashboard's "what can I practise" availability, which is a different question.
 */
