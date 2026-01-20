import { Request, Response } from "express";
import { logActivity } from "../services/activity.service";
import { sendAssignmentEmail } from "../services/email.service";
import {
  candidateService,
  clientService,
  jobService,
  pipelineService,
  userService,
} from "../services/firestore";
import openaiService from "../services/openai.service";
import {
  BulkMoveCandidatesInput,
  CreateCandidateInput,
  ListCandidatesQuery,
  MoveCandidateStageInput,
  RescoreCandidateInput,
  UpdateCandidateInput,
} from "../types/candidate.types";
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

/**
 * Create new candidate (manual entry)
 */
export const createCandidate = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data: CreateCandidateInput = req.body;

    // Verify job exists
    const job = await jobService.findById(data.jobId);
    if (!job) {
      throw new NotFoundError("Job not found");
    }

    // Check for duplicate candidate - using email only since candidate can apply to multiple jobs
    const allCandidates = await candidateService.find([]);
    const existingCandidate = allCandidates.find(
      (c: any) => c.email === data.email
    );

    if (existingCandidate) {
      // Check if already applied to this job
      if (existingCandidate.jobIds.some((id) => id === data.jobId)) {
        throw new CustomValidationError(
          `Candidate already exists for this job with email: ${data.email}`
        );
      }
    }

    // Create candidate
    const candidateId = await candidateService.create({
      ...data,
      jobIds: [data.jobId], // First job
      status: data.status || "active",
      jobApplications: [
        {
          jobId: data.jobId,
          status: data.status || "active",
          appliedAt: new Date(),
          lastStatusChange: new Date(),
          emailIds: [],
          emailsSent: 0,
          emailsReceived: 0,
        },
      ],
    } as any);

    // Fetch the created candidate
    const candidate = await candidateService.findById(candidateId);
    if (!candidate) {
      throw new NotFoundError("Failed to create candidate");
    }

    // Fetch job details for response (Firestore doesn't have populate)
    const jobDetails = await jobService.findById(data.jobId);

    logger.info(
      `Candidate created manually: ${candidate.email} for job ${job.title}`
    );

    // Log activity
    if (req.user?.id) {
      logActivity({
        userId: req.user.id,
        action: "created_candidate",
        resourceType: "candidate",
        resourceId: candidateId,
        resourceName: `${candidate.firstName} ${candidate.lastName}`,
        metadata: {
          jobId: data.jobId,
          jobTitle: job.title,
          email: candidate.email,
        },
      }).catch((err) => logger.error("Failed to log activity:", err));
    }

    successResponse(
      res,
      { ...candidate, jobIds: jobDetails ? [jobDetails] : [] },
      "Candidate created successfully",
      201
    );
  }
);

/**
 * Get all candidates with filters and pagination
 */
