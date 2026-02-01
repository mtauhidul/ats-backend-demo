import express from 'express';
import { validate } from '../middleware/validation';
import { authenticate, requirePermission } from '../middleware/auth';
import {
  createClient,
  getClients,
  getClientById,
  updateClient,
  deleteClient,
  getClientStats,
  addCommunicationNote,
} from '../controllers/client.controller';
import {
  createClientSchema,
  updateClientSchema,
  listClientsSchema,
  clientIdSchema,
} from '../types/client.types';

const router: express.Router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/clients
 * @desc    Create new client
 * @access  Users with canManageClients permission
 */
router.post(
  '/',
  requirePermission('canManageClients'),
  validate(createClientSchema),
  createClient
);

/**
 * @route   GET /api/clients
 * @desc    Get all clients with filters
 * @access  All authenticated users
 */
router.get(
  '/',
  validate(listClientsSchema),
  getClients
);

/**
 * @route   GET /api/clients/stats
 * @desc    Get client statistics
 * @access  Users with canManageClients or canAccessAnalytics permission
 */
router.get(
  '/stats',
  requirePermission('canManageClients', 'canAccessAnalytics'),
  getClientStats
);

/**
 * @route   GET /api/clients/:id
 * @desc    Get client by ID
 * @access  All authenticated users
 */
router.get(
  '/:id',
  validate(clientIdSchema),
  getClientById
);

/**
 * @route   PUT /api/clients/:id
 * @desc    Update client
 * @access  Users with canManageClients permission
 */
router.put(
  '/:id',
  requirePermission('canManageClients'),
  validate(updateClientSchema),
  updateClient
);

/**
 * @route   PATCH /api/clients/:id
 * @desc    Update client (partial update)
 * @access  Users with canManageClients permission
 */
router.patch(
  '/:id',
  requirePermission('canManageClients'),
  validate(updateClientSchema),
  updateClient
);

/**
 * @route   POST /api/clients/:id/notes
 * @desc    Add communication note to client
 * @access  All authenticated users
 */
router.post(
  '/:id/notes',
  addCommunicationNote
);

/**
 * @route   DELETE /api/clients/:id
 * @desc    Delete client
 * @access  Users with canManageClients permission
 */
router.delete(
  '/:id',
  requirePermission('canManageClients'),
  validate(clientIdSchema),
  deleteClient
);

export default router;
