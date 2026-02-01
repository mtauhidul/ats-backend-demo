import express from 'express';
import { validate } from '../middleware/validation';
import { authenticate, requireRole } from '../middleware/auth';
import { createCategory, getCategories, getCategoryById, updateCategory, deleteCategory } from '../controllers/category.controller';
import { createCategorySchema, updateCategorySchema, categoryIdSchema } from '../types/category.types';

const router: express.Router = express.Router();
router.use(authenticate);

router.post('/', requireRole('admin'), validate(createCategorySchema), createCategory);
router.get('/', getCategories);
router.get('/:id', validate(categoryIdSchema), getCategoryById);
router.put('/:id', requireRole('admin'), validate(updateCategorySchema), updateCategory);
router.patch('/:id', requireRole('admin'), validate(updateCategorySchema), updateCategory);
router.delete('/:id', requireRole('admin'), validate(categoryIdSchema), deleteCategory);

export default router;
