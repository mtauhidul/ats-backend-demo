import { Resend } from "resend";
import { config } from "../config";
import { InternalServerError } from "../utils/errors";
import logger from "../utils/logger";
import { emailService } from "./firestore";

const resend = new Resend(config.resend.apiKey);

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;

  // Email threading support
  inReplyTo?: string;
  references?: string | string[];

  // For tracking in database
  candidateId?: string;
  applicationId?: string;
  jobId?: string;
  clientId?: string;
  interviewId?: string;
  sentBy?: string;
}

class ResendService {
  /**
   * Send email via Resend
   */
  async sendEmail(
    options: SendEmailOptions
  ): Promise<{ id: string; emailId: string }> {
    try {
      const {
        to,
        subject,
        body,
        bodyHtml,
        cc,
        bcc,
        replyTo,
        attachments,
        inReplyTo,
        references,
        candidateId,
        applicationId,
        jobId,
        clientId,
        interviewId,
        sentBy,
      } = options;

      // Prepare email payload
      const emailPayload: any = {
        from: `${config.resend.fromName} <${config.resend.fromEmail}>`,
        to: Array.isArray(to) ? to : [to],
        subject,
        text: body,
        html: bodyHtml || this.textToHtml(body),
      };

      // Add optional fields
      if (cc) emailPayload.cc = cc;
      if (bcc) emailPayload.bcc = bcc;
      if (replyTo) emailPayload.replyTo = replyTo;
      if (attachments) {
        emailPayload.attachments = attachments.map((att) => ({
          filename: att.filename,
          content: att.content,
        }));
      }

      // Add email threading headers
      if (inReplyTo || references) {
        emailPayload.headers = {};
        if (inReplyTo) emailPayload.headers["In-Reply-To"] = inReplyTo;
        if (references) {
          emailPayload.headers["References"] = Array.isArray(references)
            ? references.join(" ")
            : references;
        }
      }

      // Send via Resend
      const result = await resend.emails.send(emailPayload);

      if (!result.data?.id) {
        throw new Error("Failed to send email via Resend");
      }

      // Save to database
      const emailId = await emailService.create({
        direction: "outbound",
        from: config.resend.fromEmail,
        to: Array.isArray(to) ? to : [to],
        cc,
        bcc,
        subject,
        body,
        bodyHtml: bodyHtml || this.textToHtml(body),
        status: "sent",
        sentAt: new Date(),
        inReplyTo,
        threadId: inReplyTo || result.data.id,
        candidateId: candidateId || undefined,
        applicationId: applicationId || undefined,
        jobId: jobId || undefined,
        clientId: clientId || undefined,
        interviewId: interviewId || undefined,
        sentBy: sentBy || undefined,
        messageId: result.data.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      logger.info(`Email sent successfully: ${result.data.id}`);

      return {
        id: result.data.id,
        emailId,
      };
    } catch (error: any) {
      logger.error("Resend service error:", error);

      // Save failed email to database
      try {
        await emailService.create({
          direction: "outbound",
          from: config.resend.fromEmail,
          to: Array.isArray(options.to) ? options.to : [options.to],
          subject: options.subject,
          body: options.body,
          status: "failed",
          error: error.message,
          candidateId: options.candidateId || undefined,
          applicationId: options.applicationId || undefined,
          jobId: options.jobId || undefined,
          clientId: options.clientId || undefined,
          sentBy: options.sentBy || undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (dbError) {
        logger.error("Failed to save failed email to database:", dbError);
      }

      throw new InternalServerError(`Failed to send email: ${error.message}`);
    }
  }

  /**
   * Send application confirmation email
   */
  async sendApplicationConfirmation(
    candidateEmail: string,
    candidateName: string,
    jobTitle: string,
    options: { applicationId?: string; jobId?: string }
  ): Promise<{ id: string; emailId: string }> {
    const subject = `Application Received: ${jobTitle}`;
    const body = `
Dear ${candidateName},

Thank you for applying for the ${jobTitle} position. We have received your application and our team will review it shortly.

We will contact you if your qualifications match our requirements.

Best regards,
Arista ATS
    `.trim();

    return this.sendEmail({
      to: candidateEmail,
      subject,
      body,
      applicationId: options.applicationId,
      jobId: options.jobId,
    });
  }

  /**
   * Send interview invitation email
   */
  async sendInterviewInvitation(
    candidateEmail: string,
    candidateName: string,
    jobTitle: string,
    interviewDetails: {
      date: Date;
      duration: number;
      type: string;
      meetingLink?: string;
      location?: string;
    },
    options: { interviewId?: string; candidateId?: string; jobId?: string }
  ): Promise<{ id: string; emailId: string }> {
    const subject = `Interview Invitation: ${jobTitle}`;

    const locationInfo =
      interviewDetails.type === "video" && interviewDetails.meetingLink
        ? `Meeting Link: ${interviewDetails.meetingLink}`
        : interviewDetails.location
          ? `Location: ${interviewDetails.location}`
          : "";

    const body = `
Dear ${candidateName},

We are pleased to invite you for an interview for the ${jobTitle} position.

Interview Details:
- Type: ${interviewDetails.type}
- Date & Time: ${interviewDetails.date.toLocaleString()}
- Duration: ${interviewDetails.duration} minutes
${locationInfo}

Please confirm your availability at your earliest convenience.

Best regards,
${config.resend.fromName}
    `.trim();

    return this.sendEmail({
      to: candidateEmail,
      subject,
      body,
      interviewId: options.interviewId,
      candidateId: options.candidateId,
      jobId: options.jobId,
    });
  }

  /**
   * Convert plain text to HTML
   */
  private textToHtml(text: string): string {
    return text
      .split("\n\n")
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
      .join("\n");
  }
}

export default new ResendService();
