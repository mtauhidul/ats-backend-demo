import { Request, Response } from "express";
import { jobService, pipelineService, candidateService, applicationService, categoryService, clientService } from "../services/firestore";
import {
  BulkUpdateJobStatusInput,
  CreateJobInput,
  ListJobsQuery,
  UpdateJobInput,
} from "../types/job.types";
import {
  ValidationError as CustomValidationError,
  NotFoundError,
} from "../utils/errors";
import {
  asyncHandler,
  paginateResults,
  successResponse,
} from "../utils/helpers";
import logger from "../utils/logger";
import { logActivity } from "../services/activity.service";

/**
 * Sanitize job data to ensure IDs are strings, not populated objects
 * This prevents frontend from polluting database with populated data
 */
function sanitizeJobData(data: any): any {
  const sanitized = { ...data };
  
  // Extract clientId if it's an object
  if (sanitized.clientId && typeof sanitized.clientId === 'object') {
    sanitized.clientId = sanitized.clientId.id || sanitized.clientId._id;
    logger.warn('⚠️  Sanitized clientId: was object, extracted ID');
  }
  
  // Extract categoryIds if they're objects
  if (sanitized.categoryIds && Array.isArray(sanitized.categoryIds)) {
    const hasObjects = sanitized.categoryIds.some((cat: any) => typeof cat === 'object');
    if (hasObjects) {
      sanitized.categoryIds = sanitized.categoryIds.map((cat: any) =>
        typeof cat === 'object' ? cat.id : cat
      );
      logger.warn('⚠️  Sanitized categoryIds: was array of objects, extracted IDs');
    }
  }
  
  // Extract tagIds if they're objects
  if (sanitized.tagIds && Array.isArray(sanitized.tagIds)) {
    const hasObjects = sanitized.tagIds.some((tag: any) => typeof tag === 'object');
    if (hasObjects) {
      sanitized.tagIds = sanitized.tagIds.map((tag: any) =>
        typeof tag === 'object' ? tag.id : tag
      );
      logger.warn('⚠️  Sanitized tagIds: was array of objects, extracted IDs');
    }
  }
  
  return sanitized;
}

/**
 * Create new job posting
 */
export const createJob = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data: CreateJobInput = req.body;
    
    // Sanitize input data
    const sanitizedData = sanitizeJobData(data);

    // If pipelineId provided, verify it exists
    if (sanitizedData.pipelineId) {
      const pipeline = await pipelineService.findById(sanitizedData.pipelineId);
      if (!pipeline) {
        throw new NotFoundError("Pipeline not found");
      }
    }

    // Create job
    const jobId = await jobService.create({
      ...sanitizedData,
      createdBy: req.user?.id,
    } as any);

    // Fetch created job
    const job = await jobService.findById(jobId);
    
    if (!job) {
      throw new Error("Failed to create job");
    }

    // Update client to add jobId to jobIds array
    if (sanitizedData.clientId) {
      const client = await clientService.findById(sanitizedData.clientId);
      if (client) {
        const jobIds = client.jobIds || [];
        if (!jobIds.includes(jobId)) {
          await clientService.update(sanitizedData.clientId, {
            jobIds: [...jobIds, jobId]
          } as any);
        }
      }
    }

    logger.info(`Job created: ${job.title} by user ${req.user?.id}`);

    // Log activity
    if (req.user?.id) {
      logActivity({
        userId: req.user.id,
        action: "created_job",
        resourceType: "job",
        resourceId: jobId,
        resourceName: job.title,
        metadata: {
          clientId: sanitizedData.clientId,
          status: job.status,
        },
      }).catch((err) => logger.error("Failed to log activity:", err));
    }

    successResponse(res, job, "Job created successfully", 201);
  }
);

/**
 * Get all jobs with filters and pagination
 */