export const getCandidates = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      page = 1,
      limit = 10,
      jobId,
      status,
      currentStage,
      minScore,
      maxScore,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as any as ListCandidatesQuery;

    // Fetch all candidates (Firestore doesn't support complex queries like MongoDB)
    let allCandidates = await candidateService.find([]);

    // 🔒 RBAC: Users without canManageCandidates permission can only see candidates assigned to them
    const userRole = (req.user as any)?.role;
    const userId = (req.user as any)?.id;
    const userPermissions = (req.user as any)?.permissions;
    const canManageAllCandidates = userRole === "admin" || userPermissions?.canManageCandidates === true;

    logger.info(
      `🔍 RBAC Check - User: ${userId}, Role: ${userRole}, canManageCandidates: ${canManageAllCandidates}, Total candidates: ${allCandidates.length}`
    );

    if (!canManageAllCandidates && userId) {
      const beforeFilter = allCandidates.length;

      // Debug: Log first few candidates' assignedTo values
      logger.info(
        `📊 Sample candidates assignedTo: ${JSON.stringify(
          allCandidates.slice(0, 3).map((c: any) => ({
            id: c.id,
            name: `${c.firstName} ${c.lastName}`,
            assignedTo: c.assignedTo,
          }))
        )}`
      );

      allCandidates = allCandidates.filter((c: any) => {
        // Check if assignedTo matches the current user
        if (typeof c.assignedTo === "string") {
          const matches = c.assignedTo === userId;
          if (matches)
            logger.info(`✅ Matched by string: ${c.firstName} ${c.lastName}`);
          return matches;
        } else if (c.assignedTo && typeof c.assignedTo === "object") {
          const matches =
            c.assignedTo.id === userId || c.assignedTo._id === userId;
          if (matches)
            logger.info(`✅ Matched by object: ${c.firstName} ${c.lastName}`);
          return matches;
        }
        // If no assignedTo, candidate is not visible to users without canManageCandidates permission
        logger.info(`❌ No assignedTo: ${c.firstName} ${c.lastName}`);
        return false;
      });
      logger.info(
        `🔒 RBAC filter applied: ${userRole} user ${userId} (canManageCandidates: ${canManageAllCandidates}) can see ${allCandidates.length}/${beforeFilter} candidates`
      );
    } else {
      logger.info(
        `👑 User with canManageCandidates permission or admin - showing all ${allCandidates.length} candidates`
      );
    }

    // Apply filters in memory
    if (jobId) {
      allCandidates = allCandidates.filter((c: any) =>
        c.jobIds.includes(jobId)
      );
    }
    if (status) {
      allCandidates = allCandidates.filter((c: any) => c.status === status);
    }
    if (currentStage) {
      allCandidates = allCandidates.filter(
        (c: any) => c.currentPipelineStageId === currentStage
      );
    }

    // AI Score filtering
    if (minScore !== undefined || maxScore !== undefined) {
      allCandidates = allCandidates.filter((c: any) => {
        const score = c.aiScore?.overallScore;
        if (score === undefined) return false;
        if (minScore !== undefined && score < minScore) return false;
        if (maxScore !== undefined && score > maxScore) return false;
        return true;
      });
    }

    if (search) {
      const searchLower = search.toLowerCase();
      allCandidates = allCandidates.filter(
        (c: any) =>
          c.firstName?.toLowerCase().includes(searchLower) ||
          c.lastName?.toLowerCase().includes(searchLower) ||
          c.email?.toLowerCase().includes(searchLower)
      );
    }

    // Get total count after filtering
    const totalCount = allCandidates.length;

    // Calculate pagination
    const pagination = paginateResults(totalCount, {
      page,
      limit,
      sort: sortBy,
      order: sortOrder,
    });

    // Sort candidates
    allCandidates.sort((a: any, b: any) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      const multiplier = sortOrder === "asc" ? 1 : -1;
      if (aValue < bValue) return -1 * multiplier;
      if (aValue > bValue) return 1 * multiplier;
      return 0;
    });

    // Apply pagination
    const skip = (page - 1) * limit;
    const candidates = allCandidates.slice(skip, skip + limit);

    logger.info(`Found ${candidates.length} candidates`);

    // Fetch pipeline stages for candidates with currentPipelineStageId
    const stageIds = [
      ...new Set(
        candidates
          .filter((c: any) => c.currentPipelineStageId)
          .map((c: any) => c.currentPipelineStageId!)
      ),
    ];

    // Fetch all pipelines that contain these stages
    const allPipelines =
      stageIds.length > 0 ? await pipelineService.find([]) : [];

    // Create a map of stageId -> stage data for fast lookup
    const stageMap = new Map();
    allPipelines.forEach((pipeline: any) => {
      pipeline.stages?.forEach((stage: any) => {
        stageMap.set(stage.id || stage._id, {
          id: stage.id || stage._id,
          name: stage.name,
          color: stage.color,
          order: stage.order,
        });
      });
    });

    // Now populate stages for all candidates without additional queries
    const candidatesWithStage = candidates.map((candidate: any) => {
      if (candidate.currentPipelineStageId) {
        const stageData = stageMap.get(candidate.currentPipelineStageId);
        if (stageData) {
          candidate.currentStage = stageData;
        } else {
          // Debug: Log when stage is not found
          logger.warn(
            `Stage ID not found in pipelines: ${candidate.currentPipelineStageId}`
          );
          logger.debug(
            `Available stage IDs: ${Array.from(stageMap.keys()).join(", ")}`
          );

          // Stage ID not found in any pipeline - create fallback stage object
          candidate.currentStage = {
            id: candidate.currentPipelineStageId,
            name: "Unknown Stage",
            color: "#6B7280",
            order: 0,
          };
        }
      }
      return candidate;
    });

    // Populate job information with client data
    const jobIds = [
      ...new Set(
        candidatesWithStage
          .flatMap((c: any) => c.jobIds || [])
          .filter((id: any) => id && typeof id === "string")
      ),
    ];

    let jobsMap = new Map();
    if (jobIds.length > 0) {
      try {
        const jobs = await Promise.all(
          (jobIds as string[]).map((id) => jobService.findById(id))
        );

        // Get all unique client IDs from jobs
        const clientIds = [
          ...new Set(
            jobs
              .filter((job) => job !== null && (job as any).clientId)
              .map((job) => (job as any).clientId)
              .filter((id: any) => id && typeof id === "string")
          ),
        ];

        // Fetch all clients
        let clientsMap = new Map();
        if (clientIds.length > 0) {
          const clients = await Promise.all(
            (clientIds as string[]).map((id) => clientService.findById(id))
          );
          clientsMap = new Map(
            clients
              .filter((client) => client !== null)
              .map((client) => [
                client!.id,
                {
                  id: client!.id,
                  _id: client!.id,
                  companyName: (client as any).companyName,
                  logo: (client as any).logo,
                },
              ])
          );
        }

        // Create jobs map with populated clients
        jobsMap = new Map(
          jobs
            .filter((job) => job !== null)
            .map((job) => {
              const jobWithClient = { ...job };
              if (
                (job as any).clientId &&
                clientsMap.has((job as any).clientId)
              ) {
                (jobWithClient as any).clientId = clientsMap.get(
                  (job as any).clientId
                );
              }
              return [job!.id, jobWithClient];
            })
        );
      } catch (error) {
        logger.warn("Failed to populate jobs with clients:", error);
      }
    }

    // Replace jobIds with populated job objects (first job only for display)
    const candidatesWithJobs = candidatesWithStage.map((candidate: any) => {
      if (candidate.jobIds && candidate.jobIds.length > 0) {
        const firstJobId = candidate.jobIds[0];
        if (jobsMap.has(firstJobId)) {
          // Replace first jobId with populated job object
          return {
            ...candidate,
            jobIds: [jobsMap.get(firstJobId), ...candidate.jobIds.slice(1)],
          };
        }
      }
      return candidate;
    });

    successResponse(
      res,
      {
        candidates: candidatesWithJobs,
        pagination,
      },
      "Candidates retrieved successfully"
    );
  }
);

