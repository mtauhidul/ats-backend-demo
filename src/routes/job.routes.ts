import express from 'express';
import { validate } from '../middleware/validation';
import { authenticate, requirePermission } from '../middleware/auth';
import {
  createJob,
  getJobs,
  getJobById,
  updateJob,
  deleteJob,
  bulkUpdateJobStatus,
  getJobStats,
} from '../controllers/job.controller';
import {
  createJobSchema,
  updateJobSchema,
  listJobsSchema,
  jobIdSchema,
  bulkUpdateJobStatusSchema,
} from '../types/job.types';

const router: express.Router = express.Router();

/**
 * @route   GET /api/jobs
 * @desc    Get all jobs with filters (Public - can view open jobs)
 * @access  Public
 */
router.get(
  '/',
  validate(listJobsSchema),
  getJobs
);

/**
 * @route   GET /api/jobs/:id
 * @desc    Get job by ID (Public - can view job details)
 * @access  Public
 */
router.get(
  '/:id',
  validate(jobIdSchema),
  getJobById
);

// All routes below require authentication
router.use(authenticate);

/**
 * @route   POST /api/jobs
 * @desc    Create new job
 * @access  Users with canManageJobs permission
 */
router.post(
  '/',
  requirePermission('canManageJobs'),
  validate(createJobSchema),
  createJob
);

/**
 * @route   GET /api/jobs/stats
 * @desc    Get job statistics
 * @access  Users with canManageJobs or canAccessAnalytics permission
 */
router.get(
  '/stats',
  requirePermission('canManageJobs', 'canAccessAnalytics'),
  getJobStats
);

/**
 * @route   PUT /api/jobs/:id
 * @desc    Update job
 * @access  Users with canManageJobs permission
 */
router.put(
  '/:id',
  requirePermission('canManageJobs'),
  validate(updateJobSchema),
  updateJob
);

/**
 * @route   PATCH /api/jobs/:id
 * @desc    Update job (partial update)
 * @access  Users with canManageJobs permission
 */
router.patch(
  '/:id',
  requirePermission('canManageJobs'),
  validate(updateJobSchema),
  updateJob
);

/**
 * @route   DELETE /api/jobs/:id
 * @desc    Delete job
 * @access  Users with canManageJobs permission (typically admins)
 */
router.delete(
  '/:id',
  requirePermission('canManageJobs'),
  validate(jobIdSchema),
  deleteJob
);

/**
 * @route   POST /api/jobs/bulk/status
 * @desc    Bulk update job status
 * @access  Users with canManageJobs permission
 */
router.post(
  '/bulk/status',
  requirePermission('canManageJobs'),
  validate(bulkUpdateJobStatusSchema),
  bulkUpdateJobStatus
);

export default router;
