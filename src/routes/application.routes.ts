import { Router } from 'express';
import {
  createApplication,
  getApplications,
  getApplicationById,
  updateApplication,
  deleteApplication,
  approveApplication,
  bulkUpdateStatus,
  bulkDeleteApplications,
  getApplicationStats,
  getDashboardAnalytics,
} from '../controllers/application.controller';
import { authenticate, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  createApplicationSchema,
  updateApplicationSchema,
  applicationIdSchema,
  listApplicationsSchema,
  approveApplicationSchema,
  bulkUpdateStatusSchema,
} from '../types/application.types';

const router: Router = Router();

/**
 * PUBLIC ROUTES (No Authentication Required)
 * Used for public job application submissions
 */

/**
 * @route   POST /api/applications/public/apply
 * @desc    Create a new application from public job page
 * @access  Public
 */
router.post(
  '/public/apply',
  validate(createApplicationSchema),
  createApplication
);

/**
 * AUTHENTICATED ROUTES
 * These routes require authentication
 */
router.use(authenticate);

/**
 * @route   POST /api/applications
 * @desc    Create a new application (manual entry)
 * @access  Recruiter, Admin, Super Admin
 */
router.post(
  '/',
  requirePermission('canReviewApplications'),
  validate(createApplicationSchema),
  createApplication
);

/**
 * @route   GET /api/applications
 * @desc    Get all applications with filters and pagination
 * @access  Recruiter, Hiring Manager, Admin, Super Admin
 */
router.get(
  '/',
  requirePermission('canReviewApplications'),
  validate(listApplicationsSchema),
  getApplications
);

/**
 * @route   GET /api/applications/stats
 * @desc    Get application statistics
 * @access  Recruiter, Hiring Manager, Admin, Super Admin
 */
router.get(
  '/stats',
  requirePermission('canReviewApplications', 'canAccessAnalytics'),
  getApplicationStats
);

/**
 * @route   GET /api/applications/analytics/dashboard
 * @desc    Get dashboard analytics (application trends by date)
 * @access  All authenticated users
 */
router.get(
  '/analytics/dashboard',
  getDashboardAnalytics
);

/**
 * @route   GET /api/applications/:id
 * @desc    Get single application by ID
 * @access  Recruiter, Hiring Manager, Admin, Super Admin
 */
router.get(
  '/:id',
  requirePermission('canReviewApplications'),
  validate(applicationIdSchema),
  getApplicationById
);

/**
 * @route   PUT /api/applications/:id
 * @desc    Update application
 * @access  Recruiter, Admin, Super Admin
 */
router.put(
  '/:id',
  requirePermission('canReviewApplications'),
  validate(updateApplicationSchema),
  updateApplication
);

/**
 * @route   PATCH /api/applications/:id
 * @desc    Update application (partial update)
 * @access  Users with canReviewApplications permission
 */
router.patch(
  '/:id',
  requirePermission('canReviewApplications'),
  validate(updateApplicationSchema),
  updateApplication
);

/**
 * @route   DELETE /api/applications/:id
 * @desc    Delete application
 * @access  Users with canReviewApplications permission
 */
router.delete(
  '/:id',
  requirePermission('canReviewApplications'),
  validate(applicationIdSchema),
  deleteApplication
);

/**
 * @route   POST /api/applications/:id/approve
 * @desc    Approve application and create candidate with AI scoring
 * @access  Users with canReviewApplications permission
 */
router.post(
  '/:id/approve',
  requirePermission('canReviewApplications'),
  validate(approveApplicationSchema),
  approveApplication
);

/**
 * @route   POST /api/applications/bulk/status
 * @desc    Bulk update application status
 * @access  Users with canReviewApplications permission
 */
router.post(
  '/bulk/status',
  requirePermission('canReviewApplications'),
  validate(bulkUpdateStatusSchema),
  bulkUpdateStatus
);

/**
 * @route   POST /api/applications/bulk/delete
 * @desc    Bulk delete applications
 * @access  Users with canReviewApplications permission
 */
router.post(
  '/bulk/delete',
  requirePermission('canReviewApplications'),
  bulkDeleteApplications
);

/**
 * @route   POST /api/applications/:id/team-members
 * @desc    Assign team member(s) to an application
 * @access  Users with canReviewApplications or canManageTeam permission
 */
router.post(
  '/:id/team-members',
  requirePermission('canReviewApplications', 'canManageTeam'),
  async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { teamMemberId } = req.body;

      if (!teamMemberId) {
        return res.status(400).json({
          success: false,
          message: 'Team member ID is required',
        });
      }

      const Application = require('../models/Application').default;
      const application = await Application.findById(id);

      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
        });
      }

      // Initialize teamMembers array if it doesn't exist
      if (!application.teamMembers) {
        application.teamMembers = [];
      }

      // Check if team member is already assigned
      if (application.teamMembers.includes(teamMemberId)) {
        return res.status(400).json({
          success: false,
          message: 'Team member already assigned to this application',
        });
      }

      // Add team member
      application.teamMembers.push(teamMemberId);
      await application.save();

      // Fetch updated application with populated team members
      const updatedApplication = await Application.findById(id)
        .populate('teamMembers', 'firstName lastName email');

      res.json({
        success: true,
        data: updatedApplication,
        message: 'Team member assigned successfully',
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'Failed to assign team member',
        error: error.message,
      });
    }
  }
);

/**
 * @route   DELETE /api/applications/:id/team-members/:memberId
 * @desc    Remove team member from an application
 * @access  Users with canReviewApplications or canManageTeam permission
 */
router.delete(
  '/:id/team-members/:memberId',
  requirePermission('canReviewApplications', 'canManageTeam'),
  async (req: any, res: any) => {
    try {
      const { id, memberId } = req.params;

      const Application = require('../models/Application').default;
      const application = await Application.findById(id);

      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
        });
      }

      if (!application.teamMembers || application.teamMembers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No team members assigned to this application',
        });
      }

      // Remove team member
      application.teamMembers = application.teamMembers.filter(
        (tm: any) => tm.toString() !== memberId
      );
      await application.save();

      // Fetch updated application with populated team members
      const updatedApplication = await Application.findById(id)
        .populate('teamMembers', 'firstName lastName email');

      res.json({
        success: true,
        data: updatedApplication,
        message: 'Team member removed successfully',
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'Failed to remove team member',
        error: error.message,
      });
    }
  }
);

export default router;
