import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getNotifications,
  getNotificationById,
  createNotification,
  updateNotification,
  deleteNotification,
  deleteAllNotifications,
  markAllAsRead,
  broadcastImportantNotice,
} from '../controllers/notification.controller';

const router: express.Router = express.Router();

// All notification routes require authentication
router.use(authenticate);

// Specific routes MUST come before parameterized routes
// Broadcast important notice to all team members (Admin only)
router.post('/broadcast-important', requireRole('admin'), broadcastImportantNotice);

// Mark all notifications as read
router.patch('/mark-all-read', markAllAsRead);

// Delete all notifications
router.delete('/clear-all', deleteAllNotifications);

// Get all notifications for authenticated user
router.get('/', getNotifications);

// Create notification (typically called internally by other services)
router.post('/', createNotification);

// Parameterized routes come last to avoid conflicts
// Get single notification
router.get('/:id', getNotificationById);

// Update notification (mark as read)
router.patch('/:id', updateNotification);

// Delete notification
router.delete('/:id', deleteNotification);

export default router;
