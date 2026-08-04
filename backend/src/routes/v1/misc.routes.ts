import { Router } from 'express';
import { sendSuccess } from '../../lib/apiResponse';

/**
 * These three endpoints already existed before this milestone as hardcoded
 * mock responses with no DB access, and the frontend never calls any of
 * them today (see FEATURE_STATUS.md / API_DOCUMENTATION.md). Relocated
 * as-is — not new fake business APIs introduced by this milestone.
 */
const router = Router();

router.get('/daily-challenge', (_req, res) => {
  sendSuccess(res, 200, {
    challenge: {
      title: 'Rapid Calculus Sprint #42',
      rewardXP: 150,
      difficulty: 'Hard',
      estimatedTime: '10 Mins',
      fastestTime: '1m 45s',
      todayWinner: 'Aarav Gupta',
    },
  });
});

router.get('/leaderboard', (_req, res) => {
  sendSuccess(res, 200, {
    leaderboard: [
      { rank: 1, name: 'Ananya Sharma', xp: 3420, school: 'Delhi Public School', accuracy: '98%' },
      { rank: 2, name: 'Rahul Verma', xp: 3100, school: "St. Xavier's High", accuracy: '96%' },
      { rank: 3, name: 'Priya Singh', xp: 2950, school: 'Kendriya Vidyalaya', accuracy: '95%' },
      { rank: 4, name: 'Amit Kumar (Scholar)', xp: 2800, school: 'AMIT Elite Academy', accuracy: '94%' },
      { rank: 5, name: 'Vikram Malhotra', xp: 2650, school: 'Modern School', accuracy: '92%' },
    ],
  });
});

router.get('/certificates/:studentId', (_req, res) => {
  sendSuccess(res, 200, {
    certificates: [
      { id: 'CERT-2026-01', title: 'National Math Olympiad Finalist', date: '15 June 2026', status: 'Verified & Ready' },
      { id: 'CERT-2026-02', title: 'Advanced Calculus Masterclass', date: '02 May 2026', status: 'Verified & Ready' },
    ],
  });
});

export default router;
