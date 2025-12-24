import { Request, Response } from "express";
import { logActivity } from "../services/activity.service";
import cloudinaryService from "../services/cloudinary.service";
import {
  applicationService,
  candidateService,
  IApplication,
  jobService,
  pipelineService,
  userService,
} from "../services/firestore";
import openaiService from "../services/openai.service";
import resendService from "../services/resend.service";
import {
  ApproveApplicationInput,
  BulkUpdateStatusInput,
  CreateApplicationInput,
  ListApplicationsQuery,
  UpdateApplicationInput,
} from "../types/application.types";
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
 * Transform application for frontend compatibility
 * Maps backend field names to frontend expected names
 */
const transformApplication = (app: IApplication & { id: string }) => {
  return {
    ...app,
    targetJobId: app.jobId || null,
    targetClientId: app.clientId || null,
    submittedAt: app.appliedAt || app.createdAt,
    lastUpdated: app.updatedAt,
    // Transform AI validation fields to frontend format
    aiAnalysis: {
      isValid: app.isValidResume ?? false, // Use AI validation result, default to false if not validated
      summary:
        app.validationReason ||
        app.parsedData?.summary ||
        "No AI analysis available",
    },
  };
};

/**
 * Create new application
 *
 * WORKFLOW:
 * 1. Application Stage (this endpoint):
 *    - Requires: firstName, lastName, email, resumeUrl, resumeOriginalName
 *    - Optional: jobId (if mentioned in email), phone, parsedData, resumeRawText, videoIntroUrl
 *    - Status: 'pending' (awaiting review)
 *    - NOT required: clientId (will be auto-fetched from job during approval)
 *
 * 2. Approval Stage (approveApplication endpoint):
 *    - Recruiter reviews application
 *    - Assigns jobId (if not already provided)
 *    - System automatically fetches clientId from the job
 *    - Creates Candidate with job application record
 *    - Status changes to 'approved'
 *
 * Supports all three submission methods: manual, direct_apply, email_automation
 */
