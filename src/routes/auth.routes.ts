import { Router } from 'express';
import {
  register,
  registerFirstAdmin,
  login,
  requestMagicLink,
  verifyMagicLink,
  verifyEmail,
  setPassword,
  forgotPassword,
  resetPassword,
  refreshAccessToken,
  logout,
  getMe,
  updateProfile,
  updatePassword,
} from '../controllers/auth.controller';
import { authenticate, requireAdmin } from '../middleware/auth';
import { body } from 'express-validator';
import { validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

// Validation middleware
const validateRequest = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

const router: Router = Router();

/**
 * Public routes (no authentication required)
 */

// Register first admin user (only works if no users exist)
router.post(
  '/register-first-admin',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validateRequest,
  registerFirstAdmin
);

// Login with email and password
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validateRequest,
  login
);

// Request magic link (passwordless login)
router.post(
  '/magic-link',
  [body('email').isEmail().withMessage('Valid email is required')],
  validateRequest,
  requestMagicLink
);

// Verify magic link and login
router.get('/magic-link/:token', verifyMagicLink);

// Verify email with token
router.get('/verify-email/:token', verifyEmail);

// Set password after email verification (for new users)
router.post(
  '/set-password',
  [
    body('token').notEmpty().withMessage('Token is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase, and number'),
  ],
  validateRequest,
  setPassword
);

// Request password reset
router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('Valid email is required')],
  validateRequest,
  forgotPassword
);

// Reset password with token
router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Token is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase, and number'),
  ],
  validateRequest,
  resetPassword
);

// Refresh access token
router.post('/refresh', refreshAccessToken);

/**
 * Protected routes (authentication required)
 */

// Get current user
router.get('/me', authenticate, getMe);

// Update user profile
router.patch(
  '/profile',
  authenticate,
  [
    body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
    body('lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty'),
    body('phone').optional().trim(),
    body('title').optional().trim(),
    body('department').optional().trim(),
    body('avatar').optional().isString().withMessage('Avatar must be a string'),
  ],
  validateRequest,
  updateProfile
);

// Logout - no authentication required (token might be expired)
router.post('/logout', logout);

// Update password (logged in users)
router.post(
  '/update-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase, and number'),
  ],
  validateRequest,
  updatePassword
);

/**
 * Admin only routes
 */

// Register new user (admin only)
router.post(
  '/register',
  authenticate,
  requireAdmin,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
    body('role')
      .optional()
      .isIn(['admin', 'recruiter', 'hiring_manager', 'interviewer', 'coordinator'])
      .withMessage('Invalid role'),
  ],
  validateRequest,
  register
);

export default router;