/**
 * Get single candidate by ID
 */
export const getCandidateById = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const candidate = await candidateService.findById(id);

    if (!candidate) {
      throw new NotFoundError("Candidate not found");
    }

    // 🔒 RBAC: Users without canManageCandidates permission can only view candidates assigned to them
    const userRole = (req.user as any)?.role;
    const userId = (req.user as any)?.id;
    const userPermissions = (req.user as any)?.permissions;
    const canManageAllCandidates = userRole === "admin" || userPermissions?.canManageCandidates === true;

    if (!canManageAllCandidates && userId) {
      const assignedTo = (candidate as any).assignedTo;
      let isAssigned = false;

      if (typeof assignedTo === "string") {
        isAssigned = assignedTo === userId;
      } else if (assignedTo && typeof assignedTo === "object") {
        isAssigned = assignedTo.id === userId || assignedTo._id === userId;
      }

      if (!isAssigned) {
        throw new NotFoundError("Candidate not found");
      }
    }

    // Get the current pipeline stage name if available
    let currentStageInfo = null;
    // Check both currentPipelineStageId (new field) and currentStage (legacy field)
    const stageIdToLookup =
      (candidate as any).currentPipelineStageId ||
      (candidate as any).currentStage;

    if (stageIdToLookup) {
      const allPipelines = await pipelineService.find([]);
      const pipeline = allPipelines.find((p: any) =>
        p.stages?.some((s: any) => (s.id || s._id) === stageIdToLookup)
      );

      if (pipeline) {
        const stage = pipeline.stages.find(
          (s) => s.id === stageIdToLookup
        );
        if (stage) {
          currentStageInfo = {
            id: stage.id,
            name: stage.name,
            color: stage.color,
            order: stage.order,
          };
        }
      }

      // If stage not found in any pipeline, create fallback
      if (!currentStageInfo) {
        currentStageInfo = {
          id: stageIdToLookup,
          name: "Unknown Stage",
          color: "#6B7280",
          order: 0,
        };
      }
    }

    // Add currentStage to response
    const candidateData: any = { ...candidate };
    if (currentStageInfo) {
      candidateData.currentStage = currentStageInfo;
      candidateData.currentStageInfo = currentStageInfo;
    }

    successResponse(res, candidateData, "Candidate retrieved successfully");
  }
);

/**
 * Update candidate
 */
