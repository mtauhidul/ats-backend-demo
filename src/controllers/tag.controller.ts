import { Request, Response } from 'express';
import { tagService } from '../services/firestore';
import { asyncHandler, successResponse } from '../utils/helpers';
import { NotFoundError, ValidationError as CustomValidationError } from '../utils/errors';
import logger from '../utils/logger';
import { CreateTagInput, UpdateTagInput } from '../types/tag.types';

export const createTag = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data: CreateTagInput = req.body;

    const allTags = await tagService.find([]);
    const existingTag = allTags.find((t: any) => t.name === data.name);
    if (existingTag) {
      throw new CustomValidationError(`Tag already exists with name: ${data.name}`);
    }

    const tagId = await tagService.create({ ...data, createdBy: req.user?.id } as any);
    const tag = await tagService.findById(tagId);
    if (!tag) throw new NotFoundError('Tag not found after creation');
    logger.info(`Tag created: ${tag.name}`);
    successResponse(res, tag, 'Tag created successfully', 201);
  }
);

export const getTags = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    let tags = await tagService.find([]);
    
    // Ensure tags is an array (handle Firestore serialization)
    if (!Array.isArray(tags) && typeof tags === 'object') {
      tags = Object.values(tags);
    }
    
    tags = tags.sort((a: any, b: any) => a.name.localeCompare(b.name));
    
    successResponse(res, tags, 'Tags retrieved successfully');
  }
);

export const getTagById = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const tag = await tagService.findById(req.params.id);
    if (!tag) throw new NotFoundError('Tag not found');
    successResponse(res, tag, 'Tag retrieved successfully');
  }
);

export const updateTag = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const updates: UpdateTagInput = req.body;
    const tag = await tagService.findById(req.params.id);

    if (!tag) throw new NotFoundError('Tag not found');

    if (updates.name && updates.name !== tag.name) {
      const allTags = await tagService.find([]);
      const existing = allTags.find(
        (t: any) => t.name === updates.name && t.id !== req.params.id
      );
      if (existing) {
        throw new CustomValidationError(`Tag already exists with name: ${updates.name}`);
      }
    }

    const updateData: any = {
      ...updates,
      updatedBy: req.user?.id,
      updatedAt: new Date(),
    };
    await tagService.update(req.params.id, updateData);

    const updatedTag = await tagService.findById(req.params.id);
    if (!updatedTag) throw new NotFoundError('Tag not found after update');
    logger.info(`Tag updated: ${updatedTag.name}`);
    successResponse(res, updatedTag, 'Tag updated successfully');
  }
);

export const deleteTag = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const tag = await tagService.findById(req.params.id);
    if (!tag) throw new NotFoundError('Tag not found');

    logger.info(`[TAG_DELETE] Attempting to delete tag: ${tag.name} (${req.params.id}) by user: ${req.user?.email}`);

    // Check if tag is in use by any candidates or jobs
    const { candidateService, jobService } = require('../services/firestore');
    
    const allCandidates = await candidateService.find([]);
    const candidatesWithTag = allCandidates.filter((c: any) => 
      c.tagIds && Array.isArray(c.tagIds) && c.tagIds.includes(req.params.id)
    );
    
    const allJobs = await jobService.find([]);
    const jobsWithTag = allJobs.filter((j: any) => 
      j.tagIds && Array.isArray(j.tagIds) && j.tagIds.includes(req.params.id)
    );
    
    const totalUsage = candidatesWithTag.length + jobsWithTag.length;
    
    if (totalUsage > 0) {
      logger.warn(
        `[TAG_DELETE] Cannot delete tag "${tag.name}" (${req.params.id}): ` +
        `Used by ${candidatesWithTag.length} candidate(s) and ${jobsWithTag.length} job(s). ` +
        `Requested by: ${req.user?.email}`
      );
      
      const usageDetails = [];
      if (candidatesWithTag.length > 0) {
        usageDetails.push(`${candidatesWithTag.length} candidate(s)`);
      }
      if (jobsWithTag.length > 0) {
        usageDetails.push(`${jobsWithTag.length} job(s)`);
      }
      
      throw new CustomValidationError(
        `Cannot delete tag "${tag.name}" because it is currently assigned to ${usageDetails.join(' and ')}. ` +
        `Please remove the tag from all candidates and jobs before deleting it.`
      );
    }

    await tagService.delete(req.params.id);
    logger.info(`[TAG_DELETE] Tag successfully deleted: ${tag.name} (${req.params.id}) by user: ${req.user?.email}`);
    successResponse(res, null, 'Tag deleted successfully');
  }
);
