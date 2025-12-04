import { Request, Response } from "express";
import { emailService } from "../services/firestore";
import resendService from "../services/resend.service";
import { NotFoundError } from "../utils/errors";
import {
  asyncHandler,
  paginateResults,
  successResponse,
} from "../utils/helpers";
import logger from "../utils/logger";
import { logActivity } from "../services/activity.service";

/**
 * Get all emails with filters and pagination
 */
export const getEmails = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      page = 1,
      limit = 10,
      direction,
      candidateId,
      applicationId,
      jobId,
      status,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as any;

    // Get all emails
    let allEmails = await emailService.find([]);

    // Apply filters
    if (direction) {
      allEmails = allEmails.filter((e: any) => e.direction === direction);
    }
    if (status) {
      allEmails = allEmails.filter((e: any) => e.status === status);
    }
    
    // If both candidateId and jobId are provided, use OR logic
    if (candidateId && jobId) {
      allEmails = allEmails.filter((e: any) => 
        e.candidateId === candidateId || e.jobId === jobId ||
        (e.candidateId === candidateId && e.jobId === jobId)
      );
    } else {
      if (candidateId) {
        allEmails = allEmails.filter((e: any) => e.candidateId === candidateId);
      }
      if (jobId) {
        allEmails = allEmails.filter((e: any) => e.jobId === jobId);
      }
    }
    
    if (applicationId) {
      allEmails = allEmails.filter((e: any) => e.applicationId === applicationId);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      allEmails = allEmails.filter((e: any) =>
        e.from?.toLowerCase().includes(searchLower) ||
        e.to?.some((t: string) => t.toLowerCase().includes(searchLower)) ||
        e.subject?.toLowerCase().includes(searchLower) ||
        e.body?.toLowerCase().includes(searchLower)
      );
    }

    // Get total count
    const totalCount = allEmails.length;

    // Calculate pagination
    const pagination = paginateResults(totalCount, {
      page,
      limit,
      sort: sortBy,
      order: sortOrder,
    });

    // Sort
    allEmails.sort((a: any, b: any) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    // Paginate
    const skip = (page - 1) * limit;
    const emails = allEmails.slice(skip, skip + limit);

    successResponse(
      res,
      {
        emails,
        pagination,
      },
      "Emails retrieved successfully"
    );
  }
);

/**
 * Get single email by ID
 */
export const getEmailById = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const email = await emailService.findById(id);

    if (!email) {
      throw new NotFoundError("Email not found");
    }

    successResponse(res, email, "Email retrieved successfully");
  }
);

/**
 * Send new email via Resend
 */
export const sendEmail = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      to,
      subject,
      body,
      bodyHtml,
      cc,
      bcc,
      replyTo,
      candidateId,
      jobId,
      clientId,
      applicationId,
      interviewId,
      inReplyTo, // For threading
      references, // For threading
    } = req.body;

    // Send email via Resend
    let result;
    try {
      logger.info(`Attempting to send email via Resend to ${Array.isArray(to) ? to.join(', ') : to}`);
      result = await resendService.sendEmail({
        to,
        subject,
        body: body || bodyHtml,
        bodyHtml,
        cc,
        bcc,
        replyTo,
        inReplyTo,
        references,
        candidateId,
        jobId,
        clientId,
        applicationId,
        interviewId,
        sentBy: req.user?.id,
      });
      logger.info(`Email sent successfully via Resend. MessageId: ${result.id}`);
    } catch (resendError: any) {
      logger.error(`Resend send failed: ${resendError.message}`, resendError);
      throw new Error(`Failed to send email via Resend: ${resendError.message}`);
    }

    // Fetch the created email record
    const email = await emailService.findById(result.emailId);

    logger.info(
      `Email sent via Resend: ${result.id} to ${Array.isArray(to) ? to.join(", ") : to}`
    );

    // Log activity
    if (req.user?.id) {
      logActivity({
        userId: req.user.id,
        action: "sent_email",
        resourceType: "email",
        resourceId: result.emailId,
        resourceName: subject,
        metadata: {
          to: Array.isArray(to) ? to : [to],
          candidateId,
          jobId,
        },
      }).catch((err) => logger.error("Failed to log activity:", err));
    }

    successResponse(res, email, "Email sent successfully via SMTP", 201);
  }
);

/**
 * Create draft email
 */
export const createDraft = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const data = req.body;

    const emailId = await emailService.create({
      ...data,
      direction: "outbound",
      status: "draft",
      sentBy: req.user?.id,
    } as any);

    const email = await emailService.findById(emailId);

    logger.info(`Email draft created by ${req.user?.email}`);

    successResponse(res, email, "Draft created successfully", 201);
  }
);

/**
 * Update draft email
 */