export const updateCandidate = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const updates: UpdateCandidateInput = req.body;

    const candidate = await candidateService.findById(id);

    if (!candidate) {
      throw new NotFoundError("Candidate not found");
    }

    // 🔒 RBAC: Users without canManageCandidates permission can only update candidates assigned to them
    const userRole = (req.user as any)?.role;
    const userId = (req.user as any)?.id;
    const userPermissions = (req.user as any)?.permissions;
    const canManageAllCandidates = userRole === "admin" || userPermissions?.canManageCandidates === true;

    if (!canManageAllCandidates && userId) {
      const assignedTo = (candidate as any).assignedTo;
      let isAssigned = false;

      if (typeof assignedTo === "string") {
        isAssigned = assignedTo === userId;
      } else if (assignedTo && typeof assignedTo === "object") {
        isAssigned = assignedTo.id === userId || assignedTo._id === userId;
      }

      if (!isAssigned) {
        throw new NotFoundError("Candidate not found");
      }
    }

    // Track if assignedTo is changing (accessing from req.body since it's not in the type)
    const oldAssignedTo = (candidate as any).assignedTo;
    const newAssignedTo = (req.body as any).assignedTo;
    const isAssignmentChanged =
      oldAssignedTo !== newAssignedTo && newAssignedTo !== undefined;

    // Handle rejection status update - update the specific job application
    if (
      (updates as any).status === "rejected" &&
      (req.body as any).rejectedJobId
    ) {
      const rejectedJobId = (req.body as any).rejectedJobId;
      const jobApplications = (candidate as any).jobApplications || [];

      // Find and update the specific job application
      const updatedJobApplications = jobApplications.map((app: any) => {
        if (
          app.jobId === rejectedJobId ||
          app.jobId?.toString() === rejectedJobId
        ) {
          return {
            ...app,
            status: "rejected",
            lastStatusChange: new Date(),
          };
        }
        return app;
      });

      (updates as any).jobApplications = updatedJobApplications;
      logger.info(
        `Updated job application status to rejected for job ${rejectedJobId}`
      );
    }

    // If currentPipelineStageId is being updated, update the SPECIFIC job's stage in jobApplications
    if ((updates as any).currentPipelineStageId) {
      const newStageId = (updates as any).currentPipelineStageId;
      const targetJobId = (req.body as any).jobId; // CRITICAL: Must specify which job's stage is being updated

      if (targetJobId) {
        try {
          // Find the pipeline for this specific job
          const pipeline = await pipelineService.findByJobId(targetJobId);
          if (pipeline && pipeline.stages) {
            const newStage = pipeline.stages.find(
              (s: any) => s.id === newStageId
            );
            if (newStage) {
              // Update the SPECIFIC job application's currentStage
              const jobApplications = (candidate as any).jobApplications || [];
              const updatedJobApplications = jobApplications.map((app: any) => {
                const appJobId = app.jobId?.id || app.jobId?._id || app.jobId;
                if (appJobId === targetJobId) {
                  return {
                    ...app,
                    currentStage: newStageId, // Store stage ID, not name (for consistency)
                    lastStatusChange: new Date(),
                  };
                }
                return app;
              });

              (updates as any).jobApplications = updatedJobApplications;
              logger.info(
                `Updated candidate stage to: ${newStage.name} for job ${targetJobId}`
              );
            }
          }
        } catch (error) {
          logger.warn("Failed to update jobApplications.currentStage:", error);
        }
      } else {
        logger.warn(
          "No jobId provided for stage update - cannot update job-specific stage"
        );
      }
    }

    // Check if email is being changed and if it creates a duplicate
    if (updates.email && updates.email !== candidate.email) {
      const existingCandidates = await candidateService.find([
        { field: "email", operator: "==", value: updates.email },
      ]);
      const existingCandidate = existingCandidates.find((c) => c.id !== id);

      if (existingCandidate) {
        throw new CustomValidationError(
          `Candidate already exists with email: ${updates.email}`
        );
      }
    }

    // Handle adding candidate to a new job
    if ((req.body as any).addToJob) {
      const newJobId = (req.body as any).addToJob;
      const existingJobIds = (candidate as any).jobIds || [];

      // Check if already assigned to this job
      if (!existingJobIds.includes(newJobId)) {
        // Get the pipeline for this job to get the first stage
        const pipeline = await pipelineService.findByJobId(newJobId);
        const firstStage = pipeline?.stages?.[0];

        // Add to jobIds array
        (updates as any).jobIds = [...existingJobIds, newJobId];

        // Add new jobApplication entry
        const existingJobApplications =
          (candidate as any).jobApplications || [];
        const newJobApplication = {
          jobId: newJobId,
          status: "active",
          appliedAt: new Date(),
          lastStatusChange: new Date(),
          currentStage: firstStage?.id || null, // Set to first stage of pipeline
          emailIds: [],
          emailsSent: 0,
          emailsReceived: 0,
        };

        (updates as any).jobApplications = [
          ...existingJobApplications,
          newJobApplication,
        ];
        logger.info(
          `Added candidate to new job ${newJobId}, initial stage: ${firstStage?.name}`
        );
      }
    }

    // Update candidate
    await candidateService.update(id, updates as any);

    // Fetch updated candidate
    let updatedCandidate = await candidateService.findById(id);

    // Populate job and client information (same logic as getCandidates)
    if (
      updatedCandidate &&
      (updatedCandidate as any).jobIds &&
      (updatedCandidate as any).jobIds.length > 0
    ) {
      try {
        const firstJobId = (updatedCandidate as any).jobIds[0];
        const job = await jobService.findById(firstJobId);

        if (job && (job as any).clientId) {
          const client = await clientService.findById((job as any).clientId);

          if (client) {
            // Populate client in job
            (job as any).clientId = {
              id: client.id,
              _id: client.id,
              companyName: (client as any).companyName,
              logo: (client as any).logo,
            };
          }

          // Replace first jobId with populated job object
          (updatedCandidate as any).jobIds = [
            job,
            ...(updatedCandidate as any).jobIds.slice(1),
          ];
        }
      } catch (error) {
        logger.warn(
          "Failed to populate job/client for updated candidate:",
          error
        );
      }
    }

    logger.info(`Candidate updated: ${updatedCandidate?.email}`);

    // Log activity
    if (req.user?.id && updatedCandidate) {
      const activityMetadata: any = {};

      // Track specific changes
      if (
        (updates as any).status &&
        (updates as any).status !== (candidate as any).status
      ) {
        activityMetadata.oldStatus = (candidate as any).status;
        activityMetadata.newStatus = (updates as any).status;

        // Log separate activity for status change
        logActivity({
          userId: req.user.id,
          action: "candidate_status_changed",
          resourceType: "candidate",
          resourceId: id,
          resourceName: `${updatedCandidate.firstName} ${updatedCandidate.lastName}`,
          metadata: activityMetadata,
        }).catch((err) => logger.error("Failed to log activity:", err));
      } else if ((updates as any).currentPipelineStageId) {
        // Log stage change
        logActivity({
          userId: req.user.id,
          action: "candidate_stage_changed",
          resourceType: "candidate",
          resourceId: id,
          resourceName: `${updatedCandidate.firstName} ${updatedCandidate.lastName}`,
          metadata: { stageId: (updates as any).currentPipelineStageId },
        }).catch((err) => logger.error("Failed to log activity:", err));
      } else {
        // General update
        logActivity({
          userId: req.user.id,
          action: "updated_candidate",
          resourceType: "candidate",
          resourceId: id,
          resourceName: `${updatedCandidate.firstName} ${updatedCandidate.lastName}`,
        }).catch((err) => logger.error("Failed to log activity:", err));
      }
    }

    // Send assignment notification email if assignedTo changed
    if (isAssignmentChanged && newAssignedTo) {
      try {
        const assignedUser = await userService.findById(newAssignedTo);
        if (assignedUser && assignedUser.email) {
          const assignerName = req.user
            ? `${req.user.firstName} ${req.user.lastName}`
            : "Administrator";
          const candidateName = `${candidate.firstName} ${candidate.lastName}`;

          // Get job title if available
          const job =
            candidate.jobIds && candidate.jobIds.length > 0
              ? await jobService.findById(candidate.jobIds[0])
              : null;
          const entityName = job
            ? `Candidate: ${candidateName} (${job.title})`
            : `Candidate: ${candidateName}`;

          await sendAssignmentEmail(
            assignedUser.email,
            assignedUser.firstName,
            "candidate",
            entityName,
            assignerName
          );
          logger.info(
            `Candidate assignment notification email sent to ${assignedUser.email}`
          );
        }

        // Log assignment activity
        if (req.user?.id && updatedCandidate) {
          logActivity({
            userId: req.user.id,
            action: "candidate_assigned",
            resourceType: "candidate",
            resourceId: id,
            resourceName: `${updatedCandidate.firstName} ${updatedCandidate.lastName}`,
            metadata: {
              assignedTo: newAssignedTo,
              assignedToName: `${assignedUser?.firstName} ${assignedUser?.lastName}`,
            },
          }).catch((err) => logger.error("Failed to log activity:", err));
        }
      } catch (emailError) {
        // Log error but don't fail the request
        logger.error(`Failed to send candidate assignment email:`, emailError);
      }
    }

    successResponse(res, updatedCandidate, "Candidate updated successfully");
  }
);

