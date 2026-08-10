import { Router } from 'express';
import authRoutes from './auth.routes';
import meRoutes from './me.routes';
import analyticsRoutes from './analytics.routes';
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
router.use(questionsRoutes);
router.use(questionsAdminRoutes);
router.use(taxonomyRoutes);
router.use(adminRoutes);
router.use(usersRoutes);
router.use(miscRoutes);

export default router;