export const createApplication = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data: CreateApplicationInput = req.body;

    let job = null;

    // Verify job exists if provided
    if (data.jobId) {
      job = await jobService.findById(data.jobId);

      if (!job) {
        throw new NotFoundError("Job not found");
      }

      // Set clientId from job if not provided
      if (!data.clientId && job.clientId) {
        data.clientId = job.clientId;
      }
    }

    // Check for duplicate application (including unassigned with jobId: null)
    const existingApplications = await applicationService.findByEmail(
      data.email
    );
    const existingApplication = existingApplications.find(
      (app) =>
        (data.jobId && app.jobId === data.jobId) || (!data.jobId && !app.jobId)
    );

    if (existingApplication) {
      if (data.jobId) {
        throw new CustomValidationError(
          `Application already exists for this job with email: ${data.email}`
        );
      } else {
        throw new CustomValidationError(
          `Unassigned application already exists for email: ${data.email}. Please assign a job or delete the existing application first.`
        );
      }
    } // If email_automation source, verify sourceEmailAccountId is provided
    if (data.source === "email_automation" && !data.sourceEmailAccountId) {
      throw new CustomValidationError(
        "sourceEmailAccountId is required for email_automation source"
      );
    }

    // AI Resume Validation (if resume text is provided)
    let validationResult = null;
    if (data.resumeRawText && data.resumeRawText.trim().length > 0) {
      try {
        logger.info("Running AI validation on resume...");
        validationResult = await openaiService.validateResume(
          data.resumeRawText
        );

        // Add validation results to data
        data.isValidResume = validationResult.isValid;
        data.validationScore = validationResult.score;
        data.validationReason = validationResult.reason;

        logger.info(
          `Resume validation: ${validationResult.isValid ? "VALID" : "INVALID"} ` +
            `(score: ${validationResult.score}/100) - ${validationResult.reason}`
        );
      } catch (error: any) {
        logger.error("Resume validation failed:", error);
        // Don't block application creation if validation fails
        // Set to null to indicate validation couldn't be performed
        data.isValidResume = null;
        data.validationScore = null;
        data.validationReason = "Validation service unavailable";
      }
    } else {
      logger.warn("No resume text provided for validation");
    }

    // Prepare application data with additional fields
    const applicationData: any = { ...data };

    // Set default status if not provided
    if (!applicationData.status) {
      applicationData.status = "pending";
    }

    // Set appliedAt timestamp if not provided
    if (!applicationData.appliedAt) {
      applicationData.appliedAt = new Date();
    }

    // Calculate years of experience from parsed data
    if (
      data.parsedData?.experience &&
      Array.isArray(data.parsedData.experience)
    ) {
      let totalMonths = 0;

      data.parsedData.experience.forEach((exp: any) => {
        const duration = exp.duration || "";

        // Try to extract years from text like "2 years", "3+ years"
        const yearMatch = duration.match(/(\d+)\+?\s*years?/i);
        if (yearMatch) {
          totalMonths += parseInt(yearMatch[1]) * 12;
          return;
        }

        // Try to parse date ranges like "July 2023 - October 2025"
        const dateRangeMatch = duration.match(
          /([a-z]+)\s+(\d{4})\s*[-–—]\s*([a-z]+)?\s*(\d{4}|present|current)/i
        );
        if (dateRangeMatch) {
          const [, startMonth, startYear, endMonth, endYear] = dateRangeMatch;

          const monthMap: Record<string, number> = {
            jan: 0,
            january: 0,
            feb: 1,
            february: 1,
            mar: 2,
            march: 2,
            apr: 3,
            april: 3,
            may: 4,
            jun: 5,
            june: 5,
            jul: 6,
            july: 6,
            aug: 7,
            august: 7,
            sep: 8,
            sept: 8,
            september: 8,
            oct: 9,
            october: 9,
            nov: 10,
            november: 10,
            dec: 11,
            december: 11,
          };

          const startMonthNum = monthMap[startMonth.toLowerCase()] ?? 0;
          const startYearNum = parseInt(startYear);

          let endMonthNum: number;
          let endYearNum: number;

          if (
            endYear.toLowerCase() === "present" ||
            endYear.toLowerCase() === "current"
          ) {
            const now = new Date();
            endMonthNum = now.getMonth();
            endYearNum = now.getFullYear();
          } else {
            endMonthNum = endMonth
              ? (monthMap[endMonth.toLowerCase()] ?? 11)
              : 11;
            endYearNum = parseInt(endYear);
          }

          const months =
            (endYearNum - startYearNum) * 12 + (endMonthNum - startMonthNum);
          totalMonths += Math.max(0, months);
          return;
        }

        // If contains "present" or "current", assume at least 1 year
        if (
          duration.toLowerCase().includes("present") ||
          duration.toLowerCase().includes("current")
        ) {
          totalMonths += 12;
        }
      });

      const years = Math.round(totalMonths / 12);
      if (years > 0) {
        applicationData.yearsOfExperience = years;
        logger.info(`Calculated years of experience: ${years} years`);
      }
    }

    // Create application
    const applicationId = await applicationService.create(applicationData);
    const application = await applicationService.findById(applicationId);

    if (!application) {
      throw new Error("Failed to create application");
    }

    const jobInfo = job ? `for job ${job.title}` : "without job assignment";
    logger.info(
      `Application created: ${application.email} ${jobInfo} via ${data.source}`
    );

    // Send confirmation email to applicant (fire-and-forget)
    if (data.source === 'direct_apply' && job) {
      const candidateName = `${application.firstName} ${application.lastName}`;
      resendService.sendApplicationConfirmation(
        application.email,
        candidateName,
        job.title,
        { applicationId, jobId: data.jobId }
      ).then(() => {
        logger.info(`Confirmation email sent to ${application.email}`);
      }).catch((err) => {
        logger.error(`Failed to send confirmation email to ${application.email}:`, err);
      });
    }

    // Log activity
    if (req.user?.id) {
      logActivity({
        userId: req.user.id,
        action: "created_application",
        resourceType: "application",
        resourceId: applicationId,
        resourceName: `${application.firstName} ${application.lastName}`,
        metadata: {
          email: application.email,
          source: data.source,
          jobId: data.jobId,
          jobTitle: job?.title,
        },
      }).catch((err) => logger.error("Failed to log activity:", err));
    }

    successResponse(
      res,
      transformApplication(application as any),
      "Application created successfully",
      201
    );
  }
);

/**
 * Get all applications with filters and pagination
 */
