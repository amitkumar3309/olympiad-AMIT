import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { StudentAnalytics, type StudentAnalyticsDocument, type TopicMetric } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { ensureDb } from '../../middleware/ensureDb';

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

const MOCK_ANALYTICS_FALLBACK = {
  overallAccuracy: 88,
  averageSpeedPerQuestion: 34,
  totalQuestionsAttempted: 450,
  topicMetrics: [
    { topicName: 'Calculus & Limits', attempted: 120, correct: 110 },
    { topicName: 'Algebraic Identities', attempted: 150, correct: 130 },
    { topicName: 'Trigonometric Ratios', attempted: 100, correct: 80 },
    { topicName: 'Coordinate Geometry', attempted: 80, correct: 70 },
  ],
  learningCurve: [
    { date: 'Jul 20', accuracy: 70 },
    { date: 'Jul 22', accuracy: 75 },
    { date: 'Jul 24', accuracy: 82 },
    { date: 'Jul 26', accuracy: 85 },
    { date: 'Jul 29', accuracy: 88 },
  ],
  aiInsights: [
    '🔥 Exceptional performance in Calculus limits! Your calculation speed improved by 14% this week.',
    '💡 Focus more on Advanced Trigonometric Identities to cross the 95% accuracy threshold.',
    '⭐ You are currently in the top 5% of all national Olympiad participants. Keep the streak alive!',
  ],
};

router.get('/analytics/:studentId', requireAuth('student', 'admin'), ensureDb, async (req, res) => {
  try {
    if (req.user!.role !== 'admin' && req.user!.studentId !== req.params.studentId) {
      sendError(res, 403, 'You can only view your own analytics.');
      return;
    }

    const analytics = await StudentAnalytics.findOne({ studentId: req.params.studentId });

    if (!analytics) {
      // No StudentAnalytics document exists for this student yet — nothing in
      // the codebase creates one today (see PROJECT_STATE.md known gap).
      // Falling back to demo data keeps the page usable in the meantime.
      sendSuccess(res, 200, { data: MOCK_ANALYTICS_FALLBACK });
      return;
    }

    analytics.aiInsights = generateAIInsights(analytics);
    sendSuccess(res, 200, { data: analytics });
  } catch {
    sendError(res, 500, 'Failed to fetch analytics');
  }
});

export default router;
