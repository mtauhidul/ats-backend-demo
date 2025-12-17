import { Request, Response } from "express";
import { Resend } from "resend";
import { config } from "../config";
import {
  candidateService,
  emailService,
  messageService,
} from "../services/firestore";
import { BadRequestError } from "../utils/errors";
import { asyncHandler, successResponse } from "../utils/helpers";
import logger from "../utils/logger";
import { getEmailSettingsInternal } from "./emailSettings.controller";

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || "";
const resend = new Resend(config.resend.apiKey);

/**
 * Handle Resend webhook events
 * Supports: email.sent, email.delivered, email.bounced, email.opened, email.clicked
 */
export const handleResendWebhook = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers["resend-signature"] as string;

    // Verify webhook signature (if secret is configured)
    if (RESEND_WEBHOOK_SECRET && signature) {
      // TODO: Implement signature verification
      // For now, we'll proceed without verification in development
    }

    const event = req.body;

    if (!event || !event.type) {
      throw new BadRequestError("Invalid webhook payload");
    }

    logger.info(`Received Resend webhook: ${event.type}`, {
      eventId: event.data?.email_id,
    });

    switch (event.type) {
      case "email.sent":
        await handleEmailSent(event.data);
        break;
      case "email.delivered":
        await handleEmailDelivered(event.data);
        break;
      case "email.delivery_delayed":
        await handleEmailDelayed(event.data);
        break;
      case "email.complained":
        await handleEmailComplained(event.data);
        break;
      case "email.bounced":
        await handleEmailBounced(event.data);
        break;
      case "email.opened":
        await handleEmailOpened(event.data);
        break;
      case "email.clicked":
        await handleEmailClicked(event.data);
        break;
      case "email.received":
        await handleEmailReceived(event.data);
        break;
      default:
        logger.warn(`Unhandled webhook event type: ${event.type}`);
    }

    successResponse(res, { received: true }, "Webhook processed");
  }
);

/**
 * Handle email.sent event
 */
const handleEmailSent = async (data: any) => {
  const emailId = data.email_id;

  if (emailId) {
    const allEmails = await emailService.find([]);
    const email = allEmails.find((e: any) => e.resendId === emailId);
    if (email) {
      await emailService.update(email.id, {
        status: "sent",
        sentAt: new Date(),
      } as any);
    }
  }
};

/**
 * Handle email.delivered event
 */
const handleEmailDelivered = async (data: any) => {
  const emailId = data.email_id;

  if (emailId) {
    const allEmails = await emailService.find([]);
    const email = allEmails.find((e: any) => e.resendId === emailId);
    if (email) {
      await emailService.update(email.id, {
        status: "delivered",
        deliveredAt: new Date(),
      } as any);
    }
  }
};

/**
 * Handle email.delivery_delayed event
 */
const handleEmailDelayed = async (data: any) => {
  const emailId = data.email_id;

  if (emailId) {
    const allEmails = await emailService.find([]);
    const email = allEmails.find((e: any) => e.resendId === emailId);
    if (email) {
      await emailService.update(email.id, {
        status: "delayed",
      } as any);
    }
  }
};

/**
 * Handle email.complained event (spam report)
 */
const handleEmailComplained = async (data: any) => {
  const emailId = data.email_id;

  if (emailId) {
    const allEmails = await emailService.find([]);
    const email = allEmails.find((e: any) => e.resendId === emailId);
    if (email) {
      await emailService.update(email.id, {
        status: "complained",
      } as any);
      logger.warn(`Email marked as spam: ${emailId}`);
    }
  }
};

/**
 * Handle email.bounced event
 */
const handleEmailBounced = async (data: any) => {
  const emailId = data.email_id;

  if (emailId) {
    const allEmails = await emailService.find([]);
    const email = allEmails.find((e: any) => e.resendId === emailId);
    if (email) {
      await emailService.update(email.id, {
        status: "bounced",
        bouncedAt: new Date(),
      } as any);
      logger.warn(`Email bounced: ${emailId}`);
    }
  }
};

/**
 * Handle email.opened event
 */
const handleEmailOpened = async (data: any) => {
  const emailId = data.email_id;

  if (emailId) {
    const allEmails = await emailService.find([]);
    const email = allEmails.find((e: any) => e.resendId === emailId);
    if (email) {
      await emailService.update(email.id, {
        openedAt: new Date(),
        openCount: (email.openCount || 0) + 1,
      } as any);
    }
  }
};

