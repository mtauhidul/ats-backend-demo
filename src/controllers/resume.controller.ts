import { Request, Response } from "express";
import { applicationService, jobService } from "../services/firestore";
import cloudinaryService from "../services/cloudinary.service";
import openaiService from "../services/openai.service";
import {
  ParseAndSaveResumeInput,
  ParseResumeInput,
} from "../types/resume.types";
import {
  ValidationError as CustomValidationError,
  NotFoundError,
} from "../utils/errors";
import { asyncHandler, successResponse } from "../utils/helpers";
import logger from "../utils/logger";

/**
 * Parse resume file and return structured JSON
 * Does not save to database - used for manual import workflow
 */
export const parseResume = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    // Apply default values if options not provided (multipart/form-data with only file upload)
    const options: ParseResumeInput = {
      extractSkills:
        req.body.extractSkills !== undefined ? req.body.extractSkills : true,
      extractEducation:
        req.body.extractEducation !== undefined
          ? req.body.extractEducation
          : true,
      extractExperience:
        req.body.extractExperience !== undefined
          ? req.body.extractExperience
          : true,
    };

    // Check if file was uploaded
    if (!req.file) {
      throw new CustomValidationError("No resume file uploaded");
    }

    logger.info(`Parsing resume: ${req.file.originalname}`);

    // Parse resume using OpenAI
    logger.info("Using OpenAI parser");
    const parsedData = await openaiService.parseResumeFromFile(
      req.file.buffer,
      req.file.mimetype
    );

    // Filter data based on options
    const response: any = {
      personalInfo: parsedData.personalInfo,
    };

    if (options.extractSkills) {
      response.skills = parsedData.skills;
    }

    if (options.extractEducation) {
      response.education = parsedData.education;
    }

    if (options.extractExperience) {
      response.experience = parsedData.experience;
    }

    // Include other fields
    response.summary = parsedData.summary;
    response.languages = parsedData.languages;
    response.certifications = parsedData.certifications;
    response.extractedText = parsedData.extractedText; // Full raw text for validation

    logger.info(
      `Resume parsed successfully: ${parsedData.personalInfo?.email || "unknown"}`
    );

    successResponse(res, response, "Resume parsed successfully");
  }
);

/**
 * Parse resume and automatically save as Application
 * Used for direct apply workflow
 */
export const parseAndSaveResume = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data: ParseAndSaveResumeInput = req.body;

    // Check if file was uploaded
    if (!req.file) {
      throw new CustomValidationError("No resume file uploaded");
    }

    // Verify job exists
    const job = await jobService.findById(data.jobId);
    if (!job) {
      throw new NotFoundError("Job not found");
    }

    logger.info(
      `Parsing and saving resume: ${req.file.originalname} for job ${job.title}`
    );

    // Parse resume using OpenAI
    logger.info("Using OpenAI parser");
    const parsedData = await openaiService.parseResumeFromFile(
      req.file.buffer,
      req.file.mimetype
    );

    // Validate that we got email from parsed data
    if (!parsedData.personalInfo?.email) {
      throw new CustomValidationError(
        "Could not extract email from resume. Please provide it manually."
      );
    }

    // Check if application already exists for this job and email (including unassigned)
    const allApplications = await applicationService.find([]);
    const existingApplication = allApplications.find((app: any) =>
      (app.jobId === data.jobId || !app.jobId) && app.email === parsedData.personalInfo?.email
    );

    if (existingApplication) {
      if (data.jobId) {
        throw new CustomValidationError(
          `Application already exists for this job with email: ${parsedData.personalInfo.email}`
        );
      } else {
        throw new CustomValidationError(
          `Unassigned application already exists for email: ${parsedData.personalInfo.email}. Please assign a job or delete the existing application first.`
        );
      }
    }

    // Upload resume to Cloudinary
    const resumeUrl = await cloudinaryService.uploadResume(
      req.file.buffer,
      req.file.originalname
    );

    // Create application
    const applicationId = await applicationService.create({
      jobId: data.jobId,
      clientId: data.clientId || job.clientId,
      source: data.source,
      firstName: parsedData.personalInfo.firstName || "",
      lastName: parsedData.personalInfo.lastName || "",
      email: parsedData.personalInfo.email,
      phone: parsedData.personalInfo.phone,
      resumeUrl,
      resumeOriginalName: req.file.originalname,
      parsedData: {
        summary: parsedData.summary,
        skills: parsedData.skills,
        experience: parsedData.experience,
        education: parsedData.education,
        languages: parsedData.languages,
        certifications: parsedData.certifications,
      },
      status: "pending",
      notes: data.notes,
    } as any);

    const application = await applicationService.findById(applicationId);

    if (!application) {
      throw new NotFoundError("Application not found after creation");
    }

    logger.info(
      `Application created successfully: ${application.email} for job ${job.title}`
    );

    successResponse(
      res,
      application,
      "Resume parsed and application created successfully",
      201
    );
  }
);

/**
 * Re-parse existing application's resume
 * Useful if parsing logic improves or needs manual re-processing
 */
export const reparseApplicationResume = asyncHandler(
  async (req: Request, _res: Response): Promise<void> => {
    const { id } = req.params;

    const application = await applicationService.findById(id);

    if (!application) {
      throw new NotFoundError("Application not found");
    }

    if (!application.resumeUrl) {
      throw new CustomValidationError(
        "Application does not have a resume file"
      );
    }

    logger.info(`Re-parsing resume for application: ${application.email}`);

    // Download resume from Cloudinary (this is a simplified version - you'd need to implement actual download)
    // For now, we'll throw an error as this requires additional implementation
    throw new CustomValidationError(
      "Re-parsing from URL not yet implemented. Please re-upload the resume."
    );

    // TODO: Implement resume download from Cloudinary, then re-parse
    // const resumeBuffer = await cloudinaryService.downloadFile(application.resumeUrl);
    // const parsedData = await openaiService.parseResumeFromFile(resumeBuffer, 'application/pdf');
    // application.parsedData = parsedData;
    // await application.save();
  }
);