/**
 * Delete candidate
 */
export const deleteCandidate = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const candidate = await candidateService.findById(id);

    if (!candidate) {
      throw new NotFoundError("Candidate not found");
    }

    // 🔒 RBAC: Users without canManageCandidates permission can only delete candidates assigned to them
    const userRole = (req.user as any)?.role;
    const userId = (req.user as any)?.id;
    const userPermissions = (req.user as any)?.permissions;
    const canManageAllCandidates = userRole === "admin" || userPermissions?.canManageCandidates === true;

    if (!canManageAllCandidates && userId) {
      const assignedTo = (candidate as any).assignedTo;
      let isAssigned = false;

      if (typeof assignedTo === "string") {
        isAssigned = assignedTo === userId;
      } else if (assignedTo && typeof assignedTo === "object") {
        isAssigned = assignedTo.id === userId || assignedTo._id === userId;
      }

      if (!isAssigned) {
        throw new NotFoundError("Candidate not found");
      }
    }

    // Check if candidate has any team members assigned
    if (
      (candidate as any).assignedTeamMembers &&
      (candidate as any).assignedTeamMembers.length > 0
    ) {
      throw new CustomValidationError(
        `Cannot delete candidate with ${(candidate as any).assignedTeamMembers.length} assigned team member${(candidate as any).assignedTeamMembers.length > 1 ? "s" : ""}. Please unassign all team members first.`
      );
    }

    // Check if candidate is hired (might want to prevent deletion)
    if (candidate.status === "hired") {
      throw new CustomValidationError(
        "Cannot delete a hired candidate. Please change status first."
      );
    }

    await candidateService.delete(id);

    logger.info(`Candidate deleted: ${candidate.email}`);

    successResponse(res, null, "Candidate deleted successfully");
  }
);

