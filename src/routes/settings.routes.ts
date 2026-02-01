import express from "express";
import { authenticate } from "../middleware/auth";
import {
  getSmtpSettings,
  updateSmtpSettings,
  testSmtpConnection,
  syncInboundEmails,
  updateInboundEmailLinks,
} from "../controllers/settings.controller";

const router: express.Router = express.Router();

/**
 * All routes require authentication
 */
router.use(authenticate);

/**
 * @route   GET /api/settings/smtp
 * @desc    Get SMTP settings
 * @access  Private (Admin only - should add role check)
 */
router.get("/smtp", getSmtpSettings);

/**
 * @route   PUT /api/settings/smtp
 * @desc    Update SMTP settings
 * @access  Private (Admin only - should add role check)
 */
router.put("/smtp", updateSmtpSettings);

/**
 * @route   POST /api/settings/smtp/test
 * @desc    Test SMTP connection
 * @access  Private (Admin only - should add role check)
 */
router.post("/smtp/test", testSmtpConnection);

/**
 * @route   POST /api/settings/smtp/sync
 * @desc    Manually trigger email sync
 * @access  Private (Admin only - should add role check)
 */
router.post("/smtp/sync", syncInboundEmails);

/**
 * @route   POST /api/settings/smtp/update-links
 * @desc    Update existing inbound emails to link them to jobs (one-time migration)
 * @access  Private (Admin only - should add role check)
 */
router.post("/smtp/update-links", updateInboundEmailLinks);

export default router;
