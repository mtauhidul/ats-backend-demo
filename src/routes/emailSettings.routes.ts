import express from 'express';
import { getEmailSettings, updateEmailSettings } from '../controllers/emailSettings.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/email-settings
 * @desc    Get email configuration (from email and from name)
 * @access  All authenticated users
 */
router.get('/', getEmailSettings);

/**
 * @route   PUT /api/email-settings
 * @desc    Update email configuration (from email and from name)
 * @access  Admin, Super Admin
 */
router.put('/', requireRole('admin'), updateEmailSettings);

export default router;
