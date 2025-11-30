import { Resend } from 'resend';
import { render } from '@react-email/render';
import logger from '../utils/logger';
import { TeamMemberUpdate } from '../emails/TeamMemberUpdate';
import { AssignmentEmail } from '../emails/AssignmentEmail';
import { InvitationEmail } from '../emails/InvitationEmail';
import { MagicLinkEmail } from '../emails/MagicLinkEmail';
import { PasswordResetEmail } from '../emails/PasswordResetEmail';
import { InterviewNotification } from '../emails/InterviewNotification';
import * as React from 'react';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Initialize Resend client
const resend = new Resend(RESEND_API_KEY);

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

/**
 * Send email using Resend
 */
export const sendEmail = async (options: EmailOptions): Promise<string | null> => {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    if (error) {
      logger.error('Failed to send email:', error);
      return null;
    }

    logger.info(`Email sent successfully: ${data?.id}`);
    return data?.id || null;
  } catch (error) {
    logger.error('Error sending email:', error);
    return null;
  }
};

/**
 * Send team member invitation email
 */
export const sendInvitationEmail = async (
  email: string,
  firstName: string,
  token: string
): Promise<string | null> => {
  const verificationLink = `${FRONTEND_URL}/verify-email/${token}`;

  const html = await render(
    React.createElement(InvitationEmail, {
      firstName,
      companyName: 'Your Organization',
      invitedBy: 'Administrator',
      inviteUrl: verificationLink,
    })
  );

  const text = `
    Welcome to the Team!
    
    Hi ${firstName},
    
    You've been invited to join our Applicant Tracking System. 
    
    Activate your account by visiting: ${verificationLink}
    
    This link will expire in 48 hours.
    
    If you didn't request this invitation, please ignore this email.
  `;

  return sendEmail({
    to: email,
    subject: 'You\'ve been invited to join the ATS Team',
    html,
    text,
  });
};

/**
 * Send magic link email
 */