/**
 * Move candidate to different pipeline stage
 */
export const moveCandidateStage = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { newStage, notes }: MoveCandidateStageInput = req.body;

    const candidate = await candidateService.findById(id);

    if (!candidate) {
      throw new NotFoundError("Candidate not found");
    }

    // Update stage - newStage is the stage ID
    const updateData: any = { currentPipelineStageId: newStage };
    if (notes) {
      const existingNotes = (candidate as any).notes || "";
      updateData.notes = existingNotes ? `${existingNotes}\n\n${notes}` : notes;
    }
    await candidateService.update(id, updateData);

    // Fetch updated candidate
    const updatedCandidate = await candidateService.findById(id);

    logger.info(`Candidate ${candidate.email} moved to stage: ${newStage}`);

    // Log activity
    if (req.user?.id && updatedCandidate) {
      logActivity({
        userId: req.user.id,
        action: "candidate_stage_changed",
        resourceType: "candidate",
        resourceId: id,
        resourceName: `${updatedCandidate.firstName} ${updatedCandidate.lastName}`,
        metadata: {
          stageId: newStage,
          notes: notes ? "Added notes" : undefined,
        },
      }).catch((err) => logger.error("Failed to log activity:", err));
    }

    successResponse(
      res,
      updatedCandidate,
      "Candidate stage updated successfully"
    );
  }
);

/**
 * Re-score candidate against a job
 */
export const rescoreCandidate = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { jobId }: RescoreCandidateInput = req.body;

    const candidate = await candidateService.findById(id);

    if (!candidate) {
      throw new NotFoundError("Candidate not found");
    }

    // Verify job exists
    const job = await jobService.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job not found");
    }

    logger.info(
      `Re-scoring candidate: ${candidate.email} against job ${job.title}`
    );

    // Get parsed data from application if available
    let parsedData: any = {
      summary: "",
      skills: [],
      experience: [],
      education: [],
      certifications: [],
      languages: [],
      extractedText: "",
    };

    // Note: In Firestore, applicationId is now applicationIds array
    // For scoring, we'll need to implement application fetching if needed
    // For now, we'll use empty parsed data or fetch from application service if available

    // Perform AI scoring
    const aiScore = await openaiService.scoreCandidate(
      parsedData,
      job.description || "",
      job.requirements || []
    );

    // Update candidate with new score including the additional fields
    await candidateService.update(id, {
      aiScore: {
        ...aiScore,
        scoredForJobId: jobId,
        scoredAt: new Date(),
      },
    } as any);

    // Fetch updated candidate
    const updatedCandidate = await candidateService.findById(id);

    logger.info(
      `Candidate re-scored: ${candidate.email} with score: ${aiScore.overallScore}`
    );

    successResponse(res, updatedCandidate, "Candidate re-scored successfully");
  }
);

/**
 * Bulk move candidates to new stage
 */
export const bulkMoveCandidates = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { candidateIds, newStage, notes }: BulkMoveCandidatesInput = req.body;

    // Validate all IDs (simple string validation for Firestore)
    const validIds = candidateIds.filter(
      (id) => typeof id === "string" && id.length > 0
    );
    if (validIds.length !== candidateIds.length) {
      throw new CustomValidationError("Some candidate IDs are invalid");
    }

    // Update each candidate individually (Firestore doesn't have updateMany)
    let modifiedCount = 0;
    for (const candidateId of validIds) {
      try {
        const updateData: any = { currentPipelineStageId: newStage };
        if (notes) {
          const candidate = await candidateService.findById(candidateId);
          if (candidate) {
            const existingNotes = (candidate as any).notes || "";
            updateData.notes = existingNotes
              ? `${existingNotes}\n${notes}`
              : notes;
          }
        }
        await candidateService.update(candidateId, updateData);
        modifiedCount++;
      } catch (error) {
        logger.error(`Failed to update candidate ${candidateId}:`, error);
      }
    }

    logger.info(`Bulk moved ${modifiedCount} candidates to stage: ${newStage}`);

    successResponse(
      res,
      {
        modifiedCount,
        newStage,
      },
      `Successfully moved ${modifiedCount} candidates`
    );
  }
);

