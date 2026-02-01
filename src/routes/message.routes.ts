import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  getMessages,
  getMessageById,
  sendMessage,
  updateMessage,
  deleteMessage,
  getConversationMessages,
  markConversationAsRead,
} from '../controllers/message.controller';

const router: express.Router = express.Router();

// All message routes require authentication
router.use(authenticate);

// Get all messages (organized by conversations)
router.get('/', getMessages);

// Send a new message
router.post('/', sendMessage);

// Get messages in a specific conversation
router.get('/conversation/:conversationId', getConversationMessages);

// Mark all messages in a conversation as read
router.patch('/conversation/:conversationId/read', markConversationAsRead);

// Get single message
router.get('/:id', getMessageById);

// Update message (mark as read)
router.patch('/:id', updateMessage);

// Delete message
router.delete('/:id', deleteMessage);

export default router;
