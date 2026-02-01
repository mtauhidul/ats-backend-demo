import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getEmailTemplates,
  getEmailTemplateById,
  getTemplatesByType,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  duplicateEmailTemplate,
  getDefaultTemplates,
} from '../controllers/emailTemplate.controller';

const router: Router = Router();

/**
 * All routes require authentication
 */
router.use(authenticate);

/**
 * GET /api/email-templates
 * Get all email templates with optional filters
 * Query params: type, isDefault, isActive
 */
router.get('/', getEmailTemplates);

/**
 * GET /api/email-templates/defaults
 * Get all default templates
 * Must be before /:id to avoid conflict
 */
router.get('/defaults', getDefaultTemplates);

/**
 * GET /api/email-templates/type/:type
 * Get templates by type
 */
router.get('/type/:type', getTemplatesByType);

/**
 * GET /api/email-templates/:id
 * Get a single email template by ID
 */
router.get('/:id', getEmailTemplateById);

/**
 * POST /api/email-templates
 * Create a new email template
 */
router.post('/', createEmailTemplate);

/**
 * POST /api/email-templates/:id/duplicate
 * Duplicate an existing template
 */
router.post('/:id/duplicate', duplicateEmailTemplate);

/**
 * PUT /api/email-templates/:id
 * Update an email template
 */
router.put('/:id', updateEmailTemplate);

/**
 * DELETE /api/email-templates/:id
 * Soft delete an email template
 */
router.delete('/:id', deleteEmailTemplate);

export default router;
