import { z } from 'zod';

/**
 * Candidate Validation Schemas
 */

export const createCandidateSchema = z.object({
  body: z.object({
    applicationId: z.string().min(1, 'Invalid application ID').optional(),
    jobId: z.string().min(1, 'Invalid job ID format'),
    clientId: z.string().min(1, 'Invalid client ID format').optional(),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Invalid email address'),
    phone: z.string().optional(),
    resumeUrl: z.string().url('Invalid resume URL'),
    pipelineId: z.string().min(1, 'Invalid pipeline ID').optional(),
    currentStage: z.string().optional(),
    status: z.enum(['active', 'hired', 'rejected', 'withdrawn']).default('active'),
    notes: z.string().optional(),
    source: z.enum(['manual', 'direct_apply', 'email_automation']).optional(),
    rawEmailBody: z.string().optional(),
    rawEmailBodyHtml: z.string().optional(),
  }),
});

export const updateCandidateSchema = z.object({
  body: z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    resumeUrl: z.string().url().optional(),
    currentStage: z.string().optional(),
    status: z.enum(['active', 'hired', 'rejected', 'withdrawn']).optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  params: z.object({
    id: z.string().min(1, 'Invalid ID format'),
  }),
});

export const candidateIdSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'Invalid ID format'),
  }),
});

export const listCandidatesSchema = z.object({
  query: z.object({
    page: z.string().optional().transform(val => val ? parseInt(val, 10) : 1),
    limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 10),
    jobId: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    pipelineId: z.string().min(1).optional(),
    status: z.enum(['active', 'hired', 'rejected', 'withdrawn']).optional(),
    currentStage: z.string().optional(),
    minScore: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined),
    maxScore: z.string().optional().transform(val => val ? parseInt(val, 10) : undefined),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  }),
});

export const moveCandidateStageSchema = z.object({
  body: z.object({
    newStage: z.string().min(1, 'New stage is required'),
    notes: z.string().optional(),
  }),
  params: z.object({
    id: z.string().min(1, 'Invalid ID format'),
  }),
});

export const rescoreCandidateSchema = z.object({
  body: z.object({
    jobId: z.string().min(1, 'Invalid job ID format'),
  }),
  params: z.object({
    id: z.string().min(1, 'Invalid ID format'),
  }),
});

export const bulkMoveCandidatesSchema = z.object({
  body: z.object({
    candidateIds: z.array(z.string().min(1)).min(1, 'At least one candidate ID required'),
    newStage: z.string().min(1, 'New stage is required'),
    notes: z.string().optional(),
  }),
});

export type CreateCandidateInput = z.infer<typeof createCandidateSchema>['body'];
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>['body'];
export type ListCandidatesQuery = z.infer<typeof listCandidatesSchema>['query'];
export type MoveCandidateStageInput = z.infer<typeof moveCandidateStageSchema>['body'];
export type RescoreCandidateInput = z.infer<typeof rescoreCandidateSchema>['body'];
export type BulkMoveCandidatesInput = z.infer<typeof bulkMoveCandidatesSchema>['body'];
