import express from 'express';
import { validate } from '../middleware/validation';
import { authenticate, requireRole } from '../middleware/auth';
import {
  createPipeline,
  getPipelines,
  getPipelineById,
  updatePipeline,
  deletePipeline,
  getDefaultPipeline,
} from '../controllers/pipeline.controller';
import {
  createPipelineSchema,
  updatePipelineSchema,
  listPipelinesSchema,
  pipelineIdSchema,
} from '../types/pipeline.types';

const router: express.Router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/pipelines
 * @desc    Create new pipeline
 * @access  Admin, Super Admin
 */
router.post(
  '/',
  requireRole('admin'),
  validate(createPipelineSchema),
  createPipeline
);

/**
 * @route   GET /api/pipelines
 * @desc    Get all pipelines with filters
 * @access  All authenticated users
 */
router.get(
  '/',
  validate(listPipelinesSchema),
  getPipelines
);

/**
 * @route   GET /api/pipelines/default
 * @desc    Get default pipeline
 * @access  All authenticated users
 */
router.get(
  '/default',
  getDefaultPipeline
);

/**
 * @route   GET /api/pipelines/:id
 * @desc    Get pipeline by ID
 * @access  All authenticated users
 */
router.get(
  '/:id',
  validate(pipelineIdSchema),
  getPipelineById
);

/**
 * @route   PUT /api/pipelines/:id
 * @desc    Update pipeline
 * @access  Admin, Super Admin
 */
router.put(
  '/:id',
  requireRole('admin'),
  validate(updatePipelineSchema),
  updatePipeline
);

/**
 * @route   PATCH /api/pipelines/:id
 * @desc    Update pipeline (partial update)
 * @access  Admin, Super Admin
 */
router.patch(
  '/:id',
  requireRole('admin'),
  validate(updatePipelineSchema),
  updatePipeline
);

/**
 * @route   DELETE /api/pipelines/:id
 * @desc    Delete pipeline
 * @access  Admin, Super Admin
 */
router.delete(
  '/:id',
  requireRole('admin'),
  validate(pipelineIdSchema),
  deletePipeline
);

export default router;