export const getApplications = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      page = 1,
      limit = 10,
      jobId,
      clientId,
      status,
      source,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as any as ListApplicationsQuery;

    // Fetch all applications (Firestore doesn't support complex queries)
    let allApplications = await applicationService.find([]);

    // Apply filters in memory
    if (jobId) {
      allApplications = allApplications.filter(
        (app: any) => app.jobId === jobId
      );
    }
    if (clientId) {
      allApplications = allApplications.filter(
        (app: any) => app.clientId === clientId
      );
    }
    if (status) {
      allApplications = allApplications.filter(
        (app: any) => app.status === status
      );
    }
    if (source) {
      allApplications = allApplications.filter(
        (app: any) => app.source === source
      );
    }
    if (search) {
      const searchLower = search.toLowerCase();
      allApplications = allApplications.filter(
        (app: any) =>
          app.firstName?.toLowerCase().includes(searchLower) ||
          app.lastName?.toLowerCase().includes(searchLower) ||
          app.email?.toLowerCase().includes(searchLower)
      );
    }

    // Get total count after filtering
    const totalCount = allApplications.length;

    // Calculate pagination
    const pagination = paginateResults(totalCount, {
      page,
      limit,
      sort: sortBy,
      order: sortOrder,
    });

    // Sort applications
    allApplications.sort((a: any, b: any) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      const multiplier = sortOrder === "asc" ? 1 : -1;
      if (aValue < bValue) return -1 * multiplier;
      if (aValue > bValue) return 1 * multiplier;
      return 0;
    });

    // Apply pagination
    const skip = (page - 1) * limit;
    const applications = allApplications.slice(skip, skip + limit);

    // Populate reviewedBy user information
    const reviewerIds = applications
      .map((app: any) => app.reviewedBy)
      .filter((id: any) => id && typeof id === "string");

    const uniqueReviewerIds = [...new Set(reviewerIds)];

    let reviewersMap = new Map();
    if (uniqueReviewerIds.length > 0) {
      try {
        const reviewers = await Promise.all(
          uniqueReviewerIds.map((id) => userService.findById(id as string))
        );
        reviewersMap = new Map(
          reviewers
            .filter((reviewer) => reviewer !== null)
            .map((reviewer) => [
              reviewer!.id,
              {
                id: reviewer!.id,
                _id: reviewer!.id,
                firstName: (reviewer as any).firstName,
                lastName: (reviewer as any).lastName,
                email: reviewer!.email,
              },
            ])
        );
      } catch (error) {
        logger.warn("Failed to populate reviewers:", error);
      }
    }

    // Replace reviewedBy ID with populated user object
    const populatedApplications = applications.map((app: any) => {
      if (app.reviewedBy && reviewersMap.has(app.reviewedBy)) {
        return {
          ...app,
          reviewedBy: reviewersMap.get(app.reviewedBy),
        };
      }
      return app;
    });

    successResponse(
      res,
      {
        applications: populatedApplications.map(transformApplication),
        pagination,
      },
      "Applications retrieved successfully"
    );
  }
);

/**
 * Get single application by ID
 */
export const getApplicationById = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const application = await applicationService.findById(id);

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    successResponse(
      res,
      transformApplication(application as any),
      "Application retrieved successfully"
    );
  }
);

/**
 * Update application
 */
export const updateApplication = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const updates: UpdateApplicationInput = req.body;

    const application = await applicationService.findById(id);

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Check if email is being changed and if it creates a duplicate
    if (updates.email && updates.email !== application.email) {
      const allApplications = await applicationService.find([]);
      const existingApplication = allApplications.find(
        (app) =>
          app.jobId === application.jobId &&
          app.email === updates.email &&
          app.id !== id
      );

      if (existingApplication) {
        throw new CustomValidationError(
          `Application already exists for this job with email: ${updates.email}`
        );
      }
    }

    // Build update data
    const updateData: any = { ...updates };

    // If status is being changed to approved or rejected, set reviewedBy to current user
    if (
      updates.status &&
      ["approved", "rejected"].includes(updates.status.toLowerCase())
    ) {
      if ((req as any).user && (req as any).user.id) {
        updateData.reviewedBy = (req as any).user.id;
      }
    }

    // If status is being changed to rejected, delete application and associated files
    if (updates.status && updates.status.toLowerCase() === "rejected") {
      // Delete resume from Cloudinary if exists
      if (application.resumeUrl) {
        try {
          const publicId = application.resumeUrl.split('/').slice(-2).join('/').split('.')[0];
          await cloudinaryService.deleteFile(publicId, 'raw');
          logger.info(`Deleted resume from Cloudinary: ${publicId}`);
        } catch (error) {
          logger.error('Failed to delete resume from Cloudinary:', error);
        }
      }

      // Delete video from Cloudinary if exists
      if ((application as any).videoIntroUrl) {
        try {
          const videoUrl = (application as any).videoIntroUrl;
          // Only delete if it's a Cloudinary URL (not external link)
          if (videoUrl.includes('cloudinary.com')) {
            const publicId = videoUrl.split('/').slice(-2).join('/').split('.')[0];
            await cloudinaryService.deleteFile(publicId, 'raw');
            logger.info(`Deleted video from Cloudinary: ${publicId}`);
          }
        } catch (error) {
          logger.error('Failed to delete video from Cloudinary:', error);
        }
      }

      // Delete application from Firestore
      await applicationService.delete(id);
      logger.info(`Deleted rejected application: ${application.email}`);

      // Log activity
      if (req.user?.id) {
        logActivity({
          userId: req.user.id,
          action: "application_rejected_and_deleted",
          resourceType: "application",
          resourceId: id,
          resourceName: `${application.firstName} ${application.lastName}`,
          metadata: {
            email: application.email,
            deletedFiles: {
              resume: !!application.resumeUrl,
              video: !!(application as any).videoIntroUrl,
            },
          },
        }).catch((err) => logger.error("Failed to log activity:", err));
      }

      successResponse(res, { deleted: true }, "Application rejected and deleted successfully");
      return;
    }

    await applicationService.update(id, updateData);

    // Fetch updated application
    const updatedApplication = await applicationService.findById(id);

    logger.info(`Application updated: ${application.email}`);

    // Log activity
    if (req.user?.id && updatedApplication) {
      // Check for status changes
      if (updates.status && updates.status !== application.status) {
        const statusActionMap: Record<string, string> = {
          approved: "application_approved",
          rejected: "application_rejected",
        };

        const action =
          statusActionMap[updates.status.toLowerCase()] ||
          "application_status_changed";

        logActivity({
          userId: req.user.id,
          action: action,
          resourceType: "application",
          resourceId: id,
          resourceName: `${updatedApplication.firstName} ${updatedApplication.lastName}`,
          metadata: {
            email: updatedApplication.email,
            oldStatus: application.status,
            newStatus: updates.status,
          },
        }).catch((err) => logger.error("Failed to log activity:", err));
      } else {
        // General update
        logActivity({
          userId: req.user.id,
          action: "updated_application",
          resourceType: "application",
          resourceId: id,
          resourceName: `${updatedApplication.firstName} ${updatedApplication.lastName}`,
        }).catch((err) => logger.error("Failed to log activity:", err));
      }
    }

    successResponse(
      res,
      transformApplication(updatedApplication as any),
      "Application updated successfully"
    );
  }
);