export const getJobs = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      page = 1,
      limit = 10,
      clientId,
      status,
      jobType,
      experienceLevel,
      locationType,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as any as ListJobsQuery;

    // Fetch all jobs
    let allJobs = await jobService.find([]);

    // Apply filters in memory
    if (clientId) {
      allJobs = allJobs.filter((job: any) => job.clientId === clientId);
    }
    if (status) {
      allJobs = allJobs.filter((job: any) => job.status === status);
    }
    if (jobType) {
      allJobs = allJobs.filter((job: any) => job.jobType === jobType);
    }
    if (experienceLevel) {
      allJobs = allJobs.filter((job: any) => job.experienceLevel === experienceLevel);
    }
    if (locationType) {
      allJobs = allJobs.filter((job: any) => job.locationType === locationType);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      allJobs = allJobs.filter((job: any) =>
        job.title?.toLowerCase().includes(searchLower) ||
        job.description?.toLowerCase().includes(searchLower) ||
        job.location?.toLowerCase().includes(searchLower)
      );
    }

    // Get total count after filtering
    const totalCount = allJobs.length;

    // Calculate pagination
    const pagination = paginateResults(totalCount, {
      page,
      limit,
      sort: sortBy,
      order: sortOrder,
    });

    // Apply sorting
    allJobs.sort((a: any, b: any) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    // Apply pagination
    const skip = (page - 1) * limit;
    const jobs = allJobs.slice(skip, skip + limit);

    // Get job IDs for candidate lookup
    const jobIds = jobs.map((j: any) => j.id);
    
    // Fetch ALL candidates for ALL jobs
    const allCandidates = await candidateService.find([]);
    
    // Filter candidates that have any of these job IDs in their jobIds array
    const relevantCandidates = allCandidates.filter((candidate: any) =>
      candidate.jobIds?.some((jobId: string) => jobIds.includes(jobId))
    );
    
    // Calculate statistics for each job in memory
    const statsMap = new Map();
    
    jobIds.forEach((jobId: string) => {
      const jobCandidates = relevantCandidates.filter((candidate: any) =>
        candidate.jobIds?.includes(jobId)
      );
      
      const total = jobCandidates.length;
      const active = jobCandidates.filter((c: any) =>
        ["active", "interviewing", "offered"].includes(c.status)
      ).length;
      const hired = jobCandidates.filter((c: any) =>
        c.status === "hired"
      ).length;
      
      statsMap.set(jobId, {
        totalCandidates: total,
        activeCandidates: active,
        hiredCandidates: hired,
      });
    });
    
    // Add statistics to each job
    const jobsWithStats = jobs.map((job: any) => {
      const jobId = job.id;
      const stats = statsMap.get(jobId) || {
        totalCandidates: 0,
        activeCandidates: 0,
        hiredCandidates: 0,
      };

      return {
        ...job,
        statistics: stats,
      };
    });

    // Populate categories for all jobs
    const allCategoryIds = new Set<string>();
    const allClientIds = new Set<string>();
    
    jobsWithStats.forEach((job: any) => {
      if (job.categoryIds && Array.isArray(job.categoryIds)) {
        job.categoryIds.forEach((id: string) => allCategoryIds.add(id));
      }
      if (job.clientId) {
        allClientIds.add(job.clientId);
      }
    });

    // Fetch all unique categories
    const categoriesMap = new Map();
    if (allCategoryIds.size > 0) {
      const categories = await categoryService.find([]);
      categories.forEach((cat: any) => {
        categoriesMap.set(cat.id, cat);
      });
    }

    // Fetch all unique clients
    const clientsMap = new Map();
    if (allClientIds.size > 0) {
      const clients = await clientService.find([]);
      clients.forEach((client: any) => {
        clientsMap.set(client.id, client);
      });
    }

    // Replace category IDs and client IDs with populated objects
    const jobsWithPopulatedData = jobsWithStats.map((job: any) => {
      const result: any = { ...job };
      
      // Populate categories
      if (job.categoryIds && Array.isArray(job.categoryIds)) {
        const populatedCategories = job.categoryIds
          .map((id: string) => categoriesMap.get(id))
          .filter((cat: any) => cat !== undefined);
        result.categoryIds = populatedCategories;
      }
      
      // Populate client
      if (job.clientId) {
        const client = clientsMap.get(job.clientId);
        if (client) {
          result.clientId = {
            id: client.id,
            _id: client.id,
            companyName: client.companyName,
            logo: client.logo,
          };
        }
      }
      
      return result;
    });

    successResponse(
      res,
      {
        jobs: jobsWithPopulatedData,
        pagination,
      },
      "Jobs retrieved successfully"
    );
  }
);

/**
 * Get single job by ID
 */
