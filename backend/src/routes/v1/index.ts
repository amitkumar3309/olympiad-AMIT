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
import leaderboardRoutes from './leaderboard.routes';
import galleryRoutes from './gallery.routes';
import notificationsRoutes from './notifications.routes';
import adminInsightsRoutes from './adminInsights.routes';
import examsRoutes from './exams.routes';
import examsAdminRoutes from './examsAdmin.routes';
import certificatesRoutes from './certificates.routes';
import questionsRoutes from './questions.routes';
import questionsAdminRoutes from './questionsAdmin.routes';
import questionsImportRoutes from './questionsImport.routes';
import taxonomyRoutes from './taxonomy.routes';
import adminRoutes from './admin.routes';
import usersRoutes from './users.routes';
import miscRoutes from './misc.routes';
import paymentRoutes from './payments.routes';

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
router.use(leaderboardRoutes);
router.use(galleryRoutes);
router.use(notificationsRoutes);
router.use(adminInsightsRoutes);
// Official exam and certificates (Milestone 13). `examsAdminRoutes` is mounted before
// `certificatesRoutes` only for readability — the paths do not overlap.
router.use(examsRoutes);
router.use(examsAdminRoutes);
router.use(certificatesRoutes);
router.use(questionsRoutes);
/**
 * **Before** `questionsAdminRoutes`, and the order is load-bearing.
 *
 * That router owns `GET /admin/questions/:id`, whose `:id` would otherwise capture the literal
 * segment `import` and answer 400 ("Question id must be a valid id") for every one of these
 * routes. Express matches in mount order, so the specific paths have to be registered first.
 */
router.use(questionsImportRoutes);
router.use(questionsAdminRoutes);
router.use(taxonomyRoutes);
router.use(adminRoutes);
router.use(usersRoutes);
router.use(paymentRoutes);
router.use(miscRoutes);

export default router;
