import { Request, Response } from 'express';
import { interviewService, candidateService, jobService, clientService } from '../services/firestore';
import { asyncHandler, successResponse, paginateResults } from '../utils/helpers';
import { NotFoundError } from '../utils/errors';
import logger from '../utils/logger';
import zoomService from '../services/zoom.service';
import emailService from '../services/email.service';
import { logActivity } from '../services/activity.service';

/**
 * Get all interviews with filters and pagination
 */
export const getInterviews = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      page = 1,
      limit = 10,
      candidateId,
      jobId,
      clientId,
      status,
      type,
      sortBy = 'scheduledAt',
      sortOrder = 'desc',
    } = req.query as any;

    // Get all interviews
    let allInterviews = await interviewService.find([]);

    // Apply filters
    if (candidateId) {
      allInterviews = allInterviews.filter((interview: any) => interview.candidateId === candidateId);
    }
    if (jobId) {
      allInterviews = allInterviews.filter((interview: any) => interview.jobId === jobId);
    }
    if (clientId) {
      allInterviews = allInterviews.filter((interview: any) => interview.clientId === clientId);
    }
    if (status) {
      allInterviews = allInterviews.filter((interview: any) => interview.status === status);
    }
    if (type) {
      allInterviews = allInterviews.filter((interview: any) => interview.type === type);
    }

    // Get total count after filtering
    const totalCount = allInterviews.length;

    // Calculate pagination
    const pagination = paginateResults(totalCount, {
      page,
      limit,
      sort: sortBy,
      order: sortOrder,
    });

    // Apply sorting
    allInterviews.sort((a: any, b: any) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    // Apply pagination
    const skip = (page - 1) * limit;
    const interviews = allInterviews.slice(skip, skip + limit);

    successResponse(
      res,
      {
        interviews,
        pagination,
      },
      'Interviews retrieved successfully'
    );
  }
);

/**
 * Get single interview by ID
 */
export const getInterviewById = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const interview = await interviewService.findById(id);

    if (!interview) {
      throw new NotFoundError('Interview not found');
    }

    successResponse(res, interview, 'Interview retrieved successfully');
  }
);

/**
 * Create new interview
 */
