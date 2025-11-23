import { getFirestoreDB } from '../src/config/firebase';
import { categorizeVideoFile } from '../src/utils/videoHandler';

interface ApplicationMissingVideo {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  source: string;
  sourceEmailAccountId?: string;
  videoIntroUrl?: string;
  appliedAt?: any;
}

/**
 * Extract video link from email body
 */
function extractVideoLink(body: string): string | null {
  if (!body) return null;
  
  const videoLinkMatch = body.match(
    /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/|drive\.google\.com\/file\/d\/)[^\s<>"']+)/i
  );
  
  return videoLinkMatch ? videoLinkMatch[0].trim() : null;
}

/**
 * Check if attachment is a video file
 */
function isVideoAttachment(attachment: any): boolean {
  if (!attachment) return false;
  
  return (
    attachment.contentType?.includes('video') ||
    attachment.filename?.toLowerCase().endsWith('.mp4') ||
    attachment.filename?.toLowerCase().endsWith('.mov') ||
    attachment.filename?.toLowerCase().endsWith('.avi') ||
    attachment.filename?.toLowerCase().endsWith('.webm') ||
    attachment.filename?.toLowerCase().endsWith('.mkv')
  );
}

/**
 * Find applications missing videos from email automation
 */
async function findApplicationsMissingVideos(): Promise<ApplicationMissingVideo[]> {
  console.log('🔍 Finding applications without videos from email automation...\n');
  
  const db = getFirestoreDB();
  const applicationsSnapshot = await db
    .collection('applications')
    .where('source', '==', 'email_automation')
    .get();
  
  const missing: ApplicationMissingVideo[] = [];
  
  applicationsSnapshot.forEach((doc: any) => {
    const app = doc.data();
    
    if (!app.videoIntroUrl) {
      missing.push({
        id: doc.id,
        email: app.email,
        firstName: app.firstName,
        lastName: app.lastName,
        source: app.source,
        sourceEmailAccountId: app.sourceEmailAccountId,
        videoIntroUrl: app.videoIntroUrl,
        appliedAt: app.appliedAt,
      });
    }
  });
  
  return missing;
}

/**
 * Fetch email from IMAP server for a specific applicant
 */
async function fetchEmailFromIMAP(
  emailAccount: any,
  applicantEmail: string
): Promise<any | null> {
  const imapService = require('../src/services/imap.service').default;
  
  try {
    // Fetch more emails to ensure we find the applicant's email
    const emails = await imapService.fetchUnreadEmails(emailAccount, 500);
    
    // Search for emails from this applicant
    const applicantEmails = emails.filter((email: any) => {
      const from = email.from.toLowerCase();
      return from.includes(applicantEmail.toLowerCase());
    });
    
    if (applicantEmails.length === 0) {
      return null;
    }
    
    // Return the first email (or the one with attachments)
    const emailWithAttachments = applicantEmails.find((e: any) => 
      e.attachments && e.attachments.length > 0
    );
    
    return emailWithAttachments || applicantEmails[0];
  } catch (error: any) {
    console.error(`   ❌ Error fetching from IMAP: ${error.message}`);
    return null;
  }
}

/**
 * Upload video to Cloudinary
 */
async function uploadVideoToCloudinary(
  videoBuffer: Buffer,
  filename: string
): Promise<string | null> {
  try {
    const cloudinaryService = require('../src/services/cloudinary.service').default;
    const result = await cloudinaryService.uploadVideo(videoBuffer, filename);
    return result.url;
  } catch (error: any) {
    console.error(`   ❌ Error uploading video: ${error.message}`);
    return null;
  }
}

/**
 * Update application with video URL
 */
async function updateApplicationWithVideo(
  applicationId: string,
  videoUrl: string,
  dryRun: boolean = false
): Promise<boolean> {
  if (dryRun) {
    console.log(`   [DRY RUN] Would update application ${applicationId}`);
    return true;
  }
  
  try {
    const db = getFirestoreDB();
    await db.collection('applications').doc(applicationId).update({
      videoIntroUrl: videoUrl,
      updatedAt: new Date(),
    });
    
    return true;
  } catch (error: any) {
    console.error(`   ❌ Error updating application: ${error.message}`);
    return false;
  }
}

/**
 * Update email record with video attachment URL
 */
async function updateEmailWithVideo(
  emailId: string,
  videoAttachmentFilename: string,
  videoUrl: string,
  dryRun: boolean = false
): Promise<void> {
  if (dryRun) return;
  
  try {
    const db = getFirestoreDB();
    const emailDoc = await db.collection('emails').doc(emailId).get();
    
    if (!emailDoc.exists) return;
    
    const emailData = emailDoc.data();
    const attachments = emailData?.attachments || [];
    
    // Update the video attachment URL
    const updatedAttachments = attachments.map((att: any) => {
      if (att.filename === videoAttachmentFilename) {
        return { ...att, url: videoUrl };
      }
      return att;
    });
    
    await db.collection('emails').doc(emailId).update({
      attachments: updatedAttachments,
      updatedAt: new Date(),
    });
  } catch (error: any) {
    console.error(`   ⚠️  Could not update email record: ${error.message}`);
  }
}

/**
 * Process a single application - fetch from IMAP and recover video
 */