export const updateDraft = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const updates = req.body;

    const allEmails = await emailService.find([]);
    const email = allEmails.find((e: any) => e.id === id && e.status === "draft");

    if (!email) {
      throw new NotFoundError("Draft not found");
    }

    await emailService.update(id, updates);
    const updatedEmail = await emailService.findById(id);

    logger.info(`Email draft updated: ${id} by ${req.user?.email}`);

    successResponse(res, updatedEmail, "Draft updated successfully");
  }
);

/**
 * Send draft email
 */
export const sendDraft = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const allEmails = await emailService.find([]);
    const email = allEmails.find((e: any) => e.id === id && e.status === "draft");

    if (!email) {
      throw new NotFoundError("Draft not found");
    }

    await emailService.update(id, {
      status: "sent",
      sentAt: new Date(),
    });

    // TODO: Integrate with email service (Resend) to actually send the email

    const updatedEmail = await emailService.findById(id);

    logger.info(`Email draft sent: ${id} by ${req.user?.email}`);

    successResponse(res, updatedEmail, "Email sent successfully");
  }
);

/**
 * Delete email (soft delete for outbound, hard delete for drafts)
 */
export const deleteEmail = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const email = await emailService.findById(id);

    if (!email) {
      throw new NotFoundError("Email not found");
    }

    // Hard delete drafts, soft delete (mark as deleted) for sent emails
    if (email.status === "draft") {
      await emailService.delete(id);
    } else {
      // For sent emails, we might want to keep the record
      // Implement soft delete or archive logic here if needed
      await emailService.delete(id);
    }

    logger.info(`Email deleted: ${id} by ${req.user?.email}`);

    successResponse(res, { id }, "Email deleted successfully");
  }
);

/**
 * Get email thread
 */
export const getEmailThread = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { threadId } = req.params;

    const allEmails = await emailService.find([]);
    const emails = allEmails
      .filter((e: any) => e.threadId === threadId)
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    successResponse(res, emails, "Email thread retrieved successfully");
  }
);

/**
 * Get emails for a candidate
 */
export const getCandidateEmails = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { candidateId } = req.params;

    const allEmails = await emailService.find([]);
    const emails = allEmails
      .filter((e: any) => e.candidateId === candidateId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);

    successResponse(res, emails, "Candidate emails retrieved successfully");
  }
);

/**
 * Get inbound emails (candidate replies)
 */
export const getInboundEmails = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const {
      page = 1,
      limit = 20,
      candidateId,
      status = "received",
      unmatched,
      search,
    } = req.query as any;

    // Fetch all emails
    const allEmails = await emailService.find([]);

    // Apply filters in memory
    let filtered = allEmails.filter((email: any) => {
      // Direction filter
      if (email.direction !== "inbound") return false;

      // Candidate filter
      if (candidateId && email.candidateId !== candidateId) return false;

      // Status filter
      if (status && email.status !== status) return false;

      // Unmatched filter (emails without candidateId)
      if (unmatched === "true" && email.candidateId) return false;

      // Search filter (case-insensitive)
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesFrom = email.from?.toLowerCase().includes(searchLower);
        const matchesSubject = email.subject?.toLowerCase().includes(searchLower);
        const matchesBody = email.body?.toLowerCase().includes(searchLower);
        if (!matchesFrom && !matchesSubject && !matchesBody) return false;
      }

      return true;
    });

    // Sort by receivedAt descending
    filtered = filtered.sort((a: any, b: any) => {
      const dateA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
      const dateB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
      return dateB - dateA;
    });

    // Get total count after filtering
    const totalCount = filtered.length;

    // Calculate pagination
    const pagination = paginateResults(totalCount, {
      page,
      limit,
      sort: "receivedAt",
      order: "desc",
    });

    // Apply pagination
    const skip = (page - 1) * limit;
    const emails = filtered.slice(skip, skip + limit);

    successResponse(
      res,
      {
        emails,
        pagination,
      },
      "Inbound emails retrieved successfully"
    );
  }
);

/**
 * Get email statistics
 */
export const getEmailStats = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    const allEmails = await emailService.find([]);
    
    const totalEmails = allEmails.length;
    const sentEmails = allEmails.filter(
      (e: any) => e.direction === "outbound" && e.status === "sent"
    ).length;
    const receivedEmails = allEmails.filter(
      (e: any) => e.direction === "inbound" && e.status === "received"
    ).length;
    const unmatchedEmails = allEmails.filter(
      (e: any) => e.direction === "inbound" && e.status === "received" && !e.candidateId
    ).length;
    const draftEmails = allEmails.filter((e: any) => e.status === "draft").length;
    const failedEmails = allEmails.filter((e: any) => e.status === "failed").length;

    successResponse(
      res,
      {
        totalEmails,
        sentEmails,
        receivedEmails,
        unmatchedEmails,
        draftEmails,
        failedEmails,
      },
      "Email statistics retrieved successfully"
    );
  }
);
