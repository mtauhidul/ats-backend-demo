/**
 * Activity Log Routes
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getUserActivityLog, getMyActivities } from '../controllers/activity.controller';

const router: Router = Router();

// Get current user's activities
router.get('/me', authenticate, getMyActivities);

// Get specific user's activities (admin/manager only)
router.get('/user/:userId', authenticate, getUserActivityLog);

export default router;