async function processApplication(
  app: ApplicationMissingVideo,
  emailAccount: any,
  dryRun: boolean = false
): Promise<{ success: boolean; reason: string }> {
  console.log(`\n📄 Processing: ${app.firstName} ${app.lastName} (${app.email})`);
  console.log(`   Application ID: ${app.id}`);
  
  try {
    // Step 1: Fetch email from IMAP
    console.log(`   📥 Fetching email from IMAP server...`);
    const email = await fetchEmailFromIMAP(emailAccount, app.email);
    
    if (!email) {
      console.log(`   ⚠️  No email found on IMAP server`);
      return { success: false, reason: 'Email not found on IMAP' };
    }
    
    console.log(`   ✓ Found email: "${email.subject}"`);
    
    // Step 2: Check for video link in body
    const videoLink = extractVideoLink(email.body);
    
    if (videoLink) {
      console.log(`   📹 Found video link: ${videoLink}`);
      
      const updated = await updateApplicationWithVideo(app.id, videoLink, dryRun);
      
      if (updated) {
        console.log(`   ✅ Updated application with video link`);
        return { success: true, reason: 'Video link recovered' };
      } else {
        return { success: false, reason: 'Failed to update application' };
      }
    }
    
    // Step 3: Check for video attachment
    if (!email.attachments || email.attachments.length === 0) {
      console.log(`   ⚠️  No attachments found`);
      return { success: false, reason: 'No attachments' };
    }
    
    const videoAttachment = email.attachments.find((att: any) => isVideoAttachment(att));
    
    if (!videoAttachment) {
      console.log(`   ⚠️  No video attachment found`);
      console.log(`   Attachments: ${email.attachments.map((a: any) => a.filename).join(', ')}`);
      return { success: false, reason: 'No video attachment' };
    }
    
    console.log(`   🎥 Found video: ${videoAttachment.filename} (${(videoAttachment.content.length / 1024 / 1024).toFixed(2)} MB)`);
    
    // Step 4: Upload video to Cloudinary
    if (!dryRun) {
      console.log(`   ☁️  Uploading to Cloudinary...`);
      const videoUrl = await uploadVideoToCloudinary(
        videoAttachment.content,
        videoAttachment.filename
      );
      
      if (!videoUrl) {
        return { success: false, reason: 'Failed to upload video' };
      }
      
      console.log(`   ✓ Uploaded: ${videoUrl}`);
      
      // Step 5: Update application
      const updated = await updateApplicationWithVideo(app.id, videoUrl, false);
      
      if (!updated) {
        return { success: false, reason: 'Failed to update application' };
      }
      
      // Step 6: Update email record if it exists
      const db = getFirestoreDB();
      const emailSnapshot = await db.collection('emails')
        .where('applicationId', '==', app.id)
        .get();
      
      if (!emailSnapshot.empty) {
        const emailDoc = emailSnapshot.docs[0];
        await updateEmailWithVideo(emailDoc.id, videoAttachment.filename, videoUrl, false);
      }
      
      console.log(`   ✅ Successfully recovered and attached video`);
      return { success: true, reason: 'Video recovered and uploaded' };
    } else {
      console.log(`   [DRY RUN] Would upload video and update application`);
      return { success: true, reason: 'Would recover video' };
    }
    
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--live');
  const maxToProcess = args.includes('--all') ? 999999 : 50; // Default to 50 unless --all specified
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  REPROCESS MISSING VIDEOS FROM IMAP SERVER');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (no changes)' : '🔧 LIVE MODE (applying changes)'}`);
  console.log('═══════════════════════════════════════════════════════════\n');
  
  try {
    // Step 1: Get email accounts
    const db = getFirestoreDB();
    const { emailAccountService } = require('../src/services/firestore');
    
    const accounts = await emailAccountService.find([
      { field: 'isActive', operator: '==', value: true }
    ]);
    
    if (accounts.length === 0) {
      console.log('❌ No active email accounts found');
      process.exit(1);
    }
    
    console.log(`📧 Found ${accounts.length} active email account(s)\n`);
    
    // Step 2: Find applications missing videos
    const applications = await findApplicationsMissingVideos();
    
    console.log(`Found ${applications.length} application(s) without videos\n`);
    
    if (applications.length === 0) {
      console.log('✨ All applications have videos! Nothing to do.');
      process.exit(0);
    }
    
    // Limit processing if not --all
    const toProcess = applications.slice(0, maxToProcess);
    
    if (toProcess.length < applications.length) {
      console.log(`⚠️  Processing first ${maxToProcess} applications (use --all to process all)\n`);
    }
    
    console.log('═'.repeat(60));
    console.log('PROCESSING APPLICATIONS');
    console.log('═'.repeat(60));
    
    // Step 3: Process each application
    let recovered = 0;
    let notFound = 0;
    let noVideo = 0;
    let errors = 0;
    
    for (const app of toProcess) {
      for (const account of accounts) {
        const result = await processApplication(app, account, dryRun);
        
        if (result.success) {
          recovered++;
          break; // Found in this account, move to next application
        } else if (result.reason === 'Email not found on IMAP') {
          // Try next account
          continue;
        } else if (result.reason === 'No video attachment' || result.reason === 'No attachments') {
          noVideo++;
          break;
        } else {
          errors++;
          break;
        }
      }
      
      // Add small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Summary
    console.log('\n\n' + '═'.repeat(60));
    console.log('SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Total applications checked: ${toProcess.length}`);
    console.log(`✅ Videos recovered: ${recovered}`);
    console.log(`⚠️  No video found: ${noVideo}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Success rate: ${((recovered / toProcess.length) * 100).toFixed(1)}%`);
    
    if (dryRun) {
      console.log('\n💡 This was a dry run. Run with --live to apply changes.');
    } else {
      console.log('\n✅ All changes have been applied!');
    }
    
    if (toProcess.length < applications.length) {
      console.log(`\n⚠️  ${applications.length - toProcess.length} more application(s) remaining.`);
      console.log('   Run with --all --live to process all applications.');
    }
    
  } catch (error: any) {
    console.error('\n❌ Script error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the script
main();
