import nodemailer from 'nodemailer';
import { emailAccountService } from './firestore';
import logger from '../utils/logger';

export interface SMTPEmailOptions {
  from: string; // Email address to send from
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{
    filename: string;
    content?: Buffer;
    path?: string;
    contentType?: string;
  }>;
  inReplyTo?: string; // Message-ID of the email being replied to
  references?: string[]; // Array of Message-IDs for threading
}

/**
 * Get SMTP configuration for an email account
 */
async function getSMTPConfig(emailAddress: string) {
  try {
    logger.info(`Looking up SMTP config for: ${emailAddress}`);
    const accounts = await emailAccountService.find([
      { field: 'email', operator: '==', value: emailAddress }
    ]);

    if (accounts.length === 0) {
      logger.error(`No email account found for: ${emailAddress}`);
      throw new Error(`No email account found for: ${emailAddress}`);
    }

    const account = accounts[0];
    logger.info(`Found email account: ${account.email} (Active: ${account.isActive})`);

    if (!account.isActive) {
      logger.error(`Email account is not active: ${emailAddress}`);
      throw new Error(`Email account is not active: ${emailAddress}`);
    }

    // Determine SMTP host based on provider
    let smtpHost = account.smtpHost;
    let smtpPort = account.smtpPort || 587;

    if (!smtpHost) {
      // Auto-detect SMTP host based on email provider
      if (account.provider === 'gmail' || emailAddress.includes('@gmail.com')) {
        smtpHost = 'smtp.gmail.com';
        smtpPort = 587; // TLS
      } else if (account.provider === 'outlook' || emailAddress.includes('@outlook.com') || emailAddress.includes('@hotmail.com')) {
        smtpHost = 'smtp.office365.com';
        smtpPort = 587;
      } else if (emailAddress.includes('@yahoo.com')) {
        smtpHost = 'smtp.mail.yahoo.com';
        smtpPort = 587;
      } else {
        // Use IMAP host and replace imap with smtp
        smtpHost = account.imapHost.replace('imap', 'smtp');
      }
    }

    const config = {
      host: smtpHost,
      port: smtpPort,
      secure: account.smtpSecure !== undefined ? account.smtpSecure : (smtpPort === 465), // true for 465, false for other ports
      auth: {
        user: account.email,
        pass: account.password || account.imapPassword, // Use unified password or fallback to imapPassword
      },
      from: account.email,
      accountId: account.id,
    };

    logger.info(`SMTP Config: ${smtpHost}:${smtpPort} (secure: ${config.secure})`);
    
    return config;
  } catch (error) {
    logger.error('Error getting SMTP config:', error);
    throw error;
  }
}

/**
 * Send email via SMTP using the sender's email account credentials
 */
export async function sendSMTPEmail(options: SMTPEmailOptions): Promise<{ messageId: string }> {
  try {
    const fromEmail = typeof options.from === 'string' ? options.from : options.from;
    
    logger.info(`Preparing to send email via SMTP from: ${fromEmail}`);

    // Get SMTP configuration for the sender's email account
    const smtpConfig = await getSMTPConfig(fromEmail);

    // Create transporter
    logger.info(`Creating SMTP transporter for ${smtpConfig.host}:${smtpConfig.port}`);
    const transporter = nodemailer.createTransporter({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: smtpConfig.auth,
      tls: {
        rejectUnauthorized: false, // Allow self-signed certificates
      },
      debug: true, // Enable debug mode
      logger: true, // Log to console
    });

    // Verify connection
    try {
      logger.info(`Verifying SMTP connection...`);
      await transporter.verify();
      logger.info(`✅ SMTP connection verified for ${smtpConfig.host}:${smtpConfig.port}`);
    } catch (verifyError: any) {
      logger.error(`❌ SMTP verification failed: ${verifyError.message}`);
      throw new Error(`SMTP connection failed: ${verifyError.message}`);
    }

    // Prepare email
    const mailOptions: any = {
      from: `"${options.from}" <${smtpConfig.from}>`,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ''), // Strip HTML as fallback
    };

    // Add optional fields
    if (options.replyTo) {
      mailOptions.replyTo = options.replyTo;
    }

    if (options.cc) {
      mailOptions.cc = Array.isArray(options.cc) ? options.cc.join(', ') : options.cc;
    }

    if (options.bcc) {
      mailOptions.bcc = Array.isArray(options.bcc) ? options.bcc.join(', ') : options.bcc;
    }

    if (options.attachments) {
      mailOptions.attachments = options.attachments;
    }

    // Add threading headers for replies
    if (options.inReplyTo) {
      mailOptions.inReplyTo = options.inReplyTo;
    }

    if (options.references && options.references.length > 0) {
      mailOptions.references = options.references.join(' ');
    }

    // Send email
    const info = await transporter.sendMail(mailOptions);

    logger.info(`✅ Email sent via SMTP: ${info.messageId}`);
    logger.info(`   From: ${fromEmail}`);
    logger.info(`   To: ${mailOptions.to}`);
    logger.info(`   Subject: ${options.subject}`);

    return {
      messageId: info.messageId,
    };
  } catch (error: any) {
    logger.error('❌ Failed to send email via SMTP:', error);
    logger.error(`   From: ${options.from}`);
    logger.error(`   Error: ${error.message}`);
    throw error;
  }
}

/**
 * Send a simple text email
 */
export async function sendSimpleSMTPEmail(
  from: string,
  to: string | string[],
  subject: string,
  body: string,
  options?: {
    replyTo?: string;
    inReplyTo?: string;
    references?: string[];
  }
): Promise<{ messageId: string }> {
  return sendSMTPEmail({
    from,
    to,
    subject,
    html: body.replace(/\n/g, '<br>'),
    text: body,
    replyTo: options?.replyTo,
    inReplyTo: options?.inReplyTo,
    references: options?.references,
  });
}

export default {
  sendSMTPEmail,
  sendSimpleSMTPEmail,
};
