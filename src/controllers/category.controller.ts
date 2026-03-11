import { Request, Response } from 'express';
import { categoryService } from '../services/firestore';
import { asyncHandler, successResponse } from '../utils/helpers';
import { NotFoundError, ValidationError as CustomValidationError } from '../utils/errors';
import logger from '../utils/logger';
import { CreateCategoryInput, UpdateCategoryInput } from '../types/category.types';

export const createCategory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data: CreateCategoryInput = req.body;

    const allCategories = await categoryService.find([]);
    const existingCategory = allCategories.find((c: any) => c.name === data.name);
    if (existingCategory) {
      throw new CustomValidationError(`Category already exists with name: ${data.name}`);
    }

    const categoryId = await categoryService.create({ ...data, createdBy: req.user?.id } as any);
    const category = await categoryService.findById(categoryId);
    if (!category) throw new NotFoundError('Category not found after creation');
    logger.info(`Category created: ${category.name}`);
    successResponse(res, category, 'Category created successfully', 201);
  }
);

export const getCategories = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    let categories = await categoryService.find([]);
    
    categories = categories.sort((a: any, b: any) => a.name.localeCompare(b.name));
    
    successResponse(res, categories, 'Categories retrieved successfully');
  }
);

export const getCategoryById = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const category = await categoryService.findById(req.params.id);
    if (!category) throw new NotFoundError('Category not found');
    successResponse(res, category, 'Category retrieved successfully');
  }
);

export const updateCategory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const updates: UpdateCategoryInput = req.body;
    const category = await categoryService.findById(req.params.id);

    if (!category) throw new NotFoundError('Category not found');

    if (updates.name && updates.name !== category.name) {
      const allCategories = await categoryService.find([]);
      const existing = allCategories.find(
        (c: any) => c.name === updates.name && c.id !== req.params.id
      );
      if (existing) {
        throw new CustomValidationError(`Category already exists with name: ${updates.name}`);
      }
    }

    const updateData: any = {
      ...updates,
      updatedBy: req.user?.id,
      updatedAt: new Date(),
    };
    await categoryService.update(req.params.id, updateData);

    const updatedCategory = await categoryService.findById(req.params.id);
    if (!updatedCategory) throw new NotFoundError('Category not found after update');
    logger.info(`Category updated: ${updatedCategory.name}`);
    successResponse(res, updatedCategory, 'Category updated successfully');
  }
);

export const deleteCategory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const category = await categoryService.findById(req.params.id);
    if (!category) throw new NotFoundError('Category not found');

    logger.info(`[CATEGORY_DELETE] Attempting to delete category: ${category.name} (${req.params.id}) by user: ${req.user?.email}`);

    // Check if category is in use by any jobs
    const { jobService } = require('../services/firestore');
    
    const allJobs = await jobService.find([]);
    const jobsWithCategory = allJobs.filter((j: any) => 
      j.categoryIds && Array.isArray(j.categoryIds) && j.categoryIds.includes(req.params.id)
    );
    
    if (jobsWithCategory.length > 0) {
      logger.warn(
        `[CATEGORY_DELETE] Cannot delete category "${category.name}" (${req.params.id}): ` +
        `Used by ${jobsWithCategory.length} job(s). ` +
        `Requested by: ${req.user?.email}`
      );
      
      throw new CustomValidationError(
        `Cannot delete category "${category.name}" because it is currently assigned to ${jobsWithCategory.length} job(s). ` +
        `Please remove the category from all jobs before deleting it.`
      );
    }

    await categoryService.delete(req.params.id);
    logger.info(`[CATEGORY_DELETE] Category successfully deleted: ${category.name} (${req.params.id}) by user: ${req.user?.email}`);
    successResponse(res, null, 'Category deleted successfully');
  }
);