/**
 * Add candidates to a pipeline (assign to first stage)
 * Used when adding candidates from pipeline page
 */
export const addCandidatesToPipeline = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { candidateIds, pipelineId, jobId } = req.body;

    // Validate inputs
    if (
      !candidateIds ||
      !Array.isArray(candidateIds) ||
      candidateIds.length === 0
    ) {
      throw new CustomValidationError("candidateIds must be a non-empty array");
    }

    if (!pipelineId) {
      throw new CustomValidationError("pipelineId is required");
    }

    // Validate all candidate IDs (simple string validation)
    const validIds = candidateIds.filter(
      (id) => typeof id === "string" && id.length > 0
    );
    if (validIds.length !== candidateIds.length) {
      throw new CustomValidationError("Some candidate IDs are invalid");
    }

    // Get the pipeline and its first stage
    const pipeline = await pipelineService.findById(pipelineId);

    if (!pipeline) {
      throw new NotFoundError("Pipeline not found");
    }

    if (!pipeline.stages || pipeline.stages.length === 0) {
      throw new CustomValidationError("Pipeline has no stages defined");
    }

    // Get the first stage (sorted by order)
    const sortedStages = pipeline.stages.sort(
      (a: any, b: any) => a.order - b.order
    );
    const firstStage = sortedStages[0];

    logger.info(
      `Adding ${validIds.length} candidates to pipeline ${pipeline.name}, first stage: ${firstStage.name}`
    );

    // If jobId is provided, verify candidates belong to this job
    if (jobId) {
      const candidatesToUpdate = await candidateService.findByJobId(jobId);
      const validCandidateIds = candidatesToUpdate.map((c) => c.id);
      const invalidIds = validIds.filter(
        (id) => !validCandidateIds.includes(id)
      );

      if (invalidIds.length > 0) {
        throw new CustomValidationError(
          "Some candidates do not belong to the specified job"
        );
      }
    }

    // Update candidates - assign to first stage
    let modifiedCount = 0;
    for (const candidateId of validIds) {
      try {
        await candidateService.update(candidateId, {
          currentStage: firstStage.id,
          updatedBy: (req as any).user?.id,
        } as any);
        modifiedCount++;
      } catch (error) {
        logger.error(`Failed to update candidate ${candidateId}:`, error);
      }
    }

    logger.info(
      `Successfully added ${modifiedCount} candidates to pipeline ${pipeline.name}`
    );

    successResponse(
      res,
      {
        modifiedCount,
        pipelineId,
        stageName: firstStage.name,
        stageId: firstStage.id,
      },
      `Successfully added ${modifiedCount} candidates to pipeline`
    );
  }
);

/**
 * Get candidates for a job that are not in any pipeline
 * Used for the "Add to Pipeline" modal
 */
export const getCandidatesWithoutPipeline = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.query;

    if (!jobId) {
      throw new CustomValidationError("jobId is required");
    }

    // Find candidates for this job that have no pipeline stage assigned
    let allCandidates = await candidateService.findByJobId(jobId as string);

    // 🔒 RBAC: Users without canManageCandidates permission can only see candidates assigned to them
    const userRole = (req.user as any)?.role;
    const userId = (req.user as any)?.id;
    const userPermissions = (req.user as any)?.permissions;
    const canManageAllCandidates = userRole === "admin" || userPermissions?.canManageCandidates === true;

    if (!canManageAllCandidates && userId) {
      allCandidates = allCandidates.filter((c: any) => {
        const assignedTo = c.assignedTo;
        if (typeof assignedTo === "string") {
          return assignedTo === userId;
        } else if (assignedTo && typeof assignedTo === "object") {
          return assignedTo.id === userId || assignedTo._id === userId;
        }
        return false;
      });
    }

    const candidates = allCandidates.filter(
      (c: any) => !c.currentPipelineStageId || c.currentPipelineStageId === null
    );

    logger.info(
      `Found ${candidates.length} candidates without pipeline for job ${jobId}`
    );

    successResponse(
      res,
      candidates,
      `Found ${candidates.length} candidates without pipeline assignment`
    );
  }
);

/**
 * Get candidate statistics
 */