/**
 * Delete application (soft delete)
 */
export const deleteApplication = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const application = await applicationService.findById(id);

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Check if application has been approved (converted to candidate)
    const allCandidates = await candidateService.find([]);
    const existingCandidate = allCandidates.find((c: any) =>
      c.applicationIds?.includes(id)
    );
    if (existingCandidate) {
      throw new CustomValidationError(
        "Cannot delete application that has been approved as candidate"
      );
    }

    // Delete resume from Cloudinary if exists
    if (application.resumeUrl) {
      try {
        // Extract public ID from Cloudinary URL
        // URL format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/{version}/{public_id}.{format}
        const urlParts = application.resumeUrl.split("/");
        const uploadIndex = urlParts.indexOf("upload");
        if (uploadIndex !== -1 && urlParts.length > uploadIndex + 1) {
          // Get everything after 'upload/' and before the file extension
          const publicIdWithExtension = urlParts
            .slice(uploadIndex + 2)
            .join("/");
          const publicId = publicIdWithExtension.split(".")[0];

          await cloudinaryService.deleteFile(publicId, "raw");
          logger.info(`Deleted resume from Cloudinary: ${publicId}`);
        }
      } catch (error) {
        logger.error("Error deleting resume from Cloudinary:", error);
        // Continue with application deletion even if Cloudinary deletion fails
      }
    }

    // Delete additional documents from Cloudinary if exists
    if (
      (application as any).additionalDocuments &&
      (application as any).additionalDocuments.length > 0
    ) {
      for (const doc of (application as any).additionalDocuments) {
        if (doc.url) {
          try {
            const urlParts = doc.url.split("/");
            const uploadIndex = urlParts.indexOf("upload");
            if (uploadIndex !== -1 && urlParts.length > uploadIndex + 1) {
              const publicIdWithExtension = urlParts
                .slice(uploadIndex + 2)
                .join("/");
              const publicId = publicIdWithExtension.split(".")[0];

              await cloudinaryService.deleteFile(publicId, "raw");
              logger.info(`Deleted document from Cloudinary: ${publicId}`);
            }
          } catch (error) {
            logger.error("Error deleting document from Cloudinary:", error);
            // Continue with deletion
          }
        }
      }
    }

    // Delete application from database
    await applicationService.delete(id);

    logger.info(`Application deleted: ${application.email}`);

    successResponse(res, null, "Application deleted successfully");
  }
);

/**
 * Approve application and create candidate with AI scoring
 */
