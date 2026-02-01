import { Router } from 'express';
import { handleResendWebhook, testWebhook } from '../controllers/webhook.controller';

const router: Router = Router();

/**
 * @route   POST /api/webhooks/resend
 * @desc    Handle Resend webhook events (email.sent, email.delivered, email.bounced, etc.)
 * @access  Public (verified by webhook signature)
 */
router.post('/resend', handleResendWebhook);

/**
 * @route   POST /api/webhooks/resend/test
 * @desc    Test webhook processing (development only)
 * @access  Public (development only)
 */
router.post('/resend/test', testWebhook);

export default router;