export const sendMagicLinkEmail = async (
  email: string,
  firstName: string,
  token: string
): Promise<string | null> => {
  const magicLink = `${FRONTEND_URL}/magic-link/${token}`;

  const html = await render(
    React.createElement(MagicLinkEmail, {
      firstName,
      magicLink,
    })
  );

  const text = `
    Your Login Link
    
    Hi ${firstName},
    
    Click the link below to log in to your ATS account:
    ${magicLink}
    
    This link expires in 15 minutes and can only be used once.
    
    If you didn't request this login link, please ignore this email.
  `;

  return sendEmail({
    to: email,
    subject: 'Your login link for ATS',
    html,
    text,
  });
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (
  email: string,
  firstName: string,
  token: string
): Promise<string | null> => {
  const resetLink = `${FRONTEND_URL}/reset-password/${token}`;

  const html = await render(
    React.createElement(PasswordResetEmail, {
      firstName,
      resetUrl: resetLink,
    })
  );

  const text = `
    Reset Your Password
    
    Hi ${firstName},
    
    We received a request to reset your password. 
    
    Reset your password by visiting: ${resetLink}
    
    This link expires in 1 hour and can only be used once.
    
    If you didn't request a password reset, please ignore this email.
  `;

  return sendEmail({
    to: email,
    subject: 'Reset your ATS password',
    html,
    text,
  });
};

/**
 * Send team member update notification email
 */
export const sendTeamMemberUpdateEmail = async (
  email: string,
  firstName: string,
  changes: string[],
  updatedBy: string
): Promise<string | null> => {
  const html = await render(
    React.createElement(TeamMemberUpdate, {
      firstName,
      changes,
      updatedBy,
    })
  );

  const text = `
    Your Account Has Been Updated
    
    Hi ${firstName},
    
    Your account has been updated by ${updatedBy}. Here's what changed:
    ${changes.map(change => `- ${change}`).join('\n')}
    
    If you have any questions about these changes, please contact your administrator.
  `;

  return sendEmail({
    to: email,
    subject: 'Your ATS account has been updated',
    html,
    text,
  });
};

/**
 * Send assignment notification email
 */
export const sendAssignmentEmail = async (
  email: string,
  firstName: string,
  entityType: string,
  entityName: string,
  assignedBy: string
): Promise<string | null> => {
  const html = await render(
    React.createElement(AssignmentEmail, {
      firstName,
      entityType,
      entityName,
      assignedBy,
      dashboardUrl: `${FRONTEND_URL}/dashboard`,
    })
  );

  const text = `
    New Assignment
    
    Hi ${firstName},
    
    You've been assigned to a new ${entityType} by ${assignedBy}:
    
    ${entityName}
    Type: ${entityType}
    
    View in your dashboard: ${FRONTEND_URL}/dashboard
  `;

  return sendEmail({
    to: email,
    subject: `You've been assigned to ${entityName}`,
    html,
    text,
  });
};

/**
 * Send interview notification email to candidate
 */
export const sendInterviewNotificationEmail = async (options: {
  candidateEmail: string;
  candidateName: string;
  jobTitle: string;
  interviewTitle: string;
  interviewType: string;
  scheduledAt: Date;
  duration: number;
  meetingLink?: string;
  meetingPassword?: string;
  interviewerNames?: string[];
  isInstant?: boolean;
  companyName?: string;
}): Promise<string | null> => {
  const {
    candidateEmail,
    candidateName,
    jobTitle,
    interviewTitle,
    interviewType,
    scheduledAt,
    duration,
    meetingLink,
    meetingPassword,
    interviewerNames,
    isInstant,
    companyName,
  } = options;

  const html = await render(
    React.createElement(InterviewNotification, {
      candidateName,
      jobTitle,
      interviewTitle,
      interviewType,
      scheduledAt,
      duration,
      meetingLink,
      meetingPassword,
      interviewerNames,
      isInstant,
      companyName: companyName || process.env.COMPANY_NAME || 'Arista',
    })
  );

  const scheduledDate = new Date(scheduledAt);
  const formattedDate = scheduledDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = scheduledDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const interviewTypeDisplay = interviewType === 'video' 
    ? 'Video Interview' 
    : interviewType === 'phone' 
    ? 'Phone Interview' 
    : interviewType === 'in-person'
    ? 'In-Person Interview'
    : 'Interview';

  const text = `
    Interview Scheduled ${isInstant ? '(INSTANT MEETING)' : ''}
    
    Hi ${candidateName},
    
    ${isInstant 
      ? 'Great news! An instant interview meeting has been created for you. The meeting is starting soon!'
      : `Great news! Your interview has been scheduled for the ${jobTitle} position.`
    }
    
    Interview Details:
    - Position: ${jobTitle}
    - Interview: ${interviewTitle}
    - Type: ${interviewTypeDisplay}
    - Date: ${formattedDate}
    - Time: ${formattedTime}
    - Duration: ${duration} minutes
    ${interviewerNames && interviewerNames.length > 0 ? `- Interviewer(s): ${interviewerNames.join(', ')}` : ''}
    
    ${meetingLink ? `
    Video Meeting Details:
    Meeting Link: ${meetingLink}
    ${meetingPassword ? `Password: ${meetingPassword}` : ''}
    ` : ''}
    
    ${!isInstant ? `
    What to prepare:
    - Review the job description and your application
    - Prepare questions about the role and company
    - Test your video/audio if it's a video interview
    - Have a copy of your resume handy
    ` : ''}
    
    We're looking forward to speaking with you!
    
    If you need to reschedule or have any questions, please contact us as soon as possible.
  `;

  return sendEmail({
    to: candidateEmail,
    subject: isInstant 
      ? `🚀 Instant Interview Meeting - ${jobTitle}` 
      : `Interview Scheduled - ${jobTitle}`,
    html,
    text,
  });
};

export default {
  sendEmail,
  sendInvitationEmail,
  sendMagicLinkEmail,
  sendPasswordResetEmail,
  sendTeamMemberUpdateEmail,
  sendAssignmentEmail,
  sendInterviewNotificationEmail,
};