export const approveApplication = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { jobId, assignToPipeline, notes }: ApproveApplicationInput =
      req.body;

    const application = await applicationService.findById(id);

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    // Check if already approved (check if candidate exists)
    const allCandidates = await candidateService.find([]);
    const existingCandidate = allCandidates.find((c: any) =>
      c.applicationIds?.includes(id)
    );
    if (existingCandidate) {
      throw new CustomValidationError("Application has already been approved");
    }

    // Verify job exists
    const job = await jobService.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job not found for scoring");
    }

    logger.info(
      `Approving application: ${application.email} for job ${job.title}`
    );

    // Get pipeline (use provided or job's default)
    let pipeline: any = null;

    if (assignToPipeline) {
      pipeline = await pipelineService.findById(assignToPipeline);
      if (!pipeline) {
        throw new NotFoundError("Pipeline not found");
      }
      logger.info(
        `Using provided pipeline: ${pipeline.name} (ID: ${pipeline.id})`
      );
    } else if (job.pipelineId) {
      pipeline = await pipelineService.findById(job.pipelineId);
      logger.info(
        `Job has pipeline: ${pipeline ? pipeline.name : "NOT FOUND"} (ID: ${job.pipelineId})`
      );
    } else {
      logger.info(
        `Job has NO pipeline assigned (job.pipelineId is null/undefined)`
      );
    }

    // Debug: Log pipeline details
    if (pipeline) {
      // Convert stages from object to array if needed (Firestore serialization issue)
      if (
        pipeline.stages &&
        !Array.isArray(pipeline.stages) &&
        typeof pipeline.stages === "object"
      ) {
        pipeline.stages = Object.values(pipeline.stages);
      }

      console.log("=== PIPELINE DEBUG ===");
      console.log("Pipeline ID:", pipeline.id);
      console.log("Pipeline Name:", pipeline.name);
      console.log("Has stages:", !!pipeline.stages);
      console.log("Stages is array:", Array.isArray(pipeline.stages));
      console.log("Stages count:", pipeline.stages?.length || 0);
      if (pipeline.stages && pipeline.stages.length > 0) {
        console.log(
          "First stage:",
          JSON.stringify({
            id: pipeline.stages[0].id,
            name: pipeline.stages[0].name,
            order: pipeline.stages[0].order,
          })
        );
      }
      console.log("======================");
    }

    // Perform AI scoring
    logger.info(`Scoring candidate against job requirements...`);

    // Prepare parsed data for scoring with array conversions
    const rawParsedData = (application as any).parsedData || {};

    // Helper function to ensure array format
    const ensureArray = (data: any): any[] => {
      if (!data) return [];
      if (Array.isArray(data)) return data;
      if (typeof data === "object") return Object.values(data);
      return [];
    };

    const parsedDataForScoring: any = {
      summary: rawParsedData.summary,
      skills: ensureArray(rawParsedData.skills),
      experience: ensureArray(rawParsedData.experience),
      education: ensureArray(rawParsedData.education),
      certifications: ensureArray(rawParsedData.certifications),
      languages: ensureArray(rawParsedData.languages),
      extractedText: "",
    };

    // Ensure requirements is an array (handle Firestore serialization)
    let jobRequirements: string[] = [];
    if (job.requirements) {
      if (Array.isArray(job.requirements)) {
        jobRequirements = job.requirements;
      } else if (typeof job.requirements === "object") {
        jobRequirements = Object.values(job.requirements);
      }
    }

    const aiScore = await openaiService.scoreCandidate(
      parsedDataForScoring,
      job.description || "",
      jobRequirements
    );

    // Debug: Log parsedData before creating candidate
    console.log("Creating candidate from application:", {
      applicationId: application.id,
      hasParsedData: !!(application as any).parsedData,
      parsedDataKeys: (application as any).parsedData
        ? Object.keys((application as any).parsedData)
        : [],
      skillsCount: (application as any).parsedData?.skills?.length || 0,
      experienceCount: (application as any).parsedData?.experience?.length || 0,
      educationCount: (application as any).parsedData?.education?.length || 0,
      skillsSample: application.parsedData?.skills?.[0],
      experienceSample: JSON.stringify(application.parsedData?.experience?.[0]),
      educationSample: JSON.stringify(application.parsedData?.education?.[0]),
    });

    // Helper function to calculate years of experience from experience array
    const calculateYearsOfExperience = (experiences: any[]): number => {
      if (!experiences || experiences.length === 0) return 0;

      let totalMonths = 0;

      for (const exp of experiences) {
        if (!exp.duration) continue;

        // Parse duration like "Nov 2020 - Oct 2025" or "2020 - 2025" or "Nov 2020 - Present"
        const durationStr = exp.duration.trim();

        // Handle "Present" or "Current"
        const isPresentJob = /present|current/i.test(durationStr);

        // Try to extract dates
        const dateMatch = durationStr.match(
          /(\w+\s+)?(\d{4})\s*[-–]\s*(\w+\s+)?(\d{4}|present|current)/i
        );

        if (dateMatch) {
          const startYear = parseInt(dateMatch[2]);
          const startMonth = dateMatch[1]
            ? new Date(dateMatch[1] + " 1").getMonth()
            : 0;

          let endYear: number;
          let endMonth: number;

          if (isPresentJob) {
            const now = new Date();
            endYear = now.getFullYear();
            endMonth = now.getMonth();
          } else {
            endYear = parseInt(dateMatch[4]);
            endMonth = dateMatch[3]
              ? new Date(dateMatch[3] + " 1").getMonth()
              : 11;
          }

          const months = (endYear - startYear) * 12 + (endMonth - startMonth);
          totalMonths += Math.max(0, months);
        }
      }

      // Convert to years (rounded to 1 decimal)
      return Math.round((totalMonths / 12) * 10) / 10;
    };

    // Helper function to filter certifications (remove skill descriptions)
    const filterCertifications = (certifications: string[]): string[] => {
      if (!certifications || certifications.length === 0) return [];

      return certifications.filter((cert: string) => {
        // Remove items that are too long (likely skill descriptions, not cert names)
        if (cert.length > 100) return false;

        // Remove items that contain phrases like "proficient in", "strong foundation", "experience with"
        const skillPhrases =
          /proficient in|strong foundation|experience with|skilled in|expertise in|knowledge of/i;
        if (skillPhrases.test(cert)) return false;

        return true;
      });
    };

    // Get the first stage of the pipeline (if pipeline exists)
    let firstStageId = null;
    let firstStageName = null;
    if (pipeline && pipeline.stages && pipeline.stages.length > 0) {
      // Sort stages by order and get the first one
      const sortedStages = pipeline.stages.sort(
        (a: any, b: any) => a.order - b.order
      );
      // Use 'id' field, not '_id' (Firestore uses 'id' not MongoDB's '_id')
      firstStageId = sortedStages[0].id || sortedStages[0]._id;
      firstStageName = sortedStages[0].name;
      logger.info(
        `Assigning candidate to first stage: ${firstStageName} (ID: ${firstStageId})`
      );
    } else if (pipeline) {
      logger.warn(
        `Pipeline ${pipeline.id || pipeline._id} has no stages defined`
      );
    } else {
      logger.info(
        "No pipeline assigned - candidate will need to be added to pipeline manually"
      );
    }

    // Prepare candidate data
    const candidateData: any = {
      applicationIds: [application.id],
      jobIds: [jobId],
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      phone: application.phone,
      resumeUrl: application.resumeUrl,
      resumeOriginalName: application.resumeOriginalName,
      currentPipelineStageId: firstStageId, // Assign to first stage, not pipeline ID
      status: "active",
      aiScore,
      notes: notes || (application as any).notes,
      source: "application",
      createdBy: (req as any).user.id,
      jobApplications: [
        {
          jobId: jobId,
          applicationId: application.id,
          status: "active",
          appliedAt: application.createdAt || new Date(),
          lastStatusChange: new Date(),
          currentStage: firstStageId || null, // CRITICAL: Use stage ID, not name!
          resumeScore: aiScore?.overallScore,
          emailIds: [],
          emailsSent: 0,
          emailsReceived: 0,
        },
      ],
    };

    // Copy video intro fields if they exist
    if ((application as any).videoIntroUrl) {
      candidateData.videoIntroUrl = (application as any).videoIntroUrl;
    }
    if ((application as any).videoIntroFilename) {
      candidateData.videoIntroFilename = (
        application as any
      ).videoIntroFilename;
    }
    if ((application as any).videoIntroDuration) {
      candidateData.videoIntroDuration = (
        application as any
      ).videoIntroDuration;
    }
    if ((application as any).videoIntroFileSize) {
      candidateData.videoIntroFileSize = (
        application as any
      ).videoIntroFileSize;
    }

    // Copy parsed resume data from application if it exists
    if ((application as any).parsedData) {
      if ((application as any).parsedData.summary) {
        candidateData.summary = (application as any).parsedData.summary;
      }
      if (
        (application as any).parsedData.skills &&
        (application as any).parsedData.skills.length > 0
      ) {
        candidateData.skills = [...(application as any).parsedData.skills];
      }
      if (
        (application as any).parsedData.experience &&
        (application as any).parsedData.experience.length > 0
      ) {
        // Map experience data and fix empty company names
        candidateData.experience = (
          application as any
        ).parsedData.experience.map((exp: any) => {
          let company = exp.company || "";

          // Convert description to string if it's an array
          const descriptionText = Array.isArray(exp.description)
            ? exp.description.join(" ")
            : exp.description || "";

          // If company is empty, try to extract from description or title
          if (!company && descriptionText) {
            const companyMatch = descriptionText.match(
              /(?:at|@|for)\s+([A-Z][a-zA-Z\s&]+?)(?:\s*[-–]|\s*,|\s*$)/
            );
            if (companyMatch) {
              company = companyMatch[1].trim();
            }
          }

          return {
            company,
            title: exp.title || "",
            duration: exp.duration || "",
            description: descriptionText,
          };
        });

        // Calculate years of experience from actual work history
        const calculatedYears = calculateYearsOfExperience(
          candidateData.experience
        );
        if (calculatedYears > 0) {
          candidateData.yearsOfExperience = calculatedYears;
        }
      }
      if (
        (application as any).parsedData.education &&
        (application as any).parsedData.education.length > 0
      ) {
        candidateData.education = (application as any).parsedData.education.map(
          (edu: any) => {
            // Ensure field contains actual field of study, not degree type
            let field = edu.field || "";

            // If field is a degree type (bachelors, masters, etc.), try to find actual field
            if (
              /^(bachelor|master|phd|doctorate|associate|diploma)/i.test(
                field
              ) &&
              edu.degree
            ) {
              // Try to extract field from degree
              const fieldMatch = edu.degree.match(/in\s+([^,]+)/i);
              if (fieldMatch) {
                field = fieldMatch[1].trim();
              } else if (edu.institution) {
                // Check if institution name has field info
                const instFieldMatch = edu.institution.match(/of\s+([^,]+)/i);
                if (instFieldMatch) {
                  field = instFieldMatch[1].trim();
                }
              }
            }

            return {
              institution: edu.institution || "",
              degree: edu.degree || "",
              field,
              year: edu.year || "",
            };
          }
        );
      }
      if (
        (application as any).parsedData.certifications &&
        (application as any).parsedData.certifications.length > 0
      ) {
        // Filter out skill descriptions from certifications
        candidateData.certifications = filterCertifications(
          (application as any).parsedData.certifications
        );
      }
      if (
        (application as any).parsedData.languages &&
        (application as any).parsedData.languages.length > 0
      ) {
        candidateData.languages = [
          ...(application as any).parsedData.languages,
        ];
      }
    }

    // Create candidate
    const candidateId = await candidateService.create(candidateData);
    const candidate = await candidateService.findById(candidateId);

    if (!candidate) {
      throw new Error("Failed to create candidate");
    }

    console.log("=== CANDIDATE CREATED ===");
    console.log("Candidate ID:", candidate.id);
    console.log(
      "Candidate Name:",
      `${candidate.firstName} ${candidate.lastName}`
    );
    console.log("Job IDs:", candidate.jobIds);
    console.log(
      "Current Pipeline Stage ID:",
      (candidate as any).currentPipelineStageId
    );
    console.log("Status:", candidate.status);
    console.log("Skills Count:", (candidate as any).skills?.length || 0);
    console.log(
      "Experience Count:",
      (candidate as any).experience?.length || 0
    );
    console.log("Education Count:", (candidate as any).education?.length || 0);
    console.log("========================");

    // Update job's candidateIds array to maintain bidirectional relationship
    const currentCandidateIds = job.candidateIds || [];
    if (!currentCandidateIds.includes(candidate.id!)) {
      await jobService.update(jobId, {
        candidateIds: [...currentCandidateIds, candidate.id!],
        updatedAt: new Date(),
      } as any);
      logger.info(
        `Added candidate ${candidate.id} to job ${jobId} candidateIds array`
      );
    }

    // Update application status and link to candidate
    await applicationService.update(id, {
      status: "approved",
      candidateId: candidate.id,
      approvedAt: new Date(),
      reviewedBy: (req as any).user?.id,
    } as any);

    logger.info(
      `Candidate created from application: ${candidate.email} with AI score: ${aiScore.overallScore}`
    );

    // Log activity
    if (req.user?.id) {
      logActivity({
        userId: req.user.id,
        action: "application_approved",
        resourceType: "application",
        resourceId: id,
        resourceName: `${candidate.firstName} ${candidate.lastName}`,
        metadata: {
          email: candidate.email,
          jobId: jobId,
          aiScore: aiScore.overallScore,
          candidateId: candidate.id,
        },
      }).catch((err) => logger.error("Failed to log activity:", err));
    }

    successResponse(
      res,
      {
        candidateId: candidate.id,
        candidate,
        application,
      },
      "Application approved and candidate created successfully",
      201
    );
  }
);

