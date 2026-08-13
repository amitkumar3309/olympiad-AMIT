import { Router } from 'express';
import authRoutes from './auth.routes';
import meRoutes from './me.routes';
import analyticsRoutes from './analytics.routes';
import practiceRoutes from './practice.routes';
import mockTestsRoutes from './mockTests.routes';
import mockTestsAdminRoutes from './mockTestsAdmin.routes';
import dailyChallengeRoutes from './dailyChallenge.routes';
import dailyChallengesAdminRoutes from './dailyChallengesAdmin.routes';
import rewardsRoutes from './rewards.routes';
import questionsRoutes from './questions.routes';
import questionsAdminRoutes from './questionsAdmin.routes';
import taxonomyRoutes from './taxonomy.routes';
import adminRoutes from './admin.routes';
import usersRoutes from './users.routes';
import miscRoutes from './misc.routes';

const router = Router();

router.use(authRoutes);
router.use(meRoutes);
router.use(analyticsRoutes);
router.use(practiceRoutes);
router.use(mockTestsRoutes);
router.use(mockTestsAdminRoutes);
router.use(dailyChallengeRoutes);
router.use(dailyChallengesAdminRoutes);
router.use(rewardsRoutes);
router.use(questionsRoutes);
router.use(questionsAdminRoutes);
router.use(taxonomyRoutes);
router.use(adminRoutes);
router.use(usersRoutes);
router.use(miscRoutes);

export default router;
