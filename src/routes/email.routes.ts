import express from "express";
import {
  createDraft,
  deleteEmail,
  getCandidateEmails,
  getEmailById,
  getEmails,
  getEmailStats,
  getEmailThread,
  getInboundEmails,
  sendDraft,
  sendEmail,
  updateDraft,
} from "../controllers/email.controller";
// import emailAutomationJob from "../jobs/emailAutomation.job"; // TODO: Reimplement with Firestore
import { authenticate, requireRole } from "../middleware/auth";
import logger from "../utils/logger";
import { getFirestoreDB } from "../config/firebase";
import { FieldValue } from "firebase-admin/firestore";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/emails/stats
 * @desc    Get email statistics
 * @access  Recruiter, Admin, Super Admin
 */
router.get("/stats", requireRole("recruiter", "admin"), getEmailStats);

/**
 * @route   GET /api/emails/thread/:threadId
 * @desc    Get email thread
 * @access  All authenticated users
 */
router.get("/thread/:threadId", getEmailThread);

/**
 * @route   GET /api/emails/inbound
 * @desc    Get all inbound emails (candidate replies)
 * @access  All authenticated users
 */
router.get("/inbound", getInboundEmails);

/**
 * @route   GET /api/emails/candidate/:candidateId
 * @desc    Get all emails for a candidate
 * @access  All authenticated users
 */
router.get("/candidate/:candidateId", getCandidateEmails);

/**
 * @route   GET /api/emails
 * @desc    Get all emails with filters
 * @access  All authenticated users
 */
router.get("/", getEmails);

/**
 * @route   GET /api/emails/:id
 * @desc    Get email by ID
 * @access  All authenticated users
 */
router.get("/:id", getEmailById);

/**
 * @route   POST /api/emails
 * @desc    Send new email
 * @access  Recruiter, Hiring Manager, Admin, Super Admin
 */
router.post(
  "/",
  requireRole("recruiter", "hiring_manager", "admin"),
  sendEmail
);

/**
 * @route   POST /api/emails/draft
 * @desc    Create draft email
 * @access  Recruiter, Hiring Manager, Admin, Super Admin
 */
router.post(
  "/draft",
  requireRole("recruiter", "hiring_manager", "admin"),
  createDraft
);

/**
 * @route   PUT /api/emails/draft/:id
 * @desc    Update draft email
 * @access  Recruiter, Hiring Manager, Admin, Super Admin
 */
router.put(
  "/draft/:id",
  requireRole("recruiter", "hiring_manager", "admin"),
  updateDraft
);

/**
 * @route   PATCH /api/emails/draft/:id
 * @desc    Update draft email (partial)
 * @access  Recruiter, Hiring Manager, Admin, Super Admin
 */
router.patch(
  "/draft/:id",
  requireRole("recruiter", "hiring_manager", "admin"),
  updateDraft
);

/**
 * @route   POST /api/emails/draft/:id/send
 * @desc    Send draft email
 * @access  Recruiter, Hiring Manager, Admin, Super Admin
 */
router.post(
  "/draft/:id/send",
  requireRole("recruiter", "hiring_manager", "admin"),
  sendDraft
);

/**
 * @route   DELETE /api/emails/:id
 * @desc    Delete email
 * @access  Admin, Super Admin
 */
router.delete("/:id", requireRole("admin"), deleteEmail);

// ============================================
// EMAIL AUTOMATION ROUTES (for frontend Settings > Email Automation tab)
// ============================================

// Simple in-memory state for email automation
let automationState = {
  enabled: false,
  running: false,
  lastRunAt: null as Date | null,
  lastRunDuration: 0,
  totalEmailsProcessed: 0,
  totalCandidatesCreated: 0,
  totalRepliesStored: 0,
  totalErrors: 0,
  cronInterval: null as NodeJS.Timeout | null,
};

/**
 * Initialize automation state from Firestore on server startup
 * If automation was enabled before restart, restart the cron job
 */
const initializeAutomation = async () => {
  try {
    const db = getFirestoreDB();
    const statusDoc = await db.collection('automationStatus').doc('global').get();
    
    if (statusDoc.exists) {
      const data = statusDoc.data();
      const wasEnabled = data?.enabled || false;
      const intervalMinutes = data?.cronIntervalMinutes || 1;
      
      if (wasEnabled) {
        logger.info(`🔄 Restoring email automation state from Firestore...`);
        logger.info(`   Enabled: ${wasEnabled}`);
        logger.info(`   Interval: ${intervalMinutes} minute(s)`);
        
        automationState.enabled = true;
        
        // Restart the cron job
        automationState.cronInterval = setInterval(() => {
          if (!automationState.running) {
            checkEmailsForAllAccounts();
          } else {
            logger.info('Skipping email check - previous check still running');
          }
        }, intervalMinutes * 60000);
        
        logger.info(`✅ Email automation restored - checking every ${intervalMinutes} minute(s)`);
      } else {
        logger.info('ℹ️  Email automation was disabled, not restarting');
      }
    } else {
      logger.info('ℹ️  No automation state found in Firestore');
    }
  } catch (error) {
    logger.error('❌ Failed to initialize automation from Firestore:', error);
  }
};