/**
 * Bulk update application status
 */
export const bulkUpdateStatus = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { applicationIds, status, notes }: BulkUpdateStatusInput = req.body;

    // Validate all IDs (simple string validation for Firestore)
    const validIds = applicationIds.filter(
      (id) => typeof id === "string" && id.length > 0
    );
    if (validIds.length !== applicationIds.length) {
      throw new CustomValidationError("Some application IDs are invalid");
    }

    // Update each application individually
    let modifiedCount = 0;
    for (const appId of validIds) {
      try {
        const updateData: any = { status };
        if (notes) {
          const app = await applicationService.findById(appId);
          if (app) {
            const existingNotes = (app as any).notes || "";
            updateData.notes = existingNotes
              ? `${existingNotes}\n${notes}`
              : notes;
          }
        }

        // If status is approved or rejected, set reviewedBy to current user
        if (status && ["approved", "rejected"].includes(status.toLowerCase())) {
          if ((req as any).user && (req as any).user.id) {
            updateData.reviewedBy = (req as any).user.id;
          }
        }

        await applicationService.update(appId, updateData);
        modifiedCount++;
      } catch (error) {
        logger.error(`Failed to update application ${appId}:`, error);
      }
    }

    logger.info(
      `Bulk updated ${modifiedCount} applications to status: ${status}`
    );

    successResponse(
      res,
      {
        modifiedCount,
        status,
      },
      `Successfully updated ${modifiedCount} applications`
    );
  }
);