/**
 * Handle email.clicked event
 */
const handleEmailClicked = async (data: any) => {
  const emailId = data.email_id;

  if (emailId) {
    const allEmails = await emailService.find([]);
    const email = allEmails.find((e: any) => e.resendId === emailId);
    if (email) {
      await emailService.update(email.id, {
        clickedAt: new Date(),
        clickCount: (email.clickCount || 0) + 1,
      } as any);
    }
  }
};

/**
 * Handle email.received event (inbound emails)
 * This handles candidate replies
 */
const handleEmailReceived = async (data: any) => {
  try {
    const emailId = data.email_id;

    if (!emailId) {
      logger.error("No email_id in received event");
      return;
    }

    logger.info(
      `Fetching full email content from Resend API for email_id: ${emailId}`
    );

    // Fetch the full email content from Resend API
    // Webhook only contains metadata, not the actual email body
    const { data: emailData, error: resendError } =
      await resend.emails.receiving.get(emailId);

    if (resendError || !emailData) {
      logger.error("Failed to fetch email from Resend API:", resendError);
      return;
    }

    // Extract email data from the API response
    const fromEmail = emailData.from;
    const toEmail = emailData.to;
    const subject = emailData.subject || "No Subject";

    // Get configured system email to check if this email is associated with our system
    const emailSettings = await getEmailSettingsInternal();
    const systemEmail = emailSettings.fromEmail.toLowerCase();

    // Check if email is associated with our system email
    // It should be either sent TO our system email, or in reply to our system email
    const toEmails = Array.isArray(toEmail) ? toEmail : [toEmail];
    const isToSystemEmail = toEmails.some((email: string) => 
      email.toLowerCase() === systemEmail
    );

    if (!isToSystemEmail) {
      logger.info(`Email not associated with system email (${systemEmail}), skipping storage`, {
        from: fromEmail,
        to: toEmails,
      });
      return;
    }
    const textBody = emailData.text || "";
    const htmlBody = emailData.html || "";

    // Extract metadata
    const messageId = emailData.message_id;
    const inReplyTo =
      emailData.headers?.["in-reply-to"] || emailData.headers?.["In-Reply-To"];
    const references =
      emailData.headers?.["references"] || emailData.headers?.["References"];

    // Fetch attachments with download URLs
    let processedAttachments: any[] = [];
    const attachmentMetadata = emailData.attachments || [];

    if (attachmentMetadata.length > 0) {
      logger.info(
        `Fetching ${attachmentMetadata.length} attachment(s) from Resend API`
      );

      const { data: attachmentsList, error: attachmentsError } =
        await resend.emails.receiving.attachments.list({
          emailId: emailId,
        });

      if (attachmentsError) {
        logger.error(
          "Failed to fetch attachments from Resend API:",
          attachmentsError
        );
      } else if (attachmentsList && attachmentsList.data) {
        processedAttachments = attachmentsList.data.map((att: any) => ({
          id: att.id,
          filename: att.filename,
          contentType: att.content_type,
          contentDisposition: att.content_disposition,
          contentId: att.content_id,
          size: att.size,
          downloadUrl: att.download_url,
          expiresAt: att.expires_at,
        }));
        logger.info(
          `Successfully fetched ${processedAttachments.length} attachment(s) with download URLs`
        );
      }
    }

    logger.info(
      `Received email from ${fromEmail} to ${Array.isArray(toEmail) ? toEmail.join(", ") : toEmail}`,
      {
        subject,
        hasAttachments: processedAttachments.length > 0,
        attachmentCount: processedAttachments.length,
        messageId,
        inReplyTo,
        references,
      }
    );

    // Try to find the candidate by email
    const allCandidates = await candidateService.find([]);
    const candidate = allCandidates.find(
      (c: any) => c.email?.toLowerCase() === fromEmail.toLowerCase()
    );

    // Determine thread ID based on inReplyTo or messageId
    let threadId = inReplyTo || messageId;

    // Try to find the original email this is replying to
    let originalEmail = null;
    if (inReplyTo) {
      const allEmails = await emailService.find([]);
      originalEmail = allEmails.find((e: any) => e.messageId === inReplyTo);
      if (originalEmail && originalEmail.threadId) {
        threadId = originalEmail.threadId;
      }
    }

    if (candidate) {
      // Create an Email record for the inbound email
      const inboundEmailId = await emailService.create({
        direction: "inbound",
        from: fromEmail,
        to: Array.isArray(toEmail) ? toEmail : [toEmail],
        subject,
        body: textBody,
        bodyHtml: htmlBody,
        status: "received",
        receivedAt: new Date(),
        resendId: emailId,
        candidateId: candidate.id,
        applicationId: originalEmail?.applicationId,
        jobId: originalEmail?.jobId,
        interviewId: originalEmail?.interviewId,
        messageId,
        inReplyTo,
        threadId,
        attachments: processedAttachments,
      } as any);

      // Also create a message record for easy tracking
      await messageService.create({
        candidateId: candidate.id,
        subject,
        body: textBody || htmlBody,
        from: fromEmail,
        to: Array.isArray(toEmail) ? toEmail[0] : toEmail,
        direction: "inbound",
        status: "received",
        receivedAt: new Date(),
        emailId: emailId,
      } as any);

      logger.info(
        `Created inbound email and message for candidate ${candidate.email}`,
        {
          emailId: inboundEmailId,
          candidateId: candidate.id,
          threadId,
        }
      );

      // TODO: Notify assigned team member about the reply
      // This could send a real-time notification or email
      // You can use websockets or push notifications here
    } else {
      logger.warn(`Received email from unknown sender: ${fromEmail}`);

      // Store as unmatched email for manual review
      await emailService.create({
        direction: "inbound",
        from: fromEmail,
        to: Array.isArray(toEmail) ? toEmail : [toEmail],
        subject,
        body: textBody,
        bodyHtml: htmlBody,
        status: "received",
        receivedAt: new Date(),
        resendId: emailId,
        messageId,
        inReplyTo,
        threadId,
        attachments: processedAttachments,
      } as any);

      // Store as unmatched message for manual review
      await messageService.create({
        subject,
        body: textBody || htmlBody,
        from: fromEmail,
        to: Array.isArray(toEmail) ? toEmail[0] : toEmail,
        direction: "inbound",
        status: "unmatched",
        receivedAt: new Date(),
        emailId: emailId,
      } as any);

      logger.info("Stored unmatched inbound email for manual review");
    }
  } catch (error) {
    logger.error("Error processing received email:", error);
  }
};