export const getJobById = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const job = await jobService.findById(id);

    if (!job) {
      throw new NotFoundError("Job not found");
    }

    // Get candidate statistics
    const allCandidates = await candidateService.find([]);
    
    const jobCandidates = allCandidates.filter((c: any) =>
      c.jobIds?.includes(id)
    );

    const totalCandidates = jobCandidates.length;
    const activeCandidates = jobCandidates.filter((c: any) =>
      ["active", "interviewing", "offered"].includes(c.status)
    ).length;
    const hiredCandidates = jobCandidates.filter((c: any) =>
      c.status === "hired"
    ).length;

    // Populate categories
    let populatedCategoryIds = job.categoryIds;
    if (job.categoryIds && Array.isArray(job.categoryIds) && job.categoryIds.length > 0) {
      const categories = await categoryService.find([]);
      const categoriesMap = new Map();
      categories.forEach((cat: any) => {
        categoriesMap.set(cat.id, cat);
      });
      
      populatedCategoryIds = job.categoryIds
        .map((id: string) => categoriesMap.get(id))
        .filter((cat: any) => cat !== undefined);
    }

    // Populate client
    let populatedClient: any = job.clientId;
    if (job.clientId && typeof job.clientId === 'string') {
      const client = await clientService.findById(job.clientId);
      if (client) {
        populatedClient = {
          id: client.id,
          _id: client.id,
          companyName: (client as any).companyName,
          logo: (client as any).logo,
        };
      }
    }

    successResponse(
      res,
      {
        ...job,
        categoryIds: populatedCategoryIds,
        clientId: populatedClient,
        statistics: {
          totalCandidates,
          activeCandidates,
          hiredCandidates,
        },
      },
      "Job retrieved successfully"
    );
  }
);

/**
 * Update job
 */
export const updateJob = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const updates: UpdateJobInput = req.body;
    
    // Sanitize input data
    const sanitizedUpdates = sanitizeJobData(updates);

    logger.info(`=== Updating Job ${id} ===`);
    logger.info("Updates received:", JSON.stringify(sanitizedUpdates, null, 2));
    logger.info("Requirements field:", sanitizedUpdates.requirements);
    logger.info("Skills field:", sanitizedUpdates.skills);

    // If pipelineId is being changed, verify it exists
    if (sanitizedUpdates.pipelineId) {
      const pipeline = await pipelineService.findById(sanitizedUpdates.pipelineId);
      if (!pipeline) {
        throw new NotFoundError("Pipeline not found");
      }

      // Get the first stage of the pipeline
      const firstStage = pipeline.stages && pipeline.stages.length > 0 
        ? pipeline.stages[0] 
        : null;

      if (firstStage) {
        // Find all candidates with this job in their jobIds array and no stage
        const allCandidates = await candidateService.find([]);
        const candidatesToUpdate = allCandidates.filter((c: any) =>
          c.jobIds?.includes(id) && !c.currentStage
        );

        if (candidatesToUpdate.length > 0) {
          // Update each candidate to set the first stage
          await Promise.all(
            candidatesToUpdate.map((candidate: any) =>
              candidateService.update(candidate.id, {
                currentStage: firstStage.id
              })
            )
          );

          logger.info(
            `Assigned ${candidatesToUpdate.length} candidates to first stage "${firstStage.name}" of pipeline "${pipeline.name}"`
          );
        }
      }
    }

    // Get old job to check clientId change
    const oldJob = await jobService.findById(id);
    if (!oldJob) {
      throw new NotFoundError("Job not found");
    }

    // Update job
    await jobService.update(id, {
      ...sanitizedUpdates,
      updatedBy: req.user?.id,
    } as any);

    // Get updated job
    const job = await jobService.findById(id);

    if (!job) {
      throw new NotFoundError("Job not found");
    }

    // Handle clientId change - update both old and new clients
    if (sanitizedUpdates.clientId && sanitizedUpdates.clientId !== oldJob.clientId) {
      // Remove from old client
      if (oldJob.clientId) {
        const oldClient = await clientService.findById(oldJob.clientId);
        if (oldClient && oldClient.jobIds) {
          await clientService.update(oldJob.clientId, {
            jobIds: oldClient.jobIds.filter((jId: string) => jId !== id)
          } as any);
        }
      }
      
      // Add to new client
      const newClient = await clientService.findById(sanitizedUpdates.clientId);
      if (newClient) {
        const jobIds = newClient.jobIds || [];
        if (!jobIds.includes(id)) {
          await clientService.update(sanitizedUpdates.clientId, {
            jobIds: [...jobIds, id]
          } as any);
        }
      }
    }

    logger.info(`Job updated: ${job.title}`);

    // Log activity
    if (req.user?.id) {
      // Check for specific status changes
      if (sanitizedUpdates.status && sanitizedUpdates.status !== oldJob.status) {
        const statusActionMap: Record<string, string> = {
          'published': 'job_published',
          'closed': 'job_closed',
          'archived': 'job_archived',
        };
        
        const action = statusActionMap[sanitizedUpdates.status] || 'updated_job';
        
        logActivity({
          userId: req.user.id,
          action: action,
          resourceType: "job",
          resourceId: id,
          resourceName: job.title,
          metadata: {
            oldStatus: oldJob.status,
            newStatus: sanitizedUpdates.status,
          },
        }).catch((err) => logger.error("Failed to log activity:", err));
      } else {
        // General update
        logActivity({
          userId: req.user.id,
          action: "updated_job",
          resourceType: "job",
          resourceId: id,
          resourceName: job.title,
        }).catch((err) => logger.error("Failed to log activity:", err));
      }
    }

    successResponse(res, job, "Job updated successfully");
  }
);

