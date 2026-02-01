import express from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { uploadAvatar } from '../middleware/upload';
import {
  getUsers,
  getUserById,
  getCurrentUser,
  updateUser,
  deleteUser,
  getUserStats,
  uploadUserAvatar,
  deleteUserAvatar,
} from '../controllers/user.controller';

const router: express.Router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/users/me
 * @desc    Get current user profile
 * @access  All authenticated users
 */
router.get('/me', getCurrentUser);

/**
 * @route   GET /api/users/stats
 * @desc    Get user statistics
 * @access  Users with canManageTeam or canAccessAnalytics permission
 */
router.get(
  '/stats',
  requirePermission('canManageTeam', 'canAccessAnalytics'),
  getUserStats
);

/**
 * @route   GET /api/users
 * @desc    Get all users with filters
 * @access  Users with canManageTeam permission
 */
router.get(
  '/',
  requirePermission('canManageTeam'),
  getUsers
);

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Users with canManageTeam permission
 */
router.get(
  '/:id',
  requirePermission('canManageTeam'),
  getUserById
);

/**
 * @route   POST /api/users/:id/avatar
 * @desc    Upload user avatar
 * @access  Authenticated user (own profile) or Admin
 */
router.post(
  '/:id/avatar',
  uploadAvatar,
  uploadUserAvatar
);

/**
 * @route   DELETE /api/users/:id/avatar
 * @desc    Delete user avatar
 * @access  Authenticated user (own profile) or Admin
 */
router.delete(
  '/:id/avatar',
  deleteUserAvatar
);

/**
 * @route   PUT /api/users/:id
 * @desc    Update user
 * @access  Users with canManageTeam permission
 */
router.put(
  '/:id',
  requirePermission('canManageTeam'),
  updateUser
);

/**
 * @route   PATCH /api/users/:id
 * @desc    Update user (partial)
 * @access  Users with canManageTeam permission
 */
router.patch(
  '/:id',
  requirePermission('canManageTeam'),
  updateUser
);

/**
 * @route   DELETE /api/users/:id
 * @desc    Deactivate user
 * @access  Users with canManageTeam permission
 */
router.delete(
  '/:id',
  requirePermission('canManageTeam'),
  deleteUser
);

export default router;