/**
 * Bulk delete applications
 */
export const bulkDeleteApplications = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { applicationIds }: { applicationIds: string[] } = req.body;

    // Validate all IDs (simple string validation for Firestore)
    const validIds = applicationIds.filter(
      (id) => typeof id === "string" && id.length > 0
    );
    if (validIds.length !== applicationIds.length) {
      throw new CustomValidationError("Some application IDs are invalid");
    }

    // Get all applications to delete
    const allApplications = await applicationService.find([]);
    const applications = allApplications.filter((app) =>
      validIds.includes(app.id)
    );

    if (applications.length === 0) {
      throw new NotFoundError("No applications found with provided IDs");
    }

    // Check if any application has been approved (converted to candidate)
    const allCandidates = await candidateService.find([]);
    const candidateCheck = allCandidates.find((c: any) =>
      c.applicationIds?.some((appId: string) => validIds.includes(appId))
    );

    if (candidateCheck) {
      throw new CustomValidationError(
        "Cannot delete applications that have been approved as candidates"
      );
    }

    let deletedFilesCount = 0;

    // Delete files from Cloudinary for each application
    for (const application of applications) {
      // Delete resume from Cloudinary if exists
      if (application.resumeUrl) {
        try {
          const urlParts = application.resumeUrl.split("/");
          const uploadIndex = urlParts.indexOf("upload");
          if (uploadIndex !== -1 && urlParts.length > uploadIndex + 1) {
            const publicIdWithExtension = urlParts
              .slice(uploadIndex + 2)
              .join("/");
            const publicId = publicIdWithExtension.split(".")[0];

            await cloudinaryService.deleteFile(publicId, "raw");
            deletedFilesCount++;
          }
        } catch (error) {
          logger.error(
            `Error deleting resume from Cloudinary for application ${application.id}:`,
            error
          );
        }
      }

      // Delete additional documents from Cloudinary if exists
      if (
        (application as any).additionalDocuments &&
        (application as any).additionalDocuments.length > 0
      ) {
        for (const doc of (application as any).additionalDocuments) {
          if (doc.url) {
            try {
              const urlParts = doc.url.split("/");
              const uploadIndex = urlParts.indexOf("upload");
              if (uploadIndex !== -1 && urlParts.length > uploadIndex + 1) {
                const publicIdWithExtension = urlParts
                  .slice(uploadIndex + 2)
                  .join("/");
                const publicId = publicIdWithExtension.split(".")[0];

                await cloudinaryService.deleteFile(publicId, "raw");
                deletedFilesCount++;
              }
            } catch (error) {
              logger.error(`Error deleting document from Cloudinary:`, error);
            }
          }
        }
      }
    }

    // Delete all applications from database
    let deletedCount = 0;
    for (const appId of validIds) {
      try {
        await applicationService.delete(appId);
        deletedCount++;
      } catch (error) {
        logger.error(`Failed to delete application ${appId}:`, error);
      }
    }

    logger.info(
      `Bulk deleted ${deletedCount} applications and ${deletedFilesCount} files from Cloudinary`
    );

    successResponse(
      res,
      {
        deletedCount,
        deletedFilesCount,
      },
      `Successfully deleted ${deletedCount} applications`
    );
  }
);

