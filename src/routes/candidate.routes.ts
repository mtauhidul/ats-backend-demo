import express from 'express';
import { validate } from '../middleware/validation';
import { authenticate, requireRole, requirePermission } from '../middleware/auth';
import {
  createCandidate,
  getCandidates,
  getCandidateById,
  updateCandidate,
  deleteCandidate,
  moveCandidateStage,
  rescoreCandidate,
  bulkMoveCandidates,
  getCandidateStats,
  getTopCandidates,
  addCandidatesToPipeline,
  getCandidatesWithoutPipeline,
  getDashboardAnalytics,
} from '../controllers/candidate.controller';
import {
  createCandidateSchema,
  updateCandidateSchema,
  listCandidatesSchema,
  candidateIdSchema,
  moveCandidateStageSchema,
  rescoreCandidateSchema,
  bulkMoveCandidatesSchema,
} from '../types/candidate.types';

const router = express.Router();

/**
 * All routes require authentication
 */
router.use(authenticate);

/**
 * @route   POST /api/candidates
 * @desc    Create new candidate (manual entry)
 * @access  Users with canManageCandidates permission
 */
router.post(
  '/',
  requirePermission('canManageCandidates'),
  validate(createCandidateSchema),
  createCandidate
);

/**
 * @route   GET /api/candidates
 * @desc    Get all candidates with filters
 * @access  Users with canManageCandidates permission
 */
router.get(
  '/',
  requirePermission('canManageCandidates'),
  validate(listCandidatesSchema),
  getCandidates
);

/**
 * @route   GET /api/candidates/stats
 * @desc    Get candidate statistics
 * @access  Users with canManageCandidates permission
 */
router.get(
  '/stats',
  requirePermission('canManageCandidates'),
  getCandidateStats
);

/**
 * @route   GET /api/candidates/top
 * @desc    Get top candidates by AI score
 * @access  Users with canManageCandidates permission
 */
router.get(
  '/top',
  requirePermission('canManageCandidates'),
  getTopCandidates
);

/**
 * @route   GET /api/candidates/:id
 * @desc    Get candidate by ID
 * @access  Users with canManageCandidates or canReviewApplications permission
 */
router.get(
  '/:id',
  requirePermission('canManageCandidates', 'canReviewApplications'),
  validate(candidateIdSchema),
  getCandidateById
);

/**
 * @route   PUT /api/candidates/:id
 * @desc    Update candidate
 * @access  Users with canManageCandidates permission
 */
router.put(
  '/:id',
  requirePermission('canManageCandidates'),
  validate(updateCandidateSchema),
  updateCandidate
);

/**
 * @route   PATCH /api/candidates/:id
 * @desc    Update candidate (partial update)
 * @access  Users with canManageCandidates permission
 */
router.patch(
  '/:id',
  requirePermission('canManageCandidates'),
  validate(updateCandidateSchema),
  updateCandidate
);

/**
 * @route   DELETE /api/candidates/:id
 * @desc    Delete candidate
 * @access  Users with canManageCandidates permission
 */
router.delete(
  '/:id',
  requirePermission('canManageCandidates'),
  validate(candidateIdSchema),
  deleteCandidate
);

/**
 * @route   POST /api/candidates/:id/move-stage
 * @desc    Move candidate to different pipeline stage
 * @access  Users with canManageCandidates permission
 */
router.post(
  '/:id/move-stage',
  requirePermission('canManageCandidates'),
  validate(moveCandidateStageSchema),
  moveCandidateStage
);

/**
 * @route   POST /api/candidates/:id/rescore
 * @desc    Re-score candidate against a job
 * @access  Users with canManageCandidates permission
 */
router.post(
  '/:id/rescore',
  requirePermission('canManageCandidates'),
  validate(rescoreCandidateSchema),
  rescoreCandidate
);

/**
 * @route   POST /api/candidates/bulk/move-stage
 * @desc    Bulk move candidates to new stage
 * @access  Users with canManageCandidates permission
 */
router.post(
  '/bulk/move-stage',
  requirePermission('canManageCandidates'),
  validate(bulkMoveCandidatesSchema),
  bulkMoveCandidates
);

/**
 * @route   POST /api/candidates/pipeline/add
 * @desc    Add candidates to a pipeline (assign to first stage)
 * @access  Users with canManageCandidates permission
 */
router.post(
  '/pipeline/add',
  requirePermission('canManageCandidates'),
  addCandidatesToPipeline
);

/**
 * @route   GET /api/candidates/pipeline/unassigned
 * @desc    Get candidates for a job that are not in any pipeline
 * @access  Users with canManageCandidates permission
 */
router.get(
  '/pipeline/unassigned',
  requirePermission('canManageCandidates'),
  getCandidatesWithoutPipeline
);

/**
 * @route   GET /api/candidates/analytics/dashboard
 * @desc    Get dashboard analytics (application trends by date)
 * @access  All authenticated users
 */
router.get(
  '/analytics/dashboard',
  getDashboardAnalytics
);

export default router;
