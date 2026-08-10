import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { requirePermission, callerCanFresh } from '../../middleware/auth';
import { Student, StudentAnalytics, type StudentAnalyticsDocument, type TopicMetric } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { ensureDb } from '../../middleware/ensureDb';
import { getXpByDay } from '../../services/progressService';

const router = Router();

function generateAIInsights(analyticsData: Pick<StudentAnalyticsDocument, 'topicMetrics' | 'averageSpeedPerQuestion'>): string[] {
  const insights: string[] = [];
  let strongestTopic: { name: string; acc: number } = { name: '', acc: 0 };
  let weakestTopic: { name: string; acc: number } = { name: '', acc: 100 };

  if (analyticsData.topicMetrics && analyticsData.topicMetrics.length > 0) {
    analyticsData.topicMetrics.forEach((topic: TopicMetric) => {
      const acc = (topic.correct / topic.attempted) * 100 || 0;
      if (acc > strongestTopic.acc) strongestTopic = { name: topic.topicName, acc };
      if (acc < weakestTopic.acc && topic.attempted > 2) weakestTopic = { name: topic.topicName, acc };
    });
  }

  if (strongestTopic.name) insights.push(`You are exceptionally strong in ${strongestTopic.name}. Keep it up! 🌟`);
  if (weakestTopic.name) insights.push(`You need more focused practice in ${weakestTopic.name}. Your accuracy is dropping here. ⚠️`);

  if (analyticsData.averageSpeedPerQuestion > 90) {
    insights.push('Time Management Alert: You are taking too long per question (>90s). Try practicing rapid quizzes daily. ⏱️');
  } else {
    insights.push('Excellent pacing! Your time management is perfectly balanced with your accuracy. 🎯');
  }

  return insights;
}

/**
 * Performance analytics for one student.
 *
 * **This endpoint used to lie.** When no `StudentAnalytics` document existed — which
 * is *every* student, because nothing in the codebase writes one — it returned a
 * hardcoded fallback claiming 88% accuracy over 450 questions, a rising five-point
 * learning curve, four topic breakdowns, and the flourish "You are currently in the
 * top 5% of all national Olympiad participants". Every one of those numbers was
 * invented, and they were presented to the student as their own measured performance
 * on a page reachable straight from their dashboard. It is deleted.
 *
 * What replaces it is a split between what can be measured and what cannot:
 *  - `data` is the real `StudentAnalytics` document, or **null** with a `reason`. It
 *    stays null until exam submission exists, because accuracy, speed and
 *    topic-level breakdowns are all functions of answered questions.
 *  - `xpByDay` is **real** — actual XP earned per competition day, from the activity
 *    log — so the page has something true to plot rather than nothing at all.
 *
 * The frontend renders an explicit empty state for the null half. See
 * DECISIONS.md; the rule this restores is "no fabricated statistic is ever shown as
 * if it were the student's own".
 */
router.get(
  '/analytics/:studentId',
  requirePermission('analytics:read:self'),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      // Reading someone else's record is a separate capability. The check is fresh
      // (a database read) rather than token-based, so a demoted admin cannot keep
      // browsing other students' data until their access token expires.
      const isOwnRecord = req.user!.studentId === req.params.studentId;
      if (!isOwnRecord && !(await callerCanFresh(req, 'analytics:read:any'))) {
        sendError(res, 403, 'You can only view your own analytics.');
        return;
      }

      const account = await Student.findOne({ studentId: req.params.studentId }).select('_id');
      if (!account) {
        sendError(res, 404, 'No account exists with that student ID.');
        return;
      }

      const xpByDay = await getXpByDay(account._id as Types.ObjectId);
      const analytics = await StudentAnalytics.findOne({ studentId: req.params.studentId });

      if (!analytics) {
        // Nothing writes a StudentAnalytics document yet, so this is the path every
        // real student takes. Answering honestly — null, with a machine-readable
        // reason — is what lets the page say "not measured yet" instead of guessing.
        sendSuccess(res, 200, { data: null, reason: 'no-exam-data', xpByDay });
        return;
      }

      analytics.aiInsights = generateAIInsights(analytics);
      sendSuccess(res, 200, { data: analytics, xpByDay });
    } catch {
      sendError(res, 500, 'Failed to fetch analytics');
    }
  },
);

export default router;