/**
 * Test endpoint to manually trigger webhook processing
 * Only available in development
 */
export const testWebhook = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    if (process.env.NODE_ENV === "production") {
      throw new BadRequestError("Test endpoint not available in production");
    }

    const { type, emailId } = req.body;

    if (!type) {
      throw new BadRequestError("Event type is required");
    }

    const testEvent = {
      type,
      data: {
        email_id: emailId || "test-email-id",
        from: "test@example.com",
        to: ["recipient@example.com"],
        subject: "Test Email",
        text: "This is a test email body",
      },
    };

    // Process the test event by manually calling the handler
    const originalBody = req.body;
    req.body = testEvent;

    try {
      const event = req.body;

      if (!event || !event.type) {
        throw new BadRequestError("Invalid webhook payload");
      }

      logger.info(`Test webhook: ${event.type}`, {
        eventId: event.data?.email_id,
      });

      switch (event.type) {
        case "email.sent":
          await handleEmailSent(event.data);
          break;
        case "email.delivered":
          await handleEmailDelivered(event.data);
          break;
        case "email.delivery_delayed":
          await handleEmailDelayed(event.data);
          break;
        case "email.complained":
          await handleEmailComplained(event.data);
          break;
        case "email.bounced":
          await handleEmailBounced(event.data);
          break;
        case "email.opened":
          await handleEmailOpened(event.data);
          break;
        case "email.clicked":
          await handleEmailClicked(event.data);
          break;
        case "email.received":
          await handleEmailReceived(event.data);
          break;
        default:
          logger.warn(`Unhandled webhook event type: ${event.type}`);
      }

      successResponse(
        res,
        { received: true, test: true },
        "Test webhook processed"
      );
    } finally {
      req.body = originalBody;
    }
  }
);