export const createInterview = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data = req.body;

    // Verify candidate exists
    const candidate = await candidateService.findById(data.candidateId);
    if (!candidate) {
      throw new NotFoundError('Candidate not found');
    }

    // Verify job exists
    const job = await jobService.findById(data.jobId);
    if (!job) {
      throw new NotFoundError('Job not found');
    }

    // Create interview
    const interviewId = await interviewService.create({
      ...data,
      status: 'scheduled',
      createdBy: req.user?.id,
      organizerId: data.organizerId || req.user?.id,
    } as any);

    let interview = await interviewService.findById(interviewId);

    // Create Zoom meeting if requested and interview is video type
    if (data.createZoomMeeting && interview!.type === 'video') {
      try {
        // Convert Firestore Timestamp to JavaScript Date
        const scheduledAt = interview!.scheduledAt instanceof Date 
          ? interview!.scheduledAt 
          : (interview!.scheduledAt as any).toDate 
            ? (interview!.scheduledAt as any).toDate() 
            : new Date(interview!.scheduledAt);

        const zoomMeeting = await zoomService.createMeeting({
          topic: `${interview!.title} - ${candidate.firstName} ${candidate.lastName}`,
          startTime: scheduledAt,
          duration: interview!.duration,
          timezone: interview!.timezone,
          agenda: interview!.description || `Interview for ${job.title}`,
        });

        await interviewService.update(interviewId, {
          meetingLink: zoomMeeting.join_url,
          meetingId: zoomMeeting.id,
          meetingPassword: zoomMeeting.password,
          zoomMeetingDetails: zoomMeeting,
        } as any);

        interview = await interviewService.findById(interviewId);

        logger.info(`Zoom meeting created for interview: ${interview!.id}`);
      } catch (error: any) {
        logger.error('Failed to create Zoom meeting:', error);
        // Don't fail the interview creation if Zoom fails
      }
    }

    // Send email notification to candidate if sendEmail flag is true
    if (data.sendEmail) {
      try {
        const interviewerNames = interview!.interviewerIds && Array.isArray(interview!.interviewerIds)
          ? interview!.interviewerIds
              .map((interviewer: any) => 
                `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim()
              )
              .filter((name: string) => name.length > 0)
          : [];

        // Get company name from client
        let companyName = process.env.COMPANY_NAME || 'Arista';
        if (job.clientId) {
          try {
            const client = await clientService.findById(job.clientId);
            if (client && client.companyName) {
              companyName = client.companyName;
            }
          } catch (error) {
            logger.warn(`Could not fetch client for company name: ${error}`);
          }
        }

        await emailService.sendInterviewNotificationEmail({
          candidateEmail: candidate.email,
          candidateName: `${candidate.firstName} ${candidate.lastName}`,
          jobTitle: job.title,
          interviewTitle: interview!.title,
          interviewType: interview!.type,
          scheduledAt: interview!.scheduledAt,
          duration: interview!.duration,
          meetingLink: interview!.meetingLink,
          meetingPassword: interview!.meetingPassword,
          interviewerNames: interviewerNames.length > 0 ? interviewerNames : undefined,
          isInstant: data.isInstant || false,
          companyName,
        });

        logger.info(`Interview notification email sent to candidate: ${candidate.email}`);
      } catch (error: any) {
        logger.error('Failed to send interview notification email:', error);
        // Don't fail the interview creation if email fails
      }
    }

    logger.info(`Interview created: ${interview!.title} for candidate ${candidate.email} by ${req.user?.email}`);

    // Log activity
    if (req.user?.id && interview) {
      await logActivity({
        userId: req.user.id,
        action: "scheduled_interview",
        resourceType: "interview",
        resourceId: interviewId,
        resourceName: interview.title || "Interview",
        metadata: {
          candidateId: data.candidateId,
          candidateName: `${candidate.firstName} ${candidate.lastName}`,
          jobId: data.jobId,
          interviewType: data.interviewType,
          scheduledAt: data.scheduledAt,
        },
      });
    }

    successResponse(res, interview, 'Interview scheduled successfully', 201);
  }
);

/**
 * Update interview
 */
export const updateInterview = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const updates = req.body;

    // Add updatedBy
    updates.updatedBy = req.user?.id;

    await interviewService.update(id, updates as any);
    const interview = await interviewService.findById(id);

    if (!interview) {
      throw new NotFoundError('Interview not found');
    }

    logger.info(`Interview updated: ${id} by ${req.user?.email}`);

    successResponse(res, interview, 'Interview updated successfully');
  }
);

/**
 * Cancel interview
 */
export const cancelInterview = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { reason } = req.body;

    await interviewService.update(id, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancellationReason: reason,
      updatedBy: req.user?.id,
    } as any);

    const interview = await interviewService.findById(id);

    if (!interview) {
      throw new NotFoundError('Interview not found');
    }

    logger.info(`Interview cancelled: ${id} by ${req.user?.email}`);

    successResponse(res, interview, 'Interview cancelled successfully');
  }
);

/**
 * Add feedback to interview
 */
export const addFeedback = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const feedbackData = req.body;

    const interview = await interviewService.findById(id);

    if (!interview) {
      throw new NotFoundError('Interview not found');
    }

    // Add feedback
    const currentFeedback = interview.feedback || [];
    currentFeedback.push({
      interviewerId: req.user?.id,
      ...feedbackData,
      submittedAt: new Date(),
    });

    // Prepare update
    const updates: any = {
      feedback: currentFeedback,
    };

    // If all interviewers provided feedback, mark as completed
    if (currentFeedback.length >= (interview.interviewerIds?.length || 0)) {
      updates.status = 'completed';
      updates.completedAt = new Date();
    }

    await interviewService.update(id, updates);
    const updatedInterview = await interviewService.findById(id);

    logger.info(`Feedback added to interview ${id} by ${req.user?.email}`);

    successResponse(res, updatedInterview, 'Feedback added successfully');
  }
);

/**
 * Delete interview
 */
export const deleteInterview = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const interview = await interviewService.findById(id);

    if (!interview) {
      throw new NotFoundError('Interview not found');
    }

    await interviewService.delete(id);

    logger.info(`Interview deleted: ${id} by ${req.user?.email}`);

    successResponse(res, { id }, 'Interview deleted successfully');
  }
);

/**
 * Get upcoming interviews
 */
export const getUpcomingInterviews = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { limit = 10 } = req.query;

    // Get all interviews
    const allInterviews = await interviewService.find([]);
    
    // Filter upcoming interviews
    const now = new Date();
    let upcomingInterviews = allInterviews.filter((interview: any) =>
      new Date(interview.scheduledAt) >= now &&
      ['scheduled', 'confirmed'].includes(interview.status)
    );

    // Sort by scheduled time
    upcomingInterviews.sort((a: any, b: any) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
    );

    // Apply limit
    const interviews = upcomingInterviews.slice(0, Number(limit));

    successResponse(res, interviews, 'Upcoming interviews retrieved successfully');
  }
);

/**
 * Create Zoom meeting for an interview
 */
export const createZoomMeeting = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    let interview = await interviewService.findById(id);

    if (!interview) {
      throw new NotFoundError('Interview not found');
    }

    if (interview.meetingLink) {
      successResponse(res, interview, 'Interview already has a Zoom meeting');
      return;
    }

    // Get candidate and job details
    const candidate = await candidateService.findById(interview.candidateId);
    const job = await jobService.findById(interview.jobId);

    // Convert Firestore Timestamp to JavaScript Date
    const scheduledAt = interview.scheduledAt instanceof Date 
      ? interview.scheduledAt 
      : (interview.scheduledAt as any).toDate 
        ? (interview.scheduledAt as any).toDate() 
        : new Date(interview.scheduledAt);

    // Create Zoom meeting
    const zoomMeeting = await zoomService.createMeeting({
      topic: `${interview.title} - ${candidate?.firstName} ${candidate?.lastName}`,
      startTime: scheduledAt,
      duration: interview.duration,
      timezone: interview.timezone,
      agenda: interview.description || `Interview for ${job?.title}`,
    });

    // Update interview with Zoom details
    await interviewService.update(id, {
      meetingLink: zoomMeeting.join_url,
      meetingId: zoomMeeting.id,
      meetingPassword: zoomMeeting.password,
      zoomMeetingDetails: zoomMeeting,
    } as any);

    interview = await interviewService.findById(id);

    logger.info(`Zoom meeting created for interview ${id}`);

    successResponse(res, interview, 'Zoom meeting created successfully');
  }
);

/**
 * Complete interview and add review
 */
export const completeInterview = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { rating, feedback, recommendation, strengths, weaknesses } = req.body;

    // Validate required fields
    if (!feedback || !rating) {
      throw new Error('Feedback and rating are required');
    }

    // Find the interview
    let interview = await interviewService.findById(id);

    if (!interview) {
      throw new NotFoundError('Interview not found');
    }

    // Map recommendation to interview model format
    let mappedRecommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no' = 'maybe';
    if (recommendation === 'hire') mappedRecommendation = 'strong_yes';
    else if (recommendation === 'reject') mappedRecommendation = 'no';
    else if (recommendation === 'hold') mappedRecommendation = 'maybe';
    else if (recommendation === 'pending') mappedRecommendation = 'maybe';
    
    // Add feedback to the interview
    const feedbackEntry = {
      interviewerId: req.user?.id as any,
      rating: Number(rating),
      strengths: strengths ? [strengths] : [],
      weaknesses: weaknesses ? [weaknesses] : [],
      comments: feedback,
      recommendation: mappedRecommendation,
      submittedAt: new Date(),
    };

    const currentFeedback = interview.feedback || [];
    currentFeedback.push(feedbackEntry);

    // Update interview status
    await interviewService.update(id, {
      status: 'completed',
      completedAt: new Date(),
      feedback: currentFeedback,
    } as any);

    interview = await interviewService.findById(id);

    logger.info(`Interview ${id} completed by ${req.user?.email} with rating ${rating} and recommendation ${recommendation}`);

    // Log activity for the interviewer
    if (req.user?.id) {
      await logActivity({
        userId: req.user.id,
        action: 'completed_interview',
        resourceType: 'interview',
        resourceId: id,
        resourceName: `Interview completed`,
        metadata: {
          rating,
          recommendation: mappedRecommendation,
          candidateId: interview?.candidateId,
          jobId: interview?.jobId,
        },
      });
    }

    logger.info(`Interview ${id} completed by ${req.user?.email} with rating ${rating}`);

    successResponse(res, interview, 'Interview completed and review submitted successfully');
  }
);
