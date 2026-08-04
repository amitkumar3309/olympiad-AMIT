import { Router } from 'express';
import authRoutes from './auth.routes';
import analyticsRoutes from './analytics.routes';
import questionsRoutes from './questions.routes';
import adminRoutes from './admin.routes';
import miscRoutes from './misc.routes';

const router = Router();

router.use(authRoutes);
router.use(analyticsRoutes);
router.use(questionsRoutes);
router.use(adminRoutes);
router.use(miscRoutes);

export default router;