/**
 * Delete job
 */
export const deleteJob = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const job = await jobService.findById(id);

    if (!job) {
      throw new NotFoundError("Job not found");
    }

    // Check if there are candidates with active/rejected/hired status
    const allCandidates = await candidateService.find([]);
    const jobCandidates = allCandidates.filter((candidate: any) => {
      if (!candidate.jobIds || !Array.isArray(candidate.jobIds)) return false;
      return candidate.jobIds.some((jobId: any) => {
        const jId = typeof jobId === 'object' ? jobId._id || jobId.id : jobId;
        return jId === id;
      });
    });

    // Filter candidates with active, rejected, or hired status
    const protectedCandidates = jobCandidates.filter((candidate: any) => {
      const status = candidate.status?.toLowerCase();
      return status === 'active' || status === 'rejected' || status === 'hired';
    });

    if (protectedCandidates.length > 0) {
      const statusBreakdown = {
        active: protectedCandidates.filter((c: any) => c.status?.toLowerCase() === 'active').length,
        rejected: protectedCandidates.filter((c: any) => c.status?.toLowerCase() === 'rejected').length,
        hired: protectedCandidates.filter((c: any) => c.status?.toLowerCase() === 'hired').length,
      };
      
      const statusDetails = [];
      if (statusBreakdown.active > 0) statusDetails.push(`${statusBreakdown.active} active`);
      if (statusBreakdown.rejected > 0) statusDetails.push(`${statusBreakdown.rejected} rejected`);
      if (statusBreakdown.hired > 0) statusDetails.push(`${statusBreakdown.hired} hired`);

      throw new CustomValidationError(
        `Cannot delete job with ${protectedCandidates.length} candidate${protectedCandidates.length > 1 ? 's' : ''} (${statusDetails.join(', ')}). Please archive or remove these candidates first.`
      );
    }

    // Check if there are applications
    const allApplications = await applicationService.find([]);
    const jobApplications = allApplications.filter((app: any) => app.jobId === id);

    if (jobApplications.length > 0) {
      throw new CustomValidationError(
        `Cannot delete job with ${jobApplications.length} applications. Please close the job instead.`
      );
    }

    await jobService.delete(id);

    // Remove jobId from client's jobIds array
    if (job.clientId) {
      const client = await clientService.findById(job.clientId);
      if (client && client.jobIds) {
        await clientService.update(job.clientId, {
          jobIds: client.jobIds.filter((jId: string) => jId !== id)
        } as any);
      }
    }

    logger.info(`Job deleted: ${job.title}`);

    successResponse(res, null, "Job deleted successfully");
  }
);

/**
 * Bulk update job status
 */
export const bulkUpdateJobStatus = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { jobIds, status }: BulkUpdateJobStatusInput = req.body;

    // Validate all IDs (simple string validation for Firestore)
    const validIds = jobIds.filter((id) => typeof id === 'string' && id.length > 0);
    if (validIds.length !== jobIds.length) {
      throw new CustomValidationError("Some job IDs are invalid");
    }

    // Update jobs in a loop
    let modifiedCount = 0;
    await Promise.all(
      validIds.map(async (id) => {
        try {
          await jobService.update(id, { 
            status, 
            updatedBy: req.user?.id 
          } as any);
          modifiedCount++;
        } catch (error) {
          logger.error(`Failed to update job ${id}:`, error);
        }
      })
    );

    logger.info(
      `Bulk updated ${modifiedCount} jobs to status: ${status}`
    );

    successResponse(
      res,
      {
        modifiedCount,
        status,
      },
      `Successfully updated ${modifiedCount} jobs`
    );
  }
);

/**
 * Get job statistics
 */
export const getJobStats = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { clientId } = req.query;

    // Fetch all jobs
    let allJobs = await jobService.find([]);
    
    // Apply filter if clientId is provided
    if (clientId) {
      allJobs = allJobs.filter((job: any) => job.clientId === clientId);
    }

    // Calculate statistics in memory
    const total = allJobs.length;
    
    // Group by status
    const byStatus = allJobs.reduce((acc: any, job: any) => {
      const status = job.status || 'draft';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    // Group by employment type
    const byEmploymentType = allJobs.reduce((acc: any, job: any) => {
      const empType = job.employmentType || 'full_time';
      acc[empType] = (acc[empType] || 0) + 1;
      return acc;
    }, {});

    const result = {
      total,
      byStatus,
      byEmploymentType,
    };

    successResponse(res, result, "Job statistics retrieved successfully");
  }
);