// Initialize automation when the module loads
initializeAutomation();

// IMAP email checking function
const checkEmailsForAllAccounts = async () => {
  const startTime = Date.now();
  automationState.running = true;
  automationState.lastRunAt = new Date();

  // Update Firestore running state
  try {
    const db = getFirestoreDB();
    await db.collection('automationStatus').doc('global').set({
      running: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (fsError) {
    logger.error('Error updating Firestore running state:', fsError);
  }

  try {
    logger.info('Starting email automation check...');
    
    // Get services
    const imapService = require('../services/imap.service').default;
    const { 
      emailAccountService, 
      emailService, 
      candidateService,
    } = require('../services/firestore');
    
    // Get all active email accounts
    const allAccounts = await emailAccountService.find([
      { field: 'isActive', operator: '==', value: true }
    ]);
    
    if (allAccounts.length === 0) {
      logger.info('No active email accounts found');
      return;
    }
    
    logger.info(`Checking ${allAccounts.length} active email account(s)...`);
    
    for (const account of allAccounts) {
      try {
        logger.info(`Checking emails for: ${account.email}`);
        
        // 🔥 HYBRID OPTIMIZATION: Use timeframe filter
        const sinceDate = account.lastEmailTimestamp 
          ? new Date(account.lastEmailTimestamp.getTime() - 60000) // Start 1 min before last email to avoid missing any
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days for first run
        
        logger.info(`🔥 Using timeframe filter: Fetching emails since ${sinceDate.toISOString()}`);
        
        // Fetch unread emails via IMAP with timeframe filter
        const emails = await imapService.fetchUnreadEmails(account, 50, sinceDate);
        
        logger.info(`Fetched ${emails.length} unread email(s) from ${account.email}`);
        
        if (emails.length === 0) {
          await emailAccountService.updateLastChecked(account.id!);
          continue;
        }
        
        // Track the latest email timestamp for next run
        let latestEmailDate = account.lastEmailTimestamp || new Date(0);
        
        let processedCount = 0;
        
        for (const email of emails) {
          try {
            // 🔥 HYBRID OPTIMIZATION: Check for duplicate by messageId
            const existingEmail = await emailService.findByMessageId(email.messageId);
            
            if (existingEmail) {
              logger.info(`⏭️  Duplicate email (messageId: ${email.messageId}), skipping`);
              continue;
            }
            
            const senderEmail = email.from.match(/<(.+?)>/) ? email.from.match(/<(.+?)>/)![1] : email.from;
            
            // ✅ IMPROVED: Check if this is a reply using proper email headers
            const isReply = Boolean(
              email.inReplyTo || // Has In-Reply-To header (most reliable)
              email.references && email.references.length > 0 || // Has References header (threading)
              email.subject.toLowerCase().startsWith('re:') || // Subject starts with Re:
              email.subject.toLowerCase().startsWith('fwd:') || // Forwarded emails
              email.body.toLowerCase().includes('wrote:') || // Common reply pattern
              email.body.toLowerCase().includes('on ') && email.body.toLowerCase().includes('at ') && email.body.toLowerCase().includes('wrote') // Quoted text pattern
            );
            
            // Update latest email date
            if (email.date > latestEmailDate) {
              latestEmailDate = email.date;
            }
            
            if (isReply) {
              // **HANDLE REPLY TO SENT EMAIL**
              logger.info(`📨 Processing reply from: ${senderEmail}`);
              
              // ✅ Find candidate by email
              const candidates = await candidateService.find([
                { field: 'email', operator: '==', value: senderEmail }
              ]);
              
              const candidate = candidates.length > 0 ? candidates[0] : null;
              const candidateId = candidate?.id;
              
              // ✅ Find original email using inReplyTo or references
              let originalEmail = null;
              let threadId = null;
              let jobId = undefined;
              let clientId = undefined;
              let applicationId = undefined;
              
              if (email.inReplyTo) {
                const originalEmails = await emailService.find([
                  { field: 'messageId', operator: '==', value: email.inReplyTo }
                ]);
                originalEmail = originalEmails.length > 0 ? originalEmails[0] : null;
              }
              
              if (!originalEmail && email.references && email.references.length > 0) {
                // Try to find using any reference in the thread
                for (const ref of email.references) {
                  const refEmails = await emailService.find([
                    { field: 'messageId', operator: '==', value: ref }
                  ]);
                  if (refEmails.length > 0) {
                    originalEmail = refEmails[0];
                    break;
                  }
                }
              }
              
              // Extract context from original email if found
              if (originalEmail) {
                threadId = originalEmail.threadId || originalEmail.messageId;
                jobId = originalEmail.jobId;
                clientId = originalEmail.clientId;
                applicationId = originalEmail.applicationId;
                logger.info(`✓ Linked reply to original email thread: ${threadId}`);
              } else {
                // Generate new thread ID if we can't find original
                threadId = email.messageId;
                logger.warn(`⚠️  Could not find original email, creating new thread`);
              }
              
              // ✅ If no jobId from original email, get from candidate's most recent pipeline
              if (!jobId && candidate) {
                if (candidate.pipelines && candidate.pipelines.length > 0) {
                  // Get the most recent pipeline (by appliedAt date)
                  const sortedPipelines = [...candidate.pipelines].sort((a: any, b: any) => {
                    const dateA = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
                    const dateB = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
                    return dateB - dateA;
                  });
                  jobId = sortedPipelines[0].jobId;
                  logger.info(`✓ Using candidate's most recent job: ${jobId}`);
                } else if (candidate.jobIds && candidate.jobIds.length > 0) {
                  // Fallback to first jobId
                  jobId = candidate.jobIds[0];
                  logger.info(`✓ Using candidate's first jobId: ${jobId}`);
                }
              }
              
              // ✅ Store as received email in Firestore with proper linking
              await emailService.create({
                direction: 'inbound',
                from: senderEmail,
                to: [account.email],
                subject: email.subject,
                body: email.body,
                bodyHtml: email.bodyHtml,
                status: 'received',
                receivedAt: email.date || new Date(),
                messageId: email.messageId,
                inReplyTo: email.inReplyTo,
                threadId,
                candidateId,
                jobId,
                clientId,
                applicationId,
                emailAccountId: account.id,
                attachments: email.attachments.map((att: any) => ({
                  filename: att.filename,
                  contentType: att.contentType,
                  size: att.size,
                })),
                createdAt: new Date(),
                updatedAt: new Date(),
              } as any);
              
              logger.info(`✅ Stored reply from ${senderEmail} (Candidate: ${candidateId || 'unknown'}, Thread: ${threadId})`);
              automationState.totalEmailsProcessed++;
              automationState.totalRepliesStored++;
              
            } else if (account.autoProcessResumes && email.attachments.length > 0) {
              // **HANDLE RESUME/APPLICATION EMAIL**
              logger.info(`Processing resume email from: ${senderEmail}`);
              
              // Get applicationService
              const { applicationService } = require('../services/firestore');
              
              // ✅ STEP 1: Check applications collection for duplicates (not just candidates)
              // Also check by messageId to prevent race conditions
              const existingApplications = await applicationService.find([
                { field: 'email', operator: '==', value: senderEmail }
              ]);
              
              if (existingApplications.length > 0) {
                logger.info(`Application from ${senderEmail} already exists, skipping`);
                continue;
              }
              
              // 🔥 Race condition prevention: Check by messageId
              const existingByMessageId = await applicationService.find([
                { field: 'sourceMessageId', operator: '==', value: email.messageId }
              ]);
              
              if (existingByMessageId.length > 0) {
                logger.info(`Application with messageId ${email.messageId} already exists, skipping`);
                continue;
              }
              
              // Extract resume attachment
              const resumeAttachment = email.attachments.find((att: any) => 
                att.contentType.includes('pdf') || 
                att.contentType.includes('document') ||
                att.contentType.includes('msword') ||
                att.filename.toLowerCase().endsWith('.pdf') ||
                att.filename.toLowerCase().endsWith('.doc') ||
                att.filename.toLowerCase().endsWith('.docx')
              );
              
              if (!resumeAttachment) {
                logger.info(`No resume attachment found in email from ${senderEmail}`);
                continue;
              }
              
              // Extract video attachment
              const videoAttachment = email.attachments.find((att: any) =>
                att.contentType.includes('video') ||
                att.filename.toLowerCase().endsWith('.mp4') ||
                att.filename.toLowerCase().endsWith('.mov') ||
                att.filename.toLowerCase().endsWith('.avi') ||
                att.filename.toLowerCase().endsWith('.webm') ||
                att.filename.toLowerCase().endsWith('.mkv')
              );
              
              // Extract video link from body
              const videoLinkMatch = email.body.match(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[^\s]+)/i);
              const videoLink = videoLinkMatch ? videoLinkMatch[0] : null;
              
              try {
                // ✅ STEP 2: Upload resume to Cloudinary via public API
                logger.info(`Uploading resume: ${resumeAttachment.filename}`);
                
                const cloudinaryService = require('../services/cloudinary.service').default;
                const resumeUploadResult = await cloudinaryService.uploadResume(
                  resumeAttachment.content,
                  resumeAttachment.filename
                );
                
                logger.info(`Resume uploaded: ${resumeUploadResult.url}`);
                
                // ✅ STEP 3: Upload video if present
                let videoUrl = videoLink; // Use link if provided
                
                if (videoAttachment && !videoUrl) {
                  try {
                    logger.info(`Uploading video: ${videoAttachment.filename}`);
                    const videoUploadResult = await cloudinaryService.uploadVideo(
                      videoAttachment.content,
                      videoAttachment.filename
                    );
                    videoUrl = videoUploadResult.url;
                    logger.info(`Video uploaded: ${videoUrl}`);
                  } catch (videoError) {
                    logger.error(`Error uploading video:`, videoError);
                    // Continue without video
                  }
                }
                
                // ✅ STEP 4: Parse resume with OpenAI and validate
                // Initialize variables with fresh values per iteration
                let parsedData = null;
                let resumeRawText = '';
                let isValidResume = null;
                let validationScore = null;
                let validationReason = null;
                
                // Extract default candidate name from email (fallback only)
                let nameFromEmail = email.from.split('<')[0].trim();
                nameFromEmail = nameFromEmail.replace(/^["']|["']$/g, '');
                const candidateName = nameFromEmail || resumeAttachment.filename.replace(/\.(pdf|doc|docx)$/i, '');
                const nameParts = candidateName.split(' ').filter(Boolean);
                let firstName = nameParts[0] || 'Unknown';
                let lastName = nameParts.slice(1).join(' ') || 'Candidate';
                
                try {
                  const openaiService = require('../services/openai.service').default;
                  
                  // First extract text from the resume buffer
                  const fileType = resumeAttachment.filename.toLowerCase().endsWith('.pdf') ? 'pdf' :
                                  resumeAttachment.filename.toLowerCase().endsWith('.docx') ? 'docx' : 'doc';
                  resumeRawText = await openaiService.extractTextFromResume(resumeAttachment.content, fileType);
                  
                  // ⚠️ CRITICAL: If text extraction fails, don't create application
                  if (!resumeRawText || resumeRawText.trim().length < 50) {
                    logger.error(`❌ Resume text extraction failed or too short (${resumeRawText?.length || 0} chars) for ${senderEmail}`);
                    throw new Error('Resume text extraction failed or content too short');
                  }
                  
                  logger.info(`✅ Extracted ${resumeRawText.length} characters from resume`);
                  
                  // Then parse the extracted text
                  parsedData = await openaiService.parseResume(resumeRawText);
                  logger.info(`Resume parsed successfully for ${senderEmail}`);
                  
                  // ✅ AI Resume Validation (same as manual/direct apply)
                  if (resumeRawText && resumeRawText.trim().length > 0) {
                    try {
                      logger.info('Running AI validation on resume...');
                      const validationResult = await openaiService.validateResume(resumeRawText);
                      
                      isValidResume = validationResult.isValid;
                      validationScore = validationResult.score;
                      validationReason = validationResult.reason;
                      
                      logger.info(
                        `Resume validation: ${validationResult.isValid ? 'VALID' : 'INVALID'} ` +
                        `(score: ${validationResult.score}/100) - ${validationResult.reason}`
                      );
                    } catch (validationError: any) {
                      logger.error('Resume validation failed:', validationError);
                      isValidResume = null;
                      validationScore = null;
                      validationReason = 'Validation service unavailable';
                    }
                  }
                  
                  // ✅ Use parsed name from AI if available (more accurate)
                  if (parsedData?.personalInfo?.firstName) {
                    firstName = parsedData.personalInfo.firstName;
                  }
                  if (parsedData?.personalInfo?.lastName) {
                    lastName = parsedData.personalInfo.lastName;
                  }
                } catch (parseError: any) {
                  logger.error(`❌ CRITICAL: Resume parsing completely failed for ${senderEmail}: ${parseError?.message || parseError}`);
                  logger.error(`   - Resume file: ${resumeAttachment.filename}`);
                  logger.error(`   - Extracted text length: ${resumeRawText?.length || 0}`);
                  logger.error(`   - Skipping application creation to prevent data corruption`);
                  // Skip this email - don't create application with corrupted/missing data
                  continue;
                }
                
                // ✅ STEP 5: Create application via applicationService with proper source
                const applicationData: any = {
                  source: 'email_automation',
                  sourceEmail: senderEmail,
                  sourceEmailAccountId: account.id,
                  sourceMessageId: email.messageId, // 🔥 Store messageId to prevent duplicates
                  firstName,
                  lastName,
                  email: senderEmail,
                  resumeUrl: resumeUploadResult.url,
                  resumeOriginalName: resumeAttachment.filename,
                  resumeRawText, // Keep as pure raw text - no modifications
                  status: (account.defaultApplicationStatus || 'pending') as any,
                  // AI validation results
                  isValidResume,
                  validationScore,
                  validationReason,
                  aiCheckStatus: parsedData ? 'completed' : 'pending',
                  aiCheckCompletedAt: parsedData ? new Date() : undefined,
                };
                
                // Only add optional fields if they have actual data
                if (parsedData?.personalInfo?.phone) {
                  applicationData.phone = parsedData.personalInfo.phone;
                }
                
                if (videoUrl) {
                  applicationData.videoIntroUrl = videoUrl;
                }
                
                if (parsedData) {
                  applicationData.parsedData = parsedData;
                }
                
                // Create application
                const applicationId = await applicationService.create(applicationData as any);
                
                logger.info(`✅ Application created: ${firstName} ${lastName} (${senderEmail}) - ID: ${applicationId}`);
                automationState.totalCandidatesCreated++;
                
                // Store the inbound email with reference to application
                await emailService.create({
                  direction: 'inbound',
                  from: senderEmail,
                  to: [account.email],
                  subject: email.subject,
                  body: email.body,
                  bodyHtml: email.bodyHtml,
                  status: 'processed',
                  receivedAt: email.date || new Date(),
                  messageId: email.messageId,
                  applicationId: applicationId,
                  emailAccountId: account.id,
                  attachments: email.attachments.map((att: any) => ({
                    filename: att.filename,
                    url: att.filename === resumeAttachment.filename ? resumeUploadResult.url : (att.filename === videoAttachment?.filename ? videoUrl : ''),
                    contentType: att.contentType,
                    size: att.size,
                  })),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                } as any);
                
                logger.info(`✅ Email stored in database`);
                
              } catch (processingError) {
                logger.error(`Error processing application for ${senderEmail}:`, processingError);
                automationState.totalErrors++;
                
                // Store email with error status
                try {
                  await emailService.create({
                    direction: 'inbound',
                    from: senderEmail,
                    to: [account.email],
                    subject: email.subject,
                    body: email.body,
                    status: 'failed',
                    receivedAt: email.date || new Date(),
                    messageId: email.messageId,
                    emailAccountId: account.id,
                    error: processingError instanceof Error ? processingError.message : 'Unknown error',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  } as any);
                } catch (emailStoreError) {
                  logger.error(`Error storing failed email:`, emailStoreError);
                }
              }
            } else {
              // Just store the email without processing
              const existingEmails = await emailService.find([
                { field: 'messageId', operator: '==', value: email.messageId }
              ]);
              
              if (existingEmails.length === 0) {
                await emailService.create({
                  direction: 'inbound',
                  from: senderEmail,
                  to: [account.email],
                  subject: email.subject,
                  body: email.body,
                  bodyHtml: email.bodyHtml,
                  status: 'received',
                  receivedAt: email.date || new Date(),
                  messageId: email.messageId,
                  attachments: email.attachments.map((att: any) => ({
                    filename: att.filename,
                    contentType: att.contentType,
                    size: att.size,
                  })),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                } as any);
              }
            }
            
            processedCount++;
          } catch (emailError) {
            logger.error(`Error processing email from ${email.from}:`, emailError);
            automationState.totalErrors++;
          }
        }
        
        // 🔥 HYBRID OPTIMIZATION: Update last email timestamp for next run
        if (processedCount > 0) {
          await emailAccountService.updateLastEmailTimestamp(account.id!, latestEmailDate);
          logger.info(`🔥 Updated last email timestamp to: ${latestEmailDate.toISOString()} (processed ${processedCount} new emails)`);
        } else {
          await emailAccountService.updateLastChecked(account.id!);
          logger.info(`No new emails processed, only updated lastChecked timestamp`);
        }
        
        automationState.totalEmailsProcessed += processedCount;
        
      } catch (accountError) {
        logger.error(`Error checking ${account.email}:`, accountError);
        automationState.totalErrors++;
      }
    }
    
    logger.info('Email automation check completed');
  } catch (error) {
    logger.error('Error in email automation:', error);
    automationState.totalErrors++;
  } finally {
    automationState.running = false;
    automationState.lastRunDuration = Date.now() - startTime;

    // Update Firestore with latest stats
    try {
      const db = getFirestoreDB();
      
      await db.collection('automationStatus').doc('global').set({
        running: false,
        lastRunAt: FieldValue.serverTimestamp(),
        lastRunDuration: automationState.lastRunDuration,
        stats: {
          totalEmailsProcessed: automationState.totalEmailsProcessed,
          totalCandidatesCreated: automationState.totalCandidatesCreated,
          totalRepliesStored: automationState.totalRepliesStored,
          totalErrors: automationState.totalErrors,
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (fsError) {
      logger.error('Error updating Firestore automation status:', fsError);
    }
  }
};

router.get("/automation/status", requireRole("admin"), async (_req, res) => {
  try {
    // Get status from Firestore for persistence
    const db = getFirestoreDB();
    const statusDoc = await db.collection('automationStatus').doc('global').get();
    
    const fsData = statusDoc.exists ? statusDoc.data() : undefined;
    
    res.json({
      success: true,
      data: {
        enabled: automationState.enabled, // In-memory state for current run
        running: automationState.running, // In-memory state for current run
        lastRunAt: fsData?.lastRunAt || null,
        lastRunDuration: fsData?.lastRunDuration || 0,
        cronIntervalMinutes: fsData?.cronIntervalMinutes || 1,
        stats: {
          totalEmailsProcessed: fsData?.stats?.totalEmailsProcessed || 0,
          totalCandidatesCreated: fsData?.stats?.totalCandidatesCreated || 0,
          totalRepliesStored: fsData?.stats?.totalRepliesStored || 0,
          totalErrors: fsData?.stats?.totalErrors || 0,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to get automation status",
      error: error.message,
    });
  }
});

router.post("/automation/enable", requireRole("admin"), async (_req, res): Promise<void> => {
  try {
    if (automationState.enabled) {
      res.json({
        success: true,
        message: "Email automation is already enabled",
      });
      return;
    }

    // Get Firestore instance
    const db = getFirestoreDB();

    // Get current automation config from Firestore
    const statusDoc = await db.collection('automationStatus').doc('global').get();
    const intervalMinutes = statusDoc.exists ? (statusDoc.data()?.cronIntervalMinutes || 1) : 1;

    automationState.enabled = true;

    // Update Firestore
    await db.collection('automationStatus').doc('global').set({
      enabled: true,
      cronIntervalMinutes: intervalMinutes,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Set up cron job with configured interval
    // Only start new check if previous one is completed
    automationState.cronInterval = setInterval(() => {
      if (!automationState.running) {
        checkEmailsForAllAccounts();
      } else {
        logger.info('Skipping email check - previous check still running');
      }
    }, intervalMinutes * 60000); // Convert minutes to milliseconds

    logger.info(`Email automation enabled - checking every ${intervalMinutes} minute(s)`);

    res.json({
      success: true,
      message: "Email automation enabled successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to enable automation",
      error: error.message,
    });
  }
});

router.post("/automation/disable", requireRole("admin"), async (_req, res): Promise<void> => {
  try {
    if (!automationState.enabled) {
      res.json({
        success: true,
        message: "Email automation is already disabled",
      });
      return;
    }

    automationState.enabled = false;

    // Clear the cron interval
    if (automationState.cronInterval) {
      clearInterval(automationState.cronInterval);
      automationState.cronInterval = null;
    }

    // Get Firestore instance
    const db = getFirestoreDB();

    // Update Firestore
    await db.collection('automationStatus').doc('global').set({
      enabled: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    logger.info('Email automation disabled');

    res.json({
      success: true,
      message: "Email automation disabled successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to disable automation",
      error: error.message,
    });
  }
});

router.put("/automation/interval", requireRole("admin"), async (req, res): Promise<void> => {
  try {
    const { intervalMinutes } = req.body;

    if (!intervalMinutes || intervalMinutes < 1 || intervalMinutes > 60) {
      res.status(400).json({
        success: false,
        message: "Interval must be between 1 and 60 minutes",
      });
      return;
    }

    // Get Firestore instance
    const db = getFirestoreDB();

    // Update the automation status document in Firestore
    await db.collection('automationStatus').doc('global').set({
      cronIntervalMinutes: intervalMinutes,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // If automation is currently running, restart with new interval
    if (automationState.enabled && automationState.cronInterval) {
      clearInterval(automationState.cronInterval);
      
      // Set up new interval
      automationState.cronInterval = setInterval(() => {
        if (!automationState.running) {
          checkEmailsForAllAccounts();
        } else {
          logger.info('Skipping email check - previous check still running');
        }
      }, intervalMinutes * 60000); // Convert minutes to milliseconds

      logger.info(`Email automation interval updated to ${intervalMinutes} minute(s)`);
    }

    res.json({
      success: true,
      message: `Check interval updated to ${intervalMinutes} minute${intervalMinutes > 1 ? 's' : ''}`,
    });
  } catch (error: any) {
    logger.error('Error updating automation interval:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update check interval",
      error: error.message,
    });
  }
});

router.post("/automation/trigger", requireRole("admin"), async (_req, res): Promise<void> => {
  try {
    if (automationState.running) {
      res.json({
        success: false,
        message: "Email check is already running. Please wait for it to complete.",
      });
      return;
    }

    // Trigger manual check
    checkEmailsForAllAccounts();

    res.json({
      success: true,
      message: "Email processing triggered successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to trigger email processing",
      error: error.message,
    });
  }
});

// TODO: Re-implement email automation routes with Firestore
/*

router.post("/automation/start", requireRole("admin"), async (req, res) => {
  try {
    const userId = req.user?.id;
    await emailAutomationJob.enable(userId);
    res.json({
      success: true,
      message: "Email automation enabled and saved to database",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to enable automation",
      error: error.message,
    });
  }
});

router.post("/automation/stop", requireRole("admin"), async (req, res) => {
  try {
    const userId = req.user?.id;
    await emailAutomationJob.disable(userId);
    res.json({
      success: true,
      message: "Email automation disabled and saved to database",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to disable automation",
      error: error.message,
    });
  }
});

router.post("/automation/enable", requireRole("admin"), async (req, res) => {
  try {
    const userId = req.user?.id;
    await emailAutomationJob.enable(userId);
    res.json({
      success: true,
      message: "Email automation enabled and saved to database",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to enable automation",
      error: error.message,
    });
  }
});

router.post("/automation/disable", requireRole("admin"), async (req, res) => {
  try {
    const userId = req.user?.id;
    await emailAutomationJob.disable(userId);
    res.json({
      success: true,
      message: "Email automation disabled and saved to database",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to disable automation",
      error: error.message,
    });
  }
});

router.post("/automation/trigger", requireRole("admin"), async (_req, res) => {
  try {
    await emailAutomationJob.triggerManual();
    res.json({
      success: true,
      message: "Email processing triggered successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Failed to trigger email processing",
      error: error.message,
    });
  }
});
*/

/**
 * @route   POST /api/emails/automation/bulk-import
 * @desc    Process historical emails in bulk (8-12 months)
 * @access  Admin
 */
router.post("/automation/bulk-import", requireRole("admin"), async (req, res): Promise<void> => {
  try {
    const { accountId, startDate, endDate, maxEmails = 500 } = req.body;

    if (!accountId || !startDate || !endDate) {
      res.status(400).json({
        success: false,
        message: "accountId, startDate, and endDate are required",
      });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
      return;
    }

    if (start >= end) {
      res.status(400).json({
        success: false,
        message: "Start date must be before end date",
      });
      return;
    }

    logger.info(`📦 Starting bulk import for account ${accountId} from ${start.toISOString()} to ${end.toISOString()}`);

    // Get services
    const imapService = require('../services/imap.service').default;
    const { 
      emailAccountService, 
      emailService, 
      applicationService,
    } = require('../services/firestore');

    // Get account
    const account = await emailAccountService.findById(accountId);
    if (!account) {
      res.status(404).json({
        success: false,
        message: "Email account not found",
      });
      return;
    }

    // Fetch emails by date range
    logger.info(`📥 Fetching emails from ${account.email}...`);
    const emails = await imapService.fetchEmailsByDateRange(account, start, end, maxEmails);
    logger.info(`✓ Found ${emails.length} emails in date range`);

    let processed = 0;
    let applicationsCreated = 0;
    let repliesStored = 0;
    let errors = 0;
    let skipped = 0;

    // Process each email using the same logic as regular automation
    for (const email of emails) {
      try {
        // 🔥 HYBRID OPTIMIZATION: Check for duplicate by messageId first
        const existingEmail = await emailService.findByMessageId(email.messageId);
        if (existingEmail) {
          logger.info(`⏭️  Duplicate email (messageId: ${email.messageId}), skipping`);
          skipped++;
          continue;
        }
        
        const senderEmail = email.from.match(/<(.+?)>/) ? email.from.match(/<(.+?)>/)![1] : email.from;
        
        // Check if this is a reply
        const isReply = Boolean(
          email.inReplyTo || 
          email.references && email.references.length > 0 || 
          email.subject.toLowerCase().startsWith('re:') ||
          email.body.toLowerCase().includes('wrote:')
        );
        
        if (isReply) {
          // Skip replies for bulk import - only process applications
          logger.info(`⏭️  Skipping reply from ${senderEmail}`);
          skipped++;
          continue;
        }

        // Check if has resume attachment
        if (email.attachments.length === 0) {
          logger.info(`⏭️  No attachments from ${senderEmail}, skipping`);
          skipped++;
          continue;
        }

        // Check for duplicate application
        const existingApplications = await applicationService.find([
          { field: 'email', operator: '==', value: senderEmail }
        ]);
        
        if (existingApplications.length > 0) {
          logger.info(`⏭️  Application from ${senderEmail} already exists, skipping`);
          skipped++;
          continue;
        }
        
        // 🔥 Race condition prevention: Check by messageId
        const existingByMessageId = await applicationService.find([
          { field: 'sourceMessageId', operator: '==', value: email.messageId }
        ]);
        
        if (existingByMessageId.length > 0) {
          logger.info(`⏭️  Application with messageId ${email.messageId} already exists, skipping`);
          skipped++;
          continue;
        }

        // Find resume attachment
        const resumeAttachment = email.attachments.find((att: any) => 
          att.contentType.includes('pdf') || 
          att.contentType.includes('document') ||
          att.contentType.includes('msword') ||
          att.filename.toLowerCase().endsWith('.pdf') ||
          att.filename.toLowerCase().endsWith('.doc') ||
          att.filename.toLowerCase().endsWith('.docx')
        );

        if (!resumeAttachment) {
          logger.info(`⏭️  No resume attachment from ${senderEmail}, skipping`);
          skipped++;
          continue;
        }

        try {
          // Upload resume
          logger.info(`📤 Uploading resume: ${resumeAttachment.filename}`);
          const cloudinaryService = require('../services/cloudinary.service').default;
          const resumeUploadResult = await cloudinaryService.uploadResume(
            resumeAttachment.content,
            resumeAttachment.filename
          );

          // Extract video link from body
          const videoLinkMatch = email.body.match(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[^\s]+)/i);
          const videoLink = videoLinkMatch ? videoLinkMatch[0] : null;

          // Upload video if present
          let videoUrl = videoLink; // Use link if provided
          const videoAttachment = email.attachments.find((att: any) =>
            att.contentType.includes('video') ||
            att.filename.toLowerCase().endsWith('.mp4') ||
            att.filename.toLowerCase().endsWith('.mov') ||
            att.filename.toLowerCase().endsWith('.avi') ||
            att.filename.toLowerCase().endsWith('.webm') ||
            att.filename.toLowerCase().endsWith('.mkv')
          );

          if (videoAttachment && !videoUrl) {
            try {
              logger.info(`📤 Uploading video: ${videoAttachment.filename}`);
              const videoUploadResult = await cloudinaryService.uploadVideo(
                videoAttachment.content,
                videoAttachment.filename
              );
              videoUrl = videoUploadResult.url;
              logger.info(`Video uploaded: ${videoUrl}`);
            } catch (videoError) {
              logger.error(`Error uploading video:`, videoError);
            }
          }

          // Parse resume and validate
          // Initialize variables with fresh values per iteration
          let parsedData = null;
          let resumeRawText = '';
          let isValidResume = null;
          let validationScore = null;
          let validationReason = null;
          
          // Extract default candidate name from email (fallback only)
          let nameFromEmail = email.from.split('<')[0].trim();
          nameFromEmail = nameFromEmail.replace(/^["']|["']$/g, '');
          const candidateName = nameFromEmail || resumeAttachment.filename.replace(/\.(pdf|doc|docx)$/i, '');
          const nameParts = candidateName.split(' ').filter(Boolean);
          let firstName = nameParts[0] || 'Unknown';
          let lastName = nameParts.slice(1).join(' ') || 'Candidate';
          
          try {
            const openaiService = require('../services/openai.service').default;
            
            // First extract text from the resume buffer
            const fileType = resumeAttachment.filename.toLowerCase().endsWith('.pdf') ? 'pdf' :
                            resumeAttachment.filename.toLowerCase().endsWith('.docx') ? 'docx' : 'doc';
            resumeRawText = await openaiService.extractTextFromResume(resumeAttachment.content, fileType);
            
            // ⚠️ CRITICAL: If text extraction fails, don't create application
            if (!resumeRawText || resumeRawText.trim().length < 50) {
              logger.error(`❌ Resume text extraction failed or too short (${resumeRawText?.length || 0} chars) for ${senderEmail}`);
              throw new Error('Resume text extraction failed or content too short');
            }
            
            logger.info(`✅ Extracted ${resumeRawText.length} characters from resume`);
            
            // Then parse the extracted text
            parsedData = await openaiService.parseResume(resumeRawText);
            
            // ✅ AI Resume Validation (same as manual/direct apply)
            if (resumeRawText && resumeRawText.trim().length > 0) {
              try {
                logger.info('Running AI validation on resume...');
                const validationResult = await openaiService.validateResume(resumeRawText);
                
                isValidResume = validationResult.isValid;
                validationScore = validationResult.score;
                validationReason = validationResult.reason;
                
                logger.info(
                  `Resume validation: ${validationResult.isValid ? 'VALID' : 'INVALID'} ` +
                  `(score: ${validationResult.score}/100) - ${validationResult.reason}`
                );
              } catch (validationError: any) {
                logger.error('Resume validation failed:', validationError);
                isValidResume = null;
                validationScore = null;
                validationReason = 'Validation service unavailable';
              }
            }
            
            // ✅ Use parsed name from AI if available (more accurate)
            if (parsedData?.personalInfo?.firstName) {
              firstName = parsedData.personalInfo.firstName;
            }
            if (parsedData?.personalInfo?.lastName) {
              lastName = parsedData.personalInfo.lastName;
            }
          } catch (parseError: any) {
            logger.error(`❌ CRITICAL: Resume parsing completely failed for ${senderEmail}: ${parseError?.message || parseError}`);
            logger.error(`   - Resume file: ${resumeAttachment.filename}`);
            logger.error(`   - Extracted text length: ${resumeRawText?.length || 0}`);
            logger.error(`   - Skipping application creation to prevent data corruption`);
            // Skip this email - don't create application with corrupted/missing data
            skipped++;
            continue;
          }

          // Create application
          const applicationData: any = {
            source: 'email_automation',
            sourceEmail: senderEmail,
            sourceEmailAccountId: account.id,
            sourceMessageId: email.messageId, // 🔥 Store messageId to prevent duplicates
            firstName,
            lastName,
            email: senderEmail,
            resumeUrl: resumeUploadResult.url,
            resumeOriginalName: resumeAttachment.filename,
            resumeRawText, // Keep as pure raw text - no modifications
            status: (account.defaultApplicationStatus || 'pending') as any,
            // AI validation results
            isValidResume,
            validationScore,
            validationReason,
            aiCheckStatus: parsedData ? 'completed' : 'pending',
            aiCheckCompletedAt: parsedData ? new Date() : undefined,
          };
          
          // Only add optional fields if they have actual data
          if (parsedData?.personalInfo?.phone) {
            applicationData.phone = parsedData.personalInfo.phone;
          }
          
          if (videoUrl) {
            applicationData.videoIntroUrl = videoUrl;
          }
          
          if (parsedData) {
            applicationData.parsedData = parsedData;
          }

          const applicationId = await applicationService.create(applicationData as any);
          logger.info(`✅ Application created: ${firstName} ${lastName} (${senderEmail})`);
          applicationsCreated++;

          // Store email
          await emailService.create({
            direction: 'inbound',
            from: senderEmail,
            to: [account.email],
            subject: email.subject,
            body: email.body,
            bodyHtml: email.bodyHtml,
            status: 'processed',
            receivedAt: email.date || new Date(),
            messageId: email.messageId,
            applicationId: applicationId,
            emailAccountId: account.id,
            attachments: email.attachments.map((att: any) => ({
              filename: att.filename,
              url: att.filename === resumeAttachment.filename ? resumeUploadResult.url : (att.filename === videoAttachment?.filename ? videoUrl : ''),
              contentType: att.contentType,
              size: att.size,
            })),
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any);

          processed++;

        } catch (processingError) {
          logger.error(`Error processing bulk email from ${senderEmail}:`, processingError);
          errors++;
        }

      } catch (emailError) {
        logger.error(`Error in bulk import:`, emailError);
        errors++;
      }
    }

    logger.info(`📦 Bulk import completed. Processed: ${processed}, Created: ${applicationsCreated}, Skipped: ${skipped}, Errors: ${errors}`);

    res.json({
      success: true,
      message: "Bulk import completed",
      data: {
        totalEmails: emails.length,
        processed,
        applicationsCreated,
        repliesStored,
        skipped,
        errors,
      },
    });

  } catch (error: any) {
    logger.error('Bulk import error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to process bulk import",
      error: error.message,
    });
  }
});

export default router;