export const getCandidateStats = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.query;

    // Fetch all candidates
    let allCandidates = await candidateService.find([]);

    // 🔒 RBAC: Users without canManageCandidates permission can only see stats for candidates assigned to them
    const userRole = (req.user as any)?.role;
    const userId = (req.user as any)?.id;
    const userPermissions = (req.user as any)?.permissions;
    const canManageAllCandidates = userRole === "admin" || userPermissions?.canManageCandidates === true;

    if (!canManageAllCandidates && userId) {
      allCandidates = allCandidates.filter((c: any) => {
        const assignedTo = c.assignedTo;
        if (typeof assignedTo === "string") {
          return assignedTo === userId;
        } else if (assignedTo && typeof assignedTo === "object") {
          return assignedTo.id === userId || assignedTo._id === userId;
        }
        return false;
      });
    }

    // Filter by job if specified
    if (jobId) {
      allCandidates = allCandidates.filter((c: any) =>
        c.jobIds.includes(jobId)
      );
    }

    // Calculate statistics in memory
    const byStatus: any = {};
    const byStage: any = {};
    const scores: number[] = [];
    const skillsMatches: number[] = [];
    const experienceMatches: number[] = [];
    const educationMatches: number[] = [];

    allCandidates.forEach((candidate: any) => {
      // Count by status
      byStatus[candidate.status] = (byStatus[candidate.status] || 0) + 1;

      // Count by stage
      const stageId = candidate.currentPipelineStageId || "null";
      byStage[stageId] = (byStage[stageId] || 0) + 1;

      // Collect scores
      if (candidate.aiScore) {
        if (candidate.aiScore.overallScore !== undefined) {
          scores.push(candidate.aiScore.overallScore);
        }
        if (candidate.aiScore.skillsMatch !== undefined) {
          skillsMatches.push(candidate.aiScore.skillsMatch);
        }
        if (candidate.aiScore.experienceMatch !== undefined) {
          experienceMatches.push(candidate.aiScore.experienceMatch);
        }
        if (candidate.aiScore.educationMatch !== undefined) {
          educationMatches.push(candidate.aiScore.educationMatch);
        }
      }
    });

    // Calculate averages
    const avgOverallScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const avgSkillsMatch =
      skillsMatches.length > 0
        ? skillsMatches.reduce((a, b) => a + b, 0) / skillsMatches.length
        : 0;
    const avgExperienceMatch =
      experienceMatches.length > 0
        ? experienceMatches.reduce((a, b) => a + b, 0) /
          experienceMatches.length
        : 0;
    const avgEducationMatch =
      educationMatches.length > 0
        ? educationMatches.reduce((a, b) => a + b, 0) / educationMatches.length
        : 0;

    const result = {
      total: allCandidates.length,
      byStatus,
      byStage,
      averageScores: {
        avgOverallScore,
        avgSkillsMatch,
        avgExperienceMatch,
        avgEducationMatch,
      },
    };

    successResponse(res, result, "Candidate statistics retrieved successfully");
  }
);

/**
 * Get top candidates by AI score
 */
export const getTopCandidates = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { jobId, limit = "10" } = req.query;

    // Fetch all candidates
    let allCandidates = await candidateService.find([]);

    // Filter by status
    allCandidates = allCandidates.filter((c: any) => c.status === "active");

    // Filter by job if specified
    if (jobId) {
      allCandidates = allCandidates.filter((c: any) =>
        c.jobIds.includes(jobId)
      );
    }

    // Sort by AI score (descending)
    allCandidates.sort((a: any, b: any) => {
      const scoreA = a.aiScore?.overallScore || 0;
      const scoreB = b.aiScore?.overallScore || 0;
      return scoreB - scoreA;
    });

    // Limit results
    const candidates = allCandidates.slice(0, parseInt(limit as string, 10));

    successResponse(res, candidates, "Top candidates retrieved successfully");
  }
);

/**
 * Get dashboard analytics
 * Returns candidate applications grouped by date for chart
 */
export const getDashboardAnalytics = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { days = "90" } = req.query;
    const daysNum = parseInt(days as string, 10);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);

    // Fetch all candidates within date range
    const allCandidates = await candidateService.find([]);
    const filteredCandidates = allCandidates.filter((c: any) => {
      const createdAt =
        c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt);
      return createdAt >= startDate && createdAt <= endDate;
    });

    // Group by date and source
    const groupedData: Map<string, any> = new Map();

    filteredCandidates.forEach((candidate: any) => {
      const createdAt =
        candidate.createdAt instanceof Date
          ? candidate.createdAt
          : new Date(candidate.createdAt);
      const dateStr = createdAt.toISOString().split("T")[0]; // YYYY-MM-DD format
      const source = (candidate as any).source || "unknown";

      if (!groupedData.has(dateStr)) {
        groupedData.set(dateStr, {
          date: dateStr,
          applications: 0,
          directSubmissions: 0,
          manualImports: 0,
          emailApplications: 0,
        });
      }

      const dateData = groupedData.get(dateStr);
      dateData.applications++;

      if (source === "direct_submission") {
        dateData.directSubmissions++;
      } else if (source === "manual_import") {
        dateData.manualImports++;
      } else if (source === "email" || source === "email_application") {
        dateData.emailApplications++;
      }
    });

    // Convert map to array and sort by date
    const analytics = Array.from(groupedData.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    successResponse(
      res,
      analytics,
      "Dashboard analytics retrieved successfully"
    );
  }
);
