import { Router } from 'express';
import {
  createEmailAccount,
  getEmailAccounts,
  getEmailAccountById,
  updateEmailAccount,
  deleteEmailAccount,
  testEmailAccountConnection,
} from '../controllers/emailAccount.controller';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validate } from '../middleware/validation';
import {
  createEmailAccountSchema,
  updateEmailAccountSchema,
  emailAccountIdSchema,
  listEmailAccountsSchema,
} from '../types/emailAccount.types';

const router: Router = Router();

// All email account routes require authentication and admin role
router.use(authenticate, requireAdmin);

/**
 * @route   POST /api/email-accounts
 * @desc    Create a new email account
 * @access  Admin
 */
router.post('/', validate(createEmailAccountSchema), createEmailAccount);

/**
 * @route   GET /api/email-accounts
 * @desc    Get all email accounts with pagination and filters
 * @access  Admin
 */
router.get('/', validate(listEmailAccountsSchema), getEmailAccounts);

/**
 * @route   GET /api/email-accounts/:id
 * @desc    Get single email account by ID
 * @access  Admin
 */
router.get('/:id', validate(emailAccountIdSchema), getEmailAccountById);

/**
 * @route   PUT /api/email-accounts/:id
 * @desc    Update email account
 * @access  Admin
 */
router.put('/:id', validate(updateEmailAccountSchema), updateEmailAccount);

/**
 * @route   DELETE /api/email-accounts/:id
 * @desc    Delete email account
 * @access  Admin
 */
router.delete('/:id', validate(emailAccountIdSchema), deleteEmailAccount);

/**
 * @route   POST /api/email-accounts/:id/test
 * @desc    Test email account connection
 * @access  Admin
 */
router.post('/:id/test', validate(emailAccountIdSchema), testEmailAccountConnection);

export default router;
