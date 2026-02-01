import express from 'express';
import { validate } from '../middleware/validation';
import { authenticate, requireRole } from '../middleware/auth';
import { createTag, getTags, getTagById, updateTag, deleteTag } from '../controllers/tag.controller';
import { createTagSchema, updateTagSchema, tagIdSchema } from '../types/tag.types';

const router: express.Router = express.Router();
router.use(authenticate);

router.post('/', requireRole('admin'), validate(createTagSchema), createTag);
router.get('/', getTags);
router.get('/:id', validate(tagIdSchema), getTagById);
router.put('/:id', requireRole('admin'), validate(updateTagSchema), updateTag);
router.patch('/:id', requireRole('admin'), validate(updateTagSchema), updateTag);
router.delete('/:id', requireRole('admin'), validate(tagIdSchema), deleteTag);

export default router;