/**
 * Get application statistics
 */
export const getApplicationStats = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { jobId } = req.query;

    // Fetch all applications
    let allApplications = await applicationService.find([]);

    // Filter by jobId if specified
    if (jobId) {
      allApplications = allApplications.filter(
        (app: any) => app.jobId === jobId
      );
    }

    // Calculate statistics in memory
    const byStatus: any = {};
    const bySource: any = {};

    allApplications.forEach((app: any) => {
      // Count by status
      byStatus[app.status] = (byStatus[app.status] || 0) + 1;

      // Count by source
      bySource[app.source] = (bySource[app.source] || 0) + 1;
    });

    const result = {
      total: allApplications.length,
      byStatus,
      bySource,
    };

    successResponse(
      res,
      result,
      "Application statistics retrieved successfully"
    );
  }
);

/**
 * Get dashboard analytics for applications
 * Returns time-series data of applications by source type
 */
export const getDashboardAnalytics = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { days = "90" } = req.query;
    const daysNum = parseInt(days as string, 10);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);

    // Fetch all applications within date range
    const allApplications = await applicationService.find([]);
    const filteredApplications = allApplications.filter((app: any) => {
      // Handle createdAt or appliedAt
      const dateField = app.createdAt || app.appliedAt;
      if (!dateField) return false;

      const createdAt =
        dateField instanceof Date ? dateField : new Date(dateField);
      return createdAt >= startDate && createdAt <= endDate;
    });

    // Group by date and source
    const groupedData: Map<string, any> = new Map();

    filteredApplications.forEach((app: any) => {
      const dateField = app.createdAt || app.appliedAt;
      if (!dateField) return;

      const createdAt =
        dateField instanceof Date ? dateField : new Date(dateField);
      const dateStr = createdAt.toISOString().split("T")[0]; // YYYY-MM-DD format
      const source = app.source || "unknown";

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
      } else if (source === "email" || source === "email_automation") {
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
